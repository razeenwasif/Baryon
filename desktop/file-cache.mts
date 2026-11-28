export interface FileByteCacheOptions {
  maxBytes?: number;
  maxEntries?: number;
  maxEntryBytes?: number;
  ttl?: number;
  now?: () => number;
}

interface FileCacheEntry {
  revision: string;
  bytes: Buffer;
  expires: number;
}

export interface FileRevisionInfo {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mtimeNs: number | bigint;
  ctimeNs: number | bigint;
}

export interface FileHandleLike {
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
}

// On-demand LRU; no polling, watcher, disk mirror or expiry timer. Callers must
// revalidate access and the current file revision before every lookup.
export class FileByteCache {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  ttl: number;
  now: () => number;
  entries: Map<string, FileCacheEntry>;
  bytes: number;

  constructor({
    maxBytes = 8 * 1024 * 1024,
    maxEntries = 128,
    maxEntryBytes = 1024 * 1024,
    ttl = 60000,
    now = () => performance.now(),
  }: FileByteCacheOptions = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.maxEntryBytes = maxEntryBytes;
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
  }
  delete(key: string): void {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes.length;
      this.entries.delete(key);
    }
  }
  get(key: string, revision: string): Buffer | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.revision !== revision || this.now() >= entry.expires) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Buffer.from(entry.bytes);
  }
  set(key: string, revision: string, bytes: Buffer | Uint8Array): void {
    this.delete(key);
    if (bytes.length > this.maxEntryBytes || bytes.length > this.maxBytes || this.maxEntries < 1) return;
    for (const [k, entry] of this.entries) if (this.now() >= entry.expires) this.delete(k);
    while (this.entries.size >= this.maxEntries || this.bytes + bytes.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { revision, bytes: Buffer.from(bytes), expires: this.now() + this.ttl });
    this.bytes += bytes.length;
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
export const fileRevision = (info: FileRevisionInfo): string => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
export async function readHandleBytes(handle: FileHandleLike, size: number, signal?: AbortSignal): Promise<Buffer> {
  const buffer = Buffer.alloc(size + 1);
  let length = 0;
  while (length < buffer.length) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  // An exact-size result avoids retaining the extra read-sentinel byte.
  return buffer.subarray(0, length);
}
