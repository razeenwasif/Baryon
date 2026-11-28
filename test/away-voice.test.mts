// Fairy away from the mini, Away 4: her voice, your recordings, attachments, links and notifications on the MacBook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { call, setup } from './helpers/face-pair.mjs';
import { FaceLink } from '../desktop/face-link.mjs';
import { ATTACH_MAX_BYTES, FaceWindow } from '../desktop/face-window.mjs';
import { BYTE_CHANNELS, kindOf, READS, WINDOW_EVENTS } from '../desktop/remote-channels.mjs';
import { decode, encode } from '../desktop/remote-codec.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('a recording and a reply’s audio cross the link byte for byte', () => {
  const recording = randomBytes(300_000), clip = randomBytes(64_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const there = decode(JSON.parse(JSON.stringify(encode([recording, 'audio/webm'])))) as any;
  assert.ok(there[0].equals(recording));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const back = decode(JSON.parse(JSON.stringify(encode({ requestId: 'r1', bytes: clip, pauseBeforeMs: 120 })))) as any;
  assert.ok(back.bytes.equals(clip));
  assert.equal(back.requestId, 'r1');
});

test('speech, transcribing and adding a file are answered by the mini; choosing the file is this Mac’s', () => {
  for (const channel of ['speak', 'transcribe', 'attach-bytes', 'attach-discard', 'prepare-local-speech']) assert.equal(kindOf(channel), 'remote', channel);
  assert.equal(kindOf('attach-choose'), 'local');
  assert.equal(kindOf('hands-free-enable'), 'mini-only', 'hands-free listening stays off in a window on the face');
  assert.deepEqual(BYTE_CHANNELS, ['transcribe', 'attach-bytes', 'notebook-paste', 'notebook-saveImage', 'analytics-upload', 'studio-media', 'worlds-saveSnapshotToStudio', 'game-importWorldFrame', 'game-readAsset']);
  for (const channel of ['reply-audio', 'chat-changed']) assert.ok(WINDOW_EVENTS.includes(channel), channel);
  for (const channel of ['speak', 'transcribe', 'attach-bytes']) assert.ok(READS.includes(channel), `${channel} doesn’t make the mini’s window redraw`);
});

test('a recording may be big; anything else that says it carries bytes is refused', async () => {
  const calls: Array<{ channel: string; size: number | undefined }> = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async (channel, args) => { calls.push({ channel, size: (args[0] as Uint8Array | undefined)?.length }); return 'heard'; };
  try {
    const { token } = (await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } })).json;
    const big = encode([randomBytes(2 * 1024 * 1024), 'audio/webm']);
    const plain = await call(s.link, '/v1/face/call', { method: 'POST', key: s.key, body: { channel: 'transcribe', args: big }, headers: { 'X-Fairy-Window': token } });
    assert.ok(plain.status === 413 || plain.status === 0, 'without saying so, 2 MB is too big');
    const bytes = await call(s.link, '/v1/face/call', { method: 'POST', key: s.key, body: { channel: 'transcribe', args: big }, headers: { 'X-Fairy-Window': token, 'X-Fairy-Bytes': '1', 'X-Fairy-Channel': 'transcribe' } });
    assert.equal(bytes.status, 200);
    assert.equal(bytes.json.result, 'heard');
    assert.equal(calls[0].size, 2 * 1024 * 1024);
    const sneaky = await call(s.link, '/v1/face/call', { method: 'POST', key: s.key, body: { channel: 'state', args: [] }, headers: { 'X-Fairy-Window': token, 'X-Fairy-Bytes': '1', 'X-Fairy-Channel': 'transcribe' } });
    assert.equal(sneaky.status, 413);
  } finally { await s.done(); }
});

test('the face marks the calls that carry bytes', async () => {
  const sent: Array<{ path: string; headers?: Record<string, string> }> = [];
  const client = {
    async call(_method: string, path: string, options?: { headers?: Record<string, string> }) {
      sent.push({ path, ...options });
      return path === '/v1/face/window' ? { token: 't', expires: new Date(Date.now() + 3_600_000).toISOString() } : { result: 'ok' };
    },
  };
  const window = new FaceWindow({ client: client as unknown as ConstructorParameters<typeof FaceWindow>[0]['client'], confirm: async () => {}, approveKey: () => 'k' });
  await window.call('transcribe', [Buffer.from('rec'), 'audio/webm']);
  await window.call('state');
  const calls = sent.filter(item => item.path === '/v1/face/call');
  assert.equal(calls[0].headers!['X-Fairy-Bytes'], '1');
  assert.equal(calls[1].headers!['X-Fairy-Bytes'], undefined);
});

