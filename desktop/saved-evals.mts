// Eval tasks saved from real work sessions (docs/evals-from-sessions.md): what one holds, checked before it's kept, and
// where it's kept (Fairy's data folder, evals/saved/<id>/task.json, never the repository). The eval runner turns one
// into a task (evals/saved.mjs); Fairy saves one from a work turn (desktop/eval-saving.mjs).
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { WORK_CHECKS, says, type EvalCheckFn } from './eval-checks.mjs';

export const SAVED_DIR = join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra', 'evals', 'saved');
export const PERMISSIONS = Object.freeze(['ask', 'auto', 'plan'] as const);
// The kinds of task Auto-by-task will route by (docs/auto-by-task-plan.md); a saved task may say which it is.
export const KINDS = Object.freeze(['code', 'maths', 'circuits', 'research', 'data', 'business', 'writing', 'vision', 'teaching', 'everyday'] as const);
export const CHECK_NAMES = Object.freeze(['testsPass', 'checksItsWork', 'changesNothing', 'changesOnly', 'neverRuns', 'says'] as const);
export const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const MAX_ASK = 20000, MAX_VERIFY = 2000, MAX_HIDDEN = 512 * 1024, MAX_START = 8 * 1024 * 1024;
const text = (value: unknown, limit: number): string => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit);

export type SavedPermission = (typeof PERMISSIONS)[number];
export type SavedKind = (typeof KINDS)[number];
export type SavedCheckName = (typeof CHECK_NAMES)[number];

export type SavedCheck =
  | { check: 'testsPass' | 'checksItsWork' | 'changesNothing' }
  | { check: 'changesOnly'; paths: string[] }
  | { check: 'neverRuns' | 'says'; pattern: string };

export interface SavedUntrackedFile {
  path: string;
  data: string;
}

export interface SavedTaskStart {
  repo: string;
  commit: string;
  patch?: string;
  untracked?: SavedUntrackedFile[];
}

export interface SavedTaskReference {
  session: string;
  at: string;
  reply: string;
  changed: string[];
  seconds: number | null;
  model: string;
  provider: string;
  tokens: { input: number; output: number } | null;
}

export interface SavedTask {
  version: 1;
  id: string;
  kind?: SavedKind;
  title: string;
  ask: string;
  permission: SavedPermission;
  tags: string[];
  saved: string;
  start: SavedTaskStart;
  verify: string;
  hidden: Record<string, string>;
  checks: SavedCheck[];
  reference: SavedTaskReference;
  script?: unknown[];
}

export interface SavedRunnerTask {
  id: string;
  kind: 'work';
  title: string;
  saved: true;
  tags: string[];
  ask: string;
  permission: SavedPermission;
  verify: string | undefined;
  limit: number;
  world: () => { git: SavedTaskStart; hidden: Record<string, string> };
  checks: EvalCheckFn[];
  reference: SavedTaskReference;
  script?: unknown[];
}

export interface ReadSavedProblem {
  id: string;
  problem: string;
}

// A path inside the project, as git writes them: relative, no .. and no .git.
export const projectPath = (path: unknown): path is string => typeof path === 'string' && path.length <= 500 && !isAbsolute(path) && normalize(path) === path && !path.split('/').includes('..') && !/(?:^|\/)\.git(?:\/|$)/.test(path) && !path.includes('\0');

function cleanCheck(raw: unknown): SavedCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.check !== 'string' || !(CHECK_NAMES as readonly string[]).includes(obj.check)) return null;
  if (obj.check === 'changesOnly') { const paths = (Array.isArray(obj.paths) ? obj.paths : []).filter(projectPath).slice(0, 200); return paths.length ? { check: 'changesOnly', paths } : null; }
  if (obj.check === 'neverRuns' || obj.check === 'says') { const pattern = text(obj.pattern, 200); try { new RegExp(pattern, 'i'); } catch { return null; } return pattern ? { check: obj.check, pattern } : null; }
  return { check: obj.check as 'testsPass' | 'checksItsWork' | 'changesNothing' };
}

