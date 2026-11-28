export interface EventLoopStallEvent {
  lagMs: number;
}

export interface EventLoopSleepGapEvent {
  gapMs: number;
}

export interface EventLoopSampleResult {
  kind: 'sleep-gap' | 'stall' | 'ok';
  lagMs: number;
}

export interface EventLoopStats {
  running: boolean;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  stallCount: number;
  sleepGaps: number;
}

export interface EventLoopMonitor {
  start: () => void;
  stop: () => void;
  sampleOnce: (overrideLagMs?: number | null) => EventLoopSampleResult;
  stats: () => EventLoopStats;
}

type TimerHandle = ReturnType<typeof setInterval>;

export interface EventLoopMonitorOptions {
  intervalMs?: number;
  stallMs?: number;
  sleepGapMs?: number;
  windowSize?: number;
  onStall?: (event: EventLoopStallEvent) => void;
  onSleepGap?: (event: EventLoopSleepGapEvent) => void;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => TimerHandle;
  clear?: (timer: TimerHandle) => void;
}

/**
 * Sleep-aware event-loop lag monitor that separates real main-thread stalls from OS sleep/wake clock jumps.
 */
export function createEventLoopMonitor({
  intervalMs = 500,
  stallMs = 1500,
  sleepGapMs = 15_000,
  windowSize = 120,
  onStall = () => {},
  onSleepGap = () => {},
  now = Date.now,
  schedule = setInterval,
  clear = clearInterval,
}: EventLoopMonitorOptions = {}): EventLoopMonitor {
  const lags: number[] = [];
  let timer: TimerHandle | null = null;
  let lastTick = now();
  let stallCount = 0;
  let sleepGaps = 0;
  let maxMs = 0;

  function recordLag(lagMs: number): EventLoopSampleResult {
    const clean = Math.max(0, Math.round(lagMs));
    if (clean >= sleepGapMs) {
      sleepGaps += 1;
      onSleepGap({ gapMs: clean });
      return { kind: 'sleep-gap', lagMs: clean };
    }
    lags.push(clean);
    if (lags.length > windowSize) lags.shift();
    if (clean > maxMs) maxMs = clean;
    if (clean >= stallMs) {
      stallCount += 1;
      onStall({ lagMs: clean });
      return { kind: 'stall', lagMs: clean };
    }
    return { kind: 'ok', lagMs: clean };
  }

  function sampleOnce(overrideLagMs: number | null = null): EventLoopSampleResult {
    if (typeof overrideLagMs === 'number' && Number.isFinite(overrideLagMs)) {
      lastTick = now();
      return recordLag(overrideLagMs);
    }
    const cur = now();
    const lag = cur - lastTick - intervalMs;
    lastTick = cur;
    return recordLag(lag);
  }

  function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  return {
    start() {
      if (timer !== null) return;
      lastTick = now();
      timer = schedule(() => { sampleOnce(); }, intervalMs);
      timer?.unref?.();
    },
    stop() {
      if (timer !== null) {
        clear(timer);
        timer = null;
      }
    },
    sampleOnce,
    stats() {
      const sorted = [...lags].sort((a, b) => a - b);
      return {
        running: timer !== null,
        samples: lags.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs,
        stallCount,
        sleepGaps,
      };
    },
  };
}
