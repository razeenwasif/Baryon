// Two Macs (docs/fairy-on-two-macs-plan.md): copies the folders Fairy works with to the same places on the Mac mini, so
// her notes, books, courses and work sessions find them there.
//
//   node scripts/folders-to-mini.mjs [--host mini] [--dry-run] [--everything] [folder …]
//
// Folders are given relative to your home (default: Courses, OnyxVault, Documents/Books, Research, Github). It uses
// rsync over SSH, so running it again sends only what changed. It never deletes anything on the mini, and it never
// replaces a file there that is newer than this Mac's (-u), so work done on the mini is safe. node_modules, Python
// virtual environments and caches are left out unless --everything: they're big and rebuilt from the project.
// This is a copy, not a sync: for folders you'll edit on both Macs, a sync service (iCloud Drive, Obsidian Sync,
// Syncthing) or git is the better home.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FOLDERS = ['Courses', 'OnyxVault', 'Documents/Books', 'Research', 'Github'];
export const REBUILT = ['node_modules', '.venv', 'venv', '__pycache__', '.DS_Store'];

export function parseArgs(argv) {
  const options = { host: 'mini', dryRun: false, everything: false, folders: [] };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (word === '--host') options.host = argv[++i];
    else if (word === '--dry-run') options.dryRun = true;
    else if (word === '--everything') options.everything = true;
    else if (word.startsWith('--')) throw new Error(`Not an option: ${word}`);
    else options.folders.push(word);
  }
  if (!/^[A-Za-z0-9._@-]+$/.test(options.host ?? '')) throw new Error('That isn’t a host name from your SSH config.');
  if (!options.folders.length) options.folders = [...FOLDERS];
  for (const folder of options.folders) {
    const clean = normalize(folder).replace(/\/+$/, '');
    if (isAbsolute(folder) || clean.startsWith('..') || clean === '.' || !/^[A-Za-z0-9 ._@/-]+$/.test(clean)) throw new Error(`Give folders inside your home, like Courses or Documents/Books: ${folder}`);
  }
  options.folders = options.folders.map(folder => normalize(folder).replace(/\/+$/, ''));
  return options;
}

// rsync's arguments for one folder: this Mac's ~/folder/ to the same path under the mini's home.
export function rsyncArgs(folder, { host, dryRun = false, everything = false, home = homedir(), ssh = 'ssh' }) {
  return ['-a', '-u', '--partial', '--stats', ...(dryRun ? ['-n'] : []), ...(everything ? [] : REBUILT.flatMap(name => ['--exclude', name])),
    '-e', `${ssh} -o BatchMode=yes -o ConnectTimeout=10`, `${join(home, folder)}/`, `${host}:${folder}/`];
}

function run(command, args, { log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', part => { out += part; }); child.stderr.on('data', part => { err += part; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${command} failed: ${(err || out).trim().split('\n').slice(-3).join(' ')}`)));
  });
}
const sent = stats => /total size is ([\d,]+)/.exec(stats)?.[1]?.replaceAll(',', '') ?? '?';
const gigabytes = bytes => Number.isFinite(Number(bytes)) ? `${(Number(bytes) / 1e9).toFixed(1)} GB` : '?';

export async function copyFolders({ options, home = homedir(), ssh = 'ssh', rsync = 'rsync', log = console.log }) {
  const done = [];
  for (const folder of options.folders) {
    const source = join(home, folder);
    if (!existsSync(source) || !statSync(source).isDirectory()) { log(`${folder}: not on this Mac, skipped.`); continue; }
    // rsync makes the folder itself, not the ones above it.
    if (dirname(folder) !== '.' && !options.dryRun) await run(ssh, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', options.host, 'mkdir', '-p', `'${dirname(folder).replaceAll("'", "'\\''")}'`], { log });
    log(`${folder}: ${options.dryRun ? 'checking' : 'copying'}…`);
    const stats = await run(rsync, rsyncArgs(folder, { ...options, home, ssh }), { log });
    log(`${folder}: ${options.dryRun ? 'would send from' : 'done,'} ${gigabytes(sent(stats))}${options.dryRun ? ' in all (only what differs is sent)' : ' in the folder'}.`);
    done.push(folder);
  }
  return done;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(`To ${options.host}: ${options.folders.join(', ')}${options.everything ? '' : ` (leaving out ${REBUILT.join(', ')})`}${options.dryRun ? ', as a dry run' : ''}.`);
    copyFolders({ options }).then(() => console.log(options.dryRun ? 'Dry run: nothing was copied.' : 'All copied. Running this again sends only what changed.'), error => { console.error(error.message); process.exit(1); });
  } catch (error) { console.error(error.message); process.exit(2); }
}
