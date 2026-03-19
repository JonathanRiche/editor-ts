export const DESKTOP_KEYBOARD_ACTIONS = ['refresh', 'toggleDevTools'] as const;

export type DesktopKeyboardAction = typeof DESKTOP_KEYBOARD_ACTIONS[number];
export type DesktopModKey = 'alt' | 'ctrl' | 'meta' | 'super';
export type DesktopKeybinds = Record<DesktopKeyboardAction, string[]>;
export type DesktopKeyboardConfig = {
  keybinds: DesktopKeybinds;
  modKey: DesktopModKey;
};

type ResolvedDesktopKeyboardConfig = DesktopKeyboardConfig & {
  warnings: string[];
};

type KeyboardEventLike = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;

type ParsedAccelerator = {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};

const DEFAULT_KEYBINDS: DesktopKeybinds = {
  refresh: ['<Mod-r>', '<Mod-S-r>', '<F5>'],
  toggleDevTools: ['<Mod-S-i>'],
};

const KEY_ALIASES: Record<string, string> = {
  bs: 'backspace',
  cr: 'enter',
  del: 'delete',
  down: 'arrowdown',
  esc: 'escape',
  ins: 'insert',
  left: 'arrowleft',
  option: 'alt',
  pgdn: 'pagedown',
  pgup: 'pageup',
  plus: '+',
  return: 'enter',
  right: 'arrowright',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
};

const isMacPlatform = (): boolean => {
  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    return process.platform === 'darwin';
  }

  if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
    return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  return false;
};

const DEFAULT_MOD_KEY: DesktopModKey = isMacPlatform() ? 'meta' : 'ctrl';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const cloneDefaultDesktopKeybinds = (): DesktopKeybinds => {
  return {
    refresh: [...DEFAULT_KEYBINDS.refresh],
    toggleDevTools: [...DEFAULT_KEYBINDS.toggleDevTools],
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

const normalizeLegacyAccelerator = (value: string): string | null => {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  return parts.join('+');
};

const isVimStyleKeybind = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 3;
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

  if (/^f([1-9]|1\d|2[0-4])$/.test(lowered)) {
    return lowered;
  }

  if (lowered.length === 1) {
    return lowered;
  }

  return lowered;
};

const normalizeVimStyleToken = (value: string): string => {
  const normalizedKey = normalizeKeyboardKey(value);
  if (normalizedKey === ' ') {
    return 'Space';
  }
  if (/^f([1-9]|1\d|2[0-4])$/.test(normalizedKey)) {
    return normalizedKey.toUpperCase();
  }
  if (normalizedKey.length === 1) {
    return normalizedKey;
  }

  switch (normalizedKey) {
    case 'arrowup':
      return 'Up';
    case 'arrowdown':
      return 'Down';
    case 'arrowleft':
      return 'Left';
    case 'arrowright':
      return 'Right';
    case 'pagedown':
      return 'PageDown';
    case 'pageup':
      return 'PageUp';
    case 'backspace':
      return 'BS';
    case 'delete':
      return 'Del';
    case 'enter':
      return 'CR';
    case 'escape':
      return 'Esc';
    case 'insert':
      return 'Insert';
    case 'tab':
      return 'Tab';
    default:
      return value.trim();
  }
};

const normalizeModKey = (value: unknown): DesktopModKey | null => {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case 'alt':
    case 'option':
    case 'meta':
    case 'cmd':
    case 'command':
      return value.trim().toLowerCase() === 'alt' || value.trim().toLowerCase() === 'option'
        ? 'alt'
        : 'meta';
    case 'ctrl':
    case 'control':
      return 'ctrl';
    case 'super':
    case 'win':
    case 'windows':
      return 'super';
    case 'default':
    case 'mod':
    case 'primary':
      return DEFAULT_MOD_KEY;
    default:
      return null;
  }
};

const normalizeModifierToken = (value: string): string => {
  return value.trim().toLowerCase();
};

