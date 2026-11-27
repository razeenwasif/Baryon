import test from 'node:test';
import assert from 'node:assert/strict';
import { defineTool, runToolTurn, toolSchema, toolset } from '../desktop/tool-registry.mjs';
import { CALENDAR_TOOLS, DRIVE_TOOLS, GMAIL_TOOLS } from '../desktop/google-tools.mjs';

const read = (name, run = async args => ({ echo: args })) => defineTool({ name, description: `Reads ${name}.`, properties: { q: { type: 'string' } }, run });
const write = (name, extra = {}) => defineTool({ name, description: `Writes ${name}.`, risk: 'write', once: `${name} was already tried.`, run: async () => ({ saved: true }), ...extra });

test('a tool is defined once, with a name, a description, a risk and a run', () => {
  const tool = read('notes_find');
  assert.deepEqual(toolSchema(tool), { name: 'notes_find', description: 'Reads notes_find.', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: [], additionalProperties: false } });
  assert.equal(tool.risk, 'read');
  assert.ok(Object.isFrozen(tool));
  assert.throws(() => defineTool({ name: 'Bad Name', description: 'x', run() {} }), /lower-case name/);
  assert.throws(() => defineTool({ name: 'no_words', description: ' ', run() {} }), /needs a description/);
  assert.throws(() => defineTool({ name: 'risky', description: 'x', risk: 'delete', run() {} }), /unknown risk/);
  assert.throws(() => defineTool({ name: 'once_read', description: 'x', once: 'only once', run() {} }), /can't be limited to one attempt/);
  assert.throws(() => defineTool({ name: 'no_run', description: 'x' }), /needs a run function/);
  assert.throws(() => defineTool({ name: 'needs_more', description: 'x', required: ['id'], run() {} }), /requires an input it doesn't describe/);
});

test('a toolset keeps a request to its limits, its tools and one try at each write', async () => {
  let saved = 0;
  const set = toolset([read('a_find'), write('a_save', { run: async () => ({ saved: ++saved }) })], { limit: 6, limitMessage: 'Too many calls.', unknown: 'Not offered.', invalid: 'Bad arguments.' });
  assert.deepEqual(await set.execute('a_find', { q: 'x' }), { echo: { q: 'x' } });
  assert.deepEqual(await set.execute('a_drop', {}), { error: 'Not offered.' });
  assert.deepEqual(await set.execute('a_find', null), { error: 'Bad arguments.' });
  assert.deepEqual(await set.execute('a_find', ['q']), { error: 'Bad arguments.' });
  assert.deepEqual(await set.execute('a_save', {}), { saved: 1 });
  assert.deepEqual(await set.execute('a_save', {}), { error: 'a_save was already tried.' });
  assert.equal(saved, 1);
  await assert.rejects(set.execute('a_find', {}), /Too many calls/);
  assert.deepEqual(set.calls().map(c => `${c.name}:${c.risk}`), ['a_find:read', 'a_drop:null', 'a_find:read', 'a_find:read', 'a_save:write', 'a_save:write'], 'the call over the limit never ran');
  assert.throws(() => toolset([read('twice'), read('twice')]), /offered twice/);
});

test('a guard refuses without using up the one try, errors come back as results, and a stop still stops', async () => {
  const controller = new AbortController();
  const guarded = write('b_draft', { properties: { id: { type: 'string' } }, guard: (args, { state }) => state.seen?.has(args.id) ? '' : 'Read it first.' });
  const seen = defineTool({ name: 'b_read', description: 'Reads b_read.', properties: { id: { type: 'string' } }, run: async (args, { state }) => { (state.seen ??= new Set()).add(args.id); return { read: args.id }; } });
  const broken = read('b_fail', async () => { throw new Error('The service is down.'); });
  const set = toolset([guarded, seen, broken], { signal: controller.signal, context: { account: 'test' } });
  assert.deepEqual(await set.execute('b_draft', { id: 'm1' }), { error: 'Read it first.' });
  await set.execute('b_read', { id: 'm1' });
  assert.deepEqual(await set.execute('b_draft', { id: 'm1' }), { saved: true }, 'the refused try didn’t count');
  assert.deepEqual(await set.execute('b_fail', {}), { error: 'The service is down.' });
  const slow = toolset([read('b_slow', async () => { controller.abort(); throw new Error('cancelled underneath'); })], { signal: controller.signal });
  await assert.rejects(slow.execute('b_slow', {}), { name: 'AbortError' });
  const context = toolset([read('b_ctx', async (_args, scope) => ({ account: scope.account }))], { context: { account: 'test' } });
  assert.deepEqual(await context.execute('b_ctx', {}), { account: 'test' });
});

test('every provider gets the same result: text for the CLIs, function output for the OpenAI API', async () => {
  const set = toolset([read('c_find')]);
  assert.deepEqual(await set.toolHandler({ tool: 'c_find', arguments: { q: 'y' } }), { success: true, outcome: 'ok', contentItems: [{ type: 'inputText', text: '{"echo":{"q":"y"}}' }] });
  assert.deepEqual(set.functions, [{ type: 'function', name: 'c_find', description: 'Reads c_find.', parameters: set.tools[0].inputSchema, strict: false }]);

  const seen = [];
  const cli = { turn: async options => { seen.push(options); return 'from the CLI'; } };
  const reply = await runToolTurn({ provider: cli, settings: { backend: 'claude' }, signal: new AbortController().signal, instructions: 'Be brief.', label: 'Notes', recent: [{ role: 'user', content: 'hi' }], set });
  assert.equal(reply, 'from the CLI');
  assert.equal(seen[0].input[0].text, 'Notes conversation:\n[{"role":"user","content":"hi"}]');
  assert.equal(seen[0].tools, set.tools);
  assert.equal(seen[0].toolHandler, set.toolHandler);

  const requests = [];
  const api = { async response(body) {
    requests.push(structuredClone(body));
    if (requests.length === 1) return { output: [{ type: 'function_call', call_id: 'k1', name: 'c_find', arguments: '{"q":"z"}' }, { type: 'function_call', call_id: 'k2', name: 'c_find', arguments: 'not json' }] };
    return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] };
  } };
  const answer = await runToolTurn({ provider: api, settings: { backend: 'openai', model: 'gpt-test', reasoning: 'low' }, signal: new AbortController().signal, instructions: 'Be brief.', label: 'Notes', recent: [{ role: 'user', content: 'hi' }], set: toolset([read('c_find')]) });
  assert.equal(answer, 'Done.');
  assert.equal(requests[0].max_output_tokens, 4096);
  assert.deepEqual(requests[1].input.filter(item => item.type === 'function_call_output').map(item => item.output), ['{"echo":{"q":"z"}}', '{"error":"Invalid arguments."}']);
  const endless = { response: async () => ({ output: [{ type: 'function_call', call_id: 'k', name: 'c_find', arguments: '{}' }] }) };
  assert.equal(await runToolTurn({ provider: endless, settings: { backend: 'openai' }, signal: new AbortController().signal, label: 'Notes', recent: [], set: toolset([read('c_find')], { limit: 99 }), rounds: 3 }), undefined);
});

