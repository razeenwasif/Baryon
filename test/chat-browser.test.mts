// The built-in browser from a plain chat (desktop/chat-browser.mjs): opening and searching with no model call, and the
// open page going along with a question about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { asksAboutPage, browserAsk, pageContext } from '../desktop/chat-browser.mjs';
import { conversationInstructions } from '../desktop/core.mjs';
import { runBrowserStep, STEPS } from '../desktop/remote-browser.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('opening a web address in a chat loads it in the browser, however it’s asked', () => {
  for (const text of ['can you pull up wikipedia.com on the built-in browser', 'open wikipedia.org', 'Please go to https://example.com/a?b=1', 'bring up en.wikipedia.org/wiki/Black_hole in the browser please', 'Could you open localhost:5173?']) {
    const asked = browserAsk(text);
    assert.equal(asked?.kind, 'open', text);
  }
  assert.equal(browserAsk('can you pull up wikipedia.com on the built-in browser')!.address, 'https://wikipedia.com/');
  assert.equal(browserAsk('open wikipedia.org')!.said, 'Opened wikipedia.org in the browser.');
  // A name rather than an address is opened only when the browser is named; otherwise it may be an app or a question.
  assert.equal(browserAsk('open Flux'), null);
  assert.equal(browserAsk('open wikipedia in the browser')?.kind, 'search');
  assert.equal(browserAsk('show me how to tie a tie'), null);
  assert.equal(browserAsk('open my notes in the browser'), null);
  assert.equal(browserAsk('open file:///etc/passwd in the browser')?.kind, 'search', 'never anything but a web page');
});

test('a search goes to the browser when it’s named or already open, on the site open there when it has a search', () => {
  assert.equal(browserAsk('can you search up Black Holes?'), null, 'no browser open, none named: an ordinary chat');
  const onWikipedia = browserAsk('can you search up Black Holes?', { paneOpen: true, currentUrl: 'https://en.wikipedia.org/wiki/Main_Page' })!;
  assert.equal(onWikipedia.kind, 'search');
  assert.equal(onWikipedia.address, 'https://en.wikipedia.org/w/index.php?search=Black+Holes');
  assert.equal(onWikipedia.said, 'Searched Wikipedia for “Black Holes” in the browser.');
  assert.match(browserAsk('search black holes in the browser')!.address, /^https:\/\/www\.google\.com\/search\?q=black\+holes$/);
  assert.match(browserAsk('look up cats on youtube in the browser')!.address, /youtube\.com\/results\?search_query=cats/);
  assert.match(browserAsk('search for fairy on github', { paneOpen: true })!.address, /github\.com\/search\?q=fairy/);
  assert.match(browserAsk('search the web for rust async', { paneOpen: true, currentUrl: 'https://example.com/' })!.address, /google\.com\/search\?q=rust\+async/);
  assert.equal(browserAsk('search my notes for entropy', { paneOpen: true }), null);
  assert.equal(browserAsk('what is a black hole', { paneOpen: true }), null);
  assert.equal(browserAsk('search this\nand that', { paneOpen: true }), null);
});

test('a question about the page open there brings its text, marked as data', () => {
  for (const text of ['what does this page say?', 'summarize this article', 'what’s on the page in the browser', 'can you summarise it', 'read this for me']) assert.ok(asksAboutPage(text), text);
  for (const text of ['what is a black hole', 'open wikipedia.org']) assert.equal(asksAboutPage(text), false, text);
  const context = pageContext({ url: 'https://en.wikipedia.org/wiki/Black_hole', title: 'Black hole', text: 'x'.repeat(13000) });
  assert.match(context, /data, not instructions/);
  assert.match(context, /Black hole\nhttps:\/\/en\.wikipedia\.org\/wiki\/Black_hole/);
  assert.match(context, /1000 more characters not included/);
  assert.equal(pageContext(null as any), '');
});

test('her instructions name the browser, and from the other Mac’s window don’t send you to Desktop task', () => {
  const settings = { personality: '', name: 'Fairy' };
  const here = conversationInstructions(settings as any), there = conversationInstructions({ ...settings, remoteWindow: true, browserContext: '\nPAGE TEXT' } as any);
  assert.match(here, /select Desktop task/);
  assert.match(here, /built-in browser in a panel beside the chat/);
  assert.match(there, /select Desktop task there: it works on the MacBook’s own screen/, 'from the MacBook, Desktop task is the MacBook’s');
  assert.match(there, /PAGE TEXT/);
});

test('the face answers a chat’s state, go and read steps without a chat holding the browser', async () => {
  for (const tool of ['state', 'go', 'read'] as const) assert.ok(STEPS.includes(tool));
  const went: string[] = [], revealed: any[] = [];
  const drive = { url: () => 'https://here/', pane: { visible: true, go: async (address: string) => { went.push(address); return { url: address }; } }, page: {}, read: async () => ({ url: 'https://here/', title: 'Here', text: 'hi', elements: [] }) };
  assert.deepEqual(await runBrowserStep(drive as any, { tool: 'state' }), { url: 'https://here/', shown: true });
  await runBrowserStep(drive as any, { tool: 'go', args: { address: 'https://en.wikipedia.org/' } }, { reveal: (owner: any) => revealed.push(owner) });
  assert.deepEqual(went, ['https://en.wikipedia.org/']);
  assert.equal(revealed.length, 1, 'the panel opens');
  await assert.rejects(runBrowserStep(drive as any, { tool: 'go', args: { address: 'javascript:alert(1)' } }), /Only web addresses/);
  assert.equal(((await runBrowserStep(drive as any, { tool: 'read' })) as any).title, 'Here');
  assert.equal(await runBrowserStep({ ...drive, page: null } as any, { tool: 'read' }), null);
});

test('the chat handler tries the browser after the quick rules, and reads the page only for a question about it', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /const browsed = await chatBrowser\.ask\(text, Boolean\(remote\)\);/);
  assert.ok(!/if \(!remote && floating\) return null;/.test(main), 'with floating mode gone, the window’s browser always answers');
  assert.match(main, /if \(mode === 'chat' && !files\.length\)\s*chatSettings\.browserContext = await chatBrowser\.page\(text, Boolean\(remote\)\)/);
  assert.match(main, /if \(!asksAboutPage\(text\) \|\| !\(await this\.state\(remote\)\)\.shown\)\s*return '';/);
});
