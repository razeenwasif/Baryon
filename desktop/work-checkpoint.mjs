// Checkpointed work turns ("Improving existing features", item 2). While a turn runs, what it has done so far (the
// request, its tasks, every step and command, and the text it has written) is kept in a small file per chat in
// <data>/work-runs, rewritten as it goes. The file goes once the turn's reply is saved. One left behind means Fairy
// closed or crashed during that turn: at the next start it becomes a recorded unfinished turn, so Carry on knows what
// was done instead of starting blind. Outputs are left out; the rows say what ran and how it went.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CHECKPOINT_DIR = 'work-runs';
const ROWS = 200, PARTIAL = 3000, REQUEST = 2000;
const safeName = session => String(session).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

export function checkpointOf(run, now = new Date()) {
  const rows = [...(run.rows?.values?.() ?? [])].slice(-ROWS).map(({ id, tool, summary, status, detail, reason }) => ({ id, tool, summary: String(summary ?? '').slice(0, 300), status, ...(detail ? { detail: String(detail).slice(0, 200) } : {}), ...(reason ? { reason: String(reason).slice(0, 200) } : {}) }));
  return { session: run.session, root: run.root, at: run.at || '', request: String(run.request || '').slice(0, REQUEST), started: run.started || '', savedAt: now.toISOString(), rows, tasks: Array.isArray(run.tasks) ? run.tasks : [], partial: String(run.text || '').slice(-PARTIAL) };
}

export class Checkpoints {
  constructor({ dir, every = 1500, now = () => new Date(), schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { dir, every, now, schedule, unschedule });
    this.timers = new Map(); this.writing = new Map(); this.dropped = new Set();
  }
  path(session) { return join(this.dir, `${safeName(session)}.json`); }
  // Rewritten at most every `every` ms while a turn runs; the first write is straight away.
  touch(run) {
    if (this.timers.has(run.session)) return;
    const first = !this.writing.has(run.session);
    const timer = this.schedule(() => { this.timers.delete(run.session); void this.save(run); }, first ? 0 : this.every);
    timer?.unref?.(); this.timers.set(run.session, timer);
  }
  async save(run) {
    if (this.dropped.has(run.session)) return;
    const write = (async () => {
      await this.writing.get(run.session);
      if (this.dropped.has(run.session)) return;
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const path = this.path(run.session), spare = `${path}.${process.pid}.tmp`;
      await writeFile(spare, JSON.stringify(checkpointOf(run, this.now())), { mode: 0o600 });
      await rename(spare, path);
    })().catch(error => console.warn('Could not save a work checkpoint:', error.message));
    this.writing.set(run.session, write);
    return write;
  }
  // The turn's reply is saved: its checkpoint goes. A run for the chat starting again clears this.
  async drop(session) {
    this.dropped.add(session);
    const timer = this.timers.get(session); if (timer) this.unschedule(timer); this.timers.delete(session);
    await this.writing.get(session); this.writing.delete(session);
    await rm(this.path(session), { force: true });
  }
  begin(run) { this.dropped.delete(run.session); this.writing.delete(run.session); this.touch(run); }
  async leftovers() {
    const names = await readdir(this.dir).catch(error => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
    const found = [];
    for (const name of names.filter(name => name.endsWith('.json'))) {
      try { found.push(JSON.parse(await readFile(join(this.dir, name), 'utf8'))); }
      catch { await rm(join(this.dir, name), { force: true }); }
    }
    return found.filter(entry => entry && typeof entry.session === 'string');
  }
}

const done = rows => rows.filter(row => row.status === 'done');
// What a turn cut off by Fairy closing says it did, from its checkpoint.
export function recoveredReply(checkpoint) {
  const rows = Array.isArray(checkpoint.rows) ? checkpoint.rows : [];
  const changed = [...new Set(done(rows).filter(row => ['write', 'edit'].includes(row.tool)).map(row => row.summary))], ran = rows.filter(row => row.tool === 'run' && row.status !== 'running').length;
  const did = [changed.length ? `changed ${changed.length} ${changed.length === 1 ? 'file' : 'files'} (${changed.slice(0, 6).join(', ')})` : '', ran ? `ran ${ran} ${ran === 1 ? 'command' : 'commands'}` : ''].filter(Boolean).join(' and ');
  return `Fairy closed before this turn finished. ${did ? `Before that, I ${did}.` : 'Nothing had changed yet.'}`;
}

// A checkpoint left behind becomes the turn's unfinished reply, unless that turn's reply was saved after all.
export function recoveredEntry(checkpoint, history = []) {
  if (checkpoint.at && history.some(entry => entry.role === 'assistant' && entry.replyTo === checkpoint.at)) return null;
  const last = history.at(-1);
  // Without the request's time, only a chat whose last message is still the unanswered request is recovered.
  if (!checkpoint.at && !(last?.role === 'user' && last.mode === 'work')) return null;
  return { role: 'assistant', content: recoveredReply(checkpoint), at: checkpoint.savedAt || new Date().toISOString(), ...(checkpoint.at ? { replyTo: checkpoint.at } : {}), mode: 'work',
    activity: Array.isArray(checkpoint.rows) ? checkpoint.rows : [], ...(checkpoint.tasks?.length ? { tasks: checkpoint.tasks } : {}), unfinished: true, ended: 'closed', ...(checkpoint.partial ? { partial: checkpoint.partial } : {}) };
}

// At start-up: every checkpoint left behind is turned into its chat's unfinished reply, then removed.
export async function recoverCheckpoints({ checkpoints, find, read, append }) {
  const recovered = [];
  for (const checkpoint of await checkpoints.leftovers()) {
    try {
      if (find(checkpoint.session)) {
        const entry = recoveredEntry(checkpoint, await read(checkpoint.session));
        if (entry) { await append(checkpoint.session, [entry]); recovered.push(checkpoint.session); }
      }
    } catch (error) { console.warn('Could not recover a work turn:', error.message); }
    await rm(checkpoints.path(checkpoint.session), { force: true });
  }
  return recovered;
}
