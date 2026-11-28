import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PhoneLink, makeCertificate, type PhoneCertificate } from '../desktop/phone-link.mjs';

const NAME = 'mac.example.ts.net';
let shared: PhoneCertificate | undefined;
const certificate = async (options: Parameters<typeof makeCertificate>[0]) => { shared ??= await makeCertificate(options); return shared; };

function call(link: PhoneLink, path: string, { method = 'GET', key, body }: { method?: string; key?: string; body?: unknown } = {}): Promise<{ status: number | undefined; json: () => any }> {
  const port = (link.server!.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: link.here!,
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
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

test('PhoneLink new routes require phone auth and Face ID approveKey on gated actions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-link-routes-'));
  const sentMessages: any[] = [], goalActions: any[] = [], neutrinoActions: any[] = [], briefCalls: any[] = [];
  const link = new PhoneLink({
    path: join(dir, 'phone-link.json'),
    port: 0,
    every: 1e7,
    accepts: () => true,
    address: () => '127.0.0.1',
    name: async () => NAME,
    reach: async () => 'open',
    certificate,
    overview: () => ({ chats: [], approvals: [] }),
    chat: async (id: string) => ({ id }),
    answer: () => {},
    send: async (payload: any) => { sentMessages.push(payload); return { chat: 'c1' }; },
    usage: async ({ force }: any) => ({ force, summary30: { totalTokens: 1200 }, plans: {} }),
    models: async () => ({ current: { provider: 'claude', model: 'claude-opus-5-5', effort: 'high' }, providers: [] }),
    briefRun: async (kind: any) => { briefCalls.push(kind); return { said: true, pushed: 1 }; },
    goals: {
      list: async () => ({ goals: [{ id: 'G1', outcome: 'Ship Baryon', state: 'active' }], open: 1, max: 5 }),
      get: async (id: string) => ({ id, outcome: 'Ship Baryon', state: 'active', steps: [] }),
      action: async (payload: any) => { goalActions.push(payload); return { id: payload.id, state: 'paused' }; },
    },
    research: {
      home: async () => ({ investigations: [{ slug: 'gem-rsi', title: 'GEM RSI' }] }),
      detail: async (slug: string) => ({ slug, title: 'GEM RSI', hypotheses: [], papers: [], runs: [], waiting: [], report: '' }),
    },
    neutrino: {
      inbox: async () => ({ waiting: [], ready: [], open: [{ repo: 'lyra', number: 12, title: 'Catch up' }], runs: [] }),
      pr: async ({ repo, number }: any) => ({ repo, number, title: 'Catch up' }),
      act: async (payload: any) => { neutrinoActions.push(payload); return { merged: true }; },
    },
    analytics: {
      overview: async () => ({ state: { datasetCount: 1, runCount: 1 }, datasets: [], runs: [] }),
      run: async (id: string) => ({ id, status: 'completed' }),
    },
    boards: {
      list: async () => ({ items: [{ id: 'brd-1', name: 'Architecture', elementCount: 3 }] }),
      get: async (id: string) => ({ meta: { id, name: 'Architecture' }, background: 'dots', elements: [] }),
    },
  } as any);
  await link.start();
  await link.setEnabled(true);

  const pairUrl = link.pair().url;
  const code = new URL(pairUrl).searchParams.get('code');
  const pairRes = await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'Izanagi' } });
  const { readKey, approveKey } = pairRes.json();

  assert.equal((await call(link, '/v1/usage?force=1', { key: readKey })).json().force, true);
  assert.equal((await call(link, '/v1/models', { key: readKey })).json().current.provider, 'claude');
  assert.equal((await call(link, '/v1/brief-run', { method: 'POST', key: readKey, body: { kind: 'brief' } })).json().pushed, 1);
  assert.deepEqual(briefCalls, ['brief']);

  await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'Hi', provider: 'antigravity', model: 'gemini-3.8-pro', effort: 'high' } });
  assert.equal(sentMessages[0].provider, 'antigravity');
  assert.equal(sentMessages[0].model, 'gemini-3.8-pro');

  assert.equal((await call(link, '/v1/goals', { key: readKey })).json().goals[0].id, 'G1');
  assert.equal((await call(link, '/v1/goal?id=G1', { key: readKey })).json().id, 'G1');
  // continue requires approveKey
  assert.equal((await call(link, '/v1/goal-action', { method: 'POST', key: readKey, body: { id: 'G1', action: 'continue' } })).status, 403);
  assert.equal((await call(link, '/v1/goal-action', { method: 'POST', key: readKey, body: { id: 'G1', action: 'continue', approveKey } })).status, 200);
  // pause does not require approveKey
  assert.equal((await call(link, '/v1/goal-action', { method: 'POST', key: readKey, body: { id: 'G1', action: 'pause' } })).status, 200);
  assert.equal(goalActions.length, 2);

  assert.equal((await call(link, '/v1/research', { key: readKey })).json().investigations[0].slug, 'gem-rsi');
  assert.equal((await call(link, '/v1/research-detail?slug=gem-rsi', { key: readKey })).json().slug, 'gem-rsi');

  assert.equal((await call(link, '/v1/neutrino', { key: readKey })).json().open[0].number, 12);
  assert.equal((await call(link, '/v1/neutrino-pr?repo=lyra&number=12', { key: readKey })).json().title, 'Catch up');
  assert.equal((await call(link, '/v1/neutrino-action', { method: 'POST', key: readKey, body: { action: 'merge', repo: 'lyra', number: 12 } })).status, 403);
  assert.equal((await call(link, '/v1/neutrino-action', { method: 'POST', key: readKey, body: { action: 'merge', repo: 'lyra', number: 12, approveKey } })).status, 200);

  assert.equal((await call(link, '/v1/analytics', { key: readKey })).json().state.datasetCount, 1);
  assert.equal((await call(link, '/v1/analytics-run?id=run-1', { key: readKey })).json().status, 'completed');
  assert.equal((await call(link, '/v1/boards', { key: readKey })).json().items[0].id, 'brd-1');
  assert.equal((await call(link, '/v1/board?id=brd-1', { key: readKey })).json().meta.name, 'Architecture');

  await link.stop();
  await rm(dir, { recursive: true, force: true });
});
