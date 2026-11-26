import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  forecastPlan,
  forecastPlanFromFiles,
  parsePlanSteps,
  summarizeRoutingHistory,
} from '../desktop/plan-forecast.mjs';

test('parsePlanSteps categorizes scout, builder, and critic steps and handles plain paragraphs', () => {
  const steps = parsePlanSteps([
    '1. Search codebase for auth middleware and audit session handling',
    '2. Implement JWT verification and write unit tests',
    '3. Review security edge cases across endpoints',
  ].join('\n'));
  assert.equal(steps.length, 3);
  assert.equal(steps[0].role, 'scout');
  assert.equal(steps[1].role, 'builder');
  assert.equal(steps[2].role, 'critic');

  const single = parsePlanSteps('Refactor logging helper cleanly.');
  assert.equal(single.length, 1);
  assert.equal(single[0].role, 'builder');
});

test('summarizeRoutingHistory computes role averages with fallback defaults', () => {
  const hist = summarizeRoutingHistory([
    { role: 'scout', ms: 4000, tokens: { input: 3000, output: 500 } },
    { role: 'scout', ms: 6000, tokens: { input: 5000, output: 500 } },
    { role: 'builder', ms: 30000, tokens: { input: 20000, output: 4000 } },
    { type: 'check', role: 'builder', ms: 100 },
  ]);
  assert.equal(hist.scout.samples, 2);
  assert.equal(hist.scout.avgMs, 5000);
  assert.equal(hist.scout.avgTokens, 4500);
  assert.equal(hist.builder.samples, 1);
  assert.equal(hist.builder.avgTokens, 24000);
  assert.equal(hist.lead.fromHistory, false);
});

test('forecastPlan estimates calls, 5h bar projection, Saver savings, and Wait vs Saver advice', () => {
  const plan = [
    '1. Search config files and audit existing schema',
    '2. Implement new pipeline module',
    '3. Edit UI components and add tests',
  ].join('\n');

  const calm = forecastPlan({
    plan,
    plans: {
      claude: { meters: [{ short: '5h', label: '5-hour limit', used: 20, resets: '8:00pm' }] },
    },
    home: 'claude',
  });
  assert.equal(calm.stepsCount, 3);
  assert.equal(calm.byRole.lead.calls, 1);
  assert.equal(calm.byRole.scout.calls, 1);
  assert.equal(calm.byRole.builder.calls, 2);
  assert.equal(calm.byRole.critic.calls, 1);
  assert.equal(calm.totalCalls, 5);
  assert.equal(calm.recommendation, 'proceed');
  assert.ok(calm.byProvider.claude.projectedFiveHourPct > 20);
  assert.match(calm.summary, /Est\. 5 calls/);

  // Tight 5h limit resetting soon triggers wait advisory; distant reset triggers saver advisory.
  const now = new Date('2026-11-22T10:00:00');
  const tightWait = forecastPlan({
    plan,
    plans: {
      claude: { meters: [{ short: '5h', label: '5-hour limit', used: 88, resets: '11:00am' }] },
    },
    home: 'claude',
    now,
  });
  assert.equal(tightWait.recommendation, 'wait');
  assert.match(tightWait.advisory, /resets in/);

  const tightSaver = forecastPlan({
    plan,
    plans: {
      claude: { meters: [{ short: '5h', label: '5-hour limit', used: 88, resets: '4:00pm' }] },
    },
    home: 'claude',
    now,
  });
  assert.equal(tightSaver.recommendation, 'saver');
  assert.ok(tightSaver.savedPctVsCurrent > 0);
});

test('forecastPlanFromFiles reads routing.jsonl and handles missing files gracefully', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-forecast-')));
  try {
    const routingPath = join(dir, 'routing.jsonl');
    await writeFile(routingPath, JSON.stringify({ role: 'builder', provider: 'claude', ms: 20000, tokens: { input: 10000, output: 2000 } }) + '\n', 'utf8');
    const res = await forecastPlanFromFiles({
      plan: '1. Implement feature\n2. Add unit tests',
      routingPath,
      plans: {},
    });
    assert.equal(res.byRole.builder.fromHistory, true);
    assert.equal(res.byRole.builder.estTokens, 24000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plan forecast IPC, remote channels, askWorkApproval hook, and work-view strip are wired', async () => {
  const [mainSrc, preloadSrc, remoteSrc, workViewSrc] = await Promise.all([
    readFile(join(process.cwd(), 'desktop', 'main.cjs'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'preload.cjs'), 'utf8'),
    readFile(join(process.cwd(), 'desktop', 'remote-channels.mjs'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'work-view.js'), 'utf8'),
  ]);
  assert.match(mainSrc, /computePlanForecast/);
  assert.match(mainSrc, /handle\('plan-forecast'/);
  assert.match(preloadSrc, /planForecast:/);
  assert.match(remoteSrc, /'plan-forecast'/);
  assert.match(workViewSrc, /request\.forecast/);
  assert.match(workViewSrc, /work-forecast/);
});
