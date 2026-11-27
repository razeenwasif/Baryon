// Two Macs, step 5: this Mac's idle time to the fraction of a second, from native/bin/fairy-idle while presence is being
// watched. Electron's powerMonitor gives whole seconds, which made her up to a second late (step 1), so that is only
// the fallback when the helper isn't there.
import { spawn } from 'node:child_process';

export class IdleReader {
  constructor({ path, every = 200, fallback = () => null, spawnProcess = spawn, now = Date.now }) {
    Object.assign(this, { path, every, fallback, spawnProcess, now });
    this.child = null; this.latest = null; this.at = 0; this.buffer = '';
  }
  start() {
    if (this.child) return;
    let child;
    try { child = this.spawnProcess(this.path, [String(this.every)], { stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return; }
    this.child = child; this.buffer = '';
    child.on('error', () => { if (this.child === child) this.child = null; });
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', chunk => this.read(chunk));
  }
  read(chunk) {
    this.buffer += String(chunk);
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try { const { idle } = JSON.parse(line); if (Number.isFinite(idle) && idle >= 0) { this.latest = idle; this.at = this.now(); } } catch { /* A cut line. */ }
    }
  }
  // Closing its input stops the helper.
  stop() { const child = this.child; this.child = null; this.latest = null; if (child) { child.stdin?.end(); child.kill?.(); } }
  // Seconds since the last input: the helper's reading, aged since it came, or the whole-second fallback.
  idle() {
    if (this.latest !== null && this.now() - this.at < this.every * 5) return this.latest + (this.now() - this.at) / 1000;
    const fallback = this.fallback();
    return Number.isFinite(fallback) ? fallback : null;
  }
  get fine() { return this.latest !== null && this.now() - this.at < this.every * 5; }
}