test('the Google tools are each defined once, and only the writes are writes', () => {
  const all = [...CALENDAR_TOOLS, ...GMAIL_TOOLS, ...DRIVE_TOOLS];
  assert.equal(new Set(all.map(t => t.name)).size, all.length);
  assert.deepEqual(all.filter(t => t.risk === 'write').map(t => t.name), [
    'calendar_create',
    'gmail_save_reply_draft',
    'drive_create_file',
    'drive_create_doc',
    'drive_create_sheet',
    'drive_create_slides',
    'drive_update_file',
  ]);
  for (const tool of all.filter(t => t.risk === 'write')) assert.match(tool.once, /already/, `${tool.name} is tried only once`);
  assert.deepEqual(CALENDAR_TOOLS.filter(t => t.risk === 'read').map(t => t.name), ['calendar_list', 'calendar_events', 'calendar_free_busy'], 'what Gmail can borrow');
  assert.ok(GMAIL_TOOLS.find(t => t.name === 'gmail_save_reply_draft').guard, 'a draft needs its thread read first');
});

test('a toolset tells the approvals log how each write came out, and says nothing of reads', async () => {
  const heard = [];
  const broken = write('d_fail', { run: async () => { throw new Error('Drive said no.'); } });
  const set = toolset([read('d_find'), write('d_save'), broken], { audit: entry => heard.push(entry) });
  await set.execute('d_find', { q: 'x' });
  await set.execute('d_save', {});
  await set.execute('d_save', {});
  await set.execute('d_fail', {});
  assert.deepEqual(heard, [{ tool: 'd_save', result: { saved: true } }, { tool: 'd_fail', result: { error: 'Drive said no.' } }], 'the refused second try never ran, so it isn’t a write');
});
