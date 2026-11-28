// Saving a work turn as an eval task (docs/evals-from-sessions.md, stage 3). The draft is made from what's kept
// already, with no model call: the request, where the turn started (desktop/turn-starts.mjs), the commands it ran and
// the files it changed (its rewind checkpoint). Fairy suggests the check from the turn itself (a test command it ran
// that passed at the end, and the test files it wrote as hidden files); you accept, edit or write your own. Before a
// task is kept its check runs once where the request started, in a throwaway clone in the sandbox: a check that
// already passes there would prove nothing, so that task isn't saved.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { gitWorld, type GitWorldSpec } from './git-world.mjs';
import { KINDS, cleanSaved, projectPath, type SavedKind, type SavedPermission, type SavedTask } from './saved-evals.mjs';
import type { UntrackedFileSnapshot } from './turn-starts.mjs';
import type { CheckpointFileEntry } from './work-rewind.mjs';
import type { RunInSandboxOptions, SandboxCommandResult } from './work-sandbox.mjs';

export const TEST_COMMAND = /\b(?:node\s+--test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha|playwright\s+test)|jest|vitest|mocha|pytest|python3?\s+-m\s+(?:pytest|unittest)|cargo\s+test|go\s+test|swift\s+test|xcodebuild\s+test|make\s+(?:test|check)|ctest|rspec|mix\s+test|dotnet\s+test|gradle\w*\s+test|mvn\s+test)\b/i;
export const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec|specs)\/|[._-](?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py|rs|exs)$|Tests?\.swift$/;
const MAX_HIDDEN_FILE = 256 * 1024;
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const quote = (path: string): string => `'${String(path).replaceAll("'", "'\\''")}'`;

export interface EvalHistoryActivityRow {
  tool?: string;
  summary?: unknown;
  detail?: unknown;
  [key: string]: unknown;
}

export interface EvalHistoryEntry {
  role: string;
  at?: string;
  mode?: string;
  replyTo?: string;
  content?: unknown;
  activity?: EvalHistoryActivityRow[];
  usage?: {
    input?: number;
    output?: number;
  } | null;
  auto?: {
    model?: string;
    provider?: string;
  } | null;
  [key: string]: unknown;
}

export type EvalTurnStart =
  | { git: false; why?: string }
  | {
      git: true;
      commit: string | null;
      branch?: string;
      top?: string;
      dirty?: boolean;
      kept?: boolean;
      why?: string;
      patch?: string;
      untracked?: readonly UntrackedFileSnapshot[];
      [key: string]: unknown;
    };

export interface EvalCheckpoint {
  files?: readonly CheckpointFileEntry[];
}

export interface DraftEvalOptions {
  history: readonly EvalHistoryEntry[];
  at: string;
  start: EvalTurnStart | null | undefined;
  checkpoint?: EvalCheckpoint | null;
  root: string;
  read?: (path: string) => Promise<Buffer>;
}

export interface DraftEvalStart {
  repo: string;
  commit: string;
  branch: string;
  dirty: boolean;
  kept: boolean;
  why: string;
  prefix: string;
}

export interface DraftHiddenFile {
  path: string;
  inRepo: string;
  bytes: number | null;
  same: boolean;
  new: boolean;
}

export interface DraftEvalResult {
  at: string;
  ask: string;
  title: string;
  start: DraftEvalStart;
  verify: string;
  tests: string[];
  changed: string[];
  hidden: DraftHiddenFile[];
  kinds: readonly SavedKind[];
  reference: {
    at: string;
    reply: string;
    changed: string[];
    seconds: number | null;
    model: string;
    provider: string;
    tokens: { input: number; output: number } | null;
  };
}

export interface BuildTaskChoices {
  verify?: string;
  hidden?: readonly string[];
  changesOnly?: boolean;
  title?: string;
  ask?: string;
  permission?: SavedPermission | string;
  tags?: readonly string[];
  kind?: SavedKind | string;
}

