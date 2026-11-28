// Claude sync's heavy part, off the face's main thread: reading Claude Code's history, and building chats from it.
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
const { install: guardHelpers } = createRequire(import.meta.url)('./helper-guard.cjs') as { install: () => unknown };
import { convertSessions, findSessions } from './claude-import.mjs';
import { scanArtifacts, type ClaudeSyncWorkerData } from './claude-sync.mjs';
// A worker has its own child_process, so it puts the guard on too (helper-guard.cjs).
guardHelpers();

try {
  const data = workerData as ClaudeSyncWorkerData;
  const result = data.task === 'convert'
    ? await convertSessions(data)
    : {
        ...(await findSessions({ ...(data.claudeDir ? { claudeDir: data.claudeDir } : {}), ...(data.desktopDir ? { desktopDir: data.desktopDir } : {}) })),
        ...(await scanArtifacts({ ...(data.claudeDir ? { claudeDir: data.claudeDir } : {}), ...(data.desktopDir ? { desktopDir: data.desktopDir } : {}), dropDir: data.dropDir, cache: data.cache })),
      };
  parentPort!.postMessage({ result });
} catch (error: unknown) { parentPort!.postMessage({ error: String((error as { message?: unknown } | null | undefined)?.message || error) }); }
