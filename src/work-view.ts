import { EFFORT_NAMES, modelName } from './auto-caption.js';
import { fileIconElement } from './file-icons.js';
import {
  actionIcon,
  createCodeBlockElement,
  createCommandNode,
  createHandoffDivider,
  createHighlightedDiff,
  createPendingThinkingRow,
  createThoughtNode,
  updateCommandNode,
  updateThoughtNode,
} from './thought-view.js';
import type {
  CommandNodeElement,
  DiffData,
  HandoffInfo,
  OpenLinkHandler,
  ThoughtNodeElement,
} from './thought-view.js';
import { liveActionLabel, segmentActivity, summarizeActionGroup } from './action-summary.js';
import type { ActionIcon, ActivityRow } from './action-summary.js';
import type { Unsubscribe } from '../desktop/ipc-contract.js';

export interface WorkStep {
  status?: string;
  tool?: string;
  summary?: string;
}

export interface WorkFile {
  path: string;
  kind?: string;
  binary?: boolean;
  added?: number;
  removed?: number;
}

export interface WorkSeat {
  model?: string;
  role?: string;
  effort?: string;
  standIn?: string;
  why?: string;
}

export interface WorkRow extends ActivityRow {
  id?: string;
  tool?: string;
  kind?: string;
  status?: string;
  summary?: string;
  command?: string;
  text?: string;
  durationMs?: number;
  network?: boolean;
  local?: boolean;
  outside?: boolean;
  detail?: string;
  seat?: WorkSeat | null;
  helper?: string;
  reason?: string;
  diff?: DiffData | null;
  plan?: string;
  count?: number;
  steps?: WorkStep[];
  files?: WorkFile[];
  output?: string;
}

export interface WorkTask {
  status: string;
  text: string;
}

export interface WorkApprovalPick {
  label: string;
  decision: string;
}

export interface WorkForecastProvider {
  provider: string;
  currentFiveHourPct?: number;
  projectedFiveHourPct?: number | null;
  resets?: string;
}

export interface WorkForecast {
  summary?: string;
  recommendation?: string;
  byProvider?: Record<string, WorkForecastProvider>;
}

export interface WorkApprovalRequest {
  id: string;
  kind?: string;
  title: string;
  detail?: string;
  command?: string;
  plan?: string;
  forecast?: WorkForecast | null;
  diff?: DiffData | null;
  note?: string;
  picks?: WorkApprovalPick[];
  alwaysLabel?: string;
}

export interface WorkDoneEvent {
  type: 'done';
  session?: string;
  history?: unknown[];
  failed?: boolean;
  text?: string;
  [key: string]: unknown;
}

export interface WorkStartedEvent {
  type: 'started';
  session?: string;
  history?: unknown[];
  [key: string]: unknown;
}

export interface WorkPageArtifact {
  id: string;
  seq?: number;
  [key: string]: unknown;
}

export type WorkEvent =
  | WorkDoneEvent
  | WorkStartedEvent
  | { type: 'page'; artifact: WorkPageArtifact }
  | { type: 'a2ui'; session?: string | null; surfaces: unknown[] }
  | { type: 'browser-open' }
  | { type: 'simulator-open'; session?: string | null; udid?: string }
  | { type: 'handoff'; session?: string | null; handoff: HandoffInfo }
  | { type: 'tool'; session?: string | null; row: WorkRow }
  | { type: 'tool-remove'; session?: string | null; id: string }
  | { type: 'text'; session?: string | null; text: string }
  | { type: 'tasks'; session?: string | null; tasks: WorkTask[] }
  | ({ type: 'approval'; session?: string | null } & WorkApprovalRequest)
  | { type: 'approval-closed'; session?: string | null; id: string };

export interface WorkViewApi {
  onWork(callback: (event: WorkEvent) => void): Unsubscribe;
  workAnswer(id: string, decision: string): Promise<unknown>;
  workMessageHelper(id: string | null | undefined, helperId: string | undefined, text: string): Promise<unknown>;
  workStopHelper(id: string | null | undefined, helperId: string | undefined): Promise<unknown>;
}

