// Watchers (docs/watchers-plan.md): routines that start on an event instead of a time. A watcher looks for its event
// with no model call (GitHub through gh, later Nexus, files and arXiv), and when the event happens it tells you, as an
// attended round does. Kept in Fairy's own automation.json beside routines and hooks, never in a project, so an agent
// editing a project can't add one. The first look only learns what is there already: a watcher fires on what is new.
//
// Stage 1: the engine, Tell me, and "a check fails" on a repository's branch or on a pull request.
// Stage 2: "a review or comment arrives" on your pull requests or one of them, and "a Nexus job ends".
// Stage 3: "a file changes" (a file or folder in your home folder) and "a new paper matches" (an arXiv search).
// Stage 4: Summarise (one turn on the scout model, its answer in a new chat) and Work on it (a work session in a folder,
// asked for on a card unless the watcher runs on its own). Each find carries details(): what a model needs, fetched only then.
// Stage 5: a chat or work session offers one with watch_add (desktop/watch-tools.mjs), added only on the user's Add watcher.
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';

export type WatchEvent = 'check-failed' | 'review' | 'nexus-job' | 'file' | 'paper';
export type WatchAction = 'tell' | 'summarise' | 'work';

export interface RecentPaper {
  id: string;
  title: string;
  url: string;
  at: string;
}

export interface WatcherState {
  looked: string;
  fired: string;
  started: boolean;
  seen: string[];
  fires: string[];
  error: string;
  paused: string;
  recentPapers?: RecentPaper[];
}

export interface Watcher {
  id: string;
  event: WatchEvent;
  repo: string;
  branch: string;
  pr: number | null;
  job: string;
  path: string;
  query: string;
  every: number;
  action: WatchAction;
  prompt: string;
  folder: string;
  runOnOwn: boolean;
  goal?: string;
  enabled: boolean;
  title: string;
  state: WatcherState;
}

export interface WatchFinding {
  key: string;
  title: string;
  body: string;
  url: string;
  details?: () => Promise<string>;
  path?: string;
  paperId?: string;
  name?: string;
  ended?: {
    job: string;
    exit: number | null;
    outputs: string;
    printout: string;
  };
}

export interface WatchNeutrinoClient {
  pr(params: { repo: string; number: number }): Promise<{
    repo: string;
    number: number;
    title?: string;
    source?: string;
    target?: string;
    versions?: number;
    openNotes?: number;
    state?: string;
    checks?: Array<{ id: string | number; state?: string; name?: string } | null | undefined>;
    notes?: Array<{ resolved?: boolean; path?: string; currentLine?: number; line?: number; text?: string }>;
  }>;
  runs(params: { repo: string; branch: string; limit: number }): Promise<{
    runs?: Array<{ id: string | number; state?: string; branch?: string; name?: string } | null | undefined>;
  }>;
  prs(params: { repo: string; state: string; limit: number }): Promise<{
    prs?: Array<{
      repo: string;
      number: number;
      title?: string;
      source?: string;
      target?: string;
      versions?: number;
      openNotes?: number;
      state?: string;
      notes?: Array<{ resolved?: boolean; path?: string; currentLine?: number; line?: number; text?: string }>;
    }>;
  }>;
  ciLog(params: { repo: string; run: string | number }): Promise<{ log: string }>;
}

export interface WatchGithubClient {
  neutrino?: WatchNeutrinoClient | null;
  checks(params: { repo: string; number: number }): Promise<{
    checks?: Array<{ bucket?: string; name?: string; run?: string | number; link?: string } | null | undefined>;
  }>;
  checks(params: { repo: string; branch: string }): Promise<{
    runs?: Array<{ status?: string; conclusion?: string; headBranch?: string; databaseId: string | number; workflowName?: string; name?: string; url?: string } | null | undefined>;
  }>;
  ciLog(params: { repo: string; run: string | number }): Promise<{ log: string }>;
  inbox(params: { limit: number }): Promise<{
    mine?: Array<GitHubInboxPr | null | undefined>;
    review?: Array<GitHubInboxPr | null | undefined>;
    involved?: Array<GitHubInboxPr | null | undefined>;
  }>;
  pr(params: { repo: string; number: number }): Promise<{
    number: number;
    title?: string;
    head?: string;
    base?: string;
    reviews?: Array<{ at?: string; author?: string; state?: string; body?: string }>;
    conversation?: Array<{ at?: string; author?: string; body?: string }>;
    reviewComments?: Array<{ at?: string; path?: string; line?: number; author?: string; body?: string }>;
  }>;
}

interface GitHubInboxPr {
  repo: string;
  number: number;
  title?: string;
  review?: string;
  comments?: number;
  url?: string;
}

