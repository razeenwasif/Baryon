import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { DWELL_MS, LAG_LIMIT_MS, OVERLAP_LIMIT_MS, activeSamples, crossings, format, parseLog, report } from '../scripts/pointer-report.mjs';

const run = promisify(execFile);
const T0 = 1_700_000_000_000;
// A Mac's log from made-up use: spans are [from, to, 'move' | 'type'] in milliseconds. A move changes the pointer's place
// and resets the idle time; a type only resets the idle time. Sampled every 100 ms, as the logger does.
function macLog(end, spans) {
  const lines = [];
  let x = 100, lastInput = -1e9;
  for (let t = 0; t <= end; t += 100) {
    const span = spans.find(([from, to]) => t >= from && t < to);
    if (span) { lastInput = t; if (span[2] !== 'type') x += 7; }
    lines.push(JSON.stringify({ t: T0 + t, x, y: 50, idle: (t - lastInput) / 1000 }));
  }
  return lines.join('\n') + '\n';
}
const logs = (end, first, second) => [parseLog(macLog(end, first)), parseLog(macLog(end, second))];
// Crossing slowly: five seconds on one Mac, five on the other, and back.
const clean = () => logs(15000, [[0, 5000, 'move'], [10000, 15000, 'move']], [[5000, 10000, 'move']]);
const row = (result, rule, idle) => result.rows.find(item => item.rule === rule && item.idle === idle);

test('parseLog keeps whole lines and drops one cut off or damaged', () => {
  const lines = parseLog('{"t":2,"x":1,"y":1,"idle":0.5}\n{"t":1,"x":1,"y":1,"idle":0.4}\n{"t":3,"x":1,"y"\nnot json\n{"t":4,"x":1,"y":"a","idle":1}\n');
  assert.deepEqual(lines.map(line => line.t), [1, 2]);
});

test('activeSamples counts a moved pointer, a recent key and nothing else, in whole seconds too', () => {
  const lines = [
    { t: 1000, x: 5, y: 5, idle: 9 }, { t: 1100, x: 6, y: 5, idle: 9 }, // moved, though idle says no
    { t: 1200, x: 6, y: 5, idle: 0.05 }, { t: 1300, x: 6, y: 5, idle: 0.14 }, { t: 1400, x: 6, y: 5, idle: 0.3 }, { t: 1500, x: 6, y: 5, idle: 0.9 },
  ];
  assert.deepEqual(activeSamples(lines).map(item => item.t), [1100, 1200, 1300]);
  assert.deepEqual(activeSamples(lines, { wholeSeconds: true }).map(item => item.t), [1100, 1200, 1300, 1400, 1500]);
  // The real input is found from the idle time: a key 0.05 s before the sample at 1200.
  assert.equal(activeSamples(lines)[1].input, 1200 - 50);
});

// Three seconds as the logger wrote them on the mini while it was driven from the MacBook by Universal Control: the pointer
// moves while the idle time keeps counting up, and when the idle time does reset it resets to about 0.5 s, never to 0.
// [milliseconds from the first sample, x, y, idle]
const DRIVEN = [[0, 1150, 493, 1.609], [105, 1150, 493, 1.714], [210, 1150, 493, 1.820], [311, 1150, 493, 1.920], [416, 1150, 493, 0.526], [517, 1150, 493, 0.626],
  [622, 1150, 493, 0.731], [726, 1150, 493, 0.836], [831, 1150, 493, 0.941], [936, 1150, 493, 1.046], [1041, 1150, 493, 1.151], [1146, 1150, 493, 1.256],
  [1251, 1150, 493, 1.361], [1356, 1150, 493, 1.466], [1461, 1150, 493, 1.571], [1566, 1150, 493, 1.676], [1671, 1150, 493, 1.781], [1776, 886, 532, 1.885],
  [1879, 630, 642, 1.988], [1984, 630, 642, 0.593], [2089, 535, 637, 0.698], [2194, 280, 641, 0.804], [2296, 280, 641, 0.906], [2401, 280, 641, 0.511],
  [2507, 370, 555, 0.616], [2609, 859, 205, 0.719], [2714, 859, 205, 0.824], [2820, 1007, 171, 0.929], [2921, 1161, 133, 0.531]]
  .map(([at, x, y, idle]) => ({ t: T0 + at, x, y, idle }));

