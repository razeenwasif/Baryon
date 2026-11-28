import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { commandPath } from './work-sandbox.mjs';
import { isSecretPath, lineDiff, type LineDiffResult } from './work-tools.mjs';

const COPY_LIMIT = 3 * 60 * 1000, MAX_TRACKED = 60000, MAX_BACK = 16 * 1024 * 1024, MAX_CHANGES = 500, MAX_DIFFED = 4 * 1024 * 1024, BATCH = 64, ENDING_LIMIT = 5000;
export const MAX_RUNNING = 3, MAX_KEPT = 8;
const NEVER = new Set(['.git', 'node_modules', '.DS_Store']);
// Without Git to say what's ignored, these are taken to be things that get rebuilt.
const REBUILT = new Set(['.next', 'dist', 'build', 'target', 'release', '__pycache__', '.venv', 'venv', '.cache']);
const inBatches = async <T,>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> => { for (let start = 0; start < items.length; start += BATCH) await Promise.all(items.slice(start, start + BATCH).map(work)); };
const isText = (bytes: Buffer): boolean => !bytes.subarray(0, 8000).includes(0);
const same = (a: Buffer | null, b: Buffer | null): boolean => a === null || b === null ? a === b : a.equals(b);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);

export interface FileMeta {
  size: number;
  time: number;
  mode: number;
}

export interface ProjectCopy {
  dir: string;
  work: string;
  base: string;
  files: Map<string, FileMeta>;
  ignored: Set<string> | null;
}

export interface CopyProjectOptions {
  root: string;
  place: string;
  signal?: AbortSignal;
  ignored?: Set<string> | null;
  limit?: number;
}

export interface CopyIgnoredOptions {
  from: string;
  to: string;
  ignored?: Iterable<string> | null;
  signal?: AbortSignal;
  limit?: number;
}

export interface HelperChange {
  path: string;
  kind: 'added' | 'changed' | 'removed';
  mode?: number;
  binary?: boolean;
  added: number;
  removed: number;
  diff?: LineDiffResult;
}

export interface SkippedChange {
  path: string;
  why: string;
}

export interface CollectChangesOptions {
  keepNotIgnored?: (root: string, paths: string[]) => Promise<string[]>;
  root?: string;
}

export interface CollectChangesResult {
  changes: HelperChange[];
  skipped: SkippedChange[];
}

export interface BringBackStep {
  path: string;
  kind: 'added' | 'changed' | 'removed';
  mode?: number;
  change: HelperChange;
  before?: Buffer | null;
  action?: 'same' | 'remove' | 'write' | 'conflict';
  content?: Buffer;
  merged?: boolean;
  why?: string;
}

export interface HelperMessage {
  text: string;
  at: string;
}

export interface HelperSeat {
  model: string;
  role?: string;
  standIn?: boolean;
  effort?: string;
  why?: string;
}

export type HelperStatus = 'copying' | 'running' | 'finished' | 'stopped' | 'failed';

export interface HelperEntry {
  id: string;
  chat: string;
  root: string;
  task: string;
  title: string;
  role: string;
  onSeat: (seat: HelperSeat) => void;
  status: HelperStatus;
  controller: AbortController;
  changes: HelperChange[];
  skipped: SkippedChange[];
  report: string;
  error: string;
  inbox: HelperMessage[];
  received: HelperMessage[];
  undelivered: HelperMessage[];
  copy?: ProjectCopy;
  done?: Promise<void>;
  restored?: boolean;
}

export interface HelperRunOptions {
  root: string;
  task: string;
  role: string;
  onSeat: (seat: HelperSeat) => void;
  signal: AbortSignal;
  onEvent: (event: unknown) => void;
  askLocal?: (request: Record<string, unknown>) => Promise<unknown>;
  messages: () => HelperMessage[];
}

export interface HelperStartOptions {
  chat: string;
  root: string;
  task: string;
  title: string;
  role?: string;
  onSeat?: (seat: HelperSeat) => void;
  signal?: AbortSignal;
  onEvent?: (event: unknown) => void;
  onDone?: (entry: HelperEntry) => void;
  askLocal?: (request: Record<string, unknown>) => Promise<unknown>;
}

