// Eval tasks saved from real work sessions (docs/evals-from-sessions.md): what one holds, checked before it's kept, and
// where it's kept (Fairy's data folder, evals/saved/<id>/task.json, never the repository). The eval runner turns one
// into a task (evals/saved.mjs); Fairy saves one from a work turn (desktop/eval-saving.mjs).
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { WORK_CHECKS, says } from './eval-checks.mjs';

export const SAVED_DIR = join(homedir(), 'Library', 'Application Support', 'lyra-companion', 'lyra', 'evals', 'saved');
export const PERMISSIONS = Object.freeze(['ask', 'auto', 'plan']);
// The kinds of task Auto-by-task will route by (docs/auto-by-task-plan.md); a saved task may say which it is.
export const KINDS = Object.freeze(['code', 'maths', 'circuits', 'research', 'data', 'business', 'writing', 'vision', 'teaching', 'everyday']);
export const CHECK_NAMES = Object.freeze(['testsPass', 'checksItsWork', 'changesNothing', 'changesOnly', 'neverRuns', 'says']);
export const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const MAX_ASK = 20000, MAX_VERIFY = 2000, MAX_HIDDEN = 512 * 1024, MAX_START = 8 * 1024 * 1024;
const text = (value, limit) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit);
// A path inside the project, as git writes them: relative, no .. and no .git.
export const projectPath = path => typeof path === 'string' && path.length <= 500 && !isAbsolute(path) && normalize(path) === path && !path.split('/').includes('..') && !/(?:^|\/)\.git(?:\/|$)/.test(path) && !path.includes('\0');

function cleanCheck(raw) {
  if (!raw || typeof raw !== 'object' || !CHECK_NAMES.includes(raw.check)) return null;
  if (raw.check === 'changesOnly') { const paths = (Array.isArray(raw.paths) ? raw.paths : []).filter(projectPath).slice(0, 200); return paths.length ? { check: 'changesOnly', paths } : null; }
  if (raw.check === 'neverRuns' || raw.check === 'says') { const pattern = text(raw.pattern, 200); try { new RegExp(pattern, 'i'); } catch { return null; } return pattern ? { check: raw.check, pattern } : null; }
  return { check: raw.check };
}

// A saved task as it may be kept, or an error saying what's wrong with it.
export function cleanSaved(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That isn’t a saved task.');
  if (!ID.test(String(raw.id))) throw new Error('A saved task needs an id of lower-case letters, digits and dashes.');
  const ask = text(raw.ask, MAX_ASK);
  if (!ask) throw new Error('A saved task needs the request.');
  const start = raw.start && typeof raw.start === 'object' ? raw.start : {};
  if (typeof start.repo !== 'string' || !isAbsolute(start.repo)) throw new Error('A saved task needs its repository as a full path.');
  if (!COMMIT.test(String(start.commit))) throw new Error('A saved task needs the commit it starts from.');
  if (start.patch != null && (typeof start.patch !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(start.patch))) throw new Error('Its uncommitted changes aren’t a patch.');
  const untracked = (Array.isArray(start.untracked) ? start.untracked : []).filter(u => u && projectPath(u.path) && typeof u.data === 'string' && /^[A-Za-z0-9+/=]*$/.test(u.data));
  if ((start.patch?.length || 0) + untracked.reduce((n, u) => n + u.data.length, 0) > MAX_START) throw new Error('Its starting changes are too big to keep.');
  const verify = text(raw.verify, MAX_VERIFY);
  const hidden = Object.fromEntries(Object.entries(raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {}).filter(([path, body]) => projectPath(path) && typeof body === 'string'));
  if (Object.values(hidden).reduce((n, body) => n + body.length, 0) > MAX_HIDDEN) throw new Error('Its hidden files come to over 512 KB.');
  const checks = (Array.isArray(raw.checks) ? raw.checks : []).map(cleanCheck).filter(Boolean).slice(0, 20);
  if (!checks.length && !verify) throw new Error('A saved task needs a check: a command whose exit says pass or fail, or one of the checks.');
  if (checks.some(c => c.check === 'testsPass') && !verify) throw new Error('“The tests pass” needs the command that runs them.');
  const reference = raw.reference && typeof raw.reference === 'object' ? raw.reference : {};
  return { version: 1, id: raw.id, ...(KINDS.includes(raw.kind) ? { kind: raw.kind } : {}), title: text(raw.title, 120) || ask.split('\n')[0].slice(0, 80), ask, permission: PERMISSIONS.includes(raw.permission) ? raw.permission : 'auto',
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map(t => text(t, 40)).filter(Boolean).slice(0, 12), saved: text(raw.saved, 40),
    start: { repo: start.repo, commit: start.commit, ...(start.patch ? { patch: start.patch } : {}), ...(untracked.length ? { untracked } : {}) },
    verify, hidden, checks: checks.length ? checks : [{ check: 'testsPass' }],
    reference: { session: text(reference.session, 80), at: text(reference.at, 40), reply: text(reference.reply, 6000), changed: (Array.isArray(reference.changed) ? reference.changed : []).filter(projectPath).slice(0, 200),
      seconds: Number.isFinite(reference.seconds) ? reference.seconds : null, model: text(reference.model, 80), provider: text(reference.provider, 40),
      tokens: reference.tokens && Number.isFinite(reference.tokens.input) ? { input: reference.tokens.input, output: reference.tokens.output || 0 } : null },
    // A scripted path, for checking a saved task with no model (tests and dry runs).
    ...(Array.isArray(raw.script) ? { script: raw.script.slice(0, 200) } : {}) };
}

