import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PLAIN_NEED, WorkTools, riskOf } from '../desktop/work-tools.mjs';

const root = tmpdir();
function tools({ answer = 'allow', open = [], add } = {}) {
  const cards = [], added = [];
  const made = new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: async () => ({}), approve: async request => { cards.push(request); return answer; },
    goals: { list: async () => ({ goals: open }), add: add || (async value => { added.push(value); return { id: 'G4', ...value }; }) } });
  return { made, cards, added };
}

test('goal_propose sits behind more_tools in the goals group, offered directly when the request plainly needs it', () => {
  const { made } = tools();
  assert.ok(!made.offered({ request: 'fix the failing test' }).some(entry => entry.name === 'goal_propose'));
  assert.ok(made.offered({ request: 'Keep at it until the tests are passing' }).some(entry => entry.name === 'goal_propose'));
  assert.ok(made.toolGroups().has('goals'));
  for (const said of ['make this a goal', 'work on it across sessions', 'over the next few days, get accuracy to 0.9', 'until it’s done', 'until it is done']) assert.ok(PLAIN_NEED.goals.test(said), said);
  for (const said of ['what are my goals for today', 'rename the function']) assert.ok(!PLAIN_NEED.goals.test(said), said);
  const plain = new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: async () => ({}) });
  assert.ok(!plain.toolGroups().has('goals'));
  assert.equal(riskOf('goal_propose'), 'read');
});

test('a goal is offered on a card that spells it out, and added in this session’s folder only on Add goal', async () => {
  const { made, cards, added } = tools();
  const result = await made.handle({ tool: 'goal_propose', arguments: { outcome: '  The parser handles every file in fixtures/  ', done_when: { kind: 'command', command: 'npm test' }, steps: ['Collect the crashing files', ' ', 'Fix the tokenizer'] } });
  assert.equal(result.success, true);
  assert.match(result.contentItems[0].text, /Added as G4\. It’s on the Goals board/);
  assert.equal(cards[0].kind, 'goal-offer');
  assert.equal(cards[0].title, 'Add a goal? The parser handles every file in fixtures/');
  assert.equal(cards[0].detail, `Done when npm test passes in ${root}.\nIn ${root}.\nFirst steps: Collect the crashing files; Fix the tokenizer.\nIt asks first: Fairy puts up a card before each step you didn’t start.`);
  assert.deepEqual(added, [{ outcome: 'The parser handles every file in fixtures/', doneWhen: { kind: 'command', command: 'npm test' }, folder: root, steps: ['Collect the crashing files', 'Fix the tokenizer'] }]);
});

test('Not now, or no answer, adds nothing; an open goal with the same words isn’t offered again; a refusal is said', async () => {
  for (const answer of ['deny', 'timeout']) {
    const { made, added } = tools({ answer });
    const result = await made.handle({ tool: 'goal_propose', arguments: { outcome: 'A' } });
    assert.match(result.contentItems[0].text, /didn’t add it/);
    assert.deepEqual(added, []);
  }
  const { made: again, cards } = tools({ open: [{ id: 'G1', outcome: 'The parser handles every file', state: 'active' }] });
  assert.match((await again.handle({ tool: 'goal_propose', arguments: { outcome: 'the parser handles every file' } })).contentItems[0].text, /already one of the user’s open goals/);
  assert.deepEqual(cards, []);
  const { made: done } = tools({ open: [{ id: 'G1', outcome: 'A', state: 'done' }] });
  assert.match((await done.handle({ tool: 'goal_propose', arguments: { outcome: 'A' } })).contentItems[0].text, /Added as G4/, 'a finished goal may be offered again');
  const { made: none } = tools();
  assert.equal((await none.handle({ tool: 'goal_propose', arguments: { outcome: ' ' } })).success, false);
  const { made: full } = tools({ add: async () => { throw new Error('5 goals are open already. Finish, drop or pause one first.'); } });
  const refused = await full.handle({ tool: 'goal_propose', arguments: { outcome: 'B' } });
  assert.equal(refused.success, false);
  assert.match(refused.contentItems[0].text, /5 goals are open already/);
});

test('main is wired: the offer’s card reads Add goal and Not now, sessions get the goals, and a goal’s chat is named after it', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if \(request\.kind === 'goal-offer'\) request = \{ allowLabel: 'Add goal', denyLabel: 'Not now', \.\.\.request \};/);
  assert.match(main, /const offer = request\.kind === 'session-offer' \|\| request\.kind === 'watcher-offer' \|\| request\.kind === 'goal-offer';/);
  assert.match(main, /goals: \{ list: \(\) => goalStore\.list\(\), add: value => goalStore\.add\(value\) \},/);
  assert.match(main, /await sessions\.rename\(opened\.chat, `\$\{goal\.id\} · \$\{goal\.outcome\}`\.slice\(0, 80\)\)/);
});
