use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const DEFAULT_PROVIDER: &str = "local-whisper";
const NVIDIA_PARAKEET_PROVIDER: &str = "nvidia-parakeet";
const NVIDIA_PARAKEET_URL: &str = "https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions";
const DEFAULT_MODE_ID: &str = "note";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ContextToggles {
    selection: bool,
    clipboard: bool,
    application: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct FewShotExample {
    id: String,
    user_input_raw: String,
    expected_output_formatted: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ModeConfig {
    id: String,
    name: String,
    built_in: bool,
    prompt: String,
    context: ContextToggles,
    examples: Vec<FewShotExample>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VocabularyReplacement {
    id: String,
    from: String,
    to: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AppRule {
    id: String,
    app_name: String,
    mode_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AppConfig {
    provider: String,
    nvidia_api_key: String,
    auto_purge: bool,
    first_run: bool,
    modes: Vec<ModeConfig>,
    default_mode_id: String,
    vocabulary_replacements: Vec<VocabularyReplacement>,
    app_rules: Vec<AppRule>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiMetadata {
    dictation_shortcut: String,
    settings_shortcut: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            provider: DEFAULT_PROVIDER.to_string(),
            nvidia_api_key: std::env::var("NVIDIA_API_KEY")
                .unwrap_or_default()
                .trim()
                .to_string(),
            auto_purge: true,
            first_run: true,
            modes: default_modes(),
            default_mode_id: DEFAULT_MODE_ID.to_string(),
            vocabulary_replacements: Vec::new(),
            app_rules: Vec::new(),
        }
    }
}

struct AppState {
    config: Arc<Mutex<AppConfig>>,
    whisper_context: Arc<Mutex<Option<WhisperContext>>>,
    ui_metadata: UiMetadata,
}

fn default_modes() -> Vec<ModeConfig> {
    vec![
        ModeConfig {
            id: "note".to_string(),
            name: "Note".to_string(),
            built_in: true,
            prompt: "Turn rough dictation into a clean note with light formatting.".to_string(),
            context: ContextToggles::default(),
            examples: Vec::new(),
        },
        ModeConfig {
            id: "email".to_string(),
            name: "Email".to_string(),
            built_in: true,
            prompt: "Rewrite the transcript as a concise professional email.".to_string(),
            context: ContextToggles {
                application: true,
                ..Default::default()
            },
            examples: Vec::new(),
        },
        ModeConfig {
            id: "message".to_string(),
            name: "Message".to_string(),
            built_in: true,
            prompt: "Rewrite the transcript as a short friendly message ready to send.".to_string(),
            context: ContextToggles {
                application: true,
                ..Default::default()
            },
            examples: Vec::new(),
        },
    ]
}

fn is_built_in_mode_id(id: &str) -> bool {
    matches!(id, "note" | "email" | "message")
}

fn trim_or(input: String, fallback: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_example(example: FewShotExample, index: usize) -> Option<FewShotExample> {
    let user_input_raw = example.user_input_raw.trim().to_string();
    let expected_output_formatted = example.expected_output_formatted.trim().to_string();

    if user_input_raw.is_empty() && expected_output_formatted.is_empty() {
        return None;
    }

    Some(FewShotExample {
        id: trim_or(example.id, &format!("example-{}", index + 1)),
        user_input_raw,
        expected_output_formatted,
    })
}

fn normalize_mode(mode: ModeConfig, fallback: Option<&ModeConfig>, index: usize) -> ModeConfig {
    let fallback_id = fallback
        .map(|item| item.id.as_str())
        .unwrap_or(DEFAULT_MODE_ID);
    let fallback_name = fallback
        .map(|item| item.name.as_str())
        .unwrap_or("Custom Mode");
    let fallback_prompt = fallback.map(|item| item.prompt.as_str()).unwrap_or("");
    let fallback_context = fallback.map(|item| item.context.clone()).unwrap_or_default();
    let built_in = mode.built_in || is_built_in_mode_id(fallback_id) || is_built_in_mode_id(&mode.id);
    let id = trim_or(mode.id, &format!("{}-{}", fallback_id, index + 1));

    ModeConfig {
        id,
        name: trim_or(mode.name, fallback_name),
        built_in,
        prompt: trim_or(mode.prompt, fallback_prompt),
        context: ContextToggles {
            selection: mode.context.selection,
            clipboard: mode.context.clipboard,
            application: mode.context.application || fallback_context.application,
        },
        examples: mode
            .examples
            .into_iter()
            .enumerate()
            .filter_map(|(example_index, example)| normalize_example(example, example_index))
            .collect(),
    }
}

fn merge_modes(modes: Vec<ModeConfig>) -> Vec<ModeConfig> {
    let defaults = default_modes();
    let normalized: Vec<ModeConfig> = modes
        .into_iter()
        .enumerate()
        .map(|(index, mode)| normalize_mode(mode, None, index))
        .collect();

    let mut merged = Vec::new();
    let mut seen_ids: Vec<String> = Vec::new();

    for default_mode in &defaults {
        let candidate = normalized
            .iter()
            .find(|mode| mode.id == default_mode.id)
            .cloned()
            .unwrap_or_else(|| default_mode.clone());
        let normalized_mode = normalize_mode(candidate, Some(default_mode), merged.len());
        seen_ids.push(normalized_mode.id.clone());
        merged.push(normalized_mode);
    }

    for mode in normalized {
        if is_built_in_mode_id(&mode.id) || seen_ids.iter().any(|id| id == &mode.id) {
            continue;
        }
        seen_ids.push(mode.id.clone());
        merged.push(mode);
    }

    merged
}

fn normalize_vocabulary_replacement(
    item: VocabularyReplacement,
    index: usize,
) -> Option<VocabularyReplacement> {
    let from = item.from.trim().to_string();
    let to = item.to.trim().to_string();

    if from.is_empty() && to.is_empty() {
        return None;
    }

    Some(VocabularyReplacement {
        id: trim_or(item.id, &format!("vocab-{}", index + 1)),
        from,
        to,
    })
}

fn normalize_app_rule(rule: AppRule, index: usize, valid_mode_ids: &[String], default_mode_id: &str) -> Option<AppRule> {
    let app_name = rule.app_name.trim().to_string();
    if app_name.is_empty() {
        return None;
    }

    let mode_id = if valid_mode_ids.iter().any(|id| id == &rule.mode_id) {
        rule.mode_id
    } else {
        default_mode_id.to_string()
    };

    Some(AppRule {
        id: trim_or(rule.id, &format!("rule-{}", index + 1)),
        app_name,
        mode_id,
    })
}

// Convert 16-bit PCM mono WAV file bytes to 32-bit float samples expected by Whisper
fn wav_bytes_to_f32_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    if wav_bytes.len() < 44 {
        return Err("WAV data is too short (missing headers)".to_string());
    }

    let pcm_data = &wav_bytes[44..];
    let sample_count = pcm_data.len() / 2;
    let mut samples = Vec::with_capacity(sample_count);

    for i in 0..sample_count {
        let offset = i * 2;
        if offset + 1 < pcm_data.len() {
            let le_bytes = [pcm_data[offset], pcm_data[offset + 1]];
            let sample_i16 = i16::from_le_bytes(le_bytes);
            samples.push(sample_i16 as f32 / 32768.0);
        }
    }

    Ok(samples)
}

fn normalize_provider(provider: &str) -> String {
    match provider {
        NVIDIA_PARAKEET_PROVIDER => NVIDIA_PARAKEET_PROVIDER.to_string(),
        _ => DEFAULT_PROVIDER.to_string(),
    }
}

fn normalize_config(mut config: AppConfig) -> AppConfig {
    config.provider = normalize_provider(&config.provider);
    config.nvidia_api_key = config.nvidia_api_key.trim().to_string();

    if config.nvidia_api_key.is_empty() {
        config.nvidia_api_key = std::env::var("NVIDIA_API_KEY")
            .unwrap_or_default()
            .trim()
            .to_string();
    }

    config.modes = merge_modes(config.modes);

    let valid_mode_ids: Vec<String> = config.modes.iter().map(|mode| mode.id.clone()).collect();
    config.default_mode_id = if valid_mode_ids.iter().any(|id| id == &config.default_mode_id) {
        config.default_mode_id.trim().to_string()
    } else {
        DEFAULT_MODE_ID.to_string()
    };

    config.vocabulary_replacements = config
        .vocabulary_replacements
        .into_iter()
        .enumerate()
        .filter_map(|(index, item)| normalize_vocabulary_replacement(item, index))
        .collect();

    config.app_rules = config
        .app_rules
        .into_iter()
        .enumerate()
        .filter_map(|(index, rule)| {
            normalize_app_rule(rule, index, &valid_mode_ids, &config.default_mode_id)
        })
        .collect();

    config
}

fn config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    std::fs::create_dir_all(&app_data_dir).map_err(|e| {
        format!(
            "Failed to create app data directory at {:?}: {}",
            app_data_dir, e
        )
    })?;

    Ok(app_data_dir.join("settings.json"))
}

fn load_config(app_handle: &tauri::AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app_handle)?;
    let mut config = if !path.exists() {
        AppConfig::default()
    } else {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read settings file at {:?}: {}", path, e))?;
        serde_json::from_str::<AppConfig>(&raw).unwrap_or_default()
    };

    let mut has_keychain_key = false;
    if let Ok(entry) = keyring::Entry::new("sooper-wisper", "nvidia_api_key") {
        if let Ok(password) = entry.get_password() {
            let key = password.trim().to_string();
            if !key.is_empty() {
                config.nvidia_api_key = key;
                has_keychain_key = true;
            }
        }
    }

    if !has_keychain_key && !config.nvidia_api_key.trim().is_empty() {
        if let Ok(entry) = keyring::Entry::new("sooper-wisper", "nvidia_api_key") {
            let _ = entry.set_password(&config.nvidia_api_key);
        }
    }

    Ok(normalize_config(config))
}

fn save_config(app_handle: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app_handle)?;
    let mut normalized = normalize_config(config.clone());
    normalized.nvidia_api_key = String::new();
    let raw = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&path, raw)
        .map_err(|e| format!("Failed to write settings file at {:?}: {}", path, e))
}

