// The worker half of `Fairy --self-check` (self-check.cjs): what her real workers do, in small. It's loaded from the
// archive, imports another module from it, reads a file in it, finds a helper program beside it, and puts the helper
// guard on its own child_process.
import { parentPort } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { access, readFile, constants } from 'node:fs/promises';
import { nativeBin } from './bundle-path.cjs';
import { install as guardHelpers } from './helper-guard.cjs';

try {
  const guard = guardHelpers();
  await readFile(new URL('../package.json', import.meta.url), 'utf8');
  await access(nativeBin('fairy-document'), constants.X_OK);
  // `spawn` was imported before the guard went on; it has to be the guarded one all the same.
  parentPort.postMessage({ ok: true, enforcing: guard.enforcing, guarded: Boolean(spawn.fairyGuarded) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error?.message || error) });
}
