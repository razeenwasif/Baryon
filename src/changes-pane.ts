import { fileIconElement, languageForPath } from './file-icons.js';
import { highlightCode } from './reply-renderer.js';
import { acquireDiffWorkerPool, releaseDiffWorkerPool } from './diff-worker-pool.js';
import { renderWalkthroughBar } from './diff-walkthrough.js';
import type { WalkthroughStop, WalkthroughTour } from './diff-walkthrough.js';
import type { PaneContext, SidePaneDefinition } from './side-pane.js';

export interface DiffAnnotationPayload {
  path: string;
  line: number;
  side: 'old' | 'new';
  snippet: string;
  comment: string;
}

export interface RenderDiffOptions {
  onAnnotate?: ((comment: DiffAnnotationPayload) => void) | null;
  highlightLines?: unknown[] | null;
}

export interface GitStatusFile {
  path: string;
  kind: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  repo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  origin: boolean;
  upstream: boolean;
  truncated?: boolean;
  files: GitStatusFile[];
}

export interface GitMergeInfo {
  gone?: boolean;
  detached?: boolean;
  branch: string;
  into: string;
  commits: number;
  uncommitted: number;
  folder: string;
}

export interface GitMergeResult {
  commits: number;
  into: string;
  hash: string;
}

export interface GitPrChecks {
  passed: number;
  failed: number;
  pending: number;
}

export interface GitPrInfo {
  number: number;
  state: string;
  draft?: boolean;
  review: string;
  title: string;
  checks: GitPrChecks;
  neutrino?: boolean;
  repo: string;
  url?: string;
}

export interface GitPrStatus {
  available: boolean;
  reason?: string;
  pr: GitPrInfo | null;
  loading?: boolean;
}

export interface WorkCheckpoint {
  ref: string;
  turnId: string;
}

export interface WorkCheckpointForkResult {
  branch?: string;
}

export interface ChangesWorkState {
  branch?: string;
  [key: string]: unknown;
}

export interface ChangesPaneApi {
  gitStatus: () => Promise<GitStatus | null>;
  gitDiff: (path: string, options?: { staged?: boolean; untracked?: boolean }) => Promise<string | null>;
  gitStage: (path: string) => Promise<unknown>;
  gitUnstage: (path: string) => Promise<unknown>;
  gitCommit: (message: string) => Promise<string | null>;
  gitMergeInfo: () => Promise<GitMergeInfo | null>;
  gitMerge: () => Promise<GitMergeResult | null>;
  gitPrStatus: () => Promise<GitPrStatus>;
  gitPush: () => Promise<string | null>;
  gitOpenPr: () => Promise<string | null>;
  gitWalkthrough?: () => Promise<WalkthroughTour | null>;
  workCheckpointList?: () => Promise<WorkCheckpoint[]>;
  workCheckpointDiff?: (options: { fromRef: string; toRef: string }) => Promise<string | null>;
  workCheckpointFork?: (options: { ref: string; newBranch: string }) => Promise<WorkCheckpointForkResult | null>;
}

export interface ChangesPaneOptions {
  api: ChangesPaneApi;
  work: () => ChangesWorkState | null | undefined;
  onError: (message: string) => void;
  onReview?: () => void;
  openLink?: (url: string) => void;
  onHistory?: ((path: string) => void) | null;
  onOpenNeutrino?: ((repo: string, number: number) => void) | null;
  onAnnotate?: ((comment: DiffAnnotationPayload) => void) | null;
  onAskStop?: ((stop: WalkthroughStop) => void) | null;
}

interface ViewingDiffState {
  path: string;
  staged: boolean;
  untracked: boolean;
  name: string;
  scrollToLine?: number;
}

