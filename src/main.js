import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioRecorder } from './audio.js';
import { getEscapeAction, getStateStatus, getWaveBarScale, shouldShowHud } from './hud-logic.js';
import { buildPromptPreview, getModeById, makeId, normalizeSettingsConfig, getModeForApp, applyVocabularyReplacements, buildUseTimePrompt } from './settings-logic.js';

const HUD_WINDOW_SIZE = { width: 388, height: 88 };
const SETTINGS_WINDOW_SIZE = { width: 1100, height: 760 };
const SETTINGS_SECTIONS = ['onboarding', 'modes', 'models', 'vocabulary', 'shortcuts', 'privacy'];
const DEFAULT_SETTINGS_HINT = 'Search and QR pairing stay stubbed for now.';

const appWindow = getCurrentWindow();
const isSettingsWindow = appWindow.label === 'settings';
const recorder = isSettingsWindow ? null : new AudioRecorder();

let currentState = 'idle';
let errorTimeout = null;
let resetTimeout = null;
let settingsOpen = false;
let windowHidden = false;
let menuOpen = false;
let waveformMode = 'mic';
let waveformLevel = 0;
let waveformPhase = 0;
let errorAction = null;
let activeSettingsSection = 'modes';
let selectedModeId = 'note';
let uiMetadata = {
  dictationShortcut: 'Option+Space',
  settingsShortcut: 'Option+Shift+Space',
};
let settings = normalizeSettingsConfig();
let capturedContext = {
  appName: '',
  selection: '',
  clipboard: '',
  modeId: '',
};

const body = document.body;
const hud = document.getElementById('hud');
const hudRow = document.querySelector('.hud-row');
const statusText = document.getElementById('status-text');
const statusSubtext = document.getElementById('status-subtext');
const timer = document.getElementById('timer');
const menuButton = document.getElementById('menu-button');
const contextMenu = document.getElementById('context-menu');
const waveBars = [...document.querySelectorAll('.wave-bar')];

const settingsView = document.getElementById('settings-view');
const settingsHeader = document.querySelector('.settings-shell-header');
const settingsDoneButton = document.getElementById('settings-done');
const settingsSearchInput = document.getElementById('settings-search');
const providerSelect = document.getElementById('provider-select');
const apiKeyRow = document.getElementById('api-key-row');
const apiKeyInput = document.getElementById('api-key-input');
const saveSettingsButton = document.getElementById('save-settings');
const settingsHint = document.getElementById('settings-hint');
const providerHelp = document.getElementById('provider-help');
const sidebarProviderStatus = document.getElementById('sidebar-provider-status');
const sidebarPrivacyStatus = document.getElementById('sidebar-privacy-status');
const sidebarModeStatus = document.getElementById('sidebar-mode-status');
const dictationShortcut = document.getElementById('dictation-shortcut');
const settingsShortcut = document.getElementById('settings-shortcut');
const autoPurgeInput = document.getElementById('auto-purge-input');
const settingsNavButtons = [...document.querySelectorAll('[data-settings-section]')];
const settingsPanes = [...document.querySelectorAll('[data-settings-pane]')];

const modeList = document.getElementById('mode-list');
const addCustomModeButton = document.getElementById('add-custom-mode');
const modeEditorTitle = document.getElementById('mode-editor-title');
const makeDefaultModeButton = document.getElementById('make-default-mode');
const deleteModeButton = document.getElementById('delete-mode');
const modeNameInput = document.getElementById('mode-name-input');
const modePromptInput = document.getElementById('mode-prompt-input');
const contextSelection = document.getElementById('context-selection');
const contextClipboard = document.getElementById('context-clipboard');
const contextApplication = document.getElementById('context-application');
const modeExamples = document.getElementById('mode-examples');
const addExampleButton = document.getElementById('add-example');
const modePreview = document.getElementById('mode-preview');
const appRules = document.getElementById('app-rules');
const addAppRuleButton = document.getElementById('add-app-rule');
const vocabularyList = document.getElementById('vocabulary-list');
const addVocabularyItemButton = document.getElementById('add-vocabulary-item');

const sandboxInput = document.getElementById('sandbox-input');
const sandboxLatency = document.getElementById('sandbox-latency');
const sandboxCharCount = document.getElementById('sandbox-char-count');
const sandboxRecordBtn = document.getElementById('sandbox-record-btn');
const sandboxRecordStatus = document.getElementById('sandbox-record-status');
const finishOnboardingBtn = document.getElementById('finish-onboarding-btn');
const playgroundHotkeyDisplay = document.getElementById('playground-hotkey-display');

