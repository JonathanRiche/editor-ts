import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { DesktopPerfConfig, DesktopPerfEvent, DesktopPerfFields } from '../shared/desktopRpcSchema';

type PerfTraceOptions = {
  userDataPath: string;
};

type PerfTraceRecorder = {
  config: DesktopPerfConfig;
  record: (event: Omit<DesktopPerfEvent, 'sessionId'>) => void;
  stop: () => Promise<void>;
};

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_FRAME_STALL_THRESHOLD_MS = 50;
const DEFAULT_LONG_TASK_THRESHOLD_MS = 50;

const noOpRecorder: PerfTraceRecorder = {
  config: { enabled: false },
  record: () => {},
  stop: async () => {},
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
};

const round = (value: number, precision = 2): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const buildOutputPath = (userDataPath: string, sessionId: string): string => {
  return path.join(userDataPath, 'perf', `trace-${sessionId}.jsonl`);
};

const appendJsonLine = async (filePath: string, event: DesktopPerfEvent): Promise<void> => {
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
};

const captureProcessFields = (
  elapsedMs: number,
  cpuDelta: NodeJS.CpuUsage,
  startedAt: number,
): DesktopPerfFields => {
  const memory = process.memoryUsage();
  const totalCpuMicros = cpuDelta.user + cpuDelta.system;
  const cpuPercentApprox = elapsedMs > 0
    ? round((totalCpuMicros / (elapsedMs * 1000)) * 100, 2)
    : 0;

  return {
    pid: process.pid,
    uptimeSec: round(process.uptime(), 3),
    runtimeMs: round(performance.now(), 3),
    wallTimeMs: round(Date.now() - startedAt, 3),
    cpuUserMicros: cpuDelta.user,
    cpuSystemMicros: cpuDelta.system,
    cpuTotalMicros: totalCpuMicros,
    cpuPercentApprox,
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
};

const isPerfEnabled = (): boolean => {
  return process.env.EDITORTS_DESKTOP_PERF === '1';
};

export const createPerfTraceRecorder = async (
  options: PerfTraceOptions,
): Promise<PerfTraceRecorder> => {
  if (!isPerfEnabled()) {
    return noOpRecorder;
  }

  const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-pid${process.pid}`;
  const outputPath = buildOutputPath(options.userDataPath, sessionId);
  const sampleIntervalMs = parsePositiveInteger(
    process.env.EDITORTS_DESKTOP_PERF_INTERVAL_MS,
    DEFAULT_SAMPLE_INTERVAL_MS,
  );
  const frameStallThresholdMs = parsePositiveInteger(
    process.env.EDITORTS_DESKTOP_PERF_FRAME_STALL_MS,
    DEFAULT_FRAME_STALL_THRESHOLD_MS,
  );
  const longTaskThresholdMs = parsePositiveInteger(
    process.env.EDITORTS_DESKTOP_PERF_LONG_TASK_MS,
    DEFAULT_LONG_TASK_THRESHOLD_MS,
  );
  const config: DesktopPerfConfig = {
    enabled: true,
    sessionId,
    outputPath,
    sampleIntervalMs,
    frameStallThresholdMs,
    longTaskThresholdMs,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const startedAt = Date.now();
  const cpuCount = os.cpus().length;
  let writeQueue = Promise.resolve();
  let previousCpuUsage = process.cpuUsage();
  let previousSampleAt = performance.now();
  let sampleTimer: ReturnType<typeof setInterval> | null = null;

  const enqueueWrite = (event: DesktopPerfEvent): void => {
    writeQueue = writeQueue
      .then(() => appendJsonLine(outputPath, event))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[desktop-perf] failed to write trace event', message);
      });
  };

  const record = (event: Omit<DesktopPerfEvent, 'sessionId'>): void => {
    enqueueWrite({
      ...event,
      sessionId,
    });
  };

  record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'perf-session-start',
    at: Date.now(),
    monotonicMs: performance.now(),
    fields: {
      pid: process.pid,
      cpuCount,
      platform: process.platform,
      arch: process.arch,
      outputPath,
      sampleIntervalMs,
      frameStallThresholdMs,
      longTaskThresholdMs,
    },
  });

  sampleTimer = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - previousSampleAt;
    previousSampleAt = now;
    const cpuDelta = process.cpuUsage(previousCpuUsage);
    previousCpuUsage = process.cpuUsage();
    record({
      origin: 'main',
      kind: 'sample',
      name: 'process',
      at: Date.now(),
      monotonicMs: now,
      fields: captureProcessFields(elapsedMs, cpuDelta, startedAt),
    });
  }, sampleIntervalMs);

  return {
    config,
    record,
    stop: async () => {
      if (sampleTimer !== null) {
        clearInterval(sampleTimer);
      }
      record({
        origin: 'main',
        kind: 'lifecycle',
        name: 'perf-session-stop',
        at: Date.now(),
        monotonicMs: performance.now(),
      });
      await writeQueue;
    },
  };
};
