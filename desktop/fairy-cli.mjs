// Fairy CLI entrypoint & backwards-compatible exports (`pingFairy`, `runFairyWork`, `runCli`).
import { resolve } from 'node:path';
import { CLI_HELP, executeCli, parseCliArgs } from './cli/commands.mjs';
import { pingSocket, socketStreamTurn } from './cli/client.mjs';
import { defaultCliSocketPath, defaultDataDir, defaultSocketPath } from './cli/paths.mjs';

export { CLI_HELP, defaultDataDir, defaultSocketPath, defaultCliSocketPath, parseCliArgs };

/** Pings a running Fairy Unix socket (`electron.sock` or `cli.sock`). */
export function pingFairy({ socketPath = defaultSocketPath(), timeoutMs = 5000 } = {}) {
  return pingSocket(socketPath, timeoutMs);
}

/** Runs a one-shot work session over Fairy's local Unix socket (`electron.sock` or `cli.sock`). */
export function runFairyWork({
  socketPath = defaultSocketPath(),
  folder = process.cwd(),
  prompt,
  context = '',
  chat = null,
  mode = 'edit',
  id,
  signal = null,
  onEvent = () => {},
} = {}) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanPrompt) return Promise.reject(new Error('Provide a prompt for Fairy.'));
  if (mode !== 'edit' && mode !== 'read') return Promise.reject(new Error('Mode must be "edit" or "read".'));
  return socketStreamTurn({
    socketPath,
    type: 'work',
    payload: {
      folder: resolve(String(folder || process.cwd())),
      prompt: cleanPrompt,
      ...(context ? { context } : {}),
      ...(chat ? { chat } : {}),
      mode,
    },
    ...(id ? { id } : {}),
    signal,
    onEvent,
  });
}

export async function runCli(argv = [], io = {}) {
  const stderr = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
  try {
    return await executeCli(opts, io);
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}