// Check local storage and optionally download default model from HuggingFace
fn ensure_model_file(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let models_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| {
        format!(
            "Failed to create models directory at {:?}: {}",
            models_dir, e
        )
    })?;

    if let Ok(env_path) = std::env::var("LOCAL_WHISPER_MODEL_PATH") {
        if !env_path.trim().is_empty() {
            let path = PathBuf::from(env_path);
            if path.exists() {
                println!("Using custom model specified in .env: {:?}", path);
                return Ok(path);
            } else {
                return Err(format!(
                    "Custom model path specified in .env does not exist: {:?}",
                    path
                ));
            }
        }
    }

    let default_model_path = models_dir.join("ggml-tiny.en.bin");
    if default_model_path.exists() {
        println!("Using default model cached at: {:?}", default_model_path);
        return Ok(default_model_path);
    }

    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin";
    println!("Whisper model not found locally.");
    println!("Downloading default 'ggml-tiny.en.bin' (~75MB) from Hugging Face...");
    println!("Save location: {:?}", default_model_path);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to send download request: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let mut dest_file = std::fs::File::create(&default_model_path).map_err(|e| {
        format!(
            "Failed to create model target file at {:?}: {}",
            default_model_path, e
        )
    })?;

    response
        .copy_to(&mut dest_file)
        .map_err(|e| format!("Failed to write downloaded data: {}", e))?;

    println!("Model downloaded successfully!");
    Ok(default_model_path)
}

