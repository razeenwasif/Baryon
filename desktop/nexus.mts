// Heavy work on your home cluster, from a work session ("Improving existing features", item 4). The agent prepares a
// command and Fairy sends it to Nexus as a ticket: with the request-only token (~/.duet/request-token), which can only
// ask, so every job waits for your Accept in Nexus and Fairy can never accept one herself. CPU jobs go to atlas, GPU
// jobs to forge. The project folder goes as a snapshot (tracked and untracked files git doesn't ignore; never .env).
// Logs and outputs come back as data. Fairy uses the nexus command already on the Mac: on the mini, the one in
// ~/nexus-cluster beside the coordinator; elsewhere ~/.local/bin/nexus.
import { spawn, type SpawnOptions } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { defineTool, type ToolDefinition, type ToolScope } from './tool-registry.mjs';

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
export const NEXUS_REQUESTER = 'Fairy';
export const OUTPUTS_FOLDER = 'nexus-outputs';
const JOB = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export interface FindNexusOptions {
  home?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  check?: (path: string) => Promise<boolean>;
}

export interface NexusFound {
  cli: string;
  env: Record<string, string>;
}

export interface NexusChildProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill: (signal?: NodeJS.Signals | number) => unknown;
  on: {
    (event: 'error', listener: (error: Error) => void): unknown;
    (event: 'close', listener: (code: number | null) => void): unknown;
  };
}

export type NexusSpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => NexusChildProcess;

export interface RunNexusOptions {
  cwd?: string;
  signal?: AbortSignal | null;
  timeout?: number;
  stopAfter?: number;
  spawnFn?: NexusSpawnFn;
}

export interface RunNexusResult {
  code: number | null;
  out: string;
  err: string;
  stopped: boolean;
}

export type NexusRunner = (found: NexusFound, args: string[], options?: RunNexusOptions) => Promise<RunNexusResult>;

export interface NexusSubmitOptions {
  root: string;
  target?: string;
  command: string;
  cpus?: number;
  mem_gb?: number;
  gpu_mem_gb?: number;
  limit_hours?: number;
  name?: string;
  on?: string;
  cache?: string[];
}

export interface NexusSubmitResult {
  job: string;
  target: string;
  status: string;
  placement: string;
}

export interface NexusLogsOptions {
  job: string;
  seconds?: number;
}

export interface NexusLogsResult {
  job: string;
  ended: boolean;
  exitCode?: number | null;
  log: string;
  notes?: string;
}

export interface NexusOutputFile {
  path: string;
  bytes: number;
}

export interface NexusOutputsOptions {
  job: string;
  root: string;
}

export interface NexusOutputsResult {
  job: string;
  folder: string;
  files: NexusOutputFile[];
}

export interface NexusJobSummary {
  job: string;
  state: string;
  node: string;
  name: string;
}

export interface NexusTicketSummary {
  job: string;
  requester: string;
  command: string;
}

export interface NexusOptions {
  found: NexusFound;
  run?: NexusRunner;
}

interface NexusScope extends ToolScope {
  nexus: Nexus;
  root: string;
}

// The nexus command and how to call it, or null when this Mac has no nexus command or no request-only token. The full
// token is never used: without the request-only one, Fairy has no Nexus tools.
export async function findNexus({ home = homedir(), env = process.env, check = exists }: FindNexusOptions = {}): Promise<NexusFound | null> {
  const token = env.FAIRY_NEXUS_TOKEN_FILE || join(home, '.duet', 'request-token');
  if (!await check(token)) return null;
  const onCoordinator = await check(join(home, '.duet', 'coordinator.log'));
  const candidates = [env.FAIRY_NEXUS_CLI, join(home, 'nexus-cluster', '.venv', 'bin', 'nexus'), join(home, '.local', 'bin', 'nexus')].filter((p): p is string => Boolean(p));
  let cli: string | null = null;
  for (const path of candidates) if (await check(path)) { cli = path; break; }
  if (!cli) return null;
  // On the Mac the coordinator runs on, it's reached directly; elsewhere the nexus command finds it as it always does.
  const coordinator = env.NEXUS_COORDINATOR || (onCoordinator ? 'http://127.0.0.1:7420' : '');
  return { cli, env: { NEXUS_TOKEN_FILE: token, NEXUS_REQUESTER, ...(coordinator ? { NEXUS_COORDINATOR: coordinator } : {}) } };
}

