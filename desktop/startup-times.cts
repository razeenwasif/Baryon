// Efficiency audit, fix 12: how long a launch takes, step by step, so lazy loading can be timed before and after.
// The main process marks its own steps in milliseconds since it started; the window reports when it became usable,
// in milliseconds since its page began loading, and that is placed on the same clock. Each launch adds one line to
// startup.jsonl, which keeps the last 50.
const { performance } = require('node:perf_hooks') as typeof import('node:perf_hooks');

const KEEP = 50;

interface StartupTimesOptions {
  now?: () => number;
  wall?: () => number;
}

interface StartupRecord {
  at: string;
  marks: Record<string, number>;
}

interface StartupFinishOptions {
  path: string;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string | Buffer>;
  writeFile: (path: string, data: string, options: { mode: number }) => Promise<unknown>;
}

class StartupTimes {
  now: () => number;
  wall: () => number;
  marks: Record<string, number>;
  done: boolean;

  constructor({ now = () => performance.now(), wall = () => Date.now() }: StartupTimesOptions = {}) {
    this.now = now;
    this.wall = wall;
    this.marks = {};
    this.done = false;
  }

  mark(name: string): void {
    if (!this.done && !(name in this.marks)) this.marks[name] = Math.round(this.now());
  }

  // page: the window's own marks, measured from its navigation start; loadStarted: the main-process time it began.
  pageMarks(page: Record<string, unknown> | null | undefined, loadStarted: number): void {
    if (this.done || !page || typeof page !== 'object' || !Number.isFinite(loadStarted)) return;
    for (const [name, ms] of Object.entries(page)) {
      const key = `page-${name}`;
      if (/^[a-z-]{1,40}$/.test(name) && typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms < 600000 && !(key in this.marks)) this.marks[key] = Math.round(loadStarted + ms);
    }
  }

  record(): StartupRecord {
    return { at: new Date(this.wall()).toISOString(), marks: { ...this.marks } };
  }

  async finish({ path, readFile, writeFile }: StartupFinishOptions): Promise<StartupRecord | null> {
    if (this.done) return null;
    this.done = true;
    const line = this.record();
    let kept: string[] = [];
    try { kept = String(await readFile(path, 'utf8')).split('\n').filter(Boolean).slice(-(KEEP - 1)); } catch {}
    await writeFile(path, [...kept, JSON.stringify(line)].join('\n') + '\n', { mode: 0o600 });
    return line;
  }
}

module.exports = { StartupTimes, KEEP };
