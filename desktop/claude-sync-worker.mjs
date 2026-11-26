// Claude sync's heavy part, off the face's main thread: reading Claude Code's history, and building chats from it.
import { parentPort, workerData } from 'node:worker_threads';
import { install as guardHelpers } from './helper-guard.cjs';
import { convertSessions, findSessions } from './claude-import.mjs';
import { scanArtifacts } from './claude-sync.mjs';
// A worker has its own child_process, so it puts the guard on too (helper-guard.cjs).
guardHelpers();

try {
  const { task, claudeDir, desktopDir, dropDir } = workerData;
  const where = { ...(claudeDir ? { claudeDir } : {}), ...(desktopDir ? { desktopDir } : {}) };
  const result = task === 'convert' ? await convertSessions(workerData) : { ...(await findSessions(where)), ...(await scanArtifacts({ ...where, dropDir, cache: workerData.cache })) };
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: String(error?.message || error) }); }
