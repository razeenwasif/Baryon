import { Worker } from 'node:worker_threads';
import { watch, type FSWatcher, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  NotesIndex,
  declinesNotes,
  type NotesIndexOptions,
  type NotesIndexState,
  type NoteRetrievedHit,
} from './notes.mjs';
import { BookPassages, type BookPassagesData } from './book-passages.mjs';
import { BookStore, type BookPassageHit, type BookStoreData } from './book-store.mjs';
import { sourceLink, type LocalFileRootStatus, type LocalFiles } from './local-files.mjs';

export interface BookLibraryFailure {
  path: string;
  reason: string;
}

export interface BookLibraryStatus {
  status: string;
  files: number;
  chunks: number;
  ready: boolean;
  pages?: number;
  emptyPages?: number;
  skipped?: number;
  truncated?: boolean;
  cacheHits?: number;
  failures?: BookLibraryFailure[];
}

export interface BookLibraryOptions {
  files: LocalFiles;
  cachePath: string;
  changed?: () => void;
}

export interface BookHit extends Omit<BookPassageHit, 'source'> {
  source: string;
  score: number;
}

export interface BookRetrieveResult {
  hits: BookHit[];
  status: string;
  ms: number;
}

export type KnowledgeHit = (NoteRetrievedHit | BookHit) & { rank?: number };

export interface KnowledgeRetrieveResult {
  hits: KnowledgeHit[];
  status: string;
  ms: number;
}

