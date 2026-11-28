// Running saved evals from Fairy (docs/evals-from-sessions.md, stage 4): each saved task as one work turn on your work
// provider, in its rebuilt start (desktop/git-world.mjs), with Fairy's work tools and sandbox, then its check command and
// checks, scored as scripts/eval.mjs scores it. Results are kept in Fairy's data folder (evals/results/<stamp>.json)
// and set beside the session each task came from. Nothing here starts without your OK on a card, in main.
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { folderTree, gitWorld } from './git-world.mjs';
import { runnerTask, type SavedTask, type SavedTaskReference } from './saved-evals.mjs';
import type { EvalCheckResult, EvalToolCall } from './eval-checks.mjs';
import type { RunMetric, RunValue } from './runs.mjs';
import type { RunWorkOptions, WorkProvider, WorkRunTools, WorkToolCall } from './work-agent.mjs';
import type { RunInSandboxOptions, SandboxCommandResult } from './work-sandbox.mjs';
import type { WorkToolsOptions } from './work-tools.mjs';

export const RUN_LIMIT = 20 * 60 * 1000, CHECK_LIMIT = 180000, KEEP_RESULTS = 200;
const short = (value: unknown, limit = 3000): string => { const text = String(value ?? ''); return text.length > limit ? `${text.slice(-limit)}` : text; };
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : String(error ?? ''));

export interface EvalTokenCount {
  input: number;
  output: number;
}

export interface EvalApprovalRecord {
  kind: unknown;
  title: unknown;
}

export interface EvalVerifyResult {
  exitCode: number | null;
  output: string;
}

export interface EvalSavedRecord {
  id: string;
  title: string;
  ok: boolean;
  checks: EvalCheckResult[];
  calls: EvalToolCall[];
  approvals: EvalApprovalRecord[];
  seconds: number;
  tokens: EvalTokenCount;
  reply: string;
  created: {
    localFiles: string[];
    removedFiles: string[];
  };
  reference: SavedTaskReference;
  files?: Record<string, string>;
  verify?: EvalVerifyResult;
  error?: string;
  [key: string]: unknown;
}

export interface RunSavedTaskWork {
  provider: WorkProvider;
  settings?: unknown;
}

export interface RunSavedTaskTools {
  WorkTools: new (options: WorkToolsOptions) => WorkRunTools;
  runWork: (options: RunWorkOptions) => Promise<string>;
  runInSandbox: (options: RunInSandboxOptions) => Promise<SandboxCommandResult>;
}

export interface RunSavedTaskOptions {
  work: RunSavedTaskWork;
  tools: RunSavedTaskTools;
  signal?: AbortSignal;
  limit?: number;
  now?: () => number;
}

export interface SavedTaskResult {
  id: string;
  title: string;
  ok: boolean;
  checks: EvalCheckResult[];
  seconds: number;
  tokens: EvalTokenCount;
  calls: number;
  approvals: number;
  verify: EvalVerifyResult | null;
  changed: string[];
  reply: string;
  error?: string;
  skipped?: boolean;
  first: {
    seconds: number | null;
    tokens: EvalTokenCount | null;
    model: string;
  };
}

export interface EvalResultSummary {
  id: string;
  ok: boolean;
  skipped?: boolean;
  seconds?: number;
  tokens?: EvalTokenCount;
  error?: string;
  [key: string]: unknown;
}

export interface EvalRunEntry {
  started: string;
  finished?: string;
  provider?: string;
  model?: string;
  stopped?: boolean;
  summary?: { passed: number; total: number };
  results: EvalResultSummary[];
  [key: string]: unknown;
}

export interface LatestEvalResult {
  ok: boolean;
  skipped: boolean;
  seconds: number | undefined;
  tokens: EvalTokenCount | undefined;
  at: string;
  model: string;
  error: string;
}

export interface EvalResultsOptions {
  dir: string;
}

export interface RunCostTaskInput {
  reference?: {
    tokens?: Partial<EvalTokenCount> | null;
    seconds?: number | null;
  } | null;
}

export interface RunCostSummary {
  count: number;
  tokens: EvalTokenCount;
  seconds: number;
  known: number;
}

