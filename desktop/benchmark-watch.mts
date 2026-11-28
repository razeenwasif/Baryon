// Per-commit benchmark watch for Doc 7 #13 (runs on atlas or locally per commit, charts trends & flags regressions).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { hasFeature, optionalImport } from './edition.mjs';
import { readRunFolder, type FinishRunOptions, type RunMetric, type RunRecord, type RunValue, type StartRunOptions } from './runs.mjs';

const reproPaperMod = hasFeature('reproduce') ? await optionalImport('./reproduce/paper.mjs', import.meta.url) : null;
function fallbackValidateFolder(rawFolder: unknown): string {
  const text = String(rawFolder || '').trim();
  if (!text || /[\0\r\n]/.test(text)) throw new Error('Choose a valid folder.');
  if (text.split(/[\\/]/).includes('..')) throw new Error('Folder path cannot contain "..".');
  const abs = resolve(text);
  const home = resolve(homedir());
  if (abs !== home && !abs.startsWith(`${home}/`)) throw new Error('Choose a folder inside your home directory.');
  return abs;
}
const validateRequestedFolder: (rawFolder: unknown) => string =
  (reproPaperMod as { validateRequestedFolder?: (rawFolder: unknown) => string } | null)?.validateRequestedFolder || fallbackValidateFolder;

const execFileAsync = promisify(execFile);

export const MAX_WATCHES = 50;
export const DIRECTIONS = Object.freeze(['lower', 'higher'] as const);
export const MACHINES = Object.freeze(['atlas', 'here'] as const);

export type BenchmarkDirection = (typeof DIRECTIONS)[number];
export type BenchmarkMachine = (typeof MACHINES)[number];

export interface BenchmarkRegression {
  regressed: boolean;
  metric: string;
  direction: BenchmarkDirection;
  current: number | null;
  baseline: number | null;
  thresholdPct: number;
  degradationPct: number;
  pctChangeFromBaseline: number;
  commit: string;
  shortCommit: string;
  runId: string;
  summary: string;
}

export type BenchmarkAlert = BenchmarkRegression & { at?: string };

export interface BenchmarkWatchState {
  lastCheckedAt: string;
  lastCommit: string;
  lastBranch: string;
  lastRunId: string;
  lastMetric: number | null;
  lastAlertCommit: string;
  lastAlert: BenchmarkAlert | Record<string, unknown> | null;
  error: string;
}

export interface BenchmarkWatch {
  id: string;
  title: string;
  folder: string;
  branch: string;
  command: string;
  metric: string;
  direction: BenchmarkDirection;
  thresholdPct: number;
  baselineWindow: number;
  machine: BenchmarkMachine;
  cpus: number;
  memGb: number;
  limitHours: number;
  every: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  state: BenchmarkWatchState;
}

export interface BenchmarkStoreOptions {
  path: string;
  checkFolder?: (folder: string) => Promise<string> | string;
}

export type BenchmarkWatchPatch = Partial<Omit<BenchmarkWatch, 'id' | 'createdAt' | 'updatedAt' | 'state'>> & {
  state?: Partial<BenchmarkWatchState> | Record<string, unknown>;
};

export interface GitHeadInfo {
  commit: string;
  shortCommit: string;
  branch: string;
  subject: string;
  committedAt: string;
}

export type GitExec = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

export interface ParsedBenchmarkMetric {
  value: number;
  unit?: string;
}

export interface BenchmarkSeriesPoint {
  runId: string;
  at: string;
  commit: string;
  shortCommit: string;
  subject: string;
  branch: string;
  state: string;
  value: number | null;
  unit: string;
  where: string;
}

export interface BenchmarkRunStore {
  list: (folder: string) => Promise<RunRecord[]>;
  start: (folder: string, options: StartRunOptions) => Promise<RunRecord>;
  finish: (folder: string, id: string, options: FinishRunOptions) => Promise<RunRecord>;
}

