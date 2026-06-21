import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WAVEFORM_BASE,
  getEscapeAction,
  getHudDomState,
  getStateStatus,
  getWaveBarScale,
  shouldShowHud,
  shouldShowSettingsPanel,
} from '../src/hud-logic.js';

test('HUD visibility only shows active states or settings', () => {
  assert.equal(shouldShowHud({ currentState: 'idle', settingsOpen: false }), false);
  assert.equal(shouldShowHud({ currentState: 'idle', settingsOpen: true }), true);
  assert.equal(shouldShowHud({ currentState: 'recording', settingsOpen: false }), true);
  assert.equal(shouldShowHud({ currentState: 'processing', settingsOpen: false }), true);
  assert.equal(shouldShowHud({ currentState: 'pasting', settingsOpen: false }), true);
  assert.equal(shouldShowHud({ currentState: 'error', settingsOpen: false }), true);
});

test('settings view is visible only when opened', () => {
  assert.equal(shouldShowSettingsPanel(false), false);
  assert.equal(shouldShowSettingsPanel(true), true);
});

test('opening settings from idle keeps the app window visible', () => {
  const domState = getHudDomState({
    currentState: 'idle',
    settingsOpen: true,
    windowHidden: false,
  });

  assert.equal(domState.showHud, true);
  assert.equal(domState.showSettingsPanel, true);
  assert.equal(domState.settingsOpenClass, true);
  assert.equal(domState.windowHiddenClass, false);
  assert.equal(domState.settingsAriaHidden, 'false');
});

test('Escape behavior stays narrow', () => {
  assert.equal(getEscapeAction({ currentState: 'idle', settingsOpen: false }), null);
  assert.equal(getEscapeAction({ currentState: 'processing', settingsOpen: false }), 'hide-processing');
  assert.equal(getEscapeAction({ currentState: 'recording', settingsOpen: true }), 'close-settings');
});

test('status copy matches expected flow states', () => {
  assert.deepEqual(getStateStatus({
    state: 'idle',
    isCloud: false,
    waveformMode: 'mic',
    shortcuts: { dictationShortcut: 'Ctrl+Space' },
  }), {
    text: 'Ready',
    subtext: 'Local mode · Ctrl+Space to dictate',
  });

  assert.deepEqual(getStateStatus({ state: 'recording', isCloud: false, waveformMode: 'mic' }), {
    text: 'Recording',
    subtext: 'Press Option+Space again to stop',
  });

  assert.deepEqual(getStateStatus({ state: 'recording', isCloud: false, waveformMode: 'system' }), {
    text: 'Recording',
    subtext: 'Capturing system audio',
  });

  assert.deepEqual(getStateStatus({ state: 'processing', isCloud: true, waveformMode: 'mic' }), {
    text: 'Processing',
    subtext: 'NVIDIA Parakeet · Escape hides this',
  });

  assert.deepEqual(getStateStatus({ state: 'pasting', isCloud: false, waveformMode: 'mic' }), {
    text: 'Inserted',
    subtext: 'Pasted into the active app',
  });
});

test('waveform stays flat outside recording', () => {
  assert.equal(getWaveBarScale({
    currentState: 'idle',
    waveformMode: 'mic',
    waveformLevel: 1,
    waveformPhase: 0,
    index: 4,
  }), 0.18);
});

test('system waveform uses fixed placeholder bars', () => {
  assert.equal(getWaveBarScale({
    currentState: 'recording',
    waveformMode: 'system',
    waveformLevel: 0.8,
    waveformPhase: 0,
    index: 0,
  }), 0.18);

  assert.equal(getWaveBarScale({
    currentState: 'recording',
    waveformMode: 'system',
    waveformLevel: 0.8,
    waveformPhase: 0,
    index: 1,
  }), 0.24);
});

test('mic waveform grows with live level and stays clamped', () => {
  const quiet = getWaveBarScale({
    currentState: 'recording',
    waveformMode: 'mic',
    waveformLevel: 0.05,
    waveformPhase: 0,
    index: 4,
    waveformBase: WAVEFORM_BASE,
  });

  const loud = getWaveBarScale({
    currentState: 'recording',
    waveformMode: 'mic',
    waveformLevel: 0.9,
    waveformPhase: 0,
    index: 4,
    waveformBase: WAVEFORM_BASE,
  });

  assert.ok(loud > quiet);
  assert.ok(quiet >= 0.12 && quiet <= 1);
  assert.ok(loud >= 0.12 && loud <= 1);
});
