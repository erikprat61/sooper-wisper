export const BUILT_IN_MODES = [
  {
    id: 'note',
    name: 'Note',
    builtIn: true,
    prompt: 'Turn rough dictation into a clean note with light formatting.',
    context: { selection: false, clipboard: false, application: false },
    examples: [],
  },
  {
    id: 'email',
    name: 'Email',
    builtIn: true,
    prompt: 'Rewrite the transcript as a concise professional email.',
    context: { selection: false, clipboard: false, application: true },
    examples: [],
  },
  {
    id: 'message',
    name: 'Message',
    builtIn: true,
    prompt: 'Rewrite the transcript as a short friendly message ready to send.',
    context: { selection: false, clipboard: false, application: true },
    examples: [],
  },
];

export function makeId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneBuiltInModes() {
  return BUILT_IN_MODES.map((mode) => ({
    ...mode,
    context: { ...mode.context },
    examples: mode.examples.map((example) => ({ ...example })),
  }));
}

function normalizeExample(example, index) {
  return {
    id: example?.id || makeId(`example-${index}`),
    userInputRaw: `${example?.userInputRaw || ''}`.trim(),
    expectedOutputFormatted: `${example?.expectedOutputFormatted || ''}`.trim(),
  };
}

function normalizeMode(mode, index) {
  const fallback = BUILT_IN_MODES[index] || BUILT_IN_MODES[0];
  const builtIn = Boolean(mode?.builtIn || BUILT_IN_MODES.some((item) => item.id === mode?.id));

  return {
    id: `${mode?.id || fallback.id || makeId('mode')}`.trim() || makeId('mode'),
    name: `${mode?.name || fallback.name || 'Custom Mode'}`.trim() || 'Custom Mode',
    builtIn,
    prompt: `${mode?.prompt || fallback.prompt || ''}`.trim(),
    context: {
      selection: Boolean(mode?.context?.selection || fallback.context.selection),
      clipboard: Boolean(mode?.context?.clipboard || fallback.context.clipboard),
      application: Boolean(mode?.context?.application || fallback.context.application),
    },
    examples: (Array.isArray(mode?.examples) ? mode.examples : [])
      .map(normalizeExample)
      .filter((example) => example.userInputRaw || example.expectedOutputFormatted),
  };
}

function mergeModes(modes = []) {
  const normalized = Array.isArray(modes) ? modes.map(normalizeMode) : [];
  const byId = new Map(normalized.map((mode) => [mode.id, mode]));

  const builtIns = cloneBuiltInModes().map((base, index) => normalizeMode({ ...base, ...byId.get(base.id) }, index));
  const customs = normalized.filter((mode) => !BUILT_IN_MODES.some((item) => item.id === mode.id));

  return [...builtIns, ...customs];
}

function normalizeVocabularyItem(item, index) {
  return {
    id: item?.id || makeId(`vocab-${index}`),
    from: `${item?.from || ''}`.trim(),
    to: `${item?.to || ''}`.trim(),
  };
}

function normalizeAppRule(rule, index, modeIds, defaultModeId) {
  const modeId = modeIds.has(rule?.modeId) ? rule.modeId : defaultModeId;

  return {
    id: rule?.id || makeId(`rule-${index}`),
    appName: `${rule?.appName || ''}`.trim(),
    modeId,
  };
}

export function normalizeSettingsConfig(config = {}) {
  const modes = mergeModes(config.modes);
  const modeIds = new Set(modes.map((mode) => mode.id));
  const defaultModeId = modeIds.has(config.defaultModeId) ? config.defaultModeId : 'note';

  return {
    provider: config.provider === 'nvidia-parakeet' ? 'nvidia-parakeet' : 'local-whisper',
    nvidiaApiKey: `${config.nvidiaApiKey || ''}`.trim(),
    modes,
    defaultModeId,
    vocabularyReplacements: (Array.isArray(config.vocabularyReplacements) ? config.vocabularyReplacements : [])
      .map(normalizeVocabularyItem)
      .filter((item) => item.from || item.to),
    appRules: (Array.isArray(config.appRules) ? config.appRules : [])
      .map((rule, index) => normalizeAppRule(rule, index, modeIds, defaultModeId))
      .filter((rule) => rule.appName),
  };
}

export function getModeById(config, modeId) {
  return config?.modes?.find((mode) => mode.id === modeId) || config?.modes?.[0] || null;
}

export function buildPromptPreview(mode) {
  if (!mode) return '';

  const lines = [
    `<mode name="${mode.name}">`,
    `  <instructions>${mode.prompt}</instructions>`,
    `  <context selection="${mode.context.selection}" clipboard="${mode.context.clipboard}" application="${mode.context.application}" />`,
  ];

  if (mode.examples.length) {
    lines.push('  <examples>');
    mode.examples.forEach((example) => {
      lines.push(`    <example input="${example.userInputRaw}">${example.expectedOutputFormatted}</example>`);
    });
    lines.push('  </examples>');
  }

  lines.push('</mode>');
  return lines.join('\n');
}