export interface WorkRunSnapshot {
  text?: string;
  handoff?: HandoffInfo | null;
  rows?: WorkRow[];
  approvals?: WorkApprovalRequest[];
  tasks?: WorkTask[];
}

export interface SetupWorkViewOptions {
  api?: WorkViewApi | null;
  messages: HTMLElement;
  onTasks: (tasks: WorkTask[], live: boolean) => void;
  onWaiting: (title: string) => void;
  onError: (message: string) => void;
  onText: (text: string) => void;
  onDone: (event: WorkDoneEvent) => void;
  onPage?: ((artifact: WorkPageArtifact) => void) | null;
  onA2UI?: ((surfaces: unknown[]) => void) | null;
  onBrowser?: (() => void) | null;
  onSimulator?: ((udid?: string) => void) | null;
  onStarted?: ((event: WorkStartedEvent) => void) | null;
  onStep?: ((row: WorkRow) => void) | null;
  openLink?: OpenLinkHandler;
}

export interface WorkViewController {
  begin: (session?: string | null, snapshot?: WorkRunSnapshot | null) => void;
  attach: (session: string | null) => void;
  restore: () => void;
  end: () => void;
  renderSaved: (activity?: WorkRow[] | null) => void;
  setTasks: (next: WorkTask[]) => void;
  pane: {
    id: string;
    title: string;
    render: (body: HTMLElement) => void;
  };
}

interface OpenableElement extends HTMLElement {
  open?: boolean;
}

type RowNode = ThoughtNodeElement | CommandNodeElement | HTMLDetailsElement;

interface ActionGroupParts {
  iconWrap: HTMLSpanElement;
  text: HTMLSpanElement;
  list: HTMLDivElement;
}

interface ActionGroupElement extends HTMLDetailsElement {
  _parts: ActionGroupParts;
  _rows: WorkRow[];
  _renderedSig: string;
  _lastIcon?: ActionIcon;
}

interface LiveActionParts {
  iconWrap: HTMLSpanElement;
  text: HTMLSpanElement;
  detail: HTMLDivElement;
}

interface LiveActionElement extends HTMLDetailsElement {
  _parts: LiveActionParts;
  _row: WorkRow;
  _detailNode: RowNode | null;
  _lastIcon?: ActionIcon;
}

interface CurrentWorkRun {
  session: string | null;
  block: HTMLDivElement;
  stream: HTMLDivElement;
  thinkingEl: HTMLDivElement;
  hasText: boolean;
  handoffEl: HTMLDivElement | null;
  liveRows: WorkRow[];
  thoughtNodes: Map<string, ThoughtNodeElement>;
  liveActionNodes: Map<string, LiveActionElement>;
  groupNodes: Map<string, ActionGroupElement>;
}

const VERBS: Record<string, string> = {
  browser: 'Browser',
  computer: 'On your Mac',
  compact: 'Summarised',
  'look-back': 'Looked back for',
  'web-search': 'Searched the web for',
  'web-read': 'Read',
  read: 'Read',
  list: 'Listed',
  search: 'Searched for',
  write: 'Wrote',
  edit: 'Edited',
  run: 'Ran',
  plan: 'Plan',
  hook: 'Hook',
  connector: 'Used',
  helper: 'Asked a helper',
  worker: 'Helper',
  step: 'Step',
  critic: 'Second opinion',
  designer: 'Designer',
  wait: 'Waited for',
  'bring-back': 'Brought back',
  discard: 'Threw away',
  check: 'Tested',
  publish: 'Published',
  session: 'Session',
  message: 'Messaged',
  watch: 'Watcher',
  experiment: 'Experiment',
  runs: 'Runs',
  evals: 'Eval',
  thought: 'Thought',
  ui: 'Interactive UI',
};
const FILE_TOOLS = new Set(['read', 'write', 'edit', 'check', 'publish']);
const MANY_STEPS = 20;
const PERMISSIONS: Record<string, string> = { ask: 'Ask first', plan: 'Plan first', auto: 'Run on its own' };
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
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function iconForTool(tool: string | undefined, summary: string | undefined): HTMLSpanElement | null {
  if (tool === 'list') return fileIconElement(summary || '', { isFolder: true, className: 'work-file-icon' });
  if (tool && FILE_TOOLS.has(tool) && summary) return fileIconElement(summary, { className: 'work-file-icon' });
  return null;
}

