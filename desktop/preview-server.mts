import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandEnvironment, seatbeltProfile } from './work-sandbox.mjs';

const START_LIMIT = 90000, KEPT_OUTPUT = 8000;
const SCRIPTS = ['dev', 'start', 'serve', 'preview'] as const;

export interface PreviewStatus {
  running: boolean;
  url: string;
  output: string;
  command: string;
  error: string;
}

export type PreviewSpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface PreviewServerOptions {
  onState?: (status: PreviewStatus) => void;
  spawnProcess?: PreviewSpawnProcess;
  home?: string;
  startLimit?: number;
}

// What would most likely run this project. You see it, and can change it, before anything starts.
export async function detectPreview(root: string): Promise<string> {
  try {
    const { scripts = {} } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const script = SCRIPTS.find(name => typeof scripts[name] === 'string');
    if (script) return script === 'start' ? 'npm start' : `npm run ${script}`;
  } catch {}
  if (existsSync(join(root, 'index.html'))) return 'python3 -m http.server 8000 --bind 127.0.0.1';
  return '';
}
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// Finds the address a server announces. Only this Mac's own addresses count, whatever the output says.
export function findLocalURL(output: unknown): string {
  const text = String(output).replace(ANSI, '');
  const url = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(\/[^\s'"<>)]*)?/i.exec(text);
  if (url) return `http://localhost:${url[1]}${url[2] || '/'}`;
  const port = /\b(?:port|listening on|serving on)\b[^\d\n]{0,20}(\d{4,5})\b/i.exec(text);
  return port ? `http://localhost:${port[1]}/` : '';
}
// One dev server at a time, in the sandbox: it can serve on this Mac and reach nothing else.
export class PreviewServer {
  onState: (status: PreviewStatus) => void;
  spawnProcess: PreviewSpawnProcess;
  home: string;
  startLimit: number;
  child: ChildProcess | null;
  status: PreviewStatus;

  constructor({ onState = () => {}, spawnProcess = spawn, home = homedir(), startLimit = START_LIMIT }: PreviewServerOptions) {
    this.onState = onState;
    this.spawnProcess = spawnProcess;
    this.home = home;
    this.startLimit = startLimit;
    this.child = null; this.status = { running: false, url: '', output: '', command: '', error: '' };
  }
  set(next: Partial<PreviewStatus>): void { this.status = { ...this.status, ...next }; this.onState(this.status); }
  async start({ root, command }: { root: string; command: string }): Promise<PreviewStatus> {
    if (typeof command !== 'string' || !command.trim() || command.length > 2000 || command.includes('\0')) throw new Error('Give a command to run.');
    this.stop();
    const temp = await mkdtemp(join(realpathSync(tmpdir()), 'fairy-preview-'));
    const profile = seatbeltProfile({ root, temp, home: this.home, loopback: true });
    const child = this.spawnProcess('/usr/bin/sandbox-exec', ['-p', profile, '/bin/zsh', '-f', '-c', command], { cwd: root, env: { ...commandEnvironment(temp, this.home), BROWSER: 'none', CI: '', FORCE_COLOR: '0', PYTHONUNBUFFERED: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child; this.set({ running: true, url: '', output: '', command, error: '' });
    const waiting = setTimeout(() => { if (this.child === child && !this.status.url) this.set({ error: 'The server didn’t announce an address yet. Type it into the address bar if it’s running.' }); }, this.startLimit);
    waiting.unref?.();
    const read = (chunk: string): void => {
      if (this.child !== child) return;
      const output = (this.status.output + chunk).slice(-KEPT_OUTPUT), url = this.status.url || findLocalURL(output);
      this.set({ output, url });
    };
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', read); child.stderr!.on('data', read);
    child.on('error', error => { if (this.child === child) { this.child = null; this.set({ running: false, error: `Couldn’t start it: ${error.message}` }); } });
    child.on('close', code => {
      clearTimeout(waiting);
      void rm(temp, { recursive: true, force: true }).catch(() => {});
      if (this.child !== child) return;
      this.child = null;
      const reason = this.status.output.trim().split('\n').at(-1)?.replace(ANSI, '').slice(0, 300);
      this.set({ running: false, error: code ? `The server stopped with exit code ${code}${reason ? `: ${reason}` : '.'}` : '' });
    });
    return this.status;
  }
  stop(): PreviewStatus {
    const child = this.child;
    if (!child) return this.status;
    this.child = null;
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { try { child.kill(); } catch {} }
    const killer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 1500);
    killer.unref?.();
    this.set({ running: false, url: '', error: '' });
    return this.status;
  }
}
