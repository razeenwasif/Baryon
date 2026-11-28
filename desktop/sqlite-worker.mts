import { Worker } from 'node:worker_threads';

export type SqliteOp = 'exec' | 'get' | 'all' | 'run' | 'checkpoint' | 'close';

export interface SqliteWorkerMessage {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface SqliteWorkerClient {
  exec: (sql: string) => Promise<unknown>;
  get: (sql: string, params?: readonly unknown[]) => Promise<any>;
  all: (sql: string, params?: readonly unknown[]) => Promise<any[]>;
  run: (sql: string, params?: readonly unknown[]) => Promise<any>;
  checkpoint: () => Promise<unknown>;
  close: () => Promise<void>;
}

/**
 * Off-main-thread `node:sqlite` WAL + `checkpoint_fullfsync = ON` client backed by a dedicated Worker.
 */
export function openSqliteWorker(dbPath = ':memory:'): SqliteWorkerClient {
  const worker = new Worker(new URL('./sqlite-worker-entry.mjs', import.meta.url), {
    workerData: { dbPath },
  });
  let nextId = 1;
  let closed = false;
  const inflight = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  worker.on('message', (msg: SqliteWorkerMessage) => {
    const entry = msg?.id !== undefined ? inflight.get(msg.id) : undefined;
    if (!entry) return;
    inflight.delete(msg.id!);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'SQLite worker error'));
  });

  const failAll = (err: Error): void => {
    closed = true;
    for (const [, entry] of inflight.entries()) entry.reject(err);
    inflight.clear();
  };

  worker.on('error', failAll);
  worker.on('exit', code => {
    if (code !== 0) failAll(new Error(`SQLite worker exited with code ${code}`));
  });

  function call<T = unknown>(op: SqliteOp, sql = '', params: readonly unknown[] = []): Promise<T> {
    if (closed) return Promise.reject(new Error('SQLite worker is closed.'));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      inflight.set(id, { resolve, reject });
      worker.postMessage({ id, op, sql, params });
    });
  }

  return {
    exec: sql => call('exec', sql),
    get: (sql, params = []) => call('get', sql, params),
    all: (sql, params = []) => call('all', sql, params),
    run: (sql, params = []) => call('run', sql, params),
    checkpoint: () => call('checkpoint'),
    async close() {
      if (closed) return;
      try { await call('close'); } finally { closed = true; await worker.terminate(); }
    },
  };
}
