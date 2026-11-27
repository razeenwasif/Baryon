// A full Fairy's phone link with a face paired to it over real TLS, for the two-Macs tests: setup(ask) pairs a Mac,
// call() makes a request with its key, and events() follows its event stream.
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventParser } from '../../desktop/face-client.mjs';
import { FaceLink } from '../../desktop/face-link.mjs';
import { PhoneLink, makeCertificate } from '../../desktop/phone-link.mjs';

export const NAME = 'mini.example.ts.net', PNG = Buffer.from('a picture').toString('base64');
let shared;
const certificate = async options => { shared ??= await makeCertificate(options); return shared; };
export const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(resolve => setTimeout(resolve, 10)); } };

export async function setup(ask) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-pair-'));
  const face = new FaceLink({ ask, name: () => 'Fairy' });
  const link = new PhoneLink({ path: join(dir, 'phone-link.json'), port: 0, every: 1e7, certificate, accepts: () => true, address: () => '127.0.0.1', name: async () => NAME, reach: async () => 'open',
    overview: () => ({ chats: [], approvals: [] }), chat: async id => ({ id }), answer: () => {}, face });
  await link.start(); await link.setEnabled(true);
  const { url } = link.pair({ kind: 'mac' }), code = new URL(url).searchParams.get('code');
  const paired = (await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'MacBook', kind: 'mac' } })).json, key = paired.readKey;
  return { link, face, key, approveKey: paired.approveKey, done: async () => { await link.stop(); await rm(dir, { recursive: true, force: true }); } };
}
export function call(link, path, { method = 'GET', key, body, raw, headers = {} } = {}) {
  const port = link.server.address().port;
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ host: '127.0.0.1', port, path, method, agent: false, rejectUnauthorized: false,
      headers: { Host: `${NAME}:${port}`, ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...headers } }, response => {
      const parts = []; response.on('data', part => parts.push(part));
      response.on('end', () => { const bytes = Buffer.concat(parts); let json = null; try { json = JSON.parse(bytes.toString()); } catch {} resolve({ status: response.statusCode, json, bytes, headers: response.headers }); });
    });
    request.on('error', error => resolve({ status: 0, error }));
    request.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}
export function events(link, key) {
  const port = link.server.address().port, list = [], parser = eventParser();
  const request = httpsRequest({ host: '127.0.0.1', port, path: '/v1/face/events', agent: false, rejectUnauthorized: false, headers: { Host: `${NAME}:${port}`, Authorization: `Bearer ${key}` } }, response => {
    response.setEncoding('utf8'); response.on('data', chunk => list.push(...parser.feed(chunk)));
  });
  request.on('error', () => {}); request.end();
  list.stop = () => request.destroy();
  return list;
}
