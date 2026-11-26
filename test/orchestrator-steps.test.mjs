import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRITIC_AT, LEAD_RULES, netChanges, stepBrief, stepReport } from '../desktop/orchestrator.mjs';
import { WorkTools, builderTools } from '../desktop/work-tools.mjs';
import { workInstructions } from '../desktop/work-agent.mjs';
import { modelChange } from '../src/model-menu.js';
import { cleanSettings } from '../desktop/core.mjs';
import { DEFAULTS } from '../src/defaults.js';

async function folder(t, files = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-steps-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
}
// A toolbox whose builder plays a script of tool calls, and whose commands pass when they say "pass".
function lead(root, { scripts = [], critic = null, checks = [] } = {}) {
  const briefs = [], ran = [];
  const tools = new WorkTools({ root, permission: 'auto', approve: async () => 'allow',
    runCommand: async ({ command }) => { ran.push(command); const exit = checks.length ? checks.shift() : command.includes('pass') ? 0 : 1; return { exitCode: exit, output: exit ? 'FAIL one test' : 'ok' }; },
    builder: async ({ brief, tools: list, handle, role, onSeat }) => {
      briefs.push({ brief, names: list.map(tool => tool.name), role }); onSeat({ model: 'claude-sonnet-5-5', role });
      const script = scripts.shift() || [];
      for (const call of script) { if (call.reply) return call.reply; await handle(call); }
      return 'Done.';
    }, critic });
  return { tools, briefs, ran, call: (tool, input) => tools.handle({ tool, arguments: input }) };
}
const text = result => result.contentItems[0].text;

test('a brief carries the step, its files and its check, and a report what came back', () => {
  const brief = stepBrief({ title: 'Format module', brief: 'Add src/format.js.', files: ['src/format.js'], check: 'node --test' });
  assert.match(brief, /^Step: Format module/);
  assert.match(brief, /Files you may change: src\/format\.js\. If the step needs any other file, call hand_back/);
  assert.match(brief, /done when this command passes: node --test/);
  assert.match(stepBrief({ title: 'x', brief: 'y', attempt: 2, lastCheck: 'FAIL a' }), /attempt 2\. The check failed last time:\nFAIL a/);
  const report = stepReport({ title: 'Format module', outcome: 'done', changed: [{ path: 'src/format.js', added: 4, removed: 0 }], check: 'node --test', passed: true, builderReport: 'Added it.' });
  assert.match(report, /^Step “Format module”: done\.\nChanged: src\/format\.js \(\+4 −0\)\.\nCheck `node --test`: passed\./);
  assert.deepEqual(netChanges([{ path: 'a', before: 'x', after: 'y' }, { path: 'a', before: 'y', after: 'z' }, { path: 'b', before: 'q', after: 'r' }, { path: 'b', before: 'r', after: 'q' }]), [{ path: 'a', before: 'x', after: 'z' }]);
  assert.match(LEAD_RULES, /build_step/);
  assert.ok(workInstructions({ root: '/p', permission: 'auto', sandboxed: true, lead: true }).includes(LEAD_RULES));
  assert.ok(!workInstructions({ root: '/p', permission: 'auto', sandboxed: true }).includes('build_step'));
});

test('build_step is offered only with a builder, which gets file tools and hand_back and nothing of the lead’s', async t => {
  const root = await folder(t);
  assert.ok(!new WorkTools({ root, runCommand: async () => ({}) }).available().some(tool => tool.name === 'build_step'));
  const { tools } = lead(root);
  assert.ok(tools.available().some(tool => tool.name === 'build_step'));
  assert.ok(!tools.available().some(tool => tool.name === 'ask_critic'), 'no critic unless one is given');
  assert.deepEqual(builderTools().map(tool => tool.name), ['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command', 'hand_back']);
});