test('on a Mac driven by Universal Control, input shows as a moved pointer or a fall in idle time, not an idle time near 0', () => {
  const fine = activeSamples(DRIVEN);
  assert.deepEqual(fine.map(item => item.t - T0), [416, 1776, 1879, 1984, 2089, 2194, 2401, 2507, 2609, 2820, 2921]);
  // The sample where the idle time fell from 1.920 to 0.526 with the pointer still is input, at that sample.
  assert.equal(fine[0].input - T0, 416);
  // Electron's whole-second idle time, plus the pointer, calls it active for the second after each reset too.
  const whole = activeSamples(DRIVEN, { wholeSeconds: true });
  assert.deepEqual(whole.map(item => item.t - T0), [416, 517, 622, 726, 831, 1776, 1879, 1984, 2089, 2194, 2296, 2401, 2507, 2609, 2714, 2820, 2921]);
  // The last real input is the same, so the report can show how late the whole-second reading is: 831 against 416.
  assert.equal(whole[4].input - T0, 416);
});

test('a clean crossing each way is named at once after the dwell, with no overlap', () => {
  const result = report(...clean(), { expect: 2, names: ['macbook', 'mini'] });
  const plan = row(result, 'fresh', 'fine');
  assert.equal(plan.crossings, 2);
  assert.ok(plan.worstLagMs <= LAG_LIMIT_MS, `lag ${plan.worstLagMs}`);
  assert.equal(plan.longOverlaps, 0);
  assert.deepEqual(plan.switches.map(item => [item.from, item.to]), [['a', 'b'], ['b', 'a']]);
  assert.equal(plan.pass, true);
  assert.equal(result.choice, 'follow-finer-idle');
});

test('a switch never comes sooner than the dwell after the old Mac’s last input', () => {
  const [a, b] = clean();
  const { switches } = crossings(activeSamples(a), activeSamples(b), { from: a[0].t, to: a.at(-1).t });
  for (const item of switches) assert.ok(item.lagMs >= 0);
  // The first one: the last input on the first Mac was at 4900 ms, so no sooner than 5900 ms.
  assert.ok(switches[0].at - T0 >= 4900 + DWELL_MS);
});

test('whole-second idle time makes her late, which the report says', () => {
  const result = report(...clean(), { expect: 2 });
  const fine = row(result, 'fresh', 'fine'), whole = row(result, 'fresh', 'whole');
  assert.ok(whole.worstLagMs > fine.worstLagMs + 500, `${fine.worstLagMs} against ${whole.worstLagMs}`);
  assert.equal(whole.pass, false);
  assert.match(format(result), /fraction of a second/);
});

test('someone who stops moving after crossing is missed by the plan rule and caught by the latest-input rule', () => {
  const result = report(...logs(12000, [[0, 5000, 'move']], [[5000, 5300, 'move'], [9000, 9500, 'move']]), { expect: 1 });
  const plan = row(result, 'fresh', 'fine'), latest = row(result, 'latest', 'fine');
  assert.ok(plan.worstLagMs > 2000, `${plan.worstLagMs}`);
  assert.equal(plan.pass, false);
  assert.equal(latest.crossings, 1);
  assert.ok(latest.worstLagMs <= LAG_LIMIT_MS);
  assert.equal(result.choice, 'follow-latest-rule');
});

test('an idle Mac that keeps showing input is an overlap, and the choice is the manual fallback', () => {
  // The second Mac's idle time resets every 300 ms, as if something nudged it, while the first is in use throughout.
  const flicker = Array.from({ length: 34 }, (_, k) => [k * 300, k * 300 + 100, 'type']);
  const result = report(...logs(10000, [[0, 10000, 'move']], flicker));
  const plan = row(result, 'fresh', 'fine');
  assert.ok(plan.longestOverlapMs > 9000);
  assert.equal(plan.longOverlaps, 1);
  assert.equal(plan.pass, false);
  assert.equal(result.choice, 'manual');
  assert.match(format(result), /Bring Fairy here/);
});

