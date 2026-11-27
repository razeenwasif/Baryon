// "Improving existing features", item 8: every tool on one registry, with a risk, an audit line for each write, and a
// test or eval that names it; the registry carries pictures, per-call progress and a reading budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatFunction, defineTool, toolset, runToolTurn } from '../desktop/tool-registry.mjs';
import { WORK_DEFINITIONS, WORK_WRITES, WorkTools, riskOf, workTools } from '../desktop/work-tools.mjs';
import { FILE_TOOLS, fileTools } from '../desktop/files-agent.mjs';
import { GitHub } from '../desktop/github.mjs';
import { GITHUB_TOOLS } from '../desktop/github-tools.mjs';
import { DRIVE_TOOLS } from '../desktop/google-tools.mjs';
import { NEXUS_TOOLS, Nexus } from '../desktop/nexus.mjs';
import { fakeGh } from '../evals/fake-github.mjs';

const picture = defineTool({ name: 'look', description: 'Look at a page.', properties: { page: { type: 'number' } },
  run: args => ({ page: args.page, pictures: [{ url: 'data:image/png;base64,AAAA', caption: `Page ${args.page}` }] }),
  progress: args => ({ text: `Looking at page ${args.page}, slowly`, done: `Looking at page ${args.page}`, status: 'Looking…' }), detail: result => `page ${result.page}` });
const words = defineTool({ name: 'words', description: 'Some words.', run: () => ({ text: 'x'.repeat(50) }) });
const save = defineTool({ name: 'save', description: 'Save.', risk: 'write', counts: false, run: () => ({ saved: true }) });

