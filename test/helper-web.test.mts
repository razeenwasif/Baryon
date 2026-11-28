// Scout helpers can search the web and read what they find, with the turn's web tools, and never ask anyone anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELPER_WEB_REFUSAL, runHelper } from '../desktop/work-agent.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-helper-web-')));
const asked: string[] = [], opened: string[] = [];
const web = { search: async ({ query }: { query: string }) => { asked.push(query); return { results: [{ url: 'https://docs.example.org/api', title: 'API', snippet: '' }], text: '1. API https://docs.example.org/api' }; },
  read: async ({ url }: { url: string }) => { opened.push(url); return { url, title: 'API', status: 200, text: 'The limit is 100 requests a minute.', links: [] }; } };

test('with the turn’s web tools, a scout searches and reads the pages its search found', async () => {
  let offered: any = null; const results: any[] = [];
  const provider = { turn: async (options: any) => {
    offered = options;
    results.push(await options.toolHandler({ tool: 'web_search', arguments: { query: 'example api rate limit' } }));
    results.push(await options.toolHandler({ tool: 'read_page', arguments: { url: 'https://docs.example.org/api' } }));
    // An address the search didn't find would need someone's OK, and a helper has nobody to ask.
    const refused = await options.toolHandler({ tool: 'read_page', arguments: { url: 'https://elsewhere.example.com/secret?token=1' } });
    assert.equal(refused.success, false); assert.ok(refused.contentItems.map((item: any) => item.text).join('').includes(HELPER_WEB_REFUSAL));
    return 'The limit is 100 requests a minute (https://docs.example.org/api).';
  } };
  const answer = await runHelper({ provider, settings: {}, root, sandboxed: true, task: 'What is the API rate limit?', signal: new AbortController().signal, onEvent: () => {}, web });
  assert.match(answer, /100 requests a minute/);
  assert.deepEqual(offered.tools.map((tool: any) => tool.name).sort(), ['list_files', 'read_file', 'read_page', 'search_files', 'web_search']);
  assert.match(offered.instructions, /the web through web_search and read_page \(only pages your search found\)/);
  assert.match(offered.instructions, /the address of every page a claim comes from/);
  assert.deepEqual(asked, ['example api rate limit']); assert.deepEqual(opened, ['https://docs.example.org/api']);
  assert.match(results[1].contentItems.map((item: any) => item.text).join(''), /100 requests a minute/);
});

test('without web tools a helper reads only the project, as before; main gives scouts the turn’s web', async () => {
  let offered: any = null;
  await runHelper({ provider: { turn: async (options: any) => { offered = options; return 'ok'; } }, settings: {}, root, sandboxed: true, task: 'x', signal: new AbortController().signal, onEvent: () => {} });
  assert.deepEqual(offered.tools.map((tool: any) => tool.name).sort(), ['list_files', 'read_file', 'search_files']);
  assert.doesNotMatch(offered.instructions, /web_search/);
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /runHelper\(\{ provider: seat\.provider, settings: seat\.settings, root, sandboxed, task, signal, onEvent, web: turnWeb \}\)/);
  assert.match(main, /web: turnWeb,/);
});
