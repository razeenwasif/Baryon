// The thread that watches a quit (quit-watchdog.cjs). It needs nothing from the main thread to wake it or to end the
// process, so a main thread held by a modal dialog or synchronous work can't stop it.
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const { install: guardHelpers } = createRequire(import.meta.url)('./helper-guard.cjs') as { install: () => unknown };

interface QuitWatchWorkerData {
  limit: number;
  grace: number;
  log: string;
  note: string;
  pid: number;
}

interface StageRecord {
  stage: string;
  after: number;
}

interface StageMessage {
  type?: string;
  stage?: unknown;
  detail?: unknown;
}

guardHelpers();
const { limit, grace, log, note, pid } = workerData as QuitWatchWorkerData;
const started = Date.now(), stages: StageRecord[] = [];
let stage = 'quit started', detail: unknown = null;
// Synchronous, like every write a stuck quit makes: what's stuck may be what async writes wait on.
const write = (line: Record<string, unknown>): void => {
  try { appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), after: Date.now() - started, stage, ...(detail ? { detail } : {}), stages: stages.slice(-20), ...line })}\n`, { mode: 0o600 }); } catch {}
};
parentPort?.on('message', (message: StageMessage | null | undefined) => {
  if (message?.type !== 'stage') return;
  stage = String(message.stage); detail = message.detail ?? null;
  stages.push({ stage, after: Date.now() - started });
});
setTimeout(() => {
  write({ forced: 'exit', why: `The quit was still going after ${limit} ms.` });
  parentPort?.postMessage({ type: 'exit', stage });
  setTimeout(() => {
    write({ forced: 'kill', why: 'The main thread didn’t answer, so it was held (a modal dialog, or synchronous work).' });
    if (note) { try { writeFileSync(note, String(Date.now())); } catch {} }
    // Her helpers go with her rather than outliving her.
    try {
      const children = spawnSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 1000 }).stdout || '';
      for (const child of children.split(/\s+/).filter(Boolean)) { try { process.kill(Number(child), 'SIGTERM'); } catch {} }
    } catch {}
    process.kill(pid, 'SIGKILL');
  }, grace);
}, limit);