test('a result’s pictures go beside its text to every provider, and its step shows while it runs', async () => {
  const steps = [];
  const set = toolset([picture], { onStep: step => steps.push(step) });
  const handled = await set.toolHandler({ tool: 'look', arguments: { page: 3 } });
  assert.deepEqual(handled.contentItems, [{ type: 'inputText', text: '{"page":3}' }, { type: 'inputText', text: 'Page 3' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }]);
  assert.deepEqual(steps, [{ id: 1, text: 'Looking at page 3, slowly', status: 'Looking…', state: 'running' }, { id: 1, text: 'Looking at page 3', state: 'done', detail: 'page 3' }]);
  // hold keeps the step open until the provider has the picture.
  const held = await set.toolHandler({ tool: 'look', arguments: { page: 4 } }, { hold: true });
  assert.equal(steps.length, 3); held.whenRead(); assert.equal(steps.at(-1).state, 'done');
  // The Responses API gets the picture in a user message after the function output.
  let round = 0, sent = null;
  const provider = { response: async request => { round++; if (round === 1) return { output: [{ type: 'function_call', call_id: 'c1', name: 'look', arguments: '{"page":2}' }] }; sent = request.input; return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Seen.' }] }] }; } };
  await runToolTurn({ provider, settings: { backend: 'openai', model: 'm' }, signal: new AbortController().signal, instructions: '', label: 'x', recent: [], set: toolset([picture]) });
  assert.deepEqual(sent.slice(-2), [{ type: 'function_call_output', call_id: 'c1', output: '{"page":2}' }, { role: 'user', content: [{ type: 'input_text', text: 'Page 2' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'original' }] }]);
  assert.deepEqual(chatFunction(picture), { type: 'function', function: { name: 'look', description: 'Look at a page.', parameters: picture.inputSchema } });
});

test('a reading budget of calls and characters, refused or thrown, with saves outside it, finish and a check that stops everything', async () => {
  const set = toolset([words, save], { characters: 100, refuse: true, limitMessage: 'Budget reached.' });
  assert.equal((await set.execute('words', {})).text.length, 50);
  await set.execute('words', {});
  assert.deepEqual(set.used(), { calls: 2, characters: 2 * '{"text":""}'.length + 100 });
  assert.deepEqual(await set.execute('words', {}), { error: 'Budget reached.' }, 'past 100 characters read');
  assert.deepEqual(await set.execute('save', {}), { saved: true }, 'a save doesn’t count');
  const ended = toolset([words], { refuse: true, limitMessage: 'Done reading.' }); ended.finish();
  assert.deepEqual(await ended.execute('words', {}), { error: 'Done reading.' });
  await assert.rejects(() => toolset([words], { limit: 0 }).execute('words', {}), /Tool limit reached/);
  let moved = false;
  const checked = toolset([defineTool({ name: 'move', description: 'Moves.', run: () => { moved = true; return {}; } })], { check: () => { if (moved) throw new Error('Folders changed.'); } });
  await assert.rejects(() => checked.execute('move', {}), /Folders changed/);
});

test('every work-session tool is on the registry with a risk; models get only the schema; each write goes in the audit', async () => {
  for (const schema of workTools) { assert.ok(WORK_DEFINITIONS.has(schema.name), schema.name); assert.deepEqual(Object.keys(schema).sort(), ['description', 'inputSchema', 'name']); }
  for (const [name, definition] of WORK_DEFINITIONS) assert.equal(definition.risk, WORK_WRITES.has(name) ? 'write' : 'read', name);
  assert.deepEqual([...WORK_WRITES].sort(), ['browser', 'build_step', 'computer', 'edit_file', 'helper_changes', 'publish_page', 'run_command', 'write_file']);
  assert.equal(riskOf('github_pr_comment'), 'write'); assert.equal(riskOf('nexus_logs'), 'read'); assert.equal(riskOf('nexus_run'), 'write');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-audit-'))); writeFileSync(join(root, 'a.txt'), 'one\n');
  const audited = [], tools = new WorkTools({ root, permission: 'auto', sandboxed: true, runCommand: async () => ({ code: 0, stdout: 'ok', stderr: '' }), audit: entry => audited.push(entry) });
  await tools.handle({ tool: 'read_file', arguments: { path: 'a.txt' } });
  await tools.handle({ tool: 'write_file', arguments: { path: 'b.txt', content: 'two\n' } });
  await tools.handle({ tool: 'edit_file', arguments: { path: 'zzz.txt', old_text: 'x', new_text: 'y' } });
  assert.deepEqual(audited.map(({ tool, ok }) => [tool, ok]), [['write_file', true], ['edit_file', false]], 'reads aren’t audited; a failed write is');
  assert.match(audited[0].summary, /b\.txt/);
  const planned = [], plan = new WorkTools({ root, permission: 'plan', sandboxed: true, runCommand: async () => ({}), audit: entry => planned.push(entry) });
  const refusedWrite = await plan.handle({ tool: 'write_file', arguments: { path: 'c.txt', content: 'x' } });
  assert.equal(refusedWrite.success, false); assert.deepEqual(planned.map(({ tool, ok }) => [tool, ok]), [['write_file', false]]);
  assert.equal((await tools.handle({ tool: 'hand_back', arguments: { reason: 'x' } })).contentItems[0].text, 'Unknown tool.', 'a builder’s hand_back isn’t the lead’s');
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /audit: entry => approvals\.note\(\{ kind: entry\.kind, tool: entry\.tool, risk: 'write', title: entry\.summary, source: 'work', chat: id \}, entry\.ok \? 'done' : 'failed'\),/);
});

test('the files agent’s tools are on the registry: saving is the one write and doesn’t count toward reading', () => {
  assert.deepEqual(FILE_TOOLS.map(entry => [entry.name, entry.risk, entry.counts]), [['files_roots', 'read', true], ['files_list', 'read', true], ['files_search', 'read', true], ['files_read', 'read', true], ['files_image', 'read', true], ['files_write', 'write', false]]);
  assert.deepEqual(fileTools.map(entry => entry.function.name), ['files_roots', 'files_list', 'files_search', 'files_read', 'files_image']);
  assert.deepEqual(FILE_TOOLS.find(entry => entry.name === 'files_image').progress({ path: 'scan.pdf', page: 2 }, { slowPictures: true }), { done: 'Looking at page 2 of scan.pdf', text: 'Looking at page 2 of scan.pdf, which can take a minute or two on Gemini', status: 'Looking at page 2…' });
});

test('the tools no test called before: GitHub’s reads, Drive’s recent files, and Nexus’s logs and outputs', async () => {
  const gh = fakeGh({ repo: 'ada/orbit', prs: [{ number: 7, title: 'Faster', author: 'ada', state: 'OPEN', head: 'fast', files: ['src/a.js'], diff: 'diff --git a/src/a.js b/src/a.js\n+x\n', checks: [{ name: 'test', conclusion: 'FAILURE', run: 3001 }] }], issues: [{ number: 12, title: 'Hangs', author: 'grace', body: 'e = 0' }], runs: { 3001: { name: 'test', conclusion: 'failure', branch: 'fast', log: 'FAIL' } } });
  const github = toolset(GITHUB_TOOLS, { limit: Infinity, context: { github: new GitHub({ run: gh.run }) } });
  for (const [name, args] of [['github_status', {}], ['github_repos', {}], ['github_prs', { repo: 'ada/orbit' }], ['github_pr_diff', { repo: 'ada/orbit', number: 7 }], ['github_checks', { repo: 'ada/orbit', number: 7 }], ['github_issues', { repo: 'ada/orbit' }], ['github_search', { query: 'solver', repo: 'ada/orbit' }]]) {
    const result = await github.execute(name, args);
    assert.ok(result && !result.error, `${name}: ${JSON.stringify(result)}`);
  }
  assert.ok(gh.calls.length >= 7);
  let asked = null;
  const drive = toolset(DRIVE_TOOLS, { context: { drive: { search: async args => { asked = args; return { files: [{ name: 'Plan' }] }; } } } });
  assert.deepEqual(await drive.execute('drive_list_recent', {}), { files: [{ name: 'Plan' }] }); assert.equal(asked.pageSize, 15);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-nexus-cov-')));
  const nexus = new Nexus({ found: { cli: '/bin/nexus', env: {} }, run: async (where, args) => args[0] === 'logs' ? { code: 0, out: 'epoch 1\n', err: '', stopped: false } : { code: 0, out: '', err: '' } });
  const cluster = toolset(NEXUS_TOOLS, { context: { nexus, root } });
  assert.deepEqual(await cluster.execute('nexus_logs', { job: 'j-1234abcd' }), { job: 'j-1234abcd', ended: true, exitCode: 0, log: 'epoch 1\n' });
  assert.deepEqual(await cluster.execute('nexus_outputs', { job: 'j-1234abcd' }), { job: 'j-1234abcd', folder: 'nexus-outputs/j-1234abcd', files: [] });
});

test('every tool on the registry is named in at least one test or eval', async () => {
  const modules = ['files-agent.mjs', 'flux-tools.mjs', 'github-tools.mjs', 'google-tools.mjs', 'nexus.mjs', 'simulator-tools.mjs', 'side-sessions.mjs', 'work-tools.mjs'];
  const names = new Set();
  for (const file of modules) for (const value of Object.values(await import(`../desktop/${file}`))) for (const entry of value instanceof Map ? value.values() : Array.isArray(value) ? value : []) if (entry?.risk && typeof entry.run === 'function') names.add(entry.name);
  assert.ok(names.size >= 74, `${names.size} tools`);
  const here = new URL('.', import.meta.url), evals = new URL('../evals/', import.meta.url);
  const text = [...readdirSync(here).filter(file => file.endsWith('.mjs')).map(file => readFileSync(new URL(file, here), 'utf8')), ...readdirSync(evals).filter(file => file.endsWith('.mjs')).map(file => readFileSync(new URL(file, evals), 'utf8'))].join('\n');
  const missing = [...names].filter(name => !new RegExp(`['"\`]${name}['"\`]`).test(text));
  assert.deepEqual(missing, [], 'add a test or eval that calls each of these');
});

test('a Desktop task’s batch is shown as plain steps, in the app and on the screen it happens on', async () => {
  const { actionPreview } = await import('../desktop/action-review.mjs');
  const preview = actionPreview([
    { type: 'open_app', bundle_id: 'com.apple.TextEdit' }, { type: 'click', button: 'left', x: 120.4, y: 88 }, { type: 'click', button: 'right', x: 5, y: 6 },
    { type: 'double_click', x: 1, y: 2 }, { type: 'type', text: 'Dear Ada,\nthanks' }, { type: 'type', text: 'x'.repeat(200) }, { type: 'keypress', keys: ['CMD', 'S'] },
    { type: 'scroll', x: 10, y: 10, scroll_x: 0, scroll_y: -300 }, { type: 'drag', path: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 9 }] }, { type: 'move', x: 3, y: 4 },
    { type: 'browser_navigate', url: 'https://example.com' }, { type: 'browser_search', query: 'orbit' }, { type: 'browser_tab', direction: 'previous' }, { type: 'wait' }, { type: 'screenshot' },
  ], { width: 1512, height: 982, focus: { bundlePath: '/System/Applications/TextEdit.app' } });
  assert.equal(preview.app, 'TextEdit');
  assert.deepEqual(preview.steps, ['Open com.apple.TextEdit', 'Click at 120, 88', 'Right-click at 5, 6', 'Double-click at 1, 2', 'Type “Dear Ada, thanks”', `Type “${'x'.repeat(159)}…” (200 characters)`, 'Press CMD + S',
    'Scroll up at 10, 10', 'Drag from 1, 1 to 9, 9', 'Move the pointer to 3, 4', 'Go to https://example.com', 'Search the web for “orbit”', 'Switch to the previous tab', 'Wait a moment', 'Take a screenshot']);
  assert.match(preview.text, /^1\. Open com\.apple\.TextEdit\n2\. Click at 120, 88\n/); assert.match(preview.text, /\nIn TextEdit, on a 1512 × 982 screen\.$/);
});

