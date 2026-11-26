import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { phoneChat } from '../desktop/phone-access.mjs';
import { PhoneLink, makeCertificate } from '../desktop/phone-link.mjs';
import { phonePageFile, phonePages } from '../desktop/phone-pages.mjs';
import { PhoneTurns } from '../desktop/phone-turns.mjs';
import { WorkRuns } from '../desktop/work-runs.mjs';

const NAME = 'mac.example.ts.net';
let sharedCert;
const certificate = async options => {
  sharedCert ??= await makeCertificate(options);
  return sharedCert;
};

async function setupLink({ a2uiData, a2uiAction } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-a2ui-link-'));
  const path = join(dir, 'phone-link.json');
  const link = new PhoneLink({
    path,
    port: 0,
    every: 1e7,
    accepts: () => true,
    certificate,
    address: () => '127.0.0.1',
    name: async () => NAME,
    reach: async () => 'open',
    overview: () => ({ chats: [], approvals: [] }),
    chat: async id => ({ id }),
    face: { handle: async () => {} },
    answer: () => {},
    a2uiData,
    a2uiAction,
  });
  await link.start();
  await link.setEnabled(true);
  const done = async () => {
    await link.stop();
    await rm(dir, { recursive: true, force: true });
  };
  return { link, done };
}

