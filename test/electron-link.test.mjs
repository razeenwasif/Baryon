import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CONTEXT, MAX_PROMPT, forElectron, startElectronLink, workRequest } from '../desktop/electron-link.mjs';

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

async function linkAt(start, stop = () => {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-el-')), 'electron.sock');
  const link = startElectronLink({ path, start, stop, name: () => 'Fairy', provider: () => 'Claude' });
  for (let i = 0; i < 50 && !existsSync(path); i += 1) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 20));
  return { path, link };
}

test('a work request needs a prompt and an absolute folder; read mode plans first', () => {
  assert.deepEqual(workRequest({ prompt: ' Link these ', folder: '/v' }), { prompt: 'Link these', context: '', folder: '/v', chat: null, permission: 'auto' });
  assert.equal(workRequest({ prompt: 'x', folder: '/v', context: ' The vault uses [[links]]. ' }).context, 'The vault uses [[links]].');
  assert.equal(workRequest({ prompt: 'x', folder: '/v', mode: 'read' }).permission, 'plan');
  assert.equal(workRequest({ prompt: 'x', folder: '/v', chat: 'abc-123' }).chat, 'abc-123');
  for (const bad of [{}, { prompt: 'x' }, { prompt: 'x', folder: 'relative' }, { prompt: ' ', folder: '/v' }, { prompt: 'x'.repeat(MAX_PROMPT + 1), folder: '/v' },
    { prompt: 'x', folder: '/v', chat: '../etc' }, { prompt: 'x', folder: '/v', mode: 'yolo' }, { prompt: 'x', folder: '/v', context: 'x'.repeat(MAX_CONTEXT + 1) }]) {
    assert.throws(() => workRequest(bad));
  }
});

test('work events reach Electron trimmed, approvals without a way to answer them', () => {
  assert.deepEqual(forElectron({ type: 'tool', row: { id: 'r', tool: 'edit', summary: 'a.md', status: 'done', output: 'secret diff' } }), { type: 'step', row: { id: 'r', tool: 'edit', summary: 'a.md', status: 'done' } });
  assert.deepEqual(forElectron({ type: 'thought', thought: { id: 't1', status: 'running', text: 'hmm' } }), { type: 'thinking' });
  assert.equal(forElectron({ type: 'thought', thought: { id: 't1', status: 'done', text: 'hmm' } }), null);
  assert.deepEqual(forElectron({ type: 'thinking' }), { type: 'thinking' });
  assert.deepEqual(forElectron({ type: 'approval', id: 'ap', title: 'Run make', command: 'make' }), { type: 'approval', approval: 'ap', title: 'Run make', detail: 'make' });
  assert.equal(forElectron({ type: 'browser-open' }), null);
});

test('the socket is private, says hello, and streams a turn from started to done', async t => {
  let stopped = null;
  const { path, link } = await linkAt(async (request, emit) => {
    assert.equal(request.permission, 'auto');
    setTimeout(() => { emit({ type: 'tool', row: { id: '1', tool: 'read', summary: 'a.md', status: 'done' } }); emit({ type: 'text', text: 'Linked.' }); emit({ type: 'done', text: 'Linked two notes.', failed: false }); }, 30);
    return { chat: 'chat-1' };
  }, id => { stopped = id; });
  t.after(() => link.close());
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const replies = await talk(path, [{ type: 'hello' }, { type: 'work', id: 'w1', folder: '/v', prompt: 'Link them' }], r => r.some(m => m.type === 'done'));
  assert.deepEqual(replies[0], { type: 'hello', name: 'Fairy', provider: 'Claude' });
  assert.deepEqual(replies.slice(1).map(m => m.type), ['started', 'step', 'text', 'done']);
  assert.equal(replies[1].chat, 'chat-1');
  assert.ok(replies.slice(1).every(m => m.id === 'w1'));
  assert.equal(stopped, null);
});

test('a request that can not start answers with an error, and stop reaches the right chat', async t => {
  let stopped = null, finish;
  const { path, link } = await linkAt(async (request, emit) => {
    if (request.prompt === 'busy') throw new Error('Fairy is still working in this chat.');
    finish = () => emit({ type: 'done', text: 'Stopped.', failed: true });
    return { chat: 'chat-9' };
  }, id => { stopped = id; finish(); });
  t.after(() => link.close());
  const replies = await talk(path, [{ type: 'work', id: 'a', folder: '/v', prompt: 'busy' }, { type: 'work', id: 'b', folder: '/v', prompt: 'go' }, { type: 'nope' }],
    r => r.some(m => m.type === 'started'));
  assert.ok(replies.some(m => m.type === 'error' && m.id === 'a' && /still working/.test(m.message)));
  assert.ok(replies.some(m => m.type === 'error' && m.message === 'Unknown request.'));
  const done = await talk(path, [{ type: 'work', id: 'c', folder: '/v', prompt: 'go' }, { type: 'stop', id: 'c' }], r => r.some(m => m.type === 'done'));
  assert.equal(stopped, 'chat-9');
  assert.equal(done.at(-1).failed, true);
});

test('hello includes status fields when a status callback is supplied', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-el-status-')), 'electron.sock');
  const link = startElectronLink({ path, start: async () => ({ chat: 'c' }), stop: () => {}, name: () => 'Fairy', provider: () => '', status: () => ({ remote: true, link: 'unreachable' }) });
  for (let i = 0; i < 50 && !existsSync(path); i += 1) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 20));
  t.after(() => link.close());
  const [hello] = await talk(path, [{ type: 'hello' }], r => r.length >= 1);
  assert.deepEqual(hello, { type: 'hello', name: 'Fairy', provider: '', remote: true, link: 'unreachable' });
});