fn ensure_whisper_context(
    app_handle: &tauri::AppHandle,
    whisper_context: &Arc<Mutex<Option<WhisperContext>>>,
) -> Result<(), String> {
    let mut guard = whisper_context
        .lock()
        .map_err(|_| "Failed to acquire lock on WhisperContext".to_string())?;

    if guard.is_some() {
        return Ok(());
    }

    let model_path = ensure_model_file(app_handle)?;
    let ctx_params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().ok_or("Invalid path string")?,
        ctx_params,
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    *guard = Some(ctx);
    Ok(())
}

fn transcribe_with_whisper_blocking(
    app_handle: tauri::AppHandle,
    whisper_context: Arc<Mutex<Option<WhisperContext>>>,
    audio_bytes: Vec<u8>,
) -> Result<String, String> {
    let samples = wav_bytes_to_f32_samples(&audio_bytes)?;
    if samples.is_empty() {
        return Err("No audio samples decoded".to_string());
    }

    ensure_whisper_context(&app_handle, &whisper_context)?;

    let guard = whisper_context
        .lock()
        .map_err(|_| "Failed to acquire lock on WhisperContext".to_string())?;
    let ctx = guard
        .as_ref()
        .ok_or("Whisper model is not available".to_string())?;

    let mut whisper_state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create WhisperState: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    whisper_state
        .full(params, &samples)
        .map_err(|e| format!("ASR inference run error: {}", e))?;

    let mut result = String::new();
    let num_segments = whisper_state
        .full_n_segments()
        .map_err(|e| format!("Failed to fetch segments count: {}", e))?;

    for i in 0..num_segments {
        if let Ok(text) = whisper_state.full_get_segment_text(i) {
            result.push_str(&text);
        }
    }

    Ok(result.trim().to_string())
}