// Runs the nexus command, keeping what it prints. stopAfter: for following a log, stop listening after that long
// (the job keeps running).
export function runNexus({ cli, env }: NexusFound, args: string[], { cwd, signal, timeout = 120000, stopAfter = 0, spawnFn = spawn }: RunNexusOptions = {}): Promise<RunNexusResult> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cli, args, { cwd, env: { ...process.env, ...env, NEXUS_TOKEN: '', DUET_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false, stopped = false;
    const finish = <T,>(fn: (value: T) => void, value: T): void => {
      if (!settled) { settled = true; clearTimeout(limit); if (listen) clearTimeout(listen); signal?.removeEventListener?.('abort', abort); fn(value); }
    };
    const abort = (): void => { child.kill('SIGTERM'); finish(reject, Object.assign(new Error('Stopped.'), { name: 'AbortError' })); };
    const limit = setTimeout(() => { child.kill('SIGTERM'); finish(reject, new Error('Nexus didn’t answer in time.')); }, timeout);
    const listen = stopAfter ? setTimeout(() => { stopped = true; child.kill('SIGINT'); }, stopAfter) : null;
    signal?.addEventListener?.('abort', abort, { once: true });
    child.stdout!.on('data', (chunk: Buffer | string) => { out = (out + chunk).slice(-200000); });
    child.stderr!.on('data', (chunk: Buffer | string) => { err = (err + chunk).slice(-20000); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => finish(resolve, { code, out, err, stopped }));
  });
}

const tail = (text: string, size = 8000): string => (text.length > size ? `… (earlier lines left out)\n${text.slice(-size)}` : text);
const said = (result: { out?: string; err?: string }): string => (result.err || result.out || '').trim().split('\n').filter(Boolean).slice(-6).join('\n');

export class Nexus {
  found: NexusFound;
  run: NexusRunner;

  constructor({ found, run = runNexus }: NexusOptions) {
    this.found = found;
    this.run = run;
  }

  // A ticket for a job. It waits for the user's Accept in Nexus; --detach returns its id at once.
  async submit({ root, target = 'cpu', command, cpus, mem_gb, gpu_mem_gb, limit_hours, name, on, cache = [] }: NexusSubmitOptions, signal?: AbortSignal): Promise<NexusSubmitResult> {
    if (!['cpu', 'gpu'].includes(target)) throw new Error('Choose target cpu or gpu.');
    if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Give the command to run, under 4,000 characters.');
    const args = [target, '--ask', '--detach', '--from', NEXUS_REQUESTER, '--dir', root];
    const number = (value: unknown, low: number, high: number, flag: string): void => {
      if (value === undefined || value === null) return;
      const n = Number(value);
      if (!Number.isFinite(n) || n < low || n > high) throw new Error(`${flag} must be between ${low} and ${high}.`);
      args.push(flag, String(n));
    };
    if (cpus !== undefined && cpus !== null && !Number.isInteger(Number(cpus))) throw new Error('--cpus is a whole number of threads.');
    number(cpus, 1, 12, '--cpus'); number(mem_gb, 0, 64, '--mem'); if (target === 'gpu') number(gpu_mem_gb, 1, 24, '--gpu-mem'); number(limit_hours, 0.05, 72, '--limit');
    if (name) { if (!/^[\w .-]{1,60}$/.test(name)) throw new Error('Use a short job name of letters, digits, spaces, dots and dashes.'); args.push('--name', name); }
    if (on) { if (!/^[a-z][a-z0-9-]{1,30}$/.test(on)) throw new Error('Name a node, such as atlas or forge.'); args.push('--on', on); }
    for (const folder of Array.isArray(cache) ? cache.slice(0, 5) : []) { if (typeof folder !== 'string' || folder.startsWith('/') || folder.split(/[\\/]/).includes('..')) throw new Error('Cache folders are paths inside the project.'); args.push('--cache', folder); }
    args.push('--', command.trim());
    const result = await this.run(this.found, args, { cwd: root, signal });
    const job = result.out.trim().split('\n').at(-1)?.trim();
    if (result.code !== 0 || !JOB.test(job || '')) throw new Error(`Nexus didn’t take the job: ${said(result) || `exit ${result.code}`}`);
    return { job: job!, target, status: 'waiting for the user to accept it in Nexus', placement: said({ out: result.err }) };
  }

