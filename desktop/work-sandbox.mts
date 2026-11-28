import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, realpathSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { redactSecrets } from './secret-providers.mjs';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const MAX_OUTPUT = 64 * 1024;
export const DEFAULT_TIMEOUT = 120000, LONGEST_TIMEOUT = 600000;

export interface SeatbeltProfileOptions {
  root: string;
  temp: string;
  home?: string;
  network?: boolean;
  loopback?: boolean;
  shared?: readonly string[];
  gitCommon?: string;
  readable?: readonly string[];
}

export interface SandboxCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
}

export interface PlainCommandResult {
  exitCode: number | null;
  output: string;
}

export type SpawnProcessFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RunInSandboxOptions {
  command: string;
  cwd: string;
  network?: boolean;
  loopback?: boolean;
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (output: string) => void;
  spawnProcess?: SpawnProcessFn;
  home?: string;
  gitCommon?: string;
  readable?: readonly string[];
  extraEnv?: Record<string, string | undefined>;
  redactValues?: readonly unknown[];
}

export interface RunOutsideSandboxOptions {
  command: string;
  cwd: string;
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (output: string) => void;
  spawnProcess?: SpawnProcessFn;
  home?: string;
  extraEnv?: Record<string, string | undefined>;
  redactValues?: readonly unknown[];
}

export interface PlainCommandOptions {
  command: string;
  cwd: string;
  signal?: AbortSignal;
  spawnProcess?: SpawnProcessFn;
}