export interface BuildTaskOptions {
  session: string;
  history: readonly EvalHistoryEntry[];
  at: string;
  start: EvalTurnStart | null | undefined;
  checkpoint?: EvalCheckpoint | null;
  root: string;
  choices?: BuildTaskChoices;
  read?: (path: string) => Promise<Buffer>;
  now?: () => Date;
  id?: string | null;
}

export interface CheckAtStartTask {
  start: GitWorldSpec;
  hidden?: Record<string, string>;
  verify: string;
}

export interface CheckAtStartOptions {
  run: (options: RunInSandboxOptions) => Promise<Pick<SandboxCommandResult, 'exitCode' | 'output'> & { timedOut?: boolean }>;
  timeout?: number;
  signal?: AbortSignal;
}

export interface CheckAtStartResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export type StartVerdict =
  | { ok: true }
  | { ok: false; why: string };

// The turn as saved in the chat: your request and Fairy's reply to it.
function turnOf(history: readonly EvalHistoryEntry[], at: string): { ask: EvalHistoryEntry; reply: EvalHistoryEntry | null } {
  const ask = history.find(entry => entry.role === 'user' && entry.at === at && entry.mode === 'work');
  if (!ask) throw new Error('That isn’t a work request in this chat.');
  const reply = history.find(entry => entry.role === 'assistant' && entry.replyTo === at) || null;
  return { ask, reply };
}

// What's offered on the card: the request, where it started, the check Fairy suggests, the test files it wrote and the
// files it changed, and what the first session did. start: the turn's start record; checkpoint: its rewind checkpoint
// ({ files: [{ path, before, after }] }) or null; root: the work folder the turn ran in.
export async function draftEval({ history, at, start, checkpoint = null, root, read = path => readFile(path) }: DraftEvalOptions): Promise<DraftEvalResult> {
  const { ask, reply } = turnOf(history, at);
  if (!start) throw new Error('Fairy didn’t note where this turn started (turns before 18 Nov weren’t), so it can’t be saved as an eval.');
  if (!start.git) throw new Error('This work session’s folder isn’t in git, and an eval needs a commit to start from.');
  if (!start.commit) throw new Error('The folder had no commit yet when this turn started, so there’s nothing to start an eval from.');
  // Paths in the turn are the work folder's; an eval starts from the repository's top, which may be above it.
  // Both resolved, as git resolves the top: a folder reached through a link is still the same folder.
  const real = async (path: string): Promise<string> => realpath(path).catch(() => path);
  const between = start.top && root ? relative(await real(start.top), await real(root)).split(sep).join('/') : '';
  const prefix = between.startsWith('..') ? '' : between;
  const inRepo = (path: string): string => (prefix ? `${prefix}/${path}` : path);
  const rows = Array.isArray(reply?.activity) ? reply.activity : [];
  const passed = rows.filter((row): row is EvalHistoryActivityRow & { summary: string } => (row.tool === 'run' || row.tool === 'experiment') && /^(?:R\d+ · )?Exit 0$/.test(String(row.detail || '')) && typeof row.summary === 'string').map(row => row.summary);
  const tests = [...new Set(passed.filter(command => TEST_COMMAND.test(command)).reverse())];
  const changed = (checkpoint?.files || []).map(file => file.path).filter(projectPath);
  const hidden: DraftHiddenFile[] = [];
  for (const file of (checkpoint?.files || []).filter(f => projectPath(f.path) && TEST_FILE.test(f.path))) {
    let data: Buffer | null = null;
    try { data = await read(join(root, file.path)); } catch {}
    hidden.push({ path: file.path, inRepo: inRepo(file.path), bytes: data?.length ?? null, same: Boolean(data && sha(data.toString('utf8')) === file.after), new: file.before == null });
  }
  const seconds = reply?.at && Date.parse(reply.at) && Date.parse(at) ? Math.round((Date.parse(reply.at) - Date.parse(at)) / 1000) : null;
  const usageInput = reply?.usage?.input;
  return {
    at, ask: String(ask.content || ''), title: String(ask.content || '').split('\n')[0].slice(0, 80),
    start: { repo: start.top || root, commit: start.commit, branch: start.branch || '', dirty: Boolean(start.dirty), kept: Boolean(start.kept), why: start.why || '', prefix },
    verify: tests[0] ? (prefix ? `cd ${quote(prefix)} && ${tests[0]}` : tests[0]) : '', tests, changed, hidden, kinds: KINDS,
    reference: { at, reply: String(reply?.content || '').slice(0, 6000), changed: changed.map(inRepo), seconds,
      model: String(reply?.auto?.model || ''), provider: String(reply?.auto?.provider || ''),
      tokens: typeof usageInput === 'number' && Number.isFinite(usageInput) ? { input: usageInput, output: Number(reply?.usage?.output) || 0 } : null },
  };
}

