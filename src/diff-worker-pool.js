import { highlightCode } from './reply-renderer.js';

const IDLE_TTL_MS = 30_000;
const LRU_MAX = 240;

let shared = null;
let nextRequestId = 1;

function resolvePoolSize() {
  const cores = typeof navigator === 'undefined' ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(4, Math.floor(cores / 2)));
}

function lruGet(cache, key) {
  if (!cache.has(key)) return undefined;
  const val = cache.get(key);
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function lruSet(cache, key, val) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  while (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function createPool({ workerFactory } = {}) {
  const size = resolvePoolSize();
  const workers = [];
  const inflight = new Map();
  const cache = new Map();
  let rr = 0;

  const canSpawn = typeof workerFactory === 'function' || typeof Worker === 'function';
  if (canSpawn) {
    for (let i = 0; i < size; i++) {
      try {
        const w = typeof workerFactory === 'function'
          ? workerFactory()
          : new Worker(new URL('./diff-highlight.worker.js', import.meta.url), { type: 'module' });
        w.onmessage = ev => {
          const { id, html } = ev.data || {};
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
    async highlightBatch(items = []) {
      const results = new Array(items.length);
      const missingIndices = [];
      const missingItems = [];
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

      let computed = null;
      if (workers.length) {
        const w = workers[rr++ % workers.length];
        const reqId = nextRequestId++;
        try {
          computed = await new Promise((resolve, reject) => {
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
export function acquireDiffWorkerPool(options = {}) {
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

export function releaseDiffWorkerPool({ immediate = false } = {}) {
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
    }, IDLE_TTL_MS);
    shared.idleTimer.unref?.();
  }
}

export async function highlightDiffAsync(items = [], options = {}) {
  const handle = acquireDiffWorkerPool(options);
  try {
    return await handle.highlightBatch(items);
  } finally {
    releaseDiffWorkerPool(options);
  }
}

export function diffWorkerPoolStats() {
  return shared
    ? { active: true, consumers: shared.consumers, workers: shared.workers.length, cacheSize: shared.cache.size }
    : { active: false, consumers: 0, workers: 0, cacheSize: 0 };
}
