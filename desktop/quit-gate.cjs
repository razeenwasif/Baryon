'use strict';
// Quitting waits for the jobs Fairy finishes on her way out (the recognizer letting go of its audio, work chats
// saving what happened, app data reaching disk), but only up to a limit. On 18 Nov a promises.json save on the mini
// never finished: every quit after that was cancelled, SIGTERM and Quit included, until she was force-quit.
// The update script (scripts/fairy-to-mini.mjs) gives her 30 seconds after SIGTERM, so the limit stays well under that.
const QUIT_LIMIT_MS = 8000;

// jobs: { name: promise }. Settles with which ones failed, or, once limit runs out, which were still pending.
function waitToQuit(jobs, { limit = QUIT_LIMIT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const names = Object.keys(jobs), state = Object.fromEntries(names.map(name => [name, 'pending'])), errors = {};
  const watched = names.map(name => Promise.resolve(jobs[name]).then(() => { state[name] = 'done'; }, error => { state[name] = 'failed'; errors[name] = error; }));
  const outcome = timedOut => ({ timedOut, pending: names.filter(name => state[name] === 'pending'), failed: names.filter(name => state[name] === 'failed'), errors: { ...errors } });
  return new Promise(resolve => {
    const timer = setTimer(() => resolve(outcome(true)), Math.max(0, limit));
    void Promise.all(watched).then(() => { clearTimer(timer); resolve(outcome(false)); });
  });
}

// The before-quit listener. busy(): whether anything is left to finish. jobs(): what to wait for, made when the quit
// starts. quit(): asks again once they're done or the time is up. The limit covers the whole quit, so jobs that
// keep turning up can't hold it open either: once it's spent, the quit goes ahead with whatever is still pending.
function quitGate({ busy, jobs, quit, onTimeout = () => {}, onFailed = () => {}, limit = QUIT_LIMIT_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let deadline = null, waiting = null;
  return function beforeQuit(event) {
    if (!busy()) return;
    deadline ??= now() + limit;
    const left = deadline - now();
    if (left <= 0) return;
    event.preventDefault();
    if (waiting) return;
    waiting = waitToQuit(jobs(), { limit: left, setTimer, clearTimer }).then(outcome => {
      try { if (outcome.timedOut) onTimeout(outcome); else if (outcome.failed.length) onFailed(outcome); }
      catch (error) { console.error('Fairy could not report what was left when quitting:', error); }
      finally { waiting = null; quit(); }
    });
  };
}

module.exports = { QUIT_LIMIT_MS, waitToQuit, quitGate };
