// Builds the book index once, hands it to BookLibrary on Fairy's main thread, and exits (efficiency audit, after fix
// 12). Reading the cache, extracting new PDFs and indexing leave a lot behind, and a thread that sat idle afterwards
// would keep it all. A thread that ends gives its memory back once the thread that started it collects garbage, which
// the main thread does all the time. The finished arrays are transferred, not copied.
import { parentPort, workerData, type Transferable } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { install: guardHelpers } = createRequire(import.meta.url)('./helper-guard.cjs') as { install: () => unknown };
// A worker has its own child_process, so it puts the guard on too, before anything is started.
guardHelpers();
const { nativeBin } = createRequire(import.meta.url)('./bundle-path.cjs') as {
  nativeBin: (name: string) => string;
};
import type { Stats } from 'node:fs';
import { readdir, stat, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { LocalFiles, type LocalFileRootStatus } from './local-files.mjs';
import { noteChunks } from './notes.mjs';
import { BookPassages } from './book-passages.mjs';
import { BookStore } from './book-store.mjs';

interface ExtractedChunk {
  answer: string;
  page: number;
}

interface ExtractSummary {
  done?: boolean;
  processedPages?: number;
  emptyPages?: number;
  truncated?: boolean;
  [key: string]: unknown;
}

interface ExtractResult extends ExtractSummary {
  chunks: ExtractedChunk[];
}

interface CachedBookValue {
  version: number;
  revision: string;
  chunks: ExtractedChunk[];
  processedPages?: number;
  emptyPages?: number;
  truncated?: boolean;
}

interface BookFailure {
  path: string;
  reason: string;
}

interface WorkerState {
  status: string;
  ready: boolean;
  files: number;
  chunks: number;
  pages: number;
  emptyPages: number;
  skipped: number;
  truncated: boolean;
  cacheHits: number;
  failures: BookFailure[];
}

const revision = (s: Stats): string => `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const { root, cachePath } = workerData as { root: LocalFileRootStatus; cachePath: string };
const files = new LocalFiles({ read: async () => [root], write: async () => { throw Error('Read only'); } });
await files.load();
let closed = false, controller: AbortController | undefined;
const excluded = /^(?:\.|node_modules$|vendor$|dist$|build$|release$|__pycache__$|venv$|env$|private$|credentials(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|keys(?:\.|$)|id_rsa|id_ed25519)/i;

function extract(fd: number, signal: AbortSignal): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(nativeBin('fairy-document'), [], { stdio: ['pipe', 'pipe', 'pipe', fd] });
    let pending = '', size = 0;
    const chunks: ExtractedChunk[] = [];
    let summary: ExtractSummary | undefined, settled = false;
    const finish = (e: unknown, v?: ExtractResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      e ? reject(e) : resolve(v!);
    };
    const kill = (e: unknown): void => { child.kill('SIGKILL'); finish(e); };
    const abort = (): void => kill(Error('Stopped'));
    const timer = setTimeout(() => kill(Error('PDF extraction timed out')), 90000);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout!.setEncoding('utf8');
    child.stderr!.resume();
    child.stdin!.on('error', () => {});
    child.on('error', () => finish(Error('PDF reader unavailable')));
    child.stdout!.on('data', (data: string) => {
      if (settled) return;
      size += Buffer.byteLength(data);
      pending += data;
      if (size > 48 * 1024 * 1024 || pending.length > 2 * 1024 * 1024) return kill(Error('PDF text limit reached'));
      let at: number;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        try {
          const row = JSON.parse(line) as ExtractSummary & { page?: unknown; text?: unknown };
          if (row.done) summary = row;
          else if (Number.isInteger(row.page) && typeof row.text === 'string') {
            const page = row.page as number;
            chunks.push(...noteChunks(row.text, '').map(c => ({ answer: c.answer, page })));
          }
        } catch {
          return kill(Error('Invalid PDF output'));
        }
      }
    });
    child.on('close', code => code === 0 && summary ? finish(null, { chunks, ...summary }) : finish(Error('PDF extraction failed')));
    child.stdin!.end(JSON.stringify({ descriptor: true, index: true }));
    if (signal.aborted) abort();
  });
}

async function refresh(): Promise<void> {
  if (closed) return;
  controller = new AbortController();
  const signal = controller.signal;
  let count = 0, pages = 0, emptyPages = 0, skipped = 0, truncated = false, cacheHits = 0;
  const next = new BookStore(), queue = [''];
  let seen = 0;
  const failures: BookFailure[] = [];
  const state = (status: string, ready = false): WorkerState => ({
    status, ready, files: count, chunks: next.size, pages, emptyPages, skipped, truncated, cacheHits, failures: failures.slice(0, 20),
  });
  const report = (status: string, ready = false): void => parentPort!.postMessage({ state: state(status, ready) });
  try {
    await mkdir(cachePath, { recursive: true, mode: 0o700 });
    report('Indexing books locally…');
    while (queue.length && seen < 20000 && next.size < 60000) {
      signal.throwIfAborted();
      const dir = await files.checked(root.id, queue.shift()!);
      for (const entry of (await readdir(dir.full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++seen > 20000 || next.size >= 60000) { truncated = true; break; }
        signal.throwIfAborted();
        if (excluded.test(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(dir.path, entry.name);
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile() || !path.toLowerCase().endsWith('.pdf')) continue;
        try {
          const checked = await files.checked(root.id, path), before = await stat(checked.full), rev = revision(before);
          if (before.size > 256 * 1024 * 1024) throw Error('PDF exceeds 256 MB');
          const cache = join(cachePath, hash(path) + '.json');
          let value: CachedBookValue | undefined;
          try {
            if ((await stat(cache)).size < 48 * 1024 * 1024) {
              const saved = JSON.parse(await readFile(cache, 'utf8')) as CachedBookValue;
              if (
                saved.version === 1 &&
                saved.revision === rev &&
                Array.isArray(saved.chunks) &&
                saved.chunks.length <= 60000 &&
                saved.chunks.every(c => typeof c.answer === 'string' && c.answer.length <= 1800 && Number.isInteger(c.page) && c.page > 0 && c.page <= 5000)
              ) {
                value = saved;
                cacheHits++;
              }
            }
          } catch {}
          if (!value) {
            value = { ...await files.withPDF(root.id, path, signal, fd => extract(fd, signal)), version: 1, revision: rev };
            signal.throwIfAborted();
            if (revision(await stat(checked.full)) !== rev) throw Error('PDF changed');
            const temp = cache + '.tmp';
            await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
            await rename(temp, cache);
          }
          signal.throwIfAborted();
          if (revision(await stat((await files.checked(root.id, path)).full)) !== rev) throw Error('PDF changed');
          count++;
          pages += value.processedPages || 0;
          emptyPages += value.emptyPages || 0;
          truncated ||= Boolean(value.truncated);
          const book = next.file(path, rev);
          for (let i = 0; i < value.chunks.length; i++) {
            if (next.size >= 60000) { truncated = true; break; }
            const c = value.chunks[i];
            next.add(hash(`${path}\0${rev}\0${i}`), c.answer, c.page, book);
          }
        } catch (e: unknown) {
          signal.throwIfAborted();
          skipped++;
          const reason = e instanceof Error
            ? e.message
            : (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));
          failures.push({ path, reason });
        }
        report(`Indexing books locally… ${count} books`);
        await pause(0);
      }
    }
    signal.throwIfAborted();
    truncated ||= queue.length > 0;
    const passages = new BookPassages(next.items()).toData();
    const store = await next.toDiskData(join(cachePath, 'passages.bin'));
    parentPort!.postMessage(
      { state: state('Ready · book text search', true), built: { store, passages } },
      [...BookStore.transfers(store), ...BookPassages.transfers(passages)] as unknown as Transferable[],
    );
  } catch (_e: unknown) {
    if (!closed) report('Book index unavailable · refresh to retry');
  } finally {
    parentPort!.close();
  }
}

parentPort!.on('message', (m: { op?: string }) => {
  if (m.op === 'close') {
    closed = true;
    controller?.abort();
  }
});
void refresh();
