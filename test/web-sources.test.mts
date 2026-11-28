// The Sources panel lists the web pages a chat's work turns read, with when.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webSources } from '../src/web-sources.js';

test('web pages read in a chat are listed newest first, each once, from the turns’ own records', () => {
  const history = [
    { role: 'user', content: 'Look it up', at: '2026-11-15T01:00:00.000Z' },
    { role: 'assistant', at: '2026-11-15T01:05:00.000Z', activity: [
      { tool: 'web-read', summary: 'https://nodejs.org/api/stream.html', status: 'done' },
      { tool: 'web-read', summary: 'https://example.com/broken', status: 'failed' },
      { tool: 'web-search', summary: 'node streams', status: 'done' },
      { tool: 'read', summary: 'src/a.js', status: 'done' }] },
    { role: 'assistant', at: '2026-11-16T09:00:00.000Z', activity: [
      { tool: 'web-read', summary: 'https://www.rfc-editor.org/rfc/rfc9110', status: 'done' },
      { tool: 'web-read', summary: 'https://nodejs.org/api/stream.html', status: 'done' },
      { tool: 'web-read', summary: 'javascript:alert(1)', status: 'done' }] },
  ];
  assert.deepEqual(webSources(history), [
    { url: 'https://nodejs.org/api/stream.html', at: '2026-11-16T09:00:00.000Z', name: 'nodejs.org · stream.html', site: 'nodejs.org' },
    { url: 'https://www.rfc-editor.org/rfc/rfc9110', at: '2026-11-16T09:00:00.000Z', name: 'rfc-editor.org · rfc9110', site: 'rfc-editor.org' },
  ]);
  assert.deepEqual(webSources([]), []);
  assert.deepEqual(webSources([{ role: 'assistant', at: '1', activity: [{ tool: 'web-read', summary: 'https://example.org/', status: 'done' }] }]).map(page => page.name), ['example.org']);
});

test('the panel shows them under the cited sources and opens them in the browser', () => {
  const pane = readFileSync(new URL('../src/sources-pane.ts', import.meta.url), 'utf8'), app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(pane, /const pages = webSources\(history\(\)\);/);
  assert.match(pane, /api\.openSource\(page\.url\)/);
  assert.match(pane, /Web pages read in this chat/);
  assert.match(app, /sourcesPane\(\{ api(?:\s*:\s*api\s+as\s+AppPreloadApi)?, onError: (?:\(text(?:\s*:\s*string)?\)|text) => error\(text\), history: \(\) => state\.history(?:\s+as\s+WebSourceHistoryEntry\[\])? \}\)/);
});
