// Argument parser and Phase 1 + Phase 2 command handlers for the Fairy CLI.
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readlink, symlink, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFairyMcpServer } from '../fairy-mcp.mjs';
import { resolveCliBackend } from './client.mjs';
import { defaultCliSocketPath, defaultDataDir, defaultSocketPath } from './paths.mjs';
import {
  formatApprovalBox,
  formatDim,
  formatError,
  formatHeading,
  formatMarkdown,
  formatStep,
  formatSuccess,
  formatTable,
} from './render.mjs';
import {
  startRepl,
  type ReplAskChatRequest,
  type ReplBackend,
  type ReplRunWorkRequest,
  type ReplStreamInput,
  type ReplStreamOutput,
  type ReplTurnEvent,
  type ReplTurnResult,
} from './repl.mjs';
import { createSpinner, renderSprite, useColor } from './sprite.mjs';

const { resolveAppRoot } = createRequire(import.meta.url)('../app-root.cjs') as {
  resolveAppRoot(fromDir: string): string;
};

export type CliPermissionMode = 'edit' | 'read';

export type CliNonHelpCommand =
  | 'repl'
  | 'status'
  | 'doctor'
  | 'mcp'
  | 'run'
  | 'work'
  | 'chat'
  | 'ask'
  | 'sessions'
  | 'models'
  | 'usage'
  | 'recall'
  | 'memory'
  | 'journal'
  | 'notes'
  | 'today'
  | 'goals'
  | 'promises'
  | 'auth'
  | 'plugins'
  | 'install-cli';

export type CliCommand = 'help' | CliNonHelpCommand;

export interface CliHelpOptions {
  command: 'help';
  json?: boolean;
}

export interface CliParsedOptions {
  command: CliNonHelpCommand;
  subcommand: string;
  args: string[];
  folder: string;
  mode: CliPermissionMode;
  chat: string;
  model: string;
  provider: string;
  kind: string;
  title: string;
  tried: string;
  outcome: string;
  decision: string;
  limit: number;
  startLine: number;
  maxLines: number;
  context: string;
  contextFile: string;
  socket: string;
  dataDir: string;
  work: boolean;
  headless: boolean;
  attached: boolean;
  yes: boolean;
  force: boolean;
  json: boolean;
  quiet: boolean;
  prompt: string;
}

export type CliOptions = CliHelpOptions | CliParsedOptions;

export interface CliRunWorkRequest extends ReplRunWorkRequest {
  context?: string;
}

export interface CliAskChatRequest extends ReplAskChatRequest {
  context?: string;
}

export interface CliBackend extends Omit<ReplBackend, 'runWork' | 'askChat'> {
  runWork(req: CliRunWorkRequest, onEvent: (ev: ReplTurnEvent) => void): Promise<ReplTurnResult>;
  askChat(req: CliAskChatRequest, onEvent: (ev: ReplTurnEvent) => void): Promise<ReplTurnResult>;
  close?(): Promise<void>;
  stop?(id?: string): void;
}

export interface ExecuteCliIo {
  stdin?: ReplStreamInput;
  stdout?: ReplStreamOutput;
  stderr?: ReplStreamOutput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: (() => string) | string;
  home?: string;
  handleSignals?: boolean;
  openUrl?: ((url: string) => Promise<unknown>) | null;
  providers?: Record<string, unknown> | null;
  promptApproval?: ((req: unknown) => Promise<string>) | null;
}

interface InstallCliSymlinkResult {
  installed: boolean;
  linkPath: string;
  target: string;
  alreadyLinked: boolean;
}

interface CliPingResult {
  name?: string;
  provider?: string;
  mode?: string;
  error?: string;
  [key: string]: unknown;
}

interface DoctorStatusResult {
  workProvider?: string;
  workModel?: string;
  error?: string;
  [key: string]: unknown;
}

interface AuthStatusResult {
  googleAccount?: { connected?: boolean; email?: string };
  claude?: { connected?: boolean; plan?: string; error?: string };
  antigravity?: { connected?: boolean; models?: unknown[] };
  codex?: { connected?: boolean; plan?: string };
  [key: string]: unknown;
}

interface SessionRow {
  id?: string;
  title?: string;
  turns?: number;
  workPath?: string;
}

interface SessionHitRow {
  sessionId?: string;
  title?: string;
  excerpt?: string;
}

interface ModelRow {
  id?: string;
  name?: string;
}

interface ModelTableRow {
  provider: string;
  id?: string;
  name?: string;
}

interface MemoryRow {
  kind?: string;
  text?: string;
}

interface JournalProjectRow {
  folder?: string;
  count?: number;
  lastAt?: string;
}

interface JournalEntryRow {
  date?: string;
  title?: string;
  decision?: string;
  outcome?: string;
}

interface NoteHitRow {
  path?: string;
  line?: number;
  heading?: string;
  excerpt?: string;
}

interface CalendarEventRow {
  start?: string;
  title?: string;
}

interface GoalRow {
  id?: string;
  state?: string;
  outcome?: string;
}

interface PromiseRow {
  id?: string;
  due?: string;
  what?: string;
}