export interface TrackedRunOptions {
  results: readonly EvalResultSummary[];
  model?: string;
  provider?: string;
  version?: string;
  stopped?: boolean;
}

export interface TrackedRunData {
  name: string;
  command: string;
  params: Record<string, RunValue>;
  metrics: Record<string, RunMetric>;
  seconds: number;
  state: 'done' | 'stopped';
}

// One saved task, start to finish: { id, title, ok, checks, seconds, tokens, calls, verify, changed, reply, error }.
// work: { provider, settings } for the turn; tools: what a work turn is built from ({ WorkTools, runWork, runInSandbox }).
export async function runSavedTask(saved: SavedTask, { work, tools: { WorkTools, runWork, runInSandbox }, signal, limit = RUN_LIMIT, now = () => Date.now() }: RunSavedTaskOptions): Promise<SavedTaskResult> {
  // Its real path: the work tools check every path against the folder's, and the temporary folder is under a link.
  const task = runnerTask(saved), base = await realpath(await mkdtemp(join(tmpdir(), 'fairy-eval-run-')));
  const record: EvalSavedRecord = { id: saved.id, title: saved.title, ok: false, checks: [], calls: [], approvals: [], seconds: 0, tokens: { input: 0, output: 0 }, reply: '', created: { localFiles: [], removedFiles: [] }, reference: saved.reference };
  const started = now();
  try {
    let root: string;
    try { root = await gitWorld(saved.start, { base, name: 'Project' }); }
    catch (error: unknown) { return { ...summary(record), skipped: true, error: errorMessage(error) }; }
    const before = await folderTree(root, { repo: true });
    const stop = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(limit)]);
    const toolset = new WorkTools({ root, permission: saved.permission || 'auto', sandboxed: true, runCommand: runInSandbox, signal: stop,
      // As in scripts/eval.mjs: what a saved task would ask you for is refused, so it's done within its permission.
      approve: async request => { record.approvals.push({ kind: request.kind, title: request.title }); return 'deny'; } });
    // Every tool call, for the checks that read them (the commands it ran).
    const handle = toolset.handle.bind(toolset);
    toolset.handle = async (call: WorkToolCall) => { record.calls.push({ tool: call.tool, arguments: call.arguments }); return handle(call); };
    try {
      record.reply = String(await runWork({ provider: work.provider, settings: work.settings, text: saved.ask, history: [], tools: toolset, signal: stop,
        onUsage: value => { if (typeof value?.input === 'number' && Number.isFinite(value.input)) record.tokens = { input: value.input, output: Number(value.output) || 0 }; } }) ?? '');
    } catch (error: unknown) { record.error = (error instanceof Error ? error.message : errorMessage(error)) || String(error); }
    const after = await folderTree(root, { repo: true });
    record.created.localFiles = Object.keys(after).filter(path => after[path] !== before[path]);
    record.created.removedFiles = Object.keys(before).filter(path => !(path in after));
    record.files = Object.fromEntries(record.created.localFiles.map(path => [path, short(after[path], 4000)]));
    if (saved.verify && !signal?.aborted) {
      for (const [path, body] of Object.entries(saved.hidden || {})) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
      try { const result = await runInSandbox({ command: saved.verify, cwd: root, timeout: CHECK_LIMIT }); record.verify = { exitCode: result.exitCode, output: short(result.output, 2000) }; }
      catch (error: unknown) { record.verify = { exitCode: -1, output: errorMessage(error) }; }
    }
    record.checks = task.checks.map(check => { try { return check(record); } catch (error: unknown) { return { name: check.label || 'check', ok: false, detail: errorMessage(error) }; } });
    record.ok = !record.error && record.checks.every(check => check.ok);
    return summary(record);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
  function summary(r: EvalSavedRecord): SavedTaskResult {
    return { id: r.id, title: r.title, ok: r.ok, checks: r.checks, seconds: Math.round((now() - started) / 100) / 10, tokens: r.tokens, calls: r.calls.length, approvals: r.approvals.length,
      verify: r.verify || null, changed: [...r.created.localFiles, ...r.created.removedFiles], reply: short(r.reply, 2000), ...(r.error ? { error: r.error } : {}),
      first: { seconds: r.reference?.seconds ?? null, tokens: r.reference?.tokens ?? null, model: r.reference?.model || '' } };
  }
}

