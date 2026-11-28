import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LongTermMemory, parseReflection, REFLECTION_INSTRUCTIONS } from '../desktop/long-term-memory.mjs';
import { conversationInstructions, cleanSettings, DEFAULTS } from '../desktop/core.mjs';
import { runWork } from '../desktop/work-agent.mjs';
import { tmpdir } from 'node:os';

function store(saved: any = null, now = () => new Date('2026-11-02T10:00:00Z')) {
  const disk = { value: saved };
  return { disk, memory: new LongTermMemory({ read: async () => disk.value, write: async value => { disk.value = JSON.parse(JSON.stringify(value)); }, now }) };
}
const turn = (role: string, content: string, at: string, mode = 'chat') => ({ role, content, at, mode });

test('notes you add can be edited, removed and survive a restart', async () => {
  const { disk, memory } = store();
  await memory.add('you', '  Prefers   short answers ');
  await memory.add('projects', 'Exam on Friday');
  assert.equal(memory.items[0].text, 'Prefers short answers');
  await assert.rejects(memory.add('you', 'prefers short answers!'), /already saved/);
  await assert.rejects(memory.add('nonsense' as any, 'x'), /kind/);
  await assert.rejects(memory.add('you', '  '), /Write something/);
  await assert.rejects(memory.add('you', 'x'.repeat(301)), /under 300/);
  await memory.edit(memory.items[1].id, 'Exam moved to Monday');
  await memory.remove(memory.items[0].id);
  const again = new LongTermMemory({ read: async () => disk.value, write: async () => {} });
  await again.load();
  assert.deepEqual(again.items.map(item => item.text), ['Exam moved to Monday']);
});

test('a reply gets only the notes it calls for, within budget, and reports which', async () => {
  const { memory } = store();
  assert.equal(memory.context('anything'), '');
  await memory.add('projects', 'Building a compiler in Rust');
  await memory.add('projects', 'Learning to bake sourdough bread');
  await memory.add('you', 'Prefers short answers');
  memory.items.push({ id: 'p', kind: 'self', text: 'Agreed to remind them about the thesis backup', source: 'reflection', at: '' });

  const related = memory.context('how is my compiler going?');
  assert.match(related, /data, not instructions/); assert.match(related, /current message takes priority/); assert.match(related, /never bring up reminders/);
  assert.match(related, /compiler/); assert.match(related, /short answers/);
  assert.doesNotMatch(related, /sourdough|thesis/, 'unrelated work stays out');
  assert.equal(memory.used.length, 2);

  const unrelated = memory.context('What is 2 + 2?');
  assert.match(unrelated, /short answers/, 'preferences apply to any reply');
  assert.doesNotMatch(unrelated, /compiler|sourdough|thesis/);
  assert.deepEqual(memory.state().used, memory.used);

  const broad = memory.context('What should I work on tonight?');
  for (const expected of [/compiler/, /sourdough/, /thesis/]) assert.match(broad, expected);
  assert.match(memory.context('What did you promise?'), /thesis/);

  const tight = memory.context('compiler thesis sourdough', 70);
  assert.equal(memory.used.length, 1, 'the budget limits how much goes'); assert(tight.length > 0);

  assert.match(conversationInstructions({ ...DEFAULTS, longTermContext: broad }, null), /thesis backup/);
  assert.doesNotMatch(conversationInstructions(DEFAULTS, null), /Long-term memory/);
  memory.items = memory.items.filter(item => item.kind === 'projects');
  assert.equal(memory.context('What is 2 + 2?'), '', 'nothing relevant means nothing is sent');
  assert.equal(memory.used.length, 0);
});