// What a helper is doing, in one place, so several at once don't get mixed together.
function stepsView(row: WorkRow): HTMLUListElement {
  const list = element('ul', 'work-helper-steps');
  const steps = row.steps ?? [];
  const count = row.count ?? 0;
  if (count > steps.length) list.append(element('li', 'more', `… ${count - steps.length} earlier steps`));
  for (const step of steps) {
    const item = element('li', step.status);
    const icon = iconForTool(step.tool, step.summary);
    item.append(element('span', 'work-verb', (step.tool ? VERBS[step.tool] : undefined) || step.tool));
    if (icon) item.append(icon);
    item.append(element('span', 'work-what', step.summary));
    list.append(item);
  }
  return list;
}

function filesView(files: WorkFile[]): HTMLUListElement {
  const list = element('ul', 'work-helper-files');
  for (const file of files) {
    const item = element('li');
    item.append(
      fileIconElement(file.path, { className: 'work-file-icon' }),
      element('span', 'work-what', file.path),
      element('span', 'work-detail', file.kind === 'removed' ? 'removed' : file.binary ? 'not text' : `${file.kind === 'added' ? 'new, ' : ''}+${file.added} −${file.removed}`),
    );
    list.append(item);
  }
  return list;
}

// One tool call. It opens to show its diff or output. Everything is set as text, so a file's contents can't add controls.
function fillRow(node: HTMLDetailsElement, row: WorkRow): void {
  node.className = `work-row ${row.status}`;
  const summary = element('summary');
  summary.append(element('span', 'work-verb', (row.tool ? VERBS[row.tool] : undefined) || row.tool));
  const icon = iconForTool(row.tool, row.summary);
  if (icon) summary.append(icon);
  summary.append(element('span', 'work-what', row.summary));
  if (row.network) summary.append(element('span', 'work-tag', 'network'));
  if (row.local) summary.append(element('span', 'work-tag', 'local ports'));
  if (row.outside) summary.append(element('span', 'work-tag outside', 'outside sandbox'));
  if (row.detail) summary.append(element('span', 'work-detail', row.detail));
  // Which model a helper, a search or the notes ran on, and in which of the orchestrator's roles: “Haiku 5.5 · scout”.
  // A stand-in says so, and why, since the job went to your other subscription.
  // Who took the job: the model, its role, how hard it thought when the orchestrator chose that, and why on hover.
  if (row.seat?.model) {
    const seat = element(
      'span',
      `work-tag work-seat${row.seat.standIn ? ' stand-in' : ''}`,
      `${modelName(row.seat.model)}${row.seat.role ? ` · ${row.seat.role}` : ''}${row.seat.effort && EFFORT_NAMES[row.seat.effort] ? ` · ${EFFORT_NAMES[row.seat.effort]}` : ''}${row.seat.standIn ? ' · stand-in' : ''}`,
    );
    const why = [row.seat.standIn, row.seat.why].filter(Boolean).join(' ');
    if (why) seat.title = why;
    summary.append(seat);
  }
  if (row.helper && row.status === 'running') {
    // Tell a helper something while it works; it hears it at its next step.
    const say = element('button', 'work-helper-stop work-helper-message', 'Message'); say.type = 'button'; say.dataset.helper = row.helper; say.setAttribute('aria-label', `Message helper: ${row.summary}`);
    const stop = element('button', 'work-helper-stop', 'Stop'); stop.type = 'button'; stop.dataset.helper = row.helper; stop.setAttribute('aria-label', `Stop helper: ${row.summary}`); summary.append(say, stop);
  }
  const body: HTMLElement[] = [];
  if (row.reason) body.push(element('p', 'work-reason', row.reason));
  if (row.diff?.rows?.length) body.push(createHighlightedDiff(row.diff, row.summary));
  if (row.plan) body.push(element('pre', 'work-output', row.plan));
  if (row.steps?.length) body.push(stepsView(row));
  if (row.files?.length) body.push(filesView(row.files));
  if (row.output) body.push(element('pre', 'work-output', row.output));
  node.replaceChildren(summary, ...body);
}

