import type { ShortcutDefinition } from '../types';

export type ShortcutAction = () => void | Promise<void>;

export type ShortcutContext = {
  openCommandPalette: () => void;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  deleteSelected: () => void | Promise<void>;
};

type ParsedShortcut = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
  action: () => void | Promise<void>;
};

type ModKey = 'ctrl' | 'meta' | 'alt';

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

export const createDefaultShortcuts = (handlers: Partial<ShortcutContext>): ShortcutDefinition[] => {
  const shortcuts: ShortcutDefinition[] = [];

  if (handlers.openCommandPalette) {
    shortcuts.push({ key: 'mod+p', action: handlers.openCommandPalette });
  }

  if (handlers.undo) {
    shortcuts.push({ key: 'mod+z', action: handlers.undo });
  }

  if (handlers.redo) {
    shortcuts.push({ key: 'mod+r', action: handlers.redo });
  }

  if (handlers.deleteSelected) {
    shortcuts.push({ key: 'delete', action: handlers.deleteSelected });
    shortcuts.push({ key: 'backspace', action: handlers.deleteSelected });
  }

  return shortcuts;
};

export const createCommandPaletteShortcuts = (handlers: Pick<ShortcutContext, 'openCommandPalette'>): ShortcutDefinition[] => {
  return [{ key: 'mod+p', action: handlers.openCommandPalette }];
};

export const createEditorShortcuts = (handlers: Omit<ShortcutContext, 'openCommandPalette'>): ShortcutDefinition[] => {
  const shortcuts: ShortcutDefinition[] = [];

  if (handlers.undo) {
    shortcuts.push({ key: 'mod+z', action: handlers.undo });
  }

  if (handlers.redo) {
    shortcuts.push({ key: 'mod+r', action: handlers.redo });
  }

  if (handlers.deleteSelected) {
    shortcuts.push({ key: 'delete', action: handlers.deleteSelected });
    shortcuts.push({ key: 'backspace', action: handlers.deleteSelected });
  }

  return shortcuts;
};

export class KeyboardShortcuts {
  private shortcuts: ParsedShortcut[] = [];
  private shouldIgnore?: (event: KeyboardEvent) => boolean;
  private boundHandler?: (event: KeyboardEvent) => void;
  private targets = new Set<Document>();
  private modKey: ModKey;

  constructor(options: {
    shortcuts: ShortcutDefinition[];
    shouldIgnore?: (event: KeyboardEvent) => boolean;
    modKey?: ModKey;
  }) {
    this.shortcuts = options.shortcuts
      .map(parseShortcut)
      .filter((shortcut): shortcut is ParsedShortcut => !!shortcut);
    this.shouldIgnore = options.shouldIgnore;
    this.modKey = options.modKey ?? 'ctrl';
  }


  bind(target: Document = document): void {
    if (this.targets.has(target)) return;

    if (!this.boundHandler) {
      this.boundHandler = (event: KeyboardEvent) => {
        if (this.shouldIgnore?.(event)) return;

        if (isEditableTarget(event.target) && !event.metaKey && !event.ctrlKey) {
          return;
        }

        const normalizedKey = normalizeKey(event.key);

        for (const shortcut of this.shortcuts) {
          if (shortcut.key !== normalizedKey) continue;

          const modPressed = this.modKey === 'meta'
            ? event.metaKey
            : this.modKey === 'alt'
              ? event.altKey
              : event.ctrlKey;
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
    }

    this.targets.add(target);
    (target as Document & { __editortsShortcutsBound?: boolean }).__editortsShortcutsBound = true;
    target.addEventListener('keydown', this.boundHandler);
  }

  unbind(target?: Document): void {
    if (!this.boundHandler) return;

    if (target) {
      if (this.targets.has(target)) {
        target.removeEventListener('keydown', this.boundHandler);
        this.targets.delete(target);
      }
    } else {
      this.targets.forEach((doc) => {
        doc.removeEventListener('keydown', this.boundHandler!);
      });
      this.targets.clear();
    }

    if (this.targets.size === 0) {
      this.boundHandler = undefined;
    }
  }
}