test('a file chosen on the MacBook is read there and added on the mini; one over 20 MB is refused before it’s read', async () => {
  const added: unknown[][] = [], read: string[] = [];
  const client = {
    async call(_method: string, path: string, options?: { body?: { args: unknown } }) {
      if (path === '/v1/face/window') return { token: 't', expires: new Date(Date.now() + 3_600_000).toISOString() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decoded = decode(options!.body!.args) as any;
      added.push(decoded); return { result: { id: 'a1', name: decoded[0] } };
    },
  };
  const window = new FaceWindow({ client: client as unknown as ConstructorParameters<typeof FaceWindow>[0]['client'], confirm: async () => {}, approveKey: () => 'k' });
  const sizes: Record<string, number> = { '/Users/me/notes.pdf': 1000, '/Users/me/huge.mov': ATTACH_MAX_BYTES + 1, '/Users/me/folder': -1 };
  const fs = { stat: async (path: string) => ({ size: Math.max(0, sizes[path]), isFile: () => sizes[path] >= 0 }), readFile: async (path: string) => { read.push(path); return Buffer.from('pdf bytes'); } };
  const result = await window.attachFiles(Object.keys(sizes), fs);
  assert.deepEqual(result.added, [{ id: 'a1', name: 'notes.pdf' }]);
  assert.deepEqual(result.failed.map(item => item.name), ['huge.mov', 'folder']);
  assert.match(result.failed[0].message, /over 20 MB/);
  assert.deepEqual(read, ['/Users/me/notes.pdf'], 'the big one was never read');
  assert.equal(added[0][0], 'notes.pdf');
  assert.ok(Buffer.isBuffer(added[0][1]));
  const many = await window.attachFiles(Array.from({ length: 14 }, (_, i) => `/f${i}.txt`), { stat: async () => ({ size: 1, isFile: () => true }), readFile: async () => Buffer.from('x') });
  assert.equal(many.added.length + many.failed.length, 10, 'ten at once');
});

test('the mini stays quiet for a turn asked from the MacBook, and its notifications reach the MacBook’s window', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /if \(channel === 'chat' && Array\.isArray\(args\) && typeof args\[3\] === 'string' && args\[3\]\)\s*(?:\{\s*)?remoteRequests\.add\(args\[3\]\);/);
  assert.match(main, /if \(!\(channel === 'fairy:reply-audio' && remoteRequests\.has\(args\[0\]\?\.requestId\)\) && !\(channel === 'fairy:notebook-voice' && notebookFrom === 'remote'\)\)\s*deliver\(channel, \.\.\.args\);/);
  assert.match(main, /if \(channel\.startsWith\('notebook-'\)\)\s*notebookFrom = 'remote';/);
  assert.match(main, /if \(channel\.startsWith\('notebook-'\)\)\s*notebookFrom = 'here';/);
  assert.match(main, /function workNotice\(title, body, session\) \{\n\s+faceLink\?\.notice\(\{ title, body \}\);/);
  assert.match(main, /function promiseNotice\(title, body, thread, id\) \{\n\s+faceLink\?\.notice\(\{ title, body \}\);/);
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /if \(type === 'notice'\) return void showNotice\((?:data|payload)/);
  // Links open in this Mac's browser, and only web links.
  assert.match(face, /fullWin\.webContents\.setWindowOpenHandler\(\(\{ url \}\) => \{ if \(\/\^https\?:\\\/\\\/\/i\.test\(url\)\) void shell\.openExternal\(url\); return \{ action: 'deny' \}; \}\);/);
});

test('a notification goes to the face only while its window is open', () => {
  const written: string[] = [];
  const face = new FaceLink({ ask: async () => ({ text: '' }) });
  face.stream = { response: { write: (chunk: string) => { written.push(chunk); return true; } } } as unknown as FaceLink['stream'];
  face.notice({ title: 'Fairy needs your OK', body: 'Run the tests?' });
  assert.equal(written.length, 0);
  face.window = { token: 't', device: 'd', expires: Date.now() + 1000, seq: 0, queue: [], timer: null };
  face.notice({ title: 'Fairy needs your OK', body: 'Run the tests?' });
  face.notice({ body: 'no title' });
  assert.equal(written.length, 1);
  assert.match(written[0], /event: notice\ndata: \{"title":"Fairy needs your OK","body":"Run the tests\?"\}/);
});
