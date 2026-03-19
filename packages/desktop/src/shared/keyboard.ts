export const DESKTOP_KEYBOARD_ACTIONS = ['refresh', 'toggleDevTools', 'zoomIn', 'zoomOut', 'zoomReset'] as const;

export type DesktopKeyboardAction = typeof DESKTOP_KEYBOARD_ACTIONS[number];
export type DesktopKeybinds = Record<DesktopKeyboardAction, string[]>;
export type DesktopKeyboardConfig = {
  keybinds: DesktopKeybinds;
};

type ResolvedDesktopKeyboardConfig = DesktopKeyboardConfig & {
  warnings: string[];
};

type KeyboardEventLike = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;

type ParsedAccelerator = {
  alt: boolean;
  ctrl: boolean;
  ctrlOrMeta: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};

type AcceleratorParts = {
  key: string;
  modifiers: string[];
};

const DEFAULT_KEYBINDS: DesktopKeybinds = {
  refresh: ['CommandOrControl+R', 'CommandOrControl+Shift+R', 'F5'],
  toggleDevTools: ['CommandOrControl+Shift+I'],
  zoomIn: ['CommandOrControl+='],
  zoomOut: ['CommandOrControl+-'],
  zoomReset: ['CommandOrControl+0'],
};

const KEY_ALIASES: Record<string, string> = {
  bs: 'backspace',
  cr: 'enter',
  del: 'delete',
  down: 'arrowdown',
  esc: 'escape',
  ins: 'insert',
  left: 'arrowleft',
  minus: '-',
  option: 'alt',
  pgdn: 'pagedown',
  pgup: 'pageup',
  plus: '+',
  equal: '=',
  equals: '=',
  return: 'enter',
  right: 'arrowright',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
};

const KEY_CODE_ALIASES: Record<string, string> = {
  Digit0: '0',
  Equal: '=',
  Minus: '-',
  Numpad0: '0',
  NumpadAdd: '=',
  NumpadSubtract: '-',
};

const ACCELERATOR_KEY_ALIASES: Record<string, string[]> = {
  '=': ['=', 'Equal'],
  '-': ['-', 'Minus'],
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const cloneDefaultDesktopKeybinds = (): DesktopKeybinds => {
  return {
    refresh: [...DEFAULT_KEYBINDS.refresh],
    toggleDevTools: [...DEFAULT_KEYBINDS.toggleDevTools],
    zoomIn: [...DEFAULT_KEYBINDS.zoomIn],
    zoomOut: [...DEFAULT_KEYBINDS.zoomOut],
    zoomReset: [...DEFAULT_KEYBINDS.zoomReset],
  };
};

const dedupeKeybinds = (bindings: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const binding of bindings) {
    const key = binding.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(binding);
  }

  return deduped;
};

const normalizeKeyboardKey = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const lowered = trimmed.toLowerCase();
  const alias = KEY_ALIASES[lowered];
  if (typeof alias === 'string') {
    return alias;
  }

  if (/^f([1-9]|1[0-2])$/.test(lowered)) {
    return lowered;
  }

  if (lowered.length === 1) {
    return lowered;
  }

  return lowered;
};

const normalizeAccelerator = (value: string): string | null => {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  return parts.join('+');
};

const splitAccelerator = (accelerator: string): AcceleratorParts | null => {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  return { key, modifiers };
};

const parseAccelerator = (accelerator: string): ParsedAccelerator | null => {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  const parsed: ParsedAccelerator = {
    alt: false,
    ctrl: false,
    ctrlOrMeta: false,
    key: '',
    meta: false,
    shift: false,
  };

  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === 'commandorcontrol' || token === 'cmdorctrl') {
      parsed.ctrlOrMeta = true;
      continue;
    }
    if (token === 'command' || token === 'cmd') {
      parsed.meta = true;
      continue;
    }
    if (token === 'control' || token === 'ctrl') {
      parsed.ctrl = true;
      continue;
    }
    if (token === 'alt' || token === 'option') {
      parsed.alt = true;
      continue;
    }
    if (token === 'shift') {
      parsed.shift = true;
      continue;
    }
    if (token === 'super' || token === 'meta' || token === 'win') {
      parsed.meta = true;
      continue;
    }

    const normalizedKey = normalizeKeyboardKey(part);
    if (normalizedKey.length === 0 || parsed.key.length > 0) {
      return null;
    }

    parsed.key = normalizedKey;
  }

  return parsed.key.length > 0 ? parsed : null;
};

