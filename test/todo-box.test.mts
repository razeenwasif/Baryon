// The to-do box above the composer: how far a list has got, which list a chat shows, and that Fairy can drop a task.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_WORDS, latestTasks, todoProgress } from '../src/todo-box.js';
import { WorkTools } from '../desktop/work-tools.mjs';

const list = (statuses: any[]) => statuses.map((status, i) => ({ text: `Task ${i + 1}`, status }));

test('the count is what’s done of what’s left to do, and a cancelled task isn’t one', () => {
  assert.deepEqual(todoProgress(list(['done', 'in_progress', 'pending'])), { done: 1, total: 3, complete: false });
  assert.deepEqual(todoProgress(list(['done', 'cancelled', 'done'])), { done: 2, total: 2, complete: true });
  assert.deepEqual(todoProgress(list(['cancelled'])), { done: 0, total: 0, complete: false }, 'nothing done isn’t complete');
  assert.deepEqual(todoProgress([]), { done: 0, total: 0, complete: false });
  assert.deepEqual(Object.keys(STATUS_WORDS), ['pending', 'in_progress', 'done', 'cancelled']);
});

test('a chat shows its latest task list', () => {
  const history = [
    { role: 'user', content: 'Fix it' },
    { role: 'assistant', content: 'Done', tasks: list(['done', 'done']) },
    { role: 'user', content: 'And the docs' },
    { role: 'assistant', content: 'Updated', tasks: [] },
  ];
  assert.deepEqual(latestTasks(history as any), list(['done', 'done']), 'a turn without a list keeps the last one');
  assert.deepEqual(latestTasks([{ role: 'user', content: 'hi', tasks: list(['done']) }] as any), [], 'only Fairy’s own lists');
  assert.deepEqual(latestTasks(), []);
});

test('Fairy can mark a task she decides not to do as cancelled', async () => {
  const events: any[] = [], tools = new WorkTools({ root: '/tmp', runCommand: (async () => ({})) as any, onEvent: event => events.push(event) });
  const bad = await tools.handle({ tool: 'update_tasks', arguments: { tasks: [{ text: 'Odd', status: 'maybe' }] } });
  assert.equal(bad.success, false); assert.equal(bad.outcome, 'invalid');
  await tools.handle({ tool: 'update_tasks', arguments: { tasks: [{ text: 'Fix', status: 'done' }, { text: 'Docs', status: 'cancelled' }, { text: 'Odd', status: 'pending' }] } });
  assert.deepEqual(events.at(-1), { type: 'tasks', tasks: [{ text: 'Fix', status: 'done' }, { text: 'Docs', status: 'cancelled' }, { text: 'Odd', status: 'pending' }] });
  // The tool's own fallback stays intact even if called directly.
  tools.updateTasks({ tasks: [{ text: 'Odd', status: 'maybe' }] });
  assert.deepEqual(events.at(-1), { type: 'tasks', tasks: [{ text: 'Odd', status: 'pending' }] });
  const described = tools.available().find(tool => tool.name === 'update_tasks')!;
  assert.match(described.description, /above the message box[^]*cancelled/);
});
