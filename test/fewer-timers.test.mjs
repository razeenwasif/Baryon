// Efficiency audit, fix 6: the stall watch, the quiz's hover sampler and the companion's cursor check wake Fairy less.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAIN_STALL_MS, StallWatch, WATCH_EVERY_MS } from '../desktop/stall-log.mjs';
import { QuizTarget } from '../desktop/quiz-target.mjs';
import { CURSOR_FAR_MS, CURSOR_NEAR_MS, cursorCheckDelay } from '../src/cursor-check.js';

// A watch on a clock the test turns, with its interval run by hand.
function watch({ active = true, suspended = false } = {}) {
  let clock = 0, interval = null, seen = active;
  const stalls = [];
  const w = new StallWatch({ report: ms => stalls.push(ms), active: () => seen, suspended: () => suspended, now: () => clock,
    schedule: (fn, ms) => (interval = { fn, ms }), clear: () => { interval = null; } });
  return { w, stalls, interval: () => interval, set seen(value) { seen = value; },
    tick: (after = WATCH_EVERY_MS) => { clock += after; interval.fn(); } };
}

test('while someone can see Fairy, a one-second stall is caught as it always was', () => {
  const f = watch();
  f.w.sync();
  assert.equal(f.interval().ms, 250, 'it looks four times a second, as before');
  f.tick(); f.tick();
  assert.deepEqual(f.stalls, [], 'on time: nothing logged');
  f.tick(WATCH_EVERY_MS + MAIN_STALL_MS);
  assert.deepEqual(f.stalls, [1000], 'a tick a second late is a one-second stall');
  f.tick(WATCH_EVERY_MS + 900);
  assert.deepEqual(f.stalls, [1000], 'under a second is not');
});

test('while nobody can see Fairy the watch sleeps, and it starts again without counting the gap as a stall', () => {
  const f = watch();
  f.w.sync();
  f.seen = false; f.w.sync();
  assert.equal(f.interval(), null, 'no timer at all');
  f.seen = true; f.w.sync();
  assert.ok(f.interval());
  f.tick();
  assert.deepEqual(f.stalls, [], 'the time asleep is not a stall');
  f.w.dispose();
  assert.equal(f.interval(), null);
});

test('a stall across the Mac sleeping is not logged', () => {
  const f = watch({ suspended: true });
  f.w.sync(); f.tick(WATCH_EVERY_MS + 5000);
  assert.deepEqual(f.stalls, []);
});

test('the hover sampler looks quickly only while there is a heading to hover, and a heading wakes it', () => {
  let now = 10000, woken = 0;
  const target = new QuizTarget({ now: () => now });
  target.onHeadings = () => woken++;
  assert.equal(target.hoverEveryMs(), 1000, 'nothing seen: a look a second');
  target.select({ lines: [{ text: 'Question 1', x: 0.1, y: 0.1, width: 0.2, height: 0.02 }] }, null, { bounds: { x: 0, y: 0, width: 1000, height: 800 }, capturedAt: now });
  assert.equal(target.heads.length, 1);
  assert.equal(woken, 1, 'a heading seen wakes the sampler');
  assert.equal(target.hoverEveryMs(), 100);
  now += 2600;
  assert.equal(target.hoverEveryMs(), 1000, 'the heading has gone stale');
  target.heads = [{ id: 'q1', line: { x: 0, y: 0, width: 1, height: 1 } }]; target.bounds = { x: 0, y: 0, width: 1000, height: 800 }; target.headingAt = now;
  assert.equal(target.hoverEveryMs(), 100);
  target.clear();
  target.pendingHover = { id: 'q1', at: now, requestedAt: now };
  assert.equal(target.hoverEveryMs(), 100, 'a hover waiting to be confirmed keeps it quick');
});

test('the companion checks the cursor often near its window and rarely far from it', () => {
  assert.equal(cursorCheckDelay({ x: 100, y: 100 }, 340, 520), CURSOR_NEAR_MS);
  assert.equal(cursorCheckDelay({ x: -150, y: 500 }, 340, 520), CURSOR_NEAR_MS, 'just outside counts as near');
  assert.equal(cursorCheckDelay({ x: 900, y: 100 }, 340, 520), CURSOR_FAR_MS);
  assert.equal(cursorCheckDelay(null, 340, 520), CURSOR_FAR_MS);
  assert.ok(CURSOR_FAR_MS <= 250, 'hover still shows within a quarter of a second');
});

test('the app wires them in', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /stallWatch = new StallWatch\(\{ active: \(\) => Boolean\(windowSight\?\.visible\) \|\| Boolean\(companionWindow && !companionWindow\.isDestroyed\(\) && companionWindow\.isVisible\(\)\),/);
  assert.match(main, /function syncBackgroundTasks\(\)\{for\(const task of backgroundTasks\)task\.sync\(\);stallWatch\?\.sync\(\);\}/);
  assert.match(main, /companionWindow = null; quickChat\?\.stop\(\); stallWatch\?\.sync\(\);/);
  assert.doesNotMatch(main, /setInterval\(\(\) => \{\n\s*const lateBy/, 'no always-on stall interval left');
  // The quiz's poll and hover sampler are built in quiz-setup.mjs (two Macs, step 8), for the full Fairy and a face alike.
  const setup = readFileSync(new URL('../desktop/quiz-setup.mjs', import.meta.url), 'utf8');
  assert.match(setup, /return now\.look \? target\.hoverEveryMs\(\) : now\.delay;/);
  assert.match(setup, /target\.onHeadings = \(\) => \{ if \(hover\.at != null && hover\.at - Date\.now\(\) > 150\) hover\.sync\(true\); \};/);
  assert.match(main, /quizTasks\(\{ quiz, target: quizTarget,/);
  const companion = readFileSync(new URL('../src/companion.js', import.meta.url), 'utf8');
  assert.match(companion, /next = cursorCheckDelay\(point, innerWidth, innerHeight\);\n  \} finally \{ setTimeout\(checkCursor, next\); \}/);
  assert.doesNotMatch(companion, /\}, 60\);/, 'no fixed 60 ms interval left');
});