export const bookRevision = (s: Pick<Stats, 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>): string =>
  `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;

export class BookLibrary {
  files: LocalFiles;
  cachePath: string;
  changed: () => void;
  generation: number;
  status: BookLibraryStatus;
  key: string | null = null;
  rootId = '';
  enabled = false;
  paused = false;
  active = false;
  root: LocalFileRootStatus | null = null;
  building: { root: LocalFileRootStatus; cachePath: string } | null = null;
  watcher: FSWatcher | null = null;
  timer: ReturnType<typeof setTimeout> | undefined = undefined;
  builder: Worker | null = null;
  again = false;
  keywords: BookPassages | null = null;
  items: BookStore | null = null;

  constructor({ files, cachePath, changed = () => {} }: BookLibraryOptions) {
    this.files = files;
    this.cachePath = cachePath;
    this.changed = changed;
    this.generation = 0;
    this.status = { status: 'No books folder selected', files: 0, chunks: 0, ready: false };
  }

  state(): BookLibraryStatus {
    return this.status;
  }

  configure(rootId: string, enabled: boolean, paused = false): void {
    const key = JSON.stringify([rootId, enabled, paused, this.files.epoch]);
    if (key === this.key) return;
    this.close();
    this.key = key;
    this.rootId = rootId;
    this.enabled = enabled;
    this.paused = paused;
    this.status = {
      status: !enabled ? 'Off' : paused ? 'Paused' : !rootId ? 'No books folder selected' : 'Indexing books locally…',
      files: 0,
      chunks: 0,
      ready: false,
    };
    if (!rootId || !enabled || paused) return;
    const root = this.files.status().find(r => r.id === rootId);
    if (!root) {
      this.status.status = 'Books folder unavailable';
      return;
    }
    // The index is built by book-index-worker.mjs in a thread that ends, and its arrays are handed here, where it's
    // searched (efficiency audit, after fix 12). Building leaves a lot behind, which a thread that ends gives back once
    // this thread collects garbage, as it does all the time. A search thread holding the index kept well over
    // twice the index in Electron, and a search takes well under a millisecond here.
    this.active = true;
    this.root = root;
    this.building = { root, cachePath: join(this.cachePath, rootId) };
    this.build();
    try {
      this.watcher = watch(root.path, { recursive: true }, (_event, name) => {
        if (name && String(name).split(/[\\/]/).some(p => p.startsWith('.'))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 1500);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {}
  }

  // One build at a time; a refresh asked for meanwhile runs when it ends. The new index is in place before the status
  // says it's ready.
  build(): void {
    if (!this.active) return;
    if (this.builder) {
      this.again = true;
      return;
    }
    const generation = this.generation;
    const builder = this.builder = new Worker(new URL('./book-index-worker.mjs', import.meta.url), { workerData: this.building });
    let reported = false;
    builder.on('message', (m: { state?: BookLibraryStatus; built?: { passages: BookPassagesData; store: BookStoreData } }) => {
      if (generation !== this.generation || !m.state) return;
      if (m.built) {
        this.keywords = BookPassages.fromData(m.built.passages);
        this.items = BookStore.fromData(m.built.store);
      }
      reported = true;
      this.status = m.state;
      this.changed();
    });
    builder.on('error', () => {
      if (generation !== this.generation || reported) return;
      this.status = { status: 'Book index unavailable · refresh to retry', files: 0, chunks: 0, ready: false };
      this.changed();
    });
    builder.on('exit', () => {
      if (this.builder === builder) this.builder = null;
      if (generation === this.generation && this.again) {
        this.again = false;
        this.build();
      }
    });
  }

  refresh(): BookLibraryStatus {
    if (this.active) this.build();
    else if (this.enabled && !this.paused && this.rootId) {
      this.key = null;
      this.configure(this.rootId, true, false);
    }
    return this.state();
  }

  async retrieve(query: string, { signal, quiz = false }: { signal?: AbortSignal; quiz?: boolean } = {}): Promise<BookRetrieveResult> {
    signal?.throwIfAborted();
    const started = performance.now(), generation = this.generation, epoch = this.files.epoch;
    if (!this.status.ready || !this.keywords || declinesNotes(query) || String(query).trim().length < 10) {
      return { hits: [], status: this.status.status, ms: 0 };
    }
    const controller = new AbortController(), abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(Error('Book lookup deadline')), quiz ? 160 : 400);
    try {
      const work = (async (): Promise<BookHit[]> => {
        const result = await this.request(String(query).slice(0, 4000), controller.signal);
        const hits: BookHit[] = [], counts = new Map<string, number>();
        for (const hit of result.hits) {
          controller.signal.throwIfAborted();
          if ((counts.get(hit.path) || 0) >= 2) continue;
          try {
            const found = await this.files.checked(this.rootId, hit.path);
            if (bookRevision(await stat(found.full)) !== hit.revision) {
              this.refresh();
              continue;
            }
          } catch {
            continue;
          }
          controller.signal.throwIfAborted();
          hits.push(hit);
          counts.set(hit.path, (counts.get(hit.path) || 0) + 1);
          if (hits.length >= (quiz ? 3 : 4)) break;
        }
        return hits;
      })();
      const hits = await new Promise<BookHit[]>((resolve, reject) => {
        const stop = (): void => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', stop, { once: true });
        work.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', stop));
        if (controller.signal.aborted) stop();
      });
      signal?.throwIfAborted();
      if (generation !== this.generation || epoch !== this.files.epoch) {
        return { hits: [], status: 'Book access changed', ms: Math.round(performance.now() - started) };
      }
      return { hits, status: hits.length ? 'Matched books' : 'No relevant books', ms: Math.round(performance.now() - started) };
    } catch {
      signal?.throwIfAborted();
      return { hits: [], status: 'Book lookup unavailable or timed out', ms: Math.round(performance.now() - started) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  // A search: median 0.27 ms, 95th percentile 0.45 ms over 28 books (14 Nov). A hit's title and link are made here.
  request(query: string, _signal?: AbortSignal): { hits: BookHit[] } {
    const root = this.root!;
    const described = (path: string, page: number) => ({
      question: `${basename(path, '.pdf')} · p. ${page}`,
      source: sourceLink(root.id, path, page, true),
    });
    return {
      hits: this.keywords!.search(query).map(h => ({
        ...(this.items!.get(h.id, described) as BookPassageHit & { source: string }),
        score: h.score,
      })),
    };
  }

  close(): Promise<void> {
    this.generation++;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
    this.again = false;
    this.active = false;
    this.keywords = null;
    this.items = null;
    // The build thread stays referenced until it exits, so whoever awaits this sees it finish; one stuck mid-extraction is ended after 2 s.
    const builder = this.builder;
    this.builder = null;
    builder?.postMessage({ op: 'close' });
    const stopped = builder && builder.threadId !== -1
      ? new Promise<void>(resolve => {
        const stuck = setTimeout(() => void builder.terminate(), 2000);
        builder.once('exit', () => {
          clearTimeout(stuck);
          resolve();
        });
      })
      : Promise.resolve();
    this.key = null;
    this.status = { status: 'Off', files: 0, chunks: 0, ready: false };
    return stopped;
  }
}

// Both sources share one context budget. Slow books never delay the quiz's note lookup.
export class KnowledgeIndex {
  notes: NotesIndex;
  books: BookLibrary;

  constructor(options: NotesIndexOptions) {
    this.notes = new NotesIndex(options);
    this.books = new BookLibrary({ ...options, cachePath: join(options.cachePath + '-books') });
  }

  configure(root: string, enabled: boolean, paused?: boolean, booksRoot = ''): void {
    this.notes.configure(root, enabled, paused);
    this.books.configure(booksRoot, enabled, paused);
  }

  state(): NotesIndexState & { books: BookLibraryStatus } {
    return { ...this.notes.state(), books: this.books.state() };
  }

  refresh(): NotesIndexState & { books: BookLibraryStatus } {
    void this.notes.refresh();
    this.books.refresh();
    return this.state();
  }

  close(): void {
    this.notes.close();
    this.books.close();
  }

  async retrieve(query: string, options: { signal?: AbortSignal; quiz?: boolean } = {}): Promise<KnowledgeRetrieveResult> {
    const started = performance.now();
    const [notes, books] = await Promise.all([this.notes.retrieve(query, options), this.books.retrieve(query, options)]);
    options.signal?.throwIfAborted();
    // Reciprocal rank fusion avoids comparing differently calibrated search engines.
    const bookRequest = !options.quiz && /\b(?:my books?|my textbooks?|my library|the books|the textbooks|book library)\b/i.test(query);
    const preferred = bookRequest ? books.hits.slice(0, 3) : null;
    const hits: KnowledgeHit[] = preferred
      ? [...preferred, ...notes.hits.slice(0, 4 - preferred.length), ...books.hits.slice(preferred.length)].slice(0, 4)
      : [
        ...notes.hits.map((h, i) => ({ ...h, rank: 1 / (60 + i) })),
        ...books.hits.map((h, i) => ({ ...h, rank: 1 / (60 + i) })),
      ].sort((a, b) => b.rank - a.rank).slice(0, options.quiz ? 3 : 4);
    return {
      hits,
      status: hits.length ? 'Matched notes and books' : `${notes.status}; books: ${books.status}`,
      ms: Math.round(performance.now() - started),
    };
  }
}