function makeRow(row: WorkRow, { openLink }: { openLink?: OpenLinkHandler } = {}): RowNode {
  if (row.tool === 'thought') return createThoughtNode(row, { openLink, defaultOpen: false });
  if (row.tool === 'run') return createCommandNode(row);
  const node = document.createElement('details');
  fillRow(node, row);
  return node;
}

function makeActionGroupNode(rows: WorkRow[], { openLink }: { openLink?: OpenLinkHandler } = {}): ActionGroupElement {
  const details = element('details', 'action-group') as ActionGroupElement;
  const summary = element('summary', 'action-group-summary');
  const iconWrap = element('span', 'action-group-icon');
  const text = element('span', 'action-group-text');
  summary.append(iconWrap, text);
  const list = element('div', 'action-group-list');
  details.append(summary, list);
  details._parts = { iconWrap, text, list };
  details._rows = [];
  details._renderedSig = '';
  details.addEventListener('toggle', () => {
    if (details.open) renderActionGroupBody(details, { openLink });
  });
  syncActionGroupNode(details, rows, { openLink });
  return details;
}

function renderActionGroupBody(details: ActionGroupElement, { openLink }: { openLink?: OpenLinkHandler } = {}): void {
  const sig = details._rows.map(r => `${r.id}:${r.status}:${r.detail || ''}:${r.output?.length || 0}`).join('|');
  if (details._renderedSig === sig && details._parts.list.childElementCount) return;
  details._renderedSig = sig;
  const openMap = new Map<string, boolean | undefined>();
  for (const child of details._parts.list.children) {
    const childEl = child as OpenableElement;
    const key = childEl.dataset?.rowId;
    if (key) openMap.set(key, childEl.open);
  }
  const nodes = details._rows.map(r => {
    const row = r.status === 'running' ? { ...r, status: r.tool === 'thought' ? 'done' : 'failed' } : r;
    const node = makeRow(row, { openLink }) as OpenableElement;
    if (row.id) node.dataset.rowId = String(row.id);
    if (openMap.has(String(row.id))) node.open = openMap.get(String(row.id));
    return node;
  });
  details._parts.list.replaceChildren(...nodes);
}

function syncActionGroupNode(details: ActionGroupElement, rows: WorkRow[], { openLink }: { openLink?: OpenLinkHandler } = {}): void {
  details._rows = rows;
  const sum = summarizeActionGroup(rows);
  const hasFailed = rows.some(r => r.status === 'failed');
  details.className = `action-group${hasFailed ? ' has-failed' : ''}`;
  const { iconWrap, text } = details._parts;
  if (details._lastIcon !== sum.icon) {
    details._lastIcon = sum.icon;
    iconWrap.replaceChildren(actionIcon(sum.icon));
  }
  if (text.textContent !== sum.text) text.textContent = sum.text;
  if (details.open) renderActionGroupBody(details, { openLink });
}

function makeLiveActionNode(row: WorkRow, { openLink }: { openLink?: OpenLinkHandler } = {}): LiveActionElement {
  const details = element('details', 'action-live') as LiveActionElement;
  if (row.id) details.dataset.rowId = String(row.id);
  const summary = element('summary', 'action-live-summary');
  const iconWrap = element('span', 'action-group-icon');
  const text = element('span', 'action-live-text stream-shimmer-text');
  summary.append(iconWrap, text);
  const detail = element('div', 'action-live-detail');
  details.append(summary, detail);
  details._parts = { iconWrap, text, detail };
  details._row = row;
  details._detailNode = null;
  details.addEventListener('toggle', () => {
    if (details.open) syncLiveActionDetail(details, { openLink });
  });
  syncLiveActionNode(details, row, { openLink });
  return details;
}