export interface WatchNexusClient {
  logs(params: { job: string; seconds: number }): Promise<{
    ended?: boolean;
    exitCode?: number;
    log?: string;
  }>;
  outputs(params: { job: string; root: string }): Promise<{
    folder?: string;
    files?: Array<{ path: string }>;
    error?: string;
  }>;
}

export interface WatchSnapshot {
  files: Map<string, string>;
  newest: number;
  missing: boolean;
  truncated: boolean;
}

export interface SnapshotChanges {
  added: string[];
  changed: string[];
  gone: string[];
}

export interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  url: string;
}

export interface WatchNotice {
  title: string;
  body: string;
  url: string;
  path?: string;
  watcher?: string;
}

export interface WatcherStore {
  watchers: Watcher[];
  saveWatchers(): Promise<unknown>;
  state(): unknown;
}

export interface WatcherActionPayload {
  watcher: Omit<Watcher, 'state'> & { state: undefined };
  found: WatchFinding;
}

export interface WatcherEngineOptions {
  store: WatcherStore;
  look: Record<WatchEvent, (w: Watcher) => Promise<WatchFinding[] | null>>;
  tell?: (notice: WatchNotice) => void;
  act?: ((payload: WatcherActionPayload) => Promise<unknown> | unknown) | null;
  wake?: ((payload: WatcherActionPayload) => Promise<unknown> | unknown) | null;
  log?: (entry: Record<string, unknown>) => void;
  now?: () => Date;
  tick?: number;
}

export interface WatcherEngine {
  step(): Promise<void>;
  lookOnce(w: Watcher): Promise<{ looked: boolean; fired?: number }>;
  lookNow(id: string): Promise<unknown>;
  start(): void;
  stop(): void;
}

const text = (value: unknown, limit: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const errText = (error: unknown): string => (error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error ?? '')));
export const WATCH_EVENTS: readonly WatchEvent[] = Object.freeze(['check-failed', 'review', 'nexus-job', 'file', 'paper'] as const);
export const ACTIONS: readonly WatchAction[] = Object.freeze(['tell', 'summarise', 'work'] as const);
export const DETAIL_LIMIT = 12000;
const clipText = (value: unknown, limit = DETAIL_LIMIT): string => { const t = String(value ?? ''); return t.length > limit ? `${t.slice(0, limit)}\n… (cut short)` : t; };
// How often each event is looked for, in minutes, unless a watcher says otherwise; and the bounds it may say.
export const EVERY: Readonly<Record<WatchEvent, number>> = Object.freeze({ 'check-failed': 5, review: 5, 'nexus-job': 2, file: 2, paper: 360 });
// How often each may look, in minutes: arXiv asks callers not to hurry, and a day is the longest anything waits.
export const BOUNDS: Readonly<Record<WatchEvent, readonly [number, number]>> = Object.freeze({ 'check-failed': [2, 60], review: [2, 60], 'nexus-job': [2, 60], file: [1, 60], paper: [60, 1440] });
// Events whose new finds are told together, in one notice: a search can find several papers at once.
export const GROUPED: readonly WatchEvent[] = Object.freeze(['paper'] as const);
// Events that fire on their first look too: a job you just sent may already have ended. The rest only learn what is there.
export const FIRST_LOOK_FIRES: readonly WatchEvent[] = Object.freeze(['nexus-job'] as const);
// Events that are over once they fire: the watcher stops looking.
export const ONCE: readonly WatchEvent[] = Object.freeze(['nexus-job'] as const);
const JOB = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
export const MAX_FIRES_AN_HOUR = 6, SEEN = 200, MAX_WATCHERS = 50;
// owner/name as GitHub allows them, OR neutrino:<id> for a Neutrino-hosted repo.
const REPO = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.+$)[A-Za-z0-9_.-]{1,100}|neutrino:[A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;
const neutrinoTarget = (repo: string): string => (String(repo || '').startsWith('neutrino:') ? String(repo).slice(9) : '');
// A branch name, never one that looks like a flag or climbs out with ..
const BRANCH = /^(?!.*\.\.)(?![-/.])[A-Za-z0-9_./-]{1,200}$/;
const STAMP = (value: unknown): string => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value.slice(0, 40) : '');
// GitHub's run conclusions that mean it failed.
export const FAILED: readonly string[] = Object.freeze(['failure', 'timed_out', 'startup_failure']);