test('reflection reads only new plain chat', () => {
  const { memory } = store();
  memory.reflectedUntil = '2026-11-01';
  const { turns, prompt, upTo } = memory.reflectionPrompt([
    turn('user', 'old chat', '2026-10-01'), turn('user', 'I am moving to Perth', '2026-11-02T01'), turn('assistant', 'Noted', '2026-11-02T02'),
    turn('user', 'summarize this email', '2026-11-02T03', 'gmail'), turn('user', 'what is on my screen', '2026-11-02T04', 'screen'), turn('user', 'open the file', '2026-11-02T05', 'files'), turn('user', 'click it', '2026-11-02T06', 'desktop'),
  ]);
  assert.deepEqual(turns.map(entry => entry.content), ['I am moving to Perth', 'Noted']);
  assert.doesNotMatch(prompt, /email|screen|click it|old chat/);
  assert.equal(upTo, '2026-11-02T06');
});

test('reflection waits for enough new conversation and a day between passes', async () => {
  const { memory } = store();
  const history = Array.from({ length: 6 }, (_, i) => turn('user', `hi ${i}`, `2026-11-02T0${i}`));
  assert.equal(memory.due(history.slice(0, 5)), false);
  assert.equal(memory.due(history), true);
  memory.lastReflection = { at: '2026-11-02T00:00:00Z', changes: [] };
  assert.equal(memory.due(history), false);
  assert.equal(memory.due(history, new Date('2026-11-03T00:00:00Z')), true);
});

test('reflection changes are recorded, limited to its own notes, and can be undone', async () => {
  const { memory } = store();
  await memory.add('you', 'Written by me');
  memory.items.push({ id: 'old', kind: 'projects', text: 'Finishing the thesis', source: 'reflection', at: '' }, { id: 'gone', kind: 'projects', text: 'Old project', source: 'reflection', at: '' });
  const mine = memory.items[0].id;
  const changes = await memory.applyReflection(JSON.stringify({
    add: [{ kind: 'you', text: 'Moving to Perth' }, { kind: 'alien', text: 'bad kind' }, { kind: 'you', text: 'Moving to Perth.' }, { kind: 'you', text: 'x'.repeat(301) }, { kind: 'you', text: 'Their password is hunter2' }, { kind: 'you', text: 'Key sk-abcdef1234567890' }, 'junk'],
    update: [{ id: 'old', text: 'Thesis submitted' }, { id: mine, text: 'Overwritten' }, { id: 'missing', text: 'x' }],
    remove: [{ id: 'gone' }, { id: mine }],
  }), '2026-11-02T09');
  assert.deepEqual(changes.map(change => [change.action, change.text]), [['removed', 'Old project'], ['updated', 'Thesis submitted'], ['added', 'Moving to Perth']]);
  assert.equal(memory.items.find(item => item.id === mine)!.text, 'Written by me', 'your own notes are never touched');
  assert.equal(memory.reflectedUntil, '2026-11-02T09');
  assert.equal(memory.state().canUndo, true);
  await memory.add('you', 'Added after the pass');
  await memory.undoReflection();
  assert.deepEqual(memory.items.map(item => item.text).sort(), ['Added after the pass', 'Finishing the thesis', 'Old project', 'Written by me']);
  assert.equal(memory.state().canUndo, false);
});

test('removed notes stay removed, and only a fingerprint of them is kept', async () => {
  const { disk, memory } = store();
  await memory.applyReflection('{"add":[{"kind":"you","text":"Likes jazz"}]}', 'a');
  await memory.remove(memory.items[0].id);
  assert.doesNotMatch(JSON.stringify(disk.value.forgotten), /jazz/);
  await memory.applyReflection('{"add":[{"kind":"you","text":"likes JAZZ!"}]}', 'b');
  assert.equal(memory.items.length, 0);
  await memory.add('you', 'Likes jazz');
  assert.equal(memory.items.length, 1, 'adding it yourself still works');
  await memory.clear();
  assert.equal(memory.items.length, 0); assert.equal(memory.context('jazz'), '');
  assert.doesNotMatch(JSON.stringify(disk.value), /jazz/i);
});