function syncLiveActionDetail(details: LiveActionElement, { openLink }: { openLink?: OpenLinkHandler } = {}): void {
  const row = details._row;
  if (!row) return;
  if (!details._detailNode) {
    details._detailNode = makeRow(row, { openLink });
    if (row.tool !== 'thought') (details._detailNode as OpenableElement).open = true;
    details._parts.detail.replaceChildren(details._detailNode);
  } else if (row.tool === 'run') {
    updateCommandNode(details._detailNode as CommandNodeElement, row);
  } else if (row.tool !== 'thought') {
    const detailNode = details._detailNode as HTMLDetailsElement;
    const open = detailNode.open;
    fillRow(detailNode, row);
    detailNode.open = open;
  }
}

function syncLiveActionNode(details: LiveActionElement, row: WorkRow, { openLink }: { openLink?: OpenLinkHandler } = {}): void {
  details._row = row;
  const info = liveActionLabel(row);
  const { iconWrap, text } = details._parts;
  if (details._lastIcon !== info.icon) {
    details._lastIcon = info.icon;
    iconWrap.replaceChildren(actionIcon(info.icon));
  }
  if (text.textContent !== info.text) text.textContent = info.text;
  if (details.open) syncLiveActionDetail(details, { openLink });
}

function reconcileChildren(container: HTMLElement, desired: Node[]): void {
  for (let i = 0; i < desired.length; i++) {
    const expected = desired[i];
    if (container.children[i] !== expected) {
      container.insertBefore(expected, container.children[i] || null);
    }
  }
  while (container.children.length > desired.length) {
    container.lastElementChild?.remove();
  }
}

