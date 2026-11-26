import { stopWith } from './stop-reasons.mjs';
export const MAX_WORK_RUNS = 3;
// Work turns run on their own, one per chat, so other chats stay free while they do.
export class WorkRuns {
  // checkpoints: a Checkpoints (work-checkpoint.mjs), which keeps what each run has done so far on disk as it goes.
  constructor({ limit = MAX_WORK_RUNS, onEvent = () => {}, onChange = () => {}, checkpoints = null } = {}) { Object.assign(this, { limit, onEvent, onChange, checkpoints }); this.runs = new Map(); this.finished = new Set(); }
  has(id) { return this.runs.has(id); }
  get size() { return this.runs.size; }
  // Two runs in one folder would trip over each other's changes.
  check(root) {
    if (this.runs.size >= this.limit) throw new Error(`${this.limit} chats are already working. Wait for one to finish, or stop one.`);
    if ([...this.runs.values()].some(run => run.root === root)) throw new Error('Another chat is already working in this folder. Wait for it, or give this chat its own branch.');
  }
  // at and request: the message the turn answers, so a checkpoint left by a crash can be matched to it.
  start({ session, root, at = '', request = '' }) {
    if (this.runs.has(session)) throw new Error('Fairy is still working in this chat.');
    this.check(root);
    const run = { session, root, at, request, started: new Date().toISOString(), controller: new AbortController(), rows: new Map(), tasks: [], text: '', approvals: new Map() };
    this.runs.set(session, run);
    this.finished.delete(session);
    this.checkpoints?.begin(run);
    this.onChange();
    return run;
  }
  // Everything the window needs to redraw this run later is kept here, whether or not it's on screen.
  emit(run, event) {
    if (event.type === 'tool') run.rows.set(event.row.id, event.row);
    if (event.type === 'tool-remove') run.rows.delete(event.id);
    if (event.type === 'tasks') run.tasks = event.tasks;
    if (event.type === 'text') run.text = event.text;
    if (event.type === 'a2ui') run.a2ui = event.surfaces;
    if (event.type === 'handoff') run.handoff = event.handoff;
    if (['tool', 'tasks', 'text', 'a2ui'].includes(event.type)) this.checkpoints?.touch(run);
    if (event.type === 'approval') run.approvals.set(event.id, event);
    if (event.type === 'approval-closed') run.approvals.delete(event.id);
    this.onEvent({ session: run.session, ...event });
    if (event.type === 'approval' || event.type === 'approval-closed') this.onChange();
  }
  snapshot(id) {
    const run = this.runs.get(id);
    return run ? { rows: [...run.rows.values()], tasks: run.tasks, text: run.text, approvals: [...run.approvals.values()], ...(run.a2ui?.length ? { a2ui: run.a2ui } : {}), ...(run.handoff ? { handoff: run.handoff } : {}) } : null;
  }
  summary() { return Object.fromEntries([...this.runs.values()].map(run => [run.session, run.approvals.size ? 'waiting' : 'working'])); }
  // The turn's reply has been saved, so its checkpoint isn't needed.
  finish(id, { markFinished = false } = {}) { if (this.runs.delete(id)) { if (markFinished) this.finished.add(id); void this.checkpoints?.drop(id); this.onChange(); } }
  clearFinished(id) { if (this.finished.delete(id)) this.onChange(); }
  finishedIds() { return [...this.finished]; }
  // reason: why, so the turn's end says so (stop-reasons.mjs).
  stop(id, reason = 'you') { const run = this.runs.get(id); if (run) stopWith(run.controller, reason); }
  stopAll(reason = 'you') { for (const run of this.runs.values()) stopWith(run.controller, reason); }
  // For quitting: stops everything, and gives each chat a moment to save what happened.
  async stopAndWait(limit = 3000) {
    const finishing = [...this.runs.values()].map(run => run.finished);
    this.stopAll('quit');
    await Promise.race([Promise.allSettled(finishing), new Promise(resolve => setTimeout(resolve, limit))]);
    this.runs.clear();
  }
}