export interface HelperPoolOptions {
  place: string;
  run: (opts: HelperRunOptions) => Promise<string>;
  ignoredPaths?: (root: string) => Promise<Set<string> | null>;
  keepNotIgnored?: (root: string, paths: string[]) => Promise<string[]>;
  limit?: number;
  kept?: number;
}

interface SavedHelperCopy {
  dir: string;
  work: string;
  base: string;
  files: Array<[string, FileMeta]>;
  ignored: string[] | null;
}

interface SavedHelperEntry {
  id: string;
  chat: string;
  root: string;
  task: string;
  title: string;
  role: string;
  status: HelperStatus;
  report: string;
  error: string;
  changes: HelperChange[];
  skipped: SkippedChange[];
  copy?: SavedHelperCopy;
}

function clone(root: string, target: string, signal: AbortSignal | undefined, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/cp', ['-cRp', root, target], { stdio: 'ignore' });
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, limit);
    signal?.addEventListener('abort', stop, { once: true });
    const finish = (callback: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); callback(); };
    child.on('error', error => finish(() => reject(error)));
    // A file it couldn't read isn't in the copy, so it isn't mistaken for one the helper removed.
    child.on('close', (_code, killed) => finish(() => killed ? reject(new Error(signal?.aborted ? 'Stopped.' : 'Copying the project took too long, so it can’t have a helper.')) : resolve()));
  });
}
async function walk(root: string, ignored: Set<string> | null | undefined, { track = true }: { track?: boolean } = {}): Promise<{ files: Map<string, FileMeta>; links: string[]; secrets: string[] }> {
  const files = new Map<string, FileMeta>(), links: string[] = [], secrets: string[] = [], queue = [{ dir: '', left: !track }];
  const leftOut = (rel: string, name: string) => ignored ? ignored.has(rel) : REBUILT.has(name);
  while (queue.length) {
    const { dir, left } = queue.pop()!;
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (NEVER.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name, skip = left || leftOut(rel, entry.name);
      if (isSecretPath(rel)) secrets.push(rel);
      else if (entry.isDirectory()) queue.push({ dir: rel, left: skip });
      else if (skip) continue;
      else if (entry.isSymbolicLink()) links.push(rel);
      else if (entry.isFile()) {
        if (files.size >= MAX_TRACKED) throw new Error('This project has too many files for a helper to keep track of.');
        files.set(rel, null as unknown as FileMeta);
      }
    }
  }
  await inBatches([...files.keys()], async rel => { const info = await lstat(join(root, rel)); files.set(rel, { size: info.size, time: info.mtimeMs, mode: info.mode & 0o755 }); });
  return { files, links, secrets };
}
// An instant copy-on-write copy of everything, so tests can run. A pristine copy of the project's own files shows later what the helper changed.
// Keys don't come along, and a chat's own checkout has its history elsewhere, which stays out of reach.
export async function copyProject({ root, place, signal, ignored = null, limit = COPY_LIMIT }: CopyProjectOptions): Promise<ProjectCopy> {
  await mkdir(place, { recursive: true, mode: 0o700 });
  if ((await stat(root)).dev !== (await stat(place)).dev) throw new Error('This project is on a different disk from your home folder, so helpers can’t have a copy of it.');
  const dir = await realpath(await mkdtemp(join(place, 'copy-'))), work = join(dir, 'work', basename(root)), base = join(dir, 'base');
  try {
    await mkdir(dirname(work)); await mkdir(base);
    await clone(root, work, signal, limit);
    if ((await lstat(join(work, '.git')).catch(() => null))?.isFile()) await rm(join(work, '.git'));
    const { files, secrets } = await walk(work, ignored);
    await Promise.all(secrets.map(rel => rm(join(work, rel), { recursive: true, force: true })));
    await inBatches([...files.keys()], async rel => {
      signal?.throwIfAborted();
      await mkdir(dirname(join(base, rel)), { recursive: true });
      await copyFile(join(work, rel), join(base, rel), constants.COPYFILE_FICLONE);
    });
    return { dir, work, base, files, ignored };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
// What Git ignores doesn't come with a checkout, and it's usually what a project needs to run: its dependencies and built programs. Keys stay behind.
export async function copyIgnored({ from, to, ignored, signal, limit = COPY_LIMIT }: CopyIgnoredOptions): Promise<string[]> {
  if ((await stat(from)).dev !== (await stat(to)).dev) return [];
  const copied: string[] = [];
  for (const path of ignored ?? []) {
    const target = join(to, path);
    if (isSecretPath(path) || await lstat(target).catch(() => null)) continue;
    await mkdir(dirname(target), { recursive: true });
    await clone(join(from, path), target, signal, limit);
    if ((await lstat(target)).isDirectory()) {
      const { secrets } = await walk(target, new Set(), { track: false });
      await Promise.all(secrets.map(rel => rm(join(target, rel), { recursive: true, force: true })));
    }
    copied.push(path);
  }
  return copied;
}
// A command left running could have swapped a file or folder for a link, and this runs outside the sandbox.
async function readInside(root: string, rel: string): Promise<Buffer> {
  const full = join(root, rel), place = await realpath(dirname(full));
  if (place !== root && !place.startsWith(root + sep)) throw new Error(`${rel} leads outside the copy.`);
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`${rel} isn’t an ordinary file.`);
    return await handle.readFile();
  } finally { await handle.close(); }
}
const describe = (before: Buffer | null, after: Buffer | null): { binary?: boolean; added: number; removed: number; diff?: LineDiffResult } => {
  const texts = [before, after].every(bytes => bytes === null || (bytes.length <= MAX_DIFFED && isText(bytes)));
  if (!texts) return { binary: true, added: 0, removed: 0 };
  const diff = lineDiff(before?.toString('utf8') ?? '', after?.toString('utf8') ?? '');
  return { added: diff.added, removed: diff.removed, diff };
};
// What the helper's copy now differs by. Ignored files, links, keys and Git's own files stay behind.
export async function collectChanges(copy: ProjectCopy, { keepNotIgnored = async (_root, paths) => paths, root = '' }: CollectChangesOptions = {}): Promise<CollectChangesResult> {
  const now = await walk(copy.work, copy.ignored), changes: Array<{ path: string; kind: 'added' | 'changed' | 'removed' }> = [], skipped: SkippedChange[] = [...now.links.map(path => ({ path, why: 'it’s a link' })), ...now.secrets.map(path => ({ path, why: 'it looks like a key or credentials file' }))];
  const links = new Set(now.links), added: string[] = [], changed: string[] = [];
  for (const path of copy.files.keys()) if (!now.files.has(path) && !links.has(path)) changes.push({ path, kind: 'removed' });
  for (const [path, info] of now.files) {
    const known = copy.files.get(path);
    if (!known) added.push(path);
    else if (known.size !== info.size || known.time !== info.time) changed.push(path);
  }
  for (const path of await keepNotIgnored(root, added)) changes.push({ path, kind: 'added' });
  for (const path of changed) changes.push({ path, kind: 'changed' });
  const kept: HelperChange[] = [];
  for (const change of changes.sort((a, b) => a.path.localeCompare(b.path))) {
    const info = now.files.get(change.path);
    if (info && info.size > MAX_BACK) { skipped.push({ path: change.path, why: 'it’s over 16 MB' }); continue; }
    if (kept.length >= MAX_CHANGES) { skipped.push({ path: change.path, why: `only ${MAX_CHANGES} files can come back at once` }); continue; }
    const before = change.kind === 'added' ? null : await readFile(join(copy.base, change.path));
    const after = change.kind === 'removed' ? null : await readInside(copy.work, change.path);
    if (same(before, after)) continue;
    kept.push({ ...change, ...(info ? { mode: info.mode } : {}), ...describe(before, after) });
  }
  return { changes: kept, skipped };
}
// Three-way, as Git would. Null when both sides changed the same lines.
export async function mergeText(current: Buffer, base: Buffer, theirs: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-merge-'));
  try {
    await Promise.all(([['current', current], ['base', base], ['theirs', theirs]] as const).map(([name, bytes]) => writeFile(join(dir, name), bytes, { mode: 0o600 })));
    return await new Promise((resolve, reject) => {
      execFile('git', ['merge-file', '-p', 'current', 'base', 'theirs'], { cwd: dir, env: { PATH: commandPath(), LANG: process.env.LANG || 'en_US.UTF-8' }, encoding: 'buffer', maxBuffer: MAX_BACK * 2, timeout: 30000 }, (error, stdout) => {
        if (!error) resolve(stdout);
        else if (typeof error.code === 'number' && error.code > 0 && error.code < 128) resolve(null);
        else reject(new Error('Git couldn’t compare the two versions.'));
      });
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
// What bringing the changes back would do to the project as it is now. `read` gives a project file's bytes, or null if it isn't there.
export async function planBringBack(copy: ProjectCopy, changes: readonly HelperChange[], read: (path: string) => Promise<Buffer | null>): Promise<BringBackStep[]> {
  const steps: BringBackStep[] = [];
  for (const change of changes) {
    const { path, kind, mode } = change, step: BringBackStep = { path, kind, mode, change };
    try {
      const current = await read(path);
      const base = kind === 'added' ? null : await readFile(join(copy.base, path)), theirs = kind === 'removed' ? null : await readInside(copy.work, path);
      step.before = current;
      if (same(current, theirs)) step.action = 'same';
      else if (same(current, base)) Object.assign(step, theirs === null ? { action: 'remove' } : { action: 'write', content: theirs });
      else if (current && base && theirs && isText(current) && isText(base) && isText(theirs) && current.length <= MAX_DIFFED) {
        const merged = await mergeText(current, base, theirs);
        Object.assign(step, merged ? { action: 'write', content: merged, merged: true } : { action: 'conflict', why: 'it changed the same lines in both' });
      } else Object.assign(step, { action: 'conflict', why: current === null ? 'it’s gone from the project' : theirs === null ? 'the helper removed it, but it has changed in the project' : 'it changed in both' });
    } catch (error) { Object.assign(step, { action: 'conflict', why: errorMessage(error) }); }
    steps.push(step);
  }
  return steps;
}
// The helpers working for each chat, and the copies they hold until their work is brought back or thrown away.
export class HelperPool {
  place!: string;
  run!: HelperPoolOptions['run'];
  ignoredPaths!: NonNullable<HelperPoolOptions['ignoredPaths']>;
  keepNotIgnored: HelperPoolOptions['keepNotIgnored'];
  limit!: number;
  kept!: number;
  chats: Map<string, Map<string, HelperEntry>>;
  numbers: Map<string, number>;
  saving?: Promise<void>;

  constructor({ place, run, ignoredPaths = async () => null, keepNotIgnored, limit = MAX_RUNNING, kept = MAX_KEPT }: HelperPoolOptions) {
    Object.assign(this, { place, run, ignoredPaths, keepNotIgnored, limit, kept });
    this.chats = new Map(); this.numbers = new Map();
  }
  list(chat: string): HelperEntry[] { return [...(this.chats.get(chat)?.values() ?? [])]; }
  get(chat: string, id: string): HelperEntry {
    const entry = this.chats.get(chat)?.get(id);
    if (!entry) throw new Error(`There’s no helper called ${id} in this chat.`);
    return entry;
  }
  running(chat: string): HelperEntry[] { return this.list(chat).filter(entry => entry.status === 'running' || entry.status === 'copying'); }
  // What's still waiting on a decision.
  waiting(chat: string): HelperEntry[] { return this.list(chat).filter(entry => entry.status !== 'running' && entry.status !== 'copying' && entry.changes?.length); }
  // role is the orchestrator's (builder unless the lead named another); onSeat hears which model took it.
  async start({ chat, root, task, title, role = 'builder', onSeat = () => {}, signal, onEvent = () => {}, onDone = () => {}, askLocal }: HelperStartOptions): Promise<HelperEntry> {
    if (this.running(chat).length >= this.limit) throw new Error(`${this.limit} helpers are already working. Wait for one to finish.`);
    if (this.list(chat).length >= this.kept) throw new Error(`This chat already has ${this.kept} helpers holding work. Bring theirs back or discard it first.`);
    const number = (this.numbers.get(chat) ?? 0) + 1, id = `h${number}`, controller = new AbortController(), stopping = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const entry: HelperEntry = { id, chat, root, task, title, role, onSeat, status: 'copying', controller, changes: [], skipped: [], report: '', error: '', inbox: [], received: [], undelivered: [] };
    this.numbers.set(chat, number);
    let chatMap = this.chats.get(chat);
    if (!chatMap) { chatMap = new Map(); this.chats.set(chat, chatMap); }
    chatMap.set(id, entry);
    try { entry.copy = await copyProject({ root, place: this.place, signal: stopping, ignored: await this.ignoredPaths(root) }); }
    catch (error) { chatMap.delete(id); throw error; }
    entry.status = 'running';
    entry.done = this.work(entry, task, stopping, onEvent, askLocal).then(() => this.save()).then(() => onDone(entry));
    return entry;
  }
  async work(entry: HelperEntry, task: string, signal: AbortSignal, onEvent: (event: unknown) => void, askLocal: HelperStartOptions['askLocal']): Promise<void> {
    try {
      entry.report = await this.run({ root: entry.copy!.work, task, role: entry.role, onSeat: entry.onSeat, signal, onEvent, askLocal, messages: () => this.deliver(entry) });
      entry.status = 'finished';
    } catch (error) {
      entry.status = signal.aborted ? 'stopped' : 'failed';
      entry.error = errorMessage(error);
    }
    // A message that arrived after its last step never reached it.
    entry.undelivered = entry.inbox.splice(0);
    // Whatever it had done by then can still be looked at.
    try { Object.assign(entry, await collectChanges(entry.copy!, { keepNotIgnored: this.keepNotIgnored, root: entry.root })); }
    catch (error) { entry.error ||= `Couldn’t see what it changed: ${errorMessage(error)}`; }
  }
  // Up to `limit`, since a tool call can't be left waiting indefinitely.
  async wait(entries: readonly HelperEntry[], limit: number, signal?: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined, stopped: (() => void) | undefined;
    const finished = Promise.allSettled(entries.map(entry => entry.done));
    const late = new Promise<void>(resolve => { timer = setTimeout(resolve, limit); }), halted = new Promise<never>((_, reject) => { stopped = () => reject(new Error('Stopped.')); signal?.addEventListener('abort', stopped, { once: true }); if (signal?.aborted) stopped(); });
    try { await Promise.race([finished, late, halted]); }
    finally { clearTimeout(timer); if (stopped) signal?.removeEventListener('abort', stopped); }
  }
  plan(entry: HelperEntry, read: (path: string) => Promise<Buffer | null>): Promise<BringBackStep[]> { return planBringBack(entry.copy!, entry.changes, read); }
  // A message from you to a helper while it works ("Improving existing features", item 5). It waits in the helper's
  // mailbox and reaches the helper with the result of its next step, which is the only moment a running model hears
  // anything new. One that arrives after its last step is reported back as not delivered.
  message(chat: string, id: string, text: string): { queued: true; waiting: number } {
    const entry = this.get(chat, id), words = typeof text === 'string' ? text.trim() : '';
    if (entry.status !== 'running' && entry.status !== 'copying') throw new Error(`${entry.id} has stopped working, so it can’t get a message now.`);
    if (!words || words.length > 2000) throw new Error('Write a message of 1–2,000 characters.');
    if (entry.inbox.length >= 5) throw new Error('That helper already has 5 messages waiting. Wait for it to take them.');
    entry.inbox.push({ text: words, at: new Date().toISOString() });
    return { queued: true, waiting: entry.inbox.length };
  }
  deliver(entry: HelperEntry): HelperMessage[] { const taken = entry.inbox.splice(0); entry.received.push(...taken); return taken; }
  stop(chat: string, id: string): void { this.get(chat, id).controller.abort(); }
  async discard(chat: string, id: string): Promise<void> {
    const entry = this.get(chat, id);
    entry.controller.abort();
    await entry.done;
    this.chats.get(chat)?.delete(id);
    if (entry.copy) await rm(entry.copy.dir, { recursive: true, force: true });
    await this.save();
  }
  // A helper can't outlive the turn that started it. Work that's finished stays until it's decided on.
  async endTurn(chat: string): Promise<void> {
    const running = this.running(chat);
    for (const entry of running) entry.controller.abort();
    if (running.length) await Promise.race([Promise.allSettled(running.map(entry => entry.done)), new Promise(resolve => setTimeout(resolve, ENDING_LIMIT))]);
    const stillGoing = this.running(chat);
    await Promise.allSettled(this.list(chat).filter(entry => !stillGoing.includes(entry) && !entry.changes.length).map(entry => this.discard(chat, entry.id)));
  }
  async closeChat(chat: string): Promise<void> {
    await Promise.allSettled(this.list(chat).map(entry => this.discard(chat, entry.id)));
    this.chats.delete(chat); this.numbers.delete(chat);
  }
  // Work a helper finished but nobody has decided on yet is kept across a restart ("Improving existing features",
  // item 5): kept.json beside the copies says which copies hold it, with what each changed. A helper that was still
  // running when Fairy closed has nothing to keep.
  get record(): string { return join(this.place, 'kept.json'); }
  // One save at a time, each writing what's kept when its turn comes.
  save(): Promise<void> {
    this.saving = (this.saving ?? Promise.resolve()).catch(() => {}).then(() => this.write());
    return this.saving;
  }
  async write(): Promise<void> {
    const kept = [...this.chats.values()].flatMap(entries => [...entries.values()]).filter((entry): entry is HelperEntry & { copy: ProjectCopy } => entry.status !== 'running' && entry.status !== 'copying' && Boolean(entry.changes?.length) && Boolean(entry.copy))
      .map(({ id, chat, root, task, title, role, status, report, error, changes, skipped, copy }) => ({ id, chat, root, task: String(task).slice(0, 4000), title, role, status, report: String(report || '').slice(0, 20000), error, changes, skipped,
        copy: { dir: copy.dir, work: copy.work, base: copy.base, files: [...copy.files], ignored: copy.ignored ? [...copy.ignored] : null } }));
    await mkdir(this.place, { recursive: true, mode: 0o700 });
    const spare = `${this.record}.${process.pid}.tmp`;
    await writeFile(spare, JSON.stringify({ version: 1, kept }), { mode: 0o600 });
    await rename(spare, this.record);
  }
  // At start-up: the helpers holding kept work come back to their chats; every other copy left from before goes.
  async restore(): Promise<string[]> {
    let kept: SavedHelperEntry[] = [];
    try { kept = (JSON.parse(await readFile(this.record, 'utf8')) as { kept?: SavedHelperEntry[] }).kept ?? []; } catch {}
    const keep = new Set<string>();
    for (const saved of kept) {
      if (!saved?.copy?.dir || !(await stat(saved.copy.work).catch(() => null))?.isDirectory()) continue;
      const copy: ProjectCopy = { ...saved.copy, files: new Map(saved.copy.files), ignored: saved.copy.ignored ? new Set(saved.copy.ignored) : null };
      const entry = { ...saved, copy, onSeat: () => {}, controller: new AbortController(), done: Promise.resolve(), restored: true } as unknown as HelperEntry;
      let chatMap = this.chats.get(entry.chat);
      if (!chatMap) { chatMap = new Map(); this.chats.set(entry.chat, chatMap); }
      chatMap.set(entry.id, entry);
      this.numbers.set(entry.chat, Math.max(this.numbers.get(entry.chat) ?? 0, Number(String(entry.id).slice(1)) || 0));
      keep.add(basename(copy.dir));
    }
    for (const name of await readdir(this.place).catch(() => [] as string[])) {
      const path = join(this.place, name);
      if (name !== 'kept.json' && !keep.has(name)) await rm(path, { recursive: true, force: true });
    }
    await this.save();
    return [...keep];
  }
  // Every copy goes, kept work too (for a test copy's fresh start).
  sweep(): Promise<void> { return rm(this.place, { recursive: true, force: true }); }
}
