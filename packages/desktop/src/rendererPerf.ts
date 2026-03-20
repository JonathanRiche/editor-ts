import { sendRendererPerfEvent } from './desktopNativeRpc';
import type { DesktopPerfEvent, DesktopPerfFields } from './shared/desktopRpcSchema';

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
};

const round = (value: number, precision = 2): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const getPerfConfig = () => {
  return window.__EDITORTS_DESKTOP__?.perf;
};

export const isRendererPerfEnabled = (): boolean => {
  return getPerfConfig()?.enabled === true;
};

export const recordRendererPerf = (
  kind: DesktopPerfEvent['kind'],
  name: string,
  fields?: DesktopPerfFields,
  monotonicMs?: number,
): void => {
  if (!isRendererPerfEnabled()) {
    return;
  }

  void sendRendererPerfEvent({
    origin: 'renderer',
    kind,
    name,
    at: Date.now(),
    monotonicMs: typeof monotonicMs === 'number' ? round(monotonicMs, 3) : round(performance.now(), 3),
    fields,
  });
};

export const measureRendererAsync = async <T>(
  name: string,
  operation: () => Promise<T>,
  fields?: DesktopPerfFields,
): Promise<T> => {
  const startedAt = performance.now();
  recordRendererPerf('mark', `${name}:start`, fields, startedAt);

  try {
    const result = await operation();
    recordRendererPerf('measure', name, {
      ...fields,
      durationMs: round(performance.now() - startedAt, 3),
      ok: true,
    });
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    recordRendererPerf('measure', name, {
      ...fields,
      durationMs: round(performance.now() - startedAt, 3),
      ok: false,
      error: message,
    });
    throw error;
  }
};

const sampleRendererState = (): void => {
  const perf = performance as PerformanceWithMemory;
  const memory = perf.memory;
  recordRendererPerf('sample', 'renderer-state', {
    usedJSHeapSize: memory?.usedJSHeapSize ?? null,
    totalJSHeapSize: memory?.totalJSHeapSize ?? null,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
    visible: document.visibilityState === 'visible',
  });
};

const installLongTaskObserver = (): (() => void) | null => {
  if (typeof PerformanceObserver === 'undefined') {
    return null;
  }

  const threshold = getPerfConfig()?.longTaskThresholdMs ?? 50;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < threshold) {
          continue;
        }

        recordRendererPerf('longtask', entry.name || 'longtask', {
          durationMs: round(entry.duration, 3),
          startTimeMs: round(entry.startTime, 3),
        }, entry.startTime + entry.duration);
      }
    });

    observer.observe({ entryTypes: ['longtask'] });
    return () => observer.disconnect();
  } catch {
    return null;
  }
};

const installFrameStallObserver = (): (() => void) => {
  const threshold = getPerfConfig()?.frameStallThresholdMs ?? 50;
  let rafId = 0;
  let lastFrameAt = performance.now();

  const tick = (now: number) => {
    const delta = now - lastFrameAt;
    if (delta >= threshold) {
      recordRendererPerf('frame-stall', 'requestAnimationFrame-gap', {
        deltaMs: round(delta, 3),
      }, now);
    }

    lastFrameAt = now;
    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);
  return () => window.cancelAnimationFrame(rafId);
};

export const installRendererPerfTracing = (): void => {
  if (!isRendererPerfEnabled()) {
    return;
  }

  const config = getPerfConfig();
  recordRendererPerf('lifecycle', 'renderer-perf-ready', {
    sampleIntervalMs: config?.sampleIntervalMs ?? null,
    outputPath: config?.outputPath ?? null,
  });

  const navigationEntry = performance.getEntriesByType('navigation')[0];
  if (navigationEntry) {
    recordRendererPerf('measure', 'renderer-navigation', {
      entryType: navigationEntry.entryType,
      durationMs: round(navigationEntry.duration, 3),
      startTimeMs: round(navigationEntry.startTime, 3),
    });
  }

  sampleRendererState();
  const stopLongTasks = installLongTaskObserver();
  const stopFrameStalls = installFrameStallObserver();
  const intervalMs = getPerfConfig()?.sampleIntervalMs ?? 1000;
  const intervalId = window.setInterval(sampleRendererState, intervalMs);

  window.addEventListener('beforeunload', () => {
    window.clearInterval(intervalId);
    stopLongTasks?.();
    stopFrameStalls();
    recordRendererPerf('lifecycle', 'renderer-beforeunload');
  }, { once: true });
};
