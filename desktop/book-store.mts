import { openSync, readSync, closeSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';

export interface BookFileMeta {
  path: string;
  revision: unknown;
}

export interface BookPassageItem {
  id: string;
  page: number;
  path: string;
  readonly answer: string;
}

export interface BookPassageDescription {
  question: string;
  source: unknown;
}

export interface BookPassageHit {
  id: string;
  answer: string;
  page: number;
  question: string;
  path: string;
  revision: unknown;
  source: unknown;
}

export interface BookStoreData {
  text: Uint8Array | null;
  textPath?: string | null;
  ends: Uint32Array;
  ids: string[];
  pages: number[];
  files: number[];
  fileList: BookFileMeta[];
}

// The book worker's passages, kept compactly (efficiency audit, after fix 12). The build thread collects them as
// strings; what it hands to the search thread is their text as UTF-8 in one disk-backed file (or buffer in memory),
// avoiding holding tens of MB of passage strings in V8/heap memory while idle. A passage's title and link are made
// only when it's returned as a hit.
export class BookStore {
  strings: string[] | null;
  text: Buffer | null;
  textPath: string | null;
  ends: Uint32Array | null;
  ids: string[];
  pages: number[];
  files: number[];
  fileList: BookFileMeta[];
  index: Map<string, number>;

  // While building, texts are kept as the strings they arrived as: that memory is the build thread's, and goes with it.
  constructor() {
    this.strings = [];
    this.text = null;
    this.textPath = null;
    this.ends = null;
    this.ids = [];
    this.pages = [];
    this.files = [];
    this.fileList = [];
    this.index = new Map();
  }

  get size(): number { return this.ids.length; }

  // A book's path and revision once, for all its passages; returns the number add() takes.
  file(path: string, revision: unknown): number { this.fileList.push({ path, revision }); return this.fileList.length - 1; }

  add(id: string, answer: unknown, page: number, file: number): void {
    if (this.index.has(id)) return;
    this.index.set(id, this.ids.length); this.strings!.push(String(answer)); this.ids.push(id); this.pages.push(page); this.files.push(file);
  }

  answer(at: number): string {
    if (this.text) return this.text.toString('utf8', at ? this.ends![at - 1] : 0, this.ends![at]);
    if (this.textPath) {
      const start = at ? this.ends![at - 1] : 0, len = this.ends![at] - start;
      if (len <= 0) return '';
      try {
        const fd = openSync(this.textPath, 'r');
        try {
          const buf = Buffer.alloc(len);
          const read = readSync(fd, buf, 0, len, start);
          return buf.toString('utf8', 0, read);
        } finally { closeSync(fd); }
      } catch { return ''; }
    }
    return this.strings![at];
  }

  // What BookPassages indexes: each passage's id, page and book, with its text read when asked for.
  *items(): Generator<BookPassageItem, void, unknown> {
    const store = this;
    for (let at = 0; at < this.ids.length; at++) {
      yield { id: this.ids[at], page: this.pages[at], path: this.fileList[this.files[at]].path, get answer() { return store.answer(at); } };
    }
  }

  // A passage as search returns it, with its title and link made by describe(path, page).
  get(id: string, describe: (path: string, page: number) => BookPassageDescription): BookPassageHit | undefined {
    const at = this.index.get(id); if (at === undefined) return undefined;
    const { path, revision } = this.fileList[this.files[at]], page = this.pages[at];
    const { question, source } = describe(path, page);
    return { id, answer: this.answer(at), page, question, path, revision, source };
  }

  // Packs passage strings into UTF-8 bytes and an end-offset table shared by in-memory and disk-backed transfers.
  #pack(): { text: Uint8Array; ends: Uint32Array } {
    let bytes = 0;
    const strings = this.strings || [];
    const ends = new Uint32Array(this.ids.length);
    for (let at = 0; at < strings.length; at++) ends[at] = bytes += Buffer.byteLength(strings[at]);
    const text = new Uint8Array(bytes), view = Buffer.from(text.buffer);
    for (let at = 0, from = 0; at < strings.length; at++) from += view.write(strings[at], from);
    return { text, ends };
  }

  // Plain data to hand to another thread, its arrays exactly sized so they can be transferred; fromData takes it back.
  toData(): BookStoreData {
    const { text, ends } = this.#pack();
    return { text, ends, ids: this.ids, pages: this.pages, files: this.files, fileList: this.fileList };
  }

  // Writes packed UTF-8 passages atomically to disk so the main thread does not retain them in RAM while idle.
  async toDiskData(textPath: string): Promise<BookStoreData> {
    const { text, ends } = this.#pack(), temp = `${textPath}.tmp`;
    await writeFile(temp, text, { mode: 0o600 }); await rename(temp, textPath);
    return { text: null, textPath, ends, ids: this.ids, pages: this.pages, files: this.files, fileList: this.fileList };
  }

  static transfers(data: BookStoreData): ArrayBufferLike[] {
    return data.text ? [data.text.buffer, data.ends.buffer] : [data.ends.buffer];
  }

  static fromData(data: BookStoreData): BookStore {
    const store = Object.create(BookStore.prototype) as BookStore;
    Object.assign(store, {
      strings: null,
      text: data.text ? Buffer.from(data.text.buffer, data.text.byteOffset, data.text.byteLength) : null,
      textPath: data.textPath || null,
      ends: data.ends,
      ids: data.ids,
      pages: data.pages,
      files: data.files,
      fileList: data.fileList,
    });
    store.index = new Map(data.ids.map((id, at) => [id, at]));
    return store;
  }

  clear(): void {
    this.strings = []; this.text = null; this.textPath = null; this.ends = null;
    this.ids = []; this.pages = []; this.files = []; this.fileList = []; this.index.clear();
  }
}