function call(link, path, { method = 'GET', key, body } = {}) {
  const port = link.server.address().port;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: link.here,
        port,
        path,
        method,
        agent: false,
        rejectUnauthorized: false,
        headers: {
          Host: `${NAME}:${port}`,
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', part => { text += part; });
        res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

async function pairDevice(link, kind = 'phone') {
  const pairing = link.pair(kind === 'mac' ? { kind: 'mac' } : undefined);
  const code = new URL(pairing.url).searchParams.get('code');
  const res = await call(link, '/v1/pair', {
    method: 'POST',
    body: { code, name: kind === 'mac' ? 'MacBook' : 'iPhone', kind },
  });
  assert.equal(res.status, 200);
  return res.json();
}

const SAMPLE_SURFACE = {
  surfaceId: 'calc-1',
  title: 'Loan Calculator',
  root: 'root',
  components: [
    { id: 'root', component: 'Column', children: ['amt', 'go'] },
    { id: 'amt', component: 'Slider', label: 'Principal', min: 1000, max: 50000, value: { path: '/principal' } },
    { id: 'go', component: 'Button', label: 'Calculate', action: { event: { name: 'calculate', context: { p: { path: '/principal' } } } } },
  ],
  dataModel: { principal: 10000 },
};

test('phoneChat serializes a2ui surfaces on messages and live work snapshots', () => {
  const runs = new WorkRuns();
  const run = runs.start({ session: 'c1', root: '/tmp/proj', at: '2026-01-01T00:00:00.000Z', request: 'hi' });
  runs.emit(run, { type: 'a2ui', surfaces: [SAMPLE_SURFACE] });
  const snap = runs.snapshot('c1');
  assert.equal(snap.a2ui.length, 1);

  const payload = phoneChat(
    { id: 'c1', title: 'Calc Chat' },
    [
      { role: 'user', content: '/ui loan calculator', at: 't1' },
      { role: 'assistant', content: 'Here is a calculator.', at: 't2', a2ui: [SAMPLE_SURFACE] },
    ],
    snap,
    'working',
  );
  assert.equal(payload.messages[0].a2ui, undefined);
  assert.equal(payload.messages[1].a2ui.length, 1);
  assert.equal(payload.messages[1].a2ui[0].surfaceId, 'calc-1');
  assert.equal(payload.live.a2ui.length, 1);
  assert.equal(payload.live.a2ui[0].dataModel.principal, 10000);
});

test('PhoneTurns persists structured { text, a2ui } replies in session history', async () => {
  const saved = [];
  const turns = new PhoneTurns({
    list: () => [{ id: 'c1', title: 'Test', work: null }],
    read: async () => [],
    append: async (_id, entries) => { saved.push(...entries); },
    addChat: async () => 'c1',
    reply: async () => ({ text: 'Interactive UI ready.', a2ui: [SAMPLE_SURFACE] }),
  });

  await turns.send({ chat: 'c1', text: '/ui make calc' });
  await new Promise(resolve => setTimeout(resolve, 40));

  const assistantEntry = saved.find(e => e.role === 'assistant');
  assert.ok(assistantEntry);
  assert.equal(assistantEntry.content, 'Interactive UI ready.');
  assert.equal(assistantEntry.a2ui.length, 1);
  assert.equal(assistantEntry.a2ui[0].surfaceId, 'calc-1');
});

test('PhoneLink /v1/a2ui-data and /v1/a2ui-action validate inputs, forward payloads, and block paired Macs', async () => {
  const dataCalls = [];
  const actionCalls = [];
  const { link, done } = await setupLink({
    a2uiData: async payload => {
      dataCalls.push(payload);
      return { ok: true, surfaces: [SAMPLE_SURFACE] };
    },
    a2uiAction: async payload => {
      actionCalls.push(payload);
      return { ok: true, chat: payload.chat || 'c-new' };
    },
  });

  try {
    const phone = await pairDevice(link, 'phone');
    const mac = await pairDevice(link, 'mac');

    const badData = await call(link, '/v1/a2ui-data', {
      method: 'POST',
      key: phone.readKey,
      body: { chat: '', surfaceId: 'calc-1' },
    });
    assert.equal(badData.status, 400);

    const okData = await call(link, '/v1/a2ui-data', {
      method: 'POST',
      key: phone.readKey,
      body: { chat: 'c1', messageAt: 't2', surfaceId: 'calc-1', path: '/principal', value: 25000 },
    });
    assert.equal(okData.status, 200);
    assert.equal(okData.json().ok, true);
    assert.equal(dataCalls[0].value, 25000);

    const bigContext = { blob: 'x'.repeat(17000) };
    const badAction = await call(link, '/v1/a2ui-action', {
      method: 'POST',
      key: phone.readKey,
      body: { chat: 'c1', surfaceId: 'calc-1', actionName: 'calculate', context: bigContext },
    });
    assert.equal(badAction.status, 400);

    const okAction = await call(link, '/v1/a2ui-action', {
      method: 'POST',
      key: phone.readKey,
      body: { chat: 'c1', surfaceId: 'calc-1', title: 'Loan Calculator', actionName: 'calculate', sourceComponentId: 'go', context: { p: 25000 } },
    });
    assert.equal(okAction.status, 200);
    assert.equal(okAction.json().chat, 'c1');
    assert.equal(actionCalls[0].actionName, 'calculate');
    assert.deepEqual(actionCalls[0].context, { p: 25000 });

    const macBlocked = await call(link, '/v1/a2ui-action', {
      method: 'POST',
      key: mac.readKey,
      body: { chat: 'c1', surfaceId: 'calc-1', actionName: 'calculate' },
    });
    assert.equal(macBlocked.status, 403);
  } finally {
    await done();
  }
});

test('phonePages opens a2ui artifacts and phonePageFile serves surface.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-a2ui-pages-'));
  try {
    let savedIndex = null;
    const store = new ArtifactStore({
      dir,
      readJSON: async () => savedIndex,
      writeJSON: async (_path, value) => { savedIndex = value; },
      trash: async () => {},
    });
    await store.load();
    const published = await store.publish({
      kind: 'a2ui',
      title: 'Loan Calculator',
      description: 'Interactive A2UI page',
      entry: 'index.html',
      files: {
        'index.html': '<!doctype html><html><body>A2UI</body></html>',
        'surface.json': JSON.stringify(SAMPLE_SURFACE),
      },
    });

    const list = phonePages(store.state());
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'a2ui');
    assert.equal(list[0].opens, true);

    const served = await phonePageFile(store, { id: published.id, seq: 1, path: 'surface.json' });
    assert.equal(served.status, 200);
    assert.match(served.headers['Content-Type'], /application\/json/);
    const decoded = JSON.parse(Buffer.from(served.body).toString('utf8'));
    assert.equal(decoded.surfaceId, 'calc-1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
