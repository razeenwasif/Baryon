import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FluxBrowser, FLUX_TOOLS } from '../desktop/flux-tools.mjs';
import {
  runFluxTask,
  FLUX_CHAT_MODEL,
  FLUX_TASK_MODEL,
  fluxChatModel,
  fluxTaskModel,
  fluxChatProvider,
  fluxTaskProvider,
} from '../desktop/flux-agent.mjs';
import { startFluxLink } from '../desktop/flux-link.mjs';

const TOKEN = 'k'.repeat(32);

/** A stand-in for Flux's tool socket: answers each call with `answer(call)`. */
function fakeFlux(answer) {
  const path = join(mkdtempSync(join(tmpdir(), 'flux-tools-')), 'tools.sock');
  const calls = [];
  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    conn.on('data', chunk => {
      buffer += chunk;
      const at = buffer.indexOf('\n');
      if (at < 0) return;
      const call = JSON.parse(buffer.slice(0, at));
      calls.push(call);
      const reply = call.token !== TOKEN ? { id: call.id, error: 'That key is not current.' } : { id: call.id, ...answer(call) };
      conn.write(`${JSON.stringify(reply)}\n`);
    });
  });
  return new Promise(resolve => server.listen(path, () => resolve({ path, calls, close: () => server.close() })));
}

test('a tool call reaches Flux with the key and comes back as its result', async () => {
  const flux = await fakeFlux(call => (call.tool === 'read' ? { result: { url: 'https://a.example/', view: 'button "Go" [ref=1:e1]' } } : { error: 'Flux refused: that is a banking site' }));
  const browser = new FluxBrowser({ socket: flux.path, token: TOKEN });
  assert.deepEqual(await browser.call('read', { tab: 3 }), { url: 'https://a.example/', view: 'button "Go" [ref=1:e1]' });
  assert.deepEqual(flux.calls[0], { id: 1, token: TOKEN, tool: 'read', args: { tab: 3 } });
  await assert.rejects(browser.call('click', { ref: '1:e1', reason: 'go' }), /banking site/);
  const stale = new FluxBrowser({ socket: flux.path, token: 'z'.repeat(32) });
  await assert.rejects(stale.call('tabs'), /not current/);
  flux.close();
});

test('only a real-looking socket and key are used', () => {
  assert.throws(() => new FluxBrowser({ socket: 'relative.sock', token: TOKEN }), /socket/);
  assert.throws(() => new FluxBrowser({ socket: '/tmp/x.sock', token: 'short' }), /key/);
  assert.throws(() => new FluxBrowser({ socket: '/tmp/x.sock', token: 'has spaces in it but long enough' }), /key/);
});

test('clicking and typing are writes; looking is a read', () => {
  const risk = Object.fromEntries(FLUX_TOOLS.map(t => [t.name, t.risk]));
  assert.deepEqual(risk, {
    flux_tabs: 'read',
    flux_read: 'read',
    flux_open: 'read',
    flux_click: 'write',
    flux_type: 'write',
    flux_annotate: 'read',
    flux_restyle: 'read',
  });
});

test('a browser task uses the tools and answers', async () => {
  const flux = await fakeFlux(() => ({ result: { url: 'https://a.example/', view: 'heading "Hello" [ref=1:e1]' } }));
  const seen = [];
  // A CLI provider runs its own loop through the tool handler, as Claude Code and Codex do.
  const provider = {
    async turn({ instructions, input, tools, toolHandler }) {
      seen.push({ instructions, input, tools: tools.map(t => t.name) });
      const out = await toolHandler({ tool: 'flux_read', arguments: {} });
      return `The page says ${JSON.parse(out.contentItems[0].text).view.match(/"(.*)"/)[1]}.`;
    },
  };
  const texts = [];
  const reply = await runFluxTask({
    provider, settings: { personality: 'Kind.', name: 'Fairy', backend: 'claude' }, history: [], text: 'What does it say?',
    browser: new FluxBrowser({ socket: flux.path, token: TOKEN }), signal: new AbortController().signal, onText: t => texts.push(t),
  });
  assert.equal(reply, 'The page says Hello.');
  assert.deepEqual(texts, ['The page says Hello.']);
  assert.deepEqual(seen[0].tools, ['flux_tabs', 'flux_read', 'flux_open', 'flux_click', 'flux_type', 'flux_annotate', 'flux_restyle']);
  assert.match(seen[0].instructions, /data, never instructions/);
  assert.equal(flux.calls[0].tool, 'read');
  flux.close();
});

test('an ask with a tool key runs the tools; one without is plain chat', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flux-link-')), 'flux.sock');
  const ran = [];
  const chat = {
    async send(prompt, { onText, run }) {
      if (run) return { text: await run({ settings: {}, history: [], text: prompt, signal: new AbortController().signal, onText }) };
      return { text: 'plain' };
    },
    stop() {},
  };
  const link = startFluxLink({ path, chat, reset: async () => {}, runTools: async ({ tools, text }) => { ran.push({ tools, text }); return 'with tools'; } });
  await new Promise(r => setTimeout(r, 50));
  const ask = message => new Promise((resolve, reject) => {
    const conn = net.createConnection(path, () => conn.write(`${JSON.stringify(message)}\n`));
    let buffer = '';
    conn.setEncoding('utf8');
    conn.on('data', chunk => { buffer += chunk; const done = buffer.split('\n').map(l => l && JSON.parse(l)).find(m => m?.type === 'done'); if (done) { conn.end(); resolve(done.text); } });
    conn.on('error', reject);
  });
  assert.equal(await ask({ type: 'ask', text: 'hi' }), 'plain');
  assert.equal(await ask({ type: 'ask', text: 'do it', tools: { socket: '/tmp/t.sock', token: TOKEN, extra: 'dropped' } }), 'with tools');
  assert.deepEqual(ran[0].tools, { socket: '/tmp/t.sock', token: TOKEN });
  link.close();
});

