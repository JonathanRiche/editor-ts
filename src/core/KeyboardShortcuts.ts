import type { ShortcutDefinition } from '../types';

type ParsedShortcut = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
  action: () => void | Promise<void>;
};

const normalizeKey = (value: string): string => {
  const lowered = value.toLowerCase();
  if (lowered === ' ') return 'space';
  if (lowered === 'esc') return 'escape';
  return lowered;
};

const parseShortcut = (shortcut: ShortcutDefinition): ParsedShortcut | null => {
  const tokens = shortcut.key
    .split(/[+-]/)
    .map((token: string) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let key: string | null = null;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let mod = false;

  tokens.forEach((token: string) => {
    switch (token) {
      case 'ctrl':
      case 'control':
        ctrl = true;
        return;
      case 'cmd':
      case 'command':
      case 'meta':
        meta = true;
        return;
      case 'alt':
      case 'option':
        alt = true;
        return;
      case 'shift':
        shift = true;
        return;
      case 'mod':
        mod = true;
        return;
      default:
        key = normalizeKey(token);
        return;
    }
  });

  if (!key) return null;

  return {
    key,
    ctrl,
    meta,
    alt,
    shift,
    mod,
    action: shortcut.action,
  };
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

export const createDefaultShortcuts = (handlers: {
  openCommandPalette?: () => void;
}): ShortcutDefinition[] => {
  if (!handlers.openCommandPalette) return [];
  return [
    {
      key: 'mod+p',
      action: handlers.openCommandPalette,
    },
  ];
};

export class KeyboardShortcuts {
  private shortcuts: ParsedShortcut[] = [];
  private shouldIgnore?: (event: KeyboardEvent) => boolean;
  private boundHandler?: (event: KeyboardEvent) => void;
  private target: Document | null = null;

  constructor(options: {
    shortcuts: ShortcutDefinition[];
    shouldIgnore?: (event: KeyboardEvent) => boolean;
  }) {
    this.shortcuts = options.shortcuts
      .map(parseShortcut)
      .filter((shortcut): shortcut is ParsedShortcut => !!shortcut);
    this.shouldIgnore = options.shouldIgnore;
  }

  bind(target: Document = document): void {
    if (this.boundHandler) return;
    this.target = target;

    this.boundHandler = (event: KeyboardEvent) => {
      if (this.shouldIgnore?.(event)) return;

      if (isEditableTarget(event.target) && !event.metaKey && !event.ctrlKey) {
        return;
      }

      const normalizedKey = normalizeKey(event.key);

      for (const shortcut of this.shortcuts) {
        if (shortcut.key !== normalizedKey) continue;

        const modPressed = event.metaKey || event.ctrlKey;
        if (shortcut.mod && !modPressed) continue;
        if (shortcut.ctrl && !event.ctrlKey) continue;
        if (shortcut.meta && !event.metaKey) continue;
        if (shortcut.alt && !event.altKey) continue;
        if (shortcut.shift && !event.shiftKey) continue;

        event.preventDefault();
        const result = shortcut.action();
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>);
        }
        return;
      }
    };

    target.addEventListener('keydown', this.boundHandler);
  }

  unbind(): void {
    if (!this.boundHandler || !this.target) return;
    this.target.removeEventListener('keydown', this.boundHandler);
    this.boundHandler = undefined;
    this.target = null;
  }
}
