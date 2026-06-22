import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptPreview, getModeById, normalizeSettingsConfig, getModeForApp, applyVocabularyReplacements, buildUseTimePrompt } from '../src/settings-logic.js';

test('normalizeSettingsConfig backfills built-ins and default mode', () => {
  const config = normalizeSettingsConfig({});

  assert.equal(config.defaultModeId, 'note');
  assert.equal(config.autoPurge, true);
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

test('getModeForApp returns matched mode or default', () => {
  const config = normalizeSettingsConfig({
    defaultModeId: 'note',
    appRules: [
      { appName: 'Slack', modeId: 'message' },
      { appName: 'Mail', modeId: 'email' },
    ],
  });

  assert.equal(getModeForApp(config, 'Slack'), 'message');
  assert.equal(getModeForApp(config, 'slack'), 'message');
  assert.equal(getModeForApp(config, 'Mail'), 'email');
  assert.equal(getModeForApp(config, 'Finder'), 'note');
  assert.equal(getModeForApp(config, null), 'note');
});

test('applyVocabularyReplacements replaces jargon case-insensitively', () => {
  const replacements = [
    { from: 'sooper wisper', to: 'Sooper-Wisper' },
    { from: 'cuda', to: 'CUDA' },
  ];

  const result = applyVocabularyReplacements(
    'I am using sooper wisper and cuda for speech to text.',
    replacements
  );
  assert.equal(result, 'I am using Sooper-Wisper and CUDA for speech to text.');

  assert.equal(applyVocabularyReplacements('', replacements), '');
});

test('buildUseTimePrompt creates correct XML with harvested context', () => {
  const mode = getModeById(normalizeSettingsConfig({
    modes: [{
      id: 'custom-1',
      name: 'Standup',
      prompt: 'Summarize updates',
      context: { selection: true, clipboard: true, application: true },
      examples: [{ userInputRaw: 'did code review', expectedOutputFormatted: 'Completed code review.' }],
    }],
  }), 'custom-1');

  const prompt = buildUseTimePrompt(mode, 'my raw transcript', {
    selection: 'selected code snippet',
    clipboard: 'clipboard content',
    application: 'Slack',
  });

  assert.match(prompt, /<mode name="Standup">/);
  assert.match(prompt, /<instructions>Summarize updates<\/instructions>/);
  assert.match(prompt, /selection="selected code snippet" clipboard="clipboard content" application="Slack"/);
  assert.match(prompt, /<example input="did code review">Completed code review\.<\/example>/);
  assert.match(prompt, /<transcript>\s*my raw transcript\s*<\/transcript>/);
});

test('buildUseTimePrompt does not add XML wrapping for default mode', () => {
  const mode = getModeById(normalizeSettingsConfig({
    modes: [{
      id: 'note',
      name: 'Note',
      prompt: 'Turn rough dictation into a clean note',
      context: { selection: false, clipboard: false, application: false },
    }],
  }), 'note');

  const result = buildUseTimePrompt(mode, 'hello world', {}, true);
  assert.equal(result, 'hello world');
});
