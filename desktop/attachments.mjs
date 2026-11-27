import { copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants, existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canRead, excludedPath, sourceLink } from './local-files.mjs';

export const ATTACHMENT_SIZE = 20 * 1024 * 1024, ATTACHMENTS_AT_ONCE = 10, ATTACHMENTS_READABLE = 20;
// A folder comes zipped (the iPhone zips one as it's chosen). These keep a folder to what Fairy can sensibly read.
export const FOLDER_ZIP_SIZE = 50 * 1024 * 1024, FOLDER_SIZE = 200 * 1024 * 1024, FOLDER_FILES = 1000;
const unzipWithDitto = (zip, into) => promisify(execFile)('/usr/bin/ditto', ['-x', '-k', zip, into]);
const ID = /^[a-f0-9-]{36}$/;
const cleanName = name => basename(String(name ?? '').replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f:]/g, '').trim().slice(-120);
function checkName(raw) {
  const name = cleanName(raw);
  if (!name) throw new Error('That file has no name Fairy can use.');
  if (excludedPath(name)) throw new Error(`${name} looks like it could hold a secret, so it can’t be attached.`);
  if (!canRead(name)) throw new Error(`Fairy can’t read ${extname(name) || 'that kind of'} files yet. Attach text, code, notebooks, PDFs or PNG, JPEG or WebP pictures.`);
  return name;
}
const tooBig = name => new Error(`${name} is over 20 MB, which is as big as an attached file can be.`);
// Files added to a message, each in a folder of its own. They wait in staging until the message is saved, and staging is cleared at startup.
export class AttachmentStore {
  constructor({ dir, trash = path => rm(path, { recursive: true, force: true }), id = randomUUID }) { Object.assign(this, { dir, trash, id }); this.staging = join(dir, '.staging'); }
  folder(id) {
    if (!ID.test(id ?? '')) return null;
    return [join(this.dir, id), join(this.staging, id)].find(existsSync) ?? null;
  }
  has(id) { return Boolean(this.folder(id)); }
  async clearStaging() { await rm(this.staging, { recursive: true, force: true }); }
  async place(name, put) {
    const id = this.id(), folder = join(this.staging, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try { await put(join(folder, name)); }
    catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
    return this.record(id);
  }
  async addFile(path) {
    const name = checkName(basename(path)), info = await stat(path);
    if (!info.isFile()) throw new Error(`${name} isn’t a file.`);
    if (info.size > ATTACHMENT_SIZE) throw tooBig(name);
    if (!info.size) throw new Error(`${name} is empty.`);
    return this.place(name, target => copyFile(path, target, constants.COPYFILE_EXCL));
  }
  async addBytes(rawName, bytes) {
    const name = checkName(rawName), data = Buffer.from(bytes ?? []);
    if (data.length > ATTACHMENT_SIZE) throw tooBig(name);
    if (!data.length) throw new Error(`${name} is empty.`);
    return this.place(name, target => writeFile(target, data, { mode: 0o600, flag: 'wx' }));
  }
  // A folder, zipped, unpacked into one attachment under its own name. Anything that looks like it holds a secret, and
  // any link, is left out, as when attaching on the Mac; a folder too big or with too many files isn't added at all.
  async addFolderZip(rawName, bytes, unzip = unzipWithDitto) {
    const name = cleanName(rawName).replace(/\.zip$/i, ''), data = Buffer.from(bytes ?? []);
    if (!name) throw new Error('That folder has no name Fairy can use.');
    if (excludedPath(name)) throw new Error(`${name} looks like it could hold a secret, so it can’t be attached.`);
    if (!data.length) throw new Error(`${name} is empty.`);
    if (data.length > FOLDER_ZIP_SIZE) throw new Error(`${name} is over 50 MB zipped, which is as big as an attached folder can be.`);
    return this.place(name, async target => {
      const zip = `${target}.zip`, unpacked = `${target}.unpacked`;
      await writeFile(zip, data, { mode: 0o600, flag: 'wx' });
      try {
        await mkdir(unpacked, { mode: 0o700 });
        await unzip(zip, unpacked);
        // A zipped folder usually holds that one folder; take its contents as the attachment.
        const top = await readdir(unpacked), only = top.length === 1 ? join(unpacked, top[0]) : null;
        const root = only && (await lstat(only)).isDirectory() ? only : unpacked;
        let files = 0, size = 0;
        const tidy = async folder => {
          for (const entry of await readdir(folder)) {
            const path = join(folder, entry), info = await lstat(path);
            if (entry === '__MACOSX' || entry === '.DS_Store' || info.isSymbolicLink() || excludedPath(entry)) { await rm(path, { recursive: true, force: true }); continue; }
            if (info.isDirectory()) { await tidy(path); continue; }
            files += 1; size += info.size;
            if (files > FOLDER_FILES) throw new Error(`${name} has over ${FOLDER_FILES} files, which is more than an attached folder can hold.`);
            if (size > FOLDER_SIZE) throw new Error(`${name} is over 200 MB, which is as big as an attached folder can be.`);
          }
        };
        await tidy(root);
        if (!files) throw new Error(`${name} has no files Fairy can read.`);
        await rename(root, target);
      } finally {
        await rm(zip, { force: true });
        await rm(unpacked, { recursive: true, force: true });
      }
    });
  }
  // A file that can't be added doesn't stop the others.
  async addFiles(paths) {
    const added = [], failed = [];
    for (const path of paths) {
      try { added.push(await this.addFile(path)); } catch (error) { failed.push({ name: basename(path), message: error.message }); }
    }
    return { added, failed };
  }
  async record(id) {
    const folder = this.folder(id);
    if (!folder) throw new Error('That attached file has gone. Add it again.');
    const [name] = await readdir(folder), { size } = await stat(join(folder, name));
    return { id, name, size, source: sourceLink(id, name, 1, extname(name).toLowerCase() === '.pdf') };
  }
  async records(ids = []) {
    if (!Array.isArray(ids) || ids.length > ATTACHMENTS_AT_ONCE) throw new Error(`Attach up to ${ATTACHMENTS_AT_ONCE} files to a message.`);
    return Promise.all(ids.map(id => this.record(id)));
  }
  // Called once the message they came with is saved.
  async claim(items = []) {
    for (const { id } of items) if (existsSync(join(this.staging, id))) await rename(join(this.staging, id), join(this.dir, id));
  }
  // Rewinding puts a message's files back in the box with its text.
  async unclaim(items = []) {
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    for (const { id } of items) if (existsSync(join(this.dir, id))) await rename(join(this.dir, id), join(this.staging, id));
  }
  async discard(id) { if (ID.test(id ?? '')) await rm(join(this.staging, id), { recursive: true, force: true }); }
  async remove(items = []) {
    for (const { id } of items) {
      const folder = this.folder(id);
      if (folder) await Promise.resolve(this.trash(folder)).catch(error => console.warn('Could not remove an attached file:', error.message));
    }
  }
  root(id, now = false) {
    const folder = this.folder(id), [file] = readdirSync(folder);
    return { id, path: realpathSync(folder), name: `Attached: ${file}`, file, ...(now ? { now: true } : {}) };
  }
  // What a turn can read: this message's files, then the newest from earlier in the chat.
  rootsFor(history = [], current = []) {
    const seen = new Set(), roots = [];
    const take = (item, now) => { if (seen.has(item.id) || roots.length >= ATTACHMENTS_READABLE || !this.has(item.id)) return; seen.add(item.id); roots.push(this.root(item.id, now)); };
    for (const item of current) take(item, true);
    for (const entry of [...history].reverse()) for (const item of entry.attachments || []) take(item, false);
    return roots;
  }
}
