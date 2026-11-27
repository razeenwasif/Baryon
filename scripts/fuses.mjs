// Electron's fuses: switches baked into the Electron Framework binary, which a packaged app can't be talked out of at
// run time. Left at their defaults, anyone who can start Fairy's program can run their own script with it
// (ELECTRON_RUN_AS_NODE=1), under her name and so with her permissions. This turns those off in a packaged copy.
//
// The binary holds a sentinel, then one byte for the format's version, one for how many fuses there are, then a
// character per fuse: '1' on, '0' off, 'r' removed. A fuse can only be changed between '0' and '1', and the app has
// to be signed after, since this changes the binary. It's the same edit @electron/fuses makes, done here so the
// build doesn't need another package.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
// In the order Electron keeps them.
export const FUSES = ['runAsNode', 'cookieEncryption', 'nodeOptions', 'nodeCliInspect', 'asarIntegrity', 'onlyLoadAppFromAsar', 'browserV8Snapshot', 'grantFileProtocolExtraPrivileges'];
// What a packaged Fairy sets. Off: running as plain Node, NODE_OPTIONS, and --inspect. On: the two asar fuses, so
// Electron runs her code only from Resources/app.asar and only if the archive matches the hash in the signed
// Info.plist; an edited or swapped file stops her starting. The file: one stays on because her window is loaded from
// a file.
export const LOCKED = Object.freeze({ runAsNode: false, nodeOptions: false, nodeCliInspect: false, asarIntegrity: true, onlyLoadAppFromAsar: true });

// Every copy of the fuses in the binary (a universal build has one per architecture), as offsets of the first fuse.
function wires(bytes) {
  const found = [], sentinel = Buffer.from(SENTINEL);
  for (let at = bytes.indexOf(sentinel); at >= 0; at = bytes.indexOf(sentinel, at + 1)) {
    const version = bytes[at + sentinel.length], count = bytes[at + sentinel.length + 1];
    if (version !== 1) throw new Error(`Electron's fuses are in a format this build doesn't know (version ${version}).`);
    found.push({ start: at + sentinel.length + 2, count });
  }
  if (!found.length) throw new Error('No fuses were found in the Electron Framework binary.');
  return found;
}

// The fuses as they stand: true, false, or null for one Electron has removed. A universal binary's copies must agree.
export function readFuses(bytes) {
  const all = wires(bytes).map(({ start, count }) => Object.fromEntries(FUSES.slice(0, count).map((name, index) => {
    const state = String.fromCharCode(bytes[start + index]);
    return [name, state === '1' ? true : state === '0' ? false : null];
  })));
  for (const other of all.slice(1)) if (JSON.stringify(other) !== JSON.stringify(all[0])) throw new Error('The fuses differ between the architectures in this binary.');
  return all[0];
}

// Sets the wanted fuses in place and returns how many bytes changed. A fuse this Electron doesn't have, or has
// removed, is an error: silently skipping it would leave a build that looks locked and isn't.
export function setFuses(bytes, wanted = LOCKED) {
  let changed = 0;
  for (const { start, count } of wires(bytes)) {
    for (const [name, on] of Object.entries(wanted)) {
      const index = FUSES.indexOf(name);
      if (index < 0 || index >= count) throw new Error(`This Electron has no fuse called ${name}.`);
      const state = String.fromCharCode(bytes[start + index]);
      if (state !== '0' && state !== '1') throw new Error(`Electron has removed the ${name} fuse, so it can't be set.`);
      const next = on ? '1' : '0';
      if (state !== next) { bytes[start + index] = next.charCodeAt(0); changed++; }
    }
  }
  return changed;
}

export const frameworkBinary = app => join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework');

// Locks the fuses of the Electron app at `app`, before it's signed. Resolves to the fuses as they now stand.
export async function lockFuses(app, wanted = LOCKED) {
  const file = frameworkBinary(app), bytes = await readFile(file);
  if (setFuses(bytes, wanted)) await writeFile(file, bytes);
  return readFuses(bytes);
}

// Throws unless the app at `app` has the wanted fuses, for checking a finished build.
export async function assertFuses(app, wanted = LOCKED) {
  const fuses = readFuses(await readFile(frameworkBinary(app)));
  for (const [name, on] of Object.entries(wanted)) if (fuses[name] !== on) throw new Error(`The ${name} fuse is ${fuses[name] ? 'on' : 'off'} in the built app; it should be ${on ? 'on' : 'off'}. Do not install this build.`);
  return fuses;
}
