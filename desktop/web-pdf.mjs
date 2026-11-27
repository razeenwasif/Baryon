import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeBin } from './bundle-path.cjs';
import { hasFeature, optionalImport } from './edition.mjs';

const studyMod = hasFeature('notebooks') ? await optionalImport('./notebook/study-helper.mjs', import.meta.url) : null;
const studyHelper = studyMod?.studyHelper || null;

const SANDBOX_EXEC = '/usr/bin/sandbox-exec', HELPER = nativeBin('fairy-document');
export const MAX_OCR_PAGES = 20;
const MAX_PDF = 100 * 1024 * 1024, MAX_TEXT = 2000000, MAX_LINE = 2 * 1024 * 1024, FETCH_LIMIT = 90000, READ_LIMIT = 60000, SHOWN_EMPTY = 40;
// Where a person's own things are kept, and the temp folders where other programs leave theirs.
const PRIVATE_PLACES = ['/Users', '/Volumes', '/private/tmp', '/private/var/folders', '/private/var/root', '/Library/Keychains'];
const SERVICES = ['com.apple.system.logger', 'com.apple.logd', 'com.apple.diagnosticd', 'com.apple.cfprefsd.daemon', 'com.apple.cfprefsd.agent', 'com.apple.system.notification_center', 'com.apple.fonts', 'com.apple.FontObjectsServer'];
const quoted = path => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const real = path => { try { return realpathSync(path); } catch { return path; } };