export function setupWorkView({ api, messages, onTasks, onWaiting, onError, onText, onDone, onPage, onA2UI, onBrowser, onSimulator, onStarted, onStep, openLink }: SetupWorkViewOptions): WorkViewController {
  let current: CurrentWorkRun | null = null;
  let tasks: WorkTask[] = [];

  function approval(request: WorkApprovalRequest): HTMLDivElement {
    const card = element('div', `work-approval${request.kind === 'outside' || request.kind === 'computer' ? ' outside' : ''}`); card.dataset.id = request.id; card.setAttribute('role', 'group'); card.setAttribute('aria-label', request.title);
    const title = element('h4', '', request.title);
    const editPath = /^(?:Create|Change)\s+(.+)$/.exec(request.title || '')?.[1] || '';
    if (editPath) { title.textContent = ''; title.append(fileIconElement(editPath, { className: 'work-file-icon' }), document.createTextNode(` ${request.title}`)); }
    card.append(title);
    if (request.detail) card.append(element('p', '', request.detail));
    if (request.command) card.append(createCodeBlockElement(request.command, 'bash', { label: 'Shell' }));
    if (request.plan) card.append(element('pre', 'work-output', request.plan));
    if (request.forecast?.summary) {
      const box = element('div', `work-forecast ${request.forecast.recommendation === 'wait' ? 'warn' : request.forecast.recommendation === 'saver' ? 'caution' : ''}`);
      box.append(element('strong', '', 'Plan forecast'));
      box.append(element('span', '', request.forecast.summary));
      const bars = Object.values(request.forecast.byProvider || {})
        .filter(p => p.projectedFiveHourPct != null)
        .map(p => `${p.provider}: ${p.currentFiveHourPct}% → ~${p.projectedFiveHourPct}% (5h${p.resets ? `, resets ${p.resets}` : ''})`);
      if (bars.length) box.append(element('small', '', bars.join(' · ')));
      card.append(box);
    }
    if (request.diff?.rows?.length) card.append(createHighlightedDiff(request.diff, editPath));
    if (request.note) card.append(element('p', 'work-note', request.note));
    const buttons = element('div', 'work-buttons');
    const answer = (decision: string) => async () => {
      for (const button of buttons.children) (button as HTMLButtonElement).disabled = true;
      try { await api!.workAnswer(request.id, decision); } catch (error) { onError(errorMessage(error)); }
      card.remove();
    };
    // An offer to start a separate session: start it, or have this chat do the task itself.
    // A swarm's pick: one button per design, and Put aside.
    const choices: Array<[string, string, string?]> =
      request.kind === 'swarm-pick' && Array.isArray(request.picks) ? request.picks.map((pick, i): [string, string, string?] => [pick.label, pick.decision, i === 0 ? 'primary' : 'quiet'])
      : request.kind === 'session-offer' ? [['Start', 'allow', 'primary'], ['Do it here', 'deny']]
      // A watcher offered from the chat: added only on Add watcher.
      : request.kind === 'watcher-offer' ? [['Add watcher', 'allow', 'primary'], ['Not now', 'deny']]
      : request.kind === 'plan' ? [['Approve', 'allow', 'primary'], ['Approve and run on its own', 'auto'], ['Not yet', 'deny']]
      : request.kind === 'outside' || request.kind === 'computer' ? [['Don’t allow', 'deny', 'primary'], ['Allow once', 'allow']]
      : request.kind === 'network' ? [['Allow once', 'allow', 'primary'], ['Don’t allow', 'deny']]
      : [['Allow', 'allow', 'primary'], [request.alwaysLabel || (request.kind === 'edit' ? 'Allow edits in this chat' : 'Allow commands in this chat'), 'always'], ['Don’t allow', 'deny']];
    for (const [label, decision, kind] of choices) {
      const button = element('button', kind || 'quiet', label); button.type = 'button'; button.onclick = answer(decision); buttons.append(button);
      // Time to read it first: a stray click can't allow this as the card appears.
      if ((request.kind === 'outside' || request.kind === 'computer') && decision === 'allow') { button.disabled = true; setTimeout(() => { button.disabled = false; }, 1500); }
    }
    card.append(buttons);
    return card;
  }

  function setHandoff(handoff: HandoffInfo | null | undefined): void {
    if (!current || !handoff) return;
    const next = createHandoffDivider(handoff);
    if (current.handoffEl) current.handoffEl.replaceWith(next);
    else current.block.insertBefore(next, current.stream);
    current.handoffEl = next;
  }

  function syncThinkingIndicator(): void {
    if (!current?.thinkingEl) return;
    const hasRunning = current.liveRows.some(row => row.status === 'running');
    const hasApproval = Boolean(current.block.querySelector('.work-approval'));
    current.thinkingEl.hidden = Boolean(current.hasText || hasRunning || hasApproval);
  }

  function syncStream(): Element | null {
    if (!current) return null;
    const segments = segmentActivity(current.liveRows);
    const desired: Element[] = [];
    for (const seg of segments) {
      if (seg.type === 'thought' || seg.type === 'commentary') {
        const segRow = seg.row as WorkRow;
        const key = String(segRow.id);
        let node = current.thoughtNodes.get(key);
        if (!node) {
          node = createThoughtNode(segRow, { openLink, defaultOpen: false });
          current.thoughtNodes.set(key, node);
        } else {
          updateThoughtNode(node, segRow, { openLink });
        }
        desired.push(node);
      } else if (seg.type === 'action-live') {
        const segRow = seg.row as WorkRow;
        const key = String(segRow.id);
        let node = current.liveActionNodes.get(key);
        if (!node) {
          node = makeLiveActionNode(segRow, { openLink });
          current.liveActionNodes.set(key, node);
        } else {
          syncLiveActionNode(node, segRow, { openLink });
        }
        desired.push(node);
      } else if (seg.type === 'action-group') {
        const segRows = seg.rows as WorkRow[];
        for (const r of segRows) current.liveActionNodes.delete(String(r.id));
        const key = String(segRows[0].id);
        let node = current.groupNodes.get(key);
        if (!node) {
          node = makeActionGroupNode(segRows, { openLink });
          current.groupNodes.set(key, node);
        } else {
          syncActionGroupNode(node, segRows, { openLink });
        }
        desired.push(node);
      }
    }
    reconcileChildren(current.stream, desired);
    syncThinkingIndicator();
    return desired.at(-1) || current.thinkingEl || null;
  }

  function upsertLiveRow(row: WorkRow | null | undefined): Element | null {
    if (!current || !row?.id) return null;
    if (row.tool === 'thought' && row.status !== 'running' && !String(row.text || '').trim()) {
      removeLiveRow(row.id);
      return null;
    }
    const idx = current.liveRows.findIndex(item => item.id === row.id);
    if (idx >= 0) current.liveRows[idx] = { ...row };
    else current.liveRows.push({ ...row });
    return syncStream();
  }

  function removeLiveRow(id: string): void {
    if (!current) return;
    current.liveRows = current.liveRows.filter(item => item.id !== id);
    current.thoughtNodes.delete(String(id));
    current.liveActionNodes.delete(String(id));
    current.groupNodes.delete(String(id));
    syncStream();
  }

  function receive(event: WorkEvent): void {
    if (event.type === 'done') { onDone(event); return; }
    if (event.type === 'started') { onStarted?.(event); return; }
    if (event.type === 'page') { onPage?.(event.artifact); return; }
    if (event.type === 'a2ui') { if (current && event.session === current.session) onA2UI?.(event.surfaces); return; }
    if (event.type === 'browser-open') { onBrowser?.(); return; }
    // The agent started using a simulator in the chat on screen, so its panel opens to show it.
    if (event.type === 'simulator-open') { if (current && event.session === current.session) onSimulator?.(event.udid); return; }
    if (!current || event.session !== current.session) return;
    if (event.type === 'handoff') {
      setHandoff(event.handoff);
      current.handoffEl?.scrollIntoView({ block: 'nearest' });
    } else if (event.type === 'tool') {
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 160;
      const tail = upsertLiveRow(event.row);
      if (nearBottom) tail?.scrollIntoView({ block: 'nearest' });
      onStep?.(event.row);
    } else if (event.type === 'tool-remove') {
      removeLiveRow(event.id);
    } else if (event.type === 'text') {
      current.hasText = Boolean(String(event.text || '').trim());
      syncThinkingIndicator();
      onText(event.text);
    } else if (event.type === 'tasks') {
      tasks = event.tasks; onTasks(tasks, true);
    } else if (event.type === 'approval') {
      const card = approval(event); current.block.append(card); syncThinkingIndicator(); card.scrollIntoView({ block: 'nearest' }); onWaiting(event.title);
    } else if (event.type === 'approval-closed') {
      current.block.querySelector(`[data-id="${CSS.escape(event.id)}"]`)?.remove();
      syncThinkingIndicator();
    }
  }
  api?.onWork(receive);
  // A short form under the helper's row: what you type reaches it with the result of its next step.
  function openHelperMessage(button: HTMLElement): void {
    const row = button.closest('details'), helper = button.dataset.helper;
    if (!row || row.querySelector('.work-helper-form')) { (row?.querySelector('.work-helper-form input') as HTMLElement | null)?.focus(); return; }
    const form = element('form', 'work-helper-form'), input = element('input'), send = element('button', 'work-helper-stop', 'Send'), note = element('span', 'work-helper-note');
    input.type = 'text'; input.maxLength = 2000; input.placeholder = 'Tell this helper something…'; input.setAttribute('aria-label', 'Message for the helper'); send.type = 'submit';
    form.append(input, send, note); row.append(form); row.open = true; input.focus();
    form.onsubmit = async submitted => {
      submitted.preventDefault();
      const text = input.value.trim(); if (!text) return;
      send.disabled = true;
      try { await api?.workMessageHelper(current?.session, helper, text); input.value = ''; note.textContent = 'Sent. It sees it at its next step.'; }
      catch (error) { note.textContent = errorMessage(error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
      finally { send.disabled = false; }
    };
  }
  messages.addEventListener('click', event => {
    const target = event.target as Element | null;
    const say = target?.closest?.('.work-helper-message') as HTMLElement | null | undefined;
    if (say) { event.preventDefault(); openHelperMessage(say); return; }
    const stop = target?.closest?.('.work-helper-stop') as HTMLButtonElement | null | undefined;
    if (!stop) return;
    event.preventDefault();
    stop.disabled = true;
    Promise.resolve(api?.workStopHelper(current?.session, stop.dataset.helper)).catch((error: unknown) => onError(errorMessage(error)));
  });
  return {
    // Draws a turn in progress: a new one, or one that was carrying on while another chat was on screen.
    begin(session = null, snapshot = null) {
      const block = element('div', 'work-activity');
      const stream = element('div', 'work-stream');
      const thinkingEl = createPendingThinkingRow('Thinking');
      block.append(stream, thinkingEl);
      messages.append(block);
      current = {
        session,
        block,
        stream,
        thinkingEl,
        hasText: Boolean(String(snapshot?.text || '').trim()),
        handoffEl: null,
        liveRows: [],
        thoughtNodes: new Map(),
        liveActionNodes: new Map(),
        groupNodes: new Map(),
      };
      if (!snapshot) {
        syncThinkingIndicator();
        thinkingEl.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (snapshot.handoff) setHandoff(snapshot.handoff);
      for (const row of snapshot.rows || []) {
        if (row.tool === 'thought' && row.status !== 'running' && !String(row.text || '').trim()) continue;
        current.liveRows.push({ ...row });
      }
      syncStream();
      for (const request of snapshot.approvals || []) { block.append(approval(request)); onWaiting(request.title); }
      syncThinkingIndicator();
      tasks = snapshot.tasks || []; onTasks(tasks, false);
    },
    attach(session) { if (current) current.session = session; },
    // Redrawing the chat clears its messages, so a turn in progress goes back at the end.
    restore() { if (current) messages.append(current.block); },
    end() {
      current?.thinkingEl?.remove();
      if (current && !current.handoffEl && !current.stream.children.length && !current.block.querySelector('.work-approval')) {
        current.block.remove();
      }
      current?.block.querySelectorAll('.work-approval').forEach(card => card.remove());
      current = null;
    },
    renderSaved(activity) {
      const visible = (activity || [])
        .filter(row => !(row.tool === 'thought' && !String(row.text || '').trim()))
        .map((row): WorkRow => (row.status === 'running' ? { ...row, status: row.tool === 'thought' ? 'done' : 'failed' } : row));
      if (!visible.length) return;
      const block = element('div', 'work-activity');
      const segments = segmentActivity(visible);
      const buildSegments = () => segments.map(seg =>
        seg.type === 'action-group'
          ? makeActionGroupNode(seg.rows as WorkRow[], { openLink })
          : createThoughtNode(seg.row as WorkRow, { openLink, defaultOpen: false }),
      );
      if (segments.length <= MANY_STEPS) block.append(...buildSegments());
      else {
        const steps = element('details', 'work-steps');
        steps.append(element('summary', '', `${visible.length} steps`));
        steps.ontoggle = () => { if (steps.open && steps.childElementCount === 1) steps.append(...buildSegments()); };
        block.append(steps);
      }
      messages.append(block);
    },
    setTasks(next) { tasks = next; },
    pane: {
      id: 'tasks',
      title: 'Tasks',
      render(body) {
        if (!tasks.length) { body.replaceChildren(element('p', 'pane-empty', 'In a work session, Fairy’s task list shows up here.')); return; }
        const list = element('ul', 'task-list');
        list.append(...tasks.map(task => { const item = element('li', task.status, task.text); item.setAttribute('aria-label', `${task.text}: ${task.status.replace('_', ' ')}`); return item; }));
        body.replaceChildren(list);
      },
    },
  };
}
export { PERMISSIONS };