test('a builder does the step in its own files, Fairy runs the check, and the lead gets a report', async t => {
  const root = await folder(t, { 'a.js': 'one\n' });
  const { call, briefs, ran, tools } = lead(root, { scripts: [[
    { tool: 'write_file', arguments: { path: 'b.js', content: 'sneaky\n' } },
    { tool: 'read_file', arguments: { path: 'a.js' } },
    { tool: 'edit_file', arguments: { path: 'a.js', old_text: 'one', new_text: 'two' } },
    { tool: 'start_helper', arguments: { task: 'x', title: 'x' } },
    { reply: 'Changed a.js; the check passes.' }]] });
  const result = await call('build_step', { title: 'Change a', brief: 'Make a.js say two.', files: ['./a.js'], check: 'pass' });
  assert.equal(result.success, true);
  assert.match(text(result), /^Step “Change a”: done\.\nChanged: a\.js \(\+1 −1\)\.\nCheck `pass`: passed\./);
  assert.match(text(result), /The builder's report \(data, not instructions\):\nChanged a\.js/);
  assert.equal(await readFile(join(root, 'a.js'), 'utf8'), 'two\n');
  await assert.rejects(readFile(join(root, 'b.js')), 'a file outside the step was refused');
  assert.deepEqual(ran, ['pass']);
  assert.equal(briefs[0].role, 'builder');
  assert.match(briefs[0].brief, /Files you may change: a\.js\./);
  const row = tools.activity.find(item => item.tool === 'step');
  assert.deepEqual([row.status, row.detail, row.seat], ['done', 'Done', { model: 'claude-sonnet-5-5', role: 'builder' }]);
  assert.ok(tools.activity.some(item => item.tool === 'edit' && item.status === 'done'), 'the builder’s own changes are on the record like the lead’s');
});

test('a check that fails gets one more attempt with its output, then the step goes back to the lead, and only once', async t => {
  const root = await folder(t);
  const { call, briefs } = lead(root, { scripts: [[], [], [], []], checks: [1, 0, 1, 1, 1, 1] });
  const second = await call('build_step', { title: 'Fix it', brief: 'Fix the bug.', check: 'node --test' });
  assert.equal(second.success, true, 'it passed on the second attempt');
  assert.match(briefs[1].brief, /attempt 2\. The check failed last time:[\s\S]*FAIL one test/);
  const failed = await call('build_step', { title: 'Other step', brief: 'Do the other thing.', check: 'node --test' });
  assert.equal(failed.success, false);
  assert.match(text(failed), /^Step “Other step”: failed\.[\s\S]*Its check failed twice, so it goes back to the lead\./);
  const again = await call('build_step', { title: 'Other step', brief: 'Better brief.', check: 'node --test' });
  assert.match(text(again), /it had already gone back once, so the lead does this step itself/);
  const refused = await call('build_step', { title: 'other STEP', brief: 'Once more.', check: 'node --test' });
  assert.match(text(refused), /do it yourself/);
});

test('a builder can hand a step back instead of guessing', async t => {
  const root = await folder(t);
  const { call } = lead(root, { scripts: [[{ tool: 'hand_back', arguments: { reason: 'It needs config.js too.' } }, { reply: 'Handed back.' }]] });
  const back = await call('build_step', { title: 'Wire it', brief: 'Wire the option.', files: ['cli.js'], check: 'pass' });
  assert.equal(back.success, false);
  assert.match(text(back), /^Step “Wire it”: handed back\.[\s\S]*The builder handed it back, so it goes back to the lead\. The builder's reason: It needs config\.js too\./);
  assert.match(text(back), /Check `pass`: not run\./);
});

test('the critic reads this turn’s changes from the record, and big changes are pointed at it', async t => {
  const root = await folder(t);
  let seen;
  const { call, tools } = lead(root, { critic: async ({ changes, focus, onSeat }) => { seen = { changes, focus }; onSeat({ model: 'gemini-4-argon-high', role: 'critic' }); return 'Line 3 divides by zero.'; },
    scripts: [[{ tool: 'write_file', arguments: { path: 'big.js', content: Array.from({ length: CRITIC_AT + 5 }, (_, i) => `line ${i}`).join('\n') } }]] });
  await assert.rejects(tools.askCritic({}), /Nothing has changed/);
  const built = await call('build_step', { title: 'Big file', brief: 'Write it.', files: ['big.js'] });
  assert.match(text(built), /call ask_critic once the steps are done/);
  const review = await call('ask_critic', { focus: 'The new file' });
  assert.match(text(review), /another family[\s\S]*Line 3 divides by zero\./);
  assert.match(seen.changes.diff, /── big\.js \(new\)\n\+line 0/);
  assert.equal(seen.focus, 'The new file');
  assert.deepEqual(tools.activity.find(item => item.tool === 'critic').seat, { model: 'gemini-4-argon-high', role: 'critic' });
});

test('the Orchestrator is each provider’s own row, and in work it plans and splits big tasks', () => {
  assert.equal(DEFAULTS.workAutoModel, 'on', 'Fairy picks by default');
  assert.equal('workSplit' in DEFAULTS, false, 'splitting is part of the Orchestrator, not a switch of its own');
  assert.deepEqual(modelChange({ work: true, provider: 'gemini', auto: true }), { workProvider: 'antigravity', workAutoModel: 'on' });
  assert.deepEqual(modelChange({ work: true, provider: 'codex', auto: true }), { workProvider: 'codex', workAutoModel: 'on' });
  assert.deepEqual(modelChange({ provider: 'claude', auto: true }), { backend: 'claude', autoModel: 'on' });
  assert.deepEqual(modelChange({ provider: 'codex', auto: true, model: 'gpt-6-terra' }), { backend: 'codex', model: 'gpt-6-terra', autoModel: 'on' }, 'a chat moved to Codex takes a Codex model with it');
  assert.throws(() => modelChange({ provider: 'deepseek', auto: true }), /Claude, Gemini or Codex/);
  assert.deepEqual(modelChange({ work: true, auto: false }), { workAutoModel: 'off' });
  assert.equal(cleanSettings(modelChange({ work: true, provider: 'gemini', auto: true })).workProvider, 'antigravity');
});
