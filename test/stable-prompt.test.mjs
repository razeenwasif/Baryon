// Token use, step 5: a chat's instructions and tools stay the same from turn to turn, so providers reuse the cached
// start of the prompt; what changes between turns goes with the message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkTools } from '../desktop/work-tools.mjs';
import { runWork, turnNotes } from '../desktop/work-agent.mjs';

test('two turns of a chat send the same instructions and tools, with what changed in the message', async () => {
  const list = [{ file: 'notes.pdf', path: '/data/attachments/1', now: true }];
  const tools = new WorkTools({ root: process.cwd(), runCommand: async () => ({}), github: {}, simulators: {}, browser: {}, computer: {}, attachments: { list } });
  const seen = [], provider = { turn: async options => { seen.push(options); return 'ok'; } };
  await runWork({ provider, settings: {}, text: 'Summarise the notes I attached', history: [], tools, rules: 'Prefer short names.' });
  list[0].now = false; list.push({ file: 'plot.png', path: '/data/attachments/2', now: true });
  await runWork({ provider, settings: {}, text: 'Now tidy the README', history: [{ role: 'user', content: 'Summarise the notes I attached' }, { role: 'assistant', content: 'Done.' }], tools, rules: 'Prefer short names.' });
  assert.equal(seen[1].instructions, seen[0].instructions);
  assert.deepEqual(seen[1].tools, seen[0].tools);
  assert.match(seen[0].input[0].text, /Files attached to this chat: "notes\.pdf" at "\/data\/attachments\/1\/notes\.pdf", with this message\./);
  assert.match(seen[1].input[0].text, /"notes\.pdf" at "\/data\/attachments\/1\/notes\.pdf"; "plot\.png" at "\/data\/attachments\/2\/plot\.png", with this message\./);
  assert.match(seen[0].instructions, /some tools are kept in groups behind more_tools/i);
  // A request that plainly needs a group adds that group, and more_tools itself doesn't change.
  await runWork({ provider, settings: {}, text: 'Why is CI failing on #4?', history: [], tools, rules: 'Prefer short names.' });
  assert.equal(seen[2].instructions, seen[0].instructions);
  assert.deepEqual(seen[2].tools.at(-1), seen[0].tools.at(-1));
});

test('linked sessions’ state goes with the message, and their rules stay in the instructions', async () => {
  const tools = new WorkTools({ root: process.cwd(), runCommand: async () => ({}), sessions: { tools: [] } });
  const seen = [], provider = { turn: async options => { seen.push(options); return 'ok'; } };
  await runWork({ provider, settings: {}, text: 'Carry on', history: [], tools, linked: '“Docs” is working.' });
  await runWork({ provider, settings: {}, text: 'Carry on', history: [], tools, linked: '“Docs” finished.' });
  assert.equal(seen[1].instructions, seen[0].instructions);
  assert.doesNotMatch(seen[0].instructions, /“Docs”/);
  assert.match(seen[0].input[0].text, /Linked sessions now:\n“Docs” is working\.\n\nThe user's request:\nCarry on$/);
  assert.match(seen[1].input[0].text, /Linked sessions now:\n“Docs” finished\./);
  assert.equal(turnNotes({}), '');
});
