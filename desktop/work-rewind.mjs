import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const hash = text => createHash('sha256').update(text).digest('hex');
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
// What a turn's file tools changed: each file as it was before the turn, and a fingerprint of what the turn left.
export function checkpointFrom(journal) {
  const files = new Map();
  for (const { path, before, after } of journal) {
    const entry = files.get(path) || { path, before };
    entry.after = hash(after);
    files.set(path, entry);
  }
  return { files: [...files.values()] };
}
function sessionDir(dir, sessionId) {
  if (!SAFE_ID.test(sessionId)) throw new Error('That chat isn’t valid.');
  return join(dir, sessionId);
}
export async function saveCheckpoint({ dir, sessionId, turn, journal }) {
  if (!journal.length) return false;
  const folder = sessionDir(dir, sessionId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(join(folder, `${Number(turn)}.json`), JSON.stringify(checkpointFrom(journal)), { mode: 0o600 });
  return true;
}
// A command could have swapped a folder for a link since, and rewinding runs outside the sandbox.
async function staysInside(root, full) {
  for (let existing = dirname(full); ; existing = dirname(existing)) {
    try { const place = await realpath(existing); return place === root || place.startsWith(root + sep); }
    catch (error) { if (error.code !== 'ENOENT' || existing === root) return false; }
  }
}
async function restoreFile(root, file) {
  const full = resolve(root, file.path);
  if (!full.startsWith(root + sep) || !await staysInside(root, full)) return 'conflict';
  let current = null, mode = 0o644;
  try {
    const info = await lstat(full);
    if (!info.isFile()) return 'conflict';
    mode = info.mode & 0o777;
    current = await readFile(full, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Something else changed it since, such as you or a command, so it's left as it is.
  if (current === null ? file.before === null : hash(current) !== file.after) return current === file.before ? 'same' : 'conflict';
  if (file.before === null) await rm(full, { force: true });
  else {
    await mkdir(dirname(full), { recursive: true });
    const temporary = `${full}.${randomUUID()}.fairy-tmp`;
    try { await writeFile(temporary, file.before, { flag: 'wx', mode }); await rename(temporary, full); }
    finally { await rm(temporary, { force: true }); }
  }
  return 'restored';
}
// Undoes what the file tools did from a turn onwards, newest first. Commands can't be undone this way.
export async function rewindFiles({ dir, sessionId, root, fromTurn }) {
  const folder = sessionDir(dir, sessionId), restored = [], conflicts = [];
  let names = [];
  try { names = await readdir(folder); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const turns = names.map(name => Number(name.replace(/\.json$/, ''))).filter(turn => Number.isInteger(turn) && turn >= fromTurn).sort((a, b) => b - a);
  for (const turn of turns) {
    const { files = [] } = JSON.parse(await readFile(join(folder, `${turn}.json`), 'utf8'));
    for (const file of files) {
      const result = await restoreFile(root, file);
      if (result === 'restored' && !restored.includes(file.path)) restored.push(file.path);
      if (result === 'conflict' && !conflicts.includes(file.path)) conflicts.push(file.path);
    }
    await rm(join(folder, `${turn}.json`), { force: true });
  }
  return { restored, conflicts: conflicts.filter(path => !restored.includes(path)) };
}
export const removeCheckpoints = (dir, sessionId) => rm(sessionDir(dir, sessionId), { recursive: true, force: true });
