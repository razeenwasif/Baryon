import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY = join(__dirname, '..', 'native', 'bin', 'fairy-resource-monitor');
const RING_MAX = 3600;

/**
 * Node fallback process-tree resource snapshot when the compiled Rust sidecar isn't present.
 */
function nodeFallbackSample(pid = process.pid) {
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
  constructor({ binaryPath = DEFAULT_BINARY, rootPid = process.pid } = {}) {
    this.binaryPath = binaryPath;
    this.rootPid = rootPid;
    this.child = null;
    this.ring = [];
    this.buf = '';
    this.waiters = [];
  }

  hasBinary() {
    return existsSync(this.binaryPath);
  }

  #ensureDaemon() {
    if (this.child && !this.child.killed) return true;
    if (!this.hasBinary()) return false;
    this.child = spawn(this.binaryPath, ['--pid', String(this.rootPid)], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        const waiter = this.waiters.shift();
        if (!waiter) continue;
        try { waiter.resolve(JSON.parse(line)); }
        catch (err) { waiter.reject(err); }
      }
    });
    const cleanup = () => {
      this.child = null;
      while (this.waiters.length) this.waiters.shift().reject(new Error('Resource monitor exited'));
    };
    this.child.on('error', cleanup);
    this.child.on('close', cleanup);
    return true;
  }

  #rpc(payload) {
    if (!this.#ensureDaemon()) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (err) {
        this.waiters.pop();
        reject(err);
      }
    });
  }

  #pushRing(sample) {
    if (!sample) return;
    this.ring.push(sample);
    if (this.ring.length > RING_MAX) this.ring.shift();
  }

  async sample(pid = this.rootPid) {
    const res = await this.#rpc({ op: 'sample', pid }).catch(() => null);
    const s = res?.sample || (await nodeFallbackSample(pid));
    this.#pushRing(s);
    return s;
  }

  async history(limit = 120) {
    const clean = Math.max(1, Math.min(RING_MAX, Math.floor(Number(limit) || 120)));
    const res = await this.#rpc({ op: 'history', limit: clean }).catch(() => null);
    if (res?.ok && Array.isArray(res.samples)) return res.samples;
    return this.ring.slice(-clean);
  }

  ringStats() {
    const latest = this.ring.at(-1) || null;
    return {
      capacity: RING_MAX,
      length: this.ring.length,
      binary: this.hasBinary(),
      latest,
    };
  }

  async once(pid = this.rootPid) {
    if (!this.hasBinary()) return nodeFallbackSample(pid);
    return new Promise((resolve, reject) => {
      execFile(this.binaryPath, ['--once', '--pid', String(pid)], { timeout: 5000, encoding: 'utf8' }, (err, out) => {
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(String(out || '').trim());
          this.#pushRing(parsed);
          resolve(parsed);
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  }

  stop() {
    if (this.child && !this.child.killed) {
      try { this.child.stdin.write('{"op":"quit"}\n'); } catch {}
      try { this.child.kill(); } catch {}
    }
    this.child = null;
    this.waiters = [];
  }
}