interface PluginConnectResult {
  id?: string;
  name?: string;
  added?: boolean;
  alreadyConnected?: boolean;
  authUrl?: string;
}

interface PluginSsoRow {
  id?: string;
  name?: string;
  authUrl?: string;
}

interface PluginConnectorRow {
  name?: string;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String((err as { message?: unknown } | null)?.message ?? err ?? ''));

export const CLI_HELP = `Baryon CLI

Usage:
  baryon [options]                          Open interactive Baryon work REPL (alias: fairy)
  baryon work [options] [prompt...]         Interactive or one-shot work session in a folder
  baryon run [options] [prompt...]          One-shot work session (Claude/Codex/Gemini)
  baryon chat | ask [options] [prompt...]   Plain chat session (interactive or one-shot)
  baryon sessions [list|show|search|rename|fork|compact]
  baryon models [list|set <id>]
  baryon usage [--force]
  baryon status | doctor
  baryon recall <query> [--folder dir]
  baryon memory [list|add <text>|search <q>] [--kind work|you|projects|self]
  baryon journal [list|add] [--folder dir] [--title ...] [--tried ...] [--outcome ...] [--decision ...]
  baryon notes [search <q>|read <path>]
  baryon today [--force]
  baryon goals [list|add <outcome>|continue <id>]
  baryon promises [list|done <id>]
  baryon auth [status|refresh]
  baryon plugins [status|connect <id...>]
  baryon mcp [--data-dir PATH]              Read-only stdio MCP server (alias: baryon-mcp)
  baryon install-cli                        Install \`baryon\` & \`fairy\` symlinks into ~/.local/bin
  baryon help                               Show this help

Options:
  -C, --folder PATH      Project folder (default: current working directory)
      --mode edit|read   'edit' (sandboxed auto) or 'read' (Plan mode, alias: --read, --plan)
      --chat ID          Continue an existing session
      --model MODEL      Override model for this turn
      --provider NAME    Override provider (claude, gemini, codex)
      --context TEXT     Extra context prefixed for the model (not saved in chat)
      --context-file F   Read extra context from file F
  -p, --prompt TEXT      Prompt text (can also be positional args or piped via stdin)
      --socket PATH      Override cli.sock / electron.sock path
      --data-dir PATH    Override Baryon data directory
      --headless         Run standalone headless backend directly against dataDir
      --attached         Require a running Baryon desktop app (fail instead of headless fallback)
  -y, --yes              Auto-allow approvals in non-interactive headless mode
      --json             Emit raw JSON / NDJSON events to stdout
  -q, --quiet            Suppress step/spinner progress on stderr
`;

const KNOWN_COMMANDS = new Set<string>([
  'help',
  'status',
  'doctor',
  'mcp',
  'run',
  'work',
  'chat',
  'ask',
  'sessions',
  'models',
  'usage',
  'recall',
  'memory',
  'journal',
  'notes',
  'today',
  'goals',
  'promises',
  'auth',
  'plugins',
  'install-cli',
]);

export function parseCliArgs(argv: readonly string[] = []): CliOptions {
  const args = Array.isArray(argv) ? [...argv] : [];
  const opts: CliParsedOptions = {
    command: 'repl',
    subcommand: '',
    args: [],
    folder: '',
    mode: 'edit',
    chat: '',
    model: '',
    provider: '',
    kind: '',
    title: '',
    tried: '',
    outcome: '',
    decision: '',
    limit: 0,
    startLine: 1,
    maxLines: 120,
    context: '',
    contextFile: '',
    socket: '',
    dataDir: '',
    work: false,
    headless: false,
    attached: false,
    yes: false,
    force: false,
    json: false,
    quiet: false,
    prompt: '',
  };

  if (!args.length) return opts;

  const first = args[0];
  let idx = 0;
  if (first === 'help' || first === '--help' || first === '-h') return { command: 'help' };
  if (first === 'ping') {
    opts.command = 'status';
    idx = 1;
  } else if (KNOWN_COMMANDS.has(first)) {
    opts.command = first as CliNonHelpCommand;
    idx = 1;
  } else if (!first.startsWith('-')) {
    // Bare `fairy "fix tests"` starts a work run immediately.
    opts.command = 'run';
  }

  const positional: string[] = [];
  const takeValue = (flag: string): string => {
    idx += 1;
    if (idx >= args.length) throw new Error(`Missing value for ${flag}`);
    return args[idx];
  };

  for (; idx < args.length; idx += 1) {
    const token = args[idx];
    if (token === '--') {
      positional.push(...args.slice(idx + 1));
      break;
    }
    if (token === '--help' || token === '-h') return { command: 'help' };
    if (token === '--json') opts.json = true;
    else if (token === '--quiet' || token === '-q' || token === '--no-stream') opts.quiet = true;
    else if (token === '--read' || token === '--plan') opts.mode = 'read';
    else if (token === '--edit') opts.mode = 'edit';
    else if (token === '--headless') opts.headless = true;
    else if (token === '--attached') opts.attached = true;
    else if (token === '--yes' || token === '-y') opts.yes = true;
    else if (token === '--force') opts.force = true;
    else if (token === '--work') opts.work = true;
    else if (token === '--folder' || token === '-C') opts.folder = takeValue(token);
    else if (token === '--mode') {
      const val = takeValue(token);
      if (val !== 'edit' && val !== 'read') throw new Error(`Invalid mode "${val}": expected "edit" or "read".`);
      opts.mode = val;
    } else if (token === '--chat') opts.chat = takeValue(token);
    else if (token === '--model') opts.model = takeValue(token);
    else if (token === '--provider') opts.provider = takeValue(token);
    else if (token === '--kind') opts.kind = takeValue(token);
    else if (token === '--title') opts.title = takeValue(token);
    else if (token === '--tried') opts.tried = takeValue(token);
    else if (token === '--outcome') opts.outcome = takeValue(token);
    else if (token === '--decision') opts.decision = takeValue(token);
    else if (token === '--limit') opts.limit = Number(takeValue(token)) || 0;
    else if (token === '--start-line') opts.startLine = Number(takeValue(token)) || 1;
    else if (token === '--max-lines') opts.maxLines = Number(takeValue(token)) || 120;
    else if (token === '--context') opts.context = takeValue(token);
    else if (token === '--context-file') opts.contextFile = takeValue(token);
    else if (token === '--socket') opts.socket = takeValue(token);
    else if (token === '--data-dir') opts.dataDir = takeValue(token);
    else if (token === '--prompt' || token === '-p') opts.prompt = takeValue(token);
    else if (token.startsWith('--') || (token.startsWith('-') && token.length > 1)) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }

  opts.args = positional;
  if (['sessions', 'models', 'memory', 'journal', 'notes', 'goals', 'promises', 'auth', 'plugins'].includes(opts.command)) {
    opts.subcommand = positional[0] || '';
    opts.args = positional.slice(1);
  }
  if (!opts.prompt && positional.length) {
    opts.prompt = positional.join(' ');
  }
  return opts;
}

