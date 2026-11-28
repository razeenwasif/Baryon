// Two Macs, step 5: this Mac's idle time to the fraction of a second, from native/bin/fairy-idle while presence is being
// watched. Electron's powerMonitor gives whole seconds, which made her up to a second late (step 1), so that is only
// the fallback when the helper isn't there.
import { spawn } from 'node:child_process';

export interface IdleChildStdout {
  setEncoding?: (encoding: BufferEncoding) => unknown;
  on: (event: 'data', listener: (chunk: string | Buffer) => void) => unknown;
}

export interface IdleChildProcess {
  on: (event: 'error' | 'exit', listener: (...args: unknown[]) => void) => unknown;
  stdout: IdleChildStdout | null;
  stdin?: { end: () => unknown } | null;
  kill?: () => unknown;
}

export type IdleSpawnProcess = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'pipe', 'ignore'] },
) => IdleChildProcess;

export interface IdleReaderOptions {
  path: string;
  every?: number;
  fallback?: () => number | null;
  spawnProcess?: IdleSpawnProcess;
  now?: () => number;
}

export class IdleReader {
  path: string;
  every: number;
  fallback: () => number | null;
  spawnProcess: IdleSpawnProcess;
  now: () => number;
  child: IdleChildProcess | null;
  latest: number | null;
  at: number;
  buffer: string;

  constructor({ path, every = 200, fallback = () => null, spawnProcess = spawn, now = Date.now }: IdleReaderOptions) {
    this.path = path;
    this.every = every;
    this.fallback = fallback;
    this.spawnProcess = spawnProcess;
    this.now = now;
    this.child = null; this.latest = null; this.at = 0; this.buffer = '';
  }
  start(): void {
    if (this.child) return;
    let child: IdleChildProcess;
    try { child = this.spawnProcess(this.path, [String(this.every)], { stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return; }
    this.child = child; this.buffer = '';
    child.on('error', () => { if (this.child === child) this.child = null; });
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', chunk => this.read(chunk));
  }
  read(chunk: string | Buffer): void {
    this.buffer += String(chunk);
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try { const { idle } = JSON.parse(line) as { idle?: unknown }; if (typeof idle === 'number' && Number.isFinite(idle) && idle >= 0) { this.latest = idle; this.at = this.now(); } } catch { /* A cut line. */ }
    }
  }
  // Closing its input stops the helper.
  stop(): void { const child = this.child; this.child = null; this.latest = null; if (child) { child.stdin?.end(); child.kill?.(); } }
  // Seconds since the last input: the helper's reading, aged since it came, or the whole-second fallback.
  idle(): number | null {
    if (this.latest !== null && this.now() - this.at < this.every * 5) return this.latest + (this.now() - this.at) / 1000;
    const fallback = this.fallback();
    return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
  }
  get fine(): boolean { return this.latest !== null && this.now() - this.at < this.every * 5; }
}
