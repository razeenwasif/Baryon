import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsScreen, wantsLatest } from '../src/chat-routing.js';
import { DEFAULTS, Providers, cleanSettings } from '../desktop/core.mjs';
import { newsDue, newsBriefing, requireWebEvidence } from '../desktop/news.mjs';
import { startConversation } from '../desktop/proactive.mjs';

test('chat captures only explicit screen requests, including the user’s phrasing', () => {
  for (const text of ['Explain the diagram on screen', "What's on my screen?", 'Can you read my screen?', 'Look at the screenshot', 'Explain this on the screen']) assert.equal(wantsScreen(text), true, text);
  for (const text of ['How do OLED screens work?', 'Explain caching', 'Do not look at my screen', 'Explain it without a screenshot', 'Translate "explain what is on my screen"', '```js\n"look at my screen"\n```']) assert.equal(wantsScreen(text), false, text);
  assert.equal(wantsScreen('Tell me more'), false); // No sticky screen mode.
});

test('freshness queries request web search without changing ordinary conversation', () => {
  for (const text of ['Latest technology news?', 'What is new in science?', 'Search for quantum computing breakthroughs', 'What happened this week?']) assert.equal(wantsLatest(text), true, text);
  for (const text of ['Hello Fairy', 'How are you today?', "I'm tired today", 'I recently learned to paint', 'Explain photosynthesis', 'Explain this without searching the web']) assert.equal(wantsLatest(text), false, text);
});

test('scheduled news observes its interval, includes manual news in cooldown, and can be disabled', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  assert(newsDue(DEFAULTS, [], now));
  const recent = [{ topic: 'technology and science news', at: '2026-09-12T11:00:00Z' }];
  assert.equal(newsDue(DEFAULTS, recent, now), false);
  assert(newsDue(DEFAULTS, recent, now + 6 * 3600000));
  assert.equal(newsDue({ ...DEFAULTS, newsMode: 'off' }, [], now), false);
  assert.throws(() => cleanSettings({ newsHours: '0' } as any), /news interval/);
});

test('proactive news uses live search and excludes private memory and unrelated conversation', async () => {
  let call: any;
  const result = await startConversation({ settings: { ...DEFAULTS, memory: 'private personal detail' }, history: [{ role: 'user', content: 'private chat' }], signal: new AbortController().signal,
    provider: { chat: async (...args: any[]) => { call = args; return { text: 'A recent discovery. [Source](https://example.com/paper)' }; } },
  });
  assert.equal(result.topic, 'technology and science news');
  assert.equal(call[0].memory, ''); assert.deepEqual(call[1], []);
  assert.equal(call[4], null); assert.deepEqual(call[5], { webSearch: true });
});

test('unverified headlines are rejected instead of presented as latest news', () => {
  assert.throws(() => requireWebEvidence('Invented news.', false), /verify fresh sources/);
  assert.throws(() => requireWebEvidence('News with no source.', true), /verify fresh sources/);
  assert.throws(() => requireWebEvidence('[Link](https://example.com)', false), /verify fresh sources/);
});

test('OpenAI live search is required and citation annotations become inline source links', async () => {
  let request: any;
  const provider = new Providers({ openai: 'test' }, (async (_url: any, options: any) => {
    request = JSON.parse(options.body);
    return Response.json({ output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: 'News. [1]', annotations: [{ type: 'url_citation', start_index: 6, end_index: 9, title: 'Research paper', url: 'https://example.com/paper' }] }] }] });
  }) as any);
  const result = await provider.chat(DEFAULTS, [], 'Latest science news', undefined, null, { webSearch: true });
  assert.equal(request.tools[0].type, 'web_search'); assert.equal(request.tools[0].external_web_access, true); assert.equal(request.tool_choice, 'required');
  assert.equal(result.text, 'News. [Research paper](https://example.com/paper)');
  const noSearch = new Providers({ openai: 'test' }, (async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Unsourced headline' }] }] })) as any);
  await assert.rejects(noSearch.chat(DEFAULTS, [], 'News', undefined, null, { webSearch: true }), /verify fresh sources/);
});
