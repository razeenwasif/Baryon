// The worker half of `Fairy --self-check` (self-check.cjs): what her real workers do, in small. It's loaded from the
// archive, imports another module from it, reads a file in it, finds a helper program beside it, and puts the helper
// guard on its own child_process.
import { parentPort } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { access, readFile, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { install: guardHelpers } = require('./helper-guard.cjs') as { install: () => { enforcing: boolean } };
const { nativeBin } = require('./bundle-path.cjs') as {
  nativeBin: (name: string) => string;
};
const { resolveAppRoot } = require('./app-root.cjs') as {
  resolveAppRoot(fromDir: string): string;
};

try {
  const guard = guardHelpers();
  await readFile(join(resolveAppRoot(dirname(fileURLToPath(import.meta.url))), 'package.json'), 'utf8');
  await access(nativeBin('fairy-document'), constants.X_OK);
  // `spawn` was imported before the guard went on; it has to be the guarded one all the same.
  parentPort!.postMessage({
    ok: true,
    enforcing: guard.enforcing,
    guarded: Boolean((spawn as typeof spawn & { fairyGuarded?: boolean }).fairyGuarded),
  });
} catch (error: unknown) {
  const message = (error && typeof error === 'object' && 'message' in error ? (error as { message?: unknown }).message : undefined) || error;
  parentPort!.postMessage({ ok: false, error: String(message) });
}