// Every run kept, newest last, and the latest result for each task.
export class EvalResults {
  dir: string;
  constructor({ dir }: EvalResultsOptions) { this.dir = dir; }
  async save(run: EvalRunEntry): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const name = `${run.started.replace(/[:.]/g, '-')}.json`, path = join(this.dir, name);
    await writeFile(`${path}.tmp`, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    const names = (await readdir(this.dir)).filter(n => n.endsWith('.json')).sort();
    for (const old of names.slice(0, Math.max(0, names.length - KEEP_RESULTS))) await rm(join(this.dir, old), { force: true });
    return name;
  }
  async runs(): Promise<EvalRunEntry[]> {
    const out: EvalRunEntry[] = [];
    for (const name of (await readdir(this.dir).catch(() => [] as string[])).filter(n => n.endsWith('.json')).sort()) {
      try { out.push(JSON.parse(await readFile(join(this.dir, name), 'utf8')) as EvalRunEntry); } catch {}
    }
    return out;
  }
  // id → { ok, seconds, tokens, at, model }
  async latest(): Promise<Record<string, LatestEvalResult>> {
    const latest: Record<string, LatestEvalResult> = {};
    for (const run of await this.runs()) for (const result of run.results || []) latest[result.id] = { ok: result.ok, skipped: Boolean(result.skipped), seconds: result.seconds, tokens: result.tokens, at: run.finished || run.started, model: run.model || '', error: result.error || '' };
    return latest;
  }
}

// What the card says before a run: how many tasks, and what they took the first time.
export function runCost(tasks: readonly RunCostTaskInput[]): RunCostSummary {
  const tokens = tasks.reduce<EvalTokenCount>((sum, t) => ({ input: sum.input + (t.reference?.tokens?.input || 0), output: sum.output + (t.reference?.tokens?.output || 0) }), { input: 0, output: 0 });
  const seconds = tasks.reduce((sum, t) => sum + (t.reference?.seconds || 0), 0), known = tasks.filter(t => t.reference?.tokens).length;
  return { count: tasks.length, tokens, seconds, known };
}

// An eval run as a run in the experiment tracker (stage 5, desktop/runs.mjs): the model and Fairy's version as
// parameters, how many passed, the pass rate, time and tokens as metrics, and each task's pass (1) or fail (0), so runs
// on different models or versions sit side by side in Runs and compare in its table and charts.
export function trackedRun({ results, model = '', provider = '', version = '', stopped = false }: TrackedRunOptions): TrackedRunData {
  const done = results.filter(r => !r.skipped), passed = done.filter(r => r.ok).length;
  const seconds = Math.round(results.reduce((sum, r) => sum + (r.seconds || 0), 0) * 10) / 10;
  const tokens = results.reduce<EvalTokenCount>((sum, r) => ({ input: sum.input + (r.tokens?.input || 0), output: sum.output + (r.tokens?.output || 0) }), { input: 0, output: 0 });
  const metrics: Record<string, RunMetric> = { passed: { value: passed, unit: null }, 'pass rate': { value: done.length ? Math.round((passed / done.length) * 1000) / 10 : 0, unit: '%' },
    seconds: { value: seconds, unit: 's' }, 'tokens in': { value: tokens.input, unit: null }, 'tokens out': { value: tokens.output, unit: null } };
  for (const r of results.slice(0, 150)) if (!r.skipped) metrics[`pass ${r.id}`.slice(0, 80)] = { value: r.ok ? 1 : 0, unit: null };
  return { name: `${model || provider || 'evals'} · ${passed}/${done.length}`, command: `saved evals: ${results.map(r => r.id).join(', ')}`.slice(0, 8000),
    params: { model, provider, version, tasks: results.length, ...(results.length - done.length ? { skipped: results.length - done.length } : {}) }, metrics, seconds, state: stopped ? 'stopped' : 'done' };
}
