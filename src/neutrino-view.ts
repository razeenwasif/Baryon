import './neutrino-view.css';
import { renderDiff } from './changes-pane.js';

export type HomeTab = 'overview' | 'repos' | 'prs' | 'ci';
export type RepoTab = 'overview' | 'commits' | 'prs' | 'ci' | 'meta';
type HomePrFilter = 'all' | 'ready' | 'open';
type RunSeriesKey = 'passing' | 'active' | 'failing';

export interface NeutrinoOpenTarget {
  kind?: 'home' | 'repo' | 'pr' | 'run';
  tab?: HomeTab | RepoTab;
  repo?: string;
  number?: number;
  id?: string | number;
}

type NeutrinoViewState =
  | { kind: 'home'; tab: HomeTab }
  | { kind: 'repo'; repo: string; tab: RepoTab }
  | { kind: 'pr'; repo: string; number: number }
  | { kind: 'run'; repo: string; id: string | number };

interface SplinePoint {
  x: number;
  y: number;
  val: number;
}

interface RunSeriesBucket {
  key: string;
  label: string;
  total: number;
  passing: number;
  active: number;
  failing: number;
}

interface RunSeriesLegendItem {
  key: RunSeriesKey;
  label: string;
  color: string;
}

interface RunSeries {
  days: RunSeriesBucket[];
  legend: RunSeriesLegendItem[];
  maxValue: number;
  totalValue: number;
}

interface BreakdownItem {
  label: string;
  value: number;
  color: string;
}

export interface NeutrinoMirror {
  state: string;
  url?: string;
  lastOk?: string;
}

export interface NeutrinoRepoSummary {
  id: string;
  name: string;
  branch?: string;
  mirror?: NeutrinoMirror | null;
}

export interface NeutrinoReposResponse {
  repos?: NeutrinoRepoSummary[];
  total?: number;
}

