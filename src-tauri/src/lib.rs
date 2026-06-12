use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_clipboard_manager::ClipboardExt;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

struct AppState {
    whisper_context: Arc<Mutex<WhisperContext>>,
}

// Convert 16-bit PCM mono WAV file bytes to 32-bit float samples expected by Whisper
fn wav_bytes_to_f32_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    if wav_bytes.len() < 44 {
        return Err("WAV data is too short (missing headers)".to_string());
    }

    // Skip the 44-byte standard WAV header
    let pcm_data = &wav_bytes[44..];
    
    // Each sample is a 16-bit signed integer (2 bytes)
    let sample_count = pcm_data.len() / 2;
    let mut samples = Vec::with_capacity(sample_count);
    
    for i in 0..sample_count {
        let offset = i * 2;
        if offset + 1 < pcm_data.len() {
            let le_bytes = [pcm_data[offset], pcm_data[offset + 1]];
            let sample_i16 = i16::from_le_bytes(le_bytes);
            // Convert i16 [-32768, 32767] to f32 [-1.0, 1.0]
            let sample_f32 = sample_i16 as f32 / 32768.0;
            samples.push(sample_f32);
        }
    }
    
    Ok(samples)
}

// Check local storage and optionally download default model from HuggingFace
fn ensure_model_file(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        
    let models_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory at {:?}: {}", models_dir, e))?;

    // Check if the user has defined a custom path in .env
    if let Ok(env_path) = std::env::var("LOCAL_WHISPER_MODEL_PATH") {
        if !env_path.trim().is_empty() {
            let path = PathBuf::from(env_path);
            if path.exists() {
                println!("Using custom model specified in .env: {:?}", path);
                return Ok(path);
            } else {
                return Err(format!("Custom model path specified in .env does not exist: {:?}", path));
            }
        }
    }

    // Default to downloading the lightweight English-only ggml-tiny.en.bin (~75MB)
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
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout limit
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut response = client.get(url).send()
        .map_err(|e| format!("Failed to send download request: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let mut dest_file = std::fs::File::create(&default_model_path)
        .map_err(|e| format!("Failed to create model target file at {:?}: {}", default_model_path, e))?;

    response.copy_to(&mut dest_file)
        .map_err(|e| format!("Failed to write downloaded data: {}", e))?;

    println!("Model downloaded successfully!");
    Ok(default_model_path)
}

fn should_save_debug_audio() -> bool {
    std::env::var("SAVE_DEBUG_AUDIO")
        .ok()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
}

fn save_debug_audio(app_handle: &tauri::AppHandle, audio_bytes: &[u8]) {
    if !should_save_debug_audio() {
        return;
    }

    let Some(app_data_dir) = app_handle.path().app_data_dir().ok() else {
        eprintln!("Skipping debug audio save: unable to determine app data directory");
        return;
    };

    if let Err(err) = std::fs::create_dir_all(&app_data_dir) {
        eprintln!("Skipping debug audio save: failed to create app data directory: {}", err);
        return;
    }

    let debug_audio_path = app_data_dir.join("debug_audio.wav");
    if let Err(err) = std::fs::write(&debug_audio_path, audio_bytes) {
        eprintln!("Failed to save debug audio to {:?}: {}", debug_audio_path, err);
    }
}

#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    audio_bytes: Vec<u8>
) -> Result<String, String> {
    let whisper_context = state.whisper_context.clone();
    save_debug_audio(&app, &audio_bytes);
    
    // 1. Convert PCM WAV format bytes to f32 samples downsampled to 16kHz
    let samples = wav_bytes_to_f32_samples(&audio_bytes)?;
    
    if samples.is_empty() {
        return Err("No audio samples decoded".to_string());
    }

    // 2. Spawn on a blocking thread pool to prevent freezing the main UI loop
    tokio::task::spawn_blocking(move || {
        let ctx = whisper_context.lock()
            .map_err(|_| "Failed to acquire lock on WhisperContext".to_string())?;

        // 3. Create mutable active transcription state
        let mut whisper_state = ctx.create_state()
            .map_err(|e| format!("Failed to create WhisperState: {}", e))?;

        // 4. Configure Greedy English parameters
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // 5. Run inference (compiled with Metal GPU optimization)
        whisper_state.full(params, &samples[..])
            .map_err(|e| format!("ASR inference run error: {}", e))?;

        // 6. Assemble transcribed segment text
        let mut result = String::new();
        let num_segments = whisper_state.full_n_segments()
            .map_err(|e| format!("Failed to fetch segments count: {}", e))?;

        for i in 0..num_segments {
            if let Ok(text) = whisper_state.full_get_segment_text(i) {
                result.push_str(&text);
            }
        }

        Ok(result.trim().to_string())
    })
    .await
    .map_err(|e| format!("Task joined execution error: {}", e))?
}

#[tauri::command]
async fn paste_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let clipboard = app.clipboard();
    
    // Backup the current clipboard text
    let previous_text = clipboard.read_text().ok();

    // Write the transcribed text to clipboard
    clipboard.write_text(text).map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    // Execute macOS AppleScript to trigger cmd+v paste event
    std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"v\" using {command down}")
        .output()
        .map_err(|e| format!("Failed to execute AppleScript paste: {}", e))?;

    // Restore the clipboard in the background after 200ms delay
    if let Some(prev) = previous_text {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let cb = app_clone.clipboard();
            let _ = cb.write_text(prev);
        });
    }

    Ok(())
}