// What a watcher looks at, for its title.
export function targetWords(w: Pick<Watcher, 'repo' | 'pr' | 'branch'>): string {
  return `${w.repo}${w.pr ? ` #${w.pr}` : w.branch ? ` on ${w.branch}` : ''}`;
}
const defaultTitle = (w: Watcher): string => (w.event === 'file' ? `Changes in ${w.path.split('/').filter(Boolean).at(-1) || w.path}` : w.event === 'paper' ? `New papers on “${w.query}”` : w.event === 'nexus-job' ? `Nexus job ${w.job}` : w.event === 'review' ? (w.pr ? `Reviews on ${w.repo} #${w.pr}` : `Reviews on your pull requests${w.repo ? ` in ${w.repo}` : ''}`) : `Checks on ${targetWords(w)}`);

// A watcher as it may be kept: what it watches, how often, what it does, and its own state. null when it isn't one.
export function cleanWatcher(value: unknown): Watcher | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.event !== 'string' || !(WATCH_EVENTS as readonly string[]).includes(raw.event)) return null;
  const event = raw.event as WatchEvent;
  const repo = String(raw.repo ?? '').trim();
  // A check needs its repository; a review may watch your pull requests anywhere; the rest have none.
  if (event === 'check-failed' ? !REPO.test(repo) : event === 'review' ? repo && !REPO.test(repo) : repo) return null;
  // A file watcher's path: absolute, as written (no . or .. parts); where it may be is checkWatchPath's to say.
  const path = raw.path == null || raw.path === '' ? '' : String(raw.path).replace(/(.)\/+$/, '$1');
  if (event === 'file' ? !(isAbsolute(path) && path.length <= 1000 && normalize(path) === path && !path.includes('\0')) : path) return null;
  // A paper search: words, as you'd type them into arXiv.
  const query = text(raw.query, 200);
  if (event === 'paper' ? !/[\p{L}\p{N}]/u.test(query) : raw.query != null && raw.query !== '') return null;
  const branch = raw.branch == null || raw.branch === '' ? '' : String(raw.branch).trim();
  if (branch && (event !== 'check-failed' || !BRANCH.test(branch))) return null;
  const pr = raw.pr == null || raw.pr === '' ? null : Number(raw.pr);
  if (pr !== null && (!['check-failed', 'review'].includes(event) || !(Number.isInteger(pr) && pr > 0 && pr < 1e7))) return null;
  if (pr && branch) return null;
  if (event === 'review' && pr && !repo) return null;
  const job = raw.job == null || raw.job === '' ? '' : String(raw.job).trim();
  if (event === 'nexus-job' ? !JOB.test(job) : job) return null;
  const every = raw.every == null || raw.every === '' ? EVERY[event] : Number(raw.every);
  if (!Number.isInteger(every) || every < BOUNDS[event][0] || every > BOUNDS[event][1]) return null;
  const rawAction = raw.action == null || raw.action === '' ? 'tell' : raw.action;
  if (typeof rawAction !== 'string' || !(ACTIONS as readonly string[]).includes(rawAction)) return null;
  const action = rawAction as WatchAction;
  // What a model is asked, for Summarise and Work on it; where work happens, for Work on it (checked by the store).
  const prompt = action === 'tell' ? '' : String(raw.prompt ?? '').trim().slice(0, 2000);
  const folder = action === 'work' ? String(raw.folder ?? '').replace(/(.)\/+$/, '$1') : '';
  if (action === 'work' && !(isAbsolute(folder) && normalize(folder) === folder && folder.length <= 1000 && !folder.includes('\0'))) return null;
  const runOnOwn = action === 'work' && raw.runOnOwn === true;
  const state = (raw.state && typeof raw.state === 'object' ? raw.state : {}) as Record<string, unknown>;
  // goal: a goal this watcher wakes when it fires (docs/goals-board-plan.md, stage 3), instead of its action.
  const goal = typeof raw.goal === 'string' && /^G\d{1,5}$/.test(raw.goal) ? raw.goal : '';
  const recentPapers: RecentPaper[] = event === 'paper' && Array.isArray(state.recentPapers)
    ? (state.recentPapers as unknown[])
      .filter((p): p is { id: string; title?: unknown; url?: unknown; at?: unknown } => Boolean(p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string' && /^[\w./-]{4,40}$/.test((p as { id: string }).id)))
      .slice(0, 10)
      .map(p => ({ id: p.id, title: text(p.title, 160) || p.id, url: typeof p.url === 'string' && /^https:\/\/arxiv\.org\/abs\/[^\s]+$/.test(p.url) ? p.url.slice(0, 200) : `https://arxiv.org/abs/${p.id}`, at: STAMP(p.at) }))
    : [];
  const watcher: Watcher = { id: String(raw.id).slice(0, 64), event, repo, branch, pr, job, path, query, every, action, prompt, folder, runOnOwn, ...(goal ? { goal } : {}), enabled: raw.enabled !== false, title: '',
    state: { looked: STAMP(state.looked), fired: STAMP(state.fired), started: state.started === true, seen: (Array.isArray(state.seen) ? state.seen : []).filter((k): k is string => typeof k === 'string').map(k => k.slice(0, 200)).slice(0, SEEN),
      fires: (Array.isArray(state.fires) ? state.fires : []).map(STAMP).filter(Boolean).slice(-MAX_FIRES_AN_HOUR * 2), error: text(state.error, 300), paused: text(state.paused, 200),
      ...(recentPapers.length ? { recentPapers } : {}) } };
  watcher.title = text(raw.title, 80) || defaultTitle(watcher);
  return watcher;
}

// "A check fails": what is failing now, each with a key that stays the same for the same failure.
export async function failingChecks(w: Watcher, github: WatchGithubClient, neutrino: WatchNeutrinoClient | null = github?.neutrino || null): Promise<WatchFinding[]> {
  const nRepo = neutrinoTarget(w.repo);
  if (nRepo) {
    if (!neutrino) throw new Error('Neutrino isn’t set up on this Mac.');
    if (w.pr) {
      const p = await neutrino.pr({ repo: nRepo, number: w.pr });
      return (p.checks || []).filter((c): c is NonNullable<typeof c> => Boolean(c && c.state === 'failure')).map(c => ({
        key: `neutrino:run:${c.id}`.slice(0, 200),
        title: 'A Neutrino check failed',
        details: async () => clipText((await neutrino.ciLog({ repo: nRepo, run: c.id })).log),
        body: `${text(c.name, 120) || 'A workflow'} failed on #${w.pr} in ${nRepo}.`,
        url: '',
      }));
    }
    const { runs = [] } = await neutrino.runs({ repo: nRepo, branch: w.branch || '', limit: 25 });
    return runs.filter((r): r is NonNullable<typeof r> => Boolean(r && r.state === 'failure' && (!w.branch || r.branch === w.branch))).map(r => ({
      key: `neutrino:run:${r.id}`.slice(0, 200),
      title: 'A Neutrino check failed',
      details: async () => clipText((await neutrino.ciLog({ repo: nRepo, run: r.id })).log),
      body: `${text(r.name, 120) || 'A workflow'} failed${r.branch ? ` on ${text(r.branch, 120)}` : ''} in ${nRepo}.`,
      url: '',
    }));
  }
  if (w.pr) {
    const { checks = [] } = await github.checks({ repo: w.repo, number: w.pr });
    return checks.filter((c): c is NonNullable<typeof c> => Boolean(c && c.bucket === 'fail')).map(c => ({ key: `check:${c.name}:${c.run || c.link || ''}`.slice(0, 200), title: 'A check failed',
      details: async () => (c.run ? clipText((await github.ciLog({ repo: w.repo, run: c.run })).log) : ''),
      body: `${text(c.name, 120) || 'A check'} failed on #${w.pr} in ${w.repo}.`, url: typeof c.link === 'string' && /^https:\/\//.test(c.link) ? c.link : '' }));
  }
  const { runs = [] } = await github.checks({ repo: w.repo, branch: w.branch });
  return runs.filter((r): r is NonNullable<typeof r> => Boolean(r && r.status === 'completed' && typeof r.conclusion === 'string' && FAILED.includes(r.conclusion) && (!w.branch || r.headBranch === w.branch))).map(r => ({ key: `run:${r.databaseId}`.slice(0, 200), title: 'A check failed',
    details: async () => clipText((await github.ciLog({ repo: w.repo, run: r.databaseId })).log),
    body: `${text(r.workflowName || r.name, 120) || 'A workflow'} failed${r.headBranch ? ` on ${text(r.headBranch, 120)}` : ''} in ${w.repo}.`, url: typeof r.url === 'string' && /^https:\/\//.test(r.url) ? r.url : '' }));
}

// "A review or comment arrives": each pull request with its review state and how many comments and review threads it
// has, keyed by all three, so a key not seen before is a change. One pull request, or your open ones (in one
// repository, or any), from your GitHub or Neutrino inbox.
export async function reviewChanges(w: Watcher, github: WatchGithubClient, neutrino: WatchNeutrinoClient | null = github?.neutrino || null): Promise<WatchFinding[]> {
  const nRepo = neutrinoTarget(w.repo);
  if (nRepo) {
    if (!neutrino) throw new Error('Neutrino isn’t set up on this Mac.');
    const list = w.pr ? [await neutrino.pr({ repo: nRepo, number: w.pr })] : (await neutrino.prs({ repo: nRepo, state: 'open', limit: 30 })).prs;
    return (list || []).map(pr => ({
      key: `neutrino:review:${pr.repo}#${pr.number}:${pr.versions || 1}:${pr.openNotes || 0}:${pr.state}`.slice(0, 200),
      title: 'A Neutrino PR updated',
      details: async () => {
        const p = pr.notes ? pr : await neutrino.pr({ repo: pr.repo, number: pr.number });
        const lines = (p.notes || []).slice(-30).map(n => `${n.resolved ? '[resolved] ' : ''}${n.path}:${n.currentLine ?? n.line}: ${n.text}`);
        return clipText([`#${p.number} ${p.title} (${p.source} → ${p.target})`, ...lines].join('\n\n'));
      },
      body: `#${pr.number} ${text(pr.title, 100)} in ${pr.repo}: ${pr.openNotes || 0} open notes.`,
      url: '',
    }));
  }
  const inbox = await github.inbox({ limit: 50 });
  const all = w.pr ? [...(inbox.mine || []), ...(inbox.review || []), ...(inbox.involved || [])] : (inbox.mine || []);
  const seen = new Set<string>();
  return all.filter((pr): pr is GitHubInboxPr => Boolean(pr && (!w.repo || String(pr.repo).toLowerCase() === w.repo.toLowerCase()) && (!w.pr || pr.number === w.pr)))
    .filter(pr => { const id = `${pr.repo}#${pr.number}`; if (seen.has(id)) return false; seen.add(id); return true; })
    .map(pr => {
      const review = text(pr.review, 40), comments = Number(pr.comments) || 0;
      return { key: `review:${pr.repo}#${pr.number}:${review || 'none'}:${comments}`.slice(0, 200), title: 'A review or comment arrived',
        details: async () => {
          const p = await github.pr({ repo: pr.repo, number: pr.number });
          const said = [...(p.reviews || []).map(r => ({ at: r.at, line: `Review by ${r.author} (${r.state}): ${r.body}` })), ...(p.conversation || []).map(c => ({ at: c.at, line: `Comment by ${c.author}: ${c.body}` })), ...(p.reviewComments || []).map(c => ({ at: c.at, line: `On ${c.path}${c.line ? `:${c.line}` : ''}, ${c.author}: ${c.body}` }))];
          return clipText([`#${p.number} ${p.title} (${p.head} into ${p.base})`, ...said.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-30).map(x => x.line)].join('\n\n'));
        },
        body: `#${pr.number} ${text(pr.title, 100)} in ${pr.repo}: ${review || 'no review yet'}, ${comments} ${comments === 1 ? 'comment' : 'comments'}.`,
        url: typeof pr.url === 'string' && /^https:\/\/github\.com\//.test(pr.url) ? pr.url : '' };
    });
}

// "A Nexus job ends": once it has, its outputs are fetched into folder (Fairy's watcher-outputs/<job>). nexus: Fairy's
// Nexus (desktop/nexus.mjs), on the request-only token; null where there's none.
export async function nexusJobEnded(w: Watcher, nexus: WatchNexusClient | null | undefined, folder: string): Promise<WatchFinding[]> {
  if (!nexus) throw new Error('Nexus isn’t set up on this Mac: Fairy needs the nexus command and its request-only token.');
  const seen = await nexus.logs({ job: w.job, seconds: 2 });
  if (!seen.ended) return [];
  let fetched: { folder?: string; files?: Array<{ path: string }>; error?: string } | null = null;
  try { fetched = await nexus.outputs({ job: w.job, root: folder }); } catch (error) { fetched = { error: text(errText(error), 200).replace(/[.\s]+$/, '') }; }
  const exit = typeof seen.exitCode === 'number' && Number.isInteger(seen.exitCode) ? seen.exitCode : null;
  const files = fetched?.files?.length ?? 0;
  const printed = String(seen.log || '');
  return [{ key: `ended:${w.job}`, title: exit === 0 ? 'A Nexus job finished' : 'A Nexus job failed',
    details: async () => clipText(`Exit code: ${exit ?? 'unknown'}\nOutput files: ${(fetched?.files || []).map(f => f.path).slice(0, 50).join(', ') || 'none'}\n\nThe end of its log:\n${printed.slice(-8000)}`),
    body: `Nexus job ${w.job} ended${exit === null ? '' : exit === 0 ? '' : ` with exit ${exit}`}${fetched?.error ? `; its outputs couldn’t be fetched: ${fetched.error}` : files ? `; ${files} ${files === 1 ? 'file' : 'files'} fetched` : '; it wrote no outputs'}.`,
    url: '', path: fetched?.folder && !fetched.error ? fetched.folder : '',
    // For the experiment tracker: the job, its exit, and where its outputs are (relative to folder).
    ended: { job: w.job, exit, outputs: fetched?.folder && !fetched.error ? fetched.folder : '', printout: printed.slice(-8000) } }];
}

// Where a file watcher may look: inside your home folder, not all of it, not Fairy's own data, and not a folder that
// holds your settings or keys (as a work folder's rules, desktop/work-sandbox.mjs). Returns the path, its links
// resolved where it exists.
// A path with its links resolved as far as it exists: the nearest parent that does, and the rest as written.
async function resolved(path: string): Promise<string> {
  let head = path;
  const rest: string[] = [];
  for (;;) {
    try { return join(await realpath(head), ...rest); } catch {}
    const parent = join(head, '..');
    if (parent === head) return path;
    rest.unshift(head.slice(parent.length).replace(/^\//, '')); head = parent;
  }
}
export async function checkWatchPath(path: string, { home = homedir(), dataDir = '' }: { home?: string; dataDir?: string } = {}): Promise<string> {
  const real = await resolved(path), own = await resolved(home);
  const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent + sep);
  const rel = relative(own, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Choose a file or folder inside your home folder, not all of it.');
  if (dataDir) { const data = await resolved(dataDir); if (inside(data, real) || inside(real, data)) throw new Error('Choose a file or folder outside Fairy’s own data.'); }
  const inICloudDrive = /^Library\/Mobile Documents\/com~apple~CloudDocs\/[^/]/.test(rel);
  if (!inICloudDrive && /^(?:\.ssh|\.gnupg|\.aws|\.gemini|\.claude|\.codex|\.config|\.proton|Library)(?:\/|$)/.test(rel)) throw new Error('Choose a file or folder that doesn’t hold your settings or keys.');
  return real;
}

// Folders a file watcher passes over: what tools write, not what you do.
const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.next', '.cache', 'target', '.DS_Store', '.Trash']);
export const MAX_FILES = 5000, MAX_DEPTH = 8, SETTLE_MS = 30_000, FILE_GAP_MS = 10 * 60_000;
// A snapshot of a file or folder: each file's path (relative), size and modified time, never its contents. Links aren't
// followed.
export interface SnapshotOptions {
  stat?: (path: string) => Promise<Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile' | 'size' | 'mtimeMs'>>;
  list?: (path: string) => Promise<string[]>;
}
export async function snapshot(path: string, { stat = lstat, list = readdir }: SnapshotOptions = {}): Promise<WatchSnapshot> {
  const files = new Map<string, string>();
  let newest = 0, truncated = false;
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let names: string[];
    try { names = (await list(dir)).sort(); } catch { return; }
    for (const name of names) {
      if (files.size >= MAX_FILES) { truncated = true; return; }
      if (SKIP.has(name)) continue;
      const full = join(dir, name), at = rel ? `${rel}/${name}` : name;
      let st: Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile' | 'size' | 'mtimeMs'>;
      try { st = await stat(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (depth < MAX_DEPTH) await walk(full, at, depth + 1); continue; }
      if (!st.isFile()) continue;
      files.set(at, `${st.size}:${Math.floor(st.mtimeMs)}`);
      newest = Math.max(newest, st.mtimeMs);
    }
  };
  let top: Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile' | 'size' | 'mtimeMs'>;
  try { top = await stat(path); } catch { return { files, newest, missing: true, truncated }; }
  if (top.isFile()) { files.set(path.split('/').at(-1) ?? '', `${top.size}:${Math.floor(top.mtimeMs)}`); newest = top.mtimeMs; }
  else if (top.isDirectory()) await walk(path, '', 0);
  return { files, newest, missing: false, truncated };
}
const digest = (files: Map<string, string>): string => createHash('sha256').update([...files].map(([name, mark]) => `${name}\0${mark}`).join('\n')).digest('hex').slice(0, 24);
// What changed between two snapshots: names added, changed and gone.
export function changes(before: Map<string, string>, after: Map<string, string>): SnapshotChanges {
  const added: string[] = [], changed: string[] = [], gone: string[] = [];
  for (const [name, mark] of after) { if (!before.has(name)) added.push(name); else if (before.get(name) !== mark) changed.push(name); }
  for (const name of before.keys()) if (!after.has(name)) gone.push(name);
  return { added, changed, gone };
}
// "A file changes": one key for how the file or folder is now. Waits while something is still being written (its
// newest file under 30 seconds old) and for 10 minutes after the last time it told you. last: the watcher's previous
// snapshot, kept in memory for naming what changed (after a restart it says only that something did).
export interface FileChangesOptions {
  snap?: (path: string) => Promise<WatchSnapshot>;
  now?: () => number;
  last?: Map<string, Map<string, string>>;
}
export function fileChanges({ snap = snapshot, now = () => Date.now(), last = new Map() }: FileChangesOptions = {}): (w: Watcher) => Promise<WatchFinding[] | null> {
  return async w => {
    const shot = await snap(w.path);
    if (shot.missing) return [{ key: 'file:missing', title: 'A watched file or folder is gone', body: `${w.path} isn’t there any more.`, url: '' }];
    if (now() - shot.newest < SETTLE_MS) return null;
    if (w.state.fired && now() - Date.parse(w.state.fired) < FILE_GAP_MS) return null;
    const before = last.get(w.id);
    last.set(w.id, shot.files);
    const key = `file:${digest(shot.files)}`;
    let body = `Something changed in ${w.path}.`;
    if (before) {
      const { added, changed, gone } = changes(before, shot.files), named = [...changed, ...added, ...gone];
      const parts = [added.length ? `${added.length} new` : '', changed.length ? `${changed.length} changed` : '', gone.length ? `${gone.length} gone` : ''].filter(Boolean);
      if (named.length) body = `${parts.join(', ')} in ${w.path}: ${named.slice(0, 4).join(', ')}${named.length > 4 ? ', …' : ''}.`;
    }
    return [{ key, title: 'Files changed', body, url: '', details: async () => body }];
  };
}

// "A new paper matches": an arXiv search, newest first, each paper keyed by its arXiv id (its version aside).
export const ARXIV = 'https://export.arxiv.org/api/query';
export function arxivQuery(query: string): string {
  const words = String(query).replace(/[^\p{L}\p{N}\s\-.]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 12);
  return `${ARXIV}?search_query=${words.map(word => `all:${encodeURIComponent(word)}`).join('+AND+')}&sortBy=submittedDate&sortOrder=descending&max_results=20`;
}
const xmlText = (value: unknown): string => String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
// The entries of arXiv's Atom reply: { id, title, url }.
export function arxivEntries(atom: string): ArxivEntry[] {
  return [...String(atom).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const abs = /<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+?)\s*<\/id>/.exec(entry)?.[1] ?? '';
    const id = abs.replace(/v\d+$/, '');
    return { id, title: text(xmlText(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1]), 160), summary: text(xmlText(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1]), 2000), url: /^[\w./-]{4,40}$/.test(id) ? `https://arxiv.org/abs/${id}` : '' };
  }).filter(entry => entry.url);
}
export function newPapers({ fetch: get = fetch }: { fetch?: typeof fetch } = {}): (w: Watcher) => Promise<WatchFinding[]> {
  return async w => {
    const reply = await get(arxivQuery(w.query), { headers: { 'User-Agent': 'Fairy (a personal research assistant)' }, signal: AbortSignal.timeout(30_000) });
    if (!reply.ok) throw new Error(`arXiv answered ${reply.status}.`);
    return arxivEntries(await reply.text()).map(paper => ({ key: `paper:${paper.id}`, paperId: paper.id, title: 'A new paper', body: `New on arXiv for “${w.query}”: ${paper.title} (${paper.id}).`, url: paper.url, name: paper.title,
      details: async () => `${paper.title} (arXiv ${paper.id}, ${paper.url})\n${paper.summary}` }));
  };
}

// The engine. store: the AutomationStore (watchers, saveWatcher); look: { [event]: watcher → what is there now };
// tell(notice): Fairy says it (notification, companion, iPhone); log(line): watchers.jsonl.
// act({ watcher, found }): Summarise or Work on it, main's to do (it reads found.details() itself); not awaited, so a
// long turn doesn't hold up the other watchers.
// wake({ watcher, found }): a watcher that names a goal wakes it instead (goals, stage 3).
export function watcherEngine({ store, look, tell = () => {}, act = null, wake = null, log = () => {}, now = () => new Date(), tick = 60_000 }: WatcherEngineOptions): WatcherEngine {
  let timer: ReturnType<typeof setInterval> | null = null;
  const busy = new Set<string>();
  const due = (w: Watcher): boolean => w.enabled && !busy.has(w.id) && (!w.state.looked || now().getTime() - new Date(w.state.looked).getTime() >= w.every * 60_000);
  async function fire(w: Watcher, found: WatchFinding): Promise<boolean> {
    const at = now(), hourAgo = at.getTime() - 60 * 60_000;
    w.state.fires = w.state.fires.filter(f => new Date(f).getTime() >= hourAgo);
    if (w.state.fires.length >= MAX_FIRES_AN_HOUR) {
      w.enabled = false; w.state.paused = `It fired ${MAX_FIRES_AN_HOUR} times in an hour, so it paused itself.`;
      tell({ title: 'A watcher paused itself', body: `${w.title}: ${w.state.paused} Turn it back on in Settings → Skills & automation.`, url: '' });
      log({ at: at.toISOString(), watcher: w.id, event: w.event, act: 'paused' });
      return false;
    }
    w.state.fires.push(at.toISOString()); w.state.fired = at.toISOString();
    const own = (): void => {
      if (w.action === 'tell' || !act) tell({ title: found.title, body: found.body, url: found.url, path: found.path || '', watcher: w.title });
      else void Promise.resolve().then(() => act({ watcher: { ...w, state: undefined }, found })).catch((error: unknown) => {
        log({ at: now().toISOString(), watcher: w.id, event: w.event, act: 'failed', error: text(errText(error), 300) });
        tell({ title: found.title, body: `${found.body} (${w.action === 'work' ? 'Work on it' : 'Summarise'} couldn’t start: ${text(errText(error), 200)})`, url: found.url, path: found.path || '', watcher: w.title });
      });
    };
    // A goal's watcher wakes the goals waiting on it; with none waiting, it does its own action.
    if (w.goal && wake) void Promise.resolve().then(() => wake({ watcher: { ...w, state: undefined }, found })).then(woke => { if (!woke) own(); }).catch((error: unknown) => {
      log({ at: now().toISOString(), watcher: w.id, event: w.event, act: 'failed', error: text(errText(error), 300) });
      tell({ title: found.title, body: `${found.body} (${w.goal} couldn’t be woken: ${text(errText(error), 200)})`, url: found.url, path: found.path || '', watcher: w.title });
    });
    else own();
    log({ at: at.toISOString(), watcher: w.id, event: w.event, key: found.key, act: w.goal && wake ? `goal ${w.goal}` : w.action });
    return true;
  }
  // One look: what is new since the last fires (the first look only learns what is there).
  async function lookOnce(w: Watcher): Promise<{ looked: boolean; fired?: number }> {
    if (busy.has(w.id)) return { looked: false };
    busy.add(w.id);
    let fired = 0;
    try {
      const found = await look[w.event](w);
      w.state.error = '';
      // null: nothing to say this time (something is still being written); look again next time.
      if (found === null) return { looked: true, fired: 0 };
      if (!w.state.started && !FIRST_LOOK_FIRES.includes(w.event)) { w.state.seen = found.map(f => f.key).slice(0, SEEN); w.state.started = true; }
      else {
        w.state.started = true;
        const fresh = found.filter(f => !w.state.seen.includes(f.key));
        // Remember recent arXiv papers noticed by a paper watcher so the UI can offer one-click Reproduce (Decision 11).
        if (w.event === 'paper' && fresh.length) {
          const atIso = now().toISOString();
          const added: RecentPaper[] = fresh.filter(f => f.paperId).map(f => ({ id: f.paperId!, title: text(f.name, 160) || f.paperId!, url: f.url, at: atIso }));
          const merged = [...added, ...(Array.isArray(w.state.recentPapers) ? w.state.recentPapers : [])];
          const seenIds = new Set<string>();
          w.state.recentPapers = merged.filter(p => !seenIds.has(p.id) && Boolean(seenIds.add(p.id))).slice(0, 10);
        }
        if (GROUPED.includes(w.event) && fresh.length > 1) {
          if (await fire(w, { key: fresh.map(f => f.key).join(',').slice(0, 200), title: `${fresh.length} new papers`, details: async () => clipText((await Promise.all(fresh.map(f => f.details?.() ?? f.body))).join('\n\n')), body: `New on arXiv for “${w.query}”: ${fresh.slice(0, 3).map(f => f.name).join('; ')}${fresh.length > 3 ? `; and ${fresh.length - 3} more` : ''}.`, url: `https://arxiv.org/search/?query=${encodeURIComponent(w.query)}&searchtype=all&order=-announced_date_first` })) fired++;
        } else for (const f of fresh) { if (!w.enabled) break; if (await fire(w, f)) fired++; }
        w.state.seen = [...new Set([...fresh.map(f => f.key), ...w.state.seen])].slice(0, SEEN);
        // A job ends once: its watcher is done, including one turned back on after it was.
        if (ONCE.includes(w.event) && found.length && (fired || found.every(f => w.state.seen.includes(f.key)))) { w.enabled = false; w.state.paused = 'Done: what it watched for has happened.'; }
      }
    } catch (error) {
      w.state.error = text(errText(error), 300);
      log({ at: now().toISOString(), watcher: w.id, event: w.event, act: 'error', error: w.state.error });
    } finally {
      w.state.looked = now().toISOString();
      busy.delete(w.id);
      await store.saveWatchers();
    }
    return { looked: true, fired };
  }
  const step = async (): Promise<void> => { for (const w of store.watchers.filter(due)) await lookOnce(w); };
  return {
    step, lookOnce,
    async lookNow(id: string) { const w = store.watchers.find(entry => entry.id === id); if (!w) throw new Error('That watcher is gone.'); await lookOnce(w); return store.state(); },
    start() { if (!timer) { timer = setInterval(() => { void step().catch(() => {}); }, tick); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