// A saved task as it may be kept, or an error saying what's wrong with it.
export function cleanSaved(raw: unknown): SavedTask {
  if (!raw || typeof raw !== 'object') throw new Error('That isn’t a saved task.');
  const obj = raw as Record<string, unknown>;
  if (!ID.test(String(obj.id))) throw new Error('A saved task needs an id of lower-case letters, digits and dashes.');
  const id = obj.id as string;
  const ask = text(obj.ask, MAX_ASK);
  if (!ask) throw new Error('A saved task needs the request.');
  const start = (obj.start && typeof obj.start === 'object' ? obj.start : {}) as Record<string, unknown>;
  if (typeof start.repo !== 'string' || !isAbsolute(start.repo)) throw new Error('A saved task needs its repository as a full path.');
  if (!COMMIT.test(String(start.commit))) throw new Error('A saved task needs the commit it starts from.');
  const commit = start.commit as string;
  if (start.patch != null && (typeof start.patch !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(start.patch))) throw new Error('Its uncommitted changes aren’t a patch.');
  const untracked = (Array.isArray(start.untracked) ? start.untracked : []).filter((u): u is SavedUntrackedFile => Boolean(u) && typeof u === 'object' && projectPath((u as Record<string, unknown>).path) && typeof (u as Record<string, unknown>).data === 'string' && /^[A-Za-z0-9+/=]*$/.test((u as Record<string, unknown>).data as string));
  if (((start.patch as string | undefined)?.length || 0) + untracked.reduce((n, u) => n + u.data.length, 0) > MAX_START) throw new Error('Its starting changes are too big to keep.');
  const verify = text(obj.verify, MAX_VERIFY);
  const hidden = Object.fromEntries(Object.entries(obj.hidden && typeof obj.hidden === 'object' ? (obj.hidden as Record<string, unknown>) : {}).filter((entry): entry is [string, string] => projectPath(entry[0]) && typeof entry[1] === 'string'));
  if (Object.values(hidden).reduce((n, body) => n + body.length, 0) > MAX_HIDDEN) throw new Error('Its hidden files come to over 512 KB.');
  const checks = (Array.isArray(obj.checks) ? obj.checks : []).map(cleanCheck).filter((c): c is SavedCheck => Boolean(c)).slice(0, 20);
  if (!checks.length && !verify) throw new Error('A saved task needs a check: a command whose exit says pass or fail, or one of the checks.');
  if (checks.some(c => c.check === 'testsPass') && !verify) throw new Error('“The tests pass” needs the command that runs them.');
  const reference = (obj.reference && typeof obj.reference === 'object' ? obj.reference : {}) as Record<string, unknown>;
  const refTokens = reference.tokens && typeof reference.tokens === 'object' ? (reference.tokens as Record<string, unknown>) : null;
  return { version: 1, id, ...(typeof obj.kind === 'string' && (KINDS as readonly string[]).includes(obj.kind) ? { kind: obj.kind as SavedKind } : {}), title: text(obj.title, 120) || ask.split('\n')[0].slice(0, 80), ask, permission: typeof obj.permission === 'string' && (PERMISSIONS as readonly string[]).includes(obj.permission) ? (obj.permission as SavedPermission) : 'auto',
    tags: (Array.isArray(obj.tags) ? obj.tags : []).map(t => text(t, 40)).filter(Boolean).slice(0, 12), saved: text(obj.saved, 40),
    start: { repo: start.repo, commit, ...(start.patch ? { patch: start.patch as string } : {}), ...(untracked.length ? { untracked } : {}) },
    verify, hidden, checks: checks.length ? checks : [{ check: 'testsPass' }],
    reference: { session: text(reference.session, 80), at: text(reference.at, 40), reply: text(reference.reply, 6000), changed: (Array.isArray(reference.changed) ? reference.changed : []).filter(projectPath).slice(0, 200),
      seconds: Number.isFinite(reference.seconds) ? (reference.seconds as number) : null, model: text(reference.model, 80), provider: text(reference.provider, 40),
      tokens: refTokens && Number.isFinite(refTokens.input) ? { input: refTokens.input as number, output: (refTokens.output as number) || 0 } : null },
    // A scripted path, for checking a saved task with no model (tests and dry runs).
    ...(Array.isArray(obj.script) ? { script: (obj.script as unknown[]).slice(0, 200) } : {}) };
}

export async function saveTask(raw: unknown, { dir = SAVED_DIR }: { dir?: string } = {}): Promise<SavedTask> {
  const task = cleanSaved(raw);
  await mkdir(join(dir, task.id), { recursive: true, mode: 0o700 });
  const path = join(dir, task.id, 'task.json');
  await writeFile(`${path}.tmp`, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return task;
}
// What a saved task may be checked by, written as data: { check: 'testsPass' } and so on.
export const CHECKS = Object.freeze({
  testsPass: (): EvalCheckFn => WORK_CHECKS.testsPass,
  checksItsWork: (): EvalCheckFn => WORK_CHECKS.checksItsWork,
  changesNothing: (): EvalCheckFn => WORK_CHECKS.changesNothing,
  changesOnly: ({ paths }: { paths: string[] }): EvalCheckFn => WORK_CHECKS.changesOnly(paths.filter(projectPath), `changes only ${paths.join(', ')}`),
  neverRuns: ({ pattern }: { pattern: string }): EvalCheckFn => WORK_CHECKS.neverRuns(new RegExp(pattern, 'i'), `never runs ${pattern}`),
  says: ({ pattern }: { pattern: string }): EvalCheckFn => says(new RegExp(pattern, 'i'), `the answer says ${pattern}`),
});
// The runner's task for a saved one: a work task with a git world and checks built from what was saved.
export function runnerTask(saved: SavedTask, { limit = 15 * 60 * 1000 }: { limit?: number } = {}): SavedRunnerTask {
  return { id: `saved-${saved.id}`, kind: 'work', title: saved.title, saved: true, tags: saved.tags, ask: saved.ask, permission: saved.permission, verify: saved.verify || undefined, limit,
    world: () => ({ git: { ...saved.start }, hidden: { ...saved.hidden } }),
    checks: saved.checks.map(c => {
      if (c.check === 'changesOnly') return CHECKS.changesOnly(c);
      if (c.check === 'neverRuns') return CHECKS.neverRuns(c);
      if (c.check === 'says') return CHECKS.says(c);
      return CHECKS[c.check]();
    }),
    reference: saved.reference, ...(saved.script ? { script: saved.script } : {}) };
}

// Every saved task as kept, and the ones that couldn't be read with why.
export async function readSaved({ dir = SAVED_DIR }: { dir?: string } = {}): Promise<{ tasks: SavedTask[]; problems: ReadSavedProblem[] }> {
  const tasks: SavedTask[] = [], problems: ReadSavedProblem[] = [];
  for (const name of (await readdir(dir).catch(() => [] as string[])).sort()) {
    if (!ID.test(name)) continue;
    try { tasks.push(cleanSaved(JSON.parse(await readFile(join(dir, name, 'task.json'), 'utf8')))); }
    catch (error: unknown) { problems.push({ id: name, problem: error instanceof Error ? error.message : String(error) }); }
  }
  return { tasks, problems };
}
export async function removeSaved(id: string, { dir = SAVED_DIR }: { dir?: string } = {}): Promise<boolean> {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('That isn’t a saved task.');
  await rm(join(dir, id), { recursive: true, force: true });
  return true;
}
