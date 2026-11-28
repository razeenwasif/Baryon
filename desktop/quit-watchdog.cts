'use strict';
// The last word on quitting: once a quit starts, Fairy is gone within QUIT_HARD_LIMIT_MS, whatever holds it.
// On 19 Nov the update's SIGTERM didn't end her on the mini: the quit gate's onFailed opened dialog.showErrorBox, a
// modal alert. While it was up the main thread ran no JavaScript (her timers waited, the quit gate's limit included),
// and AppKit turned down the Quit Apple Event ("User cancelled (-128)"). She went 67 s later, when the alert was clicked.
// Anything the main thread does can be held like that, so the watch runs on a thread of its own (a worker): it doesn't
// need the main thread to wake it, writes what it knows with synchronous calls, and can end the process
// (quit-watch-worker.mjs).
//
// At the limit it writes one line to quit.jsonl saying how far the quit got (the last stage the main thread reported)
// and asks the main thread to exit. If the main thread doesn't answer within GRACE_MS, it leaves the clean-quit note
// (so the keep-alive doesn't take this for a crash and open her again), stops her child processes and kills her.
import type { Worker as WorkerInstance, WorkerOptions } from 'node:worker_threads';

const { Worker } = require('node:worker_threads') as typeof import('node:worker_threads');
const { join } = require('node:path') as typeof import('node:path');
const { pathToFileURL } = require('node:url') as typeof import('node:url');

const QUIT_HARD_LIMIT_MS = 10000;
const GRACE_MS = 1500;

interface WorkerExitMessage {
  type?: string;
  stage?: string;
}

interface QuitWatchdogOptions {
  log: string;
  note?: () => string;
  onExit: (stage: string | undefined) => void;
  limit?: number;
  grace?: number;
  pid?: number;
  makeWorker?: (options: WorkerOptions) => WorkerInstance;
}

interface QuitWatchdog {
  start: () => void;
  report: (stage: string, detail?: unknown) => void;
  readonly running: boolean;
}

interface WatchdogWindowLike {
  webContents: { getURL: () => string };
  getTitle: () => string;
  isVisible: () => boolean;
}

interface BrowserWindowStaticLike {
  getAllWindows: () => WatchdogWindowLike[];
}

interface OpenWindowInfo {
  title: string;
  page: string;
  visible: boolean;
}

interface DescribedError {
  name?: string;
  message: string;
  code?: unknown;
  syscall?: unknown;
  file?: string;
  errors?: DescribedError[];
}

// log: quit.jsonl. note(): the clean-quit note's path, or '' when a quit shouldn't leave one (a restart for a face).
// onExit(stage): the main thread's answer at the limit, normally app.exit(0).
// Returns report(stage, detail): tells the watch how far the quit got. Starting it again is a no-op.
function quitWatchdog({
  log,
  note = () => '',
  onExit,
  limit = QUIT_HARD_LIMIT_MS,
  grace = GRACE_MS,
  pid = process.pid,
  makeWorker = (options: WorkerOptions) => new Worker(pathToFileURL(join(__dirname, 'quit-watch-worker.mjs')), options),
}: QuitWatchdogOptions): QuitWatchdog {
  let worker: WorkerInstance | null = null, failed = false;
  const report = (stage: string, detail?: unknown): void => {
    if (!worker) return;
    try { worker.postMessage({ type: 'stage', stage, detail: detail ?? null }); } catch {}
  };
  return {
    start() {
      if (worker || failed) return;
      try {
        worker = makeWorker({ workerData: { limit, grace, log, note: note() || '', pid } });
        worker.unref?.();
        worker.on('message', (message: WorkerExitMessage | null | undefined) => { if (message?.type === 'exit') { try { onExit(message.stage); } catch (error) { console.error('Fairy could not exit:', error); } } });
        worker.on('error', (error: Error) => console.error('Fairy’s quit watch stopped:', error));
      } catch (error) { failed = true; console.error('Fairy could not start her quit watch:', error); }
    },
    report,
    get running() { return Boolean(worker); },
  };
}

// What's still open, for the log: a quit that's stuck closing windows names them.
function openWindows(BrowserWindow: BrowserWindowStaticLike): OpenWindowInfo[] {
  try {
    return BrowserWindow.getAllWindows().map(win => {
      let page = '';
      try { const url = new URL(win.webContents.getURL()); page = url.protocol === 'file:' ? (url.pathname.split('/').pop() ?? '') : `${url.protocol}//${url.host}`; } catch {}
      return { title: win.getTitle(), page, visible: win.isVisible() };
    });
  } catch { return []; }
}

// One error, short enough for a log line: what failed and on which file.
function describeError(error: unknown): DescribedError {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const err = error as {
    name?: string;
    message?: unknown;
    code?: unknown;
    syscall?: unknown;
    path?: unknown;
    errors?: unknown[];
  };
  const own: DescribedError = { name: err.name, message: String(err.message || '').slice(0, 300) };
  if (err.code) own.code = err.code;
  if (err.syscall) own.syscall = err.syscall;
  if (err.path) own.file = String(err.path).split('/').pop();
  if (Array.isArray(err.errors)) own.errors = err.errors.slice(0, 10).map(describeError);
  return own;
}

module.exports = { QUIT_HARD_LIMIT_MS, GRACE_MS, quitWatchdog, openWindows, describeError };