// This file came from a stranger, and parsers have bugs. Whatever one could do to the reader stays inside it:
// it gets the file as an open descriptor and can only answer on its output, with no network, no writing and none of your files.
export function pdfProfile(program = HELPER) {
  const path = real(program);
  return ['(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)', '(allow file-write* (literal "/dev/null"))',
    '(deny lsopen)', '(deny appleevent-send)', '(deny job-creation)', '(deny process-fork)', '(deny process-exec*)', `(allow process-exec (literal ${quoted(path)}))`,
    '(deny signal)', '(allow signal (target self))', '(deny mach-lookup)', `(allow mach-lookup ${SERVICES.map(name => `(global-name ${quoted(name)})`).join(' ')})`,
    `(deny file-read-data file-read-xattr ${PRIVATE_PLACES.map(place => `(subpath ${quoted(place)})`).join(' ')})`,
    `(allow file-read-data file-read-xattr (literal ${quoted(path)}))`].join('\n');
}
export const isPdf = bytes => bytes.subarray(0, 1024).includes('%PDF-');
export const looksLikePdf = ({ type = '', name = '', url = '' } = {}) => {
  let path = '';
  try { path = new URL(url).pathname; } catch {}
  return /pdf/i.test(type) || /\.pdf$/i.test(name) || /\.pdf$/i.test(path);
};
export function pdfName(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last).slice(0, 300) || 'PDF';
  } catch { return 'PDF'; }
}
// The whole file comes down in the throwaway browser's own session, so the rules on what it may reach still apply.
export async function downloadPdf({ fetcher, url, signal, limit = MAX_PDF, timeout = FETCH_LIMIT }) {
  signal?.throwIfAborted();
  const timed = new AbortController(), clock = setTimeout(() => timed.abort(), timeout), stop = AbortSignal.any(signal ? [signal, timed.signal] : [timed.signal]);
  let stopped;
  const stopping = new Promise((_, reject) => {
    stopped = () => reject(signal?.aborted ? signal.reason : new Error('The PDF took too long to download.'));
    if (stop.aborted) stopped(); else stop.addEventListener('abort', stopped, { once: true });
  });
  stopping.catch(() => {});
  let reader;
  try {
    let response;
    try { response = await Promise.race([fetcher(url, { signal: stop }), stopping]); }
    catch (error) {
      if (stop.aborted) await stopping;
      throw new Error(`The PDF couldn’t be downloaded: ${String(error?.message ?? error).replace(/^net::/, '').slice(0, 200)}`);
    }
    if (response.status >= 400) throw new Error(`The site answered with status ${response.status} when asked for the PDF.`);
    const tooBig = () => new Error(`That PDF is over ${Math.round(limit / 1024 / 1024)} MB, so it’s too big to read here.`);
    if (Number(response.headers?.get?.('content-length')) > limit) throw tooBig();
    if (!response.body) throw new Error('The site sent back an empty file.');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopping]);
      if (done) break;
      size += value.length;
      if (size > limit) throw tooBig();
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.length));
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(clock);
    stop.removeEventListener('abort', stopped);
    reader?.cancel().catch(() => {});
  }
}
// Reads pages until the file ends, the reader stops or there's enough. Pages already read are kept, whichever it was.
export function readPages(descriptor, { signal, program = HELPER, command = SANDBOX_EXEC, args = ['-p', pdfProfile(program), program], limit = MAX_TEXT, timeout = READ_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe', descriptor], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    const pages = [];
    let pending = '', size = 0, summary = null, problem = '', settled = false, ending = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason);
      if (!pages.length) return reject(new Error(problem || 'The PDF reader stopped before it read anything.'));
      resolve({ pages, summary });
    };
    const end = reason => { if (ending) return; ending = true; if (reason) problem = reason; child.kill('SIGKILL'); };
    const abort = () => { end(); finish(); };
    const timer = setTimeout(() => end('Reading the PDF took too long.'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => { problem = 'The PDF reader couldn’t start.'; finish(); });
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (ending) return;
      pending += data;
      let at;
      while (!ending && (at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        let row;
        try { row = JSON.parse(line); } catch { end('The PDF reader sent back something it shouldn’t.'); break; }
        if (row.done) summary = row;
        else if (Number.isInteger(row.page) && typeof row.text === 'string') {
          pages.push({ page: row.page, text: row.text });
          size += row.text.length;
          if (size >= limit) end();
        }
      }
      if (pending.length > MAX_LINE) {
        // A failure comes back as one object with no line ending, and that's small. This isn't.
        end('The PDF reader sent back something it shouldn’t.');
      }
    });
    child.on('close', () => {
      try { const failed = JSON.parse(pending); if (typeof failed?.error === 'string') problem = failed.error.slice(0, 200); } catch {}
      finish();
    });
    if (signal?.aborted) abort();
    else child.stdin.end(JSON.stringify({ descriptor: true, index: true }));
  });
}
const clean = text => String(text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const ranges = list => {
  const parts = [];
  for (let index = 0; index < list.length; index += 1) {
    let end = index;
    while (end + 1 < list.length && list[end + 1] === list[end] + 1) end += 1;
    parts.push(end > index ? `${list[index]}-${list[end]}` : `${list[index]}`);
    index = end;
  }
  return parts;
};
// Every page is marked, so what's said about the PDF can be traced to where it says it. What couldn't be read is said up front.
// ocred: the pages whose words were read from a picture of them, which may have mistakes.
export function pdfText({ pages, summary, ocred = new Set() }, limit = MAX_TEXT) {
  const kept = pages.map(page => ({ page: page.page, text: clean(page.text) })), written = kept.filter(page => page.text), empty = kept.filter(page => !page.text).map(page => page.page);
  if (!written.length) throw new Error('That PDF has no text to read, even from pictures of its pages.');
  const last = kept.at(-1).page, total = summary?.totalPages, notes = [`PDF, ${total ?? `at least ${last}`} ${(total ?? last) === 1 ? 'page' : 'pages'}.`];
  const pictured = written.map(page => page.page).filter(page => ocred.has(page));
  if (pictured.length) notes.push(`${pictured.length === 1 ? 'Page' : 'Pages'} ${ranges(pictured).join(', ')} ${pictured.length === 1 ? 'is a scan, so its words were' : 'are scans, so their words were'} read from ${pictured.length === 1 ? 'a picture of it' : 'pictures of them'} on this Mac and may have mistakes.`);
  if (empty.length) {
    const shown = ranges(empty);
    notes.push(`No text on ${empty.length === 1 ? 'page' : 'pages'} ${shown.slice(0, SHOWN_EMPTY).join(', ')}${shown.length > SHOWN_EMPTY ? ' and others' : ''}, which may be scans or pictures.`);
  }
  if (summary?.clippedPages) notes.push(`${summary.clippedPages} very long ${summary.clippedPages === 1 ? 'page was' : 'pages were'} cut short.`);
  if (!total || last < total) notes.push(`This stops at page ${last}, because that’s as far as it could be read here.`);
  const text = `${notes.join(' ')}\n\n${written.map(page => `--- Page ${page.page} ---\n${page.text}`).join('\n\n')}`;
  return text.length > limit ? text.slice(0, limit) : text;
}
// A picture of one page, drawn by the same sandboxed reader from its own descriptor (the reader reads to the end of
// the file it's given, so each drawing needs one of its own).
export function renderPage(descriptor, page, { signal, program = HELPER, command = SANDBOX_EXEC, args = ['-p', pdfProfile(program), program], timeout = READ_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe', descriptor], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    let out = '', settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); } };
    const abort = () => { child.kill('SIGKILL'); finish(reject, signal.reason); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, new Error('Drawing a page of the PDF took too long.')); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(reject, new Error('The PDF reader couldn’t start.')));
    child.stdin.on('error', () => {}); child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => { out += data; if (out.length > 40 * 1024 * 1024) { child.kill('SIGKILL'); finish(reject, new Error('The page’s picture was too big.')); } });
    child.on('close', () => {
      let value = null; try { value = JSON.parse(out); } catch {}
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(value?.url || '');
      if (match) finish(resolve, Buffer.from(match[1], 'base64')); else finish(reject, new Error(String(value?.error || 'The page couldn’t be drawn.').slice(0, 200)));
    });
    child.stdin.end(JSON.stringify({ descriptor: true, pdf: true, image: true, start: page, size: 2000 }));
  });
}
// A scanned page's words: its picture, read by Vision through the study helper. Nothing leaves the Mac.
async function readScan(picture, { signal, folder }) {
  if (!studyHelper) return '';
  const path = join(folder, `page-${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(path, picture, { mode: 0o600 });
  try { return String((await studyHelper('read-picture', path, { signal, timeout: 120000 })).text || ''); }
  finally { await rm(path, { force: true }); }
}
// The reader gets a read-only descriptor to a file that no longer has a name, so nothing else can find it and it goes away with the last close.
// A page with no text is a scan or a picture: up to MAX_OCR_PAGES of them are drawn and their words read (ocr: false
// leaves them unread; a function stands in for drawing and reading, for tests).
export async function pdfToText(bytes, { signal, program = HELPER, command, args, limit = MAX_TEXT, timeout, ocr = true } = {}) {
  signal?.throwIfAborted();
  if (!isPdf(bytes)) throw new Error('That address says it’s a PDF, but what came back isn’t one.');
  if (!command && !existsSync(SANDBOX_EXEC)) throw new Error('PDFs can’t be read safely on this Mac, because its sandbox is missing.');
  if (!existsSync(program)) throw new Error('Build the PDF reader first: npm run build:document');
  const folder = await mkdtemp(join(real(tmpdir()), 'fairy-pdf-'));
  const handles = [];
  try {
    const path = join(folder, 'file.pdf');
    await writeFile(path, bytes, { mode: 0o600 });
    // One descriptor to read the text, and one for each scanned page that may need drawing, all opened before the name goes.
    for (let index = 0; index <= (ocr ? MAX_OCR_PAGES : 0); index += 1) handles.push(await open(path, 'r'));
    await rm(path, { force: true });
    const spawning = { program, ...(command ? { command } : {}), ...(args ? { args } : {}) };
    const read = await readPages(handles[0].fd, { signal, ...spawning, limit, ...(timeout ? { timeout } : {}) });
    const ocred = new Set();
    if (ocr) {
      const scans = read.pages.filter(page => !clean(page.text)).slice(0, MAX_OCR_PAGES);
      for (const [index, page] of scans.entries()) {
        signal?.throwIfAborted();
        try {
          const text = typeof ocr === 'function' ? await ocr(page.page, { signal }) : await readScan(await renderPage(handles[index + 1].fd, page.page, { signal, ...spawning }), { signal, folder });
          if (clean(text)) { page.text = text; ocred.add(page.page); }
        } catch (error) { if (signal?.aborted) throw error; }
      }
    }
    return pdfText({ ...read, ocred }, limit);
  } finally {
    await Promise.all(handles.map(handle => handle.close().catch(() => {})));
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
export async function readPdf({ fetcher, url, signal, extract = pdfToText }) {
  const bytes = await downloadPdf({ fetcher, url, signal });
  signal?.throwIfAborted();
  return { title: pdfName(url), url, status: 200, text: await extract(bytes, { signal }), links: [] };
}
