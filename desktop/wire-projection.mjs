import { randomUUID } from 'node:crypto';

export const WIRE_HYDRATION_BYTES = 256 * 1024;
const DEFAULT_PREVIEW_CHARS = 2048;
const IMMEDIATE_TYPES = new Set(['done', 'approval', 'approval-closed', 'error', 'tool', 'step', 'handoff', 'secret-request', 'reset']);
const MERGE_TEXT_FIELDS = ['text', 'thinking', 'delta', 'content', 'chunk'];

/**
 * Bounded LRU store mapping hydration keys to full oversized turn payloads.
 */
export function createWireHydrationStore({ maxEntries = 128 } = {}) {
  const cap = Math.max(8, Math.floor(Number(maxEntries) || 128));
  const map = new Map();

  return {
    set(key, value) {
      if (!key) return;
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > cap) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    get(key) {
      if (!map.has(key)) return undefined;
      const val = map.get(key);
      map.delete(key);
      map.set(key, val);
      return val;
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

function measureBytes(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function previewString(item) {
  if (typeof item === 'string') return item.slice(0, DEFAULT_PREVIEW_CHARS);
  if (!item || typeof item !== 'object') return '';
  for (const field of ['content', 'text', 'output', 'diff', 'thinking']) {
    if (typeof item[field] === 'string' && item[field]) return item[field].slice(0, DEFAULT_PREVIEW_CHARS);
  }
  try {
    return (JSON.stringify(item) || '').slice(0, DEFAULT_PREVIEW_CHARS);
  } catch {
    return '';
  }
}

/**
 * Projects turn items over 256 KB onto compact hydration descriptors stored out-of-band for on-demand fetch.
 */
export function projectTurnItemForWire(item, { maxBytes = WIRE_HYDRATION_BYTES, store = null, keyPrefix = 'wire' } = {}) {
  if (item == null) return item;
  const byteLength = measureBytes(item);
  if (byteLength <= maxBytes) return item;

  const baseId = typeof item === 'object' && typeof item.id === 'string' && item.id ? item.id.replace(/[^A-Za-z0-9._-]/g, '_') : randomUUID().slice(0, 12);
  const hydrationKey = `${keyPrefix}:${baseId}:${randomUUID().slice(0, 8)}`;
  store?.set?.(hydrationKey, item);

  if (typeof item !== 'object' || Array.isArray(item)) {
    return {
      truncated: true,
      byteLength,
      hydrationKey,
      preview: previewString(item),
    };
  }

  const descriptor = {
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(item.role !== undefined ? { role: item.role } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
    ...(item.tool !== undefined ? { tool: item.tool } : {}),
    ...(item.status !== undefined ? { status: item.status } : {}),
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    ...(item.at !== undefined ? { at: item.at } : {}),
    ...(item.replyTo !== undefined ? { replyTo: item.replyTo } : {}),
    ...(item.mode !== undefined ? { mode: item.mode } : {}),
    ...(item.session !== undefined ? { session: item.session } : {}),
    truncated: true,
    byteLength,
    hydrationKey,
    preview: previewString(item),
  };
  return descriptor;
}

/**
 * Retrieves an oversized payload previously stored by `projectTurnItemForWire`.
 */
export function hydrateTurnItem(store, key) {
  if (!store || typeof key !== 'string' || !key) return null;
  const found = store.get(key);
  return found === undefined ? null : found;
}

/**
 * Returns a bounded window of history items ordered oldest-to-newest with a reverse cursor.
 */
export function paginateHistory(entries = [], { before = null, limit = 80, maxLimit = 200 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const total = list.length;
  const cap = Math.max(1, Math.min(maxLimit, Math.floor(Number(limit) || 80)));
  const rawBefore = before === null || before === undefined ? total : Math.floor(Number(before));
  const end = Number.isFinite(rawBefore) ? Math.max(0, Math.min(total, rawBefore)) : total;
  const start = Math.max(0, end - cap);
  return {
    items: list.slice(start, end),
    hasMore: start > 0,
    nextCursor: start > 0 ? start : null,
    total,
  };
}

/**
 * Coalesces bursts of adjacent streaming deltas over a 50 ms window while immediately passing control events.
 */
export function createThreadLiveEventCoalescer({ flushMs = 50, onFlush = () => {} } = {}) {
  const buffers = new Map();
  let timer = null;
  let disposed = false;

  const sessionKey = ev => String(ev?.session || '__default__');

  function mergeInto(prev, next) {
    const out = { ...prev, ...next };
    for (const f of MERGE_TEXT_FIELDS) {
      if (typeof prev[f] === 'string' && typeof next[f] === 'string') {
        out[f] = prev[f] + next[f];
      }
    }
    return out;
  }

  function flushSession(sid) {
    const entry = buffers.get(sid);
    if (!entry) return;
    buffers.delete(sid);
    for (const ev of entry.ordered) onFlush(ev);
  }

  function flush(targetSession = null) {
    if (disposed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (targetSession !== null && targetSession !== undefined) {
      flushSession(String(targetSession || '__default__'));
      if (buffers.size > 0) schedule();
      return;
    }
    for (const sid of [...buffers.keys()]) flushSession(sid);
  }

  function schedule() {
    if (timer || disposed || buffers.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    timer.unref?.();
  }

  function push(event) {
    if (disposed || !event || typeof event !== 'object') return;
    const sid = sessionKey(event);
    const type = String(event.type || '');
    if (IMMEDIATE_TYPES.has(type)) {
      flushSession(sid);
      onFlush(event);
      return;
    }

    let bucket = buffers.get(sid);
    if (!bucket) {
      bucket = { ordered: [], byType: new Map() };
      buffers.set(sid, bucket);
    }
    const last = bucket.ordered.at(-1);
    if (last && String(last.type || '') === type && (!event.id || event.id === last.id)) {
      const merged = mergeInto(last, event);
      bucket.ordered[bucket.ordered.length - 1] = merged;
      bucket.byType.set(type, merged);
    } else {
      bucket.ordered.push({ ...event });
      bucket.byType.set(type, bucket.ordered.at(-1));
    }
    schedule();
  }

  function dispose() {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    buffers.clear();
  }

  return { push, flush, dispose, pendingCount: () => buffers.size };
}

/**
 * Sliding-window event & byte rate budget governor for live UI streaming.
 */
export function createLiveStreamBudget({ maxBytesPerSec = 512 * 1024, maxEventsPerSec = 120, now = Date.now } = {}) {
  const window = [];
  let totalAllowed = 0;
  let totalDropped = 0;

  function prune(nowMs) {
    while (window.length && nowMs - window[0].ts >= 1000) window.shift();
  }

  function currentTotals() {
    let bytes = 0;
    for (const item of window) bytes += item.bytes;
    return { bytes, events: window.length };
  }

  return {
    check(bytes = 0, { essential = false } = {}) {
      const nowMs = now();
      prune(nowMs);
      const b = Math.max(0, Number(bytes) || 0);
      const cur = currentTotals();
      if (!essential && (cur.events + 1 > maxEventsPerSec || cur.bytes + b > maxBytesPerSec)) {
        totalDropped++;
        return { allow: false, coalesce: true, dropped: true };
      }
      window.push({ ts: nowMs, bytes: b });
      totalAllowed++;
      return { allow: true, coalesce: false, dropped: false };
    },
    stats() {
      prune(now());
      const cur = currentTotals();
      return {
        windowBytes: cur.bytes,
        windowEvents: cur.events,
        totalAllowed,
        totalDropped,
        maxBytesPerSec,
        maxEventsPerSec,
      };
    },
  };
}

/**
 * WeakMap-backed O(1) patch/diff hint cache so unchanged immutable turn objects skip re-computation.
 */
export function createPatchHintCache() {
  const cache = new WeakMap();
  return {
    getHint(obj, compute) {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
        return typeof compute === 'function' ? compute(obj) : undefined;
      }
      if (cache.has(obj)) return cache.get(obj);
      const val = typeof compute === 'function' ? compute(obj) : undefined;
      cache.set(obj, val);
      return val;
    },
    has(obj) {
      return Boolean(obj && (typeof obj === 'object' || typeof obj === 'function') && cache.has(obj));
    },
    invalidate(obj) {
      if (obj && (typeof obj === 'object' || typeof obj === 'function')) cache.delete(obj);
    },
  };
}