  // The job's log: followed for up to `seconds`, then left running. Ended is true when the job has finished.
  async logs({ job, seconds = 20 }: NexusLogsOptions, signal?: AbortSignal): Promise<NexusLogsResult> {
    if (!JOB.test(String(job))) throw new Error('Give the job id nexus_run returned.');
    const wait = Math.min(120, Math.max(2, Number(seconds) || 20)) * 1000;
    const result = await this.run(this.found, ['logs', job], { signal, stopAfter: wait, timeout: wait + 30000 });
    if (result.code && !result.stopped && !result.out.trim()) throw new Error(said(result) || `Nexus couldn’t show the log of ${job}.`);
    return { job, ended: !result.stopped, ...(result.stopped ? {} : { exitCode: result.code }), log: tail(result.out), ...(result.err.trim() ? { notes: said({ err: result.err }) } : {}) };
  }

  // What the job wrote to $DUET_OUTPUT_DIR, unpacked into the project's nexus-outputs/<job>.
  async outputs({ job, root }: NexusOutputsOptions, signal?: AbortSignal): Promise<NexusOutputsResult> {
    if (!JOB.test(String(job))) throw new Error('Give the job id nexus_run returned.');
    const dest = join(root, OUTPUTS_FOLDER);
    const result = await this.run(this.found, ['outputs', job, dest], { cwd: root, signal, timeout: 600000 });
    if (result.code !== 0) throw new Error(said(result) || `Nexus couldn’t fetch the outputs of ${job}.`);
    const folder = join(dest, job), files: NexusOutputFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (files.length < 200) files.push({ path: relative(root, path).split(sep).join('/'), bytes: (await stat(path)).size });
      }
    };
    await walk(folder);
    return { job, folder: relative(root, folder).split(sep).join('/'), files };
  }

  // Part D lookup: lists recent Nexus jobs so Fairy can check if an interrupted job of a given name already landed.
  async listJobs(signal?: AbortSignal): Promise<NexusJobSummary[] | null> {
    const result = await this.run(this.found, ['jobs'], { signal, timeout: 30000 });
    if (result.code !== 0) return null;
    const jobs: NexusJobSummary[] = [];
    for (const line of String(result.out || '').split('\n')) {
      const m = /^([A-Za-z0-9][A-Za-z0-9_-]{2,63})\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line.trimEnd());
      if (!m) continue;
      const rest = m[4]!;
      const gap = rest.search(/\s{2,}/);
      const name = gap >= 0 ? rest.slice(0, gap).trim() : (rest.length > 32 && rest[32] === ' ' ? rest.slice(0, 32).trim() : rest.trim());
      jobs.push({ job: m[1]!, state: m[2]!, node: m[3]!, name });
    }
    return jobs;
  }

  async listTickets(signal?: AbortSignal): Promise<NexusTicketSummary[] | null> {
    const result = await this.run(this.found, ['tickets'], { signal, timeout: 30000 });
    if (result.code !== 0) return null;
    const tickets: NexusTicketSummary[] = [];
    for (const line of String(result.out || '').split('\n')) {
      const m = /^([A-Za-z0-9][A-Za-z0-9_-]{2,63})\s+from\s+([^:]+):\s*(.+)$/.exec(line.trim());
      if (m) tickets.push({ job: m[1]!, requester: m[2]!.trim(), command: m[3]!.trim() });
    }
    return tickets;
  }
}

