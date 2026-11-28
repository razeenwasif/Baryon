import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAFE_HOST_SPEC = /^[A-Za-z0-9._-]+(?:@[A-Za-z0-9._:-]+)?$/;

export type StrictHostKeyCheckingPolicy = 'yes' | 'no' | 'accept-new';

export interface BuildSshArgsOptions {
  host?: unknown;
  port?: number | string;
  command?: string;
  batchMode?: boolean;
  strictHostKeyChecking?: StrictHostKeyCheckingPolicy | string;
  connectTimeout?: number | string;
  identityFile?: string;
  knownHostsFile?: string;
}

export interface AskpassEnv {
  scriptPath: string;
  env: {
    SSH_ASKPASS: string;
    SSH_ASKPASS_REQUIRE: 'force';
    FAIRY_ASKPASS_SECRET: string;
  };
  cleanup: () => Promise<void>;
}

/**
 * Validates `[user@]host` rejecting leading `-` option injection and shell metacharacters.
 */
export function sanitizeHostSpec(host: unknown): string {
  const raw = String(host ?? '').trim();
  if (!raw || raw.startsWith('-') || raw.includes('..') || raw.includes('\0') || !SAFE_HOST_SPEC.test(raw)) {
    throw new Error('Unsafe SSH host specification.');
  }
  const hostPart = raw.includes('@') ? raw.split('@').pop() : raw;
  if (!hostPart || hostPart.startsWith('-')) throw new Error('Unsafe SSH host name.');
  return raw;
}

/**
 * Builds an injection-safe argv list for `execFile('ssh', args)` with `--` terminator.
 */
export function buildSshArgs({
  host,
  port = 22,
  command = '',
  batchMode = true,
  strictHostKeyChecking = 'yes',
  connectTimeout = 10,
  identityFile = '',
  knownHostsFile = '',
}: BuildSshArgsOptions = {}): string[] {
  const cleanHost = sanitizeHostSpec(host);
  const cleanPort = Math.floor(Number(port) || 22);
  if (cleanPort < 1 || cleanPort > 65535) throw new Error('Invalid SSH port.');
  if (!['yes', 'no', 'accept-new'].includes(strictHostKeyChecking)) {
    throw new Error('Invalid StrictHostKeyChecking policy.');
  }

  const args = [
    '-p', String(cleanPort),
    '-o', `BatchMode=${batchMode ? 'yes' : 'no'}`,
    '-o', `StrictHostKeyChecking=${strictHostKeyChecking}`,
    '-o', `ConnectTimeout=${Math.max(1, Math.min(120, Math.floor(Number(connectTimeout) || 10)))}`,
  ];

  const safeOptPath = (flag: string, val: unknown) => {
    const clean = String(val ?? '').trim();
    if (!clean) return;
    if (clean.startsWith('-') || /[\r\n\0]/.test(clean)) throw new Error(`Unsafe path for ${flag}.`);
    args.push(flag, clean);
  };
  safeOptPath('-i', identityFile);
  if (knownHostsFile) {
    const kh = String(knownHostsFile).trim();
    if (kh.startsWith('-') || /[\r\n\0]/.test(kh)) throw new Error('Unsafe UserKnownHostsFile path.');
    args.push('-o', `UserKnownHostsFile=${kh}`);
  }

  args.push('--', cleanHost);
  if (typeof command === 'string' && command.trim()) {
    if (/\0/.test(command)) throw new Error('Invalid SSH command.');
    args.push(command);
  }
  return args;
}

/**
 * Creates an ephemeral `0700` askpass script supplying `secret` via env (never CLI args).
 */
export async function createAskpassEnv(secret: unknown): Promise<AskpassEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-askpass-'));
  const scriptPath = join(dir, 'askpass.sh');
  const script = '#!/bin/sh\nprintf \'%s\\n\' "$FAIRY_ASKPASS_SECRET"\n';
  await writeFile(scriptPath, script, { mode: 0o700 });
  return {
    scriptPath,
    env: {
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
      FAIRY_ASKPASS_SECRET: String(secret ?? ''),
    },
    cleanup: async () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}