fn first_non_empty<'a>(items: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    items
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn extract_transcript(value: &Value) -> Option<String> {
    if let Some(text) = first_non_empty([
        value.get("text").and_then(Value::as_str),
        value.get("transcript").and_then(Value::as_str),
    ]) {
        return Some(text);
    }

    for key in ["chunks", "segments", "alternatives", "results"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            let joined = items
                .iter()
                .filter_map(extract_transcript)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            let joined = joined.trim().to_string();
            if !joined.is_empty() {
                return Some(joined);
            }
        }
    }

    if let Some(object) = value.as_object() {
        for nested in object.values() {
            if let Some(text) = extract_transcript(nested) {
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
    }

    None
}

async fn transcribe_with_parakeet(audio_bytes: Vec<u8>, api_key: String) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to prepare audio upload: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("language", "en-US")
        .part("file", part);

    let response = reqwest::Client::new()
        .post(NVIDIA_PARAKEET_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("NVIDIA request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read NVIDIA response: {}", e))?;

    if !status.is_success() {
        let detail = body.trim();
        let detail = if detail.is_empty() {
            status.to_string()
        } else {
            detail.to_string()
        };
        return Err(format!("NVIDIA request failed: {}", detail));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse NVIDIA response: {}", e))?;

    extract_transcript(&value)
        .ok_or_else(|| "NVIDIA response did not include transcript text".to_string())
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire lock on settings".to_string())?
        .clone();
    Ok(config)
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: AppConfig,
) -> Result<AppConfig, String> {
    let config = normalize_config(config);

    if let Ok(entry) = keyring::Entry::new("sooper-wisper", "nvidia_api_key") {
        let trimmed_key = config.nvidia_api_key.trim();
        if !trimmed_key.is_empty() {
            let _ = entry.set_password(trimmed_key);
        } else {
            let _ = entry.delete_credential();
        }
    }

    save_config(&app, &config)?;

    let mut guard = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire lock on settings".to_string())?;
    *guard = config.clone();

    let _ = app.emit("settings-changed", config.clone());

    Ok(config)
}

#[tauri::command]
fn get_ui_metadata(state: tauri::State<'_, AppState>) -> Result<UiMetadata, String> {
    Ok(state.ui_metadata.clone())
}

#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    audio_bytes: Vec<u8>,
) -> Result<String, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "Failed to acquire lock on settings".to_string())?
        .clone();

    if config.provider == NVIDIA_PARAKEET_PROVIDER {
        if config.nvidia_api_key.trim().is_empty() {
            return Err("Missing NVIDIA API key".to_string());
        }

        return transcribe_with_parakeet(audio_bytes, config.nvidia_api_key).await;
    }

    let whisper_context = state.whisper_context.clone();
    tokio::task::spawn_blocking(move || {
        transcribe_with_whisper_blocking(app, whisper_context, audio_bytes)
    })
    .await
    .map_err(|e| format!("Task joined execution error: {}", e))?
}