test('switches less than two seconds apart are flapping and fail, even when each lag is small', () => {
  // The two Macs take turns every 1.3 s, shorter than the dwell plus a pause, so she would hop back and forth.
  const result = report(...logs(9000, [[0, 1300, 'move'], [2600, 3900, 'move'], [5200, 6500, 'move'], [7800, 9000, 'move']],
    [[1300, 2600, 'move'], [3900, 5200, 'move'], [6500, 7800, 'move']]));
  const plan = row(result, 'fresh', 'fine');
  assert.ok(plan.crossings >= 4, `${plan.crossings}`);
  assert.ok(plan.quickSwitches >= 3, `${plan.quickSwitches}`);
  assert.equal(plan.pass, false);
});

test('an overlap at a crossing of a second or so is normal; more than two seconds is not', () => {
  // The Mac being left keeps looking in use for 1.5 s after the other starts, as the real logs show at each crossing.
  const [a, b] = logs(15000, [[0, 5000, 'move'], [10000, 15000, 'move']], [[3500, 10000, 'move']]);
  const plan = row(report(a, b, { expect: 2 }), 'fresh', 'fine');
  assert.ok(plan.longestOverlapMs > DWELL_MS && plan.longestOverlapMs <= OVERLAP_LIMIT_MS, `${plan.longestOverlapMs}`);
  assert.equal(plan.longOverlaps, 0);
  assert.equal(plan.pass, true);
});

test('the shortest clean dwell is found by replaying shorter ones', () => {
  const result = report(...clean(), { expect: 2 });
  assert.deepEqual(result.dwells.map(item => item.dwell), [300, 400, 500, 600, 800, 1000]);
  assert.ok(result.dwells.every(item => item.crossings === 2 && item.quickSwitches === 0));
  assert.equal(result.shortestCleanDwell, 300);
  assert.match(format(result), /shortest clean dwell is 300 ms/);
});

test('the number of crossings must match what was asked for, so a flapping Mac fails', () => {
  assert.equal(report(...clean(), { expect: 20 }).rows[0].pass, false);
});

test('logs that don’t overlap say so, and an offset lines them up', () => {
  const [a, b] = clean();
  const late = b.map(line => ({ ...line, t: line.t + 600_000 }));
  assert.throws(() => report(a, late), /overlap for less than 5 seconds/);
  assert.equal(report(a, late, { offsetMs: 600_000 }).rows[0].crossings, 2);
});

test('the command line reads two files and prints the table, or JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pointer-report-'));
  try {
    const [first, second] = [join(dir, 'macbook.jsonl'), join(dir, 'mini.jsonl')];
    await writeFile(first, macLog(15000, [[0, 5000, 'move'], [10000, 15000, 'move']]));
    await writeFile(second, macLog(15000, [[5000, 10000, 'move']]));
    const script = join(import.meta.dirname, '../scripts/pointer-report.mjs');
    const text = (await run(process.execPath, [script, first, second, '--expect', '2'])).stdout;
    assert.match(text, /macbook: 151 samples, mini: 151/);
    assert.match(text, /plan rule, fine idle time\s+2\s+0\.1 s\s+0\.\d s\s+0\s+pass/);
    assert.match(text, /Choice: /);
    const json = JSON.parse((await run(process.execPath, [script, first, second, '--json'])).stdout);
    assert.equal(json.rows.length, 4);
    await assert.rejects(run(process.execPath, [script, first]), error => error.code === 2 && /Usage/.test(error.stderr));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the logger prints the fields the report reads, from the calls the plan names', async () => {
  const source = await readFile(join(import.meta.dirname, '../scripts/pointer-log.swift'), 'utf8');
  for (const field of ['t', 'x', 'y', 'idle']) assert.ok(source.includes(`\\"${field}\\":`), field);
  assert.match(source, /NSEvent\.mouseLocation/);
  assert.match(source, /secondsSinceLastEventType\(\.combinedSessionState/);
  assert.match(source, /usleep\(100_000\)/);
});
