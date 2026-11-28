import './goals-view.css';
import { bgAnimOffFor } from './bg-animations.js';
import goalsTailsVideo from '../assets/goals-tails.mp4';
import {
  boardColumns,
  claimValueWords,
  comparisonSummaryLine,
  comparisonValueWords,
  diffWords,
  directionWords,
  doneWhenWords,
  folderName,
  formatHours,
  historyNewestFirst,
  machineLabel,
  paperAuthors,
  paperLabel,
  planHoursSummary,
  scaleLabel,
  sourceKindWords,
  spentHoursSummary,
  toleranceFromInput,
  toleranceToInput,
  toleranceWords,
  verdictLabel,
} from './goals-logic.js';
import type {
  ComparisonSummaryInput,
  ComputeBudgetHours,
  DoneWhenSpec,
  GoalBoardItem,
  PaperIdentity,
  ToleranceSpec,
} from './goals-logic.js';

export interface GoalPaper extends PaperIdentity {
  title: string;
  authors?: readonly (string | null | undefined)[];
  published?: string;
  sourceKind?: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  codeLinks?: readonly string[];
  textFile?: string;
  mainFile?: string;
  fromScratch?: boolean;
}

export interface GoalClaim {
  id: string;
  metric: string;
  where: string;
  direction?: string;
  value?: number | null;
  uncertainty?: number | null;
  unit?: string;
  setting?: string;
  tolerance?: ToleranceSpec | null;
  quote: string;
  picked?: boolean;
}

export interface GoalClaimsSummary {
  total: number;
  picked: number;
}

export interface GoalPlanSummary {
  status: string;
  runs: number;
}

export interface GoalBoardCard extends GoalBoardItem {
  id: string;
  outcome: string;
  paper?: GoalPaper | null;
  running?: boolean;
  next?: string;
  steps: number;
  done: number;
  claims?: GoalClaimsSummary | null;
  plan?: GoalPlanSummary | null;
  folder?: string | null;
  moves?: string;
}

export interface GoalWatcher {
  id: string;
  title: string;
  goal?: string | null;
}

export interface GoalsListResult {
  goals: GoalBoardCard[];
  open: number;
  max: number;
  folders?: string[];
  watchers?: GoalWatcher[];
  problem?: string;
}

export interface GoalLastCheck {
  at: string | number;
  passed: boolean;
  detail: string;
}

export interface GoalStep {
  id: string;
  what: string;
  state: string;
  note?: string;
  startedAt?: string | number;
}

export interface GoalPlanDataset {
  name: string;
  requiresLogin?: boolean;
  source?: string;
  fetch?: string;
  licence?: string;
  notes?: string;
}

export interface GoalPlanRun {
  id: string;
  title: string;
  claims?: readonly string[];
  scale?: string;
  machine: string;
  estimatedHours?: number | null;
}

export interface GoalPlanStep {
  what: string;
  waitsForYou?: boolean;
  machine?: string;
}

export interface GoalPlan {
  status: string;
  summary?: string;
  fromScratch?: boolean;
  code?: {
    mode?: string;
    repoUrl?: string;
    notes?: string;
  } | null;
  environment?: {
    summary?: string;
    python?: string;
    packages?: readonly string[];
    notes?: string;
  } | null;
  datasets?: readonly GoalPlanDataset[];
  runs?: readonly GoalPlanRun[];
  hours?: ComputeBudgetHours | null;
  steps?: readonly GoalPlanStep[];
  file?: string;
}

export interface GoalComparisonRow {
  claimId: string;
  metric: string;
  setting?: string;
  paperValue?: number | null;
  uncertainty?: number | null;
  unit?: string;
  tolerance?: ToleranceSpec | null;
  ours?: number | null;
  verdict: string;
  scale?: string;
  exceeded?: boolean;
  diff?: number | null;
  relDiff?: number | null;
  accepted?: boolean;
  reason?: string;
  run?: {
    id?: string;
    scale?: string;
    state?: string;
    where?: string;
  } | null;
  where?: string;
  quote?: string;
}

export interface GoalComparison extends ComparisonSummaryInput {
  passed?: boolean;
  allSettled?: boolean;
  summary?: string;
  rows?: GoalComparisonRow[];
}

export interface GoalDeviation {
  id: string;
  what: string;
  step?: string | number;
  why?: string;
}

export interface GoalReport {
  at: string | number;
  compiled?: boolean;
  reproduced: number;
  total: number;
  mdFile: string;
  pdfFile?: string;
  compileError?: string;
}

export interface GoalRunLink {
  id: string;
  folder: string;
}

export interface GoalHistoryItem {
  at: string | number;
  what: string;
}

export interface GoalTriggers {
  afterStep: boolean;
  onEvent: boolean;
  daily: string;
}

export interface GoalBudget {
  steps?: number;
  hours?: ComputeBudgetHours | null;
}

export interface GoalDetail {
  id: string;
  outcome: string;
  state: string;
  doneWhen: DoneWhenSpec;
  folder?: string | null;
  reason?: string;
  lastCheck?: GoalLastCheck | null;
  session?: string | null;
  paper?: GoalPaper | null;
  claims?: GoalClaim[];
  claimsMeta?: { dropped: number } | null;
  budget?: GoalBudget | null;
  spentHours?: ComputeBudgetHours | null;
  plan?: GoalPlan | null;
  comparison?: GoalComparison | null;
  deviations?: GoalDeviation[];
  report?: GoalReport | null;
  steps: GoalStep[];
  moves: string;
  triggers?: GoalTriggers | null;
  notes: string;
  links: {
    sessions: string[];
    runs: GoalRunLink[];
  };
  history: GoalHistoryItem[];
}

export interface GoalsChatSummary {
  id: string;
  title: string;
}

export interface GoalsRunSummary {
  id: string;
  name?: string;
  command?: string;
}

export interface GoalsApi {
  goalsList: () => Promise<GoalsListResult>;
  goalGet: (id: string) => Promise<GoalDetail>;
  goalAdd: (value: { outcome: string; doneWhen: DoneWhenSpec; folder: string | null; steps: string[] }) => Promise<{ id: string }>;
  goalSet?: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  goalStep: (id: string, op: Record<string, unknown>) => Promise<unknown>;
  goalState: (id: string, move: string, reason?: string) => Promise<unknown>;
  goalLink: (id: string, link: Record<string, unknown>) => Promise<unknown>;
  goalContinue: (id: string) => Promise<unknown>;
  goalWait: (id: string, wait: Record<string, unknown>) => Promise<unknown>;
  reproStart?: (value: { paper: string; folder?: string }) => Promise<{ goal: { id: string } }>;
  reproClaims?: (id: string) => Promise<{ cancelled?: boolean } | null | undefined>;
  reproPick?: (
    id: string,
    patch: {
      picks?: string[];
      tolerances?: Record<string, { kind: 'abs' | 'rel'; value: number }>;
      hours?: { forge: number; atlas: number };
      fromScratch?: boolean;
    },
  ) => Promise<unknown>;
  reproPlan?: (id: string, options?: { fromScratch?: boolean }) => Promise<{ cancelled?: boolean } | null | undefined>;
  reproPlanApprove?: (id: string, options: { action: 'approve' | 'discard' }) => Promise<unknown>;
  reproVerdict?: (id: string, patch: { claim?: string; verdict?: string; reason?: string; close?: boolean }) => Promise<unknown>;
  reproReport?: (id: string) => Promise<{ markdown?: string } | null | undefined>;
  reproReportOpen?: (id: string, which: 'pdf' | 'md') => Promise<unknown>;
  runsList?: (folder: string) => Promise<{ runs?: GoalsRunSummary[] } | null | undefined>;
}

export interface GoalsViewOptions {
  api: GoalsApi;
  root: HTMLElement;
  sidebarButton?: HTMLElement | null;
  chats?: () => GoalsChatSummary[];
  openLink?: ((url: string) => unknown) | null;
  onOpenChat?: (id: string) => void;
  onOpenRun?: (folder: string | null | undefined, id: string) => void;
  onShow?: () => void;
  onHide?: () => void;
  onError?: (message: string) => void;
}

export interface GoalsViewHandle {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  shown: () => boolean;
  open: (id: string) => Promise<void>;
}

interface BackLink {
  label: string;
  go: () => void;
}

interface ClaimControlEntry {
  li: HTMLLIElement;
  tick: HTMLInputElement;
  tolKind: HTMLSelectElement;
  tolVal: HTMLInputElement;
}

// Goals (docs/goals-board-plan.md, stage 1): what Fairy is working towards across sessions, in the chat's place as
// Experiments takes it. A board in three columns, New goal, and a goal's page with its paper (for reproductions),
// steps, notes, links and history. In stage 1 you write the steps and tick them; Fairy starts them herself from stage 2.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

