import { Worker } from 'node:worker_threads';

/**
 * Off-main-thread `node:sqlite` WAL + `checkpoint_fullfsync = ON` client backed by a dedicated Worker.
 */
export function openSqliteWorker(dbPath = ':memory:') {
  const worker = new Worker(new URL('./sqlite-worker-entry.mjs', import.meta.url), {
    workerData: { dbPath },
  });
  let nextId = 1;
  let closed = false;
  const inflight = new Map();

  worker.on('message', msg => {
    const entry = inflight.get(msg?.id);
    if (!entry) return;
    inflight.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'SQLite worker error'));
  });

  const failAll = err => {
    closed = true;
    for (const [, entry] of inflight.entries()) entry.reject(err);
    inflight.clear();
  };

  worker.on('error', failAll);
  worker.on('exit', code => {
    if (code !== 0) failAll(new Error(`SQLite worker exited with code ${code}`));
  });

  function call(op, sql = '', params = []) {
    if (closed) return Promise.reject(new Error('SQLite worker is closed.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
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
