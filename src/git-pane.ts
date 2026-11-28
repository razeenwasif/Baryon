import './panels.css';
import { renderDiff } from './changes-pane.js';
import type { GitPrStatus } from './changes-pane.js';
import { calendarWeeks, graphLanes } from './git-graph.js';
import type { CalendarDayInput, GitGraphRow } from './git-graph.js';
import { neutrinoSection } from './neutrino-pane.js';
import type {
  NeutrinoCloneResult,
  NeutrinoCommitDetail,
  NeutrinoCommitFile,
  NeutrinoCommitSummary,
  NeutrinoInbox,
  NeutrinoInboxPr,
  NeutrinoPageTarget,
  NeutrinoPaneApi,
  NeutrinoPrCheck,
  NeutrinoPrDiffResult,
  NeutrinoPrFile,
  NeutrinoPrMergeability,
  NeutrinoPrNote,
  NeutrinoPullRequestDetail,
  NeutrinoSectionController,
} from './neutrino-pane.js';
import type { PaneContext, SidePaneDefinition } from './side-pane.js';

export type GitPaneTab = 'repo' | 'neutrino' | 'repos' | 'prs';

export type GitNeutrinoPageTarget = NeutrinoPageTarget | { kind: 'home'; tab?: string };

export interface GitWorkSession {
  root?: string;
  folder?: string;
  branch?: string;
  [key: string]: unknown;
}

export interface GitCommitFile extends NeutrinoCommitFile {
  patch?: string | null;
}

export interface GitCommitSummary extends NeutrinoCommitSummary {
  url?: string;
}

export interface GitCommitDetail extends NeutrinoCommitDetail {
  files: GitCommitFile[];
}

export interface GitOverview {
  branch: string | null;
  upstream: boolean | string | null;
  ahead: number;
  behind: number;
  changed: number;
  staged: number;
  untracked: number;
  conflicts: number;
  remote: string | null;
  github: string | null;
  neutrino: { name: string; [key: string]: unknown } | null;
  last: GitCommitSummary | null;
  branches: number;
  tags: number;
  stashes: number;
  main: string | null;
}

export interface GitLogFilter {
  grep?: string;
  author?: string;
  path?: string;
}

export interface GitLogResult {
  commits: GitCommitSummary[];
  more: boolean;
  followed?: boolean;
}

export interface GitActivityResult {
  since?: string;
  days: CalendarDayInput[];
  total: number;
}

export interface GitHubActivityRepo {
  name: string;
  url: string;
  commits: number;
}

export interface GitHubActivityResult extends GitActivityResult {
  login?: string;
  repos: GitHubActivityRepo[];
}

export interface GitCompareResult {
  base?: { ref: string; sha: string };
  head?: { ref: string; sha: string };
  swapped: boolean;
  from: string;
  to: string;
  commits: GitCommitSummary[];
  more: boolean;
  files: GitCommitFile[];
  truncated: boolean;
  added: number;
  removed: number;
  behind: number;
}

export interface GitHistoryNoteOptions {
  sha?: string;
  base?: string;
  head?: string;
  threeDot?: boolean;
  days?: number;
  baseLabel?: string;
  headLabel?: string;
}

export interface GitLocalBranch {
  name: string;
  short: string;
  date: string;
  subject: string;
  upstream: string;
  track: string;
  current: boolean;
  merged: boolean;
}

export interface GitRemoteBranch {
  name: string;
  short: string;
  date: string;
  subject: string;
  local: boolean;
}

export interface GitStashEntry {
  ref: string;
  message: string;
  date: string;
}

export interface GitBranchesResult {
  current: string | null;
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  stashes: GitStashEntry[];
}

export interface GitActResult {
  branch?: string;
  commits?: number;
  stashed?: boolean;
  ref?: string;
  fetched?: boolean;
}

export interface GitHubRepoItem {
  nameWithOwner: string;
  description?: string;
  updatedAt: string;
  visibility: string;
  isFork?: boolean;
  isArchived?: boolean;
  url?: string;
}

export interface GitHubReposResult {
  repos: GitHubRepoItem[];
}

export interface GitHubRepoOverview {
  name: string;
  description?: string;
  url: string;
  branch: string | null;
  visibility?: string;
  stars?: number;
  forks?: number;
  openIssues?: number | null;
  openPrs?: number | null;
  pushed: string;
  language?: string | null;
}

export interface GitHubCommitsResult {
  commits: GitCommitSummary[];
  more: boolean;
}

export interface PrLabel {
  name?: string;
  color?: string;
}

export interface GitHubInboxPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  updated: string;
  draft?: boolean;
  review?: string;
  checks?: string;
  comments?: number;
  additions?: number;
  deletions?: number;
  base?: string;
  head?: string;
  labels?: Array<string | PrLabel>;
}

export interface GitHubInbox {
  login?: string;
  review: GitHubInboxPr[];
  mine: GitHubInboxPr[];
  involved: GitHubInboxPr[];
  counts?: {
    review?: number;
    mine?: number;
    involved?: number;
  };
}

export interface NeutrinoPrDetailInput extends NeutrinoPullRequestDetail {
  updatedAt?: string;
}

export interface PrReviewItem {
  author?: string;
  state?: string;
  body?: string;
  at?: string;
}

export interface PrCommentItem {
  author?: string;
  body?: string;
  at?: string;
}

export interface PrInlineCommentItem {
  id?: string | number;
  path?: string;
  line?: number | null;
  author?: string;
  body?: string;
  at?: string;
}

export interface PrChecksSummary {
  passed: number;
  failed: number;
  pending: number;
}

export interface PrDetailData {
  title: string;
  body?: string;
  url?: string;
  author?: string;
  base?: string;
  head?: string;
  state?: string;
  updatedAt?: string;
  mergeable?: string;
  mergeability?: NeutrinoPrMergeability | null;
  checksList?: NeutrinoPrCheck[];
  checks?: PrChecksSummary | null;
  files?: NeutrinoPrFile[];
  notes?: NeutrinoPrNote[];
  reviewers?: string[];
  labels?: Array<string | PrLabel>;
  reviews?: PrReviewItem[];
  conversation?: PrCommentItem[];
  reviewComments?: PrInlineCommentItem[];
  changes?: {
    additions?: number;
    deletions?: number;
    files?: number;
  };
}

export interface GitPaneApi extends NeutrinoPaneApi {
  gitOverview: () => Promise<GitOverview | null>;
  gitLog: (options?: { limit?: number; skip?: number; all?: boolean; grep?: string; author?: string; path?: string }) => Promise<GitLogResult | null>;
  gitPrStatus: () => Promise<GitPrStatus | null>;
  gitActivity: () => Promise<GitActivityResult | null>;
  gitCommitDetail: (sha: string) => Promise<GitCommitDetail | null>;
  gitCommitFileDiff: (sha: string, path: string) => Promise<string | null>;
  gitCompare: (options: { base: string; head: string; threeDot: boolean }) => Promise<GitCompareResult | null>;
  gitCompareFileDiff: (from: string, to: string, path: string) => Promise<string | null>;
  gitHistoryNote: (note: GitHistoryNoteOptions) => Promise<unknown>;
  gitBranches: () => Promise<GitBranchesResult | null>;
  gitAct: (action: string, value?: string) => Promise<GitActResult | null>;
  githubInbox?: () => Promise<GitHubInbox | null>;
  githubPr?: (repo: string, number: number) => Promise<PrDetailData | null>;
  githubPrDiff?: (repo: string, number: number, path: string) => Promise<NeutrinoPrDiffResult | string | null>;
  githubActivity: () => Promise<GitHubActivityResult | null>;
  githubRepos: (options?: { limit?: number }) => Promise<GitHubReposResult | null>;
  githubRepo: (repo: string) => Promise<GitHubRepoOverview | null>;
  githubCommits: (repo: string, options?: { limit?: number; page?: number }) => Promise<GitHubCommitsResult | null>;
  githubCommit: (repo: string, sha: string) => Promise<GitCommitDetail | null>;
  githubClone: (repo: string) => Promise<NeutrinoCloneResult | null>;
  neutrinoPr: (repo: string, number: number) => Promise<NeutrinoPrDetailInput | null>;
}

export interface GitPaneOptions {
  api?: GitPaneApi | null;
  work: () => GitWorkSession | null | undefined;
  onError?: (message: string) => void;
  openLink?: (url: string) => void;
  ask?: ((record: unknown, text: string) => void) | null;
  openWork?: ((next: NeutrinoCloneResult, said: string) => void) | null;
  draft?: ((text: string) => void) | null;
  openNeutrinoPage?: ((target: GitNeutrinoPageTarget) => void) | null;
}

export interface GitPaneController extends SidePaneDefinition {
  showHistory: (path: string) => void;
  showNeutrino: (repo?: string, pr?: number | null) => void;
  reset: () => void;
  render: (body: HTMLElement, context: PaneContext) => Promise<void>;
}

interface CompareState {
  base: string;
  head: string;
  threeDot: boolean;
  baseLabel: string;
  headLabel: string;
  result: GitCompareResult | null;
}

interface LocalRepoState {
  key: string;
  overview: GitOverview | null;
  commits: GitCommitSummary[];
  more: boolean;
  followed?: boolean;
  pr: GitPrStatus | null;
  picking: boolean;
  picked: GitCommitSummary[];
  compare: CompareState | null;
  filter: GitLogFilter;
  view?: 'branches' | null;
  all?: boolean;
  note?: string;
  github?: string | null;
  activity?: GitActivityResult | null;
}

interface RemoteRepoState {
  name: string;
  overview: GitHubRepoOverview | null;
  commits: GitCommitSummary[];
  more: boolean;
  page: number;
}

interface InboxCache {
  at: number;
  data: GitHubInbox | null;
  seen: Record<string, string> | null;
}

type NormalizedCheckState = 'passing' | 'failing' | 'running' | '';

type PrBucket = 'all' | 'neutrino' | 'review' | 'mine' | 'involved';
type PrDetailTab = 'summary' | 'timeline' | 'code';

type PrIconKind =
  | 'pr' | 'search' | 'sort' | 'filter' | 'bucket' | 'refresh' | 'check' | 'fail' | 'running'
  | 'reviewer' | 'ext' | 'tag' | 'users' | 'branch' | 'warn' | 'back' | 'clear' | 'edit' | 'file' | 'bolt';

interface PrListItem {
  repo: string;
  number: number;
  title: string;
  url?: string;
  author?: string;
  updated?: string;
  draft?: boolean;
  review?: string;
  checks: NormalizedCheckState;
  additions?: number;
  deletions?: number;
  base?: string;
  head?: string;
  labels?: Array<string | PrLabel>;
  bucket: string;
  source: 'neutrino' | 'github';
}

interface PrDetailCacheEntry {
  loading: boolean;
  unsupported?: boolean;
  error?: string;
  data?: PrDetailData | null;
  diffs?: Map<string, string>;
}

interface PrUiState {
  query: string;
  sort: 'updated' | 'changes';
  bucket: PrBucket;
  selectedKey: string;
  detailOpen: boolean;
  detailTab: PrDetailTab;
  details: Map<string, PrDetailCacheEntry>;
}

interface GridPickController {
  has: (sha: string) => boolean;
  toggle: (commit: GitCommitSummary) => void;
}

interface GitGridOptions {
  detail?: ((sha: string) => Promise<GitCommitDetail | null>) | null;
  urlOf?: ((commit: GitCommitSummary) => string) | null;
  fileDiff?: ((sha: string, file: GitCommitFile) => Promise<string | null> | string | null) | null;
  pick?: unknown;
  explain?: boolean;
  graph?: boolean;
}

