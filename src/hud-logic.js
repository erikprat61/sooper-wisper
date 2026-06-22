export const WAVEFORM_BASE = [0.24, 0.36, 0.56, 0.82, 1, 0.82, 0.56, 0.36, 0.24];

const VISIBLE_STATES = new Set(['recording', 'processing', 'pasting', 'error']);

export function shouldShowHud({ currentState, settingsOpen }) {
  return Boolean(settingsOpen) || VISIBLE_STATES.has(currentState);
}

export function shouldShowSettingsPanel(settingsOpen) {
  return Boolean(settingsOpen);
}

export function getHudDomState({ currentState, settingsOpen, windowHidden }) {
  return {
    showHud: shouldShowHud({ currentState, settingsOpen }),
    showSettingsPanel: shouldShowSettingsPanel(settingsOpen),
    settingsOpenClass: shouldShowSettingsPanel(settingsOpen),
    windowHiddenClass: Boolean(windowHidden),
    settingsAriaHidden: String(!shouldShowSettingsPanel(settingsOpen)),
  };
}

export function getEscapeAction({ currentState, settingsOpen }) {
  if (settingsOpen) return 'close-settings';
  if (currentState === 'processing') return 'hide-processing';
  return null;
}

export function getStateStatus({ state, isCloud, waveformMode, shortcuts, activeModeName }) {
  const dictationShortcut = shortcuts?.dictationShortcut || 'Option+Space';

  switch (state) {
    case 'idle':
      return {
        text: 'Ready',
        subtext: `${isCloud ? 'Cloud' : 'Local'} mode · ${dictationShortcut} to dictate`,
      };
    case 'recording': {
      const modeSuffix = activeModeName ? ` (${activeModeName})` : '';
      return {
        text: `Recording${modeSuffix}`,
        subtext: waveformMode === 'system'
          ? 'Capturing system audio'
          : 'Press Option+Space again to stop',
      };
    }
    case 'processing':
      return {
        text: 'Processing',
        subtext: isCloud
          ? 'NVIDIA Parakeet · Escape hides this'
          : 'Local Whisper · Escape hides this',
      };
    case 'pasting':
      return {
        text: 'Inserted',
        subtext: 'Pasted into the active app',
      };
    default:
      return null;
  }
}

export function getWaveBarScale({
  currentState,
  waveformMode,
  waveformLevel,
  waveformPhase,
  index,
  waveformBase = WAVEFORM_BASE,
}) {
  if (currentState !== 'recording') {
    return 0.18;
  }

  if (waveformMode === 'system') {
    return index % 2 === 0 ? 0.18 : 0.24;
  }

  const pulse = Math.sin(waveformPhase + index * 0.72) * 0.18;
  const live = waveformBase[index] * (0.28 + waveformLevel * 1.45);
  return Math.max(0.12, Math.min(1, live + pulse));
}
