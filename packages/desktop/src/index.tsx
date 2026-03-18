import { render } from 'solid-js/web';
import App from './App';
import { isNativeDesktopRuntime, sendRendererLog, toggleNativeDesktopDevTools } from './desktopNativeRpc';
import './styles.css';

const isDesktopAiDebugEnabled = (): boolean => {
  return window.__EDITORTS_DESKTOP__?.debugAi === true;
};

const formatConsoleArgument = (value: unknown): { text: string; stack?: string } => {
  if (value instanceof Error) {
    return {
      text: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'string') {
    return { text: value };
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || typeof value === 'undefined') {
    return { text: String(value) };
  }

  try {
    return { text: JSON.stringify(value) };
  } catch {
    return { text: String(value) };
  }
};

const applyDesktopUiScale = (): void => {
  const scale = window.__EDITORTS_DESKTOP__?.uiScale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale === 1) {
    return;
  }

  document.documentElement.style.setProperty('--desktop-ui-scale', String(scale));
  document.documentElement.dataset.desktopRuntime = 'electrobun';

  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  root.style.setProperty('--desktop-ui-scale-inverse', String(1 / scale));
  root.dataset.desktopScaled = 'true';
};

applyDesktopUiScale();

const installDesktopConsoleForwarding = (): void => {
  if (!isNativeDesktopRuntime() || !isDesktopAiDebugEnabled()) {
    return;
  }

  const originalInfo = console.info.bind(console);
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const forward = (level: 'info' | 'warn' | 'error', args: unknown[]) => {
    const formatted = args.map(formatConsoleArgument);
    const message = formatted.map((entry) => entry.text).join(' ');
    const stack = formatted.find((entry) => typeof entry.stack === 'string')?.stack;
    void sendRendererLog({
      level,
      source: 'console',
      message,
      stack,
    });
  };

  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    forward('info', args);
  };

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    forward('info', args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    forward('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    forward('error', args);
  };
};

installDesktopConsoleForwarding();

const installDesktopErrorLogging = (): void => {
  if (!isNativeDesktopRuntime()) {
    return;
  }

  window.addEventListener('error', (event) => {
    const message = event.error instanceof Error
      ? event.error.message
      : event.message || 'Unknown renderer error';
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    void sendRendererLog({
      level: 'error',
      source: 'window.onerror',
      message,
      stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    void sendRendererLog({
      level: 'error',
      source: 'unhandledrejection',
      message,
      stack,
    });
  });
};

installDesktopErrorLogging();

const installDesktopReloadShortcut = (): void => {
  if (!isNativeDesktopRuntime()) {
    return;
  }

  let pendingReloadTimer: number | null = null;
  const scheduleReload = () => {
    if (pendingReloadTimer !== null) {
      window.clearTimeout(pendingReloadTimer);
    }

    pendingReloadTimer = window.setTimeout(() => {
      pendingReloadTimer = null;
      window.location.reload();
    }, 140);
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const wantsReload = key === 'f5' || (key === 'r' && (event.ctrlKey || event.metaKey));
    const wantsDevTools = key === 'i' && (event.ctrlKey || event.metaKey) && event.shiftKey;
    if (wantsDevTools) {
      event.preventDefault();
      event.stopPropagation();
      void toggleNativeDesktopDevTools();
      return;
    }
    if (!wantsReload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    scheduleReload();
  }, { capture: true });
};

installDesktopReloadShortcut();

const root = document.getElementById('app');

if (root) {
  try {
    render(() => <App />, root);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[desktop-renderer:error] render', message, stack ?? '');
    void sendRendererLog({
      level: 'error',
      source: 'render',
      message,
      stack,
    });
    throw error;
  }
} else {
  console.error('[desktop-renderer:error] render root #app not found');
  void sendRendererLog({
    level: 'error',
    source: 'render',
    message: 'Renderer root #app not found',
  });
}