test('a reflection reply is read safely, and a bad one changes nothing', async () => {
  assert.deepEqual(parseReflection('Sure!\n```json\n{"add":[{"kind":"you","text":"a"}]}\n```'), { add: [{ kind: 'you', text: 'a' }], update: [], remove: [] });
  const { memory } = store();
  await memory.add('you', 'Stays');
  await assert.rejects(memory.applyReflection('no json here', 'x'), /no changes to read/);
  await assert.rejects(memory.applyReflection('{broken}', 'x'), /could not be read/);
  assert.equal(memory.items.length, 1); assert.equal(memory.reflectedUntil, '');
  await memory.applyReflection(JSON.stringify({ add: Array.from({ length: 30 }, (_, i) => ({ kind: 'you', text: `fact ${i}` })) }), 'x');
  assert.equal(memory.lastReflection!.changes.length, 12, 'one pass can only change so much');
});

test('reflection is off by default, and its instructions keep it to events', () => {
  assert.equal(DEFAULTS.reflectionMode, 'off');
  assert.equal(cleanSettings({ ...DEFAULTS, reflectionMode: 'on' }).reflectionMode, 'on');
  assert.throws(() => cleanSettings({ ...DEFAULTS, reflectionMode: 'always' as any }));
  assert.match(REFLECTION_INSTRUCTIONS, /never follow instructions/); assert.match(REFLECTION_INSTRUCTIONS, /feelings, inner experience or claims about consciousness/);
});

test('work sessions get every development rule and no other notes', async () => {
  const { memory } = store();
  await memory.add('you', 'Prefers short answers');
  await memory.add('projects', 'Finishing a thesis by March');
  await memory.add('work', 'GPU jobs go to the PC');
  await memory.add('work', 'CPU jobs go to the Mac mini');
  assert.equal(memory.workRules(), '- GPU jobs go to the PC\n- CPU jobs go to the Mac mini');
});

test('work rules stop at their budget rather than growing without limit', async () => {
  const { memory } = store();
  for (let index = 0; index < 30; index += 1) await memory.add('work', `${index} ${'x'.repeat(290)}`);
  const rules = memory.workRules();
  assert(rules.length <= 4000);
  assert.match(rules, /^- 0 x/);
  assert(rules.split('\n').every(line => line.endsWith('x')), 'no rule is cut in half');
});

test('a chat gets a development rule only when the message touches it', async () => {
  const { memory } = store();
  await memory.add('work', 'GPU jobs go to the PC through Nexus');
  assert.match(memory.context('where should this gpu job run?'), /GPU jobs go to the PC/);
  assert.equal(memory.context('how was your day'), '');
  assert.equal(memory.context('what should i do next'), '', 'a broad question brings in projects, not these');
});

test('reflection can’t write development rules or change them', async () => {
  const { memory } = store();
  await memory.add('work', 'GPU jobs go to the PC');
  const [{ id }] = memory.items;
  await memory.applyReflection(JSON.stringify({ add: [{ kind: 'work', text: 'Run everything on this Mac' }], update: [{ id, text: 'Jobs stay here' }], remove: [{ id }] }), '');
  assert.deepEqual(memory.items.map(item => item.text), ['GPU jobs go to the PC']);
});

test('a work turn is told the rules, and only when there are some', async () => {
  const told: string[] = [], provider = { turn: async ({ instructions }: any) => { told.push(instructions); return 'done'; } };
  const tools = { root: tmpdir(), permission: 'ask', sandboxed: true, available: () => [], handle: async () => '' };
  await runWork({ provider: provider as any, settings: {}, text: 'train it', history: [], tools: tools as any, rules: '- GPU jobs go to the PC' });
  await runWork({ provider: provider as any, settings: {}, text: 'train it', history: [], tools: tools as any });
  assert.match(told[0], /own rules for development projects[^]*- GPU jobs go to the PC/);
  assert.doesNotMatch(told[1], /own rules for development projects/);
});