const button = (
  className: string,
  text: string,
  onclick: (ev: MouseEvent) => unknown,
  title = '',
): HTMLButtonElement => {
  const b = el('button', className, text);
  b.type = 'button';
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
};

const STATE_WORDS: Record<string, string> = {
  active: 'Active',
  'waiting-you': 'Waiting for you',
  waiting: 'Waiting',
  paused: 'Paused',
  done: 'Done',
  dropped: 'Dropped',
};

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (msg) return String(msg);
  }
  return String(error);
};

const cleanError = (error: unknown): string =>
  errorText(error).replace(/Error invoking remote method '[^']+': Error: /, '');

export function goalsView({
  api,
  root,
  sidebarButton,
  chats = () => [],
  openLink = null,
  onOpenChat = () => {},
  onOpenRun = () => {},
  onShow = () => {},
  onHide = () => {},
  onError = () => {},
}: GoalsViewOptions): GoalsViewHandle {
  let waitOpen = false;
  let shown = false;
  let view: 'board' | 'goal' = 'board';
  let goalId = '';
  let adding = false;
  let addingPaper = false;
  let listed: GoalsListResult = { goals: [], open: 0, max: 5, folders: [] };
  let polling: ReturnType<typeof setInterval> | null = null;
  const reportPreviews = new Map<string, string>();
  // While a goal's step runs, its page reads itself again every few seconds, so the step's end and the check show.
  const stopPolling = (): void => { if (polling) clearInterval(polling); polling = null; };
  const tailsVideo = el('video', 'gv-tails');
  tailsVideo.src = goalsTailsVideo;
  tailsVideo.muted = true;
  tailsVideo.loop = true;
  tailsVideo.playsInline = true;
  tailsVideo.preload = 'metadata';
  tailsVideo.playbackRate = 0.85;
  tailsVideo.setAttribute('aria-hidden', 'true');
  const body = el('div', 'gv-body');
  root.replaceChildren(tailsVideo, body);
  let tailsStopTimer: ReturnType<typeof setTimeout> | null = null;
  function syncTails(): void {
    if (tailsStopTimer) { clearTimeout(tailsStopTimer); tailsStopTimer = null; }
    const active = shown && !bgAnimOffFor('goals') && document.visibilityState !== 'hidden';
    root.classList.toggle('gv-tails-on', shown && !bgAnimOffFor('goals'));
    if (active) tailsVideo.play().catch(() => {});
    else if (!shown) tailsVideo.pause();
    else tailsStopTimer = setTimeout(() => {
      tailsStopTimer = null;
      if (!shown || bgAnimOffFor('goals') || document.visibilityState === 'hidden') tailsVideo.pause();
    }, 800);
  }
  window.addEventListener('fairy:bg-anim-change', syncTails);
  document.addEventListener('visibilitychange', syncTails);
  const fail = (error: unknown): void => onError(cleanError(error));
  const pill = (state: string): HTMLSpanElement => el('span', `gv-state ${state}`, STATE_WORDS[state] || state);
  const header = (title: string | Node[], lede: string, back?: BackLink): HTMLElement => {
    const head = el('header', 'gv-head');
    if (back) head.append(button('gv-back', back.label, back.go));
    const line = el('div', 'gv-title'); line.append(...(Array.isArray(title) ? title : [el('h1', '', title)]));
    head.append(line);
    if (lede) head.append(el('p', 'gv-lede', lede));
    return head;
  };

  // ── the board ──
  async function showBoard(): Promise<void> {
    view = 'board';
    try { listed = await api.goalsList(); } catch (error) { body.replaceChildren(el('p', 'gv-empty', errorText(error))); return; }
    const head = header('Goals', 'What Fairy is working towards for you across sessions, each until the check you agreed says it’s done. On a goal with a folder, Continue runs its next step as a work turn in that folder, and Fairy checks after each step; you can also tick steps off yourself.');
    const tools = el('div', 'gv-tools');
    const add = button('gv-primary', 'New goal', () => { adding = !adding; addingPaper = false; void showBoard(); });
    add.disabled = listed.open >= listed.max && !adding;
    tools.append(add);
    if (api.reproStart) {
      const fromPaper = button('gv-quiet', 'From a paper', () => { addingPaper = !addingPaper; adding = false; void showBoard(); });
      fromPaper.disabled = listed.open >= listed.max && !addingPaper;
      tools.append(fromPaper);
    }
    tools.append(el('span', 'gv-faint', `${listed.open} of ${listed.max} open`));
    head.append(tools);
    const parts: Node[] = [head];
    if (listed.problem) parts.push(el('p', 'gv-empty', listed.problem));
    if (adding) parts.push(newGoalForm());
    if (addingPaper) parts.push(reproPaperForm());
    if (!listed.goals.length && !adding && !addingPaper) parts.push(el('p', 'gv-empty', 'No goals yet. A goal is an outcome, a check that says it’s done, and the steps to get there: “The parser handles every file in fixtures/”, done when npm test passes.'));
    else {
      const board = el('div', 'gv-board');
      for (const column of boardColumns(listed.goals)) {
        const lane = el('section', 'gv-lane'); lane.setAttribute('aria-label', column.title);
        lane.append(el('h2', '', `${column.title}${column.goals.length ? ` · ${column.goals.length}` : ''}`));
        if (!column.goals.length) lane.append(el('p', 'gv-faint', column.empty));
        for (const goal of column.goals) lane.append(card(goal));
        board.append(lane);
      }
      parts.push(board);
    }
    body.replaceChildren(...parts);
  }
  function card(goal: GoalBoardCard): HTMLButtonElement {
    const item = button(`gv-card ${goal.state}`, '', () => void openGoal(goal.id));
    const top = el('div', 'gv-card-top'); top.append(el('span', 'gv-id', goal.id));
    if (goal.paper) top.append(el('span', 'gv-paper-pill', paperLabel(goal.paper)));
    if (goal.state !== 'active') top.append(pill(goal.state));
    item.append(top, el('p', 'gv-outcome', goal.outcome));
    if (goal.running) item.append(el('p', 'gv-next', 'A step is running'));
    else if (goal.next && !['done', 'dropped'].includes(goal.state)) item.append(el('p', 'gv-next', `Next: ${goal.next}`));
    const meta = [
      goal.steps ? `${goal.done} of ${goal.steps} step${goal.steps === 1 ? '' : 's'}` : 'No steps yet',
      ...(goal.claims?.total ? [`${goal.claims.picked}/${goal.claims.total} claims`] : []),
      ...(goal.plan ? [goal.plan.status === 'pending' ? 'plan awaiting OK' : `${goal.plan.runs} planned run${goal.plan.runs === 1 ? '' : 's'}`] : []),
      goal.folder ? folderName(goal.folder) : 'no folder',
      ...(goal.moves === 'own' ? ['on its own'] : []),
    ];
    item.append(el('p', 'gv-faint', meta.join(' · ')));
    return item;
  }
  function newGoalForm(): HTMLFormElement {
    const form = el('form', 'gv-form'); form.noValidate = true;
    const outcome = el('textarea'); outcome.rows = 2; outcome.maxLength = 600; outcome.placeholder = 'What should be true at the end: “The parser handles every file in fixtures/ without a crash”';
    const kind = el('select');
    for (const [value, label] of [['say', 'I say so'], ['command', 'A command passes'], ['metric', 'A run’s metric reaches a value']]) kind.append(Object.assign(el('option', '', label), { value }));
    const command = el('input'); command.placeholder = 'npm test'; command.spellcheck = false;
    const metric = el('input'); metric.placeholder = 'accuracy';
    const op = el('select'); op.append(Object.assign(el('option', '', 'at least'), { value: '>=' }), Object.assign(el('option', '', 'at most'), { value: '<=' }));
    const value = el('input'); value.type = 'number'; value.step = 'any'; value.placeholder = '0.9';
    const folder = el('select'); folder.append(Object.assign(el('option', '', 'No folder · kept and tracked only'), { value: '' }));
    for (const path of listed.folders || []) folder.append(Object.assign(el('option', '', `${folderName(path)} · ${path}`), { value: path }));
    const steps = el('textarea'); steps.rows = 3; steps.placeholder = 'First steps, one a line (you can add more later)';
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const commandRow = field('Command', command), metricRow = el('div', 'gv-row');
    metricRow.append(field('Metric', metric), field('Must be', op), field('Value', value));
    const sync = (): void => { commandRow.hidden = kind.value !== 'command'; metricRow.hidden = kind.value !== 'metric'; };
    kind.onchange = sync; sync();
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const actions = el('div', 'gv-actions');
    actions.append(button('gv-quiet', 'Cancel', () => { adding = false; void showBoard(); }), Object.assign(el('button', 'gv-primary', 'Add goal'), { type: 'submit' as const }));
    form.append(el('h2', '', 'New goal'), field('Outcome', outcome), field('Done when', kind), commandRow, metricRow, field('Folder', folder), field('Steps', steps), status, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const doneWhen: DoneWhenSpec = kind.value === 'command' ? { kind: 'command', command: command.value } : kind.value === 'metric' ? { kind: 'metric', metric: metric.value, op: op.value, value: value.value } : kind.value === 'claims' ? { kind: 'claims' } : { kind: 'say' };
      try { const goal = await api.goalAdd({ outcome: outcome.value, doneWhen, folder: folder.value || null, steps: steps.value.split('\n') }); adding = false; await openGoal(goal.id); }
      catch (error) { status.textContent = cleanError(error); }
    };
    queueMicrotask(() => outcome.focus());
    return form;
  }
  function reproPaperForm(): HTMLFormElement {
    const form = el('form', 'gv-form'); form.noValidate = true;
    const paperInput = el('input'); paperInput.placeholder = '2401.01234 or https://arxiv.org/abs/2401.01234'; paperInput.spellcheck = false;
    const folderInput = el('input'); folderInput.placeholder = 'Leave blank for ~/Reproductions/<arXiv id>-<short title>'; folderInput.spellcheck = false;
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const submit = Object.assign(el('button', 'gv-primary', 'Fetch paper & add goal'), { type: 'submit' as const });
    const actions = el('div', 'gv-actions');
    actions.append(button('gv-quiet', 'Cancel', () => { addingPaper = false; void showBoard(); }), submit);
    form.append(el('h2', '', 'Reproduce a paper'), field('arXiv id or link', paperInput), field('Folder (optional)', folderInput),
      el('p', 'gv-faint', 'Fetches metadata and LaTeX source (or PDF text) politely from arXiv, unpacks in the sandbox, and creates a git repository. No model call.'), status, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Fetching paper from arXiv…';
      try {
        const result = await api.reproStart!({ paper: paperInput.value.trim(), ...(folderInput.value.trim() ? { folder: folderInput.value.trim() } : {}) });
        addingPaper = false;
        await openGoal(result.goal.id);
      } catch (error) {
        status.textContent = cleanError(error);
        submit.disabled = false;
      }
    };
    queueMicrotask(() => paperInput.focus());
    return form;
  }

  // ── a goal's page ──
  async function openGoal(id: string, { editing = false }: { editing?: boolean } = {}): Promise<void> {
    view = 'goal'; goalId = id;
    let goal: GoalDetail;
    try { goal = await api.goalGet(id); } catch (error) { fail(error); return showBoard(); }
    const closed = ['done', 'dropped'].includes(goal.state), running = goal.steps.find(step => step.state === 'doing');
    if (running && !polling && !editing) polling = setInterval(() => { if (shown && view === 'goal' && goalId === id) void openGoal(id); else stopPolling(); }, 4000);
    if (!running) stopPolling();
    const title: Node[] = editing ? [] : [el('span', 'gv-id', goal.id), el('h1', '', goal.outcome), pill(goal.state)];
    const head = header(title, '', { label: 'Goals', go: () => void showBoard() });
    if (editing) head.append(editForm(goal));
    else {
      const meta = el('p', 'gv-lede'); meta.append(`Done when ${doneWhenWords(goal.doneWhen)} · ${goal.folder ? `in ${goal.folder}` : 'no folder: kept and tracked only'}`);
      head.append(meta);
      if (goal.reason && goal.state !== 'waiting') head.append(el('p', goal.state === 'waiting-you' ? 'gv-wait' : 'gv-faint', goal.reason));
      if (goal.lastCheck) head.append(el('p', `gv-check ${goal.lastCheck.passed ? 'passed' : 'not-yet'}`, `Last check, ${new Date(goal.lastCheck.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}: ${goal.lastCheck.passed ? 'passed' : 'not yet'}. ${goal.lastCheck.detail}`));
      const acts = el('div', 'gv-actions left');
      // Stage 2: the next step as a work turn in the goal's own chat. Its cards ask as any work turn's do.
      if (running) {
        const line = el('p', 'gv-running'); line.append(`Step ${running.id} is running: ${running.what} `);
        const sessionId = goal.session;
        if (sessionId) line.append(button('gv-link', 'Open its chat', () => onOpenChat(sessionId)));
        head.append(line);
      } else if (goal.state === 'waiting') {
        const line = el('p', 'gv-running'); line.append(`${goal.reason || 'Waiting'}. When it’s over, Fairy asks before the next step. `);
        line.append(button('gv-link', 'Stop waiting', async () => { try { await api.goalWait(goal.id, { kind: 'none' }); await openGoal(goal.id); } catch (error) { fail(error); } }));
        head.append(line);
      } else if (goal.plan?.status === 'pending') {
        const line = el('p', 'gv-wait', 'Reproduction plan is awaiting your OK below. Nothing builds or runs until you click Approve plan.');
        head.append(line);
      } else if (goal.state === 'active' && goal.folder) {
        const next = goal.steps.find(step => step.state === 'todo');
        const go = button('gv-primary', 'Continue', async () => {
          go.disabled = true;
          try { await api.goalContinue(goal.id); await openGoal(goal.id); } catch (error) { fail(error); go.disabled = false; }
        }, next ? `Run the next step as a work turn in ${goal.folder}: ${next.what}` : 'No step written: Fairy works out the next step and takes it');
        acts.append(go);
      }
      if (goal.state === 'active' && !running) acts.append(button('gv-quiet', 'Wait on…', () => { waitOpen = !waitOpen; void openGoal(goal.id); }));
      const move = (name: string, label: string, ask = ''): HTMLButtonElement => button('gv-quiet', label, async () => {
        const reason = ask ? window.prompt(ask) : '';
        if (reason === null) return;
        try { await api.goalState(goal.id, name, reason || ''); await openGoal(goal.id); } catch (error) { fail(error); }
      });
      if (['active', 'waiting-you', 'waiting'].includes(goal.state)) acts.append(move('pause', 'Pause'));
      if (['paused', 'waiting-you', 'waiting'].includes(goal.state)) acts.append(move('resume', 'Resume'));
      if (!closed) acts.append(move('done', 'Mark done', 'Mark this goal done. Anything to note? (optional)'), move('drop', 'Drop', 'Why drop it? (optional)'));
      else acts.append(move('reopen', 'Reopen'));
      acts.append(button('gv-quiet', 'Edit', () => void openGoal(goal.id, { editing: true })));
      head.append(acts);
    }
    body.replaceChildren(head, ...(waitOpen && goal.state === 'active' && !running ? [waitForm(goal)] : []), ...(goal.paper ? [paperPart(goal), claimsPart(goal), planPart(goal), comparisonPart(goal, closed), deviationsPart(goal, closed), reportPart(goal)] : []), stepsPart(goal), ...(goal.folder && !closed ? [movesPart(goal)] : []), notesPart(goal), linksPart(goal), historyPart(goal));
  }
  // Reproduce a paper (stage 1): paper metadata, source kind, abstract, code links, and read-only path.
  function paperPart(goal: GoalDetail): HTMLElement {
    const paper = goal.paper!;
    const part = el('section', 'gv-part gv-paper');
    const headingRow = el('div', 'gv-paper-head');
    headingRow.append(el('h2', '', 'Paper'), el('span', 'gv-paper-pill', sourceKindWords(paper.sourceKind)));
    part.append(headingRow);
    part.append(el('p', 'gv-paper-title', paper.title));
    const byline = [paperAuthors(paper.authors), paper.published ? paper.published.slice(0, 10) : ''].filter(Boolean).join(' · ');
    if (byline) part.append(el('p', 'gv-faint', byline));
    const linkRow = el('div', 'gv-paper-links');
    const openUrl = (label: string, url: string): HTMLButtonElement | HTMLAnchorElement => {
      if (openLink) return button('gv-link', label, () => void openLink(url), url);
      const a = el('a', 'gv-link', label); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; return a;
    };
    linkRow.append(openUrl(paperLabel(paper), paper.url));
    if (paper.pdfUrl) linkRow.append(el('span', 'gv-faint', '·'), openUrl('PDF on arXiv', paper.pdfUrl));
    part.append(linkRow);
    if (paper.abstract) {
      const details = el('details', 'gv-paper-abstract'); details.open = true;
      details.append(el('summary', '', 'Abstract'), el('p', '', paper.abstract));
      part.append(details);
    }
    if (paper.codeLinks?.length) {
      const codeWrap = el('div', 'gv-paper-code');
      codeWrap.append(el('span', 'gv-faint', 'Code links found in the paper'));
      const list = el('ul', 'gv-links');
      for (const link of paper.codeLinks) {
        const li = el('li');
        li.append(openUrl(link, link));
        list.append(li);
      }
      codeWrap.append(list);
      part.append(codeWrap);
    } else {
      part.append(el('p', 'gv-faint', 'No code links found in the paper.'));
    }
    const loc = [paper.textFile || 'paper/text.txt', paper.mainFile ? `main: ${paper.mainFile}` : ''].filter(Boolean).join(' · ');
    part.append(el('p', 'gv-faint', `Saved read-only in ${loc}`));
    return part;
  }
  // Reproduce a paper (stage 2): extract quote-checked claims, pick up to 8, edit tolerances and compute hours.
  function claimsPart(goal: GoalDetail): HTMLElement {
    const MAX_PICKED = 8;
    const claims = Array.isArray(goal.claims) ? goal.claims : [];
    const hours = goal.budget?.hours || { forge: 8, atlas: 4 };
    const part = el('section', 'gv-part gv-claims-part');
    const headingRow = el('div', 'gv-paper-head');
    const left = el('div', 'gv-title');
    left.append(el('h2', '', 'Claims'));
    const countPill = el('span', 'gv-state', claims.length ? `${claims.filter(c => c.picked).length} of ${MAX_PICKED} max picked` : 'Not extracted yet');
    left.append(countPill);
    headingRow.append(left);
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const reproClaims = api.reproClaims;
    if (reproClaims) {
      const extractBtn = button(claims.length ? 'gv-quiet' : 'gv-primary', claims.length ? 'Re-extract claims' : 'Extract claims', async () => {
        extractBtn.disabled = true;
        status.textContent = 'Reading paper and checking quotes…';
        try {
          const result = await reproClaims(goal.id);
          if (result?.cancelled) { status.textContent = ''; extractBtn.disabled = false; return; }
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          extractBtn.disabled = false;
        }
      }, 'One model turn reads paper/text.txt as data and lists its main claims; Fairy drops any unquoted number');
      headingRow.append(extractBtn);
    }
    part.append(headingRow);

    if ((goal.claimsMeta?.dropped ?? 0) > 0) {
      const dropped = goal.claimsMeta!.dropped;
      part.append(el('p', 'gv-faint', `${dropped} unquoted candidate${dropped === 1 ? '' : 's'} dropped by Fairy’s quote check.`));
    }

    const controls = new Map<string, ClaimControlEntry>();
    const syncPickLimit = (): void => {
      let picked = 0;
      for (const entry of controls.values()) if (entry.tick.checked) picked += 1;
      countPill.textContent = claims.length ? `${picked} of ${MAX_PICKED} max picked` : 'Not extracted yet';
      for (const entry of controls.values()) {
        entry.li.classList.toggle('picked', entry.tick.checked);
        entry.tick.disabled = !entry.tick.checked && picked >= MAX_PICKED;
        entry.tick.title = entry.tick.disabled ? `At most ${MAX_PICKED} claims can be picked` : '';
      }
    };

    if (!claims.length) {
      part.append(el('p', 'gv-faint', 'Extract claims from paper/text.txt to list the numbers this paper reports. Every number is checked against its quoted words in the paper.'));
    } else {
      const list = el('ol', 'gv-claims');
      for (const claim of claims) {
        const li = el('li', `gv-claim${claim.picked ? ' picked' : ''}`);
        const head = el('div', 'gv-claim-head');
        const tick = el('input'); tick.type = 'checkbox'; tick.checked = claim.picked === true; tick.setAttribute('aria-label', `Pick ${claim.id}: ${claim.metric}`);
        tick.onchange = syncPickLimit;
        head.append(tick, el('span', 'gv-id', claim.id), el('strong', 'gv-claim-metric', `${claim.metric}: ${claimValueWords(claim)}`), el('span', 'gv-faint', `${claim.where} · ${directionWords(claim.direction)}`));
        li.append(head);
        if (claim.setting) li.append(el('p', 'gv-claim-setting', claim.setting));
        const tolRow = el('div', 'gv-claim-tol');
        const tolInit = toleranceToInput(claim.tolerance);
        const tolKind = el('select');
        tolKind.append(Object.assign(el('option', '', '± absolute'), { value: 'abs' }), Object.assign(el('option', '', '± % relative'), { value: 'rel' }));
        tolKind.value = tolInit.kind;
        const tolVal = el('input'); tolVal.type = 'number'; tolVal.min = '0'; tolVal.step = 'any'; tolVal.value = String(tolInit.value);
        tolVal.setAttribute('aria-label', `Tolerance for ${claim.id}`);
        const tolHint = el('span', 'gv-faint', toleranceWords(claim.tolerance, claim.unit));
        const refreshHint = (): void => { tolHint.textContent = toleranceWords(toleranceFromInput(tolKind.value, tolVal.value), claim.unit); };
        tolKind.onchange = refreshHint; tolVal.oninput = refreshHint;
        tolRow.append(el('span', 'gv-faint', 'Tolerance'), tolKind, tolVal, tolHint);
        li.append(tolRow);
        const quote = el('blockquote', 'gv-claim-quote', `“${claim.quote}”`);
        li.append(quote);
        controls.set(claim.id, { li, tick, tolKind, tolVal });
        list.append(li);
      }
      part.append(list);
      syncPickLimit();
    }

    // Decision 7: Compute budget (GPU hours on forge, CPU hours on atlas), editable per reproduction.
    const budgetWrap = el('div', 'gv-budget');
    budgetWrap.append(el('h3', 'gv-subhead', 'Compute budget'));
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const forge = el('input'); forge.type = 'number'; forge.min = '0'; forge.max = '500'; forge.step = '0.5'; forge.value = String(hours.forge ?? 8);
    const atlas = el('input'); atlas.type = 'number'; atlas.min = '0'; atlas.max = '500'; atlas.step = '0.5'; atlas.value = String(hours.atlas ?? 4);
    const budgetRow = el('div', 'gv-row');
    budgetRow.append(field('GPU hours on forge', forge), field('CPU hours on atlas', atlas));
    budgetWrap.append(budgetRow);
    if (goal.spentHours) {
      const used = spentHoursSummary(goal.spentHours, hours);
      const usedBar = el('div', `gv-plan-totals${used.anyReached ? ' over' : ''}`);
      usedBar.append(el('span', '', used.line));
      if (used.anyReached) usedBar.append(el('span', 'gv-state waiting-you', 'Budget reached — new Nexus jobs stop until raised'));
      budgetWrap.append(usedBar);
    }
    budgetWrap.append(el('p', 'gv-faint', 'Editable per reproduction. Every cluster job is still a Nexus ticket you accept.'));
    part.append(budgetWrap);

    const reproPick = api.reproPick;
    if (reproPick) {
      const saveRow = el('div', 'gv-actions left');
      const saveBtn = button('gv-quiet', claims.length ? 'Save picks & budget' : 'Save budget', async () => {
        saveBtn.disabled = true;
        status.textContent = '';
        try {
          const picks: string[] = [];
          const tolerances: Record<string, { kind: 'abs' | 'rel'; value: number }> = {};
          for (const [id, entry] of controls.entries()) {
            if (entry.tick.checked) picks.push(id);
            tolerances[id] = toleranceFromInput(entry.tolKind.value, entry.tolVal.value);
          }
          await reproPick(goal.id, {
            ...(claims.length ? { picks, tolerances } : {}),
            hours: { forge: Number(forge.value), atlas: Number(atlas.value) },
          });
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          saveBtn.disabled = false;
        }
      });
      saveRow.append(saveBtn);
      part.append(status, saveRow);
    } else {
      part.append(status);
    }
    return part;
  }
  // Reproduce a paper (stage 3): REPRODUCTION.md plan card naming runs, machines, hours, code strategy (Decision 4),
  // gated datasets (Decision 9), and explicit Approve plan gate before anything starts.
  function planPart(goal: GoalDetail): HTMLElement {
    const plan = goal.plan || null;
    const picked = (Array.isArray(goal.claims) ? goal.claims : []).filter(claim => claim.picked);
    const part = el('section', 'gv-part gv-plan-part');
    const headingRow = el('div', 'gv-paper-head');
    const left = el('div', 'gv-title');
    left.append(el('h2', '', 'Plan'));
    const statusPill = plan
      ? el('span', `gv-state ${plan.status === 'approved' ? 'done' : 'waiting-you'}`, plan.status === 'approved' ? 'Approved' : 'Awaiting your OK')
      : el('span', 'gv-state', 'Not planned yet');
    left.append(statusPill);
    headingRow.append(left);

    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const scratchTick = el('input');
    scratchTick.type = 'checkbox';
    scratchTick.checked = goal.paper?.fromScratch === true;
    scratchTick.setAttribute('aria-label', 'Always write from scratch');

    const reproPlan = api.reproPlan;
    if (reproPlan) {
      const draftBtn = button(plan ? 'gv-quiet' : 'gv-primary', plan ? 'Re-plan' : 'Make plan', async () => {
        draftBtn.disabled = true;
        status.textContent = 'Drafting REPRODUCTION.md…';
        try {
          const result = await reproPlan(goal.id, { fromScratch: scratchTick.checked });
          if (result?.cancelled) { status.textContent = ''; draftBtn.disabled = false; return; }
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          draftBtn.disabled = false;
        }
      }, picked.length
        ? 'One model turn drafts REPRODUCTION.md with machines, hours, and steps. Nothing runs until you click Approve plan.'
        : 'Pick at least one claim above first');
      draftBtn.disabled = !picked.length;
      headingRow.append(draftBtn);
    }
    part.append(headingRow);

    // Decision 4: switch to always write from scratch vs using a linked public repo at a pinned commit.
    const scratchWrap = el('label', 'gv-tick gv-plan-scratch');
    scratchWrap.append(scratchTick, el('span', '', 'Always write from scratch'));
    scratchTick.onchange = async () => {
      if (!api.reproPick) return;
      try {
        await api.reproPick(goal.id, { fromScratch: scratchTick.checked });
        if (goal.paper) goal.paper.fromScratch = scratchTick.checked;
      } catch (error) {
        status.textContent = cleanError(error);
        scratchTick.checked = !scratchTick.checked;
      }
    };
    const codeHint = goal.paper?.codeLinks?.length
      ? 'Off: clone the paper’s public repo at a pinned commit. On: always implement from scratch.'
      : 'No public repo link found in this paper; the plan will implement from scratch.';
    part.append(scratchWrap, el('p', 'gv-faint', codeHint));

    if (!plan) {
      part.append(el('p', 'gv-faint', picked.length
        ? `Ready to draft REPRODUCTION.md for ${picked.length} picked claim${picked.length === 1 ? '' : 's'}. You’ll review every run’s machine and hours before anything starts.`
        : 'Pick up to 8 claims above and save them, then draft REPRODUCTION.md.'));
      part.append(status);
      return part;
    }

    const card = el('div', `gv-plan-card ${plan.status}`);
    if (plan.status === 'pending') {
      card.append(el('p', 'gv-wait', 'Nothing builds or runs until you click Approve plan below.'));
    }
    if (plan.summary) card.append(el('p', 'gv-plan-summary', plan.summary));

    const openUrl = (label: string, url: string): HTMLButtonElement | HTMLAnchorElement => {
      if (openLink) return button('gv-link', label, () => void openLink(url), url);
      const a = el('a', 'gv-link', label); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; return a;
    };

    // Code strategy & Environment
    const infoGrid = el('div', 'gv-plan-grid');
    const codeBox = el('div', 'gv-plan-box');
    codeBox.append(el('h3', 'gv-subhead', 'Code approach'));
    if (plan.code?.mode === 'authors-code' && plan.code.repoUrl) {
      const line = el('p', 'gv-plan-text');
      line.append('Pinned commit from ', openUrl(plan.code.repoUrl, plan.code.repoUrl));
      codeBox.append(line);
    } else {
      codeBox.append(el('p', 'gv-plan-text', plan.fromScratch ? 'From scratch (always-from-scratch switch on)' : 'From scratch'));
    }
    if (plan.code?.notes) codeBox.append(el('p', 'gv-faint', plan.code.notes));
    infoGrid.append(codeBox);

    const envBox = el('div', 'gv-plan-box');
    envBox.append(el('h3', 'gv-subhead', 'Environment'));
    const envLines = [
      plan.environment?.summary,
      plan.environment?.python ? `Python ${plan.environment.python}` : '',
      plan.environment?.packages?.length ? `Packages: ${plan.environment.packages.join(', ')}` : '',
    ].filter(Boolean);
    envBox.append(el('p', 'gv-plan-text', envLines.join(' · ') || 'Standard project environment'));
    if (plan.environment?.notes) envBox.append(el('p', 'gv-faint', plan.environment.notes));
    infoGrid.append(envBox);
    card.append(infoGrid);

    // Datasets (Decision 9: call out login / licence gates prominently)
    if (plan.datasets?.length) {
      const dsWrap = el('div', 'gv-plan-block');
      dsWrap.append(el('h3', 'gv-subhead', 'Datasets'));
      const dsList = el('ul', 'gv-plan-list');
      for (const ds of plan.datasets) {
        const li = el('li', `gv-plan-ds${ds.requiresLogin ? ' gated' : ''}`);
        const row = el('div', 'gv-plan-ds-head');
        row.append(el('strong', '', ds.name));
        if (ds.requiresLogin) row.append(el('span', 'gv-state waiting-you', 'Waits for you · login / licence (Fairy never enters credentials)'));
        li.append(row);
        const detail = [ds.source, ds.fetch, ds.licence ? `Licence: ${ds.licence}` : '', ds.notes].filter(Boolean).join(' · ');
        if (detail) li.append(el('p', 'gv-faint', detail));
        dsList.append(li);
      }
      dsWrap.append(dsList);
      card.append(dsWrap);
    }

    // Runs table naming every run's machine and hours
    const runsWrap = el('div', 'gv-plan-block');
    runsWrap.append(el('h3', 'gv-subhead', 'Planned runs & compute hours'));
    const table = el('table', 'gv-plan-runs');
    const thead = el('thead'), headTr = el('tr');
    for (const col of ['Run', 'Title', 'Claims', 'Scale', 'Machine', 'Est. hours']) headTr.append(el('th', '', col));
    thead.append(headTr);
    const tbody = el('tbody');
    for (const run of plan.runs || []) {
      const tr = el('tr');
      tr.append(
        el('td', 'gv-plan-id', run.id),
        el('td', '', run.title),
        el('td', '', run.claims?.length ? run.claims.join(', ') : '—'),
        el('td', '', scaleLabel(run.scale)),
        el('td', `gv-plan-machine ${run.machine}`, machineLabel(run.machine)),
        el('td', 'gv-plan-hrs', formatHours(run.estimatedHours)),
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    runsWrap.append(table);

    const hrs = planHoursSummary(plan, goal.budget?.hours ?? null);
    const hrsBar = el('div', `gv-plan-totals${hrs.anyOver ? ' over' : ''}`);
    hrsBar.append(el('span', '', hrs.line));
    if (hrs.anyOver) hrsBar.append(el('span', 'gv-state waiting-you', 'Exceeds compute budget'));
    runsWrap.append(hrsBar, el('p', 'gv-faint', 'Heavy cluster jobs run only through Nexus tickets you accept; jobs fetch their own data.'));
    card.append(runsWrap);

    // Preview of planned steps while awaiting OK
    if (plan.status === 'pending' && plan.steps?.length) {
      const stepsWrap = el('div', 'gv-plan-block');
      stepsWrap.append(el('h3', 'gv-subhead', `Steps added on approval (${plan.steps.length})`));
      const ol = el('ol', 'gv-plan-steps');
      for (const step of plan.steps) {
        const li = el('li', step.waitsForYou ? 'gated' : '');
        if (step.waitsForYou) li.append(el('span', 'gv-state waiting-you', 'Waits for you'), ' ');
        li.append(step.what);
        if (step.machine) li.append(' ', el('span', 'gv-faint', `(${step.machine})`));
        ol.append(li);
      }
      stepsWrap.append(ol);
      card.append(stepsWrap);
    }

    card.append(el('p', 'gv-faint', `Saved in ${plan.file || 'REPRODUCTION.md'}`));

    const reproPlanApprove = api.reproPlanApprove;
    if (plan.status === 'pending' && reproPlanApprove) {
      const actions = el('div', 'gv-actions left');
      const approveBtn = button('gv-primary', 'Approve plan', async () => {
        approveBtn.disabled = true;
        status.textContent = '';
        try {
          await reproPlanApprove(goal.id, { action: 'approve' });
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          approveBtn.disabled = false;
        }
      }, 'Add these steps to the goal and unlock execution');
      const discardBtn = button('gv-quiet', 'Discard plan', async () => {
        discardBtn.disabled = true;
        status.textContent = '';
        try {
          await reproPlanApprove(goal.id, { action: 'discard' });
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          discardBtn.disabled = false;
        }
      });
      actions.append(approveBtn, discardBtn);
      card.append(actions);
    }

    part.append(card, status);
    return part;
  }
  // Reproduce a paper (stage 5): side-by-side comparison of paper claims against tracked runs, with verdicts,
  // clickable run links, verbatim paper lines, and controls to accept failed verdicts or mark couldn't run.
  function comparisonPart(goal: GoalDetail, closed = false): HTMLElement {
    const comp = goal.comparison || null;
    const rows = Array.isArray(comp?.rows) ? comp.rows : [];
    const part = el('section', 'gv-part gv-compare-part');
    const headingRow = el('div', 'gv-paper-head');
    const left = el('div', 'gv-title');
    left.append(el('h2', '', 'Comparison'));
    const pillClass = comp?.passed
      ? 'done'
      : (comp?.counts?.notReproduced ?? 0) > 0 || (comp?.counts?.scaledOnly ?? 0) > 0
        ? 'waiting-you'
        : comp?.allSettled
          ? 'done'
          : '';
    left.append(el('span', `gv-state${pillClass ? ` ${pillClass}` : ''}`, comparisonSummaryLine(comp)));
    headingRow.append(left);
    part.append(headingRow);

    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');

    if (!rows.length) {
      part.append(el('p', 'gv-faint', 'Pick up to 8 claims above to compare Fairy’s full-scale runs beside the paper’s numbers.'));
      return part;
    }

    const wrap = el('div', 'gv-comp-scroll');
    const table = el('table', 'gv-comp-table');
    const thead = el('thead'), headTr = el('tr');
    for (const col of ['Claim', 'Paper', 'Ours', 'Diff', 'Verdict', 'Run', 'Paper’s line']) headTr.append(el('th', '', col));
    thead.append(headTr);
    const tbody = el('tbody');

    const applyVerdict = async (patch: { claim?: string; verdict?: string; reason?: string; close?: boolean }): Promise<void> => {
      status.textContent = '';
      try {
        await api.reproVerdict!(goal.id, patch);
        await openGoal(goal.id);
      } catch (error) {
        status.textContent = cleanError(error);
      }
    };

    for (const row of rows) {
      const tr = el('tr', `gv-comp-row ${row.verdict}`);

      // Claim
      const claimCell = el('td', 'gv-comp-claim');
      const idLine = el('div', 'gv-comp-claim-head');
      idLine.append(el('span', 'gv-id', row.claimId), el('strong', '', row.metric));
      claimCell.append(idLine);
      if (row.setting) claimCell.append(el('div', 'gv-faint', row.setting));

      // Paper value + tolerance
      const paperCell = el('td', 'gv-comp-num');
      paperCell.append(
        el('div', '', claimValueWords({ value: row.paperValue, uncertainty: row.uncertainty, unit: row.unit })),
        el('div', 'gv-faint', toleranceWords(row.tolerance, row.unit)),
      );

      // Ours
      const oursCell = el('td', 'gv-comp-num');
      oursCell.append(el('div', '', comparisonValueWords(row.ours, row.unit)));
      if (row.verdict === 'scaled-only') {
        oursCell.append(el('div', 'gv-faint', `${scaleLabel(row.scale)} · full needed`));
      } else if (row.exceeded) {
        oursCell.append(el('div', 'gv-faint', 'exceeded paper'));
      }

      // Diff
      const diffCell = el('td', 'gv-comp-num', diffWords(row.diff, row.relDiff, row.unit));

      // Verdict + user accept / couldn't run controls
      const verdictCell = el('td', 'gv-comp-verdict');
      verdictCell.append(el('span', `gv-verdict ${row.verdict}${row.accepted ? ' accepted' : ''}`, verdictLabel(row.verdict, row.accepted)));
      if (row.reason) verdictCell.append(el('div', 'gv-faint', row.reason));
      if (!closed && api.reproVerdict) {
        const ctrl = el('div', 'gv-comp-actions');
        if (row.verdict === 'not-reproduced' && !row.accepted) {
          ctrl.append(button('gv-link', 'Accept', () => {
            const reason = window.prompt(`Accept ${row.claimId} as not reproduced? Optional explanation:`, '');
            if (reason === null) return;
            void applyVerdict({ claim: row.claimId, verdict: 'not-reproduced', reason });
          }, 'Accept that this claim did not reproduce within tolerance'));
        } else if (row.verdict === 'pending' || row.verdict === 'scaled-only') {
          ctrl.append(button('gv-link', 'Couldn’t run', () => {
            const reason = window.prompt(`Why couldn’t ${row.claimId} run? (e.g. data behind login, budget spent)`, '');
            if (reason === null) return;
            void applyVerdict({ claim: row.claimId, verdict: 'couldnt-run', reason });
          }, 'Mark this claim as couldn’t run (e.g. gated dataset or budget spent)'));
        } else if (row.accepted) {
          ctrl.append(button('gv-link', 'Undo', () => void applyVerdict({ claim: row.claimId, verdict: 'clear' }), 'Clear this accepted verdict'));
        }
        if (ctrl.children.length) verdictCell.append(ctrl);
      }

      // Linked Run
      const runCell = el('td', 'gv-comp-run');
      if (row.run?.id) {
        const runId = row.run.id;
        runCell.append(button('gv-link', runId, () => onOpenRun(goal.folder, runId), `Open run ${runId} in Experiments`));
        const meta = [row.run.scale ? scaleLabel(row.run.scale) : row.run.state, row.run.where].filter(Boolean).join(' · ');
        if (meta) runCell.append(el('div', 'gv-faint', meta));
      } else {
        runCell.textContent = '—';
      }

      // Paper's line (where + verbatim quote)
      const quoteCell = el('td', 'gv-comp-quote');
      if (row.where) quoteCell.append(el('div', 'gv-faint', row.where));
      if (row.quote) quoteCell.append(el('span', '', `“${row.quote}”`));

      tr.append(claimCell, paperCell, oursCell, diffCell, verdictCell, runCell, quoteCell);
      tbody.append(tr);
    }

    table.append(thead, tbody);
    wrap.append(table);
    part.append(wrap);

    if (comp?.summary) part.append(el('p', 'gv-faint', comp.summary));

    if (!closed && comp?.allSettled && api.reproVerdict) {
      const closeRow = el('div', 'gv-actions left');
      const label = comp.passed ? 'Mark done · all claims reproduced' : 'Accept verdicts & close goal';
      closeRow.append(button('gv-primary', label, () => void applyVerdict({ close: true })));
      part.append(closeRow);
    }

    part.append(status);
    return part;
  }
  // Reproduce a paper (stage 6): deviations from the paper recorded by steps (goal_update) or added by you.
  function deviationsPart(goal: GoalDetail, closed = false): HTMLElement {
    const list = Array.isArray(goal.deviations) ? goal.deviations : [];
    const part = el('section', 'gv-part gv-deviations-part');
    const headingRow = el('div', 'gv-paper-head');
    const left = el('div', 'gv-title');
    left.append(el('h2', '', 'Deviations from paper'), el('span', 'gv-state', list.length ? `${list.length} recorded` : 'None recorded'));
    headingRow.append(left);
    part.append(headingRow);

    if (!list.length) {
      part.append(el('p', 'gv-faint', 'Any difference from the paper (guessed hyperparameter, dataset version, library, or pinned commit) recorded by steps or added here appears in REPORT.md and REPORT.pdf.'));
    } else {
      const ul = el('ul', 'gv-deviations');
      for (const dev of list) {
        const li = el('li', 'gv-deviation');
        const head = el('div', 'gv-claim-head');
        head.append(el('span', 'gv-id', dev.id), el('strong', '', dev.what));
        if (dev.step) head.append(el('span', 'gv-faint', `Step ${dev.step}`));
        const goalSet = api.goalSet;
        if (!closed && goalSet) {
          head.append(button('gv-x', '×', async () => {
            try { await goalSet(goal.id, { deviation: { op: 'remove', id: dev.id } }); await openGoal(goal.id); }
            catch (error) { fail(error); }
          }, `Remove deviation ${dev.id}`));
        }
        li.append(head);
        if (dev.why) li.append(el('p', 'gv-faint', dev.why));
        ul.append(li);
      }
      part.append(ul);
    }

    const goalSet = api.goalSet;
    if (!closed && goalSet) {
      const form = el('form', 'gv-dev-form');
      const what = el('input'); what.placeholder = 'What differed from the paper (e.g. AdamW lr=1e-4, PyTorch 2.6)'; what.maxLength = 300;
      const why = el('input'); why.placeholder = 'Why (optional)'; why.maxLength = 300;
      const add = Object.assign(el('button', 'gv-quiet', 'Add deviation'), { type: 'submit' as const });
      const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
      form.append(what, why, add);
      form.onsubmit = async event => {
        event.preventDefault();
        if (!what.value.trim()) { status.textContent = 'Describe what differed from the paper.'; return; }
        add.disabled = true; status.textContent = '';
        try {
          await goalSet(goal.id, { deviation: { op: 'add', what: what.value.trim(), why: why.value.trim() } });
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          add.disabled = false;
        }
      };
      part.append(form, status);
    }
    return part;
  }
  // Reproduce a paper (stage 6, Decision 10): generate REPORT.md and compile REPORT.pdf via sandboxed pdflatex.
  function reportPart(goal: GoalDetail): HTMLElement {
    const rep = goal.report || null;
    const part = el('section', 'gv-part gv-report-part');
    const headingRow = el('div', 'gv-paper-head');
    const left = el('div', 'gv-title');
    left.append(el('h2', '', 'Report'));
    const pillText = !rep ? 'Not generated yet' : rep.compiled ? 'REPORT.md + PDF ready' : 'REPORT.md written (PDF failed)';
    const pillCls = !rep ? '' : rep.compiled ? ' done' : ' waiting-you';
    left.append(el('span', `gv-state${pillCls}`, pillText));
    headingRow.append(left);

    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const reproReport = api.reproReport;
    if (reproReport) {
      const genBtn = button(rep ? 'gv-quiet' : 'gv-primary', rep ? 'Regenerate report' : 'Generate report (MD + PDF)', async () => {
        genBtn.disabled = true;
        status.textContent = 'Writing REPORT.md and compiling REPORT.pdf in sandbox…';
        try {
          const res = await reproReport(goal.id);
          if (res?.markdown) reportPreviews.set(goal.id, res.markdown);
          await openGoal(goal.id);
        } catch (error) {
          status.textContent = cleanError(error);
          genBtn.disabled = false;
        }
      }, 'Writes REPORT.md and REPORT.tex and compiles REPORT.pdf in Fairy’s sandbox with no model call');
      headingRow.append(genBtn);
    }
    part.append(headingRow);

    if (!rep) {
      part.append(el('p', 'gv-faint', 'Generates REPORT.md and compiles REPORT.pdf in this reproduction’s folder with every reported number linked to its tracked run, plus all deviations. No model call.'));
    } else {
      const when = new Date(rep.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      part.append(el('p', 'gv-faint', `Generated ${when} · ${rep.reproduced} of ${rep.total} picked claim${rep.total === 1 ? '' : 's'} reproduced · ${rep.mdFile}${rep.compiled && rep.pdfFile ? ` + ${rep.pdfFile}` : ''}`));
      if (rep.compileError) part.append(el('p', 'gv-wait', `PDF compilation note: ${rep.compileError}`));
      const acts = el('div', 'gv-actions left');
      const reproReportOpen = api.reproReportOpen;
      if (reproReportOpen) {
        if (rep.compiled && rep.pdfFile) {
          acts.append(button('gv-primary', 'Open REPORT.pdf', async () => {
            try { await reproReportOpen(goal.id, 'pdf'); }
            catch (error) { status.textContent = cleanError(error); }
          }));
        }
        acts.append(button('gv-quiet', 'Open REPORT.md', async () => {
          try { await reproReportOpen(goal.id, 'md'); }
          catch (error) { status.textContent = cleanError(error); }
        }));
      }
      if (acts.children.length) part.append(acts);
    }

    const preview = reportPreviews.get(goal.id);
    if (preview) {
      const det = el('details', 'gv-report-preview');
      det.append(el('summary', '', 'Preview REPORT.md'), el('pre', 'gv-report-md', preview));
      part.append(det);
    }

    part.append(status);
    return part;
  }
  // Stage 3: what a goal waits on. When it's over, Fairy asks on a card (Ask first) before the next step.
  function waitForm(goal: GoalDetail): HTMLFormElement {
    const form = el('form', 'gv-form');
    const kind = el('select');
    for (const [value, label] of [['job', 'A Nexus job ends'], ['watcher', 'One of your watchers fires'], ['date', 'A date and time comes']]) kind.append(Object.assign(el('option', '', label), { value }));
    const job = el('input'); job.placeholder = 'The job id, as nexus printed it'; job.spellcheck = false;
    const watcher = el('select');
    for (const item of (listed.watchers || []).filter(entry => !entry.goal || entry.goal === goal.id)) watcher.append(Object.assign(el('option', '', item.title), { value: item.id }));
    if (!watcher.options.length) watcher.append(Object.assign(el('option', '', 'No watchers yet: add one in Settings → Skills & automation'), { value: '' }));
    const date = el('input'); date.type = 'datetime-local';
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const rows: Record<string, HTMLLabelElement> = { job: field('Job', job), watcher: field('Watcher', watcher), date: field('When', date) };
    const sync = (): void => { for (const [name, row] of Object.entries(rows)) row.hidden = kind.value !== name; };
    kind.onchange = sync; sync();
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const actions = el('div', 'gv-actions');
    actions.append(button('gv-quiet', 'Cancel', () => { waitOpen = false; void openGoal(goal.id); }), Object.assign(el('button', 'gv-primary', 'Wait'), { type: 'submit' as const }));
    form.append(el('h2', '', 'Wait on'), field('Until', kind), rows.job, rows.watcher, rows.date, status, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const wait = kind.value === 'job' ? { kind: 'job', job: job.value.trim() } : kind.value === 'watcher' ? { kind: 'watcher', watcher: watcher.value } : { kind: 'date', at: date.value ? new Date(date.value).toISOString() : '' };
      try { await api.goalWait(goal.id, wait); waitOpen = false; await openGoal(goal.id); }
      catch (error) { status.textContent = cleanError(error); }
    };
    return form;
  }
  function editForm(goal: GoalDetail): HTMLFormElement {
    const form = el('form', 'gv-form');
    const outcome = el('textarea'); outcome.rows = 2; outcome.value = goal.outcome;
    const kind = el('select');
    for (const [value, label] of [['say', 'I say so'], ['command', 'A command passes'], ['metric', 'A run’s metric reaches a value'], ...(goal.paper ? [['claims', 'Picked claims are reproduced']] : [])]) kind.append(Object.assign(el('option', '', label), { value }));
    kind.value = goal.doneWhen.kind || 'say';
    const command = el('input'); command.value = goal.doneWhen.command || ''; command.spellcheck = false;
    const metric = el('input'); metric.value = goal.doneWhen.metric || '';
    const op = el('select'); op.append(Object.assign(el('option', '', 'at least'), { value: '>=' }), Object.assign(el('option', '', 'at most'), { value: '<=' })); op.value = goal.doneWhen.op || '>=';
    const value = el('input'); value.type = 'number'; value.step = 'any'; value.value = String(goal.doneWhen.value ?? '');
    const folder = el('select'); folder.append(Object.assign(el('option', '', 'No folder · kept and tracked only'), { value: '' }));
    for (const path of [...new Set([...(listed.folders || []), ...(goal.folder ? [goal.folder] : [])])]) folder.append(Object.assign(el('option', '', `${folderName(path)} · ${path}`), { value: path }));
    folder.value = goal.folder || '';
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const commandRow = field('Command', command), metricRow = el('div', 'gv-row');
    metricRow.append(field('Metric', metric), field('Must be', op), field('Value', value));
    const sync = (): void => { commandRow.hidden = kind.value !== 'command'; metricRow.hidden = kind.value !== 'metric'; };
    kind.onchange = sync; sync();
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const actions = el('div', 'gv-actions');
    actions.append(button('gv-quiet', 'Cancel', () => void openGoal(goal.id)), Object.assign(el('button', 'gv-primary', 'Save'), { type: 'submit' as const }));
    form.append(field('Outcome', outcome), field('Done when', kind), commandRow, metricRow, field('Folder', folder), status, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const doneWhen: DoneWhenSpec = kind.value === 'command' ? { kind: 'command', command: command.value } : kind.value === 'metric' ? { kind: 'metric', metric: metric.value, op: op.value, value: value.value } : kind.value === 'claims' ? { kind: 'claims' } : { kind: 'say' };
      try { await api.goalSet!(goal.id, { outcome: outcome.value, doneWhen, folder: folder.value || null }); await openGoal(goal.id); }
      catch (error) { status.textContent = cleanError(error); }
    };
    return form;
  }
  function stepsPart(goal: GoalDetail): HTMLElement {
    const part = el('section', 'gv-part'); part.append(el('h2', '', 'Steps'));
    const list = el('ol', 'gv-steps');
    for (const step of goal.steps) {
      const li = el('li', `gv-step ${step.state}`);
      const tick = el('input'); tick.type = 'checkbox'; tick.checked = step.state === 'done'; tick.disabled = step.state === 'doing'; tick.setAttribute('aria-label', `Done: ${step.what}`);
      tick.onchange = async () => { try { await api.goalStep(goal.id, { op: tick.checked ? 'tick' : 'untick', step: step.id }); await openGoal(goal.id); } catch (error) { fail(error); } };
      const words = el('span', 'gv-step-what', step.what);
      const remove = button('gv-x', '×', async () => { try { await api.goalStep(goal.id, { op: 'remove', step: step.id }); await openGoal(goal.id); } catch (error) { fail(error); } }, 'Remove this step');
      li.append(tick, words);
      if (step.state === 'doing') li.append(el('span', 'gv-state active', 'Running'));
      if (step.state === 'todo') li.append(button('gv-link', 'Skip', async () => { try { await api.goalStep(goal.id, { op: 'skip', step: step.id }); await openGoal(goal.id); } catch (error) { fail(error); } }));
      if (step.state !== 'doing') li.append(remove);
      if (step.note && step.state !== 'todo') li.append(el('small', 'gv-step-note', step.note));
      list.append(li);
    }
    if (!goal.steps.length) part.append(el('p', 'gv-faint', 'No steps yet. Add the first below.'));
    const form = el('form', 'gv-add'), input = el('input'); input.placeholder = 'Add a step'; input.maxLength = 300;
    form.append(input, Object.assign(el('button', 'gv-quiet', 'Add'), { type: 'submit' as const }));
    form.onsubmit = async event => { event.preventDefault(); if (!input.value.trim()) return; try { await api.goalStep(goal.id, { op: 'add', what: input.value }); await openGoal(goal.id); } catch (error) { fail(error); } };
    part.append(list, form);
    return part;
  }
  // Stage 4: how its steps start. Ask first (a card each time a wait ends; Continue whenever you like), or On its own,
  // within its steps a day and while your plan is under 85%, after a good step, when its wait is over, or each day.
  function movesPart(goal: GoalDetail): HTMLElement {
    const part = el('section', 'gv-part'); part.append(el('h2', '', 'How it moves'));
    const own = goal.moves === 'own', triggers = goal.triggers || { afterStep: true, onEvent: true, daily: '' };
    const mode = el('select');
    mode.append(Object.assign(el('option', '', 'Ask first · a card before each step that isn’t yours'), { value: 'ask' }), Object.assign(el('option', '', 'On its own · within its budget'), { value: 'own' }));
    mode.value = goal.moves;
    const steps = el('input'); steps.type = 'number'; steps.min = '1'; steps.max = '10'; steps.value = String(goal.budget?.steps ?? 3);
    const tick = (label: string, checked: boolean): { wrap: HTMLLabelElement; box: HTMLInputElement } => { const wrap = el('label', 'gv-tick'), box = el('input'); box.type = 'checkbox'; box.checked = checked; wrap.append(box, el('span', '', label)); return { wrap, box }; };
    const after = tick('After a good step', triggers.afterStep), event = tick('When its wait is over', triggers.onEvent), daily = tick('Each day at', Boolean(triggers.daily));
    const time = el('input'); time.type = 'time'; time.value = triggers.daily || '09:00'; daily.wrap.append(time);
    const field = (label: string, ...inputs: Node[]): HTMLLabelElement => { const wrap = el('label', 'gv-field'); wrap.append(el('span', '', label), ...inputs); return wrap; };
    const today = goal.steps.filter(step => step.startedAt && new Date(step.startedAt).toDateString() === new Date().toDateString()).length;
    const ownRows = el('div', 'gv-own');
    const ticks = el('div', 'gv-ticks');
    ticks.append(after.wrap, event.wrap, daily.wrap);
    ownRows.append(field('Steps a day', steps), ticks);
    ownRows.append(el('p', 'gv-faint', `Today: ${today} of ${goal.budget?.steps ?? 3} steps. Overnight too, while your plan is under 85%; every card, the sandbox and the folder’s permission still apply.`));
    const sync = (): void => { ownRows.hidden = mode.value !== 'own'; };
    mode.onchange = sync; sync();
    const status = el('p', 'gv-status'); status.setAttribute('role', 'status');
    const save = button('gv-quiet', 'Save', async () => {
      try {
        await api.goalSet!(goal.id, { moves: mode.value, budget: { steps: Number(steps.value) }, triggers: { afterStep: after.box.checked, onEvent: event.box.checked, daily: daily.box.checked ? time.value : '' } });
        await openGoal(goal.id);
      } catch (error) { status.textContent = cleanError(error); }
    });
    part.append(field('Steps start', mode), ownRows, status, save);
    if (!own) save.title = 'Ask first is how every goal starts';
    return part;
  }
  function notesPart(goal: GoalDetail): HTMLElement {
    const part = el('section', 'gv-part'); part.append(el('h2', '', 'Notes'));
    const notes = el('textarea', 'gv-notes'); notes.rows = 4; notes.value = goal.notes; notes.placeholder = 'What’s been learned along the way. Each step reads these, and adds what it learns.';
    const said = el('span', 'gv-faint');
    notes.onblur = async () => { if (notes.value === goal.notes) return; try { await api.goalSet!(goal.id, { notes: notes.value }); goal.notes = notes.value; said.textContent = 'Saved'; } catch (error) { fail(error); } };
    part.append(notes, said);
    return part;
  }
  function linksPart(goal: GoalDetail): HTMLElement {
    const part = el('section', 'gv-part'); part.append(el('h2', '', 'Linked'));
    const known = chats(), list = el('ul', 'gv-links');
    for (const id of goal.links.sessions) {
      const li = el('li'), chat = known.find(item => item.id === id);
      li.append(button('gv-link', chat ? chat.title : 'A chat that has gone', () => chat && onOpenChat(id)), button('gv-x', '×', async () => { try { await api.goalLink(goal.id, { session: id, remove: true }); await openGoal(goal.id); } catch (error) { fail(error); } }, 'Unlink'));
      list.append(li);
    }
    for (const run of goal.links.runs) {
      const li = el('li');
      li.append(button('gv-link', `Run ${run.id} · ${folderName(run.folder)}`, () => onOpenRun(run.folder, run.id)), button('gv-x', '×', async () => { try { await api.goalLink(goal.id, { run: run.id, folder: run.folder, remove: true }); await openGoal(goal.id); } catch (error) { fail(error); } }, 'Unlink'));
      list.append(li);
    }
    if (!goal.links.sessions.length && !goal.links.runs.length) part.append(el('p', 'gv-faint', 'No chats or runs linked yet.'));
    const row = el('div', 'gv-row');
    const chatPick = el('select'); chatPick.append(Object.assign(el('option', '', 'Link a chat…'), { value: '' }));
    for (const chat of known.filter(item => !goal.links.sessions.includes(item.id)).slice(0, 60)) chatPick.append(Object.assign(el('option', '', chat.title), { value: chat.id }));
    chatPick.onchange = async () => { if (!chatPick.value) return; try { await api.goalLink(goal.id, { session: chatPick.value }); await openGoal(goal.id); } catch (error) { fail(error); } };
    row.append(chatPick);
    const goalFolder = goal.folder;
    if (goalFolder && api.runsList) {
      const runPick = el('select'); runPick.append(Object.assign(el('option', '', 'Link a run…'), { value: '' }));
      api.runsList(goalFolder).then(found => { for (const run of (found?.runs || []).slice(0, 80)) runPick.append(Object.assign(el('option', '', `${run.id} · ${run.name || run.command || ''}`.slice(0, 90)), { value: run.id })); }).catch(() => {});
      runPick.onchange = async () => { if (!runPick.value) return; try { await api.goalLink(goal.id, { run: runPick.value, folder: goalFolder }); await openGoal(goal.id); } catch (error) { fail(error); } };
      row.append(runPick);
    }
    part.append(list, row);
    return part;
  }
  function historyPart(goal: GoalDetail): HTMLDetailsElement {
    const part = el('details', 'gv-part gv-history'); part.append(el('summary', '', `History (${goal.history.length})`));
    const list = el('ul');
    for (const item of historyNewestFirst(goal.history)) list.append(el('li', '', `${new Date(item.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${item.what}`));
    part.append(list);
    return part;
  }

  function setShown(value: boolean): void {
    if (shown === value) return;
    shown = value;
    root.hidden = !value;
    document.documentElement.classList.toggle('goals-open', value);
    sidebarButton?.classList.toggle('current', value);
    sidebarButton?.setAttribute('aria-pressed', String(value));
    syncTails();
    (value ? onShow : onHide)();
  }
  return {
    show() { setShown(true); if (view === 'goal' && goalId) void openGoal(goalId); else void showBoard(); },
    hide() { setShown(false); stopPolling(); },
    toggle() { if (shown) this.hide(); else this.show(); },
    shown: () => shown,
    open(id: string) { setShown(true); return openGoal(id); },
  };
}