#[tauri::command]
async fn paste_text(
    app: tauri::AppHandle,
    text: String,
    target_app: Option<String>,
) -> Result<(), String> {
    let _ = app.emit("hud-state", serde_json::json!({ "state": "pasting" }));

    if let Some(app_name) = target_app {
        let app_name = app_name.trim();
        if !app_name.is_empty() && app_name != "Finder" {
            let script = format!("tell application \"{}\" to activate", app_name);
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output();
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    let clipboard = app.clipboard();
    let previous_text = clipboard.read_text().ok();

    clipboard
        .write_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using {command down}")
        .output()
        .map_err(|e| format!("Failed to execute AppleScript paste: {}", e))?;

    if let Some(prev) = previous_text {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let cb = app_clone.clipboard();
            let _ = cb.write_text(prev);
        });
    }

    Ok(())
}

#[tauri::command]
async fn open_microphone_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn();
    }
    Ok(())
}

#[tauri::command]
async fn toggle_click_through(window: tauri::Window, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| format!("Failed to toggle click-through: {}", e))
}

#[tauri::command]
async fn get_active_app() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to name of first application process whose frontmost is true")
            .output();

        match output {
            Ok(out) => {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if name.is_empty() {
                    Ok("Finder".to_string())
                } else {
                    Ok(name)
                }
            }
            Err(_) => Ok("Finder".to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("Finder".to_string())
    }
}

#[tauri::command]
async fn get_selection_text(app: tauri::AppHandle) -> Result<String, String> {
    let clipboard = app.clipboard();
    let previous_text = clipboard.read_text().ok();

    // Simulate Command+C
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"c\" using {command down}")
        .output();

    if output.is_ok() {
        // Sleep briefly to let the clipboard update
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let selected_text = clipboard.read_text().unwrap_or_default();

        // Restore clipboard
        if let Some(prev) = previous_text {
            let _ = clipboard.write_text(prev);
        }

        Ok(selected_text)
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
async fn get_clipboard_text(app: tauri::AppHandle) -> Result<String, String> {
    let clipboard = app.clipboard();
    Ok(clipboard.read_text().unwrap_or_default())
}

#[tauri::command]
async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window
        .hide()
        .map_err(|e| format!("Failed to hide window: {}", e))
}

