// Fairy Scratch: one shared folder, ~/Fairy Scratch on the Mac Fairy runs on, for work that isn't about a project. A
// scratch work session is an ordinary work session (same sandbox, same approvals, whichever provider answers) whose
// folder is its own subfolder here, named for the day and its first message when that message is sent; so Claude,
// Codex and Gemini all find a chat's files in one place, and every chat's are side by side.
//
// Disk on the mini is tight, so Fairy trims it every hour: a chat's folder untouched for SCRATCH_DAYS goes, and while
// the whole is over its limit the oldest go first. A folder whose chat is working, or was used in the last day, is
// never touched. With the disk nearly full the limit drops to SCRATCH_LOW_LIMIT. Trimmed means deleted, not moved to
// the Trash, which would free nothing; a chat whose folder was trimmed gets an empty one if you carry on in it.
import { lstat, mkdir, readdir, realpath, rm, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

export const SCRATCH_NAME = 'Fairy Scratch', SCRATCH_LIMIT = 5 * 1024 ** 3, SCRATCH_LOW_LIMIT = 1024 ** 3, SCRATCH_DAYS = 14;
export const IN_USE_MS = 24 * 3600 * 1000, LOW_DISK = 15 * 1024 ** 3, TRIM_EVERY_MS = 3600 * 1000;
const MAX_ENTRIES = 200_000;

export const scratchRoot = (home = homedir()) => join(home, SCRATCH_NAME);
const day = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// A chat's folder name: the day, then the first few words of its first message, as a file name can hold them.
export function chatFolderName(text, now = new Date()) {
  const words = String(text ?? '').replace(/^\/\S+\s*/, '').replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  let name = '';
  for (const word of words) { if (`${name} ${word}`.trim().length > 40) break; name = `${name} ${word}`.trim(); }
  return `${day(now)} ${name || 'Scratch'}`;
}
// Makes the chat's folder, a new one even if a folder of that name is there already ("… 2", "… 3").
export async function newChatFolder(root, text, now = new Date()) {
  await mkdir(root, { recursive: true, mode: 0o755 });
  const base = chatFolderName(text, now);
  for (let n = 1; n < 1000; n++) {
    const path = join(root, n === 1 ? base : `${base} ${n}`);
    try { await mkdir(path, { mode: 0o755 }); return path; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Fairy couldn’t make a folder for this chat in Fairy Scratch.');
}
// Whether a folder is Scratch itself (a scratch session that hasn't had its first message) or one of its chats'.
export async function scratchPlace(path, root) {
  let real = path, base = root;
  // A folder the trim removed is placed by its parent's real path.
  try { real = await realpath(path); } catch { try { real = join(await realpath(dirname(path)), basename(path)); } catch {} }
  try { base = await realpath(root); } catch {}
  if (real === base) return 'root';
  return real.startsWith(base + sep) && !real.slice(base.length + 1).includes(sep) ? 'chat' : null;
}
// A folder's size and when anything in it last changed, without following links out of it.
export async function folderUsage(dir) {
  let bytes = 0, latest = 0, seen = 0;
  const walk = async path => {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return;
      const full = join(path, entry.name), info = await lstat(full).catch(() => null);
      if (!info) continue;
      latest = Math.max(latest, info.mtimeMs);
      if (entry.isDirectory()) await walk(full); else bytes += info.size;
    }
  };
  const top = await lstat(dir).catch(() => null);
  if (top) latest = top.mtimeMs;
  await walk(dir);
  return { bytes, latest };
}
// Each chat folder with its size and last change, oldest first.
export async function scratchFolders(root) {
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.')) out.push({ name: entry.name, path: join(root, entry.name), ...(await folderUsage(join(root, entry.name))) });
  return out.sort((a, b) => a.latest - b.latest);
}
// How much Scratch may hold now: less when the disk is nearly full.
export async function scratchLimit(root, { free = async path => { const s = await statfs(path); return s.bavail * s.bsize; } } = {}) {
  try { return (await free(root)) < LOW_DISK ? SCRATCH_LOW_LIMIT : SCRATCH_LIMIT; } catch { return SCRATCH_LIMIT; }
}
// The trim. keep(path): whether a chat folder is in use and must stay.
export async function trimScratch({ root, keep = () => false, limit = SCRATCH_LIMIT, days = SCRATCH_DAYS, now = Date.now(), remove = path => rm(path, { recursive: true, force: true }) }) {
  const folders = await scratchFolders(root), removed = [];
  let total = folders.reduce((sum, folder) => sum + folder.bytes, 0);
  const drop = async folder => { await remove(folder.path); removed.push({ name: folder.name, bytes: folder.bytes }); total -= folder.bytes; folder.gone = true; };
  for (const folder of folders) if (now - folder.latest > days * 86_400_000 && !keep(folder.path)) await drop(folder);
  for (const folder of folders) { if (total <= limit) break; if (!folder.gone && !keep(folder.path)) await drop(folder); }
  return { removed, total, folders: folders.filter(folder => !folder.gone).length, limit };
}