export interface BenchmarkNexus {
  submit: (options: {
    root: string;
    target: string;
    on: string;
    cpus: number;
    mem_gb: number;
    limit_hours: number;
    name: string;
    command: string;
  }) => Promise<{ job?: unknown } | null | undefined>;
  logs: (options: { job: string; seconds: number }) => Promise<{ ended?: unknown; log?: unknown; exitCode?: unknown } | null | undefined>;
  outputs: (options: { job: string; root: string }) => Promise<{ folder?: string; files?: Array<{ path: string }> } | null | undefined>;
}

export interface BenchmarkLocalResult {
  seconds?: number;
  output?: string;
  printout?: string;
  exitCode?: number;
  exit?: number;
  metrics?: Record<string, unknown>;
}

export interface BenchmarkWatcherOptions {
  store: BenchmarkStore;
  runStore: BenchmarkRunStore;
  nexusFactory?: () => Promise<BenchmarkNexus | null>;
  runLocal?: (options: { folder: string; command: string; watch: BenchmarkWatch; commit: string }) => Promise<BenchmarkLocalResult>;
  outputDir: string;
  gitHead?: (folder: string) => Promise<GitHeadInfo>;
  onRegression?: (payload: { watch: BenchmarkWatch | null; regression: BenchmarkRegression }) => unknown;
  log?: (entry: Record<string, unknown>) => void;
  now?: () => Date;
}

const clip = (v: unknown, n = 200): string => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const num = Number(v);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(lo, Math.min(hi, num));
};

export function cleanWatch(raw: unknown): BenchmarkWatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const folder = String(r.folder || '').trim();
  const command = String(r.command || '').trim().slice(0, 2000);
  const metric = clip(r.metric, 80);
  if (!folder || !command || !metric) return null;
  const id = typeof r.id === 'string' && /^bench-[a-z0-9-]+$/i.test(r.id)
    ? r.id
    : `bench-${randomUUID().slice(0, 8)}`;
  const state = r.state && typeof r.state === 'object' ? (r.state as Record<string, unknown>) : {};
  const lastMetric = Number.isFinite(Number(state.lastMetric)) ? Number(state.lastMetric) : null;
  return {
    id,
    title: clip(r.title || metric, 120) || metric,
    folder,
    branch: clip(r.branch || '', 120),
    command,
    metric,
    direction: DIRECTIONS.includes(r.direction as BenchmarkDirection) ? (r.direction as BenchmarkDirection) : 'lower',
    thresholdPct: clamp(r.thresholdPct, 0.1, 100, 5),
    baselineWindow: Math.round(clamp(r.baselineWindow, 1, 20, 5)),
    machine: MACHINES.includes(r.machine as BenchmarkMachine) ? (r.machine as BenchmarkMachine) : 'atlas',
    cpus: Math.round(clamp(r.cpus, 1, 64, 4)),
    memGb: Math.round(clamp(r.memGb, 1, 256, 16)),
    limitHours: clamp(r.limitHours, 0.05, 24, 1),
    every: Math.round(clamp(r.every, 1, 1440, 5)),
    enabled: r.enabled !== false,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
    state: {
      lastCheckedAt: typeof state.lastCheckedAt === 'string' ? state.lastCheckedAt : '',
      lastCommit: clip(state.lastCommit || '', 64),
      lastBranch: clip(state.lastBranch || '', 120),
      lastRunId: clip(state.lastRunId || '', 24),
      lastMetric,
      lastAlertCommit: clip(state.lastAlertCommit || '', 64),
      lastAlert: state.lastAlert && typeof state.lastAlert === 'object' ? (state.lastAlert as BenchmarkAlert | Record<string, unknown>) : null,
      error: clip(state.error || '', 300),
    },
  };
}

export class BenchmarkStore {
  path: string;
  checkFolder: (folder: string) => Promise<string> | string;
  watches: BenchmarkWatch[];
  loaded: boolean;

  constructor({ path, checkFolder = async (p: string) => p }: BenchmarkStoreOptions) {
    this.path = path;
    this.checkFolder = checkFolder;
    this.watches = [];
    this.loaded = false;
  }

