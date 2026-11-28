import { randomUUID } from 'node:crypto';

export const WIRE_HYDRATION_BYTES = 256 * 1024;
const DEFAULT_PREVIEW_CHARS = 2048;
const IMMEDIATE_TYPES = new Set(['done', 'approval', 'approval-closed', 'error', 'tool', 'step', 'handoff', 'secret-request', 'reset']);
const MERGE_TEXT_FIELDS = ['text', 'thinking', 'delta', 'content', 'chunk'] as const;

export interface WireHydrationStore<T = unknown> {
  set(key: string, value: T): void;
  get(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  size(): number;
}

export interface TruncatedWireDescriptor {
  truncated: true;
  byteLength: number;
  hydrationKey: string;
  preview: string;
  [key: string]: unknown;
}

export interface WireStreamEvent {
  type?: string;
  session?: string;
  id?: unknown;
  text?: string;
  thinking?: string;
  delta?: string;
  content?: string;
  chunk?: string;
  [key: string]: unknown;
}

/**
 * Bounded LRU store mapping hydration keys to full oversized turn payloads.
 */
export function createWireHydrationStore<T = unknown>({ maxEntries = 128 }: { maxEntries?: number } = {}): WireHydrationStore<T> {
  const cap = Math.max(8, Math.floor(Number(maxEntries) || 128));
  const map = new Map<string, T>();

  return {
    set(key: string, value: T) {
      if (!key) return;
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > cap) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    get(key: string) {
      if (!map.has(key)) return undefined;
      const val = map.get(key) as T;
      map.delete(key);
      map.set(key, val);
      return val;
    },
    has(key: string) {
      return map.has(key);
    },
    delete(key: string) {
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

function measureBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function previewString(item: unknown): string {
  if (typeof item === 'string') return item.slice(0, DEFAULT_PREVIEW_CHARS);
  if (!item || typeof item !== 'object') return '';
  const rec = item as Record<string, unknown>;
  for (const field of ['content', 'text', 'output', 'diff', 'thinking']) {
    const val = rec[field];
    if (typeof val === 'string' && val) return val.slice(0, DEFAULT_PREVIEW_CHARS);
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
export function projectTurnItemForWire<T>(
  item: T,
  {
    maxBytes = WIRE_HYDRATION_BYTES,
    store = null,
    keyPrefix = 'wire',
  }: {
    maxBytes?: number;
    store?: Pick<WireHydrationStore, 'set'> | null;
    keyPrefix?: string;
  } = {},
): T | TruncatedWireDescriptor {
  if (item == null) return item;
  const byteLength = measureBytes(item);
  if (byteLength <= maxBytes) return item;

  const rec = typeof item === 'object' ? (item as Record<string, unknown>) : null;
  const baseId = rec && typeof rec.id === 'string' && rec.id ? rec.id.replace(/[^A-Za-z0-9._-]/g, '_') : randomUUID().slice(0, 12);
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

  const descriptor: TruncatedWireDescriptor = {
    ...(rec!.id !== undefined ? { id: rec!.id } : {}),
    ...(rec!.role !== undefined ? { role: rec!.role } : {}),
    ...(rec!.type !== undefined ? { type: rec!.type } : {}),
    ...(rec!.tool !== undefined ? { tool: rec!.tool } : {}),
    ...(rec!.status !== undefined ? { status: rec!.status } : {}),
    ...(rec!.summary !== undefined ? { summary: rec!.summary } : {}),
    ...(rec!.at !== undefined ? { at: rec!.at } : {}),
    ...(rec!.replyTo !== undefined ? { replyTo: rec!.replyTo } : {}),
    ...(rec!.mode !== undefined ? { mode: rec!.mode } : {}),
    ...(rec!.session !== undefined ? { session: rec!.session } : {}),
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
export function hydrateTurnItem<T = unknown>(store: Pick<WireHydrationStore<T>, 'get'> | null | undefined, key: string): T | null {
  if (!store || typeof key !== 'string' || !key) return null;
  const found = store.get(key);
  return found === undefined ? null : found;
}

/**
 * Returns a bounded window of history items ordered oldest-to-newest with a reverse cursor.
 */
export function paginateHistory<T>(
  entries: T[] = [],
  { before = null, limit = 80, maxLimit = 200 }: { before?: number | null; limit?: number; maxLimit?: number } = {},
): { items: T[]; hasMore: boolean; nextCursor: number | null; total: number } {
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
export function createThreadLiveEventCoalescer({
  flushMs = 50,
  onFlush = () => {},
}: {
  flushMs?: number;
  onFlush?: (event: WireStreamEvent) => void;
} = {}): {
  push: (event: WireStreamEvent) => void;
  flush: (targetSession?: string | null) => void;
  dispose: () => void;
  pendingCount: () => number;
} {
  const buffers = new Map<string, { ordered: WireStreamEvent[]; byType: Map<string, WireStreamEvent> }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const sessionKey = (ev: WireStreamEvent | null | undefined): string => String(ev?.session || '__default__');

  function mergeInto(prev: WireStreamEvent, next: WireStreamEvent): WireStreamEvent {
    const out: WireStreamEvent = { ...prev, ...next };
    for (const f of MERGE_TEXT_FIELDS) {
      const prevVal = prev[f];
      const nextVal = next[f];
      if (typeof prevVal === 'string' && typeof nextVal === 'string') {
        out[f] = prevVal + nextVal;
      }
    }
    return out;
  }

  function flushSession(sid: string): void {
    const entry = buffers.get(sid);
    if (!entry) return;
    buffers.delete(sid);
    for (const ev of entry.ordered) onFlush(ev);
  }

  function flush(targetSession: string | null = null): void {
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

  function schedule(): void {
    if (timer || disposed || buffers.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    timer.unref?.();
  }

  function push(event: WireStreamEvent): void {
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
      const copy: WireStreamEvent = { ...event };
      bucket.ordered.push(copy);
      bucket.byType.set(type, copy);
    }
    schedule();
  }

  function dispose(): void {
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
export function createLiveStreamBudget({
  maxBytesPerSec = 512 * 1024,
  maxEventsPerSec = 120,
  now = Date.now,
}: {
  maxBytesPerSec?: number;
  maxEventsPerSec?: number;
  now?: () => number;
} = {}): {
  check: (bytes?: number, options?: { essential?: boolean }) => { allow: boolean; coalesce: boolean; dropped: boolean };
  stats: () => {
    windowBytes: number;
    windowEvents: number;
    totalAllowed: number;
    totalDropped: number;
    maxBytesPerSec: number;
    maxEventsPerSec: number;
  };
} {
  const window: Array<{ ts: number; bytes: number }> = [];
  let totalAllowed = 0;
  let totalDropped = 0;

  function prune(nowMs: number): void {
    while (window.length && nowMs - window[0].ts >= 1000) window.shift();
  }

  function currentTotals(): { bytes: number; events: number } {
    let bytes = 0;
    for (const item of window) bytes += item.bytes;
    return { bytes, events: window.length };
  }

  return {
    check(bytes = 0, { essential = false }: { essential?: boolean } = {}) {
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
export function createPatchHintCache(): {
  getHint: <T, R>(obj: T, compute?: (obj: T) => R) => R | undefined;
  has: (obj: unknown) => boolean;
  invalidate: (obj: unknown) => void;
} {
  const cache = new WeakMap<object, unknown>();
  const isWeakKey = (obj: unknown): obj is object => Boolean(obj && (typeof obj === 'object' || typeof obj === 'function'));
  return {
    getHint<T, R>(obj: T, compute?: (obj: T) => R): R | undefined {
      if (!isWeakKey(obj)) {
        return typeof compute === 'function' ? compute(obj) : undefined;
      }
      if (cache.has(obj)) return cache.get(obj) as R;
      const val = typeof compute === 'function' ? compute(obj) : undefined;
      cache.set(obj, val);
      return val;
    },
    has(obj: unknown): boolean {
      return isWeakKey(obj) && cache.has(obj);
    },
    invalidate(obj: unknown): void {
      if (isWeakKey(obj)) cache.delete(obj);
    },
  };
}
