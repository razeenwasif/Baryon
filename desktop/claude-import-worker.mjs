import { parentPort, workerData } from 'node:worker_threads';
import { install as guardHelpers } from './helper-guard.cjs';
import { convertSessions } from './claude-import.mjs';
// A worker has its own child_process, so it puts the guard on too (helper-guard.cjs).
guardHelpers();

const result = await convertSessions({ ...workerData, onProgress: progress => parentPort.postMessage({ progress }) });
parentPort.postMessage({ result });