export interface NeutrinoRun {
  id: string | number;
  repo: string;
  number: number;
  name?: string;
  workflow?: string;
  state: string;
  branch?: string;
  sha?: string;
  event?: string;
  pull?: number;
  error?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface NeutrinoJobStep {
  name: string;
  state: string;
  exit_code?: number | null;
}

export interface NeutrinoJob {
  id: string | number;
  name: string;
  state: string;
  executor?: string;
  environment?: string;
  steps?: NeutrinoJobStep[];
}

export interface NeutrinoRunData {
  run: NeutrinoRun;
  jobs?: NeutrinoJob[];
  warnings?: string[];
}

export interface NeutrinoCiLog {
  jobName?: string;
  log?: string;
  note?: string;
}

export interface NeutrinoWaitingApproval {
  repo: string;
  run: string | number;
  number: number;
  job: string | number;
  job_name?: string;
  run_name?: string;
  environment?: string;
  branch?: string;
}

export interface NeutrinoPrSummary {
  repo: string;
  number: number;
  title: string;
  source: string;
  target: string;
  state?: string;
  openNotes?: number;
  checks?: string;
  updatedAt?: string;
  updated?: string;
  bucket?: 'ready' | 'open';
}

export interface NeutrinoPrFile {
  path: string;
  binary?: boolean;
  additions?: number;
  deletions?: number;
}

export interface NeutrinoPrNote {
  id: string | number;
  path: string;
  line?: number;
  currentLine?: number;
  text: string;
  resolved?: boolean;
}

export interface NeutrinoPrCheck {
  id: string | number;
  name?: string;
  workflow?: string;
  state: string;
}

export interface NeutrinoPrMergeability {
  clean: boolean;
  conflicts?: string[];
  behind?: number;
}

export interface NeutrinoPrData {
  repo: string;
  number: number;
  title: string;
  state: string;
  source: string;
  target: string;
  body?: string;
  mergeability?: NeutrinoPrMergeability;
  checks?: NeutrinoPrCheck[];
  files?: NeutrinoPrFile[];
  notes?: NeutrinoPrNote[];
}

export interface NeutrinoPrDiff {
  text?: string;
}

export interface NeutrinoRule {
  pattern: string;
  require_pull?: boolean;
  block_force?: boolean;
  block_delete?: boolean;
  required_checks?: string[];
}

export interface NeutrinoEnvironment {
  name: string;
  require_approval?: boolean;
}

export interface NeutrinoSecret {
  name: string;
}

export interface NeutrinoVariable {
  name: string;
  value: string;
}

export interface NeutrinoRepoLanguage {
  name: string;
  bytes: number;
}

export interface NeutrinoRepoData {
  id: string;
  name?: string;
  branch?: string;
  branches?: string[];
  mirror?: NeutrinoMirror | null;
  path?: string;
  license?: string;
  commits?: number;
  commitsCapped?: boolean;
  contributors?: number;
  files?: number;
  languages?: NeutrinoRepoLanguage[];
  allPrs?: NeutrinoPrSummary[];
  runs?: NeutrinoRun[];
  rules?: NeutrinoRule[];
  environments?: NeutrinoEnvironment[];
}

export interface NeutrinoCommitSummary {
  sha: string;
  short?: string;
  subject?: string;
  author?: string;
  date?: string;
  refs?: string[];
}

export interface NeutrinoCommitsData {
  commits?: NeutrinoCommitSummary[];
  more?: boolean;
}

export interface NeutrinoCommitFile {
  path: string;
  added?: number | null;
  removed?: number | null;
}

export interface NeutrinoCommitDetail {
  message?: string;
  files?: NeutrinoCommitFile[];
}

interface ExpandedCommit {
  detail: NeutrinoCommitDetail;
  diffs: Map<string, string>;
}

export interface NeutrinoWorkflow {
  name?: string;
  file: string;
  error?: string;
  triggers?: string[];
}

export interface NeutrinoWorkflowsData {
  workflows?: NeutrinoWorkflow[];
}

export interface NeutrinoRulesData {
  rules?: NeutrinoRule[];
}

export interface NeutrinoVaultData {
  environments?: NeutrinoEnvironment[];
  secrets?: NeutrinoSecret[];
  variables?: NeutrinoVariable[];
}

export interface NeutrinoStatus {
  role?: string;
  host?: string;
  version?: string;
  protocol?: string | number;
  repos?: number;
  failingMirrors?: unknown[];
  ci?: {
    graviton?: boolean;
    running?: number;
    queued?: number;
    used_cpus?: number;
    budget_cpus?: number;
  };
}

export interface NeutrinoInbox {
  host?: string;
  waiting?: NeutrinoWaitingApproval[];
  ready?: NeutrinoPrSummary[];
  open?: NeutrinoPrSummary[];
  runs?: NeutrinoRun[];
}

export interface NeutrinoCloneResult {
  clone?: {
    folder?: string;
    cloned?: boolean;
  };
  [key: string]: unknown;
}

export interface NeutrinoViewApi {
  neutrinoStatus?: () => Promise<NeutrinoStatus | null>;
  neutrinoInbox?: () => Promise<NeutrinoInbox | null>;
  neutrinoRepos?: (options?: { kind?: string; limit?: number }) => Promise<NeutrinoReposResponse | null>;
  neutrinoRepo?: (repo: string) => Promise<NeutrinoRepoData | null>;
  neutrinoCommits?: (repo: string, options?: { skip?: number; limit?: number }) => Promise<NeutrinoCommitsData | null>;
  neutrinoCommit?: (repo: string, sha: string) => Promise<NeutrinoCommitDetail | null>;
  neutrinoCommitFileDiff?: (repo: string, sha: string, path: string) => Promise<string | null>;
  neutrinoClone?: (repo: string) => Promise<NeutrinoCloneResult | null>;
  neutrinoPr?: (repo: string, number: number) => Promise<NeutrinoPrData | null>;
  neutrinoPrDiff?: (repo: string, number: number, path: string) => Promise<NeutrinoPrDiff | null>;
  neutrinoPrCreate?: (args: { repo: string; title: string; source: string; target: string }) => Promise<{ number: number } | null>;
  neutrinoPrUpdate?: (args: { repo: string; number: number; state: string }) => Promise<unknown>;
  neutrinoPrNote?: (args: { repo: string; number: number; path: string; side: string; line: number; text: string }) => Promise<unknown>;
  neutrinoPrResolveNote?: (args: { repo: string; number: number; note: string | number; resolved: boolean }) => Promise<unknown>;
  neutrinoPrMerge?: (args: { repo: string; number: number; strategy: string }) => Promise<{ sha?: string } | null>;
  neutrinoRun?: (repo: string, id: string | number) => Promise<NeutrinoRunData | null>;
  neutrinoCiLog?: (repo: string, run: string | number, job: string | number) => Promise<NeutrinoCiLog | null>;
  neutrinoRunStart?: (args: { repo: string; workflow: string; branch: string }) => Promise<{ id: string | number; number: number } | null>;
  neutrinoRunRerun?: (args: { repo: string; id: string | number }) => Promise<{ id: string | number; number: number } | null>;
  neutrinoRunCancel?: (args: { repo: string; id: string | number }) => Promise<unknown>;
  neutrinoJobApprove?: (args: { repo: string; job: string | number; approve: boolean }) => Promise<unknown>;
  neutrinoWorkflows?: (repo: string, branch?: string) => Promise<NeutrinoWorkflowsData | null>;
  neutrinoRules?: (repo: string) => Promise<NeutrinoRulesData | null>;
  neutrinoVault?: (repo: string, environment?: string) => Promise<NeutrinoVaultData | null>;
  neutrinoMirrorNow?: (repo: string) => Promise<unknown>;
  neutrinoCreateRepo?: (args: { name: string; description: string }) => Promise<{ id?: string; cloneUrl?: string } | null>;
  neutrinoBackup?: () => Promise<{ path?: string } | null>;
}

export interface NeutrinoViewOptions {
  api: NeutrinoViewApi | null | undefined;
  root: HTMLElement;
  onOpenWork?: ((next: NeutrinoCloneResult, message: string) => void) | null;
  onDraft?: ((prompt: string) => void) | null;
  onError?: (message: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface NeutrinoViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  open: (target?: NeutrinoOpenTarget) => void;
  isOpen: () => boolean;
}

interface TopbarCrumb {
  label: string;
  muted?: boolean;
  onclick?: () => void;
}

interface TopbarSegs<T extends string> {
  active: T;
  items: Array<{ id: T; label: string }>;
  onSelect: (id: T) => void;
}

interface TopbarOptions<T extends string = string> {
  crumbs: TopbarCrumb[];
  segs?: TopbarSegs<T> | null;
  actions?: HTMLElement[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const cleanErr = (error: unknown): string =>
  String((error as { message?: unknown } | null | undefined)?.message || error || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

const relativeTime = (iso: string | null | undefined, now = Date.now()): string => {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return '—';
  const mins = Math.round((now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
};

const stateBadgeClass = (state: string | null | undefined): string => {
  const s = String(state || '').toLowerCase();
  if (['success', 'ok', 'clean', 'passing', 'ready', 'open'].includes(s)) return 'is-pass';
  if (['failure', 'failing', 'conflicts', 'closed', 'error', 'cancelled'].includes(s)) return 'is-fail';
  if (['waiting', 'running', 'queued', 'pending'].includes(s)) return 'is-warn';
  if (s === 'merged') return 'is-accent';
  return '';
};

const stateChip = (state = '', label = ''): HTMLSpanElement => {
  const clean = String(state || '').toLowerCase();
  return el('span', `nv-chip ${stateBadgeClass(clean)}`.trim(), label || clean || '—');
};

// Monotone Fritsch-Carlson cubic spline path (matching Usage view) so smooth curves never undershoot below zero.
function monotoneSplinePath(pts: SplinePoint[]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  const tangent = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const xStep = Math.max(1e-4, pts[i + 1].x - pts[i].x);
    const yStep = pts[i + 1].y - pts[i].y;
    dx.push(xStep);
    dy.push(yStep);
    slope.push(yStep / xStep);
  }
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tangent[i] = 0;
    else {
      const common = dx[i - 1] + dx[i];
      tangent[i] = (3 * common) / ((common + dx[i]) / slope[i - 1] + (common + dx[i - 1]) / slope[i]);
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const step = dx[i] / 3;
    const c1x = pts[i].x + step;
    const c1y = pts[i].y + tangent[i] * step;
    const c2x = pts[i + 1].x - step;
    const c2y = pts[i + 1].y - tangent[i + 1] * step;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

function dayKeyLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildRunSeries(runs: NeutrinoRun[] = [], daysCount = 14): RunSeries {
  const now = Date.now();
  const buckets: RunSeriesBucket[] = [];
  const byKey = new Map<string, RunSeriesBucket>();
  for (let i = daysCount - 1; i >= 0; i--) {
    const at = new Date(now - i * 86400000);
    const key = dayKeyLocal(at.getTime());
    const label = at.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    const entry: RunSeriesBucket = { key, label, total: 0, passing: 0, active: 0, failing: 0 };
    buckets.push(entry);
    byKey.set(key, entry);
  }
  for (const r of runs) {
    const iso = r.finishedAt || r.startedAt || r.createdAt || '';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    const b = byKey.get(dayKeyLocal(ms));
    if (!b) continue;
    const st = String(r.state || '').toLowerCase();
    b.total += 1;
    if (st === 'success') b.passing += 1;
    else if (st === 'failure' || st === 'cancelled' || st === 'error') b.failing += 1;
    else b.active += 1;
  }
  const legend: RunSeriesLegendItem[] = [
    { key: 'passing', label: 'Passing', color: '#34d399' },
    { key: 'active', label: 'Active / Waiting', color: '#38bdf8' },
    { key: 'failing', label: 'Failing', color: '#f87171' },
  ];
  let maxValue = 0;
  let totalValue = 0;
  for (const b of buckets) {
    totalValue += b.total;
    maxValue = Math.max(maxValue, b.passing, b.active, b.failing);
  }
  return { days: buckets, legend, maxValue, totalValue };
}

/** Integrated full-screen Neutrino workspace styled like Fairy's Usage page. */
export function neutrinoView({
  api,
  root,
  onOpenWork = null,
  onDraft = null,
  onError = () => {},
  onShow = () => {},
  onHide = () => {},
}: NeutrinoViewOptions): NeutrinoViewController {
  let view: NeutrinoViewState = { kind: 'home', tab: 'overview' };
  let status: NeutrinoStatus | null = null;
  let inbox: NeutrinoInbox | null = null;
  let repos: NeutrinoReposResponse | null = null;
  let repoData: NeutrinoRepoData | null = null;
  let commitsData: NeutrinoCommitsData | null = null;
  let prData: NeutrinoPrData | null = null;
  let runData: NeutrinoRunData | null = null;
  let ciLog: NeutrinoCiLog | null = null;
  let workflowsData: NeutrinoWorkflowsData | null = null;
  let rulesData: NeutrinoRulesData | null = null;
  let vaultData: NeutrinoVaultData | null = null;

  let loading = false;
  let notice = '';
  let noticeTone: 'done' | 'info' = 'done';
  let homeRepoQuery = '';
  let homePrQuery = '';
  let homePrFilter: HomePrFilter = 'all'; // 'all' | 'ready' | 'open'
  let showNewRepo = false;
  let showNewPr = false;
  let showDispatch = false;
  let showFullPrDiff = false;
  let prFullDiff: NeutrinoPrDiff | null = null;
  let selectedJob: string | number | null = null;
  let expandedCommits = new Map<string, ExpandedCommit>(); // sha -> { detail, diffs: Map<path, string> }
  let expandedPrFiles = new Map<string, string>(); // path -> string
  let gradSeed = 0;

  const isOpen = (): boolean => !root.hidden;

  const guard = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      onError(`Neutrino: ${cleanErr(error)}`);
      return null;
    }
  };

  function resetSub({ keepNotice = false } = {}): void {
    repoData = null;
    commitsData = null;
    prData = null;
    runData = null;
    ciLog = null;
    workflowsData = null;
    rulesData = null;
    vaultData = null;
    showNewRepo = false;
    showNewPr = false;
    showDispatch = false;
    showFullPrDiff = false;
    prFullDiff = null;
    selectedJob = null;
    expandedCommits = new Map();
    expandedPrFiles = new Map();
    if (!keepNotice) notice = '';
  }

  function invalidateHome(): void {
    status = null;
    inbox = null;
    repos = null;
  }

  async function loadCurrent({ force = false, silentRepoFallback = false } = {}): Promise<void> {
    if (!api || loading || root.hidden) return;
    loading = true;
    render();
    try {
      if (force) {
        invalidateHome();
        if (view.kind === 'repo') {
          repoData = null;
          commitsData = null;
          rulesData = null;
          vaultData = null;
          expandedCommits = new Map();
        } else if (view.kind === 'pr') {
          prData = null;
          prFullDiff = null;
          expandedPrFiles = new Map();
        } else if (view.kind === 'run') {
          runData = null;
          ciLog = null;
        }
      }

      if (view.kind === 'home') {
        const [st, inb, rp] = await Promise.all([
          !status && api.neutrinoStatus ? api.neutrinoStatus().catch(() => null) : Promise.resolve(status),
          !inbox && api.neutrinoInbox ? api.neutrinoInbox().catch(() => null) : Promise.resolve(inbox),
          !repos && api.neutrinoRepos ? api.neutrinoRepos({ kind: 'server', limit: 120 }).catch(() => null) : Promise.resolve(repos),
        ]);
        status = st;
        inbox = inb;
        repos = rp;
      } else if (view.kind === 'repo') {
        if (!repos && api.neutrinoRepos) {
          repos = await api.neutrinoRepos({ kind: 'server', limit: 120 }).catch(() => null);
        }
        const targetName = view.repo;
        try {
          const [ov, cm] = await Promise.all([
            api.neutrinoRepo ? api.neutrinoRepo(targetName) : Promise.resolve(null),
            api.neutrinoCommits ? api.neutrinoCommits(targetName, { limit: 60 }) : Promise.resolve(null),
          ]);
          repoData = ov;
          commitsData = cm;
          if (ov?.id) view.repo = ov.id;
          if (view.tab === 'meta') {
            await ensureRepoMeta(view.repo);
          }
        } catch (err) {
          if (silentRepoFallback) {
            const list = repos?.repos || [];
            const tail = String(targetName || '').split('/').pop()?.replace(/\.git$/i, '').toLowerCase() ?? '';
            const match = list.find(r => r.id.toLowerCase() === tail || r.name.toLowerCase() === tail);
            if (match && api.neutrinoRepo) {
              view.repo = match.id;
              const [ov, cm] = await Promise.all([
                api.neutrinoRepo(match.id),
                api.neutrinoCommits ? api.neutrinoCommits(match.id, { limit: 60 }) : Promise.resolve(null),
              ]);
              repoData = ov;
              commitsData = cm;
            } else {
              view = { kind: 'home', tab: 'repos' };
              notice = `“${targetName}” isn’t hosted on Neutrino yet — showing your Neutrino server.`;
              noticeTone = 'info';
              const [st, inb] = await Promise.all([
                !status && api.neutrinoStatus ? api.neutrinoStatus().catch(() => null) : Promise.resolve(status),
                !inbox && api.neutrinoInbox ? api.neutrinoInbox().catch(() => null) : Promise.resolve(inbox),
              ]);
              status = st;
              inbox = inb;
            }
          } else {
            onError(`Neutrino: ${cleanErr(err)}`);
          }
        }
      } else if (view.kind === 'pr') {
        if (!prData && api.neutrinoPr) {
          prData = await api.neutrinoPr(view.repo, view.number);
        }
      } else if (view.kind === 'run') {
        if (!runData && api.neutrinoRun) {
          runData = await api.neutrinoRun(view.repo, view.id);
        }
        if (runData?.jobs?.length && !ciLog && api.neutrinoCiLog) {
          const picked =
            runData.jobs.find(j => j.id === selectedJob) ||
            runData.jobs.find(j => j.state === 'failure') ||
            runData.jobs.find(j => j.state === 'waiting') ||
            runData.jobs[0];
          if (picked) {
            selectedJob = picked.id;
            ciLog = await api.neutrinoCiLog(view.repo, runData.run.id, picked.id).catch(() => null);
          }
        }
      }
    } catch (err) {
      onError(`Neutrino: ${cleanErr(err)}`);
    } finally {
      loading = false;
      render();
    }
  }

  async function ensureRepoMeta(repoId: string): Promise<void> {
    const [rules, vault] = await Promise.all([
      !rulesData && api?.neutrinoRules ? guard(() => api.neutrinoRules!(repoId)) : Promise.resolve(rulesData),
      !vaultData && api?.neutrinoVault ? guard(() => api.neutrinoVault!(repoId, '')) : Promise.resolve(vaultData),
    ]);
    rulesData = rules;
    vaultData = vault;
  }

  function renderSplineChart(series: RunSeries): HTMLElement {
    const col = el('section', 'nv-chart-col');
    const head = el('div', 'nv-chart-head');
    head.append(el('h2', 'nv-chart-title', 'Recent CI activity'));
    const leg = el('div', 'nv-legend');
    for (const item of series.legend) {
      const pill = el('span', 'nv-legend-item');
      const dot = el('i', 'nv-dot');
      dot.style.background = item.color;
      pill.append(dot, el('span', '', item.label));
      leg.append(pill);
    }
    head.append(leg);
    col.append(head);

    if (series.totalValue <= 0) {
      const empty = el('div', 'nv-empty nv-chart-empty');
      empty.append(
        el('p', 'nv-empty-title', 'No recent CI runs recorded'),
        el('p', 'nv-empty-sub', 'Dispatch a workflow on any Neutrino repository or push a branch to see Graviton CI activity here.'),
      );
      col.append(empty);
      return col;
    }

    const wrap = el('div', 'nv-chart-wrap');
    const tooltip = el('div', 'nv-tooltip');
    tooltip.hidden = true;

    const W = 680;
    const H = 264;
    const padL = 46;
    const padR = 16;
    const padT = 14;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const baseY = padT + plotH;
    const niceMax = Math.max(series.maxValue * 1.18, 4);
    const svg = svgEl('svg', { class: 'nv-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Recent CI runs spline chart' });

    for (let g = 0; g <= 4; g++) {
      const ratio = g / 4;
      const y = padT + plotH * (1 - ratio);
      svg.append(
        svgEl('line', {
          x1: padL,
          x2: W - padR,
          y1: y.toFixed(1),
          y2: y.toFixed(1),
          class: g === 0 ? 'nv-axis-line' : 'nv-grid-line',
        }),
      );
      const lbl = svgEl('text', { x: padL - 10, y: (y + 3.5).toFixed(1), class: 'nv-y-label' });
      lbl.textContent = String(Math.round(niceMax * ratio));
      svg.append(lbl);
    }

    const defs = svgEl('defs');
    svg.append(defs);

    const days = series.days;
    const n = days.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xOf = (idx: number): number => (n > 1 ? padL + idx * stepX : padL + plotW / 2);
    const yOf = (val: number): number => padT + plotH * (1 - Math.max(0, Math.min(1, val / niceMax)));

    const splinePtsByKey = new Map<RunSeriesKey, { meta: RunSeriesLegendItem; pts: SplinePoint[] }>();
    for (const sMeta of series.legend) {
      const pts: SplinePoint[] = days.map((day, idx) => {
        const val = day[sMeta.key] || 0;
        return { x: xOf(idx), y: yOf(val), val };
      });
      if (!pts.some(p => p.val > 0)) continue;
      splinePtsByKey.set(sMeta.key, { meta: sMeta, pts });

      const gid = `nv-grad-${++gradSeed}`;
      const grad = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
      grad.append(
        svgEl('stop', { offset: '0%', 'stop-color': sMeta.color, 'stop-opacity': '0.26' }),
        svgEl('stop', { offset: '100%', 'stop-color': sMeta.color, 'stop-opacity': '0.01' }),
      );
      defs.append(grad);

      const strokeD = monotoneSplinePath(pts);
      const areaD = `${strokeD} L${pts.at(-1)!.x.toFixed(2)},${baseY.toFixed(2)} L${pts[0].x.toFixed(2)},${baseY.toFixed(2)} Z`;
      svg.append(
        svgEl('path', { d: areaD, fill: `url(#${gid})` }),
        svgEl('path', { d: strokeD, fill: 'none', stroke: sMeta.color, 'stroke-width': '1.85', 'stroke-linecap': 'round' }),
      );
    }

    const tickCount = Math.min(n, 4);
    const tickIndices = new Set<number>();
    if (n <= 4) {
      for (let i = 0; i < n; i++) tickIndices.add(i);
    } else {
      for (let t = 0; t < tickCount; t++) tickIndices.add(Math.round((t * (n - 1)) / (tickCount - 1)));
    }
    for (const idx of tickIndices) {
      const tx = svgEl('text', { x: xOf(idx).toFixed(1), y: H - 6, class: 'nv-x-label' });
      tx.textContent = String(days[idx].label || '').toUpperCase();
      svg.append(tx);
    }

    const guide = svgEl('line', { x1: padL, x2: padL, y1: padT, y2: baseY, class: 'nv-guide', visibility: 'hidden' });
    svg.append(guide);
    const hoverDots = new Map<RunSeriesKey, SVGCircleElement>();
    for (const [k, { meta }] of splinePtsByKey) {
      const c = svgEl('circle', { r: 3.8, fill: meta.color, stroke: '#08080a', 'stroke-width': 1.6, visibility: 'hidden' });
      hoverDots.set(k, c);
      svg.append(c);
    }

    const colW = n > 1 ? plotW / (n - 1) : plotW;
    days.forEach((day, idx) => {
      const cx = xOf(idx);
      const rx = n > 1 ? Math.max(padL, cx - colW / 2) : padL;
      const rw = n > 1 ? Math.min(W - padR - rx, cx + colW / 2 - rx) : plotW;
      const band = svgEl('rect', { x: rx.toFixed(2), y: padT, width: Math.max(2, rw).toFixed(2), height: plotH, class: 'nv-hover-band' });

      band.addEventListener('mouseenter', () => {
        guide.setAttribute('x1', cx.toFixed(2));
        guide.setAttribute('x2', cx.toFixed(2));
        guide.setAttribute('visibility', 'visible');
        for (const [k, dotNode] of hoverDots) {
          const pt = splinePtsByKey.get(k)?.pts[idx];
          if (pt && pt.val > 0) {
            dotNode.setAttribute('cx', pt.x.toFixed(2));
            dotNode.setAttribute('cy', pt.y.toFixed(2));
            dotNode.setAttribute('visibility', 'visible');
          } else {
            dotNode.setAttribute('visibility', 'hidden');
          }
        }
        tooltip.replaceChildren();
        const tHead = el('div', 'nv-tip-head');
        tHead.append(el('strong', '', day.label), el('span', '', `${day.total} ${day.total === 1 ? 'run' : 'runs'}`));
        tooltip.append(tHead, el('div', 'nv-tip-total', `${day.total} CI ${day.total === 1 ? 'run' : 'runs'}`));
        for (const meta of series.legend) {
          const val = day[meta.key] || 0;
          if (!val) continue;
          const row = el('div', 'nv-tip-row');
          const d = el('i', 'nv-dot');
          d.style.background = meta.color;
          row.append(d, el('span', 'nv-tip-lbl', meta.label), el('span', 'nv-tip-val', String(val)));
          tooltip.append(row);
        }
        tooltip.hidden = false;
        const pct = (cx / W) * 100;
        tooltip.style.left = `${Math.max(16, Math.min(82, pct))}%`;
      });
      band.addEventListener('mouseleave', () => {
        guide.setAttribute('visibility', 'hidden');
        for (const dotNode of hoverDots.values()) dotNode.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
      });
      svg.append(band);
    });

    wrap.append(svg, tooltip);
    col.append(wrap);
    return col;
  }

  function renderBreakdownCard(title: string, items: BreakdownItem[]): HTMLDivElement {
    const card = el('div', 'nv-break-card');
    const head = el('div', 'nv-break-head');
    head.append(el('span', 'nv-break-title', title));
    card.append(head);

    const total = items.reduce((s, i) => s + Math.max(0, Number(i.value) || 0), 0);
    const track = el('div', 'nv-stack-track');
    const positive = items.filter(i => i.value > 0);
    if (!positive.length || total <= 0) {
      track.append(el('div', 'nv-stack-empty'));
    } else {
      for (const seg of positive) {
        const share = seg.value / total;
        const part = el('div', 'nv-stack-seg');
        part.style.width = `${Math.max(2, share * 100).toFixed(2)}%`;
        part.style.background = seg.color;
        part.title = `${seg.label}: ${seg.value} (${Math.round(share * 100)}%)`;
        track.append(part);
      }
    }
    card.append(track);

    const legend = el('div', 'nv-break-legend');
    for (const seg of items) {
      const item = el('div', 'nv-break-item');
      const sw = el('i', 'nv-swatch');
      sw.style.background = seg.color;
      item.append(sw, el('span', 'nv-break-lbl', seg.label), el('span', 'nv-break-val nv-mono', String(seg.value)));
      legend.append(item);
    }
    card.append(legend);
    return card;
  }

  function renderCommitList(commits: NeutrinoCommitSummary[], repoId: string, { more = false }: { more?: boolean } = {}): HTMLElement {
    if (!commits?.length) return el('p', 'nv-muted', 'No commits yet on this branch.');
    const wrap = el('div', 'nv-sec');
    const list = el('div', 'nv-rows');
    for (const c of commits) {
      const itemWrap = el('div');
      const expanded = expandedCommits.get(c.sha);
      const row = el('div', `nv-row is-clickable${expanded ? ' is-selected' : ''}`);
      row.tabIndex = 0;
      const main = el('div', 'nv-row-main');
      const titleRow = el('div', 'nv-row-title');
      titleRow.append(el('span', 'nv-row-title-text', c.subject || '(no subject)'));
      for (const ref of c.refs || []) {
        titleRow.append(el('span', 'nv-pill', ref));
      }
      const sub = el('div', 'nv-row-sub');
      sub.append(el('span', '', c.author || 'Unknown'), el('span', '', relativeTime(c.date)));
      main.append(titleRow, sub);
      const right = el('div', 'nv-row-right');
      right.append(el('span', 'nv-pill nv-mono', c.short || String(c.sha).slice(0, 7)));
      row.append(main, right);

      const toggleCommit = async () => {
        if (expandedCommits.has(c.sha)) {
          expandedCommits.delete(c.sha);
          render();
          return;
        }
        const detail = api?.neutrinoCommit ? await guard(() => api.neutrinoCommit!(repoId, c.sha)) : null;
        if (!detail) return;
        expandedCommits.set(c.sha, { detail, diffs: new Map() });
        render();
      };
      row.onclick = () => void toggleCommit();
      row.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void toggleCommit();
        }
      };
      itemWrap.append(row);

      if (expanded) {
        const box = el('div', 'nv-commit-expand');
        const bodyMsg = String(expanded.detail.message || '').split('\n').slice(1).join('\n').trim();
        if (bodyMsg) box.append(el('pre', 'nv-prose', bodyMsg));
        const files = expanded.detail.files || [];
        if (files.length) {
          const filesList = el('div', 'nv-files');
          for (const f of files) {
            const diffText = expanded.diffs.get(f.path);
            const fBtn = el('button', 'nv-file-btn');
            fBtn.type = 'button';
            fBtn.setAttribute('aria-expanded', String(diffText != null));
            fBtn.append(
              el('span', 'nv-file-path', f.path),
              el('span', 'nv-add', f.added == null ? 'binary' : `+${f.added}`),
              el('span', 'nv-del', f.removed == null ? '' : `−${f.removed}`),
            );
            fBtn.onclick = async e => {
              e.stopPropagation();
              if (expanded.diffs.has(f.path)) {
                expanded.diffs.delete(f.path);
                render();
                return;
              }
              const txt = api?.neutrinoCommitFileDiff ? await guard(() => api.neutrinoCommitFileDiff!(repoId, c.sha, f.path)) : '';
              if (txt != null) {
                expanded.diffs.set(f.path, txt);
                render();
              }
            };
            filesList.append(fBtn);
            if (diffText != null) {
              const dWrap = el('div', 'nv-diff-wrap');
              dWrap.append(String(diffText).trim() ? renderDiff(diffText, f.path) : el('p', 'nv-muted', 'No textual diff for this file.'));
              filesList.append(dWrap);
            }
          }
          box.append(filesList);
        } else {
          box.append(el('p', 'nv-muted', 'No files changed in this commit.'));
        }
        itemWrap.append(box);
      }

      list.append(itemWrap);
    }
    wrap.append(list);

    if (more && api?.neutrinoCommits) {
      const foot = el('div', 'nv-actions');
      const loadMore = el('button', 'nv-btn', 'Load older commits');
      loadMore.type = 'button';
      loadMore.onclick = async () => {
        loadMore.disabled = true;
        const older = await guard(() => api.neutrinoCommits!(repoId, { skip: commits.length, limit: 60 }));
        if (older?.commits?.length) {
          commitsData = {
            ...commitsData,
            more: Boolean(older.more),
            commits: [...commits, ...older.commits],
          };
          render();
        } else {
          loadMore.disabled = false;
        }
      };
      foot.append(loadMore);
      wrap.append(foot);
    }
    return wrap;
  }

  function renderNoticeBanner(): HTMLDivElement | null {
    if (!notice) return null;
    const banner = el('div', `nv-notice${noticeTone === 'info' ? ' is-info' : ''}`);
    banner.append(el('span', '', notice));
    const dismiss = el('button', 'nv-btn', 'Dismiss');
    dismiss.type = 'button';
    dismiss.onclick = () => {
      notice = '';
      render();
    };
    banner.append(dismiss);
    return banner;
  }

  function renderTopbar<T extends string = string>({ crumbs, segs = null, actions = [] }: TopbarOptions<T>): HTMLElement {
    const topbar = el('header', 'nv-topbar');
    const nav = el('nav', 'nv-breadcrumbs');
    nav.setAttribute('aria-label', 'Neutrino breadcrumb');
    crumbs.forEach((c, idx) => {
      if (idx > 0) nav.append(el('span', 'nv-crumb-sep', '/'));
      if (c.onclick) {
        const b = el('button', `nv-crumb is-clickable${c.muted ? ' is-muted' : ''}`, c.label);
        b.type = 'button';
        b.onclick = c.onclick;
        nav.append(b);
      } else {
        nav.append(el('span', `nv-crumb${c.muted ? ' is-muted' : ''}`, c.label));
      }
    });

    const right = el('div', 'nv-actions');
    if (segs?.items?.length) {
      const seg = el('div', 'nv-seg');
      for (const item of segs.items) {
        const b = el('button', `nv-seg-btn${segs.active === item.id ? ' is-active' : ''}`, item.label);
        b.type = 'button';
        b.onclick = () => segs.onSelect(item.id);
        seg.append(b);
      }
      right.append(seg);
    }
    for (const act of actions) right.append(act);

    const refreshBtn = el('button', 'nv-btn', loading ? 'Refreshing…' : 'Refresh');
    refreshBtn.type = 'button';
    refreshBtn.disabled = loading;
    refreshBtn.onclick = () => void loadCurrent({ force: true });
    right.append(refreshBtn);

    const closeBtn = el('button', 'nv-btn nv-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = 'Close Neutrino view (Esc)';
    closeBtn.setAttribute('aria-label', 'Close Neutrino view');
    closeBtn.onclick = () => hide();
    right.append(closeBtn);

    topbar.append(nav, right);
    return topbar;
  }

  function renderHomeView(body: HTMLElement, homeView: Extract<NeutrinoViewState, { kind: 'home' }>): void {
    const tab = homeView.tab || 'overview';
    const extraActions: HTMLButtonElement[] = [];
    if (api?.neutrinoCreateRepo) {
      const btn = el('button', `nv-btn${showNewRepo ? ' is-active' : ''}`, showNewRepo ? 'Cancel' : 'New repo');
      btn.type = 'button';
      btn.onclick = () => {
        showNewRepo = !showNewRepo;
        render();
      };
      extraActions.push(btn);
    }
    if (api?.neutrinoBackup) {
      const btn = el('button', 'nv-btn', 'Back up DB');
      btn.type = 'button';
      btn.onclick = async () => {
        if (!confirm('Take a snapshot backup of the Neutrino database now?')) return;
        const done = await guard(() => api.neutrinoBackup!());
        if (done) {
          notice = done.path ? `Snapshot saved: ${done.path}` : 'Database backup finished.';
          noticeTone = 'done';
          render();
        }
      };
      extraActions.push(btn);
    }

    const hostLabel = status?.role === 'server' ? 'Local server' : inbox?.host || status?.host || 'Neutrino server';
    body.append(
      renderTopbar<HomeTab>({
        crumbs: [
          { label: 'Neutrino', muted: true },
          { label: hostLabel },
        ],
        segs: {
          active: tab,
          items: [
            { id: 'overview', label: 'Overview' },
            { id: 'repos', label: 'Repositories' },
            { id: 'prs', label: 'Pull requests' },
            { id: 'ci', label: 'CI & Deploys' },
          ],
          onSelect: id => {
            homeView.tab = id;
            render();
          },
        },
        actions: extraActions,
      }),
    );

    const b = renderNoticeBanner();
    if (b) body.append(b);

    if (showNewRepo) {
      const form = el('div', 'nv-inline-form');
      const nameIn = el('input', 'nv-input');
      nameIn.placeholder = 'Repository name (e.g. my-project)';
      nameIn.spellcheck = false;
      const descIn = el('input', 'nv-input');
      descIn.placeholder = 'Description (optional)';
      const createBtn = el('button', 'nv-btn is-primary', 'Create repository');
      createBtn.type = 'button';
      createBtn.onclick = async () => {
        const clean = nameIn.value.trim();
        if (!clean) return;
        createBtn.disabled = true;
        const done = await guard(() => api!.neutrinoCreateRepo!({ name: clean, description: descIn.value.trim() }));
        createBtn.disabled = false;
        if (!done) return;
        showNewRepo = false;
        notice = `Created hosted repo ${done.id || clean}${done.cloneUrl ? ` · clone: ${done.cloneUrl}` : ''}`;
        noticeTone = 'done';
        void loadCurrent({ force: true });
      };
      form.append(nameIn, descIn, createBtn);
      body.append(form);
    }

    if (!loading && !status && !repos) {
      const empty = el('div', 'nv-empty nv-chart-empty');
      empty.append(
        el('p', 'nv-empty-title', 'Neutrino isn’t reachable right now'),
        el('p', 'nv-empty-sub', 'Check `neutrinod` or SSH access to your Neutrino server, then click Refresh.'),
      );
      body.append(empty);
      return;
    }

    const repoList = repos?.repos || [];
    const repoTotal = repos?.total ?? repoList.length ?? status?.repos ?? 0;
    const waiting = inbox?.waiting || [];
    const readyPrs: NeutrinoPrSummary[] = (inbox?.ready || []).map(p => ({ ...p, bucket: 'ready' as const }));
    const openPrs: NeutrinoPrSummary[] = (inbox?.open || []).map(p => ({ ...p, bucket: 'open' as const }));
    const allPrs = [...readyPrs, ...openPrs];
    const recentRuns = inbox?.runs || [];
    const failingMirrors = repoList.filter(r => r.mirror?.state === 'failing').length || status?.failingMirrors?.length || 0;
    const healthyMirrors = repoList.filter(r => r.mirror && r.mirror.state !== 'failing').length;
    const unmirrored = repoList.filter(r => !r.mirror).length;
    const ci = status?.ci;

    if (tab === 'overview') {
      const heroGrid = el('div', 'nv-hero-grid');
      const leftCol = el('div', 'nv-stat-col');

      const heroStat = el('div', 'nv-hero-stat');
      heroStat.append(
        el('div', 'nv-hero-value', `${repoTotal.toLocaleString()} ${repoTotal === 1 ? 'repo' : 'repos'}`),
      );
      const sub = el('div', 'nv-hero-sub');
      sub.append(
        stateChip(ci?.graviton ? 'success' : 'failing', ci?.graviton ? 'Graviton online' : 'Graviton offline'),
        el('span', '', status?.version ? `v${status.version} · proto ${status.protocol ?? '—'}` : 'Connected'),
      );
      heroStat.append(sub);
      leftCol.append(heroStat);

      const statList = el('div', 'nv-stat-list');
      const heroRows = [
        {
          label: 'Deploy approvals',
          color: '#f59e0b',
          count: String(waiting.length),
          sub: waiting.length ? `${waiting.length} waiting deploy gate${waiting.length === 1 ? '' : 's'}` : 'No gates waiting',
          onClick: () => { homeView.tab = 'ci'; render(); },
        },
        {
          label: 'Open pull requests',
          color: '#34d399',
          count: String(allPrs.length),
          sub: `${readyPrs.length} ready to merge · ${openPrs.length} active`,
          onClick: () => { homeView.tab = 'prs'; render(); },
        },
        {
          label: 'Recent CI runs',
          color: '#38bdf8',
          count: String(recentRuns.length),
          sub: ci ? `${ci.running ?? 0} running · ${ci.queued ?? 0} queued` : 'Scheduler idle',
          onClick: () => { homeView.tab = 'ci'; render(); },
        },
        {
          label: 'Mirror health',
          color: failingMirrors ? '#f87171' : '#818cf8',
          count: failingMirrors ? `${failingMirrors} failing` : 'Healthy',
          sub: `${healthyMirrors} synced · ${unmirrored} local-only`,
          onClick: () => { homeView.tab = 'repos'; render(); },
        },
      ];
      for (const hr of heroRows) {
        const btn = el('button', 'nv-stat-row');
        btn.type = 'button';
        btn.onclick = hr.onClick;
        const line1 = el('div', 'nv-stat-top');
        const id = el('div', 'nv-stat-id');
        const dot = el('i', 'nv-dot');
        dot.style.background = hr.color;
        id.append(dot, el('span', 'nv-stat-name', hr.label));
        line1.append(id, el('span', 'nv-stat-count', hr.count));
        btn.append(line1, el('div', 'nv-stat-sub', hr.sub));
        statList.append(btn);
      }
      leftCol.append(statList);
      heroGrid.append(leftCol, renderSplineChart(buildRunSeries(recentRuns, 14)));
      body.append(heroGrid);

      // 5-col Usage-style Totals Strip
      const totalsSec = el('section', 'nv-totals-sec');
      totalsSec.append(el('h3', 'nv-sec-title', 'Server totals'));
      const totalsGrid = el('div', 'nv-totals-grid');
      for (const [lbl, val] of [
        ['Hosted repos', String(repoTotal)],
        ['Graviton CPUs', ci ? `${ci.used_cpus ?? 0}/${ci.budget_cpus ?? 0}` : '—'],
        ['Open PRs', String(allPrs.length)],
        ['Waiting deploys', String(waiting.length)],
        ['Failing mirrors', String(failingMirrors)],
      ] as Array<[string, string]>) {
        const item = el('div', 'nv-total-item');
        item.append(el('span', 'nv-total-lbl', lbl), el('span', 'nv-total-val', val));
        totalsGrid.append(item);
      }
      totalsSec.append(totalsGrid);
      body.append(totalsSec);

      // 2-col Breakdown bars
      const runPass = recentRuns.filter(r => r.state === 'success').length;
      const runFail = recentRuns.filter(r => ['failure', 'cancelled', 'error'].includes(r.state)).length;
      const runActive = recentRuns.length - runPass - runFail;
      const breakGrid = el('section', 'nv-break-grid');
      breakGrid.append(
        renderBreakdownCard('CI run outcomes', [
          { label: 'Passing', value: runPass, color: '#34d399' },
          { label: 'Running / Waiting', value: runActive, color: '#38bdf8' },
          { label: 'Failing', value: runFail, color: '#f87171' },
        ]),
        renderBreakdownCard('Repository mirrors', [
          { label: 'Synced to GitHub', value: healthyMirrors, color: '#818cf8' },
          { label: 'Failing mirror', value: failingMirrors, color: '#f87171' },
          { label: 'Neutrino only', value: unmirrored, color: '#52525b' },
        ]),
      );
      body.append(breakGrid);
    }

    // Deploy approvals waiting
    if ((tab === 'overview' || tab === 'ci') && waiting.length) {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Deploy approvals waiting (${waiting.length})`), el('span', 'nv-dim', 'Manual environment gates'));
      sec.append(head);
      const list = el('div', 'nv-rows');
      for (const w of waiting) {
        const row = el('div', 'nv-row is-clickable');
        row.tabIndex = 0;
        row.onclick = () => {
          resetSub({ keepNotice: true });
          view = { kind: 'run', repo: w.repo, id: w.run };
          void loadCurrent();
        };
        const main = el('div', 'nv-row-main');
        const title = el('div', 'nv-row-title');
        title.append(el('span', 'nv-pill nv-mono', `${w.repo} #${w.number}`), el('span', 'nv-row-title-text', w.job_name || w.run_name || 'Deploy job'));
        const sub = el('div', 'nv-row-sub');
        if (w.environment) sub.append(stateChip('waiting', w.environment));
        if (w.branch) sub.append(el('span', 'nv-mono', w.branch));
        main.append(title, sub);
        const right = el('div', 'nv-row-right');
        const approveBtn = el('button', 'nv-btn is-primary', 'Approve');
        approveBtn.type = 'button';
        approveBtn.onclick = async e => {
          e.stopPropagation();
          if (!confirm(`Approve deploy job “${w.job_name}” in ${w.repo}${w.environment ? ` (${w.environment})` : ''}?`)) return;
          const res = await guard(() => api!.neutrinoJobApprove!({ repo: w.repo, job: w.job, approve: true }));
          if (res) {
            notice = `Approved ${w.job_name} in ${w.repo}.`;
            noticeTone = 'done';
            void loadCurrent({ force: true });
          }
        };
        const rejectBtn = el('button', 'nv-btn is-danger', 'Reject');
        rejectBtn.type = 'button';
        rejectBtn.onclick = async e => {
          e.stopPropagation();
          if (!confirm(`Reject deploy job “${w.job_name}” in ${w.repo}?`)) return;
          const res = await guard(() => api!.neutrinoJobApprove!({ repo: w.repo, job: w.job, approve: false }));
          if (res) {
            notice = `Rejected ${w.job_name} in ${w.repo}.`;
            noticeTone = 'done';
            void loadCurrent({ force: true });
          }
        };
        right.append(approveBtn, rejectBtn);
        row.append(main, right);
        list.append(row);
      }
      sec.append(list);
      body.append(sec);
    }

    // Pull requests
    if (tab === 'overview' || tab === 'prs') {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Pull requests (${allPrs.length})`));
      const ctl = el('div', 'nv-sec-controls');
      const prSearch = el('input', 'nv-search');
      prSearch.type = 'search';
      prSearch.placeholder = 'Filter pull requests…';
      prSearch.value = homePrQuery;
      prSearch.oninput = () => {
        homePrQuery = prSearch.value;
        render();
        const next = body.parentElement?.querySelector<HTMLInputElement>('.nv-pr-search');
        next?.focus();
        if (next) next.setSelectionRange(next.value.length, next.value.length);
      };
      prSearch.classList.add('nv-pr-search');

      const fSeg = el('div', 'nv-seg');
      for (const [fk, fl] of [['all', 'All'], ['ready', `Ready (${readyPrs.length})`], ['open', `Open (${openPrs.length})`]] as Array<[HomePrFilter, string]>) {
        const fb = el('button', `nv-seg-btn${homePrFilter === fk ? ' is-active' : ''}`, fl);
        fb.type = 'button';
        fb.onclick = () => {
          homePrFilter = fk;
          render();
        };
        fSeg.append(fb);
      }
      ctl.append(fSeg, prSearch);
      head.append(ctl);
      sec.append(head);

      const q = homePrQuery.trim().toLowerCase();
      const filteredPrs = allPrs.filter(pr => {
        if (homePrFilter !== 'all' && pr.bucket !== homePrFilter) return false;
        if (!q) return true;
        return `${pr.repo}#${pr.number} ${pr.title} ${pr.source} ${pr.target}`.toLowerCase().includes(q);
      });

      if (!filteredPrs.length) {
        sec.append(el('p', 'nv-muted', allPrs.length ? 'No pull requests match that filter.' : 'No open pull requests on Neutrino right now.'));
      } else {
        const list = el('div', 'nv-rows');
        for (const pr of filteredPrs) {
          const row = el('div', 'nv-row is-clickable');
          row.tabIndex = 0;
          row.onclick = () => {
            resetSub({ keepNotice: true });
            view = { kind: 'pr', repo: pr.repo, number: pr.number };
            void loadCurrent();
          };
          const main = el('div', 'nv-row-main');
          const title = el('div', 'nv-row-title');
          title.append(el('span', 'nv-pill nv-mono', `${pr.repo}#${pr.number}`), el('span', 'nv-row-title-text', pr.title));
          const sub = el('div', 'nv-row-sub');
          sub.append(
            el('span', 'nv-mono', `${pr.source} → ${pr.target}`),
            stateChip(pr.bucket === 'ready' ? 'passing' : 'open', pr.bucket === 'ready' ? 'ready' : `${pr.openNotes || 0} notes`),
          );
          if (pr.checks) sub.append(stateChip(pr.checks, `CI: ${pr.checks}`));
          main.append(title, sub);
          const right = el('div', 'nv-row-right');
          if (onDraft) {
            const askBtn = el('button', 'nv-btn', 'Ask Fairy');
            askBtn.type = 'button';
            askBtn.onclick = e => {
              e.stopPropagation();
              onDraft(`Look at Neutrino pull request ${pr.repo}#${pr.number} (“${pr.title}”): inspect its diff, notes, and CI status and tell me if it’s ready to merge.`);
            };
            right.append(askBtn);
          }
          right.append(el('span', 'nv-dim nv-mono', relativeTime(pr.updatedAt || pr.updated)));
          row.append(main, right);
          list.append(row);
        }
        sec.append(list);
      }
      body.append(sec);
    }

    // Recent CI runs
    if (tab === 'overview' || tab === 'ci') {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Recent CI runs (${recentRuns.length})`));
      sec.append(head);
      if (!recentRuns.length) {
        sec.append(el('p', 'nv-muted', 'No recent CI runs recorded.'));
      } else {
        const list = el('div', 'nv-rows');
        const showRuns = tab === 'ci' ? recentRuns : recentRuns.slice(0, 12);
        for (const r of showRuns) {
          const row = el('div', 'nv-row is-clickable');
          row.tabIndex = 0;
          row.onclick = () => {
            resetSub({ keepNotice: true });
            view = { kind: 'run', repo: r.repo, id: r.id };
            void loadCurrent();
          };
          const main = el('div', 'nv-row-main');
          const title = el('div', 'nv-row-title');
          title.append(el('span', 'nv-pill nv-mono', `${r.repo} #${r.number}`), el('span', 'nv-row-title-text', r.name || r.workflow));
          const sub = el('div', 'nv-row-sub');
          sub.append(stateChip(r.state, r.state), el('span', 'nv-mono', r.branch || String(r.sha || '').slice(0, 7)));
          if (r.event) sub.append(el('span', '', r.event));
          main.append(title, sub);
          const right = el('div', 'nv-row-right');
          if (r.state === 'failure' && onDraft) {
            const dbg = el('button', 'nv-btn', 'Debug');
            dbg.type = 'button';
            dbg.onclick = e => {
              e.stopPropagation();
              onDraft(`Read the Neutrino CI log for ${r.repo} run id ${r.id} (${r.name || r.workflow} #${r.number}) and tell me why it failed.`);
            };
            right.append(dbg);
          }
          right.append(el('span', 'nv-dim nv-mono', relativeTime(r.finishedAt || r.startedAt || r.createdAt)));
          row.append(main, right);
          list.append(row);
        }
        sec.append(list);
      }
      body.append(sec);
    }

