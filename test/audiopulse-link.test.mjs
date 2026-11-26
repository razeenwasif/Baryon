import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSIST_GUARD, MAX_INSTRUCTIONS, MAX_PROMPT, assistOnce, assistRequest, providerName, startAudioPulseLink } from '../desktop/audiopulse-link.mjs';

/** Send `messages` (one JSON line each) and collect replies until `until` says enough. */
function talk(path, messages, until) {
  return new Promise((resolve, reject) => {
    const replies = [];
    let buffer = '';
    const conn = net.createConnection(path, () => messages.forEach(m => conn.write(typeof m === 'string' ? `${m}\n` : `${JSON.stringify(m)}\n`)));
    conn.setEncoding('utf8');
    conn.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, at)));
        buffer = buffer.slice(at + 1);
      }
      if (until(replies)) { conn.end(); resolve(replies); }
    });
    conn.on('error', reject);
  });
}

async function linkAt(ask) {
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-ap-')), 'audiopulse.sock');
  const link = startAudioPulseLink({ path, ask, name: () => 'Fairy', provider: () => 'Claude' });
  for (let i = 0; i < 50 && !existsSync(path); i += 1) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 20));
  return { path, link };
}

test('a request needs instructions and a prompt, within their limits', () => {
  assert.deepEqual(assistRequest({ instructions: ' Reply in JSON. ', prompt: ' play jazz ' }), { instructions: 'Reply in JSON.', prompt: 'play jazz' });
  for (const bad of [{}, { instructions: 'x' }, { prompt: 'x' }, { instructions: 1, prompt: 'x' }, { instructions: 'x', prompt: ' ' },
    { instructions: 'x'.repeat(MAX_INSTRUCTIONS + 1), prompt: 'x' }, { instructions: 'x', prompt: 'x'.repeat(MAX_PROMPT + 1) }]) {
    assert.throws(() => assistRequest(bad), error => error.status === 400);
  }
});

test('names the provider the way the user knows it', () => {
  assert.equal(providerName({ backend: 'claude' }), 'Claude');
  assert.equal(providerName({ backend: 'codex' }), 'ChatGPT');
  assert.equal(providerName({ backend: 'antigravity' }), 'Gemini');
  assert.equal(providerName({ backend: 'openai' }), '');
});

test('runs once on the chosen provider, with the guard and no history or persona', async () => {
  const calls = [];
  const make = label => ({ turn: async options => { calls.push([label, options]); return { text: ` {"action":"play"} ` }; } });
  const providers = { claude: make('claude'), codex: make('codex'), antigravity: make('antigravity') };
  const settings = { name: 'Fairy', personality: 'cheerful' };
  const request = { instructions: 'Reply with JSON.', prompt: 'play jazz' };

  assert.equal(await assistOnce({ settings: { ...settings, backend: 'claude' }, ...providers, ...request }), '{"action":"play"}');
  const [, claude] = calls.at(-1);
  assert.equal(claude.prompt, 'play jazz');
  assert.ok(claude.instructions.startsWith(ASSIST_GUARD) && claude.instructions.endsWith('Reply with JSON.'));
  assert.ok(!('history' in claude));

  await assistOnce({ settings: { ...settings, backend: 'codex' }, ...providers, ...request });
  const [, codex] = calls.at(-1);
  assert.deepEqual(codex.input, [{ type: 'text', text: 'play jazz', text_elements: [] }]);
  assert.ok(codex.instructions.includes('Reply with JSON.'));

  await assistOnce({ settings: { ...settings, backend: 'antigravity' }, ...providers, ...request });
  const [, gemini] = calls.at(-1);
  assert.ok(gemini.prompt.startsWith(ASSIST_GUARD) && gemini.prompt.endsWith('play jazz'));

  await assert.rejects(assistOnce({ settings: { ...settings, backend: 'openai' }, ...providers, ...request }), error => error.status === 503);
  assert.deepEqual(calls.map(([label]) => label), ['claude', 'codex', 'antigravity']);
});

test('the socket says hello, answers by id, and reports problems', async () => {
  const seen = [];
  const { path, link } = await linkAt(async request => { seen.push(request); if (request.prompt === 'fail') throw new Error('No provider.'); return '{"ok":true}'; });
  const replies = await talk(path, [
    { type: 'hello' },
    { type: 'ask', id: 'a', instructions: 'JSON only', prompt: 'play jazz', extra: 'ignored' },
    { type: 'ask', id: 'b', instructions: 'JSON only', prompt: 'fail' },
    { type: 'ask', id: 'c', instructions: '', prompt: 'x' },
    'not json',
    { type: 'dance', id: 'd' },
  ], replies => replies.length >= 6);
  assert.deepEqual(replies.find(r => r.type === 'hello'), { type: 'hello', name: 'Fairy', provider: 'Claude' });
  assert.deepEqual(replies.find(r => r.id === 'a'), { type: 'done', id: 'a', text: '{"ok":true}' });
  assert.deepEqual(replies.find(r => r.id === 'b'), { type: 'error', id: 'b', message: 'No provider.' });
  assert.equal(replies.find(r => r.id === 'c').type, 'error');
  assert.ok(replies.some(r => r.message === 'That was not JSON.'));
  assert.equal(replies.find(r => r.id === 'd').message, 'Unknown request.');
  // Only the two fields reach the provider.
  assert.deepEqual(seen[0], { instructions: 'JSON only', prompt: 'play jazz' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  link.close();
  assert.ok(!existsSync(path));
});
