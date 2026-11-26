import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';

const MAX_BYTES = 256 * 1024, KEEP_BYTES = 128 * 1024;
export const MAIN_STALL_MS = 1000, WATCH_EVERY_MS = 250, LONGEST_REAL_STALL_MS = 60000;
// A timer that runs late means the main process was blocked, as it also handles the window's input.
// A very long gap is the Mac sleeping rather than a freeze.
export const mainStall = (lateBy, { suspended = false } = {}) => !suspended && lateBy >= MAIN_STALL_MS && lateBy < LONGEST_REAL_STALL_MS;
// Efficiency audit, fix 6: the watch runs while someone can see Fairy, her window or the companion, so a Mac where nobody
// can see her isn't woken four times a second. While it runs it looks as often as before, so a one-second stall is caught
// as it always was.
export class StallWatch {
  constructor({ report, active = () => true, suspended = () => false, every = WATCH_EVERY_MS, now = Date.now, schedule = setInterval, clear = clearInterval }) {
    Object.assign(this, { report, active, suspended, every, now, schedule, clear }); this.timer = null; this.last = 0;
  }
  sync() {
    const on = Boolean(this.active());
    if (on && this.timer === null) { this.last = this.now(); this.timer = this.schedule(() => this.tick(), this.every); this.timer?.unref?.(); }
    else if (!on && this.timer !== null) { this.clear(this.timer); this.timer = null; }
  }
  tick() { const now = this.now(), lateBy = now - this.last - this.every; this.last = now; if (mainStall(lateBy, { suspended: this.suspended() })) this.report(lateBy); }
  dispose() { if (this.timer !== null) this.clear(this.timer); this.timer = null; }
}
// When the window freezes, and what was going on: never what was on screen or being said.
export class StallLog {
  constructor({ path, now = () => new Date().toISOString() }) { Object.assign(this, { path, now }); this.queue = Promise.resolve(); }
  add(entry) {
    const line = `${JSON.stringify({ at: this.now(), ...entry })}\n`;
    this.queue = this.queue.then(async () => {
      await appendFile(this.path, line, { mode: 0o600 });
      if ((await stat(this.path)).size > MAX_BYTES) {
        const text = await readFile(this.path, 'utf8');
        await writeFile(this.path, text.slice(text.indexOf('\n', text.length - KEEP_BYTES) + 1), { mode: 0o600 });
      }
    }).catch(error => console.warn('Could not write the stall log:', error.message));
    return this.queue;
  }
}
