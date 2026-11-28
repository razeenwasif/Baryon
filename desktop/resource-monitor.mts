import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY = join(__dirname, '..', 'native', 'bin', 'fairy-resource-monitor');
const RING_MAX = 3600;

export interface ResourceProcessSnapshot {
  pid: number;
  ppid: number;
  name: string;
  rssBytes: number;
  cpuNs: number;
}

export interface ResourceSample {
  pid: number;
  timestampMs: number;
  processCount: number;
  totalRssBytes: number;
  cpuNs: number;
  deltaCpuNs: number;
  processes: ResourceProcessSnapshot[];
  fallback?: boolean;
}

export interface ResourceRingStats {
  capacity: number;
  length: number;
  binary: boolean;
  latest: ResourceSample | null;
}

export interface ResourceMonitorOptions {
  binaryPath?: string;
  rootPid?: number;
}

interface RpcWaiter {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface RpcResponse {
  ok?: boolean;
  sample?: ResourceSample;
  samples?: ResourceSample[];
}

/**
 * Node fallback process-tree resource snapshot when the compiled Rust sidecar isn't present.
 */
function nodeFallbackSample(pid = process.pid): Promise<ResourceSample> {
  const mem = process.memoryUsage();
  return Promise.resolve({
    pid,
    timestampMs: Date.now(),
    processCount: 1,
    totalRssBytes: mem.rss,
    cpuNs: Math.round((process.cpuUsage().user + process.cpuUsage().system) * 1000),
    deltaCpuNs: 0,
    processes: [{ pid, ppid: process.ppid, name: 'node', rssBytes: mem.rss, cpuNs: 0 }],
    fallback: true,
  });
}

/**
 * Client for the Rust `fairy-resource-monitor` Darwin libproc sidecar, maintaining a 1-hour (3600-sample) ring buffer.
 */
export class ResourceMonitorClient {
  binaryPath: string;
  rootPid: number;
  child: ChildProcessByStdio<Writable, Readable, null> | null;
  ring: ResourceSample[];
  buf: string;
  waiters: RpcWaiter[];

  constructor({ binaryPath = DEFAULT_BINARY, rootPid = process.pid }: ResourceMonitorOptions = {}) {
    this.binaryPath = binaryPath;
    this.rootPid = rootPid;
    this.child = null;
    this.ring = [];
    this.buf = '';
    this.waiters = [];
  }

  hasBinary(): boolean {
    return existsSync(this.binaryPath);
  }

  #ensureDaemon(): boolean {
    if (this.child && !this.child.killed) return true;
    if (!this.hasBinary()) return false;
    const child = spawn(this.binaryPath, ['--pid', String(this.rootPid)], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        const waiter = this.waiters.shift();
        if (!waiter) continue;
        try { waiter.resolve(JSON.parse(line)); }
        catch (err) { waiter.reject(err); }
      }
    });
    const cleanup = (): void => {
      this.child = null;
      while (this.waiters.length) {
        const waiter = this.waiters.shift();
        waiter?.reject(new Error('Resource monitor exited'));
      }
    };
    child.on('error', cleanup);
    child.on('close', cleanup);
    return true;
  }

  #rpc(payload: Record<string, unknown>): Promise<RpcResponse | null> {
    if (!this.#ensureDaemon() || !this.child) return Promise.resolve(null);
    const child = this.child;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve: value => resolve(value as RpcResponse | null), reject });
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (err) {
        this.waiters.pop();
        reject(err);
      }
    });
  }

  #pushRing(sample: ResourceSample | null | undefined): void {
    if (!sample) return;
    this.ring.push(sample);
    if (this.ring.length > RING_MAX) this.ring.shift();
  }

  async sample(pid = this.rootPid): Promise<ResourceSample> {
    const res = await this.#rpc({ op: 'sample', pid }).catch(() => null);
    const s = res?.sample || (await nodeFallbackSample(pid));
    this.#pushRing(s);
    return s;
  }

  async history(limit = 120): Promise<ResourceSample[]> {
    const clean = Math.max(1, Math.min(RING_MAX, Math.floor(Number(limit) || 120)));
    const res = await this.#rpc({ op: 'history', limit: clean }).catch(() => null);
    if (res?.ok && Array.isArray(res.samples)) return res.samples;
    return this.ring.slice(-clean);
  }

  ringStats(): ResourceRingStats {
    const latest = this.ring.at(-1) || null;
    return {
      capacity: RING_MAX,
      length: this.ring.length,
      binary: this.hasBinary(),
      latest,
    };
  }

  async once(pid = this.rootPid): Promise<ResourceSample> {
    if (!this.hasBinary()) return nodeFallbackSample(pid);
    return new Promise((resolve, reject) => {
      execFile(this.binaryPath, ['--once', '--pid', String(pid)], { timeout: 5000, encoding: 'utf8' }, (err, out) => {
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(String(out || '').trim()) as ResourceSample;
          this.#pushRing(parsed);
          resolve(parsed);
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      try { this.child.stdin.write('{"op":"quit"}\n'); } catch {}
      try { this.child.kill(); } catch {}
    }
    this.child = null;
    this.waiters = [];
  }
}
