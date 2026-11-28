// Token use, step 4: a work turn offers the core tools, the groups its request plainly needs, and more_tools for the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkTools, PLAIN_NEED, workTools } from '../desktop/work-tools.mjs';
import { GITHUB_TOOLS } from '../desktop/github-tools.mjs';
import { SIMULATOR_TOOLS } from '../desktop/simulator-tools.mjs';
import { runWork } from '../desktop/work-agent.mjs';

const everything = () => new WorkTools({ root: process.cwd(), runCommand: (async () => ({})) as any, github: {}, simulators: {} as any, browser: {} as any, computer: {} as any });
const names = (list: { name: string }[]) => list.map(entry => entry.name);
const size = (list: unknown[]) => list.reduce((sum: number, entry) => sum + JSON.stringify(entry).length, 0);

test('a request that needs no group gets the core tools and more_tools, which names every group and its tools', () => {
  const tools = everything(), offered = tools.offered({ request: 'Fix the failing test in parser.js' });
  assert.deepEqual(names(offered), [...names(workTools.filter(entry => !['read_attachment', 'board_plan', 'web_search', 'read_page', 'browser', 'computer', 'check_page', 'publish_page', 'look_back'].includes(entry.name))), 'more_tools']);
  const more = offered.at(-1)!;
  for (const name of [...names(GITHUB_TOOLS), ...names(SIMULATOR_TOOLS), 'browser', 'computer']) assert.ok(more.description.includes(name), name);
  assert.deepEqual((more.inputSchema.properties.group as any).enum, ['github', 'simulator', 'apps']);
  // Everything this turn can use is still there to reach, at a fraction of the size.
  assert.equal(tools.available().length, 36);
  assert.ok(size(offered) < size(tools.available()) / 3, `${size(offered)} of ${size(tools.available())}`);
});

test('a group the request plainly needs is offered directly, and more_tools still lists every group', () => {
  const pr = everything().offered({ request: 'Address the review comments on PR #12' });
  assert.ok(names(GITHUB_TOOLS).every(name => names(pr).includes(name)));
  // more_tools stays the same whatever the request (token use, step 5), so its definition doesn't break the cache.
  assert.deepEqual(pr.at(-1), everything().offered({ request: 'Tidy the README' }).at(-1));
  assert.deepEqual((pr.at(-1)!.inputSchema.properties.group as any).enum, ['github', 'simulator', 'apps']);
  const sim = everything().offered({ request: 'Try the app in the simulator' });
  assert.ok(names(sim).includes('simulator_build') && names(sim).includes('browser'));
  assert.equal(sim.at(-1)!.name, 'more_tools');
  // With no groups at all, there's no more_tools.
  assert.ok(!names(new WorkTools({ root: process.cwd(), runCommand: (async () => ({})) as any }).offered({ request: 'x' })).includes('more_tools'));
});

test('plain needs are plain: ordinary words about checking, issues or sessions don’t pull a group in', () => {
  const groups = (request: string) => (Object.keys(PLAIN_NEED) as (keyof typeof PLAIN_NEED)[]).filter(name => PLAIN_NEED[name].test(request));
  for (const request of ['check the tests pass', 'fix this issue in the parser', 'merge the two functions', 'in this session, rename x']) assert.deepEqual(groups(request), [], request);
  assert.deepEqual(groups('why is CI failing on #42'), ['github']);
  assert.deepEqual(groups('build it for the iPhone'), ['simulator']);
  assert.deepEqual(groups('open localhost:3000 in the browser'), ['apps']);
});

test('more_tools shows a group’s tools with their arguments, and calls one through the ordinary handler', async () => {
  const tools = everything();
  const listed = ((await tools.moreTools({ group: 'simulator' })).contentItems[0] as { text: string }).text;
  for (const tool of SIMULATOR_TOOLS) { assert.ok(listed.includes(`${tool.name}: ${tool.description}`)); assert.ok(listed.includes(JSON.stringify(tool.inputSchema))); }
  const calls: any[] = [];
  tools.handle = async call => { calls.push(call); return { success: true, contentItems: [{ type: 'inputText', text: 'handled' }] }; };
  assert.equal(((await WorkTools.prototype.moreTools.call(tools, { name: 'github_pr', arguments: { number: 12 } })).contentItems[0] as { text: string }).text, 'handled');
  assert.deepEqual(calls, [{ tool: 'github_pr', arguments: { number: 12 } }]);
  await WorkTools.prototype.moreTools.call(tools, { name: 'browser', arguments: ['not', 'an', 'object'] as any });
  assert.deepEqual(calls[1], { tool: 'browser', arguments: {} });
  // Only grouped tools go through it, and a wrong group says which there are.
  for (const name of ['run_command', 'write_file', 'nope']) assert.match(((await WorkTools.prototype.moreTools.call(tools, { name })).contentItems[0] as { text: string }).text, /No group has a tool called/);
  assert.equal(calls.length, 2);
  assert.match(((await tools.moreTools({ group: 'weather' })).contentItems[0] as { text: string }).text, /Pass group as one of: github, simulator, apps/);
});

test('more_tools goes through handle, and a work turn tells the model about it only when it’s offered', async () => {
  const tools = everything(), seen: any[] = [];
  assert.match(((await tools.handle({ tool: 'more_tools', arguments: { group: 'github' } })).contentItems[0] as { text: string }).text, /^github: the project’s GitHub/);
  const provider = { turn: async (options: any) => { seen.push(options); return 'ok'; } };
  await runWork({ provider, settings: {}, text: 'Tidy the README', history: [], tools: tools as any });
  assert.match(seen[0].instructions, /ask more_tools for its group, then call the tool through more_tools/);
  await runWork({ provider, settings: {}, text: 'Tidy the README', history: [], tools: new WorkTools({ root: process.cwd(), runCommand: (async () => ({})) as any }) as any });
  assert.doesNotMatch(seen[1].instructions, /more_tools/);
});
