import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
const { install: guardHelpers } = createRequire(import.meta.url)('./helper-guard.cjs') as { install: () => unknown };
guardHelpers();

interface SqliteWorkerRequest {
  id?: number;
  op?: string;
  sql?: string;
  params?: SQLInputValue[];
}

const dbPath: string = (workerData as { dbPath?: string } | null | undefined)?.dbPath || ':memory:';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = FULL;');
db.exec('PRAGMA checkpoint_fullfsync = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

function handleMessage(msg: SqliteWorkerRequest | null | undefined): void {
  const { id, op, sql = '', params = [] } = msg || {};
  try {
    let result: unknown;
    if (op === 'exec') {
      db.exec(sql);
      result = { ok: true };
    } else if (op === 'get') {
      const stmt = db.prepare(sql);
      result = stmt.get(...params) ?? null;
    } else if (op === 'all') {
      const stmt = db.prepare(sql);
      result = stmt.all(...params);
    } else if (op === 'run') {
      const stmt = db.prepare(sql);
      result = stmt.run(...params);
    } else if (op === 'checkpoint') {
      result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    } else if (op === 'close') {
      db.close();
      result = { closed: true };
    } else {
      throw new Error(`Unknown sqlite worker op: ${op}`);
    }
    parentPort!.postMessage({ id, ok: true, result });
    if (op === 'close') parentPort!.close();
  } catch (error: unknown) {
    const err = error as { message?: string };
    parentPort!.postMessage({ id, ok: false, error: err?.message || String(error) });
  }
}

parentPort!.on('message', handleMessage);