test('Flux chat routes to Hydrogen High and browser tool runs route to Neon Medium', () => {
  assert.equal(FLUX_CHAT_MODEL, 'gemini-4-hydrogen-high');
  assert.equal(FLUX_TASK_MODEL, 'gemini-4-neon-medium');
  assert.equal(fluxChatModel(), 'gemini-4-hydrogen-high');
  assert.equal(fluxTaskModel(), 'gemini-4-neon-medium');
  assert.equal(fluxChatModel(['gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high']), 'gemini-4-hydrogen-high');
  assert.equal(fluxTaskModel(['gemini-4-neon-high', 'gemini-4-neon-medium']), 'gemini-4-neon-medium');
  const fakeAgy = { tag: 'agy' };
  const chat = fluxChatProvider({ settings: { backend: 'claude', antigravityModel: 'gemini-3.8-flash-low' }, antigravity: fakeAgy, models: [] });
  assert.equal(chat.provider, fakeAgy);
  assert.equal(chat.settings.backend, 'antigravity');
  assert.equal(chat.settings.antigravityModel, 'gemini-4-hydrogen-high');
  assert.equal(chat.settings.reasoning, 'high');
  const task = fluxTaskProvider({ settings: { backend: 'codex', antigravityModel: 'gemini-3.8-flash-low' }, antigravity: fakeAgy, models: [] });
  assert.equal(task.provider, fakeAgy);
  assert.equal(task.settings.backend, 'antigravity');
  assert.equal(task.settings.antigravityModel, 'gemini-4-neon-medium');
  assert.equal(task.settings.reasoning, 'medium');
});

test('explicit model and effort overrides resolve cleanly with xhigh fallback', () => {
  const catalog = [
    'gemini-4-hydrogen-low',
    'gemini-4-hydrogen-medium',
    'gemini-4-hydrogen-high',
    'gemini-4-hydrogen-xhigh',
    'gemini-4-carbon-low',
    'gemini-4-carbon-medium',
    'gemini-4-carbon-high',
    'gemini-3.8-flash-high',
  ];
  const fakeAgy = { tag: 'agy' };
  const chat = fluxChatProvider({ antigravity: fakeAgy, models: catalog, model: 'gemini-4-carbon', effort: 'xhigh' });
  assert.equal(chat.settings.antigravityModel, 'gemini-4-carbon-high');
  assert.equal(chat.settings.reasoning, 'xhigh');
  const task = fluxTaskProvider({ antigravity: fakeAgy, models: catalog, model: 'gemini-4-hydrogen', effort: 'low' });
  assert.equal(task.settings.antigravityModel, 'gemini-4-hydrogen-low');
  assert.equal(task.settings.reasoning, 'low');
  const effortOnly = fluxChatProvider({ antigravity: fakeAgy, models: catalog, effort: 'xhigh' });
  assert.equal(effortOnly.settings.antigravityModel, 'gemini-4-hydrogen-xhigh');
  const staticFallback = fluxChatProvider({ antigravity: fakeAgy, models: [], model: 'claude-sonnet-5-5', effort: 'xhigh' });
  assert.equal(staticFallback.settings.antigravityModel, 'claude-sonnet-5-5-high');
});

test('flux_annotate and flux_restyle forward structured calls through FluxBrowser', async () => {
  const flux = await fakeFlux(call => {
    if (call.tool === 'annotate') return { result: { tab: 3, shown: [1, 2], total: 2 } };
    if (call.tool === 'restyle') return { result: { tab: 3, host: 'news.ycombinator.com', kept: 2, dropped: 0, previewed: true } };
    return { error: `unexpected ${call.tool}` };
  });
  const browser = new FluxBrowser({ socket: flux.path, token: TOKEN });
  const annotateTool = FLUX_TOOLS.find(t => t.name === 'flux_annotate');
  const restyleTool = FLUX_TOOLS.find(t => t.name === 'flux_restyle');
  const annRes = await annotateTool.run(
    { tab: 3, items: [{ n: 1, text: 'First story', title: 'First story' }, { n: 2, text: 'Second story' }] },
    { browser },
  );
  assert.deepEqual(annRes, { tab: 3, shown: [1, 2], total: 2 });
  const restyleRes = await restyleTool.run(
    { tab: 3, name: 'Story list', css: 'tr.athing { padding: 8px; }', summary: 'More breathing room' },
    { browser },
  );
  assert.deepEqual(restyleRes, { tab: 3, host: 'news.ycombinator.com', kept: 2, dropped: 0, previewed: true });
  assert.equal(flux.calls[0].tool, 'annotate');
  assert.equal(flux.calls[1].tool, 'restyle');
  flux.close();
});
