import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Persists failed audio transcription recordings on disk for safe user retry with TTL and item cap pruning.
 */
export class FailedRecordingStore {
  constructor({ dir, maxItems = 10, ttlMs = 7 * 86400_000, now = Date.now } = {}) {
    this.dir = dir;
    this.maxItems = maxItems;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async #ensureDir() {
    if (!this.dir) throw new Error('Failed recording store directory is not configured.');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  async save({ buffer, mime = 'audio/webm', ext = '.webm', reason = '' } = {}) {
    await this.#ensureDir();
    const id = `rec-${this.now()}-${randomUUID().slice(0, 8)}`;
    const cleanExt = /^\.[a-z0-9]{1,8}$/i.test(String(ext || '')) ? String(ext) : '.webm';
    const audioName = `${id}${cleanExt}`;
    const audioPath = join(this.dir, audioName);
    const metaPath = join(this.dir, `${id}.json`);
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    await writeFile(audioPath, bytes, { mode: 0o600 });
    const record = {
      id,
      file: audioName,
      path: audioPath,
      size: bytes.length,
      mime: String(mime || 'audio/webm').slice(0, 80),
      reason: String(reason || '').slice(0, 400),
      createdAt: this.now(),
      attempts: 1,
      lastError: String(reason || '').slice(0, 400),
    };
    await writeFile(metaPath, JSON.stringify(record), { mode: 0o600 });
    await this.prune();
    return record;
  }

  async list() {
    if (!this.dir) return [];
    const entries = await readdir(this.dir).catch(() => []);
    const items = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(this.dir, name), 'utf8'));
        if (parsed?.id) items.push(parsed);
      } catch {}
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return items;
  }

  async retry(id, transcribeFn) {
    if (!this.dir || typeof transcribeFn !== 'function') throw new Error('Retry handler unavailable.');
    const cleanId = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '');
    const metaPath = join(this.dir, `${cleanId}.json`);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const buffer = await readFile(meta.path);
    meta.attempts = (Number(meta.attempts) || 0) + 1;
    try {
      const result = await transcribeFn({ buffer, meta });
      await this.remove(cleanId);
      return { ok: true, id: cleanId, result };
    } catch (err) {
      meta.lastError = String(err?.message || 'Transcription failed').slice(0, 400);
      meta.updatedAt = this.now();
      await writeFile(metaPath, JSON.stringify(meta), { mode: 0o600 });
      return { ok: false, id: cleanId, error: meta.lastError, attempts: meta.attempts };
    }
  }

  async remove(id) {
    if (!this.dir) return false;
    const cleanId = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '');
    if (!cleanId) return false;
    const metaPath = join(this.dir, `${cleanId}.json`);
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (meta?.path) await rm(meta.path, { force: true }).catch(() => {});
    } catch {}
    await rm(metaPath, { force: true }).catch(() => {});
    return true;
  }

  async prune() {
    const items = await this.list();
    const cutoff = this.now() - this.ttlMs;
    const kept = [];
    for (const item of items) {
      if ((item.createdAt || 0) < cutoff) {
        await this.remove(item.id);
      } else {
        kept.push(item);
      }
    }
    while (kept.length > this.maxItems) {
      const oldest = kept.pop();
      if (oldest?.id) await this.remove(oldest.id);
    }
    return kept.length;
  }
}
