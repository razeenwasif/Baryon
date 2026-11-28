import { stopWith } from './stop-reasons.mjs';

export const MAX_WORK_RUNS = 3;

export interface WorkRunRow {
  id: unknown;
  tool?: string;
  summary?: unknown;
  status?: string;
  detail?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

export interface WorkRunApproval {
  id: string;
  [key: string]: unknown;
}

export interface WorkRun {
  session: string;
  root: string;
  at: string;
  request: string;
  started: string;
  controller: AbortController;
  rows: Map<unknown, WorkRunRow>;
  tasks: unknown[];
  text: string;
  approvals: Map<string, WorkRunApproval>;
  a2ui?: unknown[];
  handoff?: unknown;
  finished?: Promise<unknown>;
}

export interface WorkRunEvent {
  type: string;
  row?: WorkRunRow;
  id?: unknown;
  tasks?: unknown[];
  text?: string;
  surfaces?: unknown[];
  handoff?: unknown;
  [key: string]: unknown;
}

export interface WorkRunEmittedEvent extends WorkRunEvent {
  session: string;
}

export interface WorkRunCheckpoints {
  begin(run: WorkRun): void;
  touch(run: WorkRun): void;
  drop(session: string): Promise<void> | void;
}

export interface WorkRunsOptions {
  limit?: number;
  onEvent?: (event: WorkRunEmittedEvent) => void;
  onChange?: () => void;
  checkpoints?: WorkRunCheckpoints | null;
}

export interface WorkRunStartOptions {
  session: string;
  root: string;
  at?: string;
  request?: string;
}

export interface WorkRunSnapshot {
  rows: WorkRunRow[];
  tasks: unknown[];
  text: string;
  approvals: WorkRunApproval[];
  a2ui?: unknown[];
  handoff?: unknown;
}

// Work turns run on their own, one per chat, so other chats stay free while they do.
export class WorkRuns {
  limit: number;
  onEvent: (event: WorkRunEmittedEvent) => void;
  onChange: () => void;
  checkpoints: WorkRunCheckpoints | null;
  runs: Map<string, WorkRun>;
  finished: Set<string>;

  // checkpoints: a Checkpoints (work-checkpoint.mjs), which keeps what each run has done so far on disk as it goes.
  constructor({ limit = MAX_WORK_RUNS, onEvent = () => {}, onChange = () => {}, checkpoints = null }: WorkRunsOptions = {}) {
    this.limit = limit;
    this.onEvent = onEvent;
    this.onChange = onChange;
    this.checkpoints = checkpoints;
    this.runs = new Map();
    this.finished = new Set();
  }
  has(id: string): boolean { return this.runs.has(id); }
  get size(): number { return this.runs.size; }
  // Two runs in one folder would trip over each other's changes.
  check(root: string): void {
    if (this.runs.size >= this.limit) throw new Error(`${this.limit} chats are already working. Wait for one to finish, or stop one.`);
    if ([...this.runs.values()].some(run => run.root === root)) throw new Error('Another chat is already working in this folder. Wait for it, or give this chat its own branch.');
  }
  // at and request: the message the turn answers, so a checkpoint left by a crash can be matched to it.
  start({ session, root, at = '', request = '' }: WorkRunStartOptions): WorkRun {
    if (this.runs.has(session)) throw new Error('Fairy is still working in this chat.');
    this.check(root);
    const run: WorkRun = { session, root, at, request, started: new Date().toISOString(), controller: new AbortController(), rows: new Map(), tasks: [], text: '', approvals: new Map() };
    this.runs.set(session, run);
    this.finished.delete(session);
    this.checkpoints?.begin(run);
    this.onChange();
    return run;
  }
  // Everything the window needs to redraw this run later is kept here, whether or not it's on screen.
  emit(run: WorkRun, event: WorkRunEvent): void {
    if (event.type === 'tool') run.rows.set(event.row!.id, event.row!);
    if (event.type === 'tool-remove') run.rows.delete(event.id);
    if (event.type === 'tasks') run.tasks = event.tasks!;
    if (event.type === 'text') run.text = event.text!;
    if (event.type === 'a2ui') run.a2ui = event.surfaces;
    if (event.type === 'handoff') run.handoff = event.handoff;
    if (['tool', 'tasks', 'text', 'a2ui'].includes(event.type)) this.checkpoints?.touch(run);
    if (event.type === 'approval') run.approvals.set(event.id as string, event as WorkRunApproval);
    if (event.type === 'approval-closed') run.approvals.delete(event.id as string);
    this.onEvent({ session: run.session, ...event });
    if (event.type === 'approval' || event.type === 'approval-closed') this.onChange();
  }
  snapshot(id: string): WorkRunSnapshot | null {
    const run = this.runs.get(id);
    return run ? { rows: [...run.rows.values()], tasks: run.tasks, text: run.text, approvals: [...run.approvals.values()], ...(run.a2ui?.length ? { a2ui: run.a2ui } : {}), ...(run.handoff ? { handoff: run.handoff } : {}) } : null;
  }
  summary(): Record<string, 'waiting' | 'working'> { return Object.fromEntries([...this.runs.values()].map(run => [run.session, run.approvals.size ? 'waiting' : 'working'])); }
  // The turn's reply has been saved, so its checkpoint isn't needed.
  finish(id: string, { markFinished = false }: { markFinished?: boolean } = {}): void { if (this.runs.delete(id)) { if (markFinished) this.finished.add(id); void this.checkpoints?.drop(id); this.onChange(); } }
  clearFinished(id: string): void { if (this.finished.delete(id)) this.onChange(); }
  finishedIds(): string[] { return [...this.finished]; }
  // reason: why, so the turn's end says so (stop-reasons.mjs).
  stop(id: string, reason = 'you'): void { const run = this.runs.get(id); if (run) stopWith(run.controller, reason); }
  stopAll(reason = 'you'): void { for (const run of this.runs.values()) stopWith(run.controller, reason); }
  // For quitting: stops everything, and gives each chat a moment to save what happened.
  async stopAndWait(limit = 3000): Promise<void> {
    const finishing = [...this.runs.values()].map(run => run.finished);
    this.stopAll('quit');
    await Promise.race([Promise.allSettled(finishing), new Promise<void>(resolve => setTimeout(resolve, limit))]);
    this.runs.clear();
  }
}