test('a Desktop task asks through the shared approvals, which the window, the companion and the log share, and a phone can only stop it', async () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const task = main.slice(main.indexOf('async function runDesktopTask('), main.indexOf('// What a batch does, for the MacBook'));
  assert.doesNotMatch(task, /showMessageBox/);
  assert.match(task, /: await askChatApproval\(\{ kind: 'computer', tool: 'desktop', risk: 'write', title: message, detail, allowLabel: allow, denyLabel: cancel, macOnly: true, \.\.\.\(steps \? \{ steps \} : \{\}\) \}, signal\) === 'allow';/);
  assert.match(task, /const preview = actionPreview\(actions, dimensions\);/); assert.match(task, /\$\{preview\.text\}`/);
  const { Approvals } = await import('../desktop/approvals.mjs');
  const logged = [], approvals = new Approvals({ log: { add: entry => logged.push(entry) } });
  const asked = approvals.ask({ kind: 'computer', tool: 'desktop', risk: 'write', title: 'Review the next desktop actions', detail: '1. Click at 1, 2', macOnly: true, source: 'chat' });
  const [pending] = approvals.pending();
  assert.equal(pending.macOnly, true);
  assert.throws(() => approvals.answer(pending.id, 'allow', 'phone'), /only be allowed on the Mac/);
  approvals.answer(pending.id, 'deny', 'phone');
  assert.equal(await asked, 'deny');
  assert.deepEqual(logged.map(entry => [entry.event, entry.kind, entry.tool, entry.via]), [['asked', 'computer', 'desktop', undefined], ['denied', 'computer', 'desktop', 'phone']]);
});

test('the companion’s card says a request’s own answers, such as Run these actions and Stop task', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), companion = readFileSync(new URL('../src/companion.js', import.meta.url), 'utf8');
  assert.match(main, /\.\.\.\(request\.allowLabel \? \{ allowLabel: String\(request\.allowLabel\)\.slice\(0, 40\) \} : \{\}\), \.\.\.\(request\.denyLabel \? \{ denyLabel: String\(request\.denyLabel\)\.slice\(0, 40\) \} : \{\}\)/);
  assert.match(companion, /\$\('#approval-allow'\)\.textContent = value\.allowLabel \|\| 'Allow'; \$\('#approval-deny'\)\.textContent = value\.denyLabel \|\| 'Deny';/);
});
