import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanUsage, parseClaudeUsage, parseGeminiUsage, parseCodexUsage, parseDeepSeekBalance } from '../desktop/plan-usage.mjs';

const CLAUDE = `You are currently using your subscription to power your Claude Code usage

Current session: 11% used · resets Nov 3 at 5:39pm (Australia/Sydney)
Current week (all models): 16% used · resets Nov 9 at 10:59am (Australia/Sydney)
Current week (Fable): 0% used · resets Nov 9 at 11am (Australia/Sydney)

What's contributing to your limits usage?
  95% of your usage was at >150k context
`;
const GEMINI = `Gemini Models\tWeekly Limit Remaining\t96%\t2026-11-06T22:56:53Z
Gemini Models\tFive Hour Limit Remaining\t99%\t2026-11-03T06:40:29Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-11-10T02:45:27Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-03T07:45:27Z
Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t94%\t2026-11-08T23:27:38Z
`;
test('reads Claude’s limits, and not the rest of its report', () => {
  assert.deepEqual(parseClaudeUsage(CLAUDE), [
    { short: '5h', label: '5-hour limit', used: 11, resets: 'Nov 3 at 5:39pm' },
    { short: 'Week', label: 'Weekly limit', used: 16, resets: 'Nov 9 at 10:59am' },
    { short: '', label: 'Weekly limit: Fable', used: 0, resets: 'Nov 9 at 11am' },
  ]);
});
test('reads Gemini’s remaining allowance as what’s used, leaving out Claude through agy', () => {
  assert.deepEqual(parseGeminiUsage(GEMINI), [
    { short: '5h', label: '5-hour limit', used: 1, resets: '2026-11-03T06:40:29Z' },
    { short: 'Week', label: 'Weekly limit', used: 4, resets: '2026-11-06T22:56:53Z' },
    { short: '', label: 'Weekly limit: Gemini 4 Argon', used: 6, resets: '2026-11-08T23:27:38Z' },
  ]);
});
test('anything else, such as not being signed in, reads as nothing rather than as zero', () => {
  for (const parse of [parseClaudeUsage, parseGeminiUsage]) for (const text of ['', 'Please sign in', 'jetski: no output produced', undefined]) assert.deepEqual(parse(text), []);
  assert.equal(parseClaudeUsage('Current session: 400% used')[0].used, 100);
});
test('a plan keeps its last figures when it can’t be read, and says so', async () => {
  let clock = 0, fail = false, changes = 0;
  const usage = new PlanUsage({ now: () => clock, onChange: () => { changes += 1; }, readers: { claude: async () => { if (fail) throw new Error('no'); return [{ short: '5h', used: clock ? 20 : 10 }]; }, gemini: async () => { throw new Error('not installed'); } } });
  await usage.refresh({ force: true });
  assert.equal(usage.state().claude.meters[0].used, 10);
  assert.equal(usage.state().gemini, undefined);
  assert.equal(usage.state().claude.failed, undefined);
  clock = 120000; fail = true;
  await usage.refresh();
  assert.equal(usage.state().claude.meters[0].used, 10);
  assert.equal(usage.state().claude.failed, true);
  assert.equal(usage.state().claude.at, 0);
  clock = 240000; fail = false;
  await usage.refresh();
  assert.equal(usage.state().claude.meters[0].used, 20);
  assert.equal(usage.state().claude.failed, undefined);
  assert.equal(changes, 3);
});
test('reading is limited: one at a time, and not too often', async () => {
  let clock = 0, reads = 0, release!: () => void;
  const usage = new PlanUsage({ now: () => clock, readers: { claude: () => { reads += 1; return new Promise(resolve => { release = () => resolve([{ used: 1 }]); }); } } });
  const one = usage.refresh({ force: true }), two = usage.refresh({ force: true });
  assert.equal(one, two);
  release(); await one;
  assert.equal(reads, 1);
  clock = 30000;
  await usage.refresh();
  assert.equal(reads, 1);
  clock = 61000;
  const three = usage.refresh(); release(); await three;
  assert.equal(reads, 2);
});
test('it doesn’t read while the window is hidden', async () => {
  let reads = 0;
  const usage = new PlanUsage({ every: 5, closest: 0, visible: () => false, readers: { claude: async () => { reads += 1; return []; } } });
  usage.start();
  await usage.reading;
  const after = reads;
  await new Promise(resolve => setTimeout(resolve, 30));
  usage.stop();
  assert.equal(reads, after);
});
test('Codex limits come from whichever windows the plan has', () => {
  const free = { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 43200, resetsAt: 1795404618 }, secondary: null, planType: 'free' } };
  assert.deepEqual(parseCodexUsage(free), [{ short: 'Month', label: 'Monthly limit', used: 100, resets: new Date(1795404618000).toISOString() }]);
  const paid = { rateLimits: { primary: { usedPercent: 12.4, windowDurationMins: 300 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1795404618 } } };
  assert.deepEqual(parseCodexUsage(paid).map(({ short, used, resets }) => [short, used, Boolean(resets)]), [['5h', 12, false], ['Week', 40, true]]);
  assert.equal(parseCodexUsage({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 1440 } } })[0].short, '1d');
  assert.deepEqual(parseCodexUsage({}), []);
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: null, secondary: null } }), []);
});
test('DeepSeek shows what is left of its prepaid balance', () => {
  const balance = (total: string, currency = 'USD', is_available = true) => ({ is_available, balance_infos: [{ currency, total_balance: total, granted_balance: '0.00', topped_up_balance: total }] });
  assert.deepEqual(parseDeepSeekBalance(balance('12.5')), [{ short: 'Left', label: 'Balance', text: '$12.50', level: '' }]);
  assert.equal(parseDeepSeekBalance(balance('110.00', 'CNY'))[0].text, '¥110.00');
  assert.equal(parseDeepSeekBalance(balance('5', 'EUR'))[0].text, 'EUR 5.00');
  assert.equal(parseDeepSeekBalance(balance('0.40'))[0].level, 'high');
  assert.equal(parseDeepSeekBalance(balance('0.00'))[0].level, 'full');
  assert.equal(parseDeepSeekBalance(balance('3.00', 'USD', false))[0].level, 'full');
  assert.deepEqual(parseDeepSeekBalance({ is_available: false, balance_infos: [] }), []);
  assert.deepEqual(parseDeepSeekBalance({ balance_infos: [{ currency: 'USD', total_balance: 'n/a' }] }), []);
});
test('a plan that no longer applies is removed rather than kept as out of date', async () => {
  let key = true;
  const usage = new PlanUsage({ readers: { deepseek: async () => key ? [{ short: 'Left', text: '$1.00' }] : null } });
  await usage.refresh({ force: true });
  assert.equal(usage.state().deepseek.meters[0].text, '$1.00');
  key = false;
  await usage.refresh({ force: true });
  assert.equal(usage.state().deepseek, undefined);
});

test('the phone gets Claude Code, agy and Codex usage, small, for its notch island', async () => {
  const { phoneUsage } = await import('../desktop/plan-usage.mjs');
  const usage = phoneUsage({
    claude: { at: 5, meters: [{ label: '5-hour limit', used: 23.4, resets: 'Nov 12 at 5:39pm' }, { label: 'Weekly limit', used: 41, resets: '' }] },
    gemini: { at: 6, failed: true, meters: [{ short: '5h', label: '5-hour limit', used: 130, resets: '' }] },
    deepseek: { meters: [{ short: 'Left', label: 'Balance', text: '$4.10' }] },
    codex: { meters: [] },
  } as any);
  assert.deepEqual(Object.keys(usage), ['claude', 'gemini']);
  assert.deepEqual(usage.claude.meters[0], { short: '', label: '5-hour limit', used: 23, resets: 'Nov 12 at 5:39pm' });
  assert.equal(usage.gemini.meters[0].used, 100);
  assert.equal(usage.gemini.failed, true);
  assert.deepEqual(phoneUsage(undefined), {});
});