const string = { type: 'string' }, number = { type: 'number' };
export const NEXUS_TOOLS: ToolDefinition[] = [
  defineTool({ name: 'nexus_run', description: 'Send a heavy command to the user’s home cluster (Nexus) instead of running it here: target cpu for simulations, sweeps, data processing and benchmarks (atlas, 12 threads, 16 GB), gpu for training and GPU inference (forge, an RTX 4090 on Windows). The project folder goes as a snapshot (git-ignored files and .env don’t), so declare dependencies in requirements.txt or pyproject.toml and have the job fetch its own data; keep the command portable (macOS or Windows), and write results to $DUET_OUTPUT_DIR. It becomes a ticket the user must accept in Nexus; say so, and follow it with nexus_logs. Where Fairy’s experiment tracker is on, the job is also recorded as a run (track false leaves it out): have it write params.json ({name: value}) and metrics.json ({name: {value, unit}}) into $DUET_OUTPUT_DIR, and the run fills in when its outputs come back.',
    properties: { target: { type: 'string', enum: ['cpu', 'gpu'] }, command: string, cpus: number, mem_gb: { ...number, description: 'RAM to reserve; give it for anything large, as atlas has little to spare.' }, gpu_mem_gb: number, limit_hours: number, name: string, on: { ...string, description: 'Only when it must run on one machine: atlas or forge.' }, cache: { type: 'array', items: string, maxItems: 5, description: 'Git-ignored project folders to keep on the node for the next job, such as .venv.' },
      track: { type: 'boolean', description: 'Record the job as a run in the experiment tracker. Default true; false for jobs that aren’t experiments.' }, params: { type: 'object', description: 'Parameters to record that the command doesn’t show, {name: value}.' },
      claims: { type: 'array', items: string, maxItems: 8, description: 'Claim ids this reproduction run targets, such as ["C1"].' },
      scale: { type: 'string', enum: ['smoke', 'scaled', 'full'], description: 'Run scale: smoke, scaled (scaled down — never counts as reproduced), or full.' },
      scale_note: { ...string, description: 'When scaled down or smoke, explain how (e.g. "10% dataset, 500 steps").' } },
    required: ['target', 'command'], risk: 'write', run: (rawArgs, scope) => {
      const { track: _track, params: _params, claims: _claims, scale: _scale, scale_note: _scaleNote, ...args } = rawArgs;
      const { nexus, root, signal } = scope as NexusScope;
      return nexus.submit({ ...(args as Omit<NexusSubmitOptions, 'root'>), root }, signal);
    } }),
  defineTool({ name: 'nexus_logs', description: 'Follow a Nexus job’s log for up to seconds (default 20, at most 120), then leave it running. Says whether it has ended and its exit code. While it waits for the user’s Accept, the log is empty.',
    properties: { job: string, seconds: number }, required: ['job'], run: (args, scope) => {
      const { nexus, signal } = scope as NexusScope;
      return nexus.logs(args as unknown as NexusLogsOptions, signal);
    } }),
  defineTool({ name: 'nexus_outputs', description: 'Download what a finished Nexus job wrote to $DUET_OUTPUT_DIR into the project’s nexus-outputs/<job> folder, and list the files.',
    properties: { job: string }, required: ['job'], risk: 'write', run: (args, scope) => {
      const { nexus, root, signal } = scope as NexusScope;
      return nexus.outputs({ ...(args as { job: string }), root }, signal);
    } }),
];
export const NEXUS_TOOL_NAMES: Set<string> = new Set(NEXUS_TOOLS.map(tool => tool.name));