async function readStreamText(stream: ReplStreamInput | null | undefined): Promise<string> {
  if (!stream || stream.isTTY) return '';
  let text = '';
  stream.setEncoding?.('utf8');
  for await (const chunk of stream) text += String(chunk);
  return text.trim();
}

function defaultOpenUrl(url: string): Promise<void> {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:') {
    throw new Error('Refusing non-HTTPS sign-in URL.');
  }
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(cmd, [parsed.href], { stdio: 'ignore', detached: true });
    child.on('error', rejectPromise);
    child.unref?.();
    resolvePromise();
  });
}

async function installCliSymlink({ home = homedir() }: { home?: string } = {}): Promise<InstallCliSymlinkResult> {
  const repoRoot = resolveAppRoot(dirname(fileURLToPath(import.meta.url)));
  const localBin = join(home, '.local', 'bin');
  await mkdir(localBin, { recursive: true });
  const linkOne = async (name: string): Promise<InstallCliSymlinkResult> => {
    const binPath = join(repoRoot, 'bin', name);
    await chmod(binPath, 0o755);
    const linkPath = join(localBin, name);
    try {
      const stat = await lstat(linkPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        const existing = stat.isSymbolicLink() ? await readlink(linkPath).catch(() => '') : '';
        if (existing === binPath) return { installed: true, linkPath, target: binPath, alreadyLinked: true };
        await unlink(linkPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
    await symlink(binPath, linkPath);
    return { installed: true, linkPath, target: binPath, alreadyLinked: false };
  };
  const primary = await linkOne('baryon');
  for (const extra of ['baryon-mcp', 'fairy', 'fairy-mcp']) await linkOne(extra).catch(() => {});
  return primary;
}

interface RunSingleTurnOptions {
  backend: CliBackend;
  kind?: 'work' | 'chat';
  opts: CliParsedOptions;
  prompt: string;
  context: string;
  cwd: string;
  stdout: ReplStreamOutput;
  stderr: ReplStreamOutput;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  handleSignals: boolean;
}

async function runSingleTurn({ backend, kind = 'work', opts, prompt, context, cwd, stdout, stderr, env, handleSignals }: RunSingleTurnOptions): Promise<number> {
  const folder = resolve(cwd, opts.folder || '.');
  const color = useColor(stdout, env);
  const stderrColor = useColor(stderr, env);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (handleSignals) {
    process.on('SIGINT', abort);
    process.on('SIGTERM', abort);
  }

  const seenSteps = new Map<string, string>();
  const spinner = !opts.json && !opts.quiet && Boolean(stderr?.isTTY)
    ? createSpinner({ stream: stderr, color: stderrColor })
    : null;
  spinner?.start(kind === 'chat' ? 'Thinking…' : 'Starting Baryon…', 'thinking');

  const onEvent = (msg: ReplTurnEvent): void => {
    if (opts.json) {
      stdout.write(`${JSON.stringify(msg)}\n`);
      return;
    }
    if (opts.quiet) return;
    if (msg.type === 'started') {
      spinner?.pause();
      stderr.write(`[chat ${msg.chat}] started${kind === 'work' ? ` in ${folder}` : ''}\n`);
      spinner?.start('Working…', 'working');
    } else if (msg.type === 'step' && msg.row) {
      const key = msg.row.id || `${msg.row.tool}:${msg.row.summary}`;
      const stamp = `${msg.row.status}:${msg.row.summary}`;
      if (seenSteps.get(key) !== stamp) {
        seenSteps.set(key, stamp);
        spinner?.pause();
        const state = msg.row.status && msg.row.status !== 'running' ? ` (${msg.row.status})` : '';
        stderr.write(stderr?.isTTY ? `${formatStep(msg.row, { color: stderrColor })}\n` : `[${msg.row.tool}] ${msg.row.summary}${state}\n`);
        spinner?.start(`${msg.row.tool || 'Working'}…`, 'working');
      }
    } else if (msg.type === 'approval') {
      spinner?.pause();
      stderr.write(
        stderr?.isTTY
          ? `\n${formatApprovalBox({ title: msg.title, detail: msg.detail, interactive: backend.mode === 'headless', color: stderrColor })}\n`
          : `[approval needed in Baryon] ${msg.title}${msg.detail ? `: ${msg.detail}` : ''}\n`,
      );
    }
  };

  try {
    const result = kind === 'chat'
      ? await backend.askChat({
        prompt,
        context,
        chat: opts.chat || null,
        model: opts.model,
        provider: opts.provider,
        signal: controller.signal,
      }, onEvent)
      : await backend.runWork({
        folder,
        prompt,
        context,
        chat: opts.chat || null,
        mode: opts.mode,
        model: opts.model,
        provider: opts.provider,
        signal: controller.signal,
      }, onEvent);
    spinner?.stop();
    if (!opts.json && result.text) {
      stdout.write(`${stdout?.isTTY ? formatMarkdown(result.text, { color }) : result.text}\n`);
    }
    return result.failed ? 1 : 0;
  } finally {
    spinner?.stop();
    if (handleSignals) {
      process.off('SIGINT', abort);
      process.off('SIGTERM', abort);
    }
  }
}

export async function executeCli(opts: CliOptions, io: ExecuteCliIo = {}): Promise<number> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const cwd = typeof io.cwd === 'function' ? io.cwd() : process.cwd();
  const handleSignals = io.handleSignals !== false;
  const openUrl = io.openUrl ?? defaultOpenUrl;
  const color = useColor(stdout, env);
  const stderrColor = useColor(stderr, env);

  if (opts.command === 'help') {
    if (stdout?.isTTY && !opts.json) {
      stdout.write(`\n${renderSprite({ mood: 'idle', color })}\n\n`);
    }
    stdout.write(CLI_HELP);
    return 0;
  }

  if (opts.command === 'mcp') {
    const dataDir = opts.dataDir || defaultDataDir(env);
    const server = startFairyMcpServer({
      dataDir,
      input: stdin,
      output: stdout,
      log: (msg: string) => stderr.write(`${msg}\n`),
    });
    await server.closed;
    return 0;
  }

  if (opts.command === 'install-cli') {
    const res = await installCliSymlink({ home: io.home || homedir() });
    const pathEntries = String(env.PATH || '').split(':');
    const inPath = pathEntries.includes(dirname(res.linkPath));
    if (opts.json) {
      stdout.write(`${JSON.stringify({ ...res, inPath })}\n`);
    } else {
      stdout.write(`${formatSuccess(`Linked ${res.linkPath} -> ${res.target}`, { color })}\n`);
      if (!inPath) {
        stdout.write(`${formatDim(`Add ~/.local/bin to your PATH: export PATH="$HOME/.local/bin:$PATH"`, { color })}\n`);
      }
    }
    return 0;
  }

  if (opts.command === 'status') {
    const { pingSocket } = await import('./client.mjs');
    const candidates = opts.socket ? [opts.socket] : [defaultCliSocketPath(env), defaultSocketPath(env)];
    let lastError: unknown = null;
    for (const sock of candidates) {
      try {
        const hello = await pingSocket(sock);
        if (opts.json) stdout.write(`${JSON.stringify({ ok: true, socket: sock, ...hello })}\n`);
        else stdout.write(`Baryon (${hello.name || 'Fairy'}) listening at ${sock}${hello.provider ? ` · provider: ${hello.provider}` : ''}\n`);
        return 0;
      } catch (err) {
        lastError = err;
      }
    }
    stderr.write(`Error: ${errorMessage(lastError) || 'Baryon isn’t running.'}\n`);
    return 1;
  }

  const backend = (await resolveCliBackend({
    socket: opts.socket,
    dataDir: opts.dataDir,
    env,
    stdin,
    stderr,
    headless: opts.headless,
    attached: opts.attached,
    provider: opts.provider,
    model: opts.model,
    autoApprove: opts.yes,
    providers: (io.providers ?? null) as never,
    promptApproval: (io.promptApproval ?? null) as never,
  })) as unknown as CliBackend;

  try {
    if (opts.command === 'doctor') {
      const { pingSocket } = await import('./client.mjs');
      const cliSock = defaultCliSocketPath(env);
      const elecSock = defaultSocketPath(env);
      const [cliPing, elecPing, st, auth] = (await Promise.all([
        pingSocket(cliSock, 800).catch((e: unknown) => ({ error: errorMessage(e) })),
        pingSocket(elecSock, 800).catch((e: unknown) => ({ error: errorMessage(e) })),
        backend.rpc('status').catch((e: unknown) => ({ error: errorMessage(e) })),
        backend.rpc('auth.status').catch(() => null),
      ])) as [CliPingResult, CliPingResult, DoctorStatusResult, AuthStatusResult | null];
      const localBin = join(io.home || homedir(), '.local/bin/baryon');
      const report = {
        mode: backend.mode,
        dataDir: opts.dataDir || defaultDataDir(env),
        sockets: { cli: cliPing, electron: elecPing },
        status: st,
        auth,
        localBin,
      };
      if (opts.json) {
        stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
      }
      stdout.write(`\n${renderSprite({ mood: cliPing.error ? 'thinking' : 'happy', color })}\n\n`);
      stdout.write(`${formatHeading('Baryon CLI Doctor', { color })}\n`);
      stdout.write(`  Active runtime: ${backend.mode}${backend.mode === 'headless' ? ' (desktop socket not active, using local stores)' : ''}\n`);
      stdout.write(`  cli.sock:       ${cliPing.error ? formatDim(`offline (${cliPing.error})`, { color }) : formatSuccess(`online (${cliPing.mode || 'body'})`, { color })}\n`);
      stdout.write(`  electron.sock:  ${elecPing.error ? formatDim('offline', { color }) : formatSuccess('online', { color })}\n`);
      stdout.write(`  Data folder:    ${report.dataDir}\n`);
      stdout.write(`  Work provider:  ${st?.workProvider || '?'} · ${st?.workModel || '?'}\n`);
      if (auth) {
        stdout.write(`  Google Hub:     ${auth.googleAccount?.connected ? formatSuccess(auth.googleAccount.email || 'connected', { color }) : formatDim('not connected', { color })}\n`);
        stdout.write(`  Claude / Agy / Codex: ${[auth.claude?.connected && 'Claude', auth.antigravity?.connected && 'Antigravity', auth.codex?.connected && 'Codex'].filter(Boolean).join(', ') || 'none detected'}\n`);
      }
      return 0;
    }

    if (['repl', 'work', 'run', 'chat', 'ask'].includes(opts.command)) {
      let prompt = opts.prompt;
      const shouldReadStdin = !prompt && (!stdin?.isTTY || ['run', 'ask'].includes(opts.command));
      if (shouldReadStdin) prompt = await readStreamText(stdin);

      const interactiveRequested =
        (opts.command === 'repl' && !prompt && Boolean(stdin?.isTTY)) ||
        (['work', 'chat'].includes(opts.command) && !prompt && Boolean(stdin?.isTTY));

      if (interactiveRequested) {
        return await startRepl({
          backend,
          cwd,
          folder: opts.folder || cwd,
          initialMode: opts.command === 'chat' ? 'chat' : 'work',
          initialPermission: opts.mode,
          initialChat: opts.chat,
          initialModel: opts.model,
          initialProvider: opts.provider,
          stdin,
          stdout,
          stderr,
          env,
          handleSignals,
          openUrl,
        });
      }

      if (!prompt) {
        stderr.write('Error: Provide a prompt (positional args, --prompt, or stdin).\n');
        return 1;
      }

      let context = opts.context || '';
      if (opts.contextFile) {
        const fileText = await readFile(resolve(cwd, opts.contextFile), 'utf8');
        context = context ? `${context}\n\n${fileText}` : fileText;
      }

      const turnKind = ['chat', 'ask'].includes(opts.command) ? 'chat' : 'work';
      return await runSingleTurn({ backend, kind: turnKind, opts, prompt, context, cwd, stdout, stderr, env, handleSignals });
    }

    // Subcommands (Phase 1 + Phase 2 RPCs)
    const outJson = (data: unknown): boolean => stdout.write(`${JSON.stringify(data, null, 2)}\n`);

    if (opts.command === 'sessions') {
      const sub = opts.subcommand || 'list';
      if (sub === 'list') {
        const data = await backend.rpc('sessions.list', {
          folder: opts.folder ? resolve(cwd, opts.folder) : '',
          limit: opts.limit || 40,
        });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatTable<SessionRow>([
          { label: 'ID', get: s => s.id, max: 38 },
          { label: 'Title', get: s => s.title || '(untitled)', max: 36 },
          { label: 'Turns', get: s => s.turns ?? 0, max: 6 },
          { label: 'Folder', get: s => s.workPath || 'chat', max: 36 },
        ], (data?.sessions || []) as SessionRow[], { color, empty: 'No sessions yet.' })}\n`);
        return 0;
      }
      if (sub === 'show') {
        const id = opts.args[0] || opts.chat;
        const data = await backend.rpc('sessions.show', { id, limit: opts.limit || 30 });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatHeading(`${data.session.title} (${data.session.id})`, { color })}\n`);
        for (const msg of data.messages || []) {
          const who = msg.role === 'user' ? 'You' : 'Fairy';
          stdout.write(`\n${formatHeading(who, { color })}:\n${formatMarkdown(String(msg.content || ''), { color })}\n`);
        }
        return 0;
      }
      if (sub === 'search') {
        const query = opts.args.join(' ').trim();
        const data = await backend.rpc('sessions.search', { query, folder: opts.folder ? resolve(cwd, opts.folder) : '', limit: opts.limit || 10 });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatTable<SessionHitRow>([
          { label: 'ID', get: h => h.sessionId, max: 16 },
          { label: 'Title', get: h => h.title, max: 32 },
          { label: 'Excerpt', get: h => h.excerpt, max: 58 },
        ], (data?.hits || []) as SessionHitRow[], { color, empty: 'No matching sessions.' })}\n`);
        return 0;
      }
      if (sub === 'rename') {
        const [id, ...titleParts] = opts.args;
        const data = await backend.rpc('sessions.rename', { id: id || opts.chat, title: titleParts.join(' ').trim() });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Renamed ${data.session.id} -> ${data.session.title}`, { color })}\n`);
        return 0;
      }
      if (sub === 'fork') {
        const data = await backend.rpc('sessions.fork', { id: opts.args[0] || opts.chat });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Forked session -> ${data.id}`, { color })}\n`);
        return 0;
      }
      if (sub === 'compact') {
        const data = await backend.rpc('sessions.compact', { id: opts.args[0] || opts.chat });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Compacted session ${data.id}.`, { color })}\n`);
        return 0;
      }
      throw new Error(`Unknown sessions subcommand: ${sub}`);
    }

    if (opts.command === 'models') {
      const sub = opts.subcommand || 'list';
      if (sub === 'list') {
        const data = await backend.rpc('models.list');
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatHeading('Active Models', { color })}\n`);
        stdout.write(`  Work: ${data.current?.work?.provider} · ${data.current?.work?.model}${data.current?.work?.auto ? ' (Auto)' : ''}\n`);
        stdout.write(`  Chat: ${data.current?.chat?.provider} · ${data.current?.chat?.model}${data.current?.chat?.auto ? ' (Auto)' : ''}\n\n`);
        const rows: ModelTableRow[] = [
          ...((data.claude || []) as ModelRow[]).map(m => ({ provider: 'claude', id: m.id, name: m.name || m.id })),
          ...((data.gemini || []) as ModelRow[]).map(m => ({ provider: 'gemini', id: m.id, name: m.name || m.id })),
          ...((data.codex || []) as ModelRow[]).map(m => ({ provider: 'codex', id: m.id, name: m.name || m.id })),
        ];
        stdout.write(`${formatTable<ModelTableRow>([
          { label: 'Provider', get: r => r.provider, max: 10 },
          { label: 'Model ID', get: r => r.id, max: 32 },
          { label: 'Name', get: r => r.name, max: 32 },
        ], rows, { color })}\n`);
        return 0;
      }
      if (sub === 'set') {
        const targetModel = opts.args[0] || opts.model;
        let provider = opts.provider;
        if (!provider && targetModel) {
          if (targetModel.startsWith('claude-')) provider = 'claude';
          else if (targetModel.startsWith('gemini-')) provider = 'gemini';
          else if (/^(?:gpt-|o\d|codex)/.test(targetModel)) provider = 'codex';
        }
        const data = await backend.rpc('models.set', { work: opts.work, provider, model: targetModel });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Updated ${opts.work ? 'work' : 'chat'} model -> ${provider || '?'} · ${targetModel}`, { color })}\n`);
        return 0;
      }
      throw new Error(`Unknown models subcommand: ${sub}`);
    }

    if (opts.command === 'usage') {
      const data = await backend.rpc('usage', { force: opts.force });
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatHeading('Baryon Usage', { color })}\n`);
      stdout.write(`  Messages: ${data?.totals?.messages ?? 0}   Tokens: ${data?.totals?.tokens ?? 0}\n`);
      if (data?.plans?.claude?.fiveHour !== undefined) {
        stdout.write(`  Claude 5h: ${data.plans.claude.fiveHour}%   7d: ${data.plans.claude.sevenDay ?? '?'}%\n`);
      }
      if (data?.antigravity?.connected) {
        stdout.write(`  Antigravity: connected (${data.antigravity.models?.length || 0} models)\n`);
      }
      return 0;
    }

    if (opts.command === 'recall') {
      const query = opts.args.join(' ').trim() || opts.prompt;
      const data = await backend.rpc('recall', { query, folder: opts.folder ? resolve(cwd, opts.folder) : '', limit: opts.limit || 8 });
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatHeading(`Recall: "${query}"`, { color })}\n`);
      stdout.write(`${formatTable<SessionHitRow>([
        { label: 'Session', get: h => h.sessionId, max: 16 },
        { label: 'Title', get: h => h.title, max: 30 },
        { label: 'Excerpt', get: h => h.excerpt, max: 60 },
      ], (data?.sessions || []) as SessionHitRow[], { color, empty: 'No matching session hits.' })}\n`);
      if (data?.memory?.length) {
        stdout.write(`\n${formatHeading('Long-term Memory Matches', { color })}\n`);
        for (const item of data.memory) stdout.write(`  • [${item.kind}] ${item.text}\n`);
      }
      return 0;
    }

    if (opts.command === 'memory') {
      const sub = opts.subcommand || 'list';
      const folder = opts.folder ? resolve(cwd, opts.folder) : '';
      if (sub === 'add') {
        const text = opts.args.join(' ').trim() || opts.prompt;
        const data = await backend.rpc('memory.add', { kind: opts.kind || 'work', text });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess('Saved to long-term memory.', { color })}\n`);
        return 0;
      }
      if (sub === 'search') {
        const query = opts.args.join(' ').trim();
        const data = await backend.rpc('memory.search', { kind: opts.kind || 'all', query });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatTable<MemoryRow>([
          { label: 'Kind', get: m => m.kind, max: 10 },
          { label: 'Text', get: m => m.text, max: 80 },
        ], (data?.items || []) as MemoryRow[], { color, empty: 'No matching memories.' })}\n`);
        return 0;
      }
      const query = sub === 'list' ? '' : [sub, ...opts.args].join(' ').trim();
      const data = await backend.rpc('memory.list', { kind: opts.kind || 'all', ...(query ? { query } : {}), ...(folder ? { folder } : {}) });
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatTable<MemoryRow>([
        { label: 'Kind', get: m => m.kind, max: 10 },
        { label: 'Memory', get: m => m.text, max: 76 },
      ], (data?.items || []) as MemoryRow[], { color, empty: 'No long-term memories yet.' })}\n`);
      return 0;
    }

    if (opts.command === 'journal') {
      const sub = opts.subcommand || 'list';
      const folder = opts.folder ? resolve(cwd, opts.folder) : '';
      if (sub === 'add') {
        const title = opts.title || opts.args.join(' ').trim() || 'CLI note';
        const data = await backend.rpc('journal.add', {
          folder: folder || cwd,
          title,
          tried: opts.tried,
          outcome: opts.outcome,
          decision: opts.decision,
        });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Added lab journal entry in ${data.folder}.`, { color })}\n`);
        return 0;
      }
      const data = await backend.rpc('journal.list', { ...(folder ? { folder } : {}), ...(opts.limit ? { limit: opts.limit } : {}) });
      if (opts.json) return outJson(data), 0;
      if (data?.projects) {
        stdout.write(`${formatTable<JournalProjectRow>([
          { label: 'Project Folder', get: p => p.folder, max: 54 },
          { label: 'Entries', get: p => p.count, max: 10 },
          { label: 'Updated', get: p => p.lastAt || '', max: 24 },
        ], data.projects as JournalProjectRow[], { color, empty: 'No lab journals recorded yet.' })}\n`);
      } else {
        stdout.write(`${formatTable<JournalEntryRow>([
          { label: 'Date', get: e => e.date || '', max: 12 },
          { label: 'Title', get: e => e.title || '', max: 32 },
          { label: 'Outcome / Decision', get: e => e.decision || e.outcome || '', max: 52 },
        ], (data?.entries || []) as JournalEntryRow[], { color, empty: 'No journal entries found.' })}\n`);
      }
      return 0;
    }

    if (opts.command === 'notes') {
      const sub = opts.subcommand || 'search';
      if (sub === 'read') {
        const path = opts.args[0] || '';
        const data = await backend.rpc('notes.read', { path, startLine: opts.startLine, maxLines: opts.maxLines });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatHeading(`${data.path} (L${data.startLine}-L${data.endLine})`, { color })}\n${data.text}\n`);
        return 0;
      }
      const query = sub === 'search' ? opts.args.join(' ').trim() : [sub, ...opts.args].join(' ').trim();
      const data = await backend.rpc('notes.search', { query, limit: opts.limit || 8 });
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatTable<NoteHitRow>([
        { label: 'Path', get: h => h.path, max: 34 },
        { label: 'Line', get: h => h.line, max: 6 },
        { label: 'Heading / Excerpt', get: h => h.heading || h.excerpt, max: 56 },
      ], (data?.hits || []) as NoteHitRow[], { color, empty: 'No matching notes.' })}\n`);
      return 0;
    }

    if (opts.command === 'today') {
      const data = await backend.rpc('today', { force: opts.force });
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatHeading('Today', { color })}\n`);
      if (data?.calendar?.events?.length) {
        stdout.write(`${formatTable<CalendarEventRow>([
          { label: 'Start', get: e => e.start || '', max: 24 },
          { label: 'Event', get: e => e.title || '', max: 56 },
        ], data.calendar.events as CalendarEventRow[], { color })}\n`);
      } else if (data?.calendar?.error) {
        stdout.write(`  Calendar: ${formatDim(data.calendar.error, { color })}\n`);
      }
      stdout.write(`\n  Open promises: ${(data?.promises || []).length}\n`);
      for (const p of (data?.promises || []).slice(0, 6)) stdout.write(`    • ${p.id}: ${p.what}${p.due ? ` (${p.due})` : ''}\n`);
      stdout.write(`  Active goals: ${(data?.goals || []).length}\n`);
      for (const g of (data?.goals || []).slice(0, 6)) stdout.write(`    • ${g.id} [${g.state}]: ${g.outcome}\n`);
      return 0;
    }

    if (opts.command === 'goals') {
      const sub = opts.subcommand || 'list';
      if (sub === 'add') {
        const outcome = opts.args.join(' ').trim() || opts.outcome || opts.prompt;
        const data = await backend.rpc('goals.add', { outcome, folder: opts.folder ? resolve(cwd, opts.folder) : null });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Created goal ${data.id}: ${data.outcome}`, { color })}\n`);
        return 0;
      }
      if (sub === 'continue') {
        const id = opts.args[0] || '';
        const data = await backend.rpc('goals.continue', { id });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Started next step on goal ${id}.`, { color })}\n`);
        return 0;
      }
      const data = await backend.rpc('goals.list');
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatTable<GoalRow>([
        { label: 'ID', get: g => g.id, max: 8 },
        { label: 'State', get: g => g.state, max: 14 },
        { label: 'Outcome', get: g => g.outcome, max: 64 },
      ], (data?.goals || []) as GoalRow[], { color, empty: 'No goals.' })}\n`);
      return 0;
    }

    if (opts.command === 'promises') {
      const sub = opts.subcommand || 'list';
      if (sub === 'done') {
        const id = opts.args[0] || '';
        const data = await backend.rpc('promises.done', { id, done: true });
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Completed promise ${id}.`, { color })}\n`);
        return 0;
      }
      const data = await backend.rpc('promises.list');
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatTable<PromiseRow>([
        { label: 'ID', get: p => p.id, max: 16 },
        { label: 'Due', get: p => p.due || '-', max: 18 },
        { label: 'What', get: p => p.what, max: 60 },
      ], (data?.open || []) as PromiseRow[], { color, empty: 'No open promises.' })}\n`);
      return 0;
    }

    if (opts.command === 'auth') {
      const sub = opts.subcommand || 'status';
      if (sub === 'refresh' || sub === 'agy') {
        const data = await backend.rpc('auth.agyRefresh');
        if (opts.json) return outJson(data), 0;
        stdout.write(`${formatSuccess(`Antigravity refreshed: ${data?.connected ? 'connected' : 'not connected'}`, { color })}\n`);
        return 0;
      }
      const data = await backend.rpc('auth.status');
      if (opts.json) return outJson(data), 0;
      stdout.write(`${formatHeading('Authentication Status', { color })}\n`);
      stdout.write(`  Google Hub:  ${data.googleAccount?.connected ? formatSuccess(data.googleAccount.email || 'connected', { color }) : formatDim('not connected', { color })}\n`);
      stdout.write(`  Claude Code: ${data.claude?.connected ? formatSuccess(data.claude.plan || 'connected', { color }) : formatDim(data.claude?.error || 'not connected', { color })}\n`);
      stdout.write(`  Antigravity: ${data.antigravity?.connected ? formatSuccess(`${data.antigravity.models?.length || 0} models`, { color }) : formatDim('not connected', { color })}\n`);
      stdout.write(`  Codex:       ${data.codex?.connected ? formatSuccess(data.codex.plan || 'connected', { color }) : formatDim('not connected', { color })}\n`);
      return 0;
    }

    if (opts.command === 'plugins') {
      const sub = opts.subcommand || 'status';
      if (sub === 'connect') {
        const ids = opts.args;
        const data = await backend.rpc('plugins.connect', { pluginIds: ids });
        if (opts.json) return outJson(data), 0;
        const results: PluginConnectResult[] = Array.isArray(data?.results) ? data.results : [];
        const added = results.filter(r => r.added).map(r => r.id);
        const existing = results.filter(r => r.alreadyConnected).map(r => r.id);
        stdout.write(`${formatSuccess(`Connected: ${added.join(', ') || 'none'}   Already saved: ${existing.join(', ') || 'none'}`, { color })}\n`);
        for (const item of results) {
          if (!item?.authUrl) continue;
          stdout.write(`  Sign in (${item.name || item.id}): ${item.authUrl}\n`);
          if (stdout?.isTTY) await openUrl(item.authUrl).catch(() => {});
        }
        return 0;
      }
      const data = await backend.rpc('plugins.status');
      if (opts.json) return outJson(data), 0;
      const connectors = (data.connectors || []) as PluginConnectorRow[];
      stdout.write(`${formatTable<PluginSsoRow>([
        { label: 'Plugin', get: p => p.id, max: 14 },
        { label: 'Name', get: p => p.name, max: 16 },
        { label: 'Saved', get: p => (connectors.some(c => c.name === p.id) ? 'yes' : 'no'), max: 8 },
        { label: 'SSO Login URL', get: p => p.authUrl, max: 48 },
      ], (data?.supportedSso || []) as PluginSsoRow[], { color })}\n`);
      return 0;
    }

    stderr.write(`${formatError(`Unknown command: ${opts.command}`, { color: stderrColor })}\n`);
    return 1;
  } finally {
    await backend.close?.();
  }
}