const normalizeVimStyleKeybind = (value: string): string | null => {
  const trimmed = value.trim();
  if (!isVimStyleKeybind(trimmed)) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return null;
  }

  const parts = inner.split('-').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const keyPart = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  const normalizedModifiers: string[] = [];
  const seen = new Set<string>();

  for (const modifier of modifiers) {
    const token = normalizeModifierToken(modifier);
    let normalizedModifier: string | null = null;

    switch (token) {
      case 'c':
      case 'ctrl':
      case 'control':
        normalizedModifier = 'C';
        break;
      case 's':
      case 'shift':
        normalizedModifier = 'S';
        break;
      case 'a':
      case 'alt':
      case 'm':
      case 'option':
        normalizedModifier = 'M';
        break;
      case 'd':
      case 'cmd':
      case 'command':
        normalizedModifier = 'D';
        break;
      case 'super':
      case 'win':
      case 'windows':
        normalizedModifier = 'Super';
        break;
      case 'mod':
        normalizedModifier = 'Mod';
        break;
      default:
        return null;
    }

    if (seen.has(normalizedModifier)) {
      continue;
    }

    seen.add(normalizedModifier);
    normalizedModifiers.push(normalizedModifier);
  }

  const normalizedKey = normalizeVimStyleToken(keyPart);
  if (normalizedKey.length === 0) {
    return null;
  }

  return `<${[...normalizedModifiers, normalizedKey].join('-')}>`;
};

const normalizeKeybind = (value: string): string | null => {
  const vimStyle = normalizeVimStyleKeybind(value);
  if (vimStyle !== null) {
    return vimStyle;
  }

  return normalizeLegacyAccelerator(value);
};

const applyResolvedModKey = (parsed: ParsedAccelerator, modKey: DesktopModKey): void => {
  switch (modKey) {
    case 'alt':
      parsed.alt = true;
      break;
    case 'ctrl':
      parsed.ctrl = true;
      break;
    case 'meta':
    case 'super':
      parsed.meta = true;
      break;
  }
};

const parseVimStyleKeybind = (binding: string, modKey: DesktopModKey): ParsedAccelerator | null => {
  const normalized = normalizeVimStyleKeybind(binding);
  if (normalized === null) {
    return null;
  }

  const parts = normalized.slice(1, -1).split('-');
  const parsed: ParsedAccelerator = {
    alt: false,
    ctrl: false,
    key: '',
    meta: false,
    shift: false,
  };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLast = index === parts.length - 1;

    if (isLast) {
      const normalizedKey = normalizeKeyboardKey(part);
      if (normalizedKey.length === 0) {
        return null;
      }
      parsed.key = normalizedKey;
      continue;
    }

    switch (part) {
      case 'C':
        parsed.ctrl = true;
        break;
      case 'S':
        parsed.shift = true;
        break;
      case 'M':
        parsed.alt = true;
        break;
      case 'D':
      case 'Super':
        parsed.meta = true;
        break;
      case 'Mod':
        applyResolvedModKey(parsed, modKey);
        break;
      default:
        return null;
    }
  }

  return parsed.key.length > 0 ? parsed : null;
};

const parseLegacyAccelerator = (accelerator: string): ParsedAccelerator | null => {
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
    key: '',
    meta: false,
    shift: false,
  };

  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === 'commandorcontrol' || token === 'cmdorctrl') {
      applyResolvedModKey(parsed, DEFAULT_MOD_KEY);
      continue;
    }
    if (token === 'control' || token === 'ctrl') {
      parsed.ctrl = true;
      continue;
    }
    if (token === 'command' || token === 'cmd' || token === 'meta' || token === 'super') {
      parsed.meta = true;
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

    const normalizedKey = normalizeKeyboardKey(part);
    if (normalizedKey.length === 0 || parsed.key.length > 0) {
      return null;
    }
    parsed.key = normalizedKey;
  }

  return parsed.key.length > 0 ? parsed : null;
};