function isCloud() {
  return settings.provider === 'nvidia-parakeet';
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function setWindowSize(size) {
  invoke('resize_window', { width: size.width, height: size.height }).catch(console.error);
}

function showWindow() {
  if (isSettingsWindow) return;
  windowHidden = false;
  hud.classList.remove('window-hidden');
  appWindow.show().catch(console.error);
  invoke('toggle_click_through', { ignore: false }).catch(console.error);
}

function hideWindowOnly() {
  if (isSettingsWindow) return;
  windowHidden = true;
  closeContextMenu();
  hud.classList.add('window-hidden');
  invoke('toggle_click_through', { ignore: true }).catch(console.error);
}

function syncWindowVisibility() {
  if (isSettingsWindow) return;
  if (shouldShowHud({ currentState, settingsOpen })) {
    showWindow();
    return;
  }

  hideWindowOnly();
}

function clearStateTimers() {
  if (errorTimeout) {
    clearTimeout(errorTimeout);
    errorTimeout = null;
  }
  if (resetTimeout) {
    clearTimeout(resetTimeout);
    resetTimeout = null;
  }
}

function setWaveformMode(mode = 'mic') {
  waveformMode = mode === 'system' ? 'system' : 'mic';
  hud.dataset.waveformMode = waveformMode;
}

function setWaveformLevel(level = 0) {
  waveformLevel = Math.max(0, Math.min(1, level));
}

function renderWaveform() {
  waveformPhase += 0.2;

  waveBars.forEach((bar, index) => {
    const scale = getWaveBarScale({
      currentState,
      waveformMode,
      waveformLevel,
      waveformPhase,
      index,
    });

    bar.style.transform = `scaleY(${scale.toFixed(3)})`;
  });

  requestAnimationFrame(renderWaveform);
}

function setSettingsHint(text) {
  settingsHint.textContent = text;
}

function escapeHtml(value = '') {
  return `${value}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getSelectedMode() {
  return getModeById(settings, selectedModeId);
}

function ensureSelectedMode() {
  const selectedMode = getSelectedMode();
  if (selectedMode) {
    selectedModeId = selectedMode.id;
    return selectedMode;
  }

  selectedModeId = settings.modes[0]?.id || 'note';
  return getSelectedMode();
}

function syncShortcutUI() {
  dictationShortcut.textContent = uiMetadata.dictationShortcut;
  settingsShortcut.textContent = uiMetadata.settingsShortcut;
}

function renderModeList() {
  modeList.innerHTML = '';

  settings.modes.forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mode-list-button${mode.id === selectedModeId ? ' active' : ''}`;
    button.dataset.modeId = mode.id;
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(mode.name)}</strong>
        <span class="muted-copy">${mode.builtIn ? 'Built-in' : 'Custom'}</span>
      </span>
      ${settings.defaultModeId === mode.id ? '<span class="mode-badge">Default</span>' : ''}
    `;
    modeList.appendChild(button);
  });
}

function renderExamples(mode) {
  modeExamples.innerHTML = '';

  if (!mode.examples.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-copy empty-copy';
    empty.textContent = 'No examples yet. Add one if the mode needs steering.';
    modeExamples.appendChild(empty);
    return;
  }

  mode.examples.forEach((example, index) => {
    const row = document.createElement('div');
    row.className = 'stack-item example-item';
    row.dataset.exampleId = example.id;
    row.innerHTML = `
      <div class="example-header-row">
        <span class="field-label">Example ${index + 1}</span>
        <button class="secondary-button compact-button" type="button" data-remove-example="${example.id}">Remove</button>
      </div>
      <label class="field compact-field">
        <span class="muted-copy">User input</span>
        <textarea rows="2" data-example-input="${example.id}" placeholder="Raw dictated input">${escapeHtml(example.userInputRaw)}</textarea>
      </label>
      <label class="field compact-field">
        <span class="muted-copy">Expected output</span>
        <textarea rows="3" data-example-output="${example.id}" placeholder="Formatted output">${escapeHtml(example.expectedOutputFormatted)}</textarea>
      </label>
    `;
    modeExamples.appendChild(row);
  });
}

function renderAppRules() {
  appRules.innerHTML = '';

  if (!settings.appRules.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-copy empty-copy';
    empty.textContent = 'No app rules yet. Add one when you want Mail, Slack, or another app to prefer a mode.';
    appRules.appendChild(empty);
    return;
  }

  settings.appRules.forEach((rule) => {
    const row = document.createElement('div');
    row.className = 'stack-item inline-grid';
    row.dataset.ruleId = rule.id;

    const options = settings.modes.map((mode) => (
      `<option value="${mode.id}"${mode.id === rule.modeId ? ' selected' : ''}>${escapeHtml(mode.name)}</option>`
    )).join('');

    row.innerHTML = `
      <input type="text" value="${escapeHtml(rule.appName)}" data-rule-app-name="${rule.id}" placeholder="Mail, Slack, VS Code..." />
      <select data-rule-mode-id="${rule.id}">${options}</select>
      <button class="secondary-button compact-button" type="button" data-remove-rule="${rule.id}">Remove</button>
    `;
    appRules.appendChild(row);
  });
}

function renderVocabulary() {
  vocabularyList.innerHTML = '';

  if (!settings.vocabularyReplacements.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-copy empty-copy';
    empty.textContent = 'No replacements yet. Add names, jargon, and corrections here.';
    vocabularyList.appendChild(empty);
    return;
  }

  settings.vocabularyReplacements.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'stack-item inline-grid';
    row.dataset.vocabularyId = item.id;
    row.innerHTML = `
      <input type="text" value="${escapeHtml(item.from)}" data-vocabulary-from="${item.id}" placeholder="Heard text" />
      <input type="text" value="${escapeHtml(item.to)}" data-vocabulary-to="${item.id}" placeholder="Replace with" />
      <button class="secondary-button compact-button" type="button" data-remove-vocabulary="${item.id}">Remove</button>
    `;
    vocabularyList.appendChild(row);
  });
}

function renderModeEditor() {
  const mode = ensureSelectedMode();
  if (!mode) return;

  modeEditorTitle.textContent = `${mode.name} mode`;
  modeNameInput.value = mode.name;
  modeNameInput.disabled = mode.builtIn;
  modePromptInput.value = mode.prompt;
  contextSelection.checked = mode.context.selection;
  contextClipboard.checked = mode.context.clipboard;
  contextApplication.checked = mode.context.application;
  deleteModeButton.disabled = mode.builtIn;
  makeDefaultModeButton.disabled = settings.defaultModeId === mode.id;
  makeDefaultModeButton.textContent = settings.defaultModeId === mode.id ? 'Default mode' : 'Make default';
  renderExamples(mode);
  modePreview.textContent = buildPromptPreview(mode);
}

function syncSettingsUI() {
  settings = normalizeSettingsConfig(settings);
  const selectedMode = ensureSelectedMode();

  providerSelect.value = settings.provider;
  apiKeyInput.value = settings.nvidiaApiKey || '';
  apiKeyRow.hidden = !isCloud();
  apiKeyInput.disabled = !isCloud();

  providerHelp.textContent = isCloud()
    ? 'Cloud mode uploads audio to NVIDIA Parakeet for transcription.'
    : 'Local mode runs on-device with Whisper.';
  sidebarProviderStatus.textContent = isCloud()
    ? 'NVIDIA Parakeet is active.'
    : 'Local Whisper is active.';
  if (autoPurgeInput) {
    autoPurgeInput.checked = settings.autoPurge;
  }

  sidebarPrivacyStatus.textContent = isCloud()
    ? 'Cloud mode sends audio to NVIDIA. Keychain storage is active.'
    : 'Audio stays on-device in local mode.';
  sidebarModeStatus.textContent = `Default mode: ${getModeById(settings, settings.defaultModeId)?.name || 'Note'}.`;

  if (playgroundHotkeyDisplay) {
    playgroundHotkeyDisplay.textContent = settings.dictationShortcut || uiMetadata?.dictationShortcut || 'Option+Space';
  }

  renderModeList();
  renderModeEditor();
  renderAppRules();
  renderVocabulary();

  if (currentState === 'idle' && !settingsOpen) {
    const status = getStateStatus({ state: 'idle', isCloud: isCloud(), waveformMode, shortcuts: uiMetadata });
    statusText.textContent = status.text;
    statusSubtext.textContent = status.subtext;
  }

  if (!selectedMode) {
    setSettingsHint(`Saved config has no selected mode. ${DEFAULT_SETTINGS_HINT}`);
  }
}

function closeContextMenu() {
  menuOpen = false;
  contextMenu.hidden = true;
}

function openContextMenu(x, y) {
  menuOpen = true;
  contextMenu.hidden = false;

  requestAnimationFrame(() => {
    const width = contextMenu.offsetWidth;
    const height = contextMenu.offsetHeight;
    const nextX = Math.min(Math.max(8, x), window.innerWidth - width - 8);
    const nextY = Math.min(Math.max(8, y), window.innerHeight - height - 8);

    contextMenu.style.left = `${nextX}px`;
    contextMenu.style.top = `${nextY}px`;
  });
}

function setActiveSettingsSection(section = 'modes') {
  activeSettingsSection = SETTINGS_SECTIONS.includes(section) ? section : 'modes';

  settingsNavButtons.forEach((button) => {
    const active = button.dataset.settingsSection === activeSettingsSection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  settingsPanes.forEach((pane) => {
    const active = pane.dataset.settingsPane === activeSettingsSection;
    pane.hidden = !active;
    pane.classList.toggle('active', active);
  });
}

function applySettingsViewState() {
  const isSettings = appWindow.label === 'settings' || settingsOpen;
  body.dataset.view = isSettings ? 'settings' : 'hud';
  settingsView.hidden = !isSettings;
  hud.setAttribute('aria-hidden', String(isSettings));

  if (appWindow.label === 'main') {
    try {
      appWindow.setDecorations(false).catch(console.error);
      appWindow.setShadow(false).catch(console.error);
      appWindow.setAlwaysOnTop(true).catch(console.error);
      appWindow.setResizable(false).catch(console.error);
    } catch (err) {
      console.error('Failed to update window attributes:', err);
    }
    setWindowSize(HUD_WINDOW_SIZE);
  } else {
    try {
      appWindow.setDecorations(true).catch(console.error);
      appWindow.setShadow(true).catch(console.error);
      appWindow.setAlwaysOnTop(false).catch(console.error);
      appWindow.setResizable(true).catch(console.error);
    } catch (err) {
      console.error('Failed to update window attributes:', err);
    }
    setWindowSize(SETTINGS_WINDOW_SIZE);
  }
}

function closeSettings() {
  if (appWindow.label === 'settings') {
    invoke('hide_settings_window').catch(console.error);
  }
}

function openSettings({ focusApiKey = false, section = null, hintText = null } = {}) {
  const targetSection = section || (settings?.firstRun ? 'onboarding' : 'modes');
  if (appWindow.label === 'main') {
    invoke('show_settings_window').catch(console.error);
    appWindow.emit('focus-settings-section', { focusApiKey, section: targetSection, hintText }).catch(console.error);
    return;
  }

  appWindow.show().catch(console.error);
  appWindow.focus().catch(console.error);
  closeContextMenu();
  settingsOpen = true;
  applySettingsViewState();
  syncSettingsUI();
  setActiveSettingsSection(targetSection);
  setSettingsHint(hintText || `${uiMetadata.settingsShortcut} opens this window. ${DEFAULT_SETTINGS_HINT}`);

  if (focusApiKey) {
    queueMicrotask(() => apiKeyInput.focus());
    return;
  }

  queueMicrotask(() => {
    if (section === 'modes') {
      const mode = getSelectedMode();
      (mode?.builtIn ? modePromptInput : modeNameInput).focus();
      return;
    }

    settingsSearchInput.focus();
  });
}

function transitionTo(state) {
  if (isSettingsWindow) return;
  clearStateTimers();
  if (state !== 'idle' && settingsOpen) {
    closeSettings();
  }

  currentState = state;
  errorAction = null;
  hud.classList.remove('idle', 'recording', 'processing', 'pasting', 'error');
  hud.classList.add(state);

  if (state !== 'idle') {
    showWindow();
  }

  if (state === 'idle') {
    timer.textContent = '0:00';
    syncSettingsUI();
  } else {
    const activeMode = getModeById(settings, capturedContext.modeId || settings.defaultModeId);
    const status = getStateStatus({
      state,
      isCloud: isCloud(),
      waveformMode,
      shortcuts: uiMetadata,
      activeModeName: activeMode?.name,
    });
    if (status) {
      if (state === 'recording') {
        timer.textContent = '0:00';
      }
      statusText.textContent = status.text;
      statusSubtext.textContent = status.subtext;
    }
  }

  syncWindowVisibility();
}

function showError(message, action = null, subtext = 'Click to open settings') {
  clearStateTimers();
  currentState = 'error';
  errorAction = action;
  hud.classList.remove('idle', 'recording', 'processing', 'pasting', 'error');
  hud.classList.add('error');
  showWindow();
  statusText.textContent = message;
  statusSubtext.textContent = subtext;
  errorTimeout = setTimeout(() => {
    errorAction = null;
    transitionTo('idle');
  }, 3200);
}

function isCloudKeyError(err) {
  const message = `${err || ''}`.toLowerCase();
  return message.includes('missing nvidia api key')
    || message.includes('invalid key')
    || (message.includes('nvidia') && message.includes('401'));
}

function handleSaveError(err) {
  const message = typeof err === 'string' ? err : 'Save failed';
  if (settingsOpen) {
    setSettingsHint(message);
    return;
  }
  showError(message);
}

function addCustomMode() {
  const mode = {
    id: makeId('mode'),
    name: 'Custom Mode',
    builtIn: false,
    prompt: 'Rewrite the transcript to match this custom mode.',
    context: { selection: false, clipboard: false, application: false },
    examples: [],
  };

  settings.modes.push(mode);
  selectedModeId = mode.id;
  syncSettingsUI();
}

function deleteSelectedMode() {
  const mode = getSelectedMode();
  if (!mode || mode.builtIn) return;

  settings.modes = settings.modes.filter((item) => item.id !== mode.id);
  settings.appRules = settings.appRules.filter((rule) => rule.modeId !== mode.id);
  if (settings.defaultModeId === mode.id) {
    settings.defaultModeId = 'note';
  }
  selectedModeId = settings.modes[0]?.id || 'note';
  syncSettingsUI();
}

function addExample() {
  const mode = getSelectedMode();
  if (!mode) return;

  mode.examples.push({
    id: makeId('example'),
    userInputRaw: '',
    expectedOutputFormatted: '',
  });
  syncSettingsUI();
}

function addVocabularyItem() {
  settings.vocabularyReplacements.push({ id: makeId('vocab'), from: '', to: '' });
  syncSettingsUI();
}

function addAppRule() {
  settings.appRules.push({
    id: makeId('rule'),
    appName: '',
    modeId: settings.defaultModeId,
  });
  syncSettingsUI();
}

async function loadSettings() {
  const [loadedSettings, loadedMetadata] = await Promise.all([
    invoke('get_settings'),
    invoke('get_ui_metadata'),
  ]);

  settings = normalizeSettingsConfig(loadedSettings);
  selectedModeId = settings.defaultModeId;
  uiMetadata = loadedMetadata;
  syncShortcutUI();
  setWaveformMode('mic');
  applySettingsViewState();

  if (appWindow.label === 'main') {
    transitionTo('idle');

    if (isCloud() && !settings.nvidiaApiKey.trim()) {
      openSettings({
        focusApiKey: true,
        section: 'models',
        hintText: 'Cloud mode needs an NVIDIA API key. Paste it here, then click Save.',
      });
    }
  } else {
    settingsOpen = true;
    body.dataset.view = 'settings';
    settingsView.hidden = false;
    hud.hidden = true;
    hud.setAttribute('aria-hidden', 'true');
    syncSettingsUI();
    setActiveSettingsSection(settings.firstRun ? 'onboarding' : 'modes');
  }
}

async function persistSettings() {
  settings = normalizeSettingsConfig(settings);
  settings = normalizeSettingsConfig(await invoke('save_settings', { config: settings }));
  selectedModeId = settings.defaultModeId;

  closeSettings();
  transitionTo('idle');
}

async function handleShortcutTrigger() {
  if (settingsOpen) {
    closeSettings();
    transitionTo('idle');
    return;
  }

  if (currentState === 'processing' || currentState === 'pasting') {
    return;
  }

  if (currentState === 'idle' || currentState === 'error') {
    if (isCloud() && !settings.nvidiaApiKey.trim()) {
      openSettings({
        focusApiKey: true,
        section: 'models',
        hintText: 'Cloud mode needs an NVIDIA API key. Paste it here, then click Save.',
      });
      return;
    }

    transitionTo('recording');

    (async () => {
      const recordPromise = recorder.start(
        (seconds) => {
          timer.textContent = formatTime(seconds);
        },
        (level) => {
          setWaveformLevel(level);
        },
      );

      const contextPromise = (async () => {
        let activeApp = 'Finder';
        try {
          activeApp = await invoke('get_active_app');
        } catch (e) {
          console.error('Failed to get active app:', e);
        }

        const modeId = getModeForApp(settings, activeApp);
        const mode = getModeById(settings, modeId);

        let selection = '';
        if (mode?.context.selection) {
          try {
            selection = await invoke('get_selection_text');
          } catch (e) {
            console.error('Failed to get selection:', e);
          }
        }

        let clipboardText = '';
        if (mode?.context.clipboard) {
          try {
            clipboardText = await invoke('get_clipboard_text');
          } catch (e) {
            console.error('Failed to get clipboard:', e);
          }
        }

        return {
          appName: activeApp,
          selection,
          clipboard: clipboardText,
          modeId: mode?.id || settings.defaultModeId,
        };
      })();

      try {
        const [_, context] = await Promise.all([recordPromise, contextPromise]);
        capturedContext = context;

        if (currentState === 'recording') {
          const activeMode = getModeById(settings, capturedContext.modeId);
          const status = getStateStatus({
            state: 'recording',
            isCloud: isCloud(),
            waveformMode,
            shortcuts: uiMetadata,
            activeModeName: activeMode?.name,
          });
          if (status) {
            statusText.textContent = status.text;
            statusSubtext.textContent = status.subtext;
          }
        }
      } catch (err) {
        console.error(err);
        showError(
          'Mic error',
          () => invoke('open_microphone_settings').catch(console.error),
          'Click to open System Microphone settings',
        );
      }
    })();
    return;
  }

  if (currentState === 'recording') {
    setWaveformLevel(0);
    transitionTo('processing');

    try {
      const wavBytes = await recorder.stop();
      if (wavBytes.length === 0) {
        transitionTo('idle');
        return;
      }

      const startTime = performance.now();
      const text = await invoke('transcribe_audio', { audioBytes: Array.from(wavBytes) });
      const latencyMs = Math.round(performance.now() - startTime);

      if (settings.autoPurge) {
        wavBytes.fill(0);
      }

      if (!text || !text.trim()) {
        showError('No speech detected', null, 'Try again or check microphone input');
        return;
      }

      const lowerAppName = (capturedContext.appName || '').toLowerCase();
      const isTargetOwnApp = lowerAppName.includes('wisper') || lowerAppName.includes('tauri');
      if (isTargetOwnApp) {
        appWindow.emit('sandbox-text-result', { text, latencyMs }).catch(console.error);
        transitionTo('idle');
        return;
      }

      let processedText = applyVocabularyReplacements(text, settings.vocabularyReplacements);

      const activeMode = getModeById(settings, capturedContext.modeId || settings.defaultModeId);
      if (activeMode) {
        const isDefault = activeMode.id === settings.defaultModeId;
        processedText = buildUseTimePrompt(activeMode, processedText, {
          selection: capturedContext.selection,
          clipboard: capturedContext.clipboard,
          application: capturedContext.appName,
        }, isDefault);
      }

      transitionTo('pasting');
      await invoke('paste_text', { text: processedText, targetApp: capturedContext.appName });
      resetTimeout = setTimeout(() => transitionTo('idle'), 900);
    } catch (err) {
      console.error(err);
      if (isCloudKeyError(err)) {
        showError(
          'Key invalid',
          () => openSettings({
            focusApiKey: true,
            section: 'models',
            hintText: 'Cloud mode needs a valid NVIDIA API key. Paste it here, then click Save.',
          }),
          'Click to fix your NVIDIA API key',
        );
      } else {
        showError(typeof err === 'string' ? err : 'ASR / Paste failed');
      }
    }
  }
}

providerSelect.addEventListener('change', () => {
  settings.provider = providerSelect.value;
  syncSettingsUI();

  if (isCloud()) {
    setActiveSettingsSection('models');
    setSettingsHint('Cloud mode sends audio to NVIDIA. Paste your API key, then click Save.');
    apiKeyInput.focus();
    return;
  }

  setSettingsHint(`${uiMetadata.settingsShortcut} opens this window. ${DEFAULT_SETTINGS_HINT}`);
});

apiKeyInput.addEventListener('input', () => {
  settings.nvidiaApiKey = apiKeyInput.value.trim();
});

if (autoPurgeInput) {
  autoPurgeInput.addEventListener('change', () => {
    settings.autoPurge = autoPurgeInput.checked;
  });
}

addCustomModeButton.addEventListener('click', () => {
  addCustomMode();
  setSettingsHint('Custom mode added. Save when it looks right.');
  queueMicrotask(() => modeNameInput.focus());
});

makeDefaultModeButton.addEventListener('click', () => {
  const mode = getSelectedMode();
  if (!mode) return;
  settings.defaultModeId = mode.id;
  syncSettingsUI();
});

deleteModeButton.addEventListener('click', () => {
  deleteSelectedMode();
});

modeNameInput.addEventListener('input', () => {
  const mode = getSelectedMode();
  if (!mode || mode.builtIn) return;
  mode.name = modeNameInput.value;
  syncSettingsUI();
});

modePromptInput.addEventListener('input', () => {
  const mode = getSelectedMode();
  if (!mode) return;
  mode.prompt = modePromptInput.value;
  modePreview.textContent = buildPromptPreview(mode);
});

contextSelection.addEventListener('change', () => {
  const mode = getSelectedMode();
  if (!mode) return;
  mode.context.selection = contextSelection.checked;
  modePreview.textContent = buildPromptPreview(mode);
});

contextClipboard.addEventListener('change', () => {
  const mode = getSelectedMode();
  if (!mode) return;
  mode.context.clipboard = contextClipboard.checked;
  modePreview.textContent = buildPromptPreview(mode);
});

contextApplication.addEventListener('change', () => {
  const mode = getSelectedMode();
  if (!mode) return;
  mode.context.application = contextApplication.checked;
  modePreview.textContent = buildPromptPreview(mode);
});

addExampleButton.addEventListener('click', () => {
  addExample();
});

modeExamples.addEventListener('click', (event) => {
  const exampleId = event.target.closest('[data-remove-example]')?.dataset.removeExample;
  if (!exampleId) return;

  const mode = getSelectedMode();
  if (!mode) return;
  mode.examples = mode.examples.filter((example) => example.id !== exampleId);
  syncSettingsUI();
});

modeExamples.addEventListener('input', (event) => {
  const mode = getSelectedMode();
  if (!mode) return;

  const inputId = event.target.dataset.exampleInput;
  const outputId = event.target.dataset.exampleOutput;
  const example = mode.examples.find((item) => item.id === inputId || item.id === outputId);
  if (!example) return;

  if (inputId) example.userInputRaw = event.target.value;
  if (outputId) example.expectedOutputFormatted = event.target.value;
  modePreview.textContent = buildPromptPreview(mode);
});

addAppRuleButton.addEventListener('click', () => {
  addAppRule();
});

appRules.addEventListener('click', (event) => {
  const ruleId = event.target.closest('[data-remove-rule]')?.dataset.removeRule;
  if (!ruleId) return;
  settings.appRules = settings.appRules.filter((rule) => rule.id !== ruleId);
  syncSettingsUI();
});

appRules.addEventListener('input', (event) => {
  const ruleId = event.target.dataset.ruleAppName;
  if (!ruleId) return;
  const rule = settings.appRules.find((item) => item.id === ruleId);
  if (!rule) return;
  rule.appName = event.target.value;
});

appRules.addEventListener('change', (event) => {
  const ruleId = event.target.dataset.ruleModeId;
  if (!ruleId) return;
  const rule = settings.appRules.find((item) => item.id === ruleId);
  if (!rule) return;
  rule.modeId = event.target.value;
});

addVocabularyItemButton.addEventListener('click', () => {
  addVocabularyItem();
});

vocabularyList.addEventListener('click', (event) => {
  const vocabularyId = event.target.closest('[data-remove-vocabulary]')?.dataset.removeVocabulary;
  if (!vocabularyId) return;
  settings.vocabularyReplacements = settings.vocabularyReplacements.filter((item) => item.id !== vocabularyId);
  syncSettingsUI();
});

vocabularyList.addEventListener('input', (event) => {
  const fromId = event.target.dataset.vocabularyFrom;
  const toId = event.target.dataset.vocabularyTo;
  const item = settings.vocabularyReplacements.find((entry) => entry.id === fromId || entry.id === toId);
  if (!item) return;

  if (fromId) item.from = event.target.value;
  if (toId) item.to = event.target.value;
});

saveSettingsButton.addEventListener('click', () => {
  persistSettings().catch((err) => {
    console.error(err);
    handleSaveError(err);
  });
});

settingsDoneButton.addEventListener('click', () => {
  closeSettings();
  transitionTo('idle');
});

settingsNavButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setActiveSettingsSection(button.dataset.settingsSection);
  });
});

modeList.addEventListener('click', (event) => {
  const modeId = event.target.closest('[data-mode-id]')?.dataset.modeId;
  if (!modeId) return;
  selectedModeId = modeId;
  syncSettingsUI();
});

menuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (menuOpen) {
    closeContextMenu();
    return;
  }

  const rect = menuButton.getBoundingClientRect();
  openContextMenu(rect.right - 176, rect.bottom + 8);
});

contextMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  if (!action) return;

  closeContextMenu();
  if (action === 'settings') {
    openSettings({ section: 'modes' });
  }
  if (action === 'api-key') {
    openSettings({
      focusApiKey: true,
      section: 'models',
      hintText: 'Cloud mode needs an NVIDIA API key. Paste it here, then click Save.',
    });
  }
});

hud.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY);
});

hud.addEventListener('click', (event) => {
  if (currentState !== 'error') return;
  if (event.target.closest('button, input, select, textarea, a, label')) return;
  if (errorAction) {
    errorAction();
  }
});

if (!isSettingsWindow) {
  hudRow.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a, label')) return;
    appWindow.startDragging().catch(console.error);
  });

  settingsHeader.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a, label')) return;
    appWindow.startDragging().catch(console.error);
  });
}

document.addEventListener('click', (event) => {
  if (!menuOpen) return;
  if (!contextMenu.contains(event.target) && event.target !== menuButton) {
    closeContextMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (appWindow.label === 'settings') {
      event.preventDefault();
      invoke('hide_settings_window').catch(console.error);
      return;
    }
    const action = getEscapeAction({ currentState, settingsOpen });
    if (action === 'hide-processing') {
      hideWindowOnly();
      return;
    }
  }

  if (appWindow.label !== 'settings') return;

  if (event.key === 'Enter' && (event.target === apiKeyInput || event.target === providerSelect)) {
    persistSettings().catch((err) => {
      console.error(err);
      handleSaveError(err);
    });
  }
});

listen('global-shortcut-pressed', () => {
  if (appWindow.label !== 'main') return;
  handleShortcutTrigger().catch(console.error);
});

listen('open-settings', () => {
  if (appWindow.label === 'settings') {
    appWindow.show().catch(console.error);
    appWindow.focus().catch(console.error);
    return;
  }
  const needsApiKey = isCloud() && !settings.nvidiaApiKey.trim();
  openSettings({
    section: needsApiKey ? 'models' : 'modes',
    focusApiKey: needsApiKey,
    hintText: needsApiKey
      ? 'Cloud mode needs an NVIDIA API key. Paste it here, then click Save.'
      : null,
  });
});

listen('hud-state', (event) => {
  if (appWindow.label !== 'main') return;
  const payload = event.payload;
  if (payload?.waveformMode) {
    setWaveformMode(payload.waveformMode);
  }
  if (payload?.state === 'pasting' && currentState === 'processing') {
    transitionTo('pasting');
  }
});

listen('focus-settings-section', (event) => {
  if (appWindow.label !== 'settings') return;
  const { focusApiKey, section, hintText } = event.payload;
  openSettings({ focusApiKey, section, hintText });
});

listen('settings-changed', (event) => {
  settings = normalizeSettingsConfig(event.payload);
  selectedModeId = settings.defaultModeId;
  syncSettingsUI();
});

let sandboxIsRecording = false;

async function handleSandboxRecord() {
  if (!sandboxRecordBtn) return;
  
  if (sandboxIsRecording) {
    sandboxIsRecording = false;
    sandboxRecordBtn.textContent = 'Click to Speak';
    sandboxRecordStatus.textContent = 'Processing transcription...';
    sandboxRecordBtn.disabled = true;
    
    try {
      const wavBytes = await recorder.stop();
      if (wavBytes.length === 0) {
        sandboxRecordStatus.textContent = 'Ready';
        sandboxRecordBtn.disabled = false;
        return;
      }
      
      const startTime = performance.now();
      const text = await invoke('transcribe_audio', { audioBytes: Array.from(wavBytes) });
      const latencyMs = Math.round(performance.now() - startTime);
      
      if (settings.autoPurge) {
        wavBytes.fill(0);
      }
      
      if (!text || !text.trim()) {
        sandboxRecordStatus.textContent = 'No speech detected';
      } else {
        sandboxInput.value = text;
        sandboxLatency.textContent = `${latencyMs} ms`;
        sandboxCharCount.textContent = `${text.length}`;
        sandboxRecordStatus.textContent = 'Ready';
      }
    } catch (err) {
      console.error(err);
      sandboxRecordStatus.textContent = 'Error transcribing';
    } finally {
      sandboxRecordBtn.disabled = false;
    }
  } else {
    sandboxIsRecording = true;
    sandboxRecordBtn.textContent = 'Stop Speaking';
    sandboxRecordStatus.textContent = 'Recording (speak now)...';
    if (sandboxInput) sandboxInput.value = '';
    if (sandboxLatency) sandboxLatency.textContent = '----';
    if (sandboxCharCount) sandboxCharCount.textContent = '----';
    
    try {
      await recorder.start(
        null,
        (level) => {
          sandboxRecordStatus.textContent = `Recording (${Math.round(level * 100)}% volume)...`;
        }
      );
    } catch (err) {
      console.error(err);
      sandboxRecordStatus.textContent = 'Microphone permission error';
      sandboxIsRecording = false;
      sandboxRecordBtn.textContent = 'Click to Speak';
    }
  }
}

if (isSettingsWindow) {
  if (sandboxRecordBtn) {
    sandboxRecordBtn.addEventListener('click', () => {
      handleSandboxRecord().catch(console.error);
    });
  }

  if (finishOnboardingBtn) {
    finishOnboardingBtn.addEventListener('click', () => {
      settings.firstRun = false;
      persistSettings().catch((err) => {
        console.error(err);
        handleSaveError(err);
      });
    });
  }

  listen('sandbox-text-result', (event) => {
    const { text, latencyMs } = event.payload;
    if (sandboxInput) {
      sandboxInput.value = text;
      sandboxLatency.textContent = `${latencyMs} ms`;
      sandboxCharCount.textContent = `${text.length}`;
    }
  });
}

appWindow.onCloseRequested((event) => {
  if (appWindow.label === 'settings') {
    event.preventDefault();
    invoke('hide_settings_window').catch(console.error);
  }
});

if (appWindow.label === 'main') {
  renderWaveform();
}
applySettingsViewState();
syncWindowVisibility();
loadSettings().catch((err) => {
  console.error(err);
  showError('Settings load failed');
});
