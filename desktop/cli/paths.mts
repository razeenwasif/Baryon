// Shared path helpers for the Fairy CLI and headless/MCP entrypoints.
import { homedir } from 'node:os';
import { join } from 'node:path';

export type EnvMap = Record<string, string | undefined>;

export function defaultDataDir(env: EnvMap = process.env, home: string = homedir()): string {
  return (
    env.FAIRY_DATA_DIR ||
    env.LYRA_DATA_DIR ||
    env.STELLA_DATA_DIR ||
    join(home, 'Library', 'Application Support', 'lyra-companion', 'lyra')
  );
}

/** Legacy/Notes socket (`electron.sock`), kept for `runFairyWork` / `pingFairy` compatibility. */
export function defaultSocketPath(env: EnvMap = process.env, home: string = homedir()): string {
  return env.FAIRY_SOCKET || join(defaultDataDir(env, home), 'electron.sock');
}

/** Full Fairy CLI socket (`cli.sock`) on both Body and Face Macs. */
export function defaultCliSocketPath(env: EnvMap = process.env, home: string = homedir()): string {
  return env.FAIRY_CLI_SOCKET || env.FAIRY_SOCKET || join(defaultDataDir(env, home), 'cli.sock');
}
