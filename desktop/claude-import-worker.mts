import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
const { install: guardHelpers } = createRequire(import.meta.url)('./helper-guard.cjs') as { install: () => unknown };
import { convertSessions, type ConvertSessionsOptions } from './claude-import.mjs';
// A worker has its own child_process, so it puts the guard on too (helper-guard.cjs).
guardHelpers();

const result = await convertSessions({ ...(workerData as Omit<ConvertSessionsOptions, 'onProgress'>), onProgress: progress => parentPort!.postMessage({ progress }) });
parentPort!.postMessage({ result });
