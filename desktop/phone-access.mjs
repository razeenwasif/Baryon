import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { atomicJSON } from './json-store.mjs';
import { noteHeading } from '../src/note-heading.js';

export const PHONE_PORT = 47615;
const PAIR_LIFETIME = 5 * 60 * 1000, PAIR_TRIES = 5, MAX_BODY = 8 * 1024, MAX_APPROVAL = 256 * 1024, MAX_CHATS = 30, MAX_MESSAGES = 12, MAX_MESSAGE = 6000, MAX_ROWS = 30, MAX_LIVE_TEXT = 8000;
const COOKIE = 'fairy_phone', COOKIE_LIFETIME = 365 * 24 * 60 * 60;
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
};
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/phone.js': ['phone.js', 'text/javascript; charset=utf-8'], '/phone.css': ['phone.css', 'text/css; charset=utf-8'] };

export const hashed = text => createHash('sha256').update(text).digest();
export const sameText = (a, b) => timingSafeEqual(hashed(a), hashed(b));
const number = address => address.split('.').reduce((total, part) => (total * 256 + Number(part)) >>> 0, 0);
const plainAddress = address => String(address ?? '').replace(/^::ffff:/, '');
export const isPrivate = address => isIPv4(address) && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);
export function inSubnet(address, { address: own, netmask }) {
  const plain = plainAddress(address);
  return isIPv4(plain) && (number(plain) & number(netmask)) >>> 0 === (number(own) & number(netmask)) >>> 0;
}
const run = (command, args) => new Promise(resolve => execFile(command, args, { timeout: 3000 }, (error, stdout) => resolve(error ? '' : String(stdout))));
// Wi-Fi and Ethernet only, so a VPN or a virtual machine's network can never count as home.
// macOS doesn't tell an app the router's hardware address or the Wi-Fi's name without asking for more
// permissions, so a network is known by its router's address and its range. Another network set up
// exactly the same way would count as home, and a stranger there still couldn't get past pairing.
export async function currentNetworks({ interfaces = networkInterfaces, command = run } = {}) {
  const found = [];
  for (const [name, entries] of Object.entries(interfaces())) {
    if (!/^en\d+$/.test(name)) continue;
    const entry = entries.find(item => item.family === 'IPv4' && !item.internal && isPrivate(item.address));
    if (!entry) continue;
    const gateway = (await command('/usr/sbin/ipconfig', ['getoption', name, 'router'])).trim();
    if (!isIPv4(gateway)) continue;
    found.push({ name, address: entry.address, netmask: entry.netmask, gateway });
  }
  return found;
}
// The Mac's firewall stands between this server and its own network address too, so asking there shows
// what a phone would get. It holds a connection while macOS asks about it, and drops one it has refused.
export function reachable({ address, port, timeout = 4000 }) {
  return new Promise(resolve => {
    const request = httpRequest({ host: address, port, path: '/phone.css', agent: false, timeout, headers: { Host: `${address}:${port}` } }, response => { response.resume(); resolve('open'); });
    request.on('timeout', () => { resolve('waiting'); request.destroy(); });
    request.on('error', () => resolve('blocked'));
    request.end();
  });
}
const sameNetwork = (a, b) => a.gateway === b.gateway && a.netmask === b.netmask;
const deviceName = agent => /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android phone' : 'Phone';
const cookieValue = header => String(header ?? '').split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';