const parseKeybind = (binding: string, modKey: DesktopModKey): ParsedAccelerator | null => {
  return parseVimStyleKeybind(binding, modKey) ?? parseLegacyAccelerator(binding);
};

const toAcceleratorMetaModifier = (): string => {
  return isMacPlatform() ? 'Command' : 'Super';
};

const toAcceleratorKey = (value: string): string | null => {
  switch (value) {
    case ' ':
      return 'Space';
    case 'arrowup':
      return 'Up';
    case 'arrowdown':
      return 'Down';
    case 'arrowleft':
      return 'Left';
    case 'arrowright':
      return 'Right';
    case 'pagedown':
      return 'PageDown';
    case 'pageup':
      return 'PageUp';
    case 'backspace':
      return 'Backspace';
    case 'delete':
      return 'Delete';
    case 'enter':
      return 'Enter';
    case 'escape':
      return 'Escape';
    case 'insert':
      return 'Insert';
    case 'tab':
      return 'Tab';
    default:
      if (/^f([1-9]|1\d|2[0-4])$/.test(value)) {
        return value.toUpperCase();
      }
      return value.length > 0 ? value.toUpperCase() : null;
  }
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
    const normalized = normalizeKeybind(rawValue);
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
      const binding = normalizeKeybind(value);
      return binding === null ? [] : [binding];
    });

    if (normalized.length === 0) {
      return {
        warnings: [`keybinds.${action} must contain non-empty keybind strings when provided.`],
      };
    }

    if (normalized.length !== rawValue.length) {
      return {
        override: dedupeKeybinds(normalized),
        warnings: [`keybinds.${action} ignored invalid entries and kept the valid keybinds.`],
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
    modKey: DEFAULT_MOD_KEY,
  };
};

export const getDefaultDesktopKeybinds = (): DesktopKeybinds => {
  return getDefaultDesktopKeyboardConfig().keybinds;
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

  const rawModKey = rawKeybinds.modKey;
  if (typeof rawModKey !== 'undefined') {
    const normalizedModKey = normalizeModKey(rawModKey);
    if (normalizedModKey === null) {
      warnings.push('keybinds.modKey must be one of: ctrl, cmd, alt, super, or default.');
    } else {
      resolved.modKey = normalizedModKey;
    }
  }

  for (const key of Object.keys(rawKeybinds)) {
    if (key === 'modKey') {
      continue;
    }
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

export const keybindToAccelerator = (binding: string, modKey: DesktopModKey): string | null => {
  if (!isVimStyleKeybind(binding)) {
    return normalizeLegacyAccelerator(binding);
  }

  const parsed = parseVimStyleKeybind(binding, modKey);
  if (parsed === null) {
    return null;
  }

  const parts: string[] = [];
  if (parsed.ctrl) {
    parts.push('Control');
  }
  if (parsed.meta) {
    parts.push(toAcceleratorMetaModifier());
  }
  if (parsed.alt) {
    parts.push('Alt');
  }
  if (parsed.shift) {
    parts.push('Shift');
  }

  const key = toAcceleratorKey(parsed.key);
  if (key === null) {
    return null;
  }

  parts.push(key);
  return parts.join('+');
};

export const matchesDesktopKeybind = (
  event: KeyboardEventLike,
  binding: string,
  modKey: DesktopModKey,
): boolean => {
  const parsed = parseKeybind(binding, modKey);
  if (parsed === null) {
    return false;
  }

  if (normalizeKeyboardKey(event.key) !== parsed.key) {
    return false;
  }

  if (event.altKey !== parsed.alt || event.ctrlKey !== parsed.ctrl || event.metaKey !== parsed.meta || event.shiftKey !== parsed.shift) {
    return false;
  }

  return true;
};

export const matchesDesktopActionKeybind = (
  event: KeyboardEventLike,
  keyboard: DesktopKeyboardConfig,
  action: DesktopKeyboardAction,
): boolean => {
  return keyboard.keybinds[action].some((binding) => matchesDesktopKeybind(event, binding, keyboard.modKey));
};
