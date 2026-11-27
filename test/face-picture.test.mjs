import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { eventParser } from '../desktop/face-client.mjs';
import { FaceLink } from '../desktop/face-link.mjs';
import { PhoneLink, makeCertificate } from '../desktop/phone-link.mjs';

const NAME = 'mini.example.ts.net', PNG = Buffer.from('a picture').toString('base64');
let shared;
const certificate = async options => { shared ??= await makeCertificate(options); return shared; };
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(resolve => setTimeout(resolve, 10)); } };

async function setup(ask) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-picture-'));
  const face = new FaceLink({ ask, name: () => 'Fairy' });
  const link = new PhoneLink({ path: join(dir, 'phone-link.json'), port: 0, every: 1e7, certificate, accepts: () => true, address: () => '127.0.0.1', name: async () => NAME, reach: async () => 'open',
    overview: () => ({ chats: [], approvals: [] }), chat: async id => ({ id }), answer: () => {}, face });
  await link.start(); await link.setEnabled(true);
  const { url } = link.pair({ kind: 'mac' }), code = new URL(url).searchParams.get('code');
  const key = (await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'MacBook', kind: 'mac' } })).json.readKey;
  return { link, face, key, done: async () => { await link.stop(); await rm(dir, { recursive: true, force: true }); } };
}
function call(link, path, { method = 'GET', key, body, raw } = {}) {
  const port = link.server.address().port;
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ host: '127.0.0.1', port, path, method, agent: false, rejectUnauthorized: false,
      headers: { Host: `${NAME}:${port}`, ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' } }, response => {
      const parts = []; response.on('data', part => parts.push(part));
      response.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(parts).toString()); } catch {} resolve({ status: response.statusCode, json }); });
    });
    request.on('error', error => resolve({ status: 0, error }));
    request.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}
function events(link, key) {
  const port = link.server.address().port, list = [], parser = eventParser();
  const request = httpsRequest({ host: '127.0.0.1', port, path: '/v1/face/events', agent: false, rejectUnauthorized: false, headers: { Host: `${NAME}:${port}`, Authorization: `Bearer ${key}` } }, response => {
    response.setEncoding('utf8'); response.on('data', chunk => list.push(...parser.feed(chunk)));
  });
  request.on('error', () => {}); request.end();
  list.stop = () => request.destroy();
  return list;
}

test('during the face’s own turn the mini gets one picture of its screen, with what it says', async () => {
  let face;
  const s = await setup(async () => { const shot = await face.picture('explain'); return { text: `${shot.width}x${shot.height} at ${shot.bounds.x} with ${shot.read.lines.length} line` }; });
  face = s.face;
  try {
    const stream = events(s.link, s.key);
    await until(() => stream.length >= 1);
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'what is this?' } });
    await until(() => stream.some(event => event.type === 'want-picture'));
    const asked = stream.find(event => event.type === 'want-picture').data;
    assert.equal(asked.purpose, 'explain');
    const sent = await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id: asked.id, png: PNG, width: 10, height: 20, bounds: { x: 0, y: 0, width: 1512, height: 982 }, read: { lines: [{ text: 'hello' }] } } });
    assert.equal(sent.status, 200);
    await until(() => stream.some(event => event.type === 'done'));
    assert.equal(stream.find(event => event.type === 'done').data.text, '10x20 at 0 with 1 line');
    // The same id can't be answered twice.
    assert.equal((await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id: asked.id, refused: true } })).status, 409);
    stream.stop();
  } finally { await s.done(); }
});

test('a refusal, or no turn of the face’s, means no picture; a stray or oversized answer is refused', async () => {
  let face;
  const s = await setup(async () => { await face.picture('look'); return { text: 'no' }; });
  face = s.face;
  try {
    await assert.rejects(face.picture('look'), /isn’t sharing its screen/, 'no stream and no turn');
    const stream = events(s.link, s.key);
    await until(() => stream.length >= 1);
    await assert.rejects(face.picture('look'), /isn’t sharing its screen/, 'no turn of the face’s');
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'look' } });
    await until(() => stream.some(event => event.type === 'want-picture'));
    const { id } = stream.find(event => event.type === 'want-picture').data;
    await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id, refused: true, reason: 'permission' } });
    await until(() => stream.some(event => event.type === 'failed'));
    assert.match(stream.find(event => event.type === 'failed').data.message, /Screen & System Audio Recording/, 'the refusal says why');
    assert.equal((await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, body: { id: 'made-up', png: PNG, width: 1, height: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } } })).status, 409);
    const big = await call(s.link, '/v1/face/picture', { method: 'POST', key: s.key, raw: `{"id":"x","png":"${'A'.repeat(21 * 1024 * 1024)}"}` });
    assert.ok(big.status === 413 || big.status === 0, `${big.status}`);
    stream.stop();
  } finally { await s.done(); }
});

test('the mini gives up after 30 seconds of silence, saying so, and the face link writes nothing to disk', async () => {
  const waits = [];
  const face = new FaceLink({ ask: async () => ({ text: '' }), timers: { setTimeout: (run, ms) => { waits.push({ run, ms }); return waits.length; }, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  face.stream = { response: { write() {} } }; face.turn = { running: true };
  const asked = face.picture('look');
  assert.equal(waits[0].ms, 30000);
  waits[0].run();
  await assert.rejects(asked, /took too long/);
  const source = await readFile(new URL('../desktop/face-link.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:fs|writeFile|createWriteStream/.test(source));
});

test('the face asks before sharing: off by default, a menu switch, and its own checks', async () => {
  const { faceTrayTemplate } = await import('../desktop/presence.mjs');
  assert.equal(faceTrayTemplate({ link: 'connected' }).find(item => item.id === 'screen').checked, false);
  assert.ok(!faceTrayTemplate({ link: 'unpaired' }).some(item => item.id === 'screen'));
  const main = await readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8');
  // Each of the face's own checks refuses with its reason, before any picture is taken.
  assert.match(main, /if \(!store\.state\(\)\.screen\) return refuse\('off'\);\n\s+if \(faceLocked\) return refuse\('locked'\);\n\s+if \(now - lastPictureAt < 500\) return refuse\('busy'\);\n\s+if \(systemPreferences\.getMediaAccessStatus\('screen'\) !== 'granted'\) return refuse\('permission'\);/);
  const answering = main.slice(main.indexOf('async function answerPicture('), main.indexOf('function hush()'));
  assert.ok(answering.indexOf("return refuse('permission')") < answering.indexOf('screenHelper.capture('));
});
