// Fairy away from the mini, Away 2: a window on the face's Mac, over the real link (desktop/face-link.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { call, setup } from './helpers/face-pair.mjs';
import { FaceLink } from '../desktop/face-link.mjs';
import { encode } from '../desktop/remote-codec.mjs';

async function opened(s) {
  const window = await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } });
  assert.equal(window.status, 200);
  return window.json.token;
}
const ask = (s, token, body, extra = {}) => call(s.link, '/v1/face/call', { method: 'POST', key: s.key, body, headers: token ? { 'X-Fairy-Window': token } : {}, ...extra });

test('opening the window needs the approve key; a call needs its live token and a Remote channel', async () => {
  const calls = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async (channel, args) => { calls.push({ channel, args }); return { chats: ['a'], dataDir: '/x' }; };
  try {
    assert.equal((await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: {} })).status, 403, 'no approve key');
    assert.equal((await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.key } })).status, 403, 'the read key isn’t it');
    const token = await opened(s);
    assert.equal((await ask(s, '', { channel: 'state', args: [] })).status, 401, 'no token');
    assert.equal((await ask(s, 'not-the-token', { channel: 'state', args: [] })).status, 401, 'a wrong token');
    assert.equal((await ask(s, token, { channel: 'subscription-login', args: [] })).status, 403, 'a mini-only channel');
    assert.equal((await ask(s, token, { channel: 'minimize', args: [] })).status, 403, 'a channel the face answers itself');
    assert.equal(calls.length, 0, 'nothing ran');
    const answered = await ask(s, token, { channel: 'state', args: [] });
    assert.equal(answered.status, 200);
    assert.deepEqual(answered.json.result, { chats: ['a'], dataDir: '/x' });
    // A newer window replaces the old one's token, and closing ends it.
    const next = await opened(s);
    assert.equal((await ask(s, token, { channel: 'state', args: [] })).status, 401, 'the old token ended');
    assert.equal((await call(s.link, '/v1/face/window/close', { method: 'POST', key: s.key, body: {}, headers: { 'X-Fairy-Window': next } })).status, 200);
    assert.equal((await ask(s, next, { channel: 'state', args: [] })).status, 401, 'closed');
    // After 12 hours the token ends by itself.
    const late = await opened(s);
    const realNow = s.face.now; s.face.now = () => realNow() + 12 * 3_600_000 + 1;
    assert.equal((await ask(s, late, { channel: 'state', args: [] })).status, 401, '12 hours on');
  } finally { await s.done(); }
});

test('a call reaches the same handler with the same arguments, bytes included, and its error comes back as text', async () => {
  const calls = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async (channel, args) => { calls.push({ channel, args }); if (args[0] === 'boom') throw new Error('That chat is gone.'); return { echoed: args[1] }; };
  try {
    const token = await opened(s);
    const answered = await ask(s, token, { channel: 'session-rename', args: encode(['chat-1', Buffer.from('new name')]) });
    assert.equal(calls[0].channel, 'session-rename');
    assert.equal(calls[0].args[0], 'chat-1');
    assert.ok(Buffer.isBuffer(calls[0].args[1]));
    assert.equal(calls[0].args[1].toString(), 'new name');
    assert.deepEqual(answered.json.result, { echoed: { $bytes: Buffer.from('new name').toString('base64') } });
    assert.deepEqual((await ask(s, token, { channel: 'session-open', args: ['boom'] })).json, { error: 'That chat is gone.' });
  } finally { await s.done(); }
});

test('allowing a step from the face’s window needs the approve key; denying doesn’t', async () => {
  const calls = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async (channel, args) => { calls.push(args); return null; };
  try {
    const token = await opened(s);
    assert.equal((await ask(s, token, { channel: 'approval-answer', args: ['q1', 'allow'] })).status, 403);
    assert.equal((await ask(s, token, { channel: 'approval-answer', args: ['q1', 'deny'] })).status, 200);
    assert.equal((await ask(s, token, { channel: 'approval-answer', args: ['q1', 'allow'], approveKey: s.approveKey })).status, 200);
    assert.deepEqual(calls, [['q1', 'deny'], ['q1', 'allow']]);
  } finally { await s.done(); }
});

test('a big answer is sent gzipped when the face can take it', async () => {
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async () => ({ history: 'x'.repeat(5000) });
  try {
    const token = await opened(s);
    const packed = await ask(s, token, { channel: 'state', args: [] }, { headers: { 'X-Fairy-Window': token, 'Accept-Encoding': 'gzip' } });
    assert.equal(packed.headers['content-encoding'], 'gzip');
    assert.equal(JSON.parse(gunzipSync(packed.bytes).toString()).result.history.length, 5000);
    const plain = await ask(s, token, { channel: 'state', args: [] });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.json.result.history.length, 5000);
  } finally { await s.done(); }
});

test('window events go to the face in order, in numbered batches at most every 30 ms, and only while its window is open', () => {
  const timers = [], written = [];
  const face = new FaceLink({ ask: async () => ({ text: '' }), call: async () => null,
    timers: { setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  face.stream = { response: { write: chunk => written.push(chunk) } };
  face.windowEvent('reply', { text: 'early' });
  assert.equal(timers.length, 0, 'no window yet: nothing sent');
  face.window = { token: 't', device: 'd', expires: Date.now() + 1000, seq: 0, queue: [], timer: null };
  face.windowEvent('reply', { text: 'a' });
  face.windowEvent('progress', 'thinking');
  face.windowEvent('mic-toggle', true);
  face.windowEvent('reply', { text: 'ab', audio: Buffer.from([1]) });
  assert.equal(timers.length, 1, 'one timer for the batch');
  assert.equal(timers[0].ms, 30);
  timers[0].run();
  face.windowEvent('sessions', { list: [] });
  timers[1].run();
  const batches = written.filter(chunk => chunk.startsWith('event: window')).map(chunk => JSON.parse(chunk.split('data: ')[1]));
  assert.deepEqual(batches.map(batch => batch.seq), [1, 2]);
  assert.deepEqual(batches[0].events.map(([channel]) => channel), ['reply', 'progress', 'reply'], 'this Mac’s own events stay here');
  assert.deepEqual(batches[0].events[2][1], { text: 'ab', audio: { $bytes: 'AQ==' } });
  face.closeWindow();
  face.windowEvent('reply', { text: 'after' });
  assert.equal(timers.length, 2, 'closed: nothing more');
});