  async load(): Promise<BenchmarkWatch[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { watches?: unknown } | unknown[];
      const list = Array.isArray((parsed as { watches?: unknown })?.watches)
        ? ((parsed as { watches: unknown[] }).watches)
        : Array.isArray(parsed)
          ? parsed
          : [];
      this.watches = list.map(cleanWatch).filter((w): w is BenchmarkWatch => Boolean(w)).slice(0, MAX_WATCHES);
    } catch {
      this.watches = [];
    }
    this.loaded = true;
    return this.list();
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ watches: this.watches }, null, 2), { mode: 0o600 });
    await rename(temp, this.path);
  }

  async list(folder = ''): Promise<BenchmarkWatch[]> {
    await this.ensureLoaded();
    const target = folder ? String(folder).trim() : '';
    const items = target ? this.watches.filter(w => w.folder === target) : this.watches;
    return items.map(w => structuredClone(w));
  }

  async get(id: string): Promise<BenchmarkWatch | null> {
    await this.ensureLoaded();
    if (typeof id !== 'string' || !/^bench-[a-z0-9-]+$/i.test(id)) return null;
    const found = this.watches.find(w => w.id === id);
    return found ? structuredClone(found) : null;
  }

  async add(input: Record<string, unknown>): Promise<BenchmarkWatch> {
    await this.ensureLoaded();
    if (this.watches.length >= MAX_WATCHES) throw new Error(`Fairy keeps at most ${MAX_WATCHES} benchmark watches.`);
    if (!input || typeof input !== 'object') throw new Error('Enter a benchmark watch configuration.');
    const canonical = validateRequestedFolder(String(input.folder || '').trim());
    const folder = await this.checkFolder(canonical);
    const command = String(input.command || '').trim();
    if (!command || command.length > 2000) throw new Error('Enter a benchmark command (1–2,000 characters).');
    const metric = clip(input.metric, 80);
    if (!metric) throw new Error('Name the metric to track (e.g. latency_ms, tokens_per_s, loss).');
    const nowIso = new Date().toISOString();
    const watch = cleanWatch({ ...input, id: `bench-${randomUUID().slice(0, 8)}`, folder, command, metric, createdAt: nowIso, updatedAt: nowIso, state: {} })!;
    this.watches.push(watch);
    await this.save();
    return structuredClone(watch);
  }

  async update(id: string, patch: BenchmarkWatchPatch): Promise<BenchmarkWatch> {
    await this.ensureLoaded();
    if (typeof id !== 'string' || !/^bench-[a-z0-9-]+$/i.test(id)) throw new Error('That benchmark watch is gone.');
    const index = this.watches.findIndex(w => w.id === id);
    if (index < 0) throw new Error('That benchmark watch is gone.');
    const current = this.watches[index];
    const nextRaw = {
      ...current,
      ...(patch?.title !== undefined ? { title: patch.title } : {}),
      ...(patch?.branch !== undefined ? { branch: patch.branch } : {}),
      ...(patch?.command !== undefined ? { command: patch.command } : {}),
      ...(patch?.metric !== undefined ? { metric: patch.metric } : {}),
      ...(patch?.direction !== undefined ? { direction: patch.direction } : {}),
      ...(patch?.thresholdPct !== undefined ? { thresholdPct: patch.thresholdPct } : {}),
      ...(patch?.baselineWindow !== undefined ? { baselineWindow: patch.baselineWindow } : {}),
      ...(patch?.machine !== undefined ? { machine: patch.machine } : {}),
      ...(patch?.cpus !== undefined ? { cpus: patch.cpus } : {}),
      ...(patch?.memGb !== undefined ? { memGb: patch.memGb } : {}),
      ...(patch?.limitHours !== undefined ? { limitHours: patch.limitHours } : {}),
      ...(patch?.every !== undefined ? { every: patch.every } : {}),
      ...(patch?.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
      ...(patch?.state && typeof patch.state === 'object' ? { state: { ...current.state, ...patch.state } } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next = cleanWatch(nextRaw);
    if (!next) throw new Error('Benchmark watch settings must include a command and metric.');
    this.watches[index] = next;
    await this.save();
    return structuredClone(next);
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();
    if (typeof id !== 'string' || !/^bench-[a-z0-9-]+$/i.test(id)) throw new Error('That benchmark watch is gone.');
    const before = this.watches.length;
    this.watches = this.watches.filter(w => w.id !== id);
    if (this.watches.length === before) throw new Error('That benchmark watch is gone.');
    await this.save();
    return true;
  }
}

export async function readGitHead(folder: string, { exec = execFileAsync }: { exec?: GitExec } = {}): Promise<GitHeadInfo> {
  const opts = { cwd: folder, timeout: 8000, maxBuffer: 256 * 1024 };
  const [shaOut, branchOut, logOut] = await Promise.all([
    exec('git', ['rev-parse', 'HEAD'], opts),
    exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
    exec('git', ['log', '-1', '--pretty=%s%n%cI'], opts).catch(() => ({ stdout: '\n' })),
  ]);
  const commit = String(shaOut.stdout || '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('Could not read Git HEAD commit.');
  const branch = String(branchOut.stdout || '').trim();
  const [subject = '', committedAt = ''] = String(logOut.stdout || '').split('\n');
  return {
    commit,
    shortCommit: commit.slice(0, 8),
    branch: branch === 'HEAD' ? '' : branch,
    subject: clip(subject, 160),
    committedAt: committedAt.trim(),
  };
}

// Extracts numeric benchmark metrics from stdout JSON lines or `metric=value` / `metric: value` lines.
export function parseBenchmarkOutput(printout: unknown, preferredMetric = ''): Record<string, ParsedBenchmarkMetric> {
  const metrics: Record<string, ParsedBenchmarkMetric> = {};
  const text = String(printout || '');
  const addNum = (k: unknown, v: unknown): void => {
    const key = clip(k, 60);
    const num = Number(v);
    if (key && Number.isFinite(num)) metrics[key] = { value: num };
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed) as { metrics?: Record<string, unknown> } | Record<string, unknown>;
        const src = obj && typeof obj === 'object' && 'metrics' in obj && obj.metrics && typeof obj.metrics === 'object'
          ? (obj.metrics as Record<string, unknown>)
          : (obj as Record<string, unknown>);
        for (const [k, v] of Object.entries(src || {})) {
          if (v && typeof v === 'object' && Number.isFinite(Number((v as { value?: unknown }).value))) {
            const entry = v as { value?: unknown; unit?: unknown };
            metrics[clip(k, 60)] = { value: Number(entry.value), ...(typeof entry.unit === 'string' ? { unit: clip(entry.unit, 20) } : {}) };
          } else if (typeof v === 'number' && Number.isFinite(v)) {
            addNum(k, v);
          }
        }
      } catch {
        // Not JSON; try key/value format below.
      }
    }
    const kv = /^([A-Za-z0-9_.-]{1,60})\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/i.exec(trimmed);
    if (kv) addNum(kv[1], kv[2]);
  }
  if (preferredMetric && !metrics[preferredMetric]) {
    const lower = preferredMetric.toLowerCase();
    for (const [k, v] of Object.entries(metrics)) {
      if (k.toLowerCase() === lower) {
        metrics[preferredMetric] = v;
        break;
      }
    }
  }
  return metrics;
}