interface PullCacheEntry {
  found: GitPrStatus;
  at: number;
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (
  label: string,
  run: (ev: MouseEvent) => unknown,
  className = 'page-link',
): HTMLButtonElement => {
  const node = element('button', className, label);
  node.type = 'button';
  node.onclick = run;
  return node;
};

export function renderDiff(
  text: string,
  filePath = '',
  { onAnnotate = null, highlightLines = null }: RenderDiffOptions = {},
): HTMLPreElement {
  const view = element('pre', 'work-diff changes-diff');
  let lang = languageForPath(filePath);
  let currentPath = filePath || '';
  let oldLine = 0;
  let newLine = 0;
  const asyncQueue: Array<{ el: HTMLSpanElement; code: string; lang: string }> = [];

  for (const line of String(text).split('\n')) {
    const header = /^(?:\+\+\+ b\/|diff --git a\/.+ b\/)(.+)$/.exec(line);
    if (header) {
      currentPath = header[1];
      lang = languageForPath(currentPath) || lang;
    }
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
    }
    const kind = /^(?:diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)
      ? 'meta'
      : line.startsWith('@@')
        ? 'hunk'
        : line.startsWith('+')
          ? 'add'
          : line.startsWith('-')
            ? 'del'
            : '';

    const isCodeLine = kind === 'add' || kind === 'del' || (kind === '' && line.startsWith(' '));
    let lineNum = 0;
    let side: 'old' | 'new' = 'new';
    if (isCodeLine && (oldLine || newLine)) {
      if (kind === 'del') {
        lineNum = oldLine++;
        side = 'old';
      } else if (kind === 'add') {
        lineNum = newLine++;
        side = 'new';
      } else {
        lineNum = newLine;
        oldLine++;
        newLine++;
        side = 'new';
      }
    }

    if (lang && isCodeLine) {
      const row = element('span', `diff-line ${kind}`.trim());
      if (lineNum) row.dataset.line = String(lineNum);
      if (lineNum) row.append(element('span', 'diff-ln', String(lineNum)));
      if (onAnnotate && lineNum) {
        const addBtn = element('button', 'diff-add-comment', '+');
        addBtn.type = 'button';
        addBtn.title = 'Add review comment to composer';
        addBtn.setAttribute('aria-label', `Comment on line ${lineNum}`);
        const commentLine = lineNum;
        const commentSide = side;
        const commentPath = currentPath || filePath;
        addBtn.onclick = ev => {
          ev.stopPropagation();
          const existing = row.nextElementSibling;
          if (existing?.classList?.contains('diff-inline-comment')) {
            existing.remove();
            return;
          }
          const form = element('div', 'diff-inline-comment');
          const box = document.createElement('textarea');
          box.rows = 2;
          box.placeholder = `Comment on ${commentPath}:${commentLine}…`;
          const actions = element('div', 'diff-inline-comment-actions');
          const cancel = button('Cancel', () => form.remove(), 'wt-btn');
          const save = button('Add to message', () => {
            const val = box.value.trim();
            if (!val) { box.focus(); return; }
            onAnnotate({ path: commentPath, line: commentLine, side: commentSide, snippet: line, comment: val });
            form.remove();
          }, 'wt-btn primary');
          actions.append(cancel, save);
          form.append(box, actions);
          row.after(form);
          box.focus();
        };
        row.append(addBtn);
      }
      const sign = element('span', 'diff-sign', line.slice(0, 1));
      const code = element('span', 'diff-code');
      const rawCode = line.slice(1);
      if (Array.isArray(highlightLines) && highlightLines.length > 0) {
        code.textContent = rawCode;
        asyncQueue.push({ el: code, code: rawCode, lang });
      } else {
        code.innerHTML = highlightCode(rawCode, lang).html;
      }
      row.append(sign, code, '\n');
      view.append(row);
    } else {
      view.append(element('span', kind, `${line}\n`));
    }
  }
  return view;
}

/**
 * Enhances a rendered diff view asynchronously via the ref-counted Diff Worker Pool for large patches.
 */
async function highlightLargeDiff(
  view: HTMLElement,
  text: string,
  filePath: string,
  onDone: () => void = () => {},
): Promise<void> {
  const rows = [...view.querySelectorAll('.diff-line .diff-code')];
  if (rows.length < 40) return;
  const pool = acquireDiffWorkerPool();
  try {
    const items = rows.map(node => ({ code: node.textContent || '', lang: languageForPath(filePath) || '' }));
    const htmls = await pool.highlightBatch(items);
    if (!view.isConnected) return;
    rows.forEach((node, i) => {
      if (typeof htmls[i] === 'string') node.innerHTML = htmls[i];
    });
    onDone();
  } finally {
    pool.release();
  }
}