// What a phone is shown. Asking to approve something it can't show in full would be asking blind.
export function phoneApproval(request, chat) {
  const { id, kind, title, detail, command, plan, diff, note } = request, shown = { id, kind, title, chat: chat.title, session: chat.id,
    ...(typeof request.allowLabel === 'string' ? { allowLabel: request.allowLabel.slice(0, 40) } : {}), ...(typeof request.denyLabel === 'string' ? { denyLabel: request.denyLabel.slice(0, 40) } : {}) };
  // A key that crosses the network in plain text must never be able to run something with the user's full access.
  const full = { ...shown, detail, command, plan, diff, note, ...(/^(?:outside|computer|screen|browser:)/.test(kind) ? { macOnly: true } : {}) };
  return JSON.stringify(full).length > MAX_APPROVAL ? { ...shown, tooBig: true } : full;
}
export function phoneOverview(state, snapshot) {
  const running = state.running ?? {}, active = id => (running[id] ? 1 : 0);
  const titles = new Map(state.sessions.map(chat => [chat.id, chat.title]));
  // Each task with what the phone's Tasks tab shows: its plan's progress, the step it's on, the session that started it,
  // and when you marked it done.
  const chats = state.sessions.filter(chat => chat.work || running[chat.id]).sort((a, b) => active(b.id) - active(a.id) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_CHATS)
    .map(({ id, title, updatedAt, work, done, parent }) => {
      const live = snapshot(id), tasks = live?.tasks ?? [], step = [...(live?.rows ?? [])].reverse().find(row => row.status === 'running' || row.status === 'waiting');
      return { id, title, updatedAt, folder: work, state: running[id] ?? 'idle', ...(done ? { done } : {}), ...(parent && titles.has(parent) ? { parent: titles.get(parent) } : {}),
        ...(tasks.length ? { progress: { done: tasks.filter(task => task.status === 'done' || task.status === 'completed').length, total: tasks.length } } : {}),
        ...(step?.summary ? { doing: String(step.summary).slice(0, 160) } : {}) };
    });
  const approvals = state.sessions.filter(chat => running[chat.id] === 'waiting').flatMap(chat => (snapshot(chat.id)?.approvals ?? []).map(request => phoneApproval(request, chat)));
  return { chats, approvals };
}
const lastPart = (text, limit) => text.length <= limit ? text : `…${text.slice(-limit)}`;
export function phoneChat(chat, history, live, state, limit = MAX_MESSAGES) {
  return { id: chat.id, title: chat.title, state,
    messages: history.filter(message => typeof message.content === 'string' && message.content && ['user', 'assistant'].includes(message.role)).slice(-limit).map(({ role, content, at, attachments, from, note, a2ui }) => ({ role, at,
      // A note from another session shows as what it says, with who sent it, rather than the framing its model reads.
      ...(from && typeof from === 'object' ? { text: lastPart(String(note?.text ?? content), MAX_MESSAGE), from: { title: String(from.title ?? ''), kind: String(from.kind ?? ''), ...(from.project ? { project: String(from.project) } : {}), heading: noteHeading({ from, note }) } } : { text: lastPart(content, MAX_MESSAGE) }),
      // What came with a message: names and sizes only.
      ...(Array.isArray(attachments) && attachments.length ? { attachments: attachments.slice(0, 10).map(({ name, size }) => ({ name: String(name ?? '').replace(/^Attached: /, ''), size: Number(size) || 0 })) } : {}),
      // Structured interactive A2UI surfaces generated alongside this reply.
      ...(Array.isArray(a2ui) && a2ui.length ? { a2ui } : {}) })),
    live: live ? { rows: live.rows.slice(-MAX_ROWS).map(({ id, tool, summary, status, detail }) => ({ id, tool, summary, status, detail })), tasks: live.tasks, text: lastPart(live.text ?? '', MAX_LIVE_TEXT),
      // Her thinking so far, when the model shares it: the end of it, as the reply's end.
      ...(live.thinking ? { thinking: lastPart(live.thinking, MAX_LIVE_TEXT) } : {}),
      ...(Array.isArray(live.thoughts) && live.thoughts.length ? { thoughts: live.thoughts.slice(-30).map(({ id, kind, text, status, durationMs }) => ({ id: String(id || ''), kind: String(kind || 'thinking'), text: lastPart(String(text || ''), 800), status: String(status || 'running'), ...(Number.isFinite(Number(durationMs)) ? { durationMs: Number(durationMs) } : {}) })) } : {}),
      ...(Array.isArray(live.a2ui) && live.a2ui.length ? { a2ui: live.a2ui } : {}) } : null };
}