function median(nums: readonly number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Chronological commit trend series (oldest -> newest) for a given watch and metric.
export function seriesForWatch(
  runs: readonly RunRecord[],
  { watchId, metric, branch = '' }: { watchId?: string; metric?: string; branch?: string } = {},
): BenchmarkSeriesPoint[] {
  const tag = watchId ? `bench:${watchId}` : '';
  const list = (Array.isArray(runs) ? runs : [])
    .filter(run => {
      if (!run || typeof run !== 'object') return false;
      if (tag && !(Array.isArray(run.tags) && run.tags.includes(tag))) return false;
      if (branch && run.code?.branch && run.code.branch !== branch) return false;
      return true;
    })
    .map(run => {
      const entry = metric ? run.metrics?.[metric] : null;
      const value = typeof entry?.value === 'number' && Number.isFinite(entry.value) ? entry.value : null;
      const commit = String(run.code?.commit || '');
      return {
        runId: run.id,
        at: run.ended || run.started || '',
        commit,
        shortCommit: commit ? commit.slice(0, 8) : run.id,
        subject: String(run.code?.subject || ''),
        branch: String(run.code?.branch || ''),
        state: run.state,
        value,
        unit: entry?.unit || '',
        where: run.where?.kind || 'here',
      };
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return list;
}

export function detectRegression(
  series: readonly BenchmarkSeriesPoint[],
  { direction = 'lower', thresholdPct = 5, window = 5, metric = '' }: { direction?: BenchmarkDirection; thresholdPct?: number; window?: number; metric?: string } = {},
): BenchmarkRegression {
  const valid = (Array.isArray(series) ? series : []).filter(
    (p): p is BenchmarkSeriesPoint & { value: number } => p.state === 'done' && typeof p.value === 'number' && Number.isFinite(p.value),
  );
  if (valid.length < 2) {
    return {
      regressed: false,
      metric,
      direction,
      current: valid[0]?.value ?? null,
      baseline: null,
      thresholdPct,
      degradationPct: 0,
      pctChangeFromBaseline: 0,
      commit: valid.at(-1)?.commit || '',
      shortCommit: valid.at(-1)?.shortCommit || '',
      runId: valid.at(-1)?.runId || '',
      summary: 'Need at least two completed commit runs for a baseline comparison.',
    };
  }
  const current = valid.at(-1)!;
  const prior = valid.slice(Math.max(0, valid.length - 1 - Math.max(1, window)), valid.length - 1);
  const baseline = median(prior.map(p => p.value));
  const denom = Math.abs(baseline);
  const pctChangeFromBaseline = denom > 0
    ? ((current.value - baseline) / denom) * 100
    : current.value === baseline ? 0 : current.value > baseline ? 100 : -100;

  // For 'lower' is better (e.g. latency), an increase above baseline is degradation;
  // for 'higher' is better (e.g. throughput/accuracy), a decrease below baseline is degradation.
  const degradationPct = direction === 'higher' ? -pctChangeFromBaseline : pctChangeFromBaseline;
  const regressed = degradationPct >= thresholdPct;
  const signedDelta = `${pctChangeFromBaseline >= 0 ? '+' : ''}${pctChangeFromBaseline.toFixed(1)}%`;
  const summary = regressed
    ? `Regression on ${current.shortCommit}: ${metric || 'metric'} ${current.value} vs baseline ${Number(baseline.toFixed(4))} (${signedDelta}, ${direction === 'higher' ? 'lower' : 'higher'} than ${thresholdPct}% limit).`
    : `Within baseline on ${current.shortCommit}: ${metric || 'metric'} ${current.value} vs baseline ${Number(baseline.toFixed(4))} (${signedDelta}).`;

  return {
    regressed,
    metric,
    direction,
    current: current.value,
    baseline,
    thresholdPct,
    degradationPct: Math.round(degradationPct * 100) / 100,
    pctChangeFromBaseline: Math.round(pctChangeFromBaseline * 100) / 100,
    commit: current.commit,
    shortCommit: current.shortCommit,
    runId: current.runId,
    summary,
  };
}

export function benchmarkWatcher({
  store,
  runStore,
  nexusFactory = async () => null,
  runLocal,
  outputDir,
  gitHead = readGitHead,
  onRegression = () => {},
  log = () => {},
  now = () => new Date(),
}: BenchmarkWatcherOptions) {
  const busy = new Set<string>();

  async function evaluateAndRecord(w: BenchmarkWatch): Promise<{ series: BenchmarkSeriesPoint[]; regression: BenchmarkRegression }> {
    const runs = await runStore.list(w.folder);
    const series = seriesForWatch(runs, { watchId: w.id, metric: w.metric, branch: w.branch });
    const regression = detectRegression(series, {
      direction: w.direction,
      thresholdPct: w.thresholdPct,
      window: w.baselineWindow,
      metric: w.metric,
    });
    const latestValid = series.filter(p => p.state === 'done' && typeof p.value === 'number' && Number.isFinite(p.value)).at(-1);
    const patchState: Partial<BenchmarkWatchState> = {
      ...(latestValid ? { lastMetric: latestValid.value, lastRunId: latestValid.runId } : {}),
    };
    if (regression.regressed && w.state.lastAlertCommit !== regression.commit) {
      const alert: BenchmarkAlert = { ...regression, at: now().toISOString() };
      patchState.lastAlertCommit = regression.commit;
      patchState.lastAlert = alert;
      await store.update(w.id, { state: patchState });
      await Promise.resolve(onRegression({ watch: await store.get(w.id), regression })).catch(() => {});
    } else if (Object.keys(patchState).length) {
      await store.update(w.id, { state: patchState });
    }
    return { series, regression };
  }

  async function settlePending(w: BenchmarkWatch): Promise<number> {
    const runs = await runStore.list(w.folder);
    const pending = runs.filter(r => r.state === 'running' && r.where?.job && Array.isArray(r.tags) && r.tags.includes(`bench:${w.id}`));
    if (!pending.length) return 0;
    const nexus = await nexusFactory().catch(() => null);
    if (!nexus) return 0;
    let settled = 0;
    for (const run of pending) {
      try {
        const seen = await nexus.logs({ job: run.where.job!, seconds: 2 });
        if (!seen?.ended) continue;
        let fetched: { folder?: string; files?: Array<{ path: string }> } | null | undefined = null;
        try {
          fetched = await nexus.outputs({ job: run.where.job!, root: outputDir });
        } catch {
          fetched = null;
        }
        const outFolder = fetched?.folder ? join(outputDir, fetched.folder) : '';
        const reported: { params: Record<string, RunValue>; metrics: Record<string, RunMetric> } = outFolder
          ? await readRunFolder(outFolder)
          : { params: {}, metrics: {} };
        const printout = String(seen.log || '').slice(-8000);
        const parsedMetrics = Object.keys(reported.metrics || {}).length
          ? reported.metrics
          : parseBenchmarkOutput(printout, w.metric);
        const exit = typeof seen.exitCode === 'number' && Number.isInteger(seen.exitCode) ? seen.exitCode : null;
        const measured = run.started ? Math.max(0, (now().getTime() - Date.parse(run.started)) / 1000) : null;
        await runStore.finish(w.folder, run.id, {
          state: exit === null || exit === 0 ? 'done' : 'failed',
          exit,
          params: reported.params,
          metrics: parsedMetrics,
          files: Array.isArray(fetched?.files) ? fetched.files.map(f => ({ path: join(outFolder, f.path), bytes: null, sha256: null })) : [],
          seconds: measured,
          printout,
        });
        settled += 1;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log({ at: now().toISOString(), watch: w.id, action: 'settle-error', job: run.where?.job, error: msg });
      }
    }
    if (settled > 0) await evaluateAndRecord(w);
    return settled;
  }

  async function pollWatch(w: BenchmarkWatch | null | undefined, { force = false }: { force?: boolean } = {}) {
    if (!w || busy.has(w.id)) return { skipped: 'busy' as const };
    busy.add(w.id);
    try {
      await settlePending(w);
      const head = await gitHead(w.folder);
      if (w.branch && head.branch && head.branch !== w.branch && !force) {
        await store.update(w.id, { state: { lastCheckedAt: now().toISOString(), lastBranch: head.branch, error: '' } });
        return { skipped: 'branch-mismatch' as const, head };
      }
      if (!force && w.state.lastCommit === head.commit) {
        await store.update(w.id, { state: { lastCheckedAt: now().toISOString(), lastBranch: head.branch, error: '' } });
        return { skipped: 'same-commit' as const, head };
      }

      const nexus = w.machine === 'atlas' ? await nexusFactory().catch(() => null) : null;
      const onAtlas = w.machine === 'atlas';
      if (onAtlas && !nexus) {
        throw new Error('Nexus/Atlas isn’t set up on this Mac. Configure Nexus in Settings, or switch this benchmark watch to "here".');
      }
      if (!onAtlas && typeof runLocal !== 'function') {
        throw new Error('No local benchmark runner is available.');
      }

      let where: { kind: string; job?: string; limitHours?: number } = { kind: onAtlas ? 'atlas' : 'here' };
      let job = '';
      if (onAtlas && nexus) {
        const sub = await nexus.submit({
          root: w.folder,
          target: 'cpu',
          on: 'atlas',
          cpus: w.cpus,
          mem_gb: w.memGb,
          limit_hours: w.limitHours,
          name: `bench-${head.shortCommit}`,
          command: w.command,
        });
        job = String(sub?.job || '');
        if (!job) throw new Error('Atlas did not return a job id.');
        where = { kind: 'atlas', job, limitHours: w.limitHours };
      }

      const started = await runStore.start(w.folder, {
        name: `Bench ${w.title} @ ${head.shortCommit}`.slice(0, 80),
        command: w.command,
        code: { commit: head.commit, branch: head.branch, subject: head.subject, dirty: false },
        where,
        tags: ['benchmark', `bench:${w.id}`],
      });

      await store.update(w.id, {
        state: {
          lastCheckedAt: now().toISOString(),
          lastCommit: head.commit,
          lastBranch: head.branch,
          lastRunId: started.id,
          error: '',
        },
      });

      if (onAtlas) {
        log({ at: now().toISOString(), watch: w.id, action: 'submitted', commit: head.commit, job, runId: started.id });
        return { submitted: true as const, job, runId: started.id, commit: head.commit };
      }

      // Run synchronously here (explicit local mode or test runner).
      const beginMs = Date.now();
      const res = await runLocal!({ folder: w.folder, command: w.command, watch: w, commit: head.commit });
      const seconds = typeof res?.seconds === 'number' && Number.isFinite(res.seconds) ? res.seconds : Math.max(0.1, (Date.now() - beginMs) / 1000);
      const printout = String(res?.output || res?.printout || '').slice(-8000);
      const exit = typeof res?.exitCode === 'number' && Number.isInteger(res.exitCode)
        ? res.exitCode
        : typeof res?.exit === 'number' && Number.isInteger(res.exit)
          ? res.exit
          : 0;
      const metrics = res?.metrics && Object.keys(res.metrics).length
        ? res.metrics
        : parseBenchmarkOutput(printout, w.metric);
      const finished = await runStore.finish(w.folder, started.id, {
        state: exit === 0 ? 'done' : 'failed',
        exit,
        metrics,
        seconds,
        printout,
      });
      const evaluated = await evaluateAndRecord((await store.get(w.id)) || w);
      log({ at: now().toISOString(), watch: w.id, action: 'finished-local', commit: head.commit, runId: finished.id, regressed: evaluated.regression.regressed });
      return { finished: true as const, run: finished, regression: evaluated.regression };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await store.update(w.id, { state: { lastCheckedAt: now().toISOString(), error: clip(msg, 300) } }).catch(() => {});
      log({ at: now().toISOString(), watch: w.id, action: 'error', error: msg });
      throw error;
    } finally {
      busy.delete(w.id);
    }
  }

  async function step({ force = false, folder = '' }: { force?: boolean; folder?: string } = {}) {
    const all = await store.list(folder);
    const results: Array<Record<string, unknown>> = [];
    for (const w of all) {
      if (!w.enabled && !force) continue;
      // Settle pending Atlas jobs every step, regardless of commit check interval.
      await settlePending(w).catch(() => {});
      const fresh = await store.get(w.id);
      if (!fresh || (!fresh.enabled && !force)) continue;
      const due = force || !fresh.state.lastCheckedAt || (now().getTime() - new Date(fresh.state.lastCheckedAt).getTime()) >= fresh.every * 60_000;
      if (!due) continue;
      try {
        results.push({ id: fresh.id, ...(await pollWatch(fresh, { force })) });
      } catch (error) {
        results.push({ id: fresh.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  return { settlePending, pollWatch, evaluateAndRecord, step };
}