const resolveKeybindOverride = (
  action: DesktopKeyboardAction,
  rawValue: unknown,
): { override?: string[]; warnings: string[] } => {
  if (typeof rawValue === 'undefined') {
    return { warnings: [] };
  }

  if (rawValue === null) {
    return { override: [], warnings: [] };
  }

  if (typeof rawValue === 'string') {
    const normalized = normalizeAccelerator(rawValue);
    if (normalized === null) {
      return { override: [], warnings: [] };
    }
    return { override: [normalized], warnings: [] };
  }

  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) {
      return { override: [], warnings: [] };
    }

    const normalized = rawValue.flatMap((value) => {
      if (typeof value !== 'string') {
        return [];
      }
      const binding = normalizeAccelerator(value);
      return binding === null ? [] : [binding];
    });

    if (normalized.length === 0) {
      return {
        warnings: [`keybinds.${action} must contain non-empty accelerator strings when provided.`],
      };
    }

    if (normalized.length !== rawValue.length) {
      return {
        override: dedupeKeybinds(normalized),
        warnings: [`keybinds.${action} ignored invalid entries and kept the valid accelerators.`],
      };
    }

    return {
      override: dedupeKeybinds(normalized),
      warnings: [],
    };
  }

  return {
    warnings: [`keybinds.${action} must be a string, string[], null, or omitted.`],
  };
};

export const getDefaultDesktopKeyboardConfig = (): DesktopKeyboardConfig => {
  return {
    keybinds: cloneDefaultDesktopKeybinds(),
  };
};

export const resolveDesktopKeyboardConfig = (config: unknown): ResolvedDesktopKeyboardConfig => {
  const resolved = getDefaultDesktopKeyboardConfig();
  const warnings: string[] = [];

  if (!isRecord(config)) {
    return { ...resolved, warnings };
  }

  const rawKeybinds = config.keybinds;
  if (typeof rawKeybinds === 'undefined') {
    return { ...resolved, warnings };
  }

  if (!isRecord(rawKeybinds)) {
    warnings.push('keybinds must be an object when provided.');
    return { ...resolved, warnings };
  }

  for (const key of Object.keys(rawKeybinds)) {
    if (!DESKTOP_KEYBOARD_ACTIONS.includes(key as DesktopKeyboardAction)) {
      warnings.push(`keybinds.${key} is not a supported desktop shortcut action.`);
    }
  }

  for (const action of DESKTOP_KEYBOARD_ACTIONS) {
    const { override, warnings: actionWarnings } = resolveKeybindOverride(action, rawKeybinds[action]);
    warnings.push(...actionWarnings);
    if (typeof override !== 'undefined') {
      resolved.keybinds[action] = override;
    }
  }

  return { ...resolved, warnings };
};

export const keybindToAccelerator = (binding: string): string | null => {
  return normalizeAccelerator(binding);
};

export const keybindToAccelerators = (binding: string): string[] => {
  const accelerator = normalizeAccelerator(binding);
  if (accelerator === null) {
    return [];
  }

  const parts = splitAccelerator(accelerator);
  if (parts === null) {
    return [];
  }

  const aliases = ACCELERATOR_KEY_ALIASES[parts.key] ?? [parts.key];
  return dedupeKeybinds(
    aliases.map((key) => [...parts.modifiers, key].join('+')),
  );
};

export const matchesDesktopKeybind = (event: KeyboardEventLike, binding: string): boolean => {
  console.log('matchesDesktopKeybind', binding);
  const parsed = parseAccelerator(binding);
  if (parsed === null) {
    return false;
  }

  const candidates = new Set<string>();
  const normalizedEventKey = normalizeKeyboardKey(event.key);
  if (normalizedEventKey.length > 0) {
    candidates.add(normalizedEventKey);
  }

  if (typeof event.code === 'string') {
    const codeAlias = KEY_CODE_ALIASES[event.code];
    if (typeof codeAlias === 'string') {
      candidates.add(codeAlias);
    }
  }

  if (!candidates.has(parsed.key)) {
    return false;
  }

  if (event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) {
    return false;
  }

  if (parsed.ctrlOrMeta) {
    if (!event.ctrlKey && !event.metaKey) {
      return false;
    }
  } else if (event.ctrlKey !== parsed.ctrl || event.metaKey !== parsed.meta) {
    return false;
  }

  return true;
};

export const matchesDesktopActionKeybind = (
  event: KeyboardEventLike,
  keyboard: DesktopKeyboardConfig,
  action: DesktopKeyboardAction,
): boolean => {
  return keyboard.keybinds[action].some((binding) => matchesDesktopKeybind(event, binding));
};
