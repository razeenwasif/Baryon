import { highlightCode } from './reply-renderer.js';

export interface DiffHighlightItem {
  code?: string;
  lang?: string;
}

export interface DiffWorkerMessage {
  id?: number;
  html?: string[];
}

export interface DiffWorkerLike {
  onmessage: ((ev: MessageEvent<DiffWorkerMessage | undefined>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  postMessage: (message: { id: number; items: Array<DiffHighlightItem | null | undefined> }) => void;
  terminate?: () => void;
}

export interface DiffWorkerPoolOptions {
  workerFactory?: () => DiffWorkerLike;
  immediate?: boolean;
}

export interface DiffWorkerPoolHandle {
  highlightBatch: (items?: Array<DiffHighlightItem | null | undefined>) => Promise<string[]>;
  cacheSize: () => number;
  workerCount: () => number;
  consumers: () => number;
  release: () => void;
}

export interface DiffWorkerPoolStats {
  active: boolean;
  consumers: number;
  workers: number;
  cacheSize: number;
}

interface InflightJob {
  resolve: (html: string[]) => void;
  reject: (err: Error) => void;
  worker: DiffWorkerLike;
}

type IdleTimerHandle = ReturnType<typeof setTimeout> & { unref?: () => unknown };

interface DiffWorkerPoolEntry {
  workers: DiffWorkerLike[];
  cache: Map<string, string>;
  consumers: number;
  idleTimer: IdleTimerHandle | undefined;
  highlightBatch: (items?: Array<DiffHighlightItem | null | undefined>) => Promise<string[]>;
  terminate: () => void;
}

const IDLE_TTL_MS = 30_000;
const LRU_MAX = 240;

let shared: DiffWorkerPoolEntry | null = null;
let nextRequestId = 1;

function resolvePoolSize(): number {
  const cores = typeof navigator === 'undefined' ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(4, Math.floor(cores / 2)));
}

function lruGet(cache: Map<string, string>, key: string): string | undefined {
  if (!cache.has(key)) return undefined;
  const val = cache.get(key)!;
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function lruSet(cache: Map<string, string>, key: string, val: string): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  while (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function createPool({ workerFactory }: DiffWorkerPoolOptions = {}): DiffWorkerPoolEntry {
  const size = resolvePoolSize();
  const workers: DiffWorkerLike[] = [];
  const inflight = new Map<number, InflightJob>();
  const cache = new Map<string, string>();
  let rr = 0;

  const canSpawn = typeof workerFactory === 'function' || typeof Worker === 'function';
  if (canSpawn) {
    for (let i = 0; i < size; i++) {
      try {
        const w: DiffWorkerLike = typeof workerFactory === 'function'
          ? workerFactory()
          : new Worker(new URL('./diff-highlight.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = ev => {
          const { id, html } = ev.data || {};
          if (id === undefined) return;
          const job = inflight.get(id);
          if (!job) return;
          inflight.delete(id);
          job.resolve(Array.isArray(html) ? html : []);
        };
        w.onerror = () => {
          for (const [id, job] of inflight.entries()) {
            if (job.worker === w) {
              inflight.delete(id);
              job.reject(new Error('Diff worker error'));
            }
          }
        };
        workers.push(w);
      } catch {
        break;
      }
    }
  }

  return {
    workers,
    cache,
    consumers: 0,
    idleTimer: undefined,
    async highlightBatch(items: Array<DiffHighlightItem | null | undefined> = []): Promise<string[]> {
      const results = new Array<string>(items.length);
      const missingIndices: number[] = [];
      const missingItems: Array<DiffHighlightItem | null | undefined> = [];
      for (let i = 0; i < items.length; i++) {
        const key = `${items[i]?.lang || ''}\u0000${items[i]?.code || ''}`;
        const hit = lruGet(cache, key);
        if (hit !== undefined) {
          results[i] = hit;
        } else {
          missingIndices.push(i);
          missingItems.push(items[i]);
        }
      }
      if (!missingItems.length) return results;

      let computed: string[] | null = null;
      if (workers.length) {
        const w = workers[rr++ % workers.length];
        const reqId = nextRequestId++;
        try {
          computed = await new Promise<string[]>((resolve, reject) => {
            inflight.set(reqId, { resolve, reject, worker: w });
            w.postMessage({ id: reqId, items: missingItems });
          });
        } catch {
          computed = null;
        }
      }
      if (!Array.isArray(computed) || computed.length !== missingItems.length) {
        computed = missingItems.map(item => highlightCode(item?.code || '', item?.lang || '').html);
      }

      missingIndices.forEach((idx, pos) => {
        const val = computed[pos];
        results[idx] = val;
        const item = items[idx];
        lruSet(cache, `${item?.lang || ''}\u0000${item?.code || ''}`, val);
      });
      return results;
    },
    terminate() {
      for (const w of workers) {
        try { w.terminate?.(); } catch {}
      }
      workers.length = 0;
      inflight.clear();
    },
  };
}

/** Acquires a ref-counted handle to the shared Diff Worker Pool (disposing 30s after last release). */
export function acquireDiffWorkerPool(options: DiffWorkerPoolOptions = {}): DiffWorkerPoolHandle {
  const entry = (shared ??= createPool(options));
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
  entry.consumers += 1;
  return {
    highlightBatch: entry.highlightBatch,
    cacheSize: () => entry.cache.size,
    workerCount: () => entry.workers.length,
    consumers: () => entry.consumers,
    release() {
      releaseDiffWorkerPool();
    },
  };
}

export function releaseDiffWorkerPool({ immediate = false }: Pick<DiffWorkerPoolOptions, 'immediate'> = {}): void {
  if (!shared) return;
  shared.consumers = Math.max(0, shared.consumers - 1);
  if (shared.consumers === 0) {
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    if (immediate) {
      shared.terminate();
      shared = null;
      return;
    }
    shared.idleTimer = setTimeout(() => {
      if (shared && shared.consumers === 0) {
        shared.terminate();
        shared = null;
      }
    }, IDLE_TTL_MS) as IdleTimerHandle;
    shared.idleTimer.unref?.();
  }
}

export async function highlightDiffAsync(
  items: Array<DiffHighlightItem | null | undefined> = [],
  options: DiffWorkerPoolOptions = {},
): Promise<string[]> {
  const handle = acquireDiffWorkerPool(options);
  try {
    return await handle.highlightBatch(items);
  } finally {
    releaseDiffWorkerPool(options);
  }
}

export function diffWorkerPoolStats(): DiffWorkerPoolStats {
  return shared
    ? { active: true, consumers: shared.consumers, workers: shared.workers.length, cacheSize: shared.cache.size }
    : { active: false, consumers: 0, workers: 0, cacheSize: 0 };
}