    // Hosted repositories
    if (tab === 'overview' || tab === 'repos') {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Hosted repositories (${repoList.length})`));
      const rSearch = el('input', 'nv-search nv-repo-search');
      rSearch.type = 'search';
      rSearch.placeholder = 'Search repositories…';
      rSearch.value = homeRepoQuery;
      rSearch.oninput = () => {
        homeRepoQuery = rSearch.value;
        render();
        const next = body.parentElement?.querySelector<HTMLInputElement>('.nv-repo-search');
        next?.focus();
        if (next) next.setSelectionRange(next.value.length, next.value.length);
      };
      head.append(rSearch);
      sec.append(head);

      const rq = homeRepoQuery.trim().toLowerCase();
      const filteredRepos = repoList.filter(r => !rq || `${r.name} ${r.id} ${r.mirror?.url || ''}`.toLowerCase().includes(rq));
      if (!filteredRepos.length) {
        sec.append(el('p', 'nv-muted', repoList.length ? 'No repositories match that search.' : 'No hosted repositories yet.'));
      } else {
        const list = el('div', 'nv-rows');
        for (const r of filteredRepos) {
          const row = el('div', 'nv-row is-clickable');
          row.tabIndex = 0;
          row.onclick = () => {
            resetSub({ keepNotice: true });
            view = { kind: 'repo', repo: r.id, tab: 'overview' };
            void loadCurrent();
          };
          const main = el('div', 'nv-row-main');
          const title = el('div', 'nv-row-title');
          title.append(el('span', 'nv-row-title-text', r.name || r.id));
          if (r.branch) title.append(el('span', 'nv-pill nv-mono', r.branch));
          const sub = el('div', 'nv-row-sub');
          if (r.mirror) {
            sub.append(stateChip(r.mirror.state, `mirror ${r.mirror.state}`));
            if (r.mirror.url) sub.append(el('span', '', r.mirror.url));
            if (r.mirror.lastOk) sub.append(el('span', '', `synced ${relativeTime(r.mirror.lastOk)}`));
          } else {
            sub.append(el('span', '', 'No GitHub mirror'));
          }
          main.append(title, sub);
          const right = el('div', 'nv-row-right');
          if (r.mirror && api?.neutrinoMirrorNow) {
            const mBtn = el('button', 'nv-btn', 'Mirror now');
            mBtn.type = 'button';
            mBtn.onclick = async e => {
              e.stopPropagation();
              mBtn.disabled = true;
              const res = await guard(() => api.neutrinoMirrorNow!(r.id));
              mBtn.disabled = false;
              if (res) {
                notice = `Synced mirror for ${r.id}.`;
                noticeTone = 'done';
                void loadCurrent({ force: true });
              }
            };
            right.append(mBtn);
          }
          if (onOpenWork && api?.neutrinoClone) {
            const cBtn = el('button', 'nv-btn', 'Clone & work');
            cBtn.type = 'button';
            cBtn.onclick = async e => {
              e.stopPropagation();
              cBtn.disabled = true;
              cBtn.textContent = 'Cloning…';
              const next = await guard(() => api.neutrinoClone!(r.id));
              cBtn.disabled = false;
              cBtn.textContent = 'Clone & work';
              if (next) {
                const where = next.clone?.folder;
                onOpenWork(next, where ? `${next.clone?.cloned ? 'Cloned into' : 'Opened your clone in'} ${where}` : '');
              }
            };
            right.append(cBtn);
          }
          row.append(main, right);
          list.append(row);
        }
        sec.append(list);
      }
      body.append(sec);
    }
  }

  function renderRepoView(body: HTMLElement, repoView: Extract<NeutrinoViewState, { kind: 'repo' }>): void {
    const repo = repoView.repo;
    const rTab = repoView.tab || 'overview';
    const o = repoData;

    body.append(
      renderTopbar<RepoTab>({
        crumbs: [
          {
            label: 'Neutrino',
            muted: true,
            onclick: () => {
              resetSub();
              view = { kind: 'home', tab: 'overview' };
              void loadCurrent();
            },
          },
          { label: o?.name || repo },
        ],
        segs: {
          active: rTab,
          items: [
            { id: 'overview', label: 'Overview' },
            { id: 'commits', label: 'Commits' },
            { id: 'prs', label: `Pull requests${o?.allPrs?.length ? ` (${o.allPrs.length})` : ''}` },
            { id: 'ci', label: `CI Runs${o?.runs?.length ? ` (${o.runs.length})` : ''}` },
            { id: 'meta', label: 'Rules & Vault' },
          ],
          onSelect: id => {
            repoView.tab = id;
            if (id === 'meta' && (!rulesData || !vaultData)) {
              void ensureRepoMeta(repo).then(() => render());
            } else {
              render();
            }
          },
        },
      }),
    );

    const b = renderNoticeBanner();
    if (b) body.append(b);

    if (!o) {
      body.append(el('p', 'nv-dim', loading ? `Loading ${repo}…` : `Couldn’t load ${repo}.`));
      return;
    }

    // Header + action strip
    const detailHead = el('div', 'nv-detail-header');
    const titleWrap = el('div', 'nv-detail-title-wrap');
    const h1 = el('h1', 'nv-detail-h1');
    h1.append(el('span', '', o.name || o.id));
    if (o.branch) h1.append(el('span', 'nv-pill nv-mono', o.branch));
    if (o.mirror) h1.append(stateChip(o.mirror.state, `mirror ${o.mirror.state}`));
    const meta = el('div', 'nv-detail-meta');
    if (o.path) meta.append(el('span', 'nv-mono', o.path));
    if (o.license) meta.append(el('span', '', `License: ${o.license}`));
    if (o.mirror?.url) meta.append(el('span', '', `Mirror: ${o.mirror.url}`));
    titleWrap.append(h1, meta);

    const acts = el('div', 'nv-actions');
    if (onOpenWork && api?.neutrinoClone) {
      const cloneBtn = el('button', 'nv-btn is-primary', 'Clone & work');
      cloneBtn.type = 'button';
      cloneBtn.onclick = async () => {
        cloneBtn.disabled = true;
        cloneBtn.textContent = 'Cloning…';
        const next = await guard(() => api.neutrinoClone!(o.id));
        cloneBtn.disabled = false;
        cloneBtn.textContent = 'Clone & work';
        if (next) {
          const where = next.clone?.folder;
          onOpenWork(next, where ? `${next.clone?.cloned ? 'Cloned into' : 'Opened your clone in'} ${where}` : '');
        }
      };
      acts.append(cloneBtn);
    }
    if (o.mirror && api?.neutrinoMirrorNow) {
      const syncBtn = el('button', 'nv-btn', 'Sync mirror');
      syncBtn.type = 'button';
      syncBtn.onclick = async () => {
        const res = await guard(() => api.neutrinoMirrorNow!(o.id));
        if (res) {
          notice = `Synced ${o.id} to GitHub mirror.`;
          noticeTone = 'done';
          void loadCurrent({ force: true });
        }
      };
      acts.append(syncBtn);
    }
    if (api?.neutrinoPrCreate) {
      const prBtn = el('button', `nv-btn${showNewPr ? ' is-active' : ''}`, showNewPr ? 'Cancel PR' : 'New PR');
      prBtn.type = 'button';
      prBtn.onclick = () => {
        showNewPr = !showNewPr;
        showDispatch = false;
        render();
      };
      acts.append(prBtn);
    }
    if (api?.neutrinoRunStart) {
      const wfBtn = el('button', `nv-btn${showDispatch ? ' is-active' : ''}`, showDispatch ? 'Cancel run' : 'Run workflow');
      wfBtn.type = 'button';
      wfBtn.onclick = async () => {
        showDispatch = !showDispatch;
        showNewPr = false;
        if (showDispatch && !workflowsData && api.neutrinoWorkflows) {
          workflowsData = await guard(() => api.neutrinoWorkflows!(o.id, o.branch || 'main'));
        }
        render();
      };
      acts.append(wfBtn);
    }
    detailHead.append(titleWrap, acts);
    body.append(detailHead);

    if (showNewPr) {
      const form = el('div', 'nv-inline-form');
      const titleIn = el('input', 'nv-input');
      titleIn.placeholder = 'PR title';
      const srcIn = el('input', 'nv-input');
      srcIn.placeholder = 'Source branch';
      srcIn.spellcheck = false;
      const dstIn = el('input', 'nv-input');
      dstIn.placeholder = 'Target branch';
      dstIn.value = o.branch || 'main';
      dstIn.spellcheck = false;
      const submit = el('button', 'nv-btn is-primary', 'Create PR');
      submit.type = 'button';
      submit.onclick = async () => {
        const t = titleIn.value.trim();
        const s = srcIn.value.trim();
        const d = dstIn.value.trim();
        if (!t || !s || !d) return;
        if (!confirm(`Open Neutrino PR "${t}" (${s} → ${d}) in ${o.id}?`)) return;
        const created = await guard(() => api!.neutrinoPrCreate!({ repo: o.id, title: t, source: s, target: d }));
        if (created) {
          resetSub();
          notice = `Opened PR #${created.number}.`;
          noticeTone = 'done';
          view = { kind: 'pr', repo: o.id, number: created.number };
          void loadCurrent({ force: true });
        }
      };
      form.append(titleIn, srcIn, dstIn, submit);
      body.append(form);
    }

    if (showDispatch) {
      const form = el('div', 'nv-inline-form');
      const wfSelect = el('select', 'nv-select');
      const dispatchable = (workflowsData?.workflows || []).filter(w => !w.error && w.triggers?.includes('workflow_dispatch'));
      for (const wf of dispatchable.length ? dispatchable : workflowsData?.workflows || []) {
        const opt = el('option', '', wf.name || wf.file);
        opt.value = wf.file;
        wfSelect.append(opt);
      }
      const wfIn = el('input', 'nv-input');
      wfIn.placeholder = 'Workflow file (e.g. ci.yml)';
      if (wfSelect.options.length) wfIn.value = wfSelect.value;
      wfSelect.onchange = () => { wfIn.value = wfSelect.value; };
      const brIn = el('input', 'nv-input');
      brIn.placeholder = 'Branch';
      brIn.value = o.branch || 'main';
      const go = el('button', 'nv-btn is-primary', 'Dispatch');
      go.type = 'button';
      go.onclick = async () => {
        const wf = (wfIn.value || wfSelect.value).trim();
        const br = brIn.value.trim();
        if (!wf || !br) return;
        if (!confirm(`Dispatch workflow ${wf} on ${br} in ${o.id}?`)) return;
        const res = await guard(() => api!.neutrinoRunStart!({ repo: o.id, workflow: wf, branch: br }));
        if (res) {
          resetSub();
          notice = `Started run #${res.number}.`;
          noticeTone = 'done';
          view = { kind: 'run', repo: o.id, id: res.id };
          void loadCurrent({ force: true });
        }
      };
      form.append(wfSelect.options.length ? wfSelect : wfIn, brIn, go);
      body.append(form);
    }

    // 5-col Usage-style Totals Strip
    const totalsSec = el('section', 'nv-totals-sec');
    const totalsGrid = el('div', 'nv-totals-grid');
    for (const [lbl, val] of [
      ['Default branch', o.branch || '—'],
      ['Branches', String((o.branches || []).length)],
      ['Commits', String(o.commitsCapped ? `${o.commits}+` : o.commits ?? '—')],
      ['Contributors', String(o.contributors ?? 0)],
      ['Tracked files', String(o.files ?? 0)],
    ] as Array<[string, string]>) {
      const item = el('div', 'nv-total-item');
      item.append(el('span', 'nv-total-lbl', lbl), el('span', 'nv-total-val', val));
      totalsGrid.append(item);
    }
    totalsSec.append(totalsGrid);
    body.append(totalsSec);

    if (rTab === 'overview' && o.languages?.length) {
      const totalBytes = o.languages.reduce((s, l) => s + (l.bytes || 0), 0);
      const langPalette = ['#3e5aec', '#38bdf8', '#34d399', '#a78bfa', '#f59e0b', '#71717a'];
      if (totalBytes > 0) {
        const segs: BreakdownItem[] = o.languages.slice(0, 5).map((l, idx) => ({
          label: `${l.name} (${Math.max(1, Math.round((l.bytes / totalBytes) * 100))}%)`,
          value: l.bytes,
          color: langPalette[idx % langPalette.length],
        }));
        body.append(renderBreakdownCard('Languages', segs));
      }
    }

    if ((rTab === 'overview' || rTab === 'prs') && o.allPrs?.length) {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Pull requests (${o.allPrs.length})`));
      sec.append(head);
      const list = el('div', 'nv-rows');
      for (const pr of o.allPrs) {
        const row = el('div', 'nv-row is-clickable');
        row.tabIndex = 0;
        row.onclick = () => {
          resetSub({ keepNotice: true });
          view = { kind: 'pr', repo: o.id, number: pr.number };
          void loadCurrent();
        };
        const main = el('div', 'nv-row-main');
        const title = el('div', 'nv-row-title');
        title.append(el('span', 'nv-pill nv-mono', `#${pr.number}`), el('span', 'nv-row-title-text', pr.title));
        const sub = el('div', 'nv-row-sub');
        sub.append(stateChip(pr.state, pr.state), el('span', 'nv-mono', `${pr.source} → ${pr.target}`));
        main.append(title, sub);
        row.append(main, el('span', 'nv-dim nv-mono', relativeTime(pr.updatedAt)));
        list.append(row);
      }
      sec.append(list);
      body.append(sec);
    } else if (rTab === 'prs') {
      body.append(el('p', 'nv-muted', 'No pull requests in this repository yet.'));
    }

    if ((rTab === 'overview' || rTab === 'ci') && o.runs?.length) {
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Recent CI runs (${o.runs.length})`));
      sec.append(head);
      const list = el('div', 'nv-rows');
      for (const r of o.runs) {
        const row = el('div', 'nv-row is-clickable');
        row.tabIndex = 0;
        row.onclick = () => {
          resetSub({ keepNotice: true });
          view = { kind: 'run', repo: o.id, id: r.id };
          void loadCurrent();
        };
        const main = el('div', 'nv-row-main');
        const title = el('div', 'nv-row-title');
        title.append(el('span', 'nv-pill nv-mono', `#${r.number}`), el('span', 'nv-row-title-text', r.name || r.workflow));
        const sub = el('div', 'nv-row-sub');
        sub.append(stateChip(r.state, r.state), el('span', 'nv-mono', r.branch || '—'));
        main.append(title, sub);
        const right = el('div', 'nv-row-right');
        if (['running', 'queued', 'waiting'].includes(r.state)) {
          const cBtn = el('button', 'nv-btn', 'Cancel');
          cBtn.type = 'button';
          cBtn.onclick = async e => {
            e.stopPropagation();
            if (!confirm(`Cancel run #${r.number}?`)) return;
            const res = await guard(() => api!.neutrinoRunCancel!({ repo: o.id, id: r.id }));
            if (res) {
              notice = `Cancelling run #${r.number}.`;
              noticeTone = 'done';
              void loadCurrent({ force: true });
            }
          };
          right.append(cBtn);
        } else if (api?.neutrinoRunRerun) {
          const rBtn = el('button', 'nv-btn', 'Rerun');
          rBtn.type = 'button';
          rBtn.onclick = async e => {
            e.stopPropagation();
            if (!confirm(`Rerun ${r.name || r.workflow} #${r.number}?`)) return;
            const res = await guard(() => api.neutrinoRunRerun!({ repo: o.id, id: r.id }));
            if (res) {
              notice = `Started rerun #${res.number}.`;
              noticeTone = 'done';
              void loadCurrent({ force: true });
            }
          };
          right.append(rBtn);
        }
        right.append(el('span', 'nv-dim nv-mono', relativeTime(r.finishedAt || r.createdAt)));
        row.append(main, right);
        list.append(row);
      }
      sec.append(list);
      body.append(sec);
    } else if (rTab === 'ci') {
      body.append(el('p', 'nv-muted', 'No CI runs recorded yet.'));
    }

    if (rTab === 'overview' || rTab === 'commits') {
      const commits = commitsData?.commits || [];
      const sec = el('section', 'nv-sec');
      const head = el('div', 'nv-sec-head');
      head.append(el('h3', 'nv-sec-title', `Commit history on ${o.branch || 'default branch'}`), el('span', 'nv-dim', 'Click any commit to inspect changed files & diffs'));
      sec.append(head);
      sec.append(renderCommitList(commits, o.id, { more: commitsData?.more }));
      body.append(sec);
    }

    if (rTab === 'meta') {
      const rulesSec = el('section', 'nv-sec');
      rulesSec.append(el('h3', 'nv-sec-title', 'Branch protection rules'));
      const rules = rulesData?.rules || o.rules || [];
      if (rules.length) {
        const list = el('div', 'nv-rows');
        for (const r of rules) {
          const row = el('div', 'nv-row');
          const flags = [
            r.require_pull ? 'PR required' : '',
            r.block_force ? 'no force push' : '',
            r.block_delete ? 'no delete' : '',
            ...(r.required_checks || []).map(c => `check:${c}`),
          ].filter(Boolean);
          const main = el('div', 'nv-row-main');
          main.append(el('div', 'nv-row-title nv-mono', r.pattern), el('div', 'nv-row-sub', flags.join(' · ') || 'default'));
          row.append(main);
          list.append(row);
        }
        rulesSec.append(list);
      } else {
        rulesSec.append(el('p', 'nv-muted', 'No branch protection rules configured.'));
      }
      body.append(rulesSec);

      const vaultSec = el('section', 'nv-sec');
      vaultSec.append(el('h3', 'nv-sec-title', 'Environments & Vault (names only)'));
      const envs = vaultData?.environments || o.environments || [];
      const secrets = vaultData?.secrets || [];
      const vars = vaultData?.variables || [];
      const list = el('div', 'nv-rows');
      for (const e of envs) {
        const row = el('div', 'nv-row');
        const main = el('div', 'nv-row-main');
        main.append(el('div', 'nv-row-title', `Environment: ${e.name}`), el('div', 'nv-row-sub', e.require_approval ? 'Manual approval gate required' : 'Automatic deploy'));
        row.append(main, stateChip(e.require_approval ? 'waiting' : 'success', e.require_approval ? 'approval gate' : 'open'));
        list.append(row);
      }
      for (const s of secrets) {
        const row = el('div', 'nv-row');
        const main = el('div', 'nv-row-main');
        main.append(el('div', 'nv-row-title nv-mono', s.name), el('div', 'nv-row-sub', 'Vault secret (value hidden on server)'));
        row.append(main, el('span', 'nv-pill', 'secret'));
        list.append(row);
      }
      for (const v of vars) {
        const row = el('div', 'nv-row');
        const main = el('div', 'nv-row-main');
        main.append(el('div', 'nv-row-title nv-mono', `${v.name} = ${v.value}`), el('div', 'nv-row-sub', 'Vault variable'));
        row.append(main, el('span', 'nv-pill', 'var'));
        list.append(row);
      }
      if (!list.children.length) vaultSec.append(el('p', 'nv-muted', 'No environments, secrets, or variables defined.'));
      else vaultSec.append(list);
      body.append(vaultSec);
    }
  }

  function renderPrView(body: HTMLElement, prView: Extract<NeutrinoViewState, { kind: 'pr' }>): void {
    const { repo, number } = prView;
    const p = prData;
    body.append(
      renderTopbar({
        crumbs: [
          {
            label: 'Neutrino',
            muted: true,
            onclick: () => {
              resetSub();
              view = { kind: 'home', tab: 'overview' };
              void loadCurrent();
            },
          },
          {
            label: repo,
            muted: true,
            onclick: () => {
              resetSub();
              view = { kind: 'repo', repo, tab: 'overview' };
              void loadCurrent();
            },
          },
          { label: `PR #${number}` },
        ],
      }),
    );

    const b = renderNoticeBanner();
    if (b) body.append(b);

    if (!p) {
      body.append(el('p', 'nv-dim', loading ? `Loading ${repo}#${number}…` : `Couldn’t load ${repo}#${number}.`));
      return;
    }

    const detailHead = el('div', 'nv-detail-header');
    const titleWrap = el('div', 'nv-detail-title-wrap');
    const h1 = el('h1', 'nv-detail-h1');
    h1.append(el('span', '', p.title), stateChip(p.state, p.state));
    const meta = el('div', 'nv-detail-meta');
    meta.append(el('span', 'nv-pill nv-mono', `${p.source} → ${p.target}`));
    if (p.mergeability) {
      meta.append(
        stateChip(
          p.mergeability.clean ? 'success' : 'failure',
          p.mergeability.clean ? 'merges cleanly' : `conflicts: ${(p.mergeability.conflicts || []).join(', ')}`,
        ),
      );
      if (p.mergeability.behind) meta.append(el('span', '', `${p.mergeability.behind} behind ${p.target}`));
    }
    titleWrap.append(h1, meta);

    const acts = el('div', 'nv-actions');
    if (p.state === 'open' && api?.neutrinoPrMerge) {
      const strat = el('select', 'nv-select');
      for (const s of ['merge', 'squash', 'rebase', 'fast_forward']) {
        const opt = el('option', '', s);
        opt.value = s;
        strat.append(opt);
      }
      const mergeBtn = el('button', 'nv-btn is-primary', 'Merge PR');
      mergeBtn.type = 'button';
      mergeBtn.onclick = async () => {
        if (!confirm(`Merge ${p.repo}#${p.number} (${p.source} → ${p.target}) via ${strat.value}?`)) return;
        mergeBtn.disabled = true;
        const res = await guard(() => api.neutrinoPrMerge!({ repo: p.repo, number: p.number, strategy: strat.value }));
        mergeBtn.disabled = false;
        if (res) {
          notice = `Merged PR #${p.number} (${String(res.sha || '').slice(0, 7) || strat.value}).`;
          noticeTone = 'done';
          void loadCurrent({ force: true });
        }
      };
      acts.append(strat, mergeBtn);
      if (api.neutrinoPrUpdate) {
        const closeBtn = el('button', 'nv-btn', 'Close PR');
        closeBtn.type = 'button';
        closeBtn.onclick = async () => {
          if (!confirm(`Close ${p.repo}#${p.number} without merging?`)) return;
          const res = await guard(() => api.neutrinoPrUpdate!({ repo: p.repo, number: p.number, state: 'closed' }));
          if (res) {
            notice = `Closed PR #${p.number}.`;
            noticeTone = 'done';
            void loadCurrent({ force: true });
          }
        };
        acts.append(closeBtn);
      }
    } else if (p.state === 'closed' && api?.neutrinoPrUpdate) {
      const reopenBtn = el('button', 'nv-btn', 'Reopen PR');
      reopenBtn.type = 'button';
      reopenBtn.onclick = async () => {
        const res = await guard(() => api.neutrinoPrUpdate!({ repo: p.repo, number: p.number, state: 'open' }));
        if (res) {
          notice = `Reopened PR #${p.number}.`;
          noticeTone = 'done';
          void loadCurrent({ force: true });
        }
      };
      acts.append(reopenBtn);
    }

    if (onDraft) {
      const askBtn = el('button', 'nv-btn', 'Ask Fairy');
      askBtn.type = 'button';
      askBtn.onclick = () =>
        onDraft(`Inspect Neutrino PR ${p.repo}#${p.number} (“${p.title}”): review its diff and notes and suggest what should be changed or whether to merge.`);
      acts.append(askBtn);
    }
    detailHead.append(titleWrap, acts);
    body.append(detailHead);

    if (p.body) body.append(el('pre', 'nv-prose', p.body));

    if (p.checks?.length) {
      const chkSec = el('section', 'nv-sec');
      chkSec.append(el('h3', 'nv-sec-title', `Checks (${p.checks.length})`));
      const row = el('div', 'nv-actions');
      for (const c of p.checks) {
        const cb = el('button', 'nv-btn');
        cb.type = 'button';
        cb.append(stateChip(c.state, c.state), el('span', '', c.name || c.workflow));
        cb.onclick = () => {
          resetSub({ keepNotice: true });
          view = { kind: 'run', repo: p.repo, id: c.id };
          void loadCurrent();
        };
        row.append(cb);
      }
      chkSec.append(row);
      body.append(chkSec);
    }

    if (p.files?.length) {
      const fSec = el('section', 'nv-sec');
      const fHead = el('div', 'nv-sec-head');
      fHead.append(el('h3', 'nv-sec-title', `Changed files (${p.files.length})`));
      if (api?.neutrinoPrDiff) {
        const fullBtn = el('button', `nv-btn${showFullPrDiff ? ' is-active' : ''}`, showFullPrDiff ? 'Hide full diff' : 'View full diff');
        fullBtn.type = 'button';
        fullBtn.onclick = async () => {
          showFullPrDiff = !showFullPrDiff;
          if (showFullPrDiff && !prFullDiff) {
            prFullDiff = await guard(() => api.neutrinoPrDiff!(p.repo, p.number, ''));
          }
          render();
        };
        fHead.append(fullBtn);
      }
      fSec.append(fHead);

      if (showFullPrDiff && prFullDiff) {
        const dWrap = el('div', 'nv-diff-wrap');
        dWrap.append(prFullDiff.text ? renderDiff(prFullDiff.text) : el('p', 'nv-muted', 'No textual changes in this pull request.'));
        fSec.append(dWrap);
      }

      const filesList = el('div', 'nv-files');
      for (const f of p.files) {
        const dText = expandedPrFiles.get(f.path);
        const fBtn = el('button', 'nv-file-btn');
        fBtn.type = 'button';
        fBtn.setAttribute('aria-expanded', String(dText != null));
        fBtn.append(
          el('span', 'nv-file-path', f.path),
          el('span', 'nv-add', f.binary ? 'binary' : `+${f.additions ?? 0}`),
          el('span', 'nv-del', f.binary ? '' : `−${f.deletions ?? 0}`),
        );
        fBtn.onclick = async () => {
          if (expandedPrFiles.has(f.path)) {
            expandedPrFiles.delete(f.path);
            render();
            return;
          }
          const res = api?.neutrinoPrDiff ? await guard(() => api.neutrinoPrDiff!(p.repo, p.number, f.path)) : null;
          expandedPrFiles.set(f.path, res?.text || '');
          render();
        };
        filesList.append(fBtn);
        if (dText != null) {
          const dWrap = el('div', 'nv-diff-wrap');
          dWrap.append(String(dText).trim() ? renderDiff(dText, f.path) : el('p', 'nv-muted', 'No textual diff for this file.'));
          filesList.append(dWrap);
        }
      }
      fSec.append(filesList);
      body.append(fSec);
    }

    const notesSec = el('section', 'nv-sec');
    notesSec.append(el('h3', 'nv-sec-title', `Review notes (${p.notes?.length || 0})`));
    if (p.notes?.length) {
      const list = el('div', 'nv-rows');
      for (const n of p.notes) {
        const row = el('div', 'nv-row');
        const main = el('div', 'nv-row-main');
        const title = el('div', 'nv-row-title');
        title.append(el('span', 'nv-pill nv-mono', `${n.path}:${n.currentLine ?? n.line}`), stateChip(n.resolved ? 'success' : 'open', n.resolved ? 'resolved' : 'open'));
        main.append(title, el('div', 'nv-row-sub', n.text));
        row.append(main);
        if (api?.neutrinoPrResolveNote) {
          const rBtn = el('button', 'nv-btn', n.resolved ? 'Reopen' : 'Resolve');
          rBtn.type = 'button';
          rBtn.onclick = async () => {
            const res = await guard(() => api.neutrinoPrResolveNote!({ repo: p.repo, number: p.number, note: n.id, resolved: !n.resolved }));
            if (res) void loadCurrent({ force: true });
          };
          row.append(rBtn);
        }
        list.append(row);
      }
      notesSec.append(list);
    } else {
      notesSec.append(el('p', 'nv-muted', 'No review notes yet.'));
    }

    if (p.files?.length && api?.neutrinoPrNote) {
      const form = el('div', 'nv-inline-form');
      const fileSel = el('select', 'nv-select');
      for (const f of p.files) {
        const opt = el('option', '', f.path);
        opt.value = f.path;
        fileSel.append(opt);
      }
      const lineIn = el('input', 'nv-input is-num');
      lineIn.type = 'number';
      lineIn.min = '1';
      lineIn.value = '1';
      lineIn.placeholder = 'Line';
      const textIn = el('input', 'nv-input');
      textIn.placeholder = 'Write a review note on this line…';
      const post = el('button', 'nv-btn is-primary', 'Add note');
      post.type = 'button';
      post.onclick = async () => {
        const txt = textIn.value.trim();
        const ln = Number(lineIn.value);
        if (!txt || !ln) return;
        const res = await guard(() => api.neutrinoPrNote!({ repo: p.repo, number: p.number, path: fileSel.value, side: 'new', line: ln, text: txt }));
        if (res) {
          textIn.value = '';
          notice = 'Review note added.';
          noticeTone = 'done';
          void loadCurrent({ force: true });
        }
      };
      form.append(fileSel, lineIn, textIn, post);
      notesSec.append(form);
    }
    body.append(notesSec);
  }

  function renderRunView(body: HTMLElement, runView: Extract<NeutrinoViewState, { kind: 'run' }>): void {
    const { repo, id } = runView;
    const d = runData;
    body.append(
      renderTopbar({
        crumbs: [
          {
            label: 'Neutrino',
            muted: true,
            onclick: () => {
              resetSub();
              view = { kind: 'home', tab: 'overview' };
              void loadCurrent();
            },
          },
          {
            label: repo,
            muted: true,
            onclick: () => {
              resetSub();
              view = { kind: 'repo', repo, tab: 'ci' };
              void loadCurrent();
            },
          },
          { label: `Run #${d?.run?.number || id}` },
        ],
      }),
    );

    const b = renderNoticeBanner();
    if (b) body.append(b);

    if (!d?.run) {
      body.append(el('p', 'nv-dim', loading ? `Loading run #${id}…` : `Couldn’t load CI run #${id}.`));
      return;
    }

    const { run, jobs, warnings } = d;
    const detailHead = el('div', 'nv-detail-header');
    const titleWrap = el('div', 'nv-detail-title-wrap');
    const h1 = el('h1', 'nv-detail-h1');
    h1.append(el('span', '', `${run.name || run.workflow} #${run.number}`), stateChip(run.state, run.state));
    const meta = el('div', 'nv-detail-meta');
    meta.append(
      el('span', '', run.event || 'workflow'),
      el('span', 'nv-pill nv-mono', run.branch || '—'),
      el('span', 'nv-pill nv-mono', String(run.sha || '').slice(0, 7)),
    );
    if (run.pull) {
      const pullNumber = run.pull;
      const prLink = el('button', 'nv-btn', `PR #${pullNumber}`);
      prLink.type = 'button';
      prLink.onclick = () => {
        resetSub();
        view = { kind: 'pr', repo, number: pullNumber };
        void loadCurrent();
      };
      meta.append(prLink);
    }
    if (run.error) meta.append(stateChip('failure', run.error));
    titleWrap.append(h1, meta);

    const acts = el('div', 'nv-actions');
    if (['running', 'queued', 'waiting'].includes(run.state) && api?.neutrinoRunCancel) {
      const cancelBtn = el('button', 'nv-btn is-danger', 'Cancel run');
      cancelBtn.type = 'button';
      cancelBtn.onclick = async () => {
        if (!confirm(`Cancel run #${run.number}?`)) return;
        const res = await guard(() => api.neutrinoRunCancel!({ repo, id: run.id }));
        if (res) {
          notice = 'Cancellation requested.';
          noticeTone = 'done';
          void loadCurrent({ force: true });
        }
      };
      acts.append(cancelBtn);
    } else if (api?.neutrinoRunRerun) {
      const rerunBtn = el('button', 'nv-btn is-primary', 'Rerun workflow');
      rerunBtn.type = 'button';
      rerunBtn.onclick = async () => {
        if (!confirm(`Rerun ${run.name || run.workflow} #${run.number}?`)) return;
        const res = await guard(() => api.neutrinoRunRerun!({ repo, id: run.id }));
        if (res) {
          resetSub();
          notice = `Started rerun #${res.number}.`;
          noticeTone = 'done';
          view = { kind: 'run', repo, id: res.id };
          void loadCurrent({ force: true });
        }
      };
      acts.append(rerunBtn);
    }
    if (onDraft) {
      const dbgBtn = el('button', 'nv-btn', 'Ask Fairy to debug');
      dbgBtn.type = 'button';
      dbgBtn.onclick = () =>
        onDraft(`Read the Neutrino CI log for ${repo} run id ${run.id} (#${run.number} ${run.name || run.workflow}) and explain what failed and how to fix it.`);
      acts.append(dbgBtn);
    }
    detailHead.append(titleWrap, acts);
    body.append(detailHead);

    if (warnings?.length) body.append(el('p', 'nv-dim', `Warnings: ${warnings.join(' · ')}`));

    const split = el('div', 'nv-run-split');
    const jobsCol = el('div', 'nv-jobs-col');
    jobsCol.append(el('h3', 'nv-sec-title', `Jobs (${jobs?.length || 0})`));
    if (jobs?.length) {
      for (const j of jobs) {
        const row = el('div', `nv-row is-clickable${selectedJob === j.id ? ' is-selected' : ''}`);
        row.tabIndex = 0;
        row.onclick = async () => {
          selectedJob = j.id;
          ciLog = api?.neutrinoCiLog ? await guard(() => api.neutrinoCiLog!(repo, run.id, j.id)) : null;
          render();
        };
        const main = el('div', 'nv-row-main');
        const title = el('div', 'nv-row-title');
        title.append(el('span', 'nv-row-title-text', j.name), stateChip(j.state, j.state));
        const sub = el('div', 'nv-row-sub');
        sub.append(el('span', '', j.executor || 'graviton'));
        if (j.environment) sub.append(el('span', 'nv-pill', j.environment));
        main.append(title, sub);
        if (j.steps?.length) {
          const stepsRow = el('div', 'nv-job-steps');
          for (const st of j.steps) {
            stepsRow.append(stateChip(st.state, `${st.name}${st.exit_code != null ? ` (${st.exit_code})` : ''}`));
          }
          main.append(stepsRow);
        }
        row.append(main);
        if (j.state === 'waiting' && api?.neutrinoJobApprove) {
          const appBtn = el('button', 'nv-btn is-primary', 'Approve');
          appBtn.type = 'button';
          appBtn.onclick = async e => {
            e.stopPropagation();
            if (!confirm(`Approve deploy job “${j.name}”${j.environment ? ` for ${j.environment}` : ''}?`)) return;
            const res = await guard(() => api.neutrinoJobApprove!({ repo, job: j.id, approve: true }));
            if (res) {
              notice = `Approved ${j.name}.`;
              noticeTone = 'done';
              void loadCurrent({ force: true });
            }
          };
          row.append(appBtn);
        }
        jobsCol.append(row);
      }
    } else {
      jobsCol.append(el('p', 'nv-muted', 'No jobs recorded for this run yet.'));
    }

    const logCol = el('div', 'nv-log-panel');
    const logHead = el('div', 'nv-sec-head');
    const activeJobName = ciLog?.jobName || jobs?.find(j => j.id === selectedJob)?.name || '';
    logHead.append(el('h3', 'nv-sec-title', `Console output${activeJobName ? ` · ${activeJobName}` : ''}`));
    if (ciLog?.log) {
      const logText = ciLog.log;
      const copyBtn = el('button', 'nv-btn', 'Copy log');
      copyBtn.type = 'button';
      copyBtn.onclick = () => {
        void navigator.clipboard?.writeText?.(logText).then(() => {
          copyBtn.textContent = 'Copied';
          setTimeout(() => {
            if (copyBtn.isConnected) copyBtn.textContent = 'Copy log';
          }, 1400);
        });
      };
      logHead.append(copyBtn);
    }
    logCol.append(logHead);
    logCol.append(el('pre', 'nv-log-box', ciLog?.log || ciLog?.note || '(Select a job to read its log.)'));

    split.append(jobsCol, logCol);
    body.append(split);
  }

  function render(): void {
    if (root.hidden) return;
    const body = el('div', 'nv-body');
    if (view.kind === 'pr') renderPrView(body, view);
    else if (view.kind === 'run') renderRunView(body, view);
    else if (view.kind === 'repo') renderRepoView(body, view);
    else renderHomeView(body, view);
    root.replaceChildren(body);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || root.hidden) return;
    if (document.querySelector('dialog[open]')) return;
    if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    hide();
  }

  function show(): void {
    if (!root.hidden) return;
    root.hidden = false;
    document.documentElement.classList.add('neutrino-open');
    document.addEventListener('keydown', onKeyDown);
    render();
    onShow();
  }

  function hide(): void {
    if (root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('neutrino-open');
    document.removeEventListener('keydown', onKeyDown);
    onHide();
  }

  function open(target: NeutrinoOpenTarget = {}): void {
    const kind = target?.kind || 'home';
    resetSub();
    if (kind === 'pr' && target.repo && target.number) {
      view = { kind: 'pr', repo: target.repo, number: target.number };
    } else if (kind === 'run' && target.repo && target.id) {
      view = { kind: 'run', repo: target.repo, id: target.id };
    } else if (kind === 'repo' && target.repo) {
      view = { kind: 'repo', repo: target.repo, tab: (target.tab as RepoTab) || 'overview' };
    } else {
      view = { kind: 'home', tab: (target.tab as HomeTab) || 'overview' };
    }
    show();
    void loadCurrent({ silentRepoFallback: kind === 'repo' });
  }

  function toggle(): void {
    if (isOpen()) hide();
    else open({ kind: 'home' });
  }

  return { show, hide, toggle, open, isOpen };
}
