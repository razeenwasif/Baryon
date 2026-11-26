// The book index's memory (efficiency audit, after fix 12): packed postings, passages kept as one UTF-8 buffer, and
// the index built in a thread of its own and handed over. Each must search exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookKeywords } from '../desktop/book-keywords.mjs';
import { BookPassages } from '../desktop/book-passages.mjs';
import { BookStore } from '../desktop/book-store.mjs';
import { NoteKeywords } from '../desktop/notes.mjs';

// Passages with the shapes real books have: several per page, prefaces, contents, code, maths and non-Latin text.
const corpus = () => {
  const words = ['gradient', 'descent', 'convex', 'parallel', 'memory', 'garbage', 'collection', 'theorem', 'proof', 'algorithm', 'cache', 'thread', 'matrix', 'eigenvalue', 'duality', 'simplex', 'naïve', 'café', 'λ-calculus', 'Σ', '∂f/∂x', '数学', '🙂'];
  const rows = [];
  for (let book = 0; book < 4; book++) for (let page = 1; page <= 30; page++) for (let part = 0; part < 1 + (page % 3); part++) {
    const kind = page === 1 ? 'PREFACE\n' : page === 2 ? 'Contents\n' : page === 3 ? 'Introduction\n' : '';
    const n = 6 + ((book * 31 + page * 7 + part * 13) % 40), text = Array.from({ length: n }, (_, i) => words[(book + page * 3 + part * 5 + i * 7) % words.length] + (i % 9 === 8 ? '.\n' : ' ')).join('').trim();
    rows.push({ id: `${book}:${page}:${part}`, path: `Book ${book}.pdf`, page, question: '', answer: kind + Array.from({ length: 1 + (part % 4) }, () => text).join('\n') });
  }
  return rows;
};
const queries = ['gradient descent convex', 'parallel memory thread', 'garbage collection', 'preface', 'theorem proof algorithm', 'café naïve', '数学 Σ', 'eigenvalue matrix duality simplex', 'unrelated unicorns', 'λ-calculus'];

test('packed postings score every query as the reference BM25 does', () => {
  const items = corpus().map(r => ({ ...r, question: r.path }));
  const reference = new NoteKeywords(items), packed = new BookKeywords(items);
  for (const query of queries) {
    const a = reference.search(query), b = packed.search(query);
    assert.deepEqual(b.map(h => h.id), a.map(h => h.id), query);
    for (let i = 0; i < a.length; i++) assert(Math.abs(a[i].score - b[i].score) < 1e-6);
  }
  assert.equal(packed.postingsOf('gradient').docs.length, items.filter(i => i.answer.includes('gradient') || i.question.includes('gradient')).length);
  assert.equal(packed.postingsOf('no-such-term'), null);
});

test('the index handed to another thread searches exactly as the one that built it', () => {
  const built = new BookPassages(corpus()), data = built.toData();
  const received = BookPassages.fromData(structuredClone(data, { transfer: BookPassages.transfers(data) }));
  assert.equal(data.index.docs.byteLength, 0, 'the arrays were transferred, not copied');
  for (const query of queries) assert.deepEqual(received.search(query), new BookPassages(corpus()).search(query), query);
});

test('passages kept as one UTF-8 buffer come back character for character, with titles and links made on return', () => {
  const store = new BookStore(), rows = corpus();
  const books = new Map();
  for (const row of rows) { if (!books.has(row.path)) books.set(row.path, store.file(row.path, `rev-${row.path}`)); store.add(row.id, row.answer, row.page, books.get(row.path)); }
  store.add(rows[0].id, 'a duplicate id is ignored', 99, 0);
  assert.equal(store.size, rows.length);
  const data = store.toData(), handed = BookStore.fromData(structuredClone(data, { transfer: BookStore.transfers(data) }));
  assert.equal(handed.text.length, Buffer.byteLength(rows.map(r => r.answer).join('')));
  const describe = (path, page) => ({ question: `${path} · p. ${page}`, source: `link:${path}#${page}` });
  for (const row of rows) assert.deepEqual(handed.get(row.id, describe), { id: row.id, answer: row.answer, page: row.page, question: `${row.path} · p. ${row.page}`, path: row.path, revision: `rev-${row.path}`, source: `link:${row.path}#${row.page}` });
  assert.equal(handed.get('missing', describe), undefined);
  assert.deepEqual([...handed.items()].map(i => [i.id, i.path, i.page, i.answer]), rows.map(r => [r.id, r.path, r.page, r.answer]));
});

test('the main thread builds in a thread that ends, then holds and searches the index itself', () => {
  const library = readFileSync(new URL('../desktop/book-library.mjs', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../desktop/book-index-worker.mjs', import.meta.url), 'utf8');
  assert.match(library, /builder=this\.builder=new Worker\(new URL\('\.\/book-index-worker\.mjs',import\.meta\.url\),\{workerData:this\.building\}\)/);
  assert.equal((library.match(/new Worker\(/g) || []).length, 1, 'no search thread');
  // The index is in place before the status says ready.
  assert.match(library, /if\(m\.built\)\{this\.keywords=BookPassages\.fromData\(m\.built\.passages\);this\.items=BookStore\.fromData\(m\.built\.store\);\}\n\s*reported=true;this\.status=m\.state;this\.changed\(\);/);
  assert.match(build, /parentPort\.postMessage\(\{state:state\('Ready · book text search',true\),built:\{store,passages\}\},\[\.\.\.BookStore\.transfers\(store\),\.\.\.BookPassages\.transfers\(passages\)\]\);/);
  assert.match(build, /finally\{parentPort\.close\(\);\}/);
});

test('disk-backed BookStore writes passages to disk, drops buffer RAM, and reads exact passages on demand', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-book-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new BookStore(), rows = corpus();
  const books = new Map();
  for (const row of rows) {
    if (!books.has(row.path)) books.set(row.path, store.file(row.path, `rev-${row.path}`));
    store.add(row.id, row.answer, row.page, books.get(row.path));
  }
  const diskData = await store.toDiskData(join(dir, 'passages.bin'));
  assert.equal(diskData.text, null);
  assert.deepEqual(BookStore.transfers(diskData), [diskData.ends.buffer]);
  const cloned = structuredClone(diskData, { transfer: BookStore.transfers(diskData) });
  const handed = BookStore.fromData(cloned);
  assert.equal(handed.text, null);
  assert.equal(handed.textPath, join(dir, 'passages.bin'));
  const describe = (path, page) => ({ question: `${path} · p. ${page}`, source: `link:${path}#${page}` });
  for (const row of rows) {
    assert.deepEqual(handed.get(row.id, describe), {
      id: row.id, answer: row.answer, page: row.page, question: `${row.path} · p. ${row.page}`,
      path: row.path, revision: `rev-${row.path}`, source: `link:${row.path}#${row.page}`,
    });
  }
  assert.deepEqual([...handed.items()].map(i => [i.id, i.path, i.page, i.answer]), rows.map(r => [r.id, r.path, r.page, r.answer]));
  // Empty and missing-file reads fail safe without crashing.
  const missing = BookStore.fromData({ ...handed, textPath: join(dir, 'missing.bin') });
  assert.equal(missing.answer(0), '');
});