// What's changed in a work session's folder. Everything here happens only when you click it.
export function changesPane({
  api,
  work,
  onError,
  onReview = () => {},
  openLink = () => {},
  onHistory = null,
  onOpenNeutrino = null,
  onAnnotate = null,
  onAskStop = null,
}: ChangesPaneOptions): SidePaneDefinition {
  let viewing: ViewingDiffState | null = null;
  let message = '';
  let note = '';
  let pull: PullCacheEntry | null = null;
  let tour: WalkthroughTour | null = null;
  let tourIndex = 0;
  let walkthroughLoading = false;
  let checkpoints: WorkCheckpoint[] | null = null;
  let checkpointDiffText = '';
  const PULL_FRESH = 60000;
  const guard = async <T>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const pane: SidePaneDefinition = {
    id: 'changes',
    title: 'Changes',
    wide: () => Boolean(viewing),
    reset() {
      viewing = null; note = ''; pull = null; tour = null; tourIndex = 0; checkpoints = null; checkpointDiffText = '';
    },
    async render(body: HTMLElement, context: PaneContext): Promise<void> {
      if (!work()) { body.replaceChildren(element('p', 'pane-empty', 'In a work session, what’s changed in its folder shows up here.')); return; }
      const status = await guard(() => api.gitStatus());
      if (!status) return;
      if (!status.repo) { body.replaceChildren(element('p', 'pane-empty', 'This folder isn’t a Git repository, so there’s nothing to compare.')); return; }

      const mountWalkthrough = (): HTMLDivElement | null => {
        if (!tour) return null;
        return renderWalkthroughBar({
          tour,
          index: tourIndex,
          onNavigate: (nextIdx, stop) => {
            tourIndex = nextIdx;
            if (stop?.path) {
              const matched = status.files.find(f => f.path === stop.path);
              viewing = matched
                ? { path: matched.path, staged: matched.staged, untracked: matched.untracked, name: matched.path, scrollToLine: stop.line }
                : { path: stop.path, staged: false, untracked: false, name: stop.path, scrollToLine: stop.line };
            }
            context.redraw();
          },
          onAsk: stop => onAskStop?.(stop),
          onClose: () => { tour = null; context.redraw(); },
        });
      };

      if (viewing) { await showDiff(body, context, status, mountWalkthrough()); return; }
      const head = element('div', 'changes-head');
      head.append(element('strong', '', status.branch || 'No branch'));
      if (status.ahead || status.behind) head.append(element('span', 'page-detail', [status.ahead ? `${status.ahead} ahead` : '', status.behind ? `${status.behind} behind` : ''].filter(Boolean).join(', ')));
      if (api?.gitWalkthrough) {
        const tourBtn = button(walkthroughLoading ? 'Touring…' : 'Walkthrough tour', async () => {
          if (walkthroughLoading) return;
          walkthroughLoading = true;
          context.redraw();
          try {
            tour = await guard(() => api.gitWalkthrough!());
            tourIndex = 0;
          } finally {
            walkthroughLoading = false;
            context.redraw();
          }
        });
        tourBtn.disabled = walkthroughLoading;
        head.append(tourBtn);
      }
      head.append(button('Second opinion', () => onReview()), button('Refresh', () => { pull = null; checkpoints = null; context.redraw(); }));
      const parts: Node[] = [head];
      const wtBar = mountWalkthrough();
      if (wtBar) parts.push(wtBar);
      parts.push(...await mergeBlock(context), pullBlock(status, context));

      if (api?.workCheckpointList) {
        if (checkpoints === null) checkpoints = await api.workCheckpointList().catch(() => []);
        if (Array.isArray(checkpoints) && checkpoints.length >= 2) {
          const ckBar = element('div', 'changes-checkpoints');
          ckBar.append(element('span', 'page-detail', `${checkpoints.length} turn checkpoints`));
          const latest = checkpoints[0], prev = checkpoints[1];
          ckBar.append(button(checkpointDiffText ? 'Hide last turn diff' : 'Diff last turn', async () => {
            if (checkpointDiffText) { checkpointDiffText = ''; context.redraw(); return; }
            const d = await guard(() => api.workCheckpointDiff!({ fromRef: prev.ref, toRef: latest.ref }));
            checkpointDiffText = d || 'No differences between checkpoints.';
            context.redraw();
          }, 'wt-btn'));
          if (api?.workCheckpointFork) {
            ckBar.append(button('Fork checkpoint', async () => {
              const name = `ckpt-${latest.turnId.replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'turn'}`;
              const forked = await guard(() => api.workCheckpointFork!({ ref: latest.ref, newBranch: name }));
              if (forked?.branch) note = `Created branch ${forked.branch} at checkpoint.`;
              context.redraw();
            }, 'wt-btn'));
          }
          parts.push(ckBar);
          if (checkpointDiffText) parts.push(renderDiff(checkpointDiffText, '', { onAnnotate }));
        }
      }

      if (note) parts.push(element('p', 'page-note', note));
      const row = (file: GitStatusFile, staged: boolean): HTMLDivElement => {
        const line = element('div', 'page-row');
        const open = element('button', 'page-open'); open.type = 'button';
        const label = element('span', 'page-open-file');
        label.append(fileIconElement(file.path), element('span', '', file.path));
        open.append(label, element('span', 'page-detail', file.kind)); open.title = file.path;
        open.onclick = () => { viewing = { path: file.path, staged, untracked: file.untracked, name: file.path }; context.redraw(); };
        const toggle = button(staged ? 'Unstage' : 'Stage', async () => { await guard(() => staged ? api.gitUnstage(file.path) : api.gitStage(file.path)); context.redraw(); }, 'changes-toggle');
        line.append(open, toggle);
        return line;
      };
      const staged = status.files.filter(file => file.staged), unstaged = status.files.filter(file => file.unstaged);
      if (staged.length) parts.push(element('p', 'page-heading', 'Staged'), ...staged.map(file => row(file, true)));
      if (unstaged.length) parts.push(element('p', 'page-heading', 'Not staged'), ...unstaged.map(file => row(file, false)));
      if (!status.files.length) parts.push(element('p', 'pane-empty', 'Nothing has changed since the last commit.'));
      if (status.truncated) parts.push(element('p', 'page-note', 'Only the first 500 files are shown.'));
      if (staged.length) {
        const box = element('textarea', 'changes-message'); box.rows = 3; box.placeholder = 'Commit message'; box.value = message; box.setAttribute('aria-label', 'Commit message');
        const commit = button('Commit', async () => {
          commit.disabled = true;
          const hash = await guard(() => api.gitCommit(message));
          if (hash) { message = ''; note = `Committed ${hash}.`; }
          context.redraw();
        }, 'changes-commit');
        box.oninput = () => { message = box.value; commit.disabled = !message.trim(); };
        commit.disabled = !message.trim();
        parts.push(box, commit);
      }
      body.replaceChildren(...parts);
    },
  };

  async function mergeBlock(context: PaneContext): Promise<HTMLElement[]> {
    const info = work()?.branch ? await guard(() => api.gitMergeInfo()) : null;
    if (!info) return [];
    const count = (number: number, word: string): string => `${number} ${word}${number === 1 ? '' : 's'}`;
    if (info.gone) return [element('p', 'page-note', `This chat’s branch ${info.branch} no longer exists.`)];
    if (info.detached) return [element('p', 'page-note', `The original folder isn’t on a branch, so ${info.branch} can’t be merged yet.`)];
    const block = element('div', 'changes-pull');
    block.append(element('p', 'page-detail', info.commits ? `${count(info.commits, 'commit')} on ${info.branch} to merge into ${info.into}` : `Nothing new on this chat’s branch to merge into ${info.into}`));
    if (info.uncommitted) block.append(element('p', 'page-detail', `${count(info.uncommitted, 'changed file')} here ${info.uncommitted === 1 ? 'isn’t' : 'aren’t'} committed, so ${info.uncommitted === 1 ? 'it' : 'they'} won’t come along.`));
    if (info.commits) {
      const actions = element('div', 'changes-pull-actions');
      actions.append(button(`Merge into ${info.into}`, async () => {
        if (!confirm(`Merge ${count(info.commits, 'commit')} from ${info.branch} into ${info.into}, in ${info.folder}?`)) return;
        const merged = await guard(() => api.gitMerge());
        if (merged) note = `Merged ${count(merged.commits, 'commit')} into ${merged.into} (${merged.hash}).`;
        context.redraw();
      }));
      block.append(actions);
    }
    return [block];
  }

  function pullBlock(status: GitStatus, context: PaneContext): HTMLDivElement {
    const block = element('div', 'changes-pull');
    const draw = (found: GitPrStatus): void => {
      const parts: HTMLElement[] = [];
      if (!found.available) parts.push(element('p', 'page-detail', found.reason));
      else if (found.pr) {
        const { pr } = found, { passed, failed, pending } = pr.checks;
        const state = pr.state === 'MERGED' ? 'Merged' : pr.state === 'CLOSED' ? 'Closed' : pr.draft ? 'Draft' : 'Open';
        const reviewLabels: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review needed' };
        const review = reviewLabels[pr.review];
        const line = element('p', 'changes-pull-title');
        line.append(element('strong', '', `#${pr.number} ${state}`), element('span', '', ` ${pr.title}`));
        parts.push(line);
        const checks = [failed ? `${failed} failed` : '', pending ? `${pending} running` : '', passed ? `${passed} passed` : ''].filter(Boolean).join(', ');
        const detail = [checks ? `Checks: ${checks}` : 'No checks', review].filter(Boolean).join(' · ');
        parts.push(element('p', failed ? 'page-detail changes-failing' : 'page-detail', detail));
        if (pr.neutrino && onOpenNeutrino) parts.push(button('Open in Neutrino', () => onOpenNeutrino(pr.repo, pr.number)));
        else if (pr.url) {
          const prUrl = pr.url;
          parts.push(button('Open on GitHub', () => openLink(prUrl)));
        }
      }
      const actions = element('div', 'changes-pull-actions');
      if (status.origin && status.branch && (!status.upstream || status.ahead)) actions.append(button(status.upstream ? 'Push' : 'Publish branch', async () => {
        if (!confirm(`Push ${status.branch} to origin?`)) return;
        const pushed = await guard(() => api.gitPush());
        if (pushed) { note = `Pushed ${pushed}.`; pull = null; }
        context.redraw();
      }));
      if (found.available && !found.pr && status.upstream && !status.ahead && !['main', 'master'].includes(status.branch)) actions.append(button('Open pull request', async () => {
        if (!confirm(`Open a pull request for ${status.branch}, using its commits for the title and description?`)) return;
        const url = await guard(() => api.gitOpenPr());
        if (url) { note = `Opened ${url}`; pull = null; }
        context.redraw();
      }));
      if (actions.children.length) parts.push(actions);
      block.replaceChildren(...parts);
    };
    if (pull && Date.now() - pull.at < PULL_FRESH) draw(pull.found);
    else {
      draw({ available: true, pr: null, loading: true });
      api.gitPrStatus().then(found => { pull = { found, at: Date.now() }; if (block.isConnected) draw(found); }, () => {});
    }
    return block;
  }

  async function showDiff(
    body: HTMLElement,
    context: PaneContext,
    status: GitStatus,
    wtBar: HTMLElement | null = null,
  ): Promise<void> {
    if (!viewing) return;
    const current = viewing;
    const head = element('div', 'page-head');
    const back = button('‹', () => { viewing = null; context.redraw(); }, 'page-back'); back.setAttribute('aria-label', 'All changes'); back.title = 'All changes';
    const title = element('h4'); title.title = current.name;
    title.append(fileIconElement(current.name), element('span', '', current.name));
    head.append(back, title);
    if (onHistory && !current.untracked) head.append(button('History', () => onHistory(current.path)));
    if (!status.files.some(file => file.path === current.path)) { viewing = null; context.redraw(); return; }
    const text = await guard(() => api.gitDiff(current.path, { staged: current.staged, untracked: current.untracked }));
    if (text === null) return;
    const parts: Node[] = [head];
    if (wtBar) parts.push(wtBar);
    if (text.trim()) {
      const diffEl = renderDiff(text, current.path, { onAnnotate });
      parts.push(diffEl);
      body.replaceChildren(...parts);
      if (current.scrollToLine) {
        const target = diffEl.querySelector(`[data-line="${current.scrollToLine}"]`);
        target?.scrollIntoView({ block: 'center' });
      }
      if (text.length > 6000) void highlightLargeDiff(diffEl, text, current.path);
    } else {
      parts.push(element('p', 'pane-empty', 'No differences to show.'));
      body.replaceChildren(...parts);
    }
  }
  return pane;
}

export { acquireDiffWorkerPool, releaseDiffWorkerPool };
