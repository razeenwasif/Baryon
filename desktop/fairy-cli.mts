// Fairy CLI entrypoint & backwards-compatible exports (`pingFairy`, `runFairyWork`, `runCli`).
import { resolve } from 'node:path';
import { CLI_HELP, executeCli, parseCliArgs, type ExecuteCliIo } from './cli/commands.mjs';
import {
  pingSocket,
  socketStreamTurn,
  type SocketHelloData,
  type SocketTurnEvent,
  type SocketTurnResult,
} from './cli/client.mjs';
import { defaultCliSocketPath, defaultDataDir, defaultSocketPath } from './cli/paths.mjs';

export { CLI_HELP, defaultDataDir, defaultSocketPath, defaultCliSocketPath, parseCliArgs };
export type RunCliIo = ExecuteCliIo;

export interface PingFairyOptions {
  socketPath?: string;
  timeoutMs?: number;
}

export interface RunFairyWorkOptions {
  socketPath?: string;
  folder?: string;
  prompt?: string;
  context?: string;
  chat?: string | null;
  mode?: 'edit' | 'read' | string;
  id?: string;
  signal?: AbortSignal | null;
  onEvent?: (event: SocketTurnEvent) => void;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

/** Pings a running Fairy Unix socket (`electron.sock` or `cli.sock`). */
export function pingFairy({ socketPath = defaultSocketPath(), timeoutMs = 5000 }: PingFairyOptions = {}): Promise<SocketHelloData> {
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
}: RunFairyWorkOptions = {}): Promise<SocketTurnResult> {
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

export async function runCli(argv: readonly string[] = [], io: RunCliIo = {}): Promise<number> {
  const stderr = io.stderr ?? process.stderr;
  let opts: ReturnType<typeof parseCliArgs>;
  try {
    opts = parseCliArgs(argv as string[]);
  } catch (error: unknown) {
    stderr.write(`Error: ${errorMessage(error)}\n`);
    return 1;
  }
  try {
    return await executeCli(opts, io);
  } catch (error: unknown) {
    stderr.write(`Error: ${errorMessage(error)}\n`);
    return 1;
  }
}
