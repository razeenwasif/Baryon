import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OffPeakQueue, canRunOffPeak, findResettingWindow, parseResetTime } from '../desktop/off-peak-queue.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('parseResetTime parses Gemini/Codex ISO strings and Claude human reset strings', () => {
  const now = new Date(2026, 10, 21, 17, 0, 0).getTime(); // Nov 21, 2026 5:00pm local
  assert.equal(parseResetTime('2026-11-21T06:40:29Z', now), Date.parse('2026-11-21T06:40:29Z'));
  const claudeFull = parseResetTime('Nov 21 at 5:30pm', now);
  assert.equal(claudeFull, new Date(2026, 10, 21, 17, 30, 0).getTime());
  const claudeTime = parseResetTime('5:25pm', now);
  assert.equal(claudeTime, new Date(2026, 10, 21, 17, 25, 0).getTime());
  assert.equal(parseResetTime('garbage', now), null);
  assert.equal(parseResetTime('', now), null);
});

test('findResettingWindow picks soonest 5h reset with unused allowance and respects weekly cap', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  const plans = {
    claude: { meters: [{ short: '5h', used: 90, resets: '2026-11-21T10:20:00Z' }, { short: 'Week', used: 40 }] }, // too used (>85%)
    gemini: { meters: [{ short: '5h', used: 25, resets: '2026-11-21T10:30:00Z' }, { short: 'Week', used: 50 }] }, // eligible! 30m left, 75% unused
    codex: { meters: [{ short: '5h', used: 10, resets: '2026-11-21T12:30:00Z' }, { short: 'Week', used: 10 }] },  // too far (150m > 45m)
  };
  const win = findResettingWindow(plans, { now, leadMinutes: 45, maxUsed: 85, weeklyMaxUsed: 92 });
  assert.equal(win.eligible, true);
  assert.equal(win.provider, 'gemini');
  assert.equal(win.minutesLeft, 30);
  assert.equal(win.unusedPercent, 75);

  // Weekly cap protects against draining weekly budget
  const capped = findResettingWindow({
    gemini: { meters: [{ short: '5h', used: 20, resets: '2026-11-21T10:15:00Z' }, { short: 'Week', used: 95 }] },
  }, { now, leadMinutes: 45, maxUsed: 85, weeklyMaxUsed: 92 });
  assert.equal(capped.eligible, false);
  assert.match(capped.reason, /weekly usage/);
});

test('canRunOffPeak enforces mains power, idle threshold, not busy, and allows local index jobs without 5h reset', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  const eligiblePlans = { gemini: { meters: [{ short: '5h', used: 20, resets: '2026-11-21T10:20:00Z' }] } };
  const farPlans = { gemini: { meters: [{ short: '5h', used: 20, resets: '2026-11-21T13:00:00Z' }] } };

  assert.equal(canRunOffPeak({ onBattery: true, idleSeconds: 600, plans: eligiblePlans, jobKind: 'reflect', now }).ok, false);
  assert.equal(canRunOffPeak({ onBattery: false, idleSeconds: 60, plans: eligiblePlans, jobKind: 'reflect', now }).ok, false);
  assert.equal(canRunOffPeak({ onBattery: false, idleSeconds: 600, busy: true, plans: eligiblePlans, jobKind: 'reflect', now }).ok, false);
  assert.equal(canRunOffPeak({ onBattery: false, idleSeconds: 600, plans: farPlans, jobKind: 'reflect', now }).ok, false);

  // Local index refresh runs on mains + idle even without a resetting 5h window
  const localOk = canRunOffPeak({ onBattery: false, idleSeconds: 600, plans: farPlans, jobKind: 'index', now });
  assert.equal(localOk.ok, true);
  assert.equal(localOk.provider, 'local');

  // Allowance job runs when mains + idle + resetting window align
  const winOk = canRunOffPeak({ onBattery: false, idleSeconds: 600, plans: eligiblePlans, jobKind: 'eval', now });
  assert.equal(winOk.ok, true);
  assert.equal(winOk.provider, 'gemini');
});

test('OffPeakQueue persists, defaults to opt-in disabled, executes eligible items on step(), and supports manual runNow()', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-offpeak-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'off-peak-queue.json');
  let clock = Date.parse('2026-11-21T10:00:00Z');
  const plans = { claude: { meters: [{ short: '5h', used: 30, resets: '2026-11-21T10:25:00Z' }, { short: 'Week', used: 40 }] } };

  const q = new OffPeakQueue({ path, now: () => clock });
  await q.load();
  assert.equal(q.enabled, false);

  const item1 = await q.add({ kind: 'reflect', title: 'Nightly reflection' });
  const item2 = await q.add({ kind: 'prompt', title: 'Audit TODOs', prompt: 'List remaining TODOs.' });
  await assert.rejects(() => q.add({ kind: 'prompt', prompt: '' }), /Enter the prompt/);

  // Disabled by default -> step() does not run
  let ran = [];
  const runJob = async (item, { provider }) => { ran.push({ id: item.id, provider }); return { summary: `Ran ${item.kind}` }; };
  assert.equal((await q.step({ onBattery: false, idleSeconds: 600, plans, runJob })).ran, false);
  assert.equal(ran.length, 0);

  // Enable and reload from disk to prove persistence
  await q.configure({ enabled: true });
  const q2 = new OffPeakQueue({ path, now: () => clock });
  await q2.load();
  assert.equal(q2.enabled, true);
  assert.equal(q2.items.length, 2);

  // step() runs exactly ONE eligible item and records history
  const stepped = await q2.step({ onBattery: false, idleSeconds: 600, plans, runJob });
  assert.equal(stepped.ran, true);
  assert.equal(stepped.item.id, item1.id);
  assert.equal(stepped.item.status, 'done');
  assert.equal(stepped.item.provider, 'claude');
  assert.equal(q2.items.length, 1);
  assert.equal(q2.history.length, 1);

  // Manual runNow executes remaining item immediately
  const manual = await q2.runNow(item2.id, { runJob, plans });
  assert.equal(manual.status, 'done');
  assert.equal(q2.items.length, 0);
  assert.equal(q2.history.length, 2);
});

test('main.cjs, preload.cjs, remote-channels.mjs, and automation-settings.js wire Off-peak queue cleanly', async () => {
  const [main, preload, remote, ui] = await Promise.all([
    readFile(join(repoRoot, 'desktop/main.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/preload.cjs'), 'utf8'),
    readFile(join(repoRoot, 'desktop/remote-channels.mjs'), 'utf8'),
    readFile(join(repoRoot, 'src/automation-settings.js'), 'utf8'),
  ]);
  for (const ch of ['off-peak-state', 'off-peak-add', 'off-peak-remove', 'off-peak-set', 'off-peak-run']) {
    assert.ok(main.includes(`handle('${ch}'`), `main.cjs missing ${ch}`);
    assert.ok(remote.includes(`'${ch}'`), `remote-channels.mjs missing ${ch}`);
  }
  assert.match(preload, /offPeakState:/);
  assert.match(preload, /offPeakRun:/);
  assert.match(ui, /offPeakSection/);
});
