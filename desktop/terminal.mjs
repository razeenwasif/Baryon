import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import { computeSmallestViewerSize, truncateAnsiScrollback } from './terminal-vt.mjs';

const MAX_TERMINALS = 8;
const SCROLLBACK_MAX_BYTES = 256 * 1024;

// Your own shell, for you to type in. Fairy's agent has no way to read or write it.
export class Terminals {
  constructor({ spawn, onData, onExit, shell = process.env.SHELL || '/bin/zsh' }) {
    Object.assign(this, { spawn, onData, onExit, shell });
    this.running = new Map();
    this.meta = new Map();
  }
  async start({ cwd, cols = 80, rows = 24, viewerId = 'main' }) {
    if (this.running.size >= MAX_TERMINALS) throw new Error('Close a terminal first.');
    let folder = homedir();
    try { if (typeof cwd === 'string' && (await stat(cwd)).isDirectory()) folder = cwd; } catch {}
    const { ELECTRON_RUN_AS_NODE, ELECTRON_NO_ATTACH_CONSOLE, ...env } = process.env;
    const id = randomUUID(), initCols = this.size(cols, 80), initRows = this.size(rows, 24);
    const pty = this.spawn(this.shell, ['-l'], { name: 'xterm-256color', cols: initCols, rows: initRows, cwd: folder, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Fairy' } });
    const viewers = new Map([[String(viewerId || 'main'), { cols: initCols, rows: initRows }]]);
    this.running.set(id, pty);
    this.meta.set(id, { cwd: folder, cols: initCols, rows: initRows, scrollback: '', viewers });
    pty.onData(data => {
      const m = this.meta.get(id);
      if (m) m.scrollback = truncateAnsiScrollback(m.scrollback + String(data ?? ''), SCROLLBACK_MAX_BYTES);
      this.onData(id, data);
    });
    pty.onExit(({ exitCode }) => {
      this.running.delete(id);
      this.meta.delete(id);
      this.onExit(id, exitCode);
    });
    return { id, cwd: folder };
  }
  size(value, fallback) { const number = Math.floor(Number(value)); return number >= 2 && number <= 500 ? number : fallback; }
  write(id, data) { if (typeof data === 'string' && data.length <= 1024 * 1024) this.running.get(id)?.write(data); }
  setViewerSize(id, viewerId, cols, rows) {
    const pty = this.running.get(id), m = this.meta.get(id);
    if (!pty || !m) return null;
    m.viewers.set(String(viewerId || 'main'), { cols: this.size(cols, m.cols), rows: this.size(rows, m.rows) });
    const target = computeSmallestViewerSize(m.viewers, { fallbackCols: m.cols, fallbackRows: m.rows });
    m.cols = target.cols;
    m.rows = target.rows;
    pty.resize(target.cols, target.rows);
    return target;
  }
  removeViewer(id, viewerId) {
    const pty = this.running.get(id), m = this.meta.get(id);
    if (!pty || !m) return null;
    m.viewers.delete(String(viewerId || ''));
    const target = computeSmallestViewerSize(m.viewers, { fallbackCols: m.cols, fallbackRows: m.rows });
    m.cols = target.cols;
    m.rows = target.rows;
    pty.resize(target.cols, target.rows);
    return target;
  }
  resize(id, cols, rows, viewerId = 'main') {
    this.setViewerSize(id, viewerId, cols, rows);
  }
  snapshot(id) {
    const m = this.meta.get(id);
    if (!m) return null;
    return { id, cwd: m.cwd, cols: m.cols, rows: m.rows, scrollback: m.scrollback, viewers: m.viewers.size };
  }
  stop(id) {
    const pty = this.running.get(id);
    if (pty) {
      this.running.delete(id);
      this.meta.delete(id);
      pty.kill();
    }
  }
  stopAll() { for (const id of [...this.running.keys()]) this.stop(id); }
}