// The Git pane: the work session's repository at a glance (its branch and how it stands with GitHub, what's changed,
// its pull request and checks) above a grid of its history, where a commit opens to the files it changed; and your
// GitHub repositories, each with its own overview and history. A file in a commit opens to its diff, and two points in
// history (two commits you pick, or the branch against the one it merges into) can be compared. It only reads; committing
// stays in Changes.
export const relativeTime = (iso: string, now = Date.now()): string => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
};

export function gitPane({ api, work, onError = () => {}, openLink = () => {}, ask = null, openWork = null, draft = null, openNeutrinoPage = null }: GitPaneOptions): GitPaneController {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (className: string, text: string, onclick: ((event: MouseEvent) => unknown) | null, title?: string): HTMLButtonElement => { const node = el('button', className, text); node.type = 'button'; node.onclick = onclick; if (title) node.title = title; return node; };
  const link = (text: string, url: string): HTMLAnchorElement => { const a = el('a', 'git-link', text); a.href = url; a.onclick = event => { event.preventDefault(); openLink(url); }; return a; };
  const guard = async <T>(run: () => Promise<T>): Promise<T | null> => { try { return await run(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); return null; } };
  // Asking Fairy: the history is written to a file and attached, and the question goes in the message box for you to
  // send or change, so nothing reaches a model until you press Send.
  const asking = (label: string, note: GitHistoryNoteOptions, text: string): HTMLButtonElement => {
    const b = button('panel-button quiet git-tool git-ask', label, async () => {
      b.disabled = true;
      const record = await guard(() => api!.gitHistoryNote(note));
      b.disabled = false;
      if (record && ask) ask(record, text);
    }, 'Attaches this history to a message for Fairy, ready for you to send');
    return b;
  };
  // tab: 'repo' or 'repos'; repo: a GitHub repository opened from Your repos; history kept while the pane redraws.
  let tab: GitPaneTab = 'repo', opened: string | null = null, local: LocalRepoState | null = null, remote: RemoteRepoState | null = null, repos: GitHubReposResult | null = null, inbox: InboxCache | null = null, nInbox: NeutrinoInbox | null = null, wanted: GitLogFilter | null = null, activity: GitHubActivityResult | null = null;
  const prUi: PrUiState = { query: '', sort: 'updated', bucket: 'all', selectedKey: '', detailOpen: false, detailTab: 'summary', details: new Map() };

  function tabs(context: PaneContext): HTMLDivElement {
    const bar = el('div', 'git-tabs');
    const waiting = inbox?.data?.review?.length || 0;
    const nWaiting = (nInbox?.waiting?.length || 0) + (nInbox?.ready?.length || 0);
    for (const [id, name] of [['repo', 'This repo'], ['neutrino', nWaiting ? `Neutrino · ${nWaiting}` : 'Neutrino'], ['repos', 'Your repos'], ['prs', waiting ? `Pull requests · ${waiting}` : 'Pull requests']] as Array<[GitPaneTab, string]>) {
      const t = button(`git-tab${tab === id ? ' on' : ''}`, name, () => { const prev = tab; tab = id; opened = id === 'repos' ? opened : null; if (id === 'neutrino' && prev === 'neutrino') neutrino.reset(); context.redraw(); });
      t.setAttribute('aria-pressed', String(tab === id)); bar.append(t);
    }
    return bar;
  }
  // One row's piece of the branch graph, drawn to join the rows above and below it: a row is 30px plus its 1px border,
  // and the graph's cell has no border, so its 31px drawing meets the next one.
  const LANE = 12, ROW = 31, MID = 15, MOST = 10, COLOURS = ['#7f9cff', '#c99bff', '#7fd6b8', '#f6c878', '#f39ab4', '#7cc8f5', '#b5d77e', '#f4a77c'];
  const svgNS = 'http://www.w3.org/2000/svg';
  const expandButton = (onClick: (event: MouseEvent) => unknown, title = 'Open full Neutrino page'): HTMLButtonElement => {
    const b = button('panel-button quiet git-tool git-icon-tool', '', onClick, title);
    b.setAttribute('aria-label', title);
    const pic = document.createElementNS(svgNS, 'svg');
    for (const [k, v] of Object.entries({ width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
      pic.setAttribute(k, String(v));
    }
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
    pic.append(p);
    b.append(pic);
    return b;
  };
  const laneX = (i: number): number => 7 + LANE * Math.min(i, MOST - 1), colour = (i: number): string => COLOURS[i % COLOURS.length];
  const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] => { const node = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, String(v)); return node; };
  const curve = (x1: number, y1: number, x2: number, y2: number): string => x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  function graphCell(row: GitGraphRow, width: number, { picked = null }: { picked?: boolean | null } = {}): HTMLTableCellElement {
    const cell = el('td', 'git-graph'), w = laneX(Math.min(width, MOST) - 1) + 7;
    const pic = svg('svg', { width: w, height: ROW, viewBox: `0 0 ${w} ${ROW}`, 'aria-hidden': 'true' });
    const line = (d: string, i: number): void => { pic.append(svg('path', { d, stroke: colour(i), 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' })); };
    const x = laneX(row.col);
    row.top.forEach((state, i) => { if (state === 'in') line(curve(laneX(i), 0, x, MID), i); else if (state === 'pass') line(curve(laneX(i), 0, laneX(i), ROW), i); });
    if (row.down) line(curve(x, MID, x, ROW), row.col);
    for (const j of row.forks) line(curve(x, MID, laneX(j), ROW), j);
    const hollow = picked === false || (picked == null && row.merge);
    pic.append(svg('circle', { cx: x, cy: MID, r: picked != null ? 4.5 : 4, fill: hollow ? 'var(--w-side,#16171c)' : colour(row.col), stroke: picked != null ? '#c6d2ff' : colour(row.col), 'stroke-width': hollow || picked != null ? 2 : 0 }));
    cell.append(pic);
    return cell;
  }
  // Under an opened commit, the lanes carry on past its details.
  function graphGap(row: GitGraphRow, width: number): HTMLTableCellElement {
    const cell = el('td', 'git-graph gap'), w = laneX(Math.min(width, MOST) - 1) + 7;
    const pic = svg('svg', { width: w, viewBox: `0 0 ${w} 10`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    row.bottom.forEach((on, i) => { if (on) pic.append(svg('path', { d: `M${laneX(i)} 0V10`, stroke: colour(i), 'stroke-width': 1.6, fill: 'none', 'vector-effect': 'non-scaling-stroke' })); });
    cell.append(pic);
    return cell;
  }
  // A year of days as a grid, a column a week, darker for busier days; each square says its count when pointed at.
  const HEAT = ['rgba(255,255,255,.06)', 'rgba(127,156,255,.28)', 'rgba(127,156,255,.5)', 'rgba(127,156,255,.74)', '#b4c6ff'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const localDay = (at = new Date()): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const plural = (n: number, word: string): string => `${n.toLocaleString('en-AU')} ${word}${n === 1 ? '' : 's'}`;
  const longDate = (date: string): string => new Date(`${date}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function heatmap(days: CalendarDayInput[], { unit, label }: { unit: string; label: string }): SVGSVGElement {
    const { weeks, months } = calendarWeeks(days, { today: localDay() });
    const C = 11, G = 2, left = 24, top = 14, w = left + weeks.length * (C + G), h = top + 7 * (C + G);
    const pic = svg('svg', { class: 'git-heat', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label });
    let last = -9;
    for (const m of months) { if (m.week - last < 3) continue; last = m.week; const t = svg('text', { x: left + m.week * (C + G), y: 9 }); t.textContent = MONTHS[m.month]; pic.append(t); }
    for (const [row, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']] as Array<[number, string]>) { const t = svg('text', { x: 0, y: top + row * (C + G) + 9 }); t.textContent = name; pic.append(t); }
    weeks.forEach((week, x) => week.forEach((day, y) => {
      if (!day) return;
      const square = svg('rect', { x: left + x * (C + G), y: top + y * (C + G), width: C, height: C, rx: 2, fill: HEAT[day.level] });
      const tip = svg('title', {}); tip.textContent = `${day.count ? plural(day.count, unit) : `No ${unit}s`} on ${longDate(day.date)}`; square.append(tip);
      pic.append(square);
    }));
    return pic;
  }
  // The busiest day and the longest run of days with something, for the line above a grid.
  function activityLine(days: CalendarDayInput[], total: number, unit: string): string {
    const busiest = days.reduce<CalendarDayInput | null>((top, day) => (day.count > (top?.count || 0) ? day : top), null);
    const on = new Set(days.filter(d => d.count > 0).map(d => d.date)); let best = 0, run = 0;
    for (let at = new Date(), i = 0; i < 366; i++, at.setDate(at.getDate() - 1)) { if (on.has(localDay(at))) { run++; best = Math.max(best, run); } else run = 0; }
    return [`${plural(total, unit)} in the last year`, busiest ? `busiest day ${longDate(busiest.date)} (${busiest.count})` : '', best > 1 ? `longest run ${best} days in a row` : ''].filter(Boolean).join(' · ');
  }
  const card = (label: string, value: string, note = ''): HTMLDivElement => { const box = el('div', 'git-card'); box.append(el('span', 'git-card-label', label), el('strong', 'git-card-value', value)); if (note) box.append(el('span', 'git-card-note', note)); return box; };

  // Files with their +/− counts; clicking one shows its diff beneath it, and clicking again hides it.
  function fileList(files: GitCommitFile[], diffOf: (file: GitCommitFile) => Promise<string | null | undefined> | string | null | undefined): HTMLUListElement {
    const list = el('ul', 'git-files');
    for (const file of files) {
      const item = el('li');
      const open = el('button', 'git-file-open'); open.type = 'button'; open.title = file.path;
      open.append(el('span', 'git-file', file.path), el('span', 'git-added', file.added == null ? 'binary' : `+${file.added}`), el('span', 'git-removed', file.removed == null ? '' : `−${file.removed}`));
      open.setAttribute('aria-expanded', 'false');
      open.onclick = async event => {
        event.stopPropagation();
        const shown = item.querySelector('.git-diff-box');
        if (shown) { shown.remove(); open.setAttribute('aria-expanded', 'false'); item.classList.remove('open'); return; }
        const box = el('div', 'git-diff-box'); box.append(el('p', 'panel-note busy', 'Reading the diff…')); item.append(box);
        open.setAttribute('aria-expanded', 'true'); item.classList.add('open');
        const text = await guard(async () => diffOf(file));
        if (text == null) { box.replaceChildren(el('p', 'panel-note', file.added == null ? 'A binary file, so there’s no text to compare.' : 'There’s no diff to show for this file.')); return; }
        if (!String(text).trim()) { box.replaceChildren(el('p', 'panel-note', 'No differences to show.')); return; }
        const view = renderDiff(text); view.className = 'work-diff git-diff'; box.replaceChildren(view);
      };
      item.append(open); list.append(item);
    }
    return list;
  }

  // A grid of commits: message with its branches and tags, author, when, and the short hash. A row opens to its files,
  // and each file to its diff. While picking, a row is ticked instead, for comparing two.
  function grid(commits: GitCommitSummary[], { detail = null, urlOf = null, fileDiff = null, pick = null, explain = false, graph = true }: GitGridOptions = {}): HTMLTableElement {
    const picker = pick as GridPickController | null;
    const table = el('table', 'git-grid graph');
    // A filtered history skips the commits between, so it has no lines to draw: just a node each.
    const { rows: lanes, width } = graph ? graphLanes(commits) : { rows: commits.map(c => ({ col: 0, top: [], down: false, forks: [], bottom: [], merge: (c.parents?.length || 0) > 1 })), width: 1 };
    const head = el('thead'), row = el('tr');
    for (const name of ['', 'Message', 'Author', 'When', 'Commit']) row.append(el('th', '', name));
    const firstCol = row.firstElementChild as HTMLElement | null;
    if (firstCol) firstCol.style.width = `${laneX(Math.min(width, MOST) - 1) + 7 + 6}px`;
    head.append(row);
    const body = el('tbody');
    commits.forEach((commit, index) => {
      const isMerge = (commit.parents?.length ?? 0) > 1;
      const tr = el('tr', `git-row${isMerge ? ' merge' : ''}`);
      const picked = picker?.has(commit.sha);
      if (picked) tr.classList.add('picked');
      const dot = graphCell(lanes[index], width, { picked: picker ? Boolean(picked) : null }); dot.title = picker ? (picked ? 'Picked' : 'Pick this commit') : isMerge ? 'A merge' : '';
      const message = el('td', 'git-message');
      // The message first, so it reads even when the branches and tags on it don't all fit.
      message.append(el('span', 'git-subject', commit.subject));
      for (const ref of commit.refs || []) message.append(el('span', `git-ref${ref.startsWith('→') ? ' head' : ref.startsWith('#') ? ' tag' : ref.includes('/') ? ' remote' : ''}`, ref));
      message.title = [commit.subject, ...(commit.refs || [])].join('  ·  ');
      const when = el('td', 'git-when', commit.date ? relativeTime(commit.date) : ''); when.title = commit.date ? new Date(commit.date).toLocaleString('en-AU') : '';
      const sha = el('td', 'git-sha'); sha.append(urlOf ? link(commit.short, urlOf(commit)) : el('code', '', commit.short));
      const author = el('td', 'git-author', commit.author || ''); author.title = commit.email || '';
      tr.append(dot, message, author, when, sha);
      body.append(tr);
      if (picker) {
        tr.tabIndex = 0; tr.classList.add('opens'); tr.setAttribute('aria-pressed', String(Boolean(picked)));
        const toggle = (): void => picker.toggle(commit);
        tr.onclick = toggle; tr.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
      } else if (detail) {
        tr.tabIndex = 0; tr.classList.add('opens');
        const open = async (): Promise<void> => {
          const next = tr.nextElementSibling;
          if (next?.classList.contains('git-detail')) { next.remove(); tr.classList.remove('open'); return; }
          tr.classList.add('open');
          const extra = el('tr', 'git-detail'), cell = el('td'); cell.colSpan = 4; cell.append(el('p', 'panel-note busy', 'Reading the commit…')); extra.append(graphGap(lanes[index], width), cell); tr.after(extra);
          const found = await guard(() => detail(commit.sha));
          if (!found) { extra.remove(); tr.classList.remove('open'); return; }
          const files = fileList(found.files, file => fileDiff ? fileDiff(commit.sha, file) : null);
          const rest = found.message.split('\n').slice(1).join('\n').trim();
          const actions = explain && ask ? [el('div', 'git-actions')] : [];
          if (actions.length) actions[0].append(asking('Ask Fairy to explain', { sha: commit.sha }, `Explain commit ${commit.short} (“${commit.subject}”), which is attached: what it changed and why, and anything in it that looks risky or unfinished.`));
          cell.replaceChildren(...(rest ? [el('pre', 'git-body', rest)] : []), found.files.length ? files : el('p', 'panel-note', isMerge ? 'This merge brought in nothing new against its first parent.' : 'No files changed.'), ...(found.more ? [el('p', 'panel-note', 'Only the first 300 files are listed.')] : []), ...actions);
        };
        tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void open(); } };
      }
    });
    table.append(head, body);
    return table;
  }

  async function thisRepo(root: HTMLElement, context: PaneContext): Promise<void> {
    const session = work();
    if (!session) {
      root.append(el('p', 'pane-empty', 'In a work session, its repository shows here: the branch, what’s changed, its pull request and its history.'));
      root.append(button('panel-button quiet', 'See your GitHub repos', () => { tab = 'repos'; context.redraw(); }));
      return;
    }
    const key = session.root || session.folder || '';
    if (!local || local.key !== key) local = { key, overview: null, commits: [], more: false, pr: null, picking: false, picked: [], compare: null, filter: {} };
    const repoState = local;
    if (wanted) { repoState.filter = wanted; repoState.commits = []; repoState.more = false; repoState.compare = null; repoState.picking = false; wanted = null; }
    const filter = repoState.filter, filtered = Boolean(filter.grep || filter.author || filter.path);
    if (repoState.compare) return compareView(root, context);
    if (repoState.view === 'branches') return branchesView(root, context);
    const [overview, log, pr] = await Promise.all([guard(() => api!.gitOverview()), repoState.commits.length > 50 ? null : guard(() => api!.gitLog({ limit: 50, all: repoState.all, ...filter })), guard(() => api!.gitPrStatus())]);
    if (!overview) { root.append(el('p', 'pane-empty', 'This folder isn’t a Git repository.')); return; }
    if (log) { repoState.commits = log.commits; repoState.more = log.more; repoState.followed = log.followed; }
    const head = el('div', 'git-head');
    head.append(el('h2', '', overview.github || overview.neutrino?.name || key.split('/').pop()));
    head.append(button('panel-button quiet git-tool', 'Branches and stashes', () => { repoState.view = 'branches'; context.redraw(); }, 'Switch, make or delete branches, stash changes, fetch and pull'));
    const neutrinoInfo = overview.neutrino;
    if (neutrinoInfo) head.append(button('panel-button quiet git-tool', `On Neutrino · ${neutrinoInfo.name}`, () => { tab = 'neutrino'; neutrino.openRepo(neutrinoInfo.name); context.redraw(); }, 'Open this repository on Neutrino (PRs, Graviton CI, mirrors)'));
    if (overview.github) head.append(link('On GitHub', `https://github.com/${overview.github}`));
    if (openNeutrinoPage) head.append(expandButton(() => openNeutrinoPage(neutrinoInfo ? { kind: 'repo', repo: neutrinoInfo.name } : { kind: 'home' }), neutrinoInfo ? `Expand ${neutrinoInfo.name} to full Neutrino page` : 'Open full Neutrino page'));
    root.append(head);
    if (repoState.note) { root.append(el('p', 'page-note git-done', repoState.note)); repoState.note = ''; }
    repoState.overview = overview;
    const cards = el('div', 'git-cards');
    const sync = !overview.upstream ? (overview.neutrino && !overview.github ? 'Not on Neutrino yet' : 'Not on GitHub yet') : overview.ahead || overview.behind ? [overview.ahead ? `${overview.ahead} to push` : '', overview.behind ? `${overview.behind} to pull` : ''].filter(Boolean).join(', ') : 'Up to date';
    cards.append(card('Branch', overview.branch || 'No branch', sync));
    cards.append(card('Changes', overview.changed ? `${overview.changed} changed` : 'Nothing changed', [overview.staged ? `${overview.staged} staged` : '', overview.untracked ? `${overview.untracked} new` : '', overview.conflicts ? `${overview.conflicts} in conflict` : ''].filter(Boolean).join(' · ')));
    const pull = pr?.available && pr.pr;
    const prCard = card('Pull request', pull ? `#${pull.number} ${pull.state === 'MERGED' ? 'merged' : pull.state === 'CLOSED' ? 'closed' : pull.draft ? 'draft' : 'open'}` : 'None for this branch',
      pull ? [pull.checks.failed ? `${pull.checks.failed} checks failing` : pull.checks.pending ? `${pull.checks.pending} checks running` : pull.checks.passed ? 'checks passing' : '', pull.review ? pull.review.toLowerCase().replaceAll('_', ' ') : ''].filter(Boolean).join(' · ') : pr && !pr.available ? pr.reason : '');
    if (pull && pull.neutrino) { prCard.classList.add('opens'); prCard.onclick = () => { tab = 'neutrino'; neutrino.openPr(pull.repo, pull.number); context.redraw(); }; prCard.title = pull.title; }
    else if (pull && pull.url) { const pullUrl = pull.url; prCard.classList.add('opens'); prCard.onclick = () => openLink(pullUrl); prCard.title = pull.title; }
    cards.append(prCard);
    const repoCard = card('Repository', `${overview.branches} branch${overview.branches === 1 ? '' : 'es'}`, [overview.tags ? `${overview.tags} tags` : '', overview.stashes ? `${overview.stashes} stashed` : ''].filter(Boolean).join(' · '));
    repoCard.classList.add('opens'); repoCard.title = 'Branches and stashes'; repoCard.onclick = () => { repoState.view = 'branches'; context.redraw(); };
    cards.append(repoCard);
    repoState.github = overview.github;
    root.append(cards);
    // This repository's commits by day, on every branch.
    if (!repoState.activity) repoState.activity = await guard(() => api!.gitActivity());
    if (repoState.activity?.days.length) {
      const block = el('div', 'git-activity');
      block.append(el('p', 'panel-note', activityLine(repoState.activity.days, repoState.activity.total, 'commit') + ', on every branch'), heatmap(repoState.activity.days, { unit: 'commit', label: `Commits in this repository by day, over the last year` }));
      root.append(block);
    }
    // History, with the two ways to compare: this branch against the one it merges into, or two commits you pick.
    const bar = el('div', 'git-section-row');
    bar.append(el('h3', 'git-section', filter.path ? `History of ${filter.path}` : 'History'));
    const base = overview.main, mine = overview.branch;
    if (base && mine && base !== mine && base !== `origin/${mine}` && !repoState.picking)
      bar.append(button('panel-button quiet git-tool', `Compare with ${base}`, () => { repoState.compare = { base, head: 'HEAD', threeDot: true, baseLabel: base, headLabel: mine, result: null }; context.redraw(); }, `What ${mine} adds since it left ${base}, as a pull request would show it`));
    // Every branch, or just the one checked out; the graph shows how they part and meet.
    if (!repoState.picking) {
      const all = button(`panel-button quiet git-tool${repoState.all ? ' on' : ''}`, 'All branches', () => { repoState.all = !repoState.all; repoState.commits = []; repoState.more = false; context.redraw(); }, repoState.all ? 'Showing every branch. Click to show just this one.' : 'Show every branch’s commits, not just this one’s');
      all.setAttribute('aria-pressed', String(Boolean(repoState.all))); bar.append(all);
    }
    if (ask && !repoState.picking && repoState.commits.length) bar.append(asking('What changed this week', { days: 7 }, `Summarise what changed in this repository over the last 7 days, from the attached history: the main themes first, then anything unfinished or worth a second look.`));
    if (repoState.commits.length > 1) bar.append(button('panel-button quiet git-tool', repoState.picking ? 'Cancel' : 'Pick two to compare', () => { repoState.picking = !repoState.picking; repoState.picked = []; context.redraw(); }));
    root.append(bar);
    // Find commits by words in their message, their author or the files they touched. A box is applied with Return or
    // when you leave it.
    const filters = el('div', 'git-filters');
    const box = (key: keyof GitLogFilter, label: string, hint: string): HTMLInputElement => {
      const input = el('input', 'git-filter'); input.type = 'search'; input.placeholder = label; input.value = filter[key] || ''; input.title = hint; input.setAttribute('aria-label', label); input.spellcheck = false;
      input.onchange = () => { const next: GitLogFilter = { ...repoState.filter, [key]: input.value.trim() }; if (!next[key]) delete next[key]; if (JSON.stringify(next) === JSON.stringify(repoState.filter)) return; repoState.filter = next; repoState.commits = []; repoState.more = false; context.redraw(); };
      input.onkeydown = event => { if (event.key === 'Enter') input.blur(); };
      return input;
    };
    filters.append(box('grep', 'Words in the message', 'Commits whose message has these words, in any case'), box('author', 'Author', 'Commits by someone whose name or email has this in it'), box('path', 'File or folder', 'Commits that changed this file or anything in this folder, such as src/app.js or desktop/'));
    if (filtered) filters.append(button('panel-button quiet git-tool', 'Clear', () => { repoState.filter = {}; repoState.commits = []; repoState.more = false; context.redraw(); }));
    root.append(filters);
    if (filtered) root.append(el('p', 'panel-note', repoState.commits.length ? `${repoState.commits.length}${repoState.more ? '+' : ''} matching commit${repoState.commits.length === 1 && !repoState.more ? '' : 's'}${repoState.followed ? ', following the file back through renames' : ''}.` : 'No commits match.'));
    if (repoState.picking) {
      const strip = el('div', 'git-pickbar');
      strip.append(el('span', '', repoState.picked.length === 2 ? 'Two commits picked.' : repoState.picked.length === 1 ? 'Pick one more commit.' : 'Click two commits to compare them.'));
      const go = button('panel-button git-tool', 'Compare', () => {
        const order = (sha: string): number => repoState.commits.findIndex(c => c.sha === sha);
        const [newer, older] = [...repoState.picked].sort((a, b) => order(a.sha) - order(b.sha));
        repoState.compare = { base: older.sha, head: newer.sha, threeDot: false, baseLabel: older.short, headLabel: newer.short, result: null };
        repoState.picking = false; repoState.picked = []; context.redraw();
      });
      go.disabled = repoState.picked.length !== 2; strip.append(go); root.append(strip);
    }
    const pick: GridPickController | null = repoState.picking ? { has: sha => repoState.picked.some(c => c.sha === sha), toggle: commit => {
      const at = repoState.picked.findIndex(c => c.sha === commit.sha);
      if (at >= 0) repoState.picked.splice(at, 1); else { repoState.picked.push(commit); if (repoState.picked.length > 2) repoState.picked.shift(); }
      context.redraw();
    } } : null;
    root.append(repoState.commits.length ? grid(repoState.commits, { detail: sha => api!.gitCommitDetail(sha), fileDiff: (sha, file) => api!.gitCommitFileDiff(sha, file.path), urlOf: overview.github ? commit => `https://github.com/${overview.github}/commit/${commit.sha}` : null, pick, explain: true, graph: !filtered }) : filtered ? el('span') : el('p', 'panel-note', 'No commits yet.'));
    if (repoState.more) root.append(button('panel-button quiet git-more', 'Show older commits', async () => {
      const older = await guard(() => api!.gitLog({ limit: 50, skip: repoState.commits.length, all: repoState.all, ...filter }));
      if (older) { repoState.commits.push(...older.commits); repoState.more = older.more; context.redraw(); }
    }));
  }

  // Two points in history side by side: the commits between them and every file that differs, each opening to its diff.
  async function compareView(root: HTMLElement, context: PaneContext): Promise<void> {
    const repoState = local;
    const c = repoState?.compare;
    if (!repoState || !c) return;
    if (!c.result) {
      const found = await guard(() => api!.gitCompare({ base: c.base, head: c.head, threeDot: c.threeDot }));
      if (!found) { repoState.compare = null; root.append(el('p', 'panel-note', 'Couldn’t compare those.'), button('panel-button quiet', 'Back to the history', () => context.redraw())); return; }
      c.result = found;
      if (found.swapped) [c.baseLabel, c.headLabel] = [c.headLabel, c.baseLabel];
    }
    const r = c.result;
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { repoState.compare = null; context.redraw(); }, 'Back to the history'));
    const title = el('h2', '', `${c.baseLabel} … ${c.headLabel}`); title.title = c.threeDot ? `What ${c.headLabel} adds since it left ${c.baseLabel}` : `From ${c.baseLabel} to ${c.headLabel}`;
    head.append(title);
    // A branch comparison links by name, so it works before every commit is pushed; two commits link by their ids.
    if (repoState.github) head.append(link('On GitHub', `https://github.com/${repoState.github}/compare/${c.threeDot ? `${c.baseLabel.replace(/^origin\//, '')}...${c.headLabel}` : `${r.from}..${r.to}`}`));
    root.append(head);
    root.append(el('p', 'panel-note', c.threeDot ? `What ${c.headLabel} adds since it left ${c.baseLabel}, as a pull request shows it.${c.baseLabel.startsWith('origin/') ? ` ${c.baseLabel} is as of your last fetch.` : ''}` : `Everything that changed from ${c.baseLabel} to ${c.headLabel}.`));
    const cards = el('div', 'git-cards');
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    cards.append(card('Commits', r.more ? 'Over 200' : plural(r.commits.length, 'commit'), c.threeDot ? `on ${c.headLabel}` : 'between them'));
    if (c.threeDot) cards.append(card(`Only on ${c.baseLabel}`, plural(r.behind, 'commit'), r.behind ? `not in ${c.headLabel} yet` : `${c.headLabel} has all of it`));
    cards.append(card('Files', `${r.truncated ? 'Over 500' : r.files.length} changed`), card('Lines', `+${r.added} −${r.removed}`));
    root.append(cards);
    if (!r.files.length && !r.commits.length) { root.append(el('p', 'pane-empty', 'No differences.')); return; }
    if (ask) {
      const note: GitHistoryNoteOptions = { base: c.base, head: c.head, threeDot: c.threeDot, baseLabel: c.baseLabel, headLabel: c.headLabel }, span = `${c.baseLabel} … ${c.headLabel}`;
      const actions = el('div', 'git-actions');
      actions.append(
        asking('Summarise', note, `Summarise what changed in ${span}, from the attached commits and diff: the main changes first, then anything risky or unfinished.`),
        asking('Release notes', note, `Write release notes for ${span} from the attached commits and diff, grouped by what someone using it would notice (new, changed, fixed), in plain words. Leave out internal-only changes unless they matter.`));
      root.append(actions);
    }
    if (r.files.length) root.append(el('h3', 'git-section', 'Files'), fileList(r.files, file => api!.gitCompareFileDiff(r.from, r.to, file.path)));
    if (r.truncated) root.append(el('p', 'panel-note', 'Only the first 500 files are listed.'));
    if (r.commits.length) root.append(el('h3', 'git-section', 'Commits'), grid(r.commits, { detail: sha => api!.gitCommitDetail(sha), fileDiff: (sha, file) => api!.gitCommitFileDiff(sha, file.path), urlOf: repoState.github ? commit => `https://github.com/${repoState.github}/commit/${commit.sha}` : null, explain: true }));
    if (r.more) root.append(el('p', 'panel-note', 'Only the newest 200 commits are listed.'));
  }

  // Your pull requests across GitHub in a T3 Code–style split view: searchable/sortable queue on the left,
  // tabbed Summary / Timeline / Code inspector on the right.
  const SEEN = 'fairy.git.prsSeen';
  const readSeen = (): Record<string, string> | null => { try { return JSON.parse(localStorage.getItem(SEEN) || 'null') as Record<string, string> | null; } catch { return null; } };
  const prAge = (iso: string, now = Date.now()): string => {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return '';
    const mins = Math.max(0, Math.round((now - at) / 60000));
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };
  const prIconSvg = (kind: PrIconKind, size = 14): SVGSVGElement => {
    const pic = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    const add = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): void => { pic.append(svg(tag, attrs)); };
    if (kind === 'pr') { add('circle', { cx: 18, cy: 18, r: 3 }); add('circle', { cx: 6, cy: 6, r: 3 }); add('path', { d: 'M13 6h3a2 2 0 0 1 2 2v7M6 9v12' }); }
    else if (kind === 'search') { add('circle', { cx: 11, cy: 11, r: 7 }); add('path', { d: 'm20 20-3.5-3.5' }); }
    else if (kind === 'sort') { add('path', { d: 'M7 15V5m0 0-3 3m3-3 3 3M17 9v10m0 0-3-3m3 3 3-3' }); }
    else if (kind === 'filter') { add('path', { d: 'M3 6h18M7 12h10M10 18h4' }); }
    else if (kind === 'bucket') { add('circle', { cx: 12, cy: 6, r: 2.5 }); add('circle', { cx: 6, cy: 18, r: 2.5 }); add('circle', { cx: 18, cy: 18, r: 2.5 }); add('path', { d: 'M12 8.5V12m0 0H8a2 2 0 0 0-2 2v1.5M12 12h4a2 2 0 0 1 2 2v1.5' }); }
    else if (kind === 'refresh') { add('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6' }); }
    else if (kind === 'check') { add('circle', { cx: 12, cy: 12, r: 9 }); add('path', { d: 'm8.5 12.2 2.4 2.4 4.8-4.9' }); }
    else if (kind === 'fail') { add('circle', { cx: 12, cy: 12, r: 9 }); add('path', { d: 'm9.5 9.5 5 5m0-5-5 5' }); }
    else if (kind === 'running') { add('circle', { cx: 12, cy: 12, r: 9 }); add('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor' }); }
    else if (kind === 'reviewer') { add('circle', { cx: 9, cy: 8, r: 3.5 }); add('path', { d: 'M2.5 19c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5M18 8v6m3-3h-6' }); }
    else if (kind === 'ext') { add('path', { d: 'M14 5h5v5m0-5L10 14M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4' }); }
    else if (kind === 'tag') { add('path', { d: 'M20.6 13.4 12 22l-8.6-8.6A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z' }); add('circle', { cx: 7.5, cy: 7.5, r: 1.2, fill: 'currentColor' }); }
    else if (kind === 'users') { add('circle', { cx: 9, cy: 8, r: 3.5 }); add('path', { d: 'M2.5 19c0-3 2.8-5 6.5-5s6.5 2 6.5 5M16.5 4.8a3.2 3.2 0 0 1 0 6.2M21.5 19c0-2.2-1.5-3.9-3.8-4.6' }); }
    else if (kind === 'branch') { add('path', { d: 'M19 12H5m0 0 5-5m-5 5 5 5' }); }
    else if (kind === 'warn') { add('path', { d: 'M12 3 2.8 19.5a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5L12 3Zm0 7v4.5m0 3h.01' }); }
    else if (kind === 'back') { add('path', { d: 'M15 18l-6-6 6-6' }); }
    else if (kind === 'clear') { add('path', { d: 'M18 6 6 18M6 6l12 12' }); }
    else if (kind === 'edit') { add('path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }); }
    else if (kind === 'file') { add('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }); add('path', { d: 'M14 2v6h6' }); }
    else if (kind === 'bolt') { add('path', { d: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z' }); }
    return pic;
  };
  const labelBadge = (label: string | PrLabel): HTMLSpanElement => {
    const name = typeof label === 'string' ? label : (label?.name || '');
    const color = typeof label === 'object' ? String(label?.color || '').replace(/^#/, '') : '';
    const chip = el('span', 'pr-label', name);
    if (/^[0-9a-f]{6}$/i.test(color)) {
      const r = parseInt(color.slice(0, 2), 16), g = parseInt(color.slice(2, 4), 16), b = parseInt(color.slice(4, 6), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const tr = lum < 0.45 ? Math.min(255, Math.round(r * 0.55 + 140)) : r;
      const tg = lum < 0.45 ? Math.min(255, Math.round(g * 0.55 + 140)) : g;
      const tb = lum < 0.45 ? Math.min(255, Math.round(b * 0.55 + 140)) : b;
      chip.style.background = `rgba(${r},${g},${b},.18)`;
      chip.style.borderColor = `rgba(${r},${g},${b},.34)`;
      chip.style.color = `rgb(${tr},${tg},${tb})`;
    }
    return chip;
  };
  const appendInlineText = (parent: HTMLElement, line: string): void => {
    const parts = String(line || '').split(/(`[^`]+`|#\d+|@[A-Za-z0-9_-]+)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) parent.append(el('code', 'pr-md-inline', part.slice(1, -1)));
      else if (/^#\d+$/.test(part)) parent.append(el('span', 'pr-md-ref', part));
      else if (/^@[A-Za-z0-9_-]+$/.test(part)) parent.append(el('span', 'pr-md-mention', part));
      else parent.append(document.createTextNode(part));
    }
  };
  const renderPrBody = (text: string | null | undefined): HTMLDivElement => {
    const wrap = el('div', 'pr-md');
    const clean = String(text || '').trim();
    if (!clean) { wrap.append(el('p', 'pr-md-empty', 'No description provided.')); return wrap; }
    const chunks = clean.split(/(```[\s\S]*?```)/g);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      if (chunk.startsWith('```') && chunk.endsWith('```')) {
        const inner = chunk.slice(3, -3).replace(/^[A-Za-z0-9_+-]*\n/, '');
        wrap.append(el('pre', 'pr-md-code', inner.trimEnd()));
        continue;
      }
      const blocks = chunk.trim().split(/\n{2,}/);
      for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trimEnd()).filter(Boolean);
        if (!lines.length) continue;
        if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) {
          const h = el('h4', 'pr-md-h'); appendInlineText(h, lines[0].replace(/^#{1,4}\s+/, '')); wrap.append(h);
        } else if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
          const ul = el('ul', 'pr-md-list');
          for (const item of lines) { const li = el('li'); appendInlineText(li, item.replace(/^\s*[-*•]\s+/, '')); ul.append(li); }
          wrap.append(ul);
        } else {
          const p = el('p', 'pr-md-p');
          lines.forEach((l, i) => { if (i > 0) p.append(' '); appendInlineText(p, l.trim()); });
          wrap.append(p);
        }
      }
    }
    return wrap;
  };
  const prKeyOf = (pr: { source: 'neutrino' | 'github'; repo: string; number: number }): string => (pr.source === 'neutrino' ? `neutrino:${pr.repo}#${pr.number}` : `gh:${pr.repo}#${pr.number}`);
  const normalizeCheckState = (raw: unknown): NormalizedCheckState => {
    const s = String(raw || '').toLowerCase();
    if (s === 'passing' || s === 'success' || s === 'ok') return 'passing';
    if (s === 'failing' || s === 'failure' || s === 'error') return 'failing';
    if (s === 'running' || s === 'pending' || s === 'queued' || s === 'waiting') return 'running';
    return '';
  };
  const summarizeChecks = (list: readonly NeutrinoPrCheck[] | null | undefined): PrChecksSummary | null => {
    if (!Array.isArray(list) || !list.length) return null;
    let passed = 0, failed = 0, pending = 0;
    for (const c of list) {
      const k = normalizeCheckState(c?.state);
      if (k === 'passing') passed++;
      else if (k === 'failing') failed++;
      else pending++;
    }
    return { passed, failed, pending };
  };
  const normalizeNeutrinoDetail = (p: NeutrinoPrDetailInput): PrDetailData => {
    const files: NeutrinoPrFile[] = (p?.files || []).map(f => ({ path: f.path, additions: f.binary ? undefined : f.additions, deletions: f.binary ? undefined : f.deletions }));
    const additions = files.reduce((s, f) => s + (typeof f.additions === 'number' && Number.isFinite(f.additions) ? f.additions : 0), 0);
    const deletions = files.reduce((s, f) => s + (typeof f.deletions === 'number' && Number.isFinite(f.deletions) ? f.deletions : 0), 0);
    return {
      title: p.title,
      body: p.body || '',
      base: p.target,
      head: p.source,
      state: p.state,
      updatedAt: p.updatedAt,
      mergeable: p.mergeability?.clean === false ? 'CONFLICTING' : 'MERGEABLE',
      mergeability: p.mergeability || null,
      checksList: p.checks || [],
      checks: summarizeChecks(p.checks),
      files,
      notes: p.notes || [],
      changes: { additions, deletions, files: files.length },
    };
  };
  const matchPrQuery = (pr: PrListItem, rawQuery: string): boolean => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return true;
    const tokens = q.split(/\s+/);
    const labelText = (l: string | PrLabel): string => (typeof l === 'string' ? l : (l?.name || ''));
    const hay = `${pr.number} #${pr.number} ${pr.title} ${pr.repo} ${pr.author || ''} ${pr.head || ''} ${pr.base || ''} ${(pr.labels || []).map(labelText).join(' ')}`.toLowerCase();
    return tokens.every(tok => {
      if (tok.startsWith('label:')) {
        const want = tok.slice(6);
        return !want || (pr.labels || []).some(l => labelText(l).toLowerCase().includes(want));
      }
      if (tok.startsWith('repo:')) return pr.repo.toLowerCase().includes(tok.slice(5));
      if (tok.startsWith('author:')) return (pr.author || '').toLowerCase().includes(tok.slice(7));
      return hay.includes(tok);
    });
  };
  async function pullRequests(root: HTMLElement, context: PaneContext): Promise<void> {
    if (!inbox || Date.now() - inbox.at > 60000) {
      const [ghRes, nRes] = await Promise.allSettled([
        api!.githubInbox ? api!.githubInbox() : Promise.resolve(null),
        api!.neutrinoInbox ? api!.neutrinoInbox() : Promise.resolve(null),
      ]);
      const data = ghRes.status === 'fulfilled' ? ghRes.value : null;
      nInbox = nRes.status === 'fulfilled' ? nRes.value : null;
      if (!data && !nInbox) { root.append(el('p', 'pane-empty', 'Sign in to GitHub with gh auth login or start Neutrino to see your pull requests.')); return; }
      const before = readSeen(), now: Record<string, string> = {};
      if (data) for (const pr of [...data.review, ...data.mine, ...data.involved]) now[pr.url] = pr.updated;
      try { localStorage.setItem(SEEN, JSON.stringify(now)); } catch { /* Marking what's new is only a nicety. */ }
      inbox = { at: Date.now(), data, seen: before };
      context.redraw(); return;
    }
    const { data, seen } = inbox;
    const isNew = (pr: PrListItem): boolean => Boolean(pr.url && seen && (!seen[pr.url] || (pr.updated ? Date.parse(pr.updated) : NaN) > Date.parse(seen[pr.url])));
    const question = (pr: PrListItem, kind: string): string => pr.source === 'neutrino'
      ? `Inspect Neutrino PR ${pr.repo}#${pr.number} (“${pr.title}”): review its diff and notes and suggest what should be changed or whether to merge.`
      : kind === 'review' ? `Look at pull request ${pr.repo}#${pr.number} (“${pr.title}”) on GitHub and tell me what it changes and what I should check when I review it.`
      : pr.checks === 'failing' ? `Why are the checks failing on ${pr.repo}#${pr.number} (“${pr.title}”)? Read the failing logs on GitHub and tell me what to fix.`
      : `Where does ${pr.repo}#${pr.number} (“${pr.title}”) stand on GitHub: its reviews, comments and checks, and what's left before it can be merged?`;

    interface PrGroup {
      key: PrBucket;
      label: string;
      pill: string;
      icon: PrIconKind;
      total: number;
      items: PrListItem[];
    }
    const groups: PrGroup[] = [];
    const nPrs: PrListItem[] = [
      ...(nInbox?.ready || []).map((p: NeutrinoInboxPr): PrListItem => ({ ...p, bucket: 'ready', source: 'neutrino', updated: p.updatedAt, head: p.source, base: p.target, checks: normalizeCheckState(p.checks) })),
      ...(nInbox?.open || []).map((p: NeutrinoInboxPr): PrListItem => ({ ...p, bucket: 'open', source: 'neutrino', updated: p.updatedAt, head: p.source, base: p.target, checks: normalizeCheckState(p.checks) })),
    ];
    if (nPrs.length) groups.push({ key: 'neutrino', label: 'Neutrino', pill: 'Neutrino', icon: 'bolt', total: nPrs.length, items: nPrs });
    if (data) {
      for (const [key, label, pill, icon] of [
        ['review', 'Waiting for review', 'Review', 'reviewer'],
        ['mine', 'Authored', 'Authored', 'edit'],
        ['involved', 'Involved', 'Involved', 'users'],
      ] as Array<['review' | 'mine' | 'involved', string, string, PrIconKind]>) {
        const list: PrListItem[] = (data[key] || []).map((p: GitHubInboxPr): PrListItem => ({ ...p, bucket: key, source: 'github', checks: normalizeCheckState(p.checks) }));
        if (list.length) groups.push({ key, label, pill, icon, total: data.counts?.[key] ?? list.length, items: list });
      }
    }
    if (prUi.bucket !== 'all' && !groups.some(g => g.key === prUi.bucket)) prUi.bucket = 'all';

    const flatAll = groups.flatMap(g => g.items);
    if (!prUi.selectedKey || !flatAll.some(p => prKeyOf(p) === prUi.selectedKey)) {
      prUi.selectedKey = flatAll[0] ? prKeyOf(flatAll[0]) : '';
      prUi.detailOpen = false;
    }

    const split = el('div', `pr-split${prUi.detailOpen && prUi.selectedKey ? ' has-detail' : ''}`);
    const listPane = el('div', 'pr-list-pane');
    const detailPane = el('div', 'pr-detail-pane');

    // Top controls bar + category pill strip in the list pane.
    const controls = el('div', 'pr-controls');
    const searchWrap = el('div', 'pr-search-wrap');
    searchWrap.append(prIconSvg('search', 14));
    const searchInput = el('input', 'pr-search');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search pull requests, or label:bug';
    searchInput.value = prUi.query;
    searchInput.setAttribute('aria-label', 'Search pull requests');
    const clearBtn = el('button', 'pr-search-clear');
    clearBtn.type = 'button';
    clearBtn.setAttribute('aria-label', 'Clear search');
    clearBtn.append(prIconSvg('clear', 11));
    clearBtn.hidden = !prUi.query;
    clearBtn.onclick = e => {
      e.stopPropagation();
      searchInput.value = '';
      prUi.query = '';
      clearBtn.hidden = true;
      renderList();
      searchInput.focus();
    };
    searchWrap.onclick = e => { if (e.target !== clearBtn && !clearBtn.contains(e.target as Node | null)) searchInput.focus(); };
    searchWrap.append(searchInput, clearBtn);

    const sortBtn = el('button', 'pr-ctl-btn');
    sortBtn.type = 'button';
    const syncSortLabel = (): void => {
      sortBtn.replaceChildren(prIconSvg('sort', 13), el('span', '', prUi.sort === 'changes' ? 'Size' : 'Recent'));
      sortBtn.title = prUi.sort === 'changes' ? 'Sorted by diff size (click for recently updated)' : 'Sorted by recently updated (click for diff size)';
    };
    syncSortLabel();

    const refreshBtn = el('button', 'pr-ctl-btn pr-ctl-icon');
    refreshBtn.type = 'button';
    refreshBtn.title = 'Refresh pull requests';
    refreshBtn.setAttribute('aria-label', 'Refresh pull requests');
    refreshBtn.append(prIconSvg('refresh', 13));
    refreshBtn.onclick = () => { inbox = null; prUi.details.clear(); context.redraw(); };

    controls.append(searchWrap, sortBtn, refreshBtn);

    const filterStrip = el('div', 'pr-filter-strip');
    const renderFilters = (): void => {
      filterStrip.replaceChildren();
      const totalAll = groups.reduce((s, g) => s + g.total, 0);
      const pillOpts: Array<[PrBucket, string, number]> = [['all', 'All', totalAll], ...groups.map(g => [g.key, g.pill, g.total] as [PrBucket, string, number])];
      for (const [key, lbl, count] of pillOpts) {
        const pill = el('button', `pr-filter-pill${prUi.bucket === key ? ' is-active' : ''}`);
        pill.type = 'button';
        pill.append(el('span', '', lbl), el('span', 'pr-filter-count', String(count)));
        pill.onclick = () => { prUi.bucket = key; renderFilters(); renderList(); };
        filterStrip.append(pill);
      }
    };
    renderFilters();

    const listScroll = el('div', 'pr-list-scroll');
    listPane.append(controls, filterStrip);

    if (nInbox?.waiting?.length) {
      const gateBtn = button('panel-button quiet git-tool pr-gate-btn', `View ${nInbox.waiting.length} waiting deploy gate${nInbox.waiting.length === 1 ? '' : 's'} in Neutrino`, () => { tab = 'neutrino'; neutrino.reset(); context.redraw(); });
      listPane.append(gateBtn);
    }
    listPane.append(listScroll);

    const fetchDetail = async (pr: PrListItem): Promise<void> => {
      const key = prKeyOf(pr);
      const cached = prUi.details.get(key);
      if (cached && !cached.loading) return;
      const hasFetcher = pr.source === 'neutrino' ? Boolean(api!.neutrinoPr) : Boolean(api!.githubPr);
      if (!hasFetcher) { prUi.details.set(key, { loading: false, unsupported: true }); return; }
      prUi.details.set(key, { loading: true });
      renderDetail();
      try {
        const detail = pr.source === 'neutrino'
          ? normalizeNeutrinoDetail((await api!.neutrinoPr(pr.repo, pr.number)) as NeutrinoPrDetailInput)
          : await api!.githubPr!(pr.repo, pr.number);
        prUi.details.set(key, { loading: false, data: detail, diffs: new Map() });
      } catch (error) {
        prUi.details.set(key, { loading: false, error: error instanceof Error ? error.message : String(error) });
      }
      if (detailPane.isConnected && prUi.selectedKey === key) renderDetail();
    };

    const renderList = (): void => {
      listScroll.replaceChildren();
      let renderedAny = false;
      for (const group of groups) {
        if (prUi.bucket !== 'all' && group.key !== prUi.bucket) continue;
        let items = group.items.filter(pr => matchPrQuery(pr, prUi.query));
        if (prUi.sort === 'changes') {
          items = [...items].sort((a, b) => ((b.additions || 0) + (b.deletions || 0)) - ((a.additions || 0) + (a.deletions || 0)));
        }
        if (!items.length) continue;
        renderedAny = true;
        const headRow = el('div', 'pr-group-head');
        headRow.append(prIconSvg(group.icon, 12), el('span', 'pr-group-title', group.label), el('span', 'pr-group-count', String(items.length === group.items.length ? group.total : items.length)));
        listScroll.append(headRow);
        for (const pr of items) {
          const key = prKeyOf(pr);
          const row = el('button', `pr-row${prUi.selectedKey === key ? ' is-selected' : ''}`);
          row.type = 'button';
          row.dataset.prKey = key;

          const line1 = el('div', 'pr-row-top');
          const ico = el('span', `pr-state-ico${pr.source === 'neutrino' ? ' is-neutrino' : pr.draft ? ' is-draft' : ''}`);
          ico.append(prIconSvg('pr', 13));
          line1.append(ico, el('span', 'pr-row-num', `#${pr.number}`));
          if (isNew(pr)) { const dot = el('span', 'pr-unread-dot'); dot.title = 'Updated since last view'; line1.append(dot); }
          line1.append(el('span', 'pr-row-title', pr.title));
          const stats = el('span', 'pr-row-metrics');
          if (pr.checks) {
            const ci = el('span', `pr-ci-ico is-${pr.checks}`);
            ci.append(prIconSvg(pr.checks === 'passing' ? 'check' : pr.checks === 'failing' ? 'fail' : 'running', 13));
            ci.title = `Checks ${pr.checks}`;
            stats.append(ci);
          }
          if (pr.review) {
            const rv = el('span', `pr-rev-ico is-${pr.review.replaceAll(' ', '-')}`);
            rv.append(prIconSvg('reviewer', 13));
            rv.title = pr.review;
            stats.append(rv);
          }
          if (pr.additions != null || pr.deletions != null) {
            stats.append(el('span', 'pr-stat-add', `+${Number(pr.additions || 0).toLocaleString()}`), el('span', 'pr-stat-del', `-${Number(pr.deletions || 0).toLocaleString()}`));
          }
          line1.append(stats);

          const line2 = el('div', 'pr-row-sub');
          const leftMeta = el('span', 'pr-row-origin');
          if (pr.author) leftMeta.append(el('span', 'pr-row-author', pr.author));
          leftMeta.append(el('span', 'pr-row-repo', pr.repo));
          if (pr.source === 'neutrino') leftMeta.append(el('span', 'pr-source-badge', 'Neutrino'));
          line2.append(leftMeta);
          const labels = (pr.labels || []).slice(0, 2);
          if (pr.draft) line2.append(el('span', 'pr-label pr-label-draft', 'draft'));
          for (const lbl of labels) line2.append(labelBadge(lbl));
          if ((pr.labels?.length || 0) > 2) line2.append(el('span', 'pr-label', `+${pr.labels!.length - 2}`));
          line2.append(el('span', 'pr-row-time', pr.updated ? prAge(pr.updated) : ''));

          row.append(line1, line2);
          row.onclick = () => {
            if (prUi.selectedKey !== key) prUi.detailTab = 'summary';
            prUi.selectedKey = key;
            prUi.detailOpen = true;
            split.classList.add('has-detail');
            for (const btn of listScroll.querySelectorAll<HTMLElement>('.pr-row')) btn.classList.toggle('is-selected', btn.dataset.prKey === key);
            void fetchDetail(pr);
            renderDetail();
          };
          listScroll.append(row);
        }
      }
      if (!renderedAny) listScroll.append(el('p', 'pr-group-empty', prUi.query.trim() ? 'No pull requests match your search.' : 'No open pull requests here.'));
    };

    const renderDetail = (): void => {
      detailPane.replaceChildren();
      const pr = flatAll.find(p => prKeyOf(p) === prUi.selectedKey) || null;
      if (!pr) {
        detailPane.append(el('div', 'pr-detail-empty', 'Select a pull request on the left to inspect its summary, timeline, and code changes.'));
        return;
      }
      const key = prKeyOf(pr);
      const entry = prUi.details.get(key);
      const d = entry?.data || null;

      // Top bar with mobile back button + #num chip + Ask Fairy / Open PR CTA.
      const bar = el('div', 'pr-detail-bar');
      const barLeft = el('div', 'pr-detail-bar-left');
      const backBtn = el('button', 'pr-back-btn');
      backBtn.type = 'button';
      backBtn.append(prIconSvg('back', 14), el('span', '', 'Pull requests'));
      backBtn.onclick = () => { prUi.detailOpen = false; split.classList.remove('has-detail'); };
      const tabChip = el('span', 'pr-detail-chip');
      const ico = el('span', `pr-state-ico${pr.source === 'neutrino' ? ' is-neutrino' : pr.draft ? ' is-draft' : ''}`);
      ico.append(prIconSvg('pr', 13));
      tabChip.append(ico, el('span', '', `#${pr.number}`));
      barLeft.append(backBtn, tabChip);
      bar.append(barLeft);

      const barRight = el('div', 'pr-detail-actions');
      if (draft) {
        const askBtn = button('panel-button quiet git-tool git-ask', 'Ask Fairy', () => draft(question(pr, pr.bucket)), 'Draft a question about this pull request');
        barRight.append(askBtn);
      }
      if (pr.source === 'neutrino') {
        barRight.append(button('panel-button primary git-tool pr-open-btn', 'Open in Neutrino', () => { tab = 'neutrino'; neutrino.openPr(pr.repo, pr.number); context.redraw(); }));
      } else {
        const ghBtn = el('a', 'pr-open-btn');
        ghBtn.href = d?.url || pr.url || '#';
        ghBtn.append(prIconSvg('ext', 13), el('span', '', 'Open on GitHub'));
        ghBtn.onclick = e => { e.preventDefault(); const url = d?.url || pr.url; if (url) openLink(url); };
        barRight.append(ghBtn);
      }
      bar.append(barRight);
      detailPane.append(bar);

      const scroll = el('div', 'pr-detail-scroll');
      const repoRow = el('a', 'pr-detail-repo');
      repoRow.href = d?.url || pr.url || '#';
      repoRow.append(el('span', '', `${pr.repo} #${pr.number}`), prIconSvg('ext', 12));
      repoRow.onclick = e => { e.preventDefault(); if (pr.source === 'neutrino') { tab = 'neutrino'; neutrino.openPr(pr.repo, pr.number); context.redraw(); } else { const url = d?.url || pr.url; if (url) openLink(url); } };
      scroll.append(repoRow);

      scroll.append(el('h3', 'pr-detail-title', d?.title || pr.title));

      const byLine = el('div', 'pr-detail-byline');
      if (pr.source === 'neutrino') byLine.append(el('span', 'pr-source-badge', 'Neutrino'));
      if (d?.author || pr.author) byLine.append(el('strong', '', d?.author || pr.author));
      if (pr.updated || d?.updatedAt) byLine.append(el('span', '', `updated ${prAge((d?.updatedAt || pr.updated) ?? '')}`));
      if (d?.changes?.additions != null || pr.additions != null) {
        const add = d?.changes?.additions ?? pr.additions ?? 0, del = d?.changes?.deletions ?? pr.deletions ?? 0;
        byLine.append(el('span', 'pr-stat-add', `+${add.toLocaleString()}`), el('span', 'pr-stat-del', `-${del.toLocaleString()}`));
      }
      scroll.append(byLine);

      const baseRef = d?.base || pr.base, headRef = d?.head || pr.head;
      if (baseRef || headRef) {
        const branches = el('div', 'pr-detail-branches');
        if (baseRef) branches.append(el('span', 'pr-branch-pill pr-branch-base', baseRef));
        if (d?.mergeable === 'CONFLICTING') { const w = el('span', 'pr-merge-warn'); w.append(prIconSvg('warn', 13)); w.title = 'Has merge conflicts'; branches.append(w); }
        if (baseRef && headRef) branches.append(prIconSvg('branch', 13));
        if (headRef) branches.append(el('span', 'pr-branch-pill pr-branch-head', headRef));
        scroll.append(branches);
      }

      const subTabs = el('div', 'pr-subtabs');
      const totalComments = pr.source === 'neutrino'
        ? (d?.notes?.length || 0)
        : (d?.reviews?.length || 0) + (d?.conversation?.length || 0) + (d?.reviewComments?.length || 0);
      const totalFiles = d?.files?.length ?? d?.changes?.files ?? 0;
      for (const [id, lbl, count] of [
        ['summary', 'Summary', 0],
        ['timeline', 'Timeline', totalComments],
        ['code', 'Code', totalFiles],
      ] as Array<[PrDetailTab, string, number]>) {
        const btn = el('button', `pr-subtab${prUi.detailTab === id ? ' is-active' : ''}`);
        btn.type = 'button';
        btn.append(el('span', '', lbl));
        if (count) btn.append(el('span', 'pr-subtab-count', String(count)));
        btn.onclick = () => { prUi.detailTab = id; renderDetail(); };
        subTabs.append(btn);
      }
      scroll.append(subTabs);

      const bodyWrap = el('div', 'pr-detail-body');
      if (entry?.loading && !d) bodyWrap.append(el('p', 'panel-note busy', 'Loading pull request details…'));
      else if (entry?.error) bodyWrap.append(el('p', 'pane-empty', entry.error));

      if (prUi.detailTab === 'timeline' && d) {
        if (pr.source === 'neutrino') {
          const notes = d.notes || [];
          if (!notes.length) bodyWrap.append(el('p', 'pr-group-empty', 'No review notes yet.'));
          for (const n of notes) {
            const card = el('div', 'pr-timeline-item');
            const top = el('div', 'pr-timeline-head');
            const ref = el('span', 'pr-label pr-note-loc');
            ref.append(prIconSvg('file', 11), el('span', '', `${n.path}:${n.currentLine ?? n.line}`));
            top.append(ref, el('span', `git-chip ${n.resolved ? 'passing' : 'running'}`, n.resolved ? 'resolved' : 'open'));
            card.append(top);
            if (n.text?.trim()) card.append(renderPrBody(n.text));
            bodyWrap.append(card);
          }
        } else {
          interface TimelineItem {
            kind: 'review' | 'comment' | 'inline';
            at?: string;
            author?: string;
            state?: string;
            path?: string;
            line?: number | null;
            body?: string;
          }
          const items: TimelineItem[] = [
            ...(d.reviews || []).map((r): TimelineItem => ({ kind: 'review', at: r.at, author: r.author, state: r.state, body: r.body })),
            ...(d.conversation || []).map((c): TimelineItem => ({ kind: 'comment', at: c.at, author: c.author, body: c.body })),
            ...(d.reviewComments || []).map((c): TimelineItem => ({ kind: 'inline', at: c.at, author: c.author, path: c.path, line: c.line, body: c.body })),
          ].sort((a, b) => Date.parse(String(a.at || 0)) - Date.parse(String(b.at || 0)));
          if (!items.length) bodyWrap.append(el('p', 'pr-group-empty', 'No reviews or comments yet.'));
          for (const it of items) {
            const card = el('div', 'pr-timeline-item');
            const top = el('div', 'pr-timeline-head');
            top.append(el('strong', '', it.author || 'Someone'));
            if (it.kind === 'review' && it.state) top.append(el('span', `git-chip ${it.state.toLowerCase().replaceAll('_', '-')}`, it.state.toLowerCase().replaceAll('_', ' ')));
            else if (it.kind === 'inline' && it.path) top.append(el('span', 'pr-label', `${it.path}${it.line ? `:${it.line}` : ''}`));
            if (it.at) top.append(el('span', 'pr-row-time', prAge(it.at)));
            card.append(top);
            if (it.body?.trim()) card.append(renderPrBody(it.body));
            bodyWrap.append(card);
          }
        }
      } else if (prUi.detailTab === 'code' && d) {
        const files: GitCommitFile[] = (d.files || []).map(f => ({ path: f.path, added: f.additions, removed: f.deletions }));
        if (!files.length) bodyWrap.append(el('p', 'pr-group-empty', 'No changed files reported.'));
        else {
          const diffFetcher = pr.source === 'neutrino' ? api!.neutrinoPrDiff : api!.githubPrDiff;
          bodyWrap.append(fileList(files, async file => {
            if (entry?.diffs?.has(file.path)) return entry.diffs.get(file.path);
            if (!diffFetcher) throw new Error('Diff viewer is unavailable here.');
            const res = await diffFetcher(pr.repo, pr.number, file.path);
            const txt = typeof res === 'string' ? res : (res?.text ?? '');
            entry?.diffs?.set(file.path, txt);
            return txt;
          }));
        }
      } else {
        const metaRows: Array<[string, () => HTMLElement, PrIconKind]> = [];
        if (d?.mergeability || d?.mergeable === 'CONFLICTING') {
          metaRows.push(['Status', () => {
            const v = el('div', 'pr-meta-vals');
            const m = d.mergeability;
            if (m) {
              v.append(el('span', `git-chip ${m.clean ? 'passing' : 'failing'}`, m.clean ? 'Merges cleanly' : `Conflicts${m.conflicts?.length ? `: ${m.conflicts.slice(0, 2).join(', ')}` : ''}`));
              if (m.behind) v.append(el('span', 'git-chip running', `${m.behind} behind ${baseRef || 'base'}`));
            } else {
              v.append(el('span', 'git-chip failing', 'Merge conflicts'));
            }
            return v;
          }, d?.mergeable === 'CONFLICTING' ? 'warn' : 'pr']);
        }
        const reviewers = [...new Set([...(d?.reviewers || []), ...(d?.reviews || []).map(r => r.author).filter((a): a is string => Boolean(a))])];
        const labels: Array<string | PrLabel> = d?.labels?.length ? d.labels : (pr.labels || []);
        if (reviewers.length || pr.review) metaRows.push(['Reviewers', () => {
          const v = el('div', 'pr-meta-vals');
          if (pr.review) v.append(el('span', `git-chip ${pr.review.replaceAll(' ', '-')}`, pr.review));
          for (const r of reviewers.slice(0, 6)) v.append(el('span', 'pr-label', r));
          return v;
        }, 'users']);
        if (labels.length) metaRows.push(['Labels', () => {
          const v = el('div', 'pr-meta-vals');
          for (const lbl of labels) v.append(labelBadge(lbl));
          return v;
        }, 'tag']);
        if (d?.checksList?.length || d?.checks || pr.checks) metaRows.push(['Checks', () => {
          const v = el('div', 'pr-meta-vals');
          if (d?.checksList?.length) {
            for (const c of d.checksList) {
              const norm = normalizeCheckState(c.state);
              v.append(el('span', `git-chip ${norm}`, `${c.name || c.workflow}: ${c.state}`));
            }
          } else if (d?.checks) {
            const { passed, failed, pending } = d.checks;
            if (passed) v.append(el('span', 'git-chip passing', `${passed} passed`));
            if (failed) v.append(el('span', 'git-chip failing', `${failed} failed`));
            if (pending) v.append(el('span', 'git-chip running', `${pending} pending`));
          } else v.append(el('span', `git-chip ${pr.checks}`, pr.checks));
          return v;
        }, pr.checks === 'failing' ? 'fail' : 'check']);
        if (totalFiles || d?.changes?.additions != null || pr.additions != null) {
          metaRows.push(['Changes', () => {
            const v = el('div', 'pr-meta-vals');
            if (totalFiles) v.append(el('span', 'pr-label', `${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`));
            const add = d?.changes?.additions ?? pr.additions, del = d?.changes?.deletions ?? pr.deletions;
            if (add != null || del != null) v.append(el('span', 'pr-stat-add', `+${Number(add || 0).toLocaleString()}`), el('span', 'pr-stat-del', `-${Number(del || 0).toLocaleString()}`));
            return v;
          }, 'file']);
        }
        if (metaRows.length) {
          const metaGrid = el('div', 'pr-meta-grid');
          for (const [labelText, buildVal, iconName] of metaRows) {
            const k = el('div', 'pr-meta-key'); k.append(prIconSvg(iconName, 13), el('span', '', labelText));
            metaGrid.append(k, buildVal());
          }
          bodyWrap.append(metaGrid);
        }
        if (d || (!entry?.loading && !entry?.error)) {
          const descCard = el('div', 'pr-desc-card');
          descCard.append(el('div', 'pr-desc-head', 'Description'));
          if (d) descCard.append(renderPrBody(d.body));
          else if (entry?.unsupported) descCard.append(el('p', 'pr-md-empty', pr.source === 'neutrino' ? 'Open in Neutrino to review its description and diffs.' : ''));
          else descCard.append(el('p', 'pr-md-empty', 'No description available yet.'));
          bodyWrap.append(descCard);
        }
      }

      scroll.append(bodyWrap);
      detailPane.append(scroll);
    };

    searchInput.oninput = () => {
      prUi.query = searchInput.value;
      clearBtn.hidden = !prUi.query;
      renderList();
    };
    sortBtn.onclick = () => { prUi.sort = prUi.sort === 'updated' ? 'changes' : 'updated'; syncSortLabel(); renderList(); };

    renderList();
    const initialPr = flatAll.find(p => prKeyOf(p) === prUi.selectedKey) || null;
    if (initialPr) void fetchDetail(initialPr);
    renderDetail();

    split.append(listPane, detailPane);
    root.append(split);
  }

  // Branches and stashes: switch, make or delete a branch, check one out from GitHub, stash changes and bring them back,
  // fetch and pull. Each change asks first, and none runs the repository's hooks. A chat on its own branch stays on it.
  async function branchesView(root: HTMLElement, context: PaneContext): Promise<void> {
    const repoState = local;
    if (!repoState) return;
    const act = async (action: string, value: string | undefined, askText: string | null, said: string | ((done: GitActResult) => string)): Promise<void> => {
      if (askText && !confirm(askText)) return;
      const done = await guard(() => api!.gitAct(action, value));
      if (!done) return;
      repoState.note = typeof said === 'function' ? said(done) : said; repoState.commits = []; repoState.more = false; context.redraw();
    };
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { repoState.view = null; context.redraw(); }, 'Back to the history'), el('h2', '', 'Branches and stashes'));
    head.append(button('panel-button quiet git-tool', 'Fetch', () => act('fetch', undefined, null, 'Fetched what’s new from GitHub. Your files are as they were.'), 'Gets what’s new on GitHub without changing your files'));
    root.append(head);
    if (repoState.note) { root.append(el('p', 'page-note git-done', repoState.note)); repoState.note = ''; }
    const b = await guard(() => api!.gitBranches());
    if (!b) return;
    const own = work()?.branch, changed = repoState.overview?.changed || 0;
    const mine = b.local.find(x => x.current), behind = /behind (\d+)/.exec(mine?.track || '')?.[1];
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    // Where you are, and a new branch from here.
    const here = el('div', 'git-cards');
    here.append(card('On', b.current || 'No branch', mine?.upstream ? `${mine.upstream}${mine.track ? ` · ${mine.track}` : ' · up to date'}` : 'not tracking GitHub'));
    root.append(here);
    if (own) root.append(el('p', 'panel-note', `This chat works on its own branch, ${own}, so it stays on it. You can still stash, fetch and tidy up other branches.`));
    const tools = el('div', 'git-actions');
    if (!own && behind) tools.append(button('panel-button git-tool', `Pull ${plural(Number(behind), 'commit')}`, () => act('pull', undefined, `Pull ${plural(Number(behind), 'commit')} from ${mine?.upstream} into ${b.current}? Fairy only pulls when it’s a fast-forward; otherwise nothing changes.`, done => `Pulled ${plural(done.commits ?? 0, 'commit')} into ${done.branch}.`)));
    if (!own) {
      const name = el('input', 'git-filter git-new-branch'); name.placeholder = 'New branch name'; name.setAttribute('aria-label', 'New branch name'); name.spellcheck = false;
      const make = button('panel-button git-tool', 'Make branch', () => { const value = name.value.trim(); if (value) void act('create', value, `Make a branch called ${value} from ${b.current || 'here'} and switch to it?${changed ? ' Your uncommitted changes come along.' : ''}`, done => `Made ${done.branch} and switched to it.`); });
      name.onkeydown = event => { if (event.key === 'Enter') make.click(); };
      tools.append(name, make);
    }
    if (tools.childElementCount) root.append(tools);
    // Your branches.
    const table = (heads: string[], rows: HTMLTableRowElement[]): HTMLTableElement => { const t = el('table', 'git-grid git-branches'), tr = el('tr'); for (const h of heads) tr.append(el('th', '', h)); const th = el('thead'); th.append(tr); const tb = el('tbody'); for (const r of rows) tb.append(r); t.append(th, tb); return t; };
    const cell = (cls: string, text: string | null | undefined, title?: string): HTMLTableCellElement => { const td = el('td', cls, text); if (title) td.title = title; return td; };
    const small = (label: string, run: () => unknown, title?: string): HTMLButtonElement => button('panel-button quiet git-tool', label, event => { event.stopPropagation(); run(); }, title);
    root.append(el('h3', 'git-section', `Your branches (${b.local.length})`));
    root.append(table(['Branch', 'Last commit', 'Updated', 'GitHub', ''], b.local.map(x => {
      const tr = el('tr', `git-row${x.current ? ' current' : ''}`), name = el('td', 'git-repo-name');
      name.append(el('span', '', x.name)); if (x.current) name.append(el('span', 'git-ref head', 'current')); name.title = x.name;
      const acts = el('td', 'git-row-actions');
      if (!x.current) {
        if (!own) acts.append(small('Switch', () => act('switch', x.name, `Switch to ${x.name}?${changed ? ` Your ${plural(changed, 'uncommitted change')} come along, unless they clash with it; then nothing changes.` : ''}`, done => `Switched to ${done.branch}.`)));
        if (b.current) { const currentBranch = b.current; acts.append(small('Compare', () => { repoState.view = null; repoState.compare = { base: currentBranch, head: x.name, threeDot: true, baseLabel: currentBranch, headLabel: x.name, result: null }; context.redraw(); }, `What ${x.name} adds since it left ${currentBranch}`)); }
        acts.append(small('Delete', () => act('delete', x.name, `Delete the branch ${x.name}? ${x.merged ? `Its work is already in ${b.current}.` : 'It’s only deleted if its work is merged somewhere; otherwise it’s kept.'}`, done => `Deleted ${done.branch}.`)));
      }
      tr.append(name, cell('git-subject', x.subject, x.subject), cell('git-when', relativeTime(x.date)), cell('git-vis', x.upstream ? (x.track || 'up to date') : '—', x.upstream || 'Not on GitHub'), acts);
      return tr;
    })));
    // On GitHub but not here yet.
    const theirs = b.remote.filter(x => !x.local);
    if (theirs.length) {
      root.append(el('h3', 'git-section', `On GitHub only (${theirs.length})`));
      root.append(table(['Branch', 'Last commit', 'Updated', '', ''], theirs.map(x => {
        const tr = el('tr', 'git-row'), acts = el('td', 'git-row-actions');
        if (!own) acts.append(small('Check out', () => act('checkout', x.name, `Check out ${x.name} as a branch of your own and switch to it?`, done => `Checked out ${done.branch}, tracking ${x.name}.`)));
        tr.append(cell('git-repo-name', x.name, x.name), cell('git-subject', x.subject, x.subject), cell('git-when', relativeTime(x.date)), cell('', ''), acts);
        return tr;
      })));
    }
    // Stashes: changes set aside, and brought back.
    root.append(el('h3', 'git-section', `Stashes (${b.stashes.length})`));
    const stash = el('div', 'git-actions');
    const message = el('input', 'git-filter'); message.placeholder = changed ? 'What these changes are (optional)' : 'Nothing to stash'; message.disabled = !changed; message.setAttribute('aria-label', 'Stash message');
    const put = button('panel-button git-tool', changed ? `Stash ${plural(changed, 'change')}` : 'Stash changes', () => act('stash', message.value.trim(), `Set aside your ${plural(changed, 'uncommitted change')}, new files included, so the folder matches the last commit? You can bring them back from here.`, 'Stashed your changes. The folder now matches the last commit.'));
    put.disabled = !changed; stash.append(message, put); root.append(stash);
    if (b.stashes.length) root.append(table(['Stash', 'Message', 'When', '', ''], b.stashes.map(x => {
      const tr = el('tr', 'git-row'), acts = el('td', 'git-row-actions');
      acts.append(small('Apply', () => act('apply', x.ref, `Bring back the changes in ${x.ref} (“${x.message}”) and keep the stash?`, `Applied ${x.ref}; it’s still kept.`)),
        small('Apply and drop', () => act('pop', x.ref, `Bring back the changes in ${x.ref} (“${x.message}”) and then drop it?`, `Applied and dropped ${x.ref}.`)),
        small('Drop', () => act('drop', x.ref, `Drop ${x.ref} (“${x.message}”)? Its changes are gone for good.`, `Dropped ${x.ref}.`)));
      tr.append(cell('git-sha', x.ref), cell('git-subject', x.message, x.message), cell('git-when', relativeTime(x.date)), cell('', ''), acts);
      return tr;
    })));
  }

  async function yourRepos(root: HTMLElement, context: PaneContext): Promise<void> {
    if (opened) return oneRepo(root, context);
    if (!repos) repos = await guard(() => api!.githubRepos({ limit: 60 }));
    if (!repos) { root.append(el('p', 'pane-empty', 'Sign in to GitHub with gh auth login to see your repositories.')); return; }
    // Your year on GitHub: every contribution by day, and where your commits went.
    if (!activity) activity = await guard(() => api!.githubActivity());
    if (activity?.days.length) {
      root.append(el('h2', 'git-title', 'Your activity'));
      const block = el('div', 'git-activity');
      block.append(el('p', 'panel-note', activityLine(activity.days, activity.total, 'contribution')), heatmap(activity.days, { unit: 'contribution', label: `${activity.login || 'Your'} contributions on GitHub by day, over the last year` }));
      if (activity.repos.length) {
        const most = el('div', 'git-most'); most.append(el('span', 'git-card-label', 'Most commits'));
        for (const r of activity.repos) { const chip = button('git-ref git-most-repo', `${r.name.split('/').pop()} · ${r.commits.toLocaleString('en-AU')}`, () => { opened = r.name; remote = null; context.redraw(); }, r.name); most.append(chip); }
        block.append(most);
      }
      root.append(block);
    }
    const reposHead = el('div', 'git-head');
    reposHead.append(el('h2', '', 'Your repositories'));
    if (openNeutrinoPage) reposHead.append(expandButton(() => openNeutrinoPage({ kind: 'home', tab: 'repos' }), 'Open full Neutrino repositories page'));
    root.append(reposHead);
    const table = el('table', 'git-grid git-repos'), head = el('tr');
    for (const name of ['Repository', 'Description', '', 'Updated']) head.append(el('th', '', name));
    const thead = el('thead'); thead.append(head);
    const body = el('tbody');
    for (const repo of repos.repos) {
      const tr = el('tr', 'git-row opens'); tr.tabIndex = 0;
      tr.append(el('td', 'git-repo-name', repo.nameWithOwner), el('td', 'git-subject', repo.description || ''), el('td', 'git-vis', [repo.visibility === 'PRIVATE' ? 'private' : 'public', repo.isFork ? 'fork' : '', repo.isArchived ? 'archived' : ''].filter(Boolean).join(' · ')), el('td', 'git-when', relativeTime(repo.updatedAt)));
      const open = (): void => { opened = repo.nameWithOwner; remote = null; context.redraw(); };
      tr.onclick = open; tr.onkeydown = event => { if (event.key === 'Enter') open(); };
      body.append(tr);
    }
    table.append(thead, body);
    root.append(table);
  }

  async function oneRepo(root: HTMLElement, context: PaneContext): Promise<void> {
    const repoName = opened;
    if (!repoName) return;
    if (!remote || remote.name !== repoName) remote = { name: repoName, overview: null, commits: [], more: false, page: 1 };
    const repoState = remote;
    const [overview, list] = await Promise.all([repoState.overview ? null : guard(() => api!.githubRepo(repoName)), repoState.commits.length ? null : guard(() => api!.githubCommits(repoName, { limit: 50 }))]);
    if (overview) repoState.overview = overview;
    if (list) { repoState.commits = list.commits; repoState.more = list.more; }
    const head = el('div', 'git-head');
    head.append(button('page-back', '‹', () => { opened = null; context.redraw(); }, 'Your repositories'), el('h2', '', repoName));
    if (repoState.overview?.url) { const repoUrl = repoState.overview.url; head.append(link('On GitHub', repoUrl)); }
    if (openNeutrinoPage) head.append(expandButton(() => openNeutrinoPage({ kind: 'repo', repo: repoName }), `Open ${repoName} in full Neutrino page`));
    root.append(head);
    // Clone it into a folder you pick and start a work session there; a clone already in that place just opens.
    if (openWork) {
      const clone = button('panel-button git-tool git-clone', 'Clone and work on it', async () => {
        clone.disabled = true; clone.textContent = 'Cloning…';
        const next = await guard(() => api!.githubClone(repoName));
        if (!clone.isConnected) return;
        clone.disabled = false; clone.textContent = 'Clone and work on it';
        if (!next) return;
        const where = next.clone?.folder;
        tab = 'repo'; opened = null;
        openWork(next, where ? `${next.clone?.cloned ? 'Cloned into' : 'Opened your clone in'} ${where}` : '');
      }, 'Choose a folder; Fairy clones it there with gh and starts a work session in it');
      const row = el('div', 'git-actions'); row.append(clone); root.append(row);
    }
    const o = repoState.overview;
    if (o) {
      if (o.description) root.append(el('p', 'panel-note', o.description));
      const cards = el('div', 'git-cards');
      cards.append(card('Default branch', o.branch || '—', o.visibility ? o.visibility.toLowerCase() : ''));
      const prs = card('Pull requests', o.openPrs == null ? '—' : `${o.openPrs} open`); prs.classList.add('opens'); prs.onclick = () => openLink(`${o.url}/pulls`);
      const issues = card('Issues', o.openIssues == null ? '—' : `${o.openIssues} open`); issues.classList.add('opens'); issues.onclick = () => openLink(`${o.url}/issues`);
      cards.append(prs, issues, card('Last push', relativeTime(o.pushed) || '—', [o.language, o.stars ? `★ ${o.stars}` : ''].filter(Boolean).join(' · ')));
      root.append(cards);
    }
    root.append(el('h3', 'git-section', `History${o?.branch ? ` on ${o.branch}` : ''}`));
    root.append(repoState.commits.length ? grid(repoState.commits, { urlOf: commit => commit.url ?? '', detail: sha => api!.githubCommit(repoName, sha), fileDiff: (_sha, file) => file.patch ?? null }) : el('p', 'panel-note', 'No commits.'));
    if (repoState.more) root.append(button('panel-button quiet git-more', 'Show older commits', async () => {
      const older = await guard(() => api!.githubCommits(repoName, { limit: 50, page: repoState.page + 1 }));
      if (older) { repoState.page++; repoState.commits.push(...older.commits); repoState.more = older.more; context.redraw(); }
    }));
  }

  const neutrino: NeutrinoSectionController = neutrinoSection({
    api: api as GitPaneApi, el, button, card, grid, fileList, guard, relativeTime, draft, expandButton, openNeutrinoPage,
    openWork: openWork ? (next, said) => { tab = 'repo'; opened = null; neutrino.reset(); openWork(next, said); } : null,
  });

  return {
    id: 'git', title: 'Git', wide: () => true,
    // From Files or Changes: this file's history, in This repo.
    showHistory(path) { wanted = { path }; tab = 'repo'; opened = null; },
    showNeutrino(repo = '', pr = null) { tab = 'neutrino'; opened = null; if (repo && pr) neutrino.openPr(repo, pr); else if (repo) neutrino.openRepo(repo); else neutrino.reset(); },
    reset() { opened = null; neutrino.reset(); if (local) { local.compare = null; local.picking = false; local.picked = []; local.view = null; } },
    async render(body, context) {
      if (!api) { body.replaceChildren(el('p', 'pane-empty', 'Git is available in the desktop app.')); return; }
      const root = el('div', 'git-pane panel-stack');
      root.append(tabs(context));
      body.replaceChildren(root);
      const holder = el('div', 'git-body'); holder.append(el('p', 'panel-note busy', 'Reading…'));
      root.append(holder);
      const content = el('div', 'git-content');
      if (tab === 'neutrino') await neutrino.render(content, context);
      else if (tab === 'repos') await yourRepos(content, context);
      else if (tab === 'prs') await pullRequests(content, context);
      else await thisRepo(content, context);
      holder.replaceWith(content);
    },
  };
}
