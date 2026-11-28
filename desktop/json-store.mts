import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type AtomicJsonCommit = (path: string, text: string, step: (stage: string) => void) => Promise<void>;

export interface PendingJsonEntry {
  text: string;
  since: string;
  stage: string;
  promise: Promise<void>;
}

export interface PendingJsonDescription {
  file: string;
  since: string;
  stage: string;
}

// One unique sibling per transaction: a failed write never damages the old file.
// step: told each stage as it starts, so a save that never finishes can say where it stopped (quit-gate.cjs).
export async function atomicJSON(path: string, text: string, step: (stage: string) => void = () => {}): Promise<void> {
  step('mkdir'); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    step('open'); const handle = await open(temporary, 'wx', 0o600);
    try { step('write'); await handle.writeFile(text); step('sync'); await handle.sync(); }
    finally { step('close'); await handle.close(); }
    step('rename'); await rename(temporary, path);
  } finally { step('cleanup'); await rm(temporary, { force: true }); }
}

// Serialize per destination, not globally. Only identical adjacent pending
// snapshots share a commit; distinct history/credential updates are never dropped.
export class JSONWriter {
  commit: AtomicJsonCommit;
  pending: Map<string, PendingJsonEntry>;

  constructor(commit: AtomicJsonCommit = atomicJSON) {
    this.commit = commit;
    this.pending = new Map();
  }

  async write(path: string, value: unknown): Promise<void> {
    path = resolve(path);
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) throw new TypeError('Saved data must be JSON.');
    const previous = this.pending.get(path);
    if (previous?.text === text) return previous.promise;
    // stage: 'queued' behind an earlier save of the same file, then atomicJSON's steps.
    const entry: PendingJsonEntry = { text, since: new Date().toISOString(), stage: 'queued', promise: Promise.resolve() };
    entry.promise = (previous?.promise ?? Promise.resolve()).catch(() => {}).then(() => this.commit(path, text, stage => { entry.stage = stage; }));
    this.pending.set(path, entry);
    try { await entry.promise; }
    finally { if (this.pending.get(path) === entry) this.pending.delete(path); }
  }

  async flush(): Promise<void> {
    const errors: unknown[] = [];
    while (this.pending.size) {
      const results = await Promise.allSettled([...this.pending.values()].map(e => e.promise));
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
    }
    if (errors.length) throw new AggregateError(errors, 'Some pending app data could not be saved.');
  }

  // The saves not finished yet: which file, since when, and how far each got.
  describe(): PendingJsonDescription[] {
    return [...this.pending].map(([path, entry]) => ({ file: basename(path), since: entry.since, stage: entry.stage }));
  }
}

const writer = new JSONWriter();
export const writeJSON = (path: string, value: unknown): Promise<void> => writer.write(path, value);
export const flushJSON = (): Promise<void> => writer.flush();
export const hasPendingJSON = (): boolean => writer.pending.size > 0;
export const pendingJSON = (): PendingJsonDescription[] => writer.describe();