const slug = (words: string): string => String(words).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'task';
// The task as it will be kept, from the draft and what you chose on the card.
export async function buildTask({ session, history, at, start, checkpoint, root, choices = {}, read = path => readFile(path), now = () => new Date(), id = null }: BuildTaskOptions): Promise<SavedTask> {
  const draft = await draftEval({ history, at, start, checkpoint, root, read });
  if (!draft.start.kept) throw new Error(`Where this turn started wasn’t kept in full (${draft.start.why || 'too much was uncommitted'}), so it can’t be saved as an eval.`);
  const verify = String(choices.verify ?? draft.verify).trim();
  const hidden: Record<string, string> = {};
  for (const path of Array.isArray(choices.hidden) ? choices.hidden : []) {
    const offered = draft.hidden.find(h => h.path === path);
    if (!offered) throw new Error(`${String(path).slice(0, 120)} isn’t one of the test files this turn wrote.`);
    if (!offered.same) throw new Error(`${path} has changed since this turn wrote it, so it isn’t the test the turn left.`);
    const data = await read(join(root, path));
    if (data.length > MAX_HIDDEN_FILE) throw new Error(`${path} is over 256 KB.`);
    hidden[offered.inRepo] = data.toString('utf8');
  }
  const checks = [...(verify ? [{ check: 'testsPass' }] : []), ...(choices.changesOnly && draft.reference.changed.length ? [{ check: 'changesOnly', paths: draft.reference.changed }] : [])];
  const gitStart = start && start.git ? start : null;
  return cleanSaved({ id: id || `${slug(choices.title || draft.title)}-${randomBytes(2).toString('hex')}`, title: choices.title || draft.title, ask: choices.ask || draft.ask,
    permission: choices.permission, tags: choices.tags, kind: choices.kind, saved: now().toISOString(),
    start: { repo: draft.start.repo, commit: draft.start.commit, ...(gitStart?.patch ? { patch: gitStart.patch } : {}), ...(gitStart?.untracked?.length ? { untracked: gitStart.untracked } : {}) },
    verify, hidden, checks, reference: { ...draft.reference, session } });
}

// The task's check run once where its request started: { exitCode, timedOut, output }. Its hidden files go in first.
// run: the sandbox's runner (desktop/work-sandbox.mjs runInSandbox).
export async function checkAtStart(task: CheckAtStartTask, { run, timeout = 180000, signal }: CheckAtStartOptions): Promise<CheckAtStartResult> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fairy-eval-start-')));
  try {
    const root = await gitWorld(task.start, { base, name: 'Project' });
    for (const [path, body] of Object.entries(task.hidden || {})) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
    const result = await run({ command: task.verify, cwd: root, timeout, signal });
    return { exitCode: result.exitCode, timedOut: Boolean(result.timedOut), output: String(result.output || '').slice(-3000) };
  } finally { await rm(base, { recursive: true, force: true }); }
}
// Kept only if the check fails where the request started.
export function startVerdict(result: { exitCode: number | null; timedOut?: boolean } | null | undefined): StartVerdict {
  if (!result) return { ok: true };
  if (result.timedOut) return { ok: false, why: 'The check didn’t finish in 3 minutes where the request started, so it can’t tell a fix from no fix. Give a quicker command.' };
  if (result.exitCode === 0) return { ok: false, why: 'The check already passes where the request started, so this eval would prove nothing. Add the tests this turn wrote as hidden files, or choose a check that fails before the fix.' };
  return { ok: true };
}
