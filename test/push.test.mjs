import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createDecipheriv, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { Pusher, inQuietHours, providerToken, pushPayload, readAuthKey, sealFor } from '../desktop/push.mjs';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).trim();
const KEY = randomBytes(32).toString('base64');
const open = (key, sealed) => {
  const bytes = Buffer.from(sealed, 'base64'), decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString('utf8'));
};

test('an APNs key is read from Apple’s file, with its Key ID from the name', () => {
  assert.deepEqual(readAuthKey({ pem: PEM, fileName: '/Users/me/Downloads/AuthKey_ABCDE12345.p8', teamId: 'TEAM123456' }), { pem: PEM, keyId: 'ABCDE12345', teamId: 'TEAM123456' });
  assert.throws(() => readAuthKey({ pem: 'not a key', fileName: 'AuthKey_ABCDE12345.p8', teamId: 'TEAM123456' }), /isn’t an APNs key/);
  assert.throws(() => readAuthKey({ pem: PEM, fileName: 'key.p8', teamId: 'TEAM123456' }), /Key ID/);
  assert.throws(() => readAuthKey({ pem: PEM, fileName: 'AuthKey_ABCDE12345.p8', teamId: '' }), /Team ID/);
});

test('the token Apple wants is signed with the key, and names the key and team', () => {
  const token = providerToken({ pem: PEM, keyId: 'ABCDE12345', teamId: 'TEAM123456' }, 1_700_000_000_000);
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'ABCDE12345' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: 'TEAM123456', iat: 1_700_000_000 });
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('what a push says is sealed for the phone, so Apple sees only Fairy’s name', () => {
  const payload = pushPayload({ key: KEY, title: 'Your flight moved', body: 'BA 16 now leaves at 9:40.', kind: 'chat', chat: 'c1' });
  const text = JSON.stringify(payload);
  assert.ok(!text.includes('flight') && !text.includes('BA 16'));
  assert.equal(payload.aps['mutable-content'], 1);
  assert.deepEqual(open(KEY, payload.sealed), { title: 'Your flight moved', body: 'BA 16 now leaves at 9:40.', kind: 'chat', chat: 'c1' });
  assert.equal(pushPayload({ key: KEY, title: 'x', body: 'y', kind: 'ask', id: 'a1' }).aps.alert.body, 'Needs your OK');
  assert.deepEqual(open(KEY, pushPayload({ key: KEY, title: 'Needs your OK', body: 'Run the tests', kind: 'ask', id: 'a1', allow: false }).sealed), { title: 'Needs your OK', body: 'Run the tests', kind: 'ask', id: 'a1', allow: 'no' }, 'a step only the Mac may allow says so');
  assert.deepEqual(open(KEY, pushPayload({ key: KEY, title: 'You said you’d do this', body: 'Call Mum', chat: 'c1', promise: 'p1' }).sealed), { title: 'You said you’d do this', body: 'Call Mum', kind: 'chat', chat: 'c1', promise: 'p1' }, 'a reminder carries its promise, for Done');
  assert.ok(Buffer.byteLength(JSON.stringify(pushPayload({ key: KEY, title: 'x', body: 'y'.repeat(20000) }))) < 4096, 'long words are cut to fit');
  assert.throws(() => sealFor('short', {}), /push key/);
});

function fakeApple(answers) {
  const asked = [], opened = [];
  const session = Object.assign(new EventEmitter(), { closed: false, destroyed: false, close() { this.closed = true; },
    request(headers) {
      const stream = Object.assign(new EventEmitter(), { setEncoding() {}, setTimeout() {}, close() {}, end(body) {
        asked.push({ headers, body: JSON.parse(body) });
        const [status, reply] = answers.shift() ?? [200, ''];
        setImmediate(() => { stream.emit('response', { ':status': status }); if (reply) stream.emit('data', reply); stream.emit('end'); });
      } });
      return stream;
    } });
  return { asked, opened, open: host => { opened.push(host); return session; } };
}

test('pushes go to the right Apple host with the token, topic and collapse id', async () => {
  const apple = fakeApple([[200, ''], [410, JSON.stringify({ reason: 'Unregistered' })]]);
  const pusher = new Pusher({ credentials: () => ({ pem: PEM, keyId: 'ABCDE12345', teamId: 'TEAM123456' }), open: apple.open });
  const payload = pushPayload({ key: KEY, title: 't', body: 'b' });
  assert.deepEqual(await pusher.send({ token: 'abc', environment: 'development', payload, collapse: 'ask-1' }), { ok: true });
  assert.deepEqual(await pusher.send({ token: 'gone', environment: 'development', payload }), { ok: false, status: 410, reason: 'Unregistered' });
  assert.deepEqual(apple.opened, ['https://api.sandbox.push.apple.com'], 'one connection, kept for the next push');
  const headers = apple.asked[0].headers;
  assert.equal(headers[':path'], '/3/device/abc');
  assert.equal(headers['apns-topic'], 'dev.razeen.fairy');
  assert.equal(headers['apns-collapse-id'], 'ask-1');
  assert.match(headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  pusher.close();
});

test('without an APNs key nothing is sent, and the reason says where to add one', () => {
  const pusher = new Pusher({ credentials: () => null, open: () => { throw new Error('should not connect'); } });
  assert.throws(() => pusher.bearer(), /Settings, under Phone/);
});

test('quiet hours can run past midnight', () => {
  const at = (h, m = 0) => new Date(2026, 10, 11, h, m);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(23)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(6, 59)), true);
  assert.equal(inQuietHours({ from: '22:00', to: '07:00' }, at(7)), false);
  assert.equal(inQuietHours({ from: '13:00', to: '14:00' }, at(13, 30)), true);
  assert.equal(inQuietHours({ from: '', to: '' }, at(3)), false);
});