// A small web server for one home network, off until you turn it on. It only listens on that network's address,
// closes on any other network, and every request needs the key a phone got by scanning a code on this Mac.
export class PhoneAccess {
  constructor({ path, overview, chat, answer, onChange = () => {}, onEvent = () => {}, networks = currentNetworks, reach = reachable, port = PHONE_PORT, now = Date.now, every = 30000, pages = new URL('./phone/', import.meta.url) }) {
    Object.assign(this, { path, overview, chat, answer, onChange, onEvent, networks, reach, port, now, every, pages });
    this.store = { enabled: false, home: null, devices: [] };
    this.server = null; this.here = null; this.pairing = null; this.problem = ''; this.onOtherNetwork = false; this.firewall = '';
    this.queue = Promise.resolve();
  }
  // One change to the server at a time, so a network check can't race turning it off.
  inTurn(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  save() { return atomicJSON(this.path, JSON.stringify(this.store, null, 2)); }
  async start() {
    try { const saved = JSON.parse(await readFile(this.path, 'utf8')); this.store = { enabled: saved.enabled === true, home: saved.home ?? null, devices: Array.isArray(saved.devices) ? saved.devices : [] }; }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Could not read the phone settings:', error.message); }
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), this.every);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); return this.inTurn(() => this.close()); }
  state() {
    const { enabled, home, devices } = this.store;
    return { enabled, listening: Boolean(this.server), address: this.server ? `http://${this.host()}` : '', router: home?.gateway ?? '', onOtherNetwork: this.onOtherNetwork, problem: this.problem, firewall: this.firewall,
      pairing: Boolean(this.pairing && this.pairing.expires > this.now()), devices: devices.map(({ id, name, paired, lastSeen }) => ({ id, name, paired, lastSeen })) };
  }
  host() { return `${this.here.address}:${this.server.address().port}`; }
  async setEnabled(on) {
    await this.inTurn(async () => {
      if (!on) { await this.close(); this.store.enabled = false; this.store.home = null; await this.save(); return; }
      const [network] = await this.networks();
      if (!network) throw new Error('Fairy couldn’t find your router. Check this Mac is on your home network, not a VPN alone.');
      await this.close();
      await this.listen(network);
      this.store.enabled = true; this.store.home = { gateway: network.gateway, netmask: network.netmask };
      await this.save();
    });
    this.onOtherNetwork = false; this.problem = '';
    this.onChange();
    this.checkFirewall();
    return this.state();
  }
  // Not waited for, as macOS can leave its question up for as long as it likes.
  async checkFirewall() {
    const { server, here } = this;
    if (!server) return;
    const result = await this.reach({ address: here.address, port: server.address().port });
    if (this.server !== server || result === this.firewall) return;
    this.firewall = result;
    this.onChange();
  }
  // Follows the Mac from network to network, and only ever opens on the one you chose.
  refresh() {
    return this.inTurn(async () => {
      const before = JSON.stringify(this.state());
      if (this.store.enabled && this.store.home) {
        const network = (await this.networks()).find(item => sameNetwork(item, this.store.home));
        this.onOtherNetwork = !network;
        if (!network) await this.close();
        else if (!this.server || this.here.address !== network.address) {
          await this.close();
          try { await this.listen(network); this.problem = ''; }
          catch (error) { this.problem = error.message; }
        }
      }
      if (JSON.stringify(this.state()) !== before) this.onChange();
      this.checkFirewall();
    }).catch(error => console.warn('Could not check the network:', error.message));
  }
  listen(network) {
    return new Promise((resolve, reject) => {
      const server = createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => this.receive(request, response));
      Object.assign(server, { headersTimeout: 5000, requestTimeout: 10000, keepAliveTimeout: 5000, maxConnections: 32 });
      server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Another app is using port ${this.port}, which phone access needs.` : `Phone access couldn’t start: ${error.message}`)));
      server.listen(this.port, network.address, () => {
        server.removeAllListeners('error');
        server.on('error', error => console.warn('Phone access:', error.message));
        this.server = server; this.here = network;
        resolve();
      });
    });
  }
  async close() {
    const server = this.server;
    this.server = null; this.here = null; this.pairing = null; this.firewall = '';
    if (!server) return;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  // The code travels in the part of the address browsers don't send, and it works once.
  pair() {
    if (!this.server) throw new Error('Turn on phone access first.');
    const code = randomBytes(16).toString('base64url');
    this.pairing = { code, expires: this.now() + PAIR_LIFETIME, tries: 0 };
    return { url: `http://${this.host()}/#pair=${code}`, minutes: PAIR_LIFETIME / 60000 };
  }
  async forget(id) {
    await this.inTurn(async () => { this.store.devices = this.store.devices.filter(device => device.id !== id); await this.save(); });
    this.onEvent({ type: 'removed' });
    this.onChange();
    return this.state();
  }
  device(request) {
    const key = cookieValue(request.headers.cookie);
    if (!key) return null;
    const hash = hashed(key).toString('hex');
    return this.store.devices.find(device => device.hash === hash) ?? null;
  }
  send(response, status, value, extra = {}) {
    const body = JSON.stringify(value);
    response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extra });
    response.end(body);
  }
  body(request) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      request.on('data', part => {
        size += part.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('Too long.'), { status: 413 })); request.destroy(); return; }
        parts.push(part);
      });
      request.on('error', reject);
      request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(Object.assign(new Error('Not understood.'), { status: 400 })); } });
    });
  }
  async receive(request, response) {
    const here = this.here;
    // Nothing at all for anything outside this network.
    if (!here || !inSubnet(request.socket.remoteAddress, here)) { request.socket.destroy(); return; }
    // Another address pointing here is how a web page elsewhere would try to reach this server.
    const host = this.host();
    if (request.headers.host !== host) return this.send(response, 421, { error: 'Wrong address.' });
    try {
      const { pathname, searchParams } = new URL(request.url, `http://${host}`);
      if (request.method === 'POST' && (request.headers.origin !== `http://${host}` || !String(request.headers['content-type']).startsWith('application/json'))) return this.send(response, 403, { error: 'Refused.' });
      if (request.method === 'GET' && FILES[pathname]) return await this.page(response, pathname);
      if (request.method === 'POST' && pathname === '/api/pair') return await this.takeCode(request, response);
      if (!['/api/overview', '/api/chat', '/api/answer'].includes(pathname)) return this.send(response, 404, { error: 'Not found.' });
      const device = this.device(request);
      if (!device) return this.send(response, 401, { error: 'This phone isn’t paired.' });
      device.lastSeen = new Date(this.now()).toISOString();
      if (request.method === 'GET' && pathname === '/api/overview') return this.send(response, 200, this.overview());
      if (request.method === 'GET' && pathname === '/api/chat') return this.send(response, 200, await this.chat(searchParams.get('id')));
      if (request.method === 'POST' && pathname === '/api/answer') return await this.takeAnswer(request, response, device);
      return this.send(response, 405, { error: 'Not allowed.' });
    } catch (error) {
      if (!response.headersSent) this.send(response, error.status ?? 500, { error: error.status ? error.message : 'Something went wrong on the Mac.' });
      else response.destroy();
    }
  }
  async page(response, pathname) {
    const [name, type] = FILES[pathname], body = await readFile(new URL(name, this.pages));
    response.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Content-Length': body.length });
    response.end(body);
  }
  async takeCode(request, response) {
    const { code } = await this.body(request), pairing = this.pairing;
    if (!pairing || pairing.expires <= this.now()) return this.send(response, 403, { error: 'That code has run out. Make a new one on the Mac.' });
    if (typeof code !== 'string' || !sameText(code, pairing.code)) {
      if (++pairing.tries >= PAIR_TRIES) this.pairing = null;
      this.onEvent({ type: 'wrong-code' });
      return this.send(response, 403, { error: 'That code isn’t right. Make a new one on the Mac.' });
    }
    this.pairing = null;
    const key = randomBytes(32).toString('base64url'), at = new Date(this.now()).toISOString();
    const device = { id: randomUUID(), name: deviceName(String(request.headers['user-agent'])), hash: hashed(key).toString('hex'), paired: at, lastSeen: at };
    this.store.devices.push(device);
    await this.save();
    this.onEvent({ type: 'paired', device: device.name });
    this.onChange();
    this.send(response, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_LIFETIME}` });
  }
  // Yes or no for this one step. Trusting a whole chat stays on the Mac.
  async takeAnswer(request, response, device) {
    const { id, decision } = await this.body(request);
    if (decision !== 'allow' && decision !== 'deny') return this.send(response, 400, { error: 'Unknown answer.' });
    const waiting = this.overview().approvals.find(item => item.id === id);
    if (!waiting) return this.send(response, 409, { error: 'That question has already been answered.' });
    if (waiting.tooBig && decision === 'allow') return this.send(response, 409, { error: 'This one is too long to show on a phone. Answer it on the Mac.' });
    if (waiting.macOnly && decision === 'allow') return this.send(response, 409, { error: 'This one can only be allowed on the Mac.' });
    this.answer(id, decision);
    this.onEvent({ type: 'answered', device: device.name, decision, title: waiting.title, chat: waiting.chat });
    await this.save();
    this.send(response, 200, { ok: true });
  }
}
