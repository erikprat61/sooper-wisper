import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptPreview, getModeById, normalizeSettingsConfig } from '../src/settings-logic.js';

test('normalizeSettingsConfig backfills built-ins and default mode', () => {
  const config = normalizeSettingsConfig({});

  assert.equal(config.defaultModeId, 'note');
  assert.deepEqual(config.modes.map((mode) => mode.id), ['note', 'email', 'message']);
  assert.equal(getModeById(config, 'note')?.name, 'Note');
});

test('normalizeSettingsConfig keeps custom modes and filters blank rows', () => {
  const config = normalizeSettingsConfig({
    provider: 'nvidia-parakeet',
    defaultModeId: 'custom-1',
    modes: [{
      id: 'custom-1',
      name: ' Standup ',
      prompt: ' Summarize for Slack ',
      examples: [
        { userInputRaw: ' yesterday I fixed bugs ', expectedOutputFormatted: 'Yesterday: fixed bugs' },
        { userInputRaw: ' ', expectedOutputFormatted: ' ' },
      ],
      context: { selection: true, clipboard: false, application: true },
    }],
    vocabularyReplacements: [
      { from: ' sooper wisper ', to: 'Sooper-Wisper' },
      { from: ' ', to: ' ' },
    ],
    appRules: [
      { appName: ' Slack ', modeId: 'custom-1' },
      { appName: ' ', modeId: 'missing' },
    ],
  });

  const custom = getModeById(config, 'custom-1');
  assert.equal(config.provider, 'nvidia-parakeet');
  assert.equal(config.defaultModeId, 'custom-1');
  assert.equal(custom?.name, 'Standup');
  assert.equal(custom?.examples.length, 1);
  assert.deepEqual(config.vocabularyReplacements, [{
    id: config.vocabularyReplacements[0].id,
    from: 'sooper wisper',
    to: 'Sooper-Wisper',
  }]);
  assert.deepEqual(config.appRules, [{
    id: config.appRules[0].id,
    appName: 'Slack',
    modeId: 'custom-1',
  }]);
});

test('buildPromptPreview includes context and examples', () => {
  const mode = getModeById(normalizeSettingsConfig({
    modes: [{
      id: 'custom-1',
      name: 'Standup',
      prompt: 'Summarize updates',
      context: { selection: true, clipboard: true, application: false },
      examples: [{ userInputRaw: 'did code review', expectedOutputFormatted: 'Completed code review.' }],
    }],
  }), 'custom-1');

  const preview = buildPromptPreview(mode);
  assert.match(preview, /<mode name="Standup">/);
  assert.match(preview, /selection="true" clipboard="true" application="false"/);
  assert.match(preview, /<example input="did code review">Completed code review\.<\/example>/);
});