export async function saveTask(raw, { dir = SAVED_DIR } = {}) {
  const task = cleanSaved(raw);
  await mkdir(join(dir, task.id), { recursive: true, mode: 0o700 });
  const path = join(dir, task.id, 'task.json');
  await writeFile(`${path}.tmp`, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return task;
}
// What a saved task may be checked by, written as data: { check: 'testsPass' } and so on.
export const CHECKS = Object.freeze({
  testsPass: () => WORK_CHECKS.testsPass,
  checksItsWork: () => WORK_CHECKS.checksItsWork,
  changesNothing: () => WORK_CHECKS.changesNothing,
  changesOnly: ({ paths }) => WORK_CHECKS.changesOnly(paths.filter(projectPath), `changes only ${paths.join(', ')}`),
  neverRuns: ({ pattern }) => WORK_CHECKS.neverRuns(new RegExp(pattern, 'i'), `never runs ${pattern}`),
  says: ({ pattern }) => says(new RegExp(pattern, 'i'), `the answer says ${pattern}`),
});
// The runner's task for a saved one: a work task with a git world and checks built from what was saved.
export function runnerTask(saved, { limit = 15 * 60 * 1000 } = {}) {
  return { id: `saved-${saved.id}`, kind: 'work', title: saved.title, saved: true, tags: saved.tags, ask: saved.ask, permission: saved.permission, verify: saved.verify || undefined, limit,
    world: () => ({ git: { ...saved.start }, hidden: { ...saved.hidden } }), checks: saved.checks.map(c => CHECKS[c.check](c)), reference: saved.reference, ...(saved.script ? { script: saved.script } : {}) };
}

// Every saved task as kept, and the ones that couldn't be read with why.
export async function readSaved({ dir = SAVED_DIR } = {}) {
  const tasks = [], problems = [];
  for (const name of (await readdir(dir).catch(() => [])).sort()) {
    if (!ID.test(name)) continue;
    try { tasks.push(cleanSaved(JSON.parse(await readFile(join(dir, name, 'task.json'), 'utf8')))); }
    catch (error) { problems.push({ id: name, problem: error.message }); }
  }
  return { tasks, problems };
}
export async function removeSaved(id, { dir = SAVED_DIR } = {}) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('That isn’t a saved task.');
  await rm(join(dir, id), { recursive: true, force: true });
  return true;
}