#[tauri::command]
async fn toggle_click_through(window: tauri::Window, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| format!("Failed to toggle click-through: {}", e))
}

#[tauri::command]
async fn hide_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| format!("Failed to hide window: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        use tauri::Emitter;
                        let _ = app.emit("global-shortcut-pressed", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            // Run the model downloader synchronously during setup
            let model_path = match ensure_model_file(&handle) {
                Ok(path) => path,
                Err(err) => {
                    eprintln!("Initialization Error: {}", err);
                    panic!("Application initialization failed: {}", err);
                }
            };

            // Initialize WhisperContext with loaded model
            let ctx_params = WhisperContextParameters::default();
            let whisper_context = WhisperContext::new_with_params(
                model_path.to_str().ok_or("Invalid path string").unwrap(),
                ctx_params
            ).map_err(|e| {
                let err_msg = format!("Failed to load Whisper model: {}", e);
                eprintln!("{}", err_msg);
                err_msg
            }).unwrap();

            // Manage the shared context state
            app.manage(AppState {
                whisper_context: Arc::new(Mutex::new(whisper_context)),
            });

            // Set window initial position at top-center of the screen
            let window = app.get_webview_window("main").unwrap();
            if let Some(monitor) = window.primary_monitor().unwrap() {
                let scale_factor = monitor.scale_factor();
                let monitor_size = monitor.size();

                let width = 320.0 * scale_factor;
                let height = 80.0 * scale_factor;

                let x = (monitor_size.width as f64 - width) / 2.0;
                let y = 100.0 * scale_factor; // Near top

                let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
            }

            // Start click-through enabled
            let _ = window.set_ignore_cursor_events(true);

            // Read and parse global hotkey
            let hotkey_str = std::env::var("GLOBAL_HOTKEY").unwrap_or_else(|_| "Option+Space".to_string());
            let shortcut = hotkey_str.parse::<Shortcut>().map_err(|e| {
                eprintln!("Error parsing global hotkey '{}': {}", hotkey_str, e);
                e
            }).unwrap();

            // Register global shortcut
            app.global_shortcut().register(shortcut).map_err(|e| {
                eprintln!("Failed to register global shortcut: {}", e);
                e
            }).unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            paste_text,
            toggle_click_through,
            hide_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