#[tauri::command]
async fn show_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(settings_window) = app.get_webview_window("settings") {
        settings_window.show().map_err(|e| e.to_string())?;
        settings_window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(settings_window) = app.get_webview_window("settings") {
        settings_window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_window(window: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("Failed to read current monitor: {}", e))?
        .or_else(|| window.primary_monitor().ok().flatten());

    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    if let Some(monitor) = monitor {
        let scale_factor = monitor.scale_factor();
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let x = monitor_position.x as f64 + ((monitor_size.width as f64 - width * scale_factor) / 2.0);
        let y = monitor_position.y as f64 + (90.0 * scale_factor);

        window
            .set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|e| format!("Failed to reposition window: {}", e))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    let hotkey_str = std::env::var("GLOBAL_HOTKEY").unwrap_or_else(|_| "Option+Space".to_string());
    let settings_hotkey_str = std::env::var("GLOBAL_SETTINGS_HOTKEY")
        .unwrap_or_else(|_| "Option+Shift+Space".to_string());
    let hotkey = hotkey_str
        .parse::<Shortcut>()
        .unwrap_or_else(|e| panic!("Error parsing global hotkey '{}': {}", hotkey_str, e));
    let settings_hotkey = settings_hotkey_str.parse::<Shortcut>().unwrap_or_else(|e| {
        panic!(
            "Error parsing settings hotkey '{}': {}",
            settings_hotkey_str, e
        )
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        use tauri::Emitter;
                        if *shortcut == settings_hotkey {
                            let _ = app.emit("open-settings", ());
                        } else if *shortcut == hotkey {
                            let _ = app.emit("global-shortcut-pressed", ());
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();
            let config = load_config(&handle).unwrap_or_else(|err| {
                eprintln!("Failed to load settings, using defaults: {}", err);
                AppConfig::default()
            });

            app.manage(AppState {
                config: Arc::new(Mutex::new(config)),
                whisper_context: Arc::new(Mutex::new(None)),
                ui_metadata: UiMetadata {
                    dictation_shortcut: hotkey_str.clone(),
                    settings_shortcut: settings_hotkey_str.clone(),
                },
            });

            let settings_item = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Sooper-Wisper").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .items(&[&settings_item, &quit_item])
                .build()?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon missing".into()))?;

            TrayIconBuilder::with_id("menu-bar")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => {
                        let _ = app.emit("open-settings", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = tray.app_handle().emit("open-settings", ());
                    }
                })
                .build(app)?;

            let window = app.get_webview_window("main").unwrap();
            let _ = window.set_shadow(false);
            if let Some(monitor) = window.primary_monitor().unwrap() {
                let scale_factor = monitor.scale_factor();
                let monitor_size = monitor.size();

                let width = 420.0 * scale_factor;
                let height = 120.0 * scale_factor;

                let x = (monitor_size.width as f64 - width) / 2.0;
                let y = 100.0 * scale_factor;

                let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
            }

            app.global_shortcut().register(hotkey).map_err(|e| {
                eprintln!("Failed to register global shortcut: {}", e);
                e
            })?;
            app.global_shortcut()
                .register(settings_hotkey)
                .map_err(|e| {
                    eprintln!("Failed to register settings shortcut: {}", e);
                    e
                })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_ui_metadata,
            transcribe_audio,
            paste_text,
            open_microphone_settings,
            toggle_click_through,
            hide_window,
            resize_window,
            get_active_app,
            get_selection_text,
            get_clipboard_text,
            show_settings_window,
            hide_settings_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{extract_transcript, normalize_config, AppConfig, AppRule, FewShotExample, ModeConfig, VocabularyReplacement};
    use serde_json::json;

    #[test]
    fn extracts_text_field() {
        let value = json!({ "text": "hello world" });
        assert_eq!(extract_transcript(&value).as_deref(), Some("hello world"));
    }

    #[test]
    fn extracts_nested_segments() {
        let value = json!({
            "segments": [
                { "text": "hello" },
                { "text": "world" }
            ]
        });
        assert_eq!(extract_transcript(&value).as_deref(), Some("hello world"));
    }

    #[test]
    fn normalize_config_backfills_phase_three_defaults() {
        let config = normalize_config(AppConfig::default());
        assert_eq!(config.default_mode_id, "note");
        assert_eq!(config.auto_purge, true);
        assert_eq!(config.first_run, true);
        assert_eq!(config.modes.len(), 3);
        assert!(config.modes.iter().any(|mode| mode.id == "email"));
    }

    #[test]
    fn normalize_config_keeps_custom_modes_and_filters_blank_rows() {
        let config = normalize_config(AppConfig {
            default_mode_id: "custom-1".to_string(),
            modes: vec![ModeConfig {
                id: "custom-1".to_string(),
                name: " Standup ".to_string(),
                built_in: false,
                prompt: " Summarize for Slack ".to_string(),
                context: Default::default(),
                examples: vec![
                    FewShotExample {
                        id: String::new(),
                        user_input_raw: " yesterday I fixed bugs ".to_string(),
                        expected_output_formatted: "Yesterday: fixed bugs".to_string(),
                    },
                    FewShotExample::default(),
                ],
            }],
            vocabulary_replacements: vec![
                VocabularyReplacement {
                    id: String::new(),
                    from: " sooper wisper ".to_string(),
                    to: "Sooper-Wisper".to_string(),
                },
                VocabularyReplacement::default(),
            ],
            app_rules: vec![
                AppRule {
                    id: String::new(),
                    app_name: " Slack ".to_string(),
                    mode_id: "custom-1".to_string(),
                },
                AppRule::default(),
            ],
            ..AppConfig::default()
        });

        assert_eq!(config.default_mode_id, "custom-1");
        assert!(config.modes.iter().any(|mode| mode.id == "custom-1" && mode.name == "Standup"));
        assert_eq!(config.vocabulary_replacements.len(), 1);
        assert_eq!(config.app_rules.len(), 1);
        assert_eq!(config.app_rules[0].app_name, "Slack");
    }
}