const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
const quoted = (path: string): string => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const regexEscape = (path: string): string => path.replace(/[.*+?^${}()|[\]\\/"]/g, '\\$&');
// The system services a command can talk to. The sandbox only limits a process and its children, so
// anything that asks another process to act (opening an app, launchd, Apple events, Shortcuts) would
// run outside it, and the clipboard and Spotlight would read past it. Everything not listed is refused.
const SYSTEM_SERVICES = ['com.apple.system.opendirectoryd.libinfo', 'com.apple.system.opendirectoryd.membership', 'com.apple.system.notification_center', 'com.apple.system.logger', 'com.apple.logd', 'com.apple.diagnosticd', 'com.apple.cfprefsd.daemon', 'com.apple.cfprefsd.agent', 'com.apple.SystemConfiguration.configd', 'com.apple.trustd', 'com.apple.trustd.agent', 'com.apple.FSEvents'];
const NETWORK_SERVICES = ['com.apple.dnssd.service', 'com.apple.networkd', 'com.apple.nsurlstorage-cache', 'com.apple.nsurlsessiond', 'com.apple.symptomsd', 'com.apple.usymptomsd', 'com.apple.SystemConfiguration.DNSConfiguration', 'com.apple.SystemConfiguration.NetworkInformation'];
const services = (network: boolean): string => [...SYSTEM_SERVICES, ...(network ? NETWORK_SERVICES : [])].map(name => `(global-name ${quoted(name)})`).join(' ');
// Compilers and interpreters people keep in their home folder. Settings and keys stay out of reach.
const TOOLCHAINS = ['.nvm', '.volta', '.fnm', '.bun', '.cargo', '.rustup', '.pyenv', '.rbenv', '.sdkman', '.local/bin', '.local/share/uv', '.local/share/mise', 'miniconda3', 'anaconda3', 'miniforge3', 'go'];
// Programs look at each folder on the way to their own, so those can be looked at but not into.
const ancestors = (path: string): string[] => path.split(sep).filter(Boolean).slice(0, -1).map((_, index, parts) => `${sep}${parts.slice(0, index + 1).join(sep)}`);
// Reads: the folder, toolchains and the system, not the rest of the home folder or anyone's temp files.
// Writes: the folder and this run's temp folder, except what would later run outside the sandbox.
// A chat's own checkout keeps its history in the original project's .git, without its hooks or settings,
// or what says where that history is, because those decide what runs outside the sandbox later.
export function seatbeltProfile({
  root,
  temp,
  home = homedir(),
  network = false,
  loopback = false,
  shared = [tmpdir(), '/private/tmp'],
  gitCommon = '',
  readable = [],
}: SeatbeltProfileOptions): string {
  const folder = real(root), scratch = real(temp), own = real(home), common = gitCommon ? real(gitCommon) : '';
  const reads = [...TOOLCHAINS.map(name => join(own, name)).filter(existsSync), ...readable].map(real);
  const ways = [...new Set([folder, scratch, ...reads, ...(common ? [common] : [])].flatMap(ancestors))].sort();
  const secrets = [`/\\.env$`, `/\\.env\\.(local|development|production|staging|test)$`].map(pattern => `(regex #"^${regexEscape(folder)}.*${pattern}")`);
  return ['(version 1)', '(allow default)', '(deny lsopen)', '(deny appleevent-send)', '(deny job-creation)', '(deny mach-lookup)', `(allow mach-lookup ${services(network)})`, '(deny signal)', '(allow signal (target same-sandbox))', network ? '' : '(deny network*)', loopback ? '(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))' : '', '(deny file-write*)',
    `(allow file-write* (subpath ${quoted(folder)}) (subpath ${quoted(scratch)})${common ? ` (subpath ${quoted(common)})` : ''} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
    `(deny file-write* (subpath ${quoted(join(folder, '.git/hooks'))}) (literal ${quoted(join(folder, '.git/config'))}))`,
    common ? `(deny file-write* (literal ${quoted(join(folder, '.git'))}) (subpath ${quoted(join(common, 'hooks'))}) (literal ${quoted(join(common, 'config'))}) (literal ${quoted(join(common, 'config.worktree'))}) (regex #"^${regexEscape(common)}/worktrees/[^/]+/(commondir|gitdir|config\\.worktree)$"))` : '',
    `(deny file-read* (subpath ${quoted(own)}))`,
    ...[...new Set(shared.map(real))].map(path => `(deny file-read* (subpath ${quoted(path)}))`),
    `(allow file-read* (subpath ${quoted(folder)}) (subpath ${quoted(scratch)})${common ? ` (subpath ${quoted(common)})` : ''} (literal ${quoted(join(own, '.gitconfig'))})${reads.map(path => ` (subpath ${quoted(path)})`).join('')})`,
    // Xcode's command-line shims keep a cache in the system temp folder, and complain without it.
    `(allow file-read* file-write* (regex #"^${regexEscape(real(tmpdir()))}/xcrun_db"))`,
    `(deny file-read* ${secrets.join(' ')})`,
    `(allow file-read-metadata ${[own, ...ways].map(path => `(literal ${quoted(path)})`).join(' ')})`,
  ].filter(Boolean).join('\n');
}
export function commandPath(home = homedir()): string {
  const nvm = join(home, '.nvm/versions/node');
  let node: string[] = [];
  try { node = readdirSync(nvm).sort().reverse().slice(0, 1).map(version => join(nvm, version, 'bin')); } catch {}
  return [...node, join(home, '.local/bin'), join(home, '.cargo/bin'), join(home, '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
}
// No API keys or tokens come along, and caches go in the temp folder rather than the home folder.
export const commandEnvironment = (temp: string, home = homedir()): Record<string, string> => ({ PATH: commandPath(home), HOME: home, LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: temp,
  npm_config_cache: join(temp, 'npm'), XDG_CACHE_HOME: join(temp, 'cache'), PYTHONDONTWRITEBYTECODE: '1', CARGO_HOME: join(temp, 'cargo'), GOCACHE: join(temp, 'go'), GIT_TERMINAL_PROMPT: '0', CI: '1' });

const keepEnds = (text: string): string => text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT / 2)}\n… ${text.length - MAX_OUTPUT} characters left out …\n${text.slice(-MAX_OUTPUT / 2)}`;

interface WatchCommandOptions {
  timeout: number;
  signal?: AbortSignal;
  onOutput?: (output: string) => void;
  redactValues?: readonly unknown[];
}

function watchCommand(
  start: () => ChildProcess,
  { timeout, signal, onOutput, redactValues = [] }: WatchCommandOptions,
): Promise<SandboxCommandResult> {
  return new Promise((resolve, reject) => {
    let output = '', settled = false, timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let outputTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEmit = 0;
    const child = start();
    const kill = (name: NodeJS.Signals) => {
      try {
        if (typeof child.pid === 'number') process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        try { child.kill(name); } catch {}
      }
    };
    const stopNow = () => { kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1500); killTimer.unref?.(); };
    const clean = (value: string) => keepEnds(redactValues?.length ? redactSecrets(value, redactValues) : value);
    const flushOutput = () => { outputTimer = null; if (!settled && onOutput) { lastEmit = Date.now(); onOutput(clean(output)); } };
    const finish = (error: Error | null, value?: SandboxCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outputTimer) clearTimeout(outputTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => { stopNow(); finish(new Error('Stopped.')); };
    const timer = setTimeout(() => { timedOut = true; stopNow(); }, Math.min(timeout, LONGEST_TIMEOUT));
    const chunk = (value: string | Buffer) => {
      if (output.length < MAX_OUTPUT * 4) output += String(value);
      if (!onOutput || settled) return;
      const wait = Math.max(0, 120 - (Date.now() - lastEmit));
      if (!wait) flushOutput();
      else if (!outputTimer) { outputTimer = setTimeout(flushOutput, wait); outputTimer.unref?.(); }
    };
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk); child.stderr?.on('data', chunk);
    child.on('error', error => finish(new Error(`Could not start the command: ${error.message}`)));
    child.on('close', (code, name) => { if (killTimer) clearTimeout(killTimer); finish(null, { exitCode: code, signal: name, timedOut, output: clean(output) }); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function runInSandbox({
  command,
  cwd,
  network = false,
  loopback = false,
  timeout = DEFAULT_TIMEOUT,
  signal,
  onOutput,
  spawnProcess = spawn,
  home = homedir(),
  gitCommon = '',
  readable = [],
  extraEnv = {},
  redactValues = [],
}: RunInSandboxOptions): Promise<SandboxCommandResult> {
  signal?.throwIfAborted();
  const temp = await mkdtemp(join(real(tmpdir()), 'fairy-work-'));
  try {
    const profile = seatbeltProfile({ root: cwd, temp, home, network, loopback, gitCommon, readable });
    return await watchCommand(() => spawnProcess(SANDBOX_EXEC, ['-p', profile, '/bin/zsh', '-f', '-c', command], { cwd, env: { ...commandEnvironment(temp, home), ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { timeout, signal, onOutput, redactValues });
  } finally { await rm(temp, { recursive: true, force: true }).catch(() => {}); }
}
// With the user's own access, for one command they've read and allowed. Fairy's own settings don't come along.
export const outsideEnvironment = (
  home = homedir(),
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string | undefined> => ({
  ...Object.fromEntries(['USER', 'LOGNAME', 'SHELL', 'SSH_AUTH_SOCK', 'TMPDIR'].filter(key => env[key]).map(key => [key, env[key]])),
  PATH: commandPath(home), HOME: home, LANG: env.LANG || 'en_US.UTF-8', GIT_TERMINAL_PROMPT: '0',
});
export async function runOutsideSandbox({
  command,
  cwd,
  timeout = DEFAULT_TIMEOUT,
  signal,
  onOutput,
  spawnProcess = spawn,
  home = homedir(),
  extraEnv = {},
  redactValues = [],
}: RunOutsideSandboxOptions): Promise<SandboxCommandResult> {
  signal?.throwIfAborted();
  return watchCommand(() => spawnProcess('/bin/zsh', ['-f', '-c', command], { cwd, env: { ...outsideEnvironment(home), ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { timeout, signal, onOutput, redactValues });
}
// Tried on this Mac before it's trusted: a write outside the folder and a network connection must both be refused.
export async function sandboxWorks({ home = homedir() }: { home?: string } = {}): Promise<boolean> {
  if (!existsSync(SANDBOX_EXEC)) return false;
  const root = await mkdtemp(join(real(tmpdir()), 'fairy-probe-')), outside = await mkdtemp(join(real(tmpdir()), 'fairy-probe-'));
  try {
    const allowed = await runInSandbox({ command: 'echo ok > inside.txt && cat inside.txt', cwd: root, home });
    const refused = await runInSandbox({ command: `echo no > ${JSON.stringify(join(outside, 'x'))}`, cwd: root, home });
    return allowed.exitCode === 0 && allowed.output.trim() === 'ok' && refused.exitCode !== 0 && !existsSync(join(outside, 'x'));
  } catch { return false; }
  finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
}
// A work session's folder can't be somewhere that holds everything, or Fairy's own data. A folder inside iCloud Drive
// is your documents, not settings, so it's allowed though iCloud Drive lives under Library (Electron's vault is there).
export function checkWorkFolder(folder: string, { home = homedir(), dataDir = '' }: { home?: string; dataDir?: string } = {}): string {
  const path = real(folder), own = real(home), data = dataDir ? real(dataDir) : '';
  const contains = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);
  if (path === '/' || contains(path, own)) throw new Error('Choose a project folder, not your whole home folder or disk.');
  if (data && (contains(path, data) || contains(data, path))) throw new Error('Choose a folder outside Fairy’s own data.');
  const inHome = relative(own, path);
  const inICloudDrive = /^Library\/Mobile Documents\/com~apple~CloudDocs\/[^/]/.test(inHome);
  if (inHome && !inHome.startsWith('..') && !inICloudDrive && /^(?:\.ssh|\.gnupg|\.aws|\.gemini|\.claude|\.codex|\.config|Library)(?:\/|$)/.test(inHome)) throw new Error('Choose a project folder, not one that holds your settings or keys.');
  return path;
}

// A command run where the sandbox can't be used (work-tools' runCommand when sandbox-exec isn't available): in the
// work folder, with no inherited API credentials, two minutes and 64 KiB of output at most. cwd is a scope default, not
// an OS sandbox; each command is reviewed first. (It was Project mode's, which work sessions replaced.)
export async function plainCommand({ command, cwd, signal, spawnProcess = spawn }: PlainCommandOptions): Promise<PlainCommandResult> {
  if (typeof command !== 'string' || !command.trim() || command.length > 8000 || command.includes('\0')) throw Error('Use a terminal command under 8,000 characters.');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let out = '', settled = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp' };
    const child = spawnProcess('/bin/zsh', ['-f', '-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (typeof child.pid === 'number') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        child.kill(sig);
      }
    };
    const finish = (error: Error | null, value?: PlainCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      killTimer.unref?.();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(Error('Command stopped.'));
    const timer = setTimeout(() => finish(Error('Command exceeded its two-minute limit.')), 120000);
    const chunk = (value: string | Buffer) => { if (settled) return; out += String(value); if (Buffer.byteLength(out) > 65536) finish(Error('Command output exceeded 64 KiB; narrow the command.')); };
    child.stdout?.on('data', chunk); child.stderr?.on('data', chunk); child.on('error', () => finish(Error('Could not launch the command.')));
    child.on('close', code => { if (settled) return; finish(null, { exitCode: code, output: out }); });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}
