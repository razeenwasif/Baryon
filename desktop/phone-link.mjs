import { execFile } from 'node:child_process';
import { X509Certificate, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpsRequest } from 'node:https';
import { isIPv4 } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJSON } from './json-store.mjs';
import { hashed, sameText } from './phone-access.mjs';

export const LINK_PORT = 47616;
const CLOSE_WAIT_MS = 2000;
// What a Mac paired as a face may ask of the phone's requests, for its chats window: read chats and the questions
// waiting, follow them live, send and stop a reply (as a phone's: plain conversation, Gmail or Calendar), start Home's
// thread, answer a question, and leave. Not push, the microphone flag, music requests, attachments, starting work, ticking
// things off or deleting.
export const MAC_ROUTES = new Set(['/v1/overview', '/v1/chats', '/v1/chat', '/v1/events', '/v1/send', '/v1/stop', '/v1/thread', '/v1/answer', '/v1/leave', '/v1/assist']);
const ATTACH_FILE_BODY = 20 * 1024 * 1024, ATTACH_FOLDER_BODY = 50 * 1024 * 1024;
const PAIR_LIFETIME = 5 * 60 * 1000, PAIR_TRIES = 5, MAX_BODY = 8 * 1024, MAX_MESSAGE_BODY = 64 * 1024, MAX_STREAMS = 8, STREAM_EVERY = 1000, STREAM_PING = 15000, CERTIFICATE_DAYS = 800, RENEW_BEFORE = 30 * 24 * 60 * 60 * 1000;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const TAILSCALE = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'];

const plainAddress = address => String(address ?? '').replace(/^::ffff:/, '');
// Tailscale gives out addresses from 100.64.0.0/10.
export function isTailscale(address) {
  const plain = plainAddress(address);
  if (!isIPv4(plain)) return false;
  const [first, second] = plain.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}
// Only a utun interface counts, as some networks use the same range for something else.
export function tailscaleAddress({ interfaces = networkInterfaces } = {}) {
  for (const [name, entries] of Object.entries(interfaces())) {
    if (!/^utun\d+$/.test(name)) continue;
    const entry = entries.find(item => item.family === 'IPv4' && isTailscale(item.address));
    if (entry) return entry.address;
  }
  return '';
}
const run = (command, args) => new Promise(resolve => execFile(command, args, { timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout))));
// iOS only lets an app make a security exception for a domain, not an address, so the phone connects by this name.
export async function tailscaleName({ command = run } = {}) {
  for (const path of TAILSCALE) {
    try { const name = JSON.parse(await command(path, ['status', '--json'])).Self?.DNSName?.replace(/\.$/, ''); if (name) return name; } catch { /* Try the next place it might be. */ }
  }
  return '';
}
// macOS's openssl writes out the curve in full unless told to name it, and iOS refuses a certificate like that.
export async function makeCertificate({ name, address, now = Date.now }) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-link-')), keyFile = join(dir, 'key'), certFile = join(dir, 'cert');
  try {
    await new Promise((resolve, reject) => execFile('/usr/bin/openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-pkeyopt', 'ec_param_enc:named_curve', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', String(CERTIFICATE_DAYS), '-subj', '/CN=Fairy', '-addext', `subjectAltName=DNS:${name},IP:${address}`, '-addext', 'extendedKeyUsage=serverAuth'], { timeout: 15000 }, error => error ? reject(new Error('Fairy couldn’t make its certificate.')) : resolve()));
    const key = await readFile(keyFile, 'utf8'), cert = await readFile(certFile, 'utf8');
    return { key, cert, name, pin: pinOf(cert), expires: new Date(new X509Certificate(cert).validTo).getTime() || now() + CERTIFICATE_DAYS * 86400000 };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const pinOf = cert => new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase();
function reachable({ address, port, timeout = 4000 }) {
  return new Promise(resolve => {
    const request = httpsRequest({ host: address, port, path: '/', agent: false, timeout, rejectUnauthorized: false }, response => { response.resume(); resolve('open'); });
    request.on('timeout', () => { resolve('waiting'); request.destroy(); });
    request.on('error', () => resolve('blocked'));
    request.end();
  });
}
const failure = (status, message) => Object.assign(new Error(message), { status });

// The iPhone app's way in. It only listens on this Mac's Tailscale address, and what a phone can do is the short
// list of routes in receive(). Starting work, changing settings and "always allow" stay on the Mac, and its chat is
// plain conversation only; see phone-turns.mjs.
// A run as the iPhone shows it: what it was, how it ended, its parameters and metrics (no steps), the end of its printout.
export function phoneRun(run) {
  return { id: run.id, label: run.label || run.id, name: run.name || '', state: run.state, where: run.where?.kind || 'here', job: run.where?.job || '', started: run.started || '', seconds: run.seconds ?? null, exit: run.exit ?? null,
    params: Object.fromEntries(Object.entries(run.params || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
    metrics: Object.entries(run.metrics || {}).map(([name, m]) => ({ name, value: typeof m.value === 'number' ? m.value : null, text: typeof m.value === 'number' ? '' : String(m.value ?? ''), unit: m.unit || '' })),
    printout: String(run.printout || '').slice(-2000), tags: run.tags || [], notes: run.notes || '', commit: (run.code?.commit || '').slice(0, 10), dirty: Boolean(run.code?.dirty) };
}
export class PhoneLink {
  constructor({ path, overview, chat, chats = () => [], send = null, stopTurn = null, voicePart = null, pages = null, pageFile = null, memory = null, about = null, assist = null, listening = null, thread = null, taskDone = null, promiseDone = null, chatDelete = null, startWork = null, attach = null, week = null, face = null, notebooks = null, runs = null, a2uiData = null, a2uiAction = null, usage = null, models = null, briefRun = null, goals = null, research = null, neutrino = null, analytics = null, boards = null, answer, onChange = () => {}, onEvent = () => {}, address = tailscaleAddress, name = tailscaleName, certificate = makeCertificate, accepts = isTailscale, reach = reachable, seal = text => text, unseal = text => text, port = LINK_PORT, now = Date.now, every = 30000 }) {
    Object.assign(this, { path, overview, chat, chats, sendMessage: send, stopTurn, voicePart, pages, pageFile, memory, about, assist, listening, thread, taskDone, promiseDone, chatDelete, startWork, attach, week, face, notebooks, runs, a2uiData, a2uiAction, usage, models, briefRun, goals, research, neutrino, analytics, boards, answer, onChange, onEvent, address, name, certificate, accepts, reach, seal, unseal, port, now, every });
    this.store = { enabled: false, keepAwake: true, google: true, sealedKey: '', cert: '', certName: '', expires: 0, devices: [] };
    this.server = null; this.here = ''; this.hostName = ''; this.pairing = null; this.problem = ''; this.firewall = ''; this.streams = new Set();
    this.queue = Promise.resolve();
    this.headers = HEADERS;
  }
  // One change to the server at a time, so a network check can't race turning it off.
  inTurn(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  save() { return atomicJSON(this.path, JSON.stringify(this.store, null, 2)); }
  async start() {
    try { const saved = JSON.parse(await readFile(this.path, 'utf8')); this.store = { ...this.store, ...saved, enabled: saved.enabled === true, keepAwake: saved.keepAwake !== false, google: saved.google !== false, devices: Array.isArray(saved.devices) ? saved.devices : [] }; }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Could not read the phone link settings:', error.message); }
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), this.every);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); return this.inTurn(() => this.close()); }
  state() {
    const { enabled, keepAwake, google, devices } = this.store;
    return { enabled, keepAwake, google, listening: Boolean(this.server), name: this.hostName, tailscale: Boolean(this.here), problem: this.problem, firewall: this.firewall,
      pairing: Boolean(this.pairing && this.pairing.expires > this.now()), devices: devices.map(({ id, name, kind, paired, lastSeen, push }) => ({ id, name, kind: kind === 'mac' ? 'mac' : 'phone', paired, lastSeen, push: Boolean(push?.token) })) };
  }
  // True while it should stop the Mac sleeping, if there's also work running.
  get holdsAwake() { return this.store.enabled && this.store.keepAwake; }
  async setEnabled(on) {
    await this.inTurn(async () => {
      this.store.enabled = on === true;
      if (!this.store.enabled) { await this.close(); this.problem = ''; }
      await this.save();
    });
    await this.refresh();
    this.onChange();
    return this.state();
  }
  async setKeepAwake(on) {
    await this.inTurn(async () => { this.store.keepAwake = on === true; await this.save(); });
    this.onChange();
    return this.state();
  }
  // Whether a phone's messages may read Gmail and ask to add Google Calendar events. On unless you turn it off.
  get allowsGoogle() { return this.store.google !== false; }
  async setGoogle(on) {
    await this.inTurn(async () => { this.store.google = on === true; await this.save(); });
    this.onChange();
    return this.state();
  }
  // Follows Tailscale coming and going, and stays closed without it.
  refresh() {
    return this.inTurn(async () => {
      const before = JSON.stringify(this.state());
      if (this.store.enabled) {
        const address = this.address();
        if (!address) { await this.close(); this.problem = ''; }
        else if (!this.server || this.here !== address) {
          await this.close();
          try { await this.listen(address); this.problem = ''; }
          catch (error) { this.problem = error.message; }
        }
      }
      if (JSON.stringify(this.state()) !== before) this.onChange();
      this.checkFirewall();
    }).catch(error => console.warn('Could not check Tailscale:', error.message));
  }
  // A phone trusts this one certificate, so changing it means pairing again.
  async identity(address) {
    const name = await this.name();
    if (!name) throw new Error('Fairy couldn’t read this Mac’s Tailscale name. Check MagicDNS is on in Tailscale’s admin page.');
    let key = '';
    try { key = this.store.sealedKey ? this.unseal(this.store.sealedKey) : ''; } catch { key = ''; }
    if (key && this.store.cert && this.store.certName === name && this.store.expires - this.now() > RENEW_BEFORE) return { key, cert: this.store.cert, name };
    const made = await this.certificate({ name, address, now: this.now });
    const replacing = Boolean(this.store.cert);
    Object.assign(this.store, { sealedKey: this.seal(made.key), cert: made.cert, certName: name, expires: made.expires });
    if (replacing) this.store.devices = [];
    await this.save();
    return { key: made.key, cert: made.cert, name };
  }
  async listen(address) {
    const { key, cert, name } = await this.identity(address);
    return new Promise((resolve, reject) => {
      // TLS 1.3 only: the iPhone app and a face's Mac both speak it, and nothing older is needed.
      const server = createServer({ key, cert, maxHeaderSize: 8 * 1024, minVersion: 'TLSv1.3' }, (request, response) => this.receive(request, response));
      // Every connection, from its first byte: the HTTPS server only counts one once its TLS greeting is done, and
      // close() has to be able to end the rest too (see there).
      server.sockets = new Set();
      server.on('connection', socket => { server.sockets.add(socket); socket.once('close', () => server.sockets.delete(socket)); });
      Object.assign(server, { headersTimeout: 5000, requestTimeout: 10000, keepAliveTimeout: 5000, maxConnections: 32 });
      server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Another app is using port ${this.port}, which the phone link needs.` : `The phone link couldn’t start: ${error.message}`)));
      server.listen(this.port, address, () => {
        server.removeAllListeners('error');
        server.on('error', error => console.warn('Phone link:', error.message));
        this.server = server; this.here = address; this.hostName = name;
        resolve();
      });
    });
  }
  async close() {
    const server = this.server;
    this.server = null; this.here = ''; this.hostName = ''; this.pairing = null; this.firewall = '';
    this.endStreams();
    this.face?.closeStream?.();
    if (!server) return;
    // When Tailscale goes away, a connection on it can stay open with nothing more ever arriving, and server.close()
    // waits for every connection to end. On the mini that kept the link closed after Tailscale came back, until Fairy
    // restarted, as every later check queued behind this one. So every connection is ended here, and in any case this
    // waits no more than two seconds.
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, CLOSE_WAIT_MS);
      server.close(done);
      server.closeAllConnections();
      for (const socket of server.sockets ?? []) socket.destroy();
    });
  }
  // Not waited for, as macOS can leave its question up for as long as it likes.
  async checkFirewall() {
    const { server, here } = this;
    if (!server) return;
    const result = await this.reach({ address: here, port: server.address().port });
    if (this.server !== server || result === this.firewall) return;
    this.firewall = result;
    this.onChange();
  }
  // The code works once. The fingerprint in it is how the phone knows it's talking to this Mac from the first moment.
  // kind 'mac' is for a face of this Fairy on another Mac (face-link.mjs), which can use only the /v1/face/ requests.
  pair({ kind = 'phone' } = {}) {
    if (!this.server) throw new Error('Turn on the phone link first.');
    if (kind !== 'phone' && kind !== 'mac') throw new Error('A paired device is a phone or a Mac.');
    if (kind === 'mac' && !this.face) throw new Error('This Fairy can’t pair a Mac.');
    const code = randomBytes(16).toString('base64url');
    this.pairing = { code, kind, expires: this.now() + PAIR_LIFETIME, tries: 0 };
    const query = new URLSearchParams({ host: this.hostName, port: String(this.server.address().port), code, pin: pinOf(this.store.cert), ...(kind === 'mac' ? { kind } : {}) });
    return { url: `fairy://pair?${query}`, minutes: PAIR_LIFETIME / 60000 };
  }
  // Where pushes go: each paired phone that registered, with the key it gave for sealing what a push says.
  pushTargets() {
    const targets = [];
    for (const device of this.store.devices) {
      if (!device.push?.token) continue;
      try { targets.push({ id: device.id, name: device.name, token: device.push.token, environment: device.push.environment, key: this.unseal(device.push.sealedKey) }); }
      catch { /* A key this Mac can no longer open waits for the phone to register again. */ }
    }
    return targets;
  }
  // Apple said this token is no longer the phone's (the app was removed or reinstalled).
  async dropPushToken(token) {
    await this.inTurn(async () => { for (const device of this.store.devices) if (device.push?.token === token) delete device.push; await this.save(); });
    this.onChange();
  }
  async registerPush(device, { token, environment, key }) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64,200}$/i.test(token)) throw failure(400, 'That isn’t a push token.');
    if (!['development', 'production'].includes(environment)) throw failure(400, 'Say which push environment this app uses.');
    if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 32) throw failure(400, 'A push key is 32 bytes.');
    await this.inTurn(async () => {
      const saved = this.store.devices.find(item => item.id === device.id);
      if (saved) saved.push = { token: token.toLowerCase(), environment, sealedKey: this.seal(key), at: new Date(this.now()).toISOString() };
      await this.save();
    });
    this.onChange();
  }
  async forget(id) {
    await this.inTurn(async () => { this.store.devices = this.store.devices.filter(device => device.id !== id); await this.save(); });
    this.endStreams(id);
    this.face?.forget?.(id);
    this.onEvent({ type: 'removed' });
    this.onChange();
    return this.state();
  }
  device(request) {
    const key = /^Bearer (.+)$/.exec(String(request.headers.authorization ?? ''))?.[1];
    if (!key) return null;
    const hash = hashed(key).toString('hex');
    return this.store.devices.find(device => device.readHash === hash) ?? null;
  }
  send(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
  }
  // Whether a key is this device's approve key (Face ID on a phone, Touch ID on a Mac), compared in constant time.
  approves(device, key) { return typeof key === 'string' && typeof device?.approveHash === 'string' && sameText(hashed(key).toString('hex'), device.approveHash); }
  body(request, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      request.on('data', part => {
        size += part.length;
        if (size > limit) { reject(failure(413, 'Too long.')); request.destroy(); return; }
        parts.push(part);
      });
      request.on('error', reject);
      request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(failure(400, 'Not understood.')); } });
    });
  }
  // A file's bytes as they are, for /v1/attach.
  bytes(request, limit) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      request.on('data', part => {
        size += part.length;
        if (size > limit) { reject(failure(413, 'That’s too big to attach.')); request.destroy(); return; }
        parts.push(part);
      });
      request.on('error', reject);
      request.on('end', () => resolve(Buffer.concat(parts)));
    });
  }
  async receive(request, response) {
    // Nothing at all for anything outside Tailscale.
    if (!this.here || !this.accepts(request.socket.remoteAddress)) { request.socket.destroy(); return; }
    try {
      if (request.headers.host !== `${this.hostName}:${this.server.address().port}`) return this.send(response, 421, { error: 'Wrong address.' });
      // Only the app talks to this. A web page would have to send an Origin.
      if (request.headers.origin) return this.send(response, 403, { error: 'Refused.' });
      const { pathname, searchParams } = new URL(request.url, 'https://fairy.invalid');
      if (request.method === 'POST' && pathname === '/v1/pair') return await this.takeCode(request, response);
      // A face on another Mac (face-link.mjs): its own requests, for a device paired as a Mac only.
      if (pathname.startsWith('/v1/face/')) {
        const device = this.device(request);
        if (!device || device.kind !== 'mac' || !this.face) return this.send(response, 401, { error: 'This Mac isn’t paired.' });
        device.lastSeen = new Date(this.now()).toISOString();
        return await this.face.handle(request, response, { device, pathname, searchParams, link: this });
      }
      // Study notebooks (phone-notebooks.mjs): its own short list of requests, for a paired phone only.
      if (this.notebooks?.routes?.includes(pathname)) {
        const device = this.device(request);
        if (!device) return this.send(response, 401, { error: 'This phone isn’t paired.' });
        if (device.kind === 'mac') return this.send(response, 403, { error: 'A Mac paired as a face can’t use that.' });
        device.lastSeen = new Date(this.now()).toISOString();
        return await this.notebooks.handle(request, response, { device, pathname, searchParams, link: this });
      }
      if (!['/v1/overview', '/v1/chats', '/v1/chat', '/v1/events', '/v1/answer', '/v1/leave', '/v1/send', '/v1/stop', '/v1/voice', '/v1/pages', '/v1/page-file', '/v1/memory', '/v1/about', '/v1/assist', '/v1/listening', '/v1/push', '/v1/thread', '/v1/task-done', '/v1/promise-done', '/v1/chat-delete', '/v1/work', '/v1/attach', '/v1/week', '/v1/runs', '/v1/runs-list', '/v1/a2ui-data', '/v1/a2ui-action', '/v1/usage', '/v1/models', '/v1/brief-run', '/v1/goals', '/v1/goal', '/v1/goal-action', '/v1/research', '/v1/research-detail', '/v1/neutrino', '/v1/neutrino-pr', '/v1/neutrino-action', '/v1/analytics', '/v1/analytics-run', '/v1/boards', '/v1/board'].includes(pathname)) return this.send(response, 404, { error: 'Not found.' });
      const device = this.device(request);
      if (!device) return this.send(response, 401, { error: 'This phone isn’t paired.' });
      if (device.kind === 'mac' && !MAC_ROUTES.has(pathname)) return this.send(response, 403, { error: 'A Mac paired as a face can’t use that.' });
      device.lastSeen = new Date(this.now()).toISOString();
      if (request.method === 'GET' && pathname === '/v1/overview') return this.send(response, 200, this.overview());
      if (request.method === 'GET' && pathname === '/v1/chats') return this.send(response, 200, { chats: this.chats() });
      if (request.method === 'GET' && pathname === '/v1/chat') return this.send(response, 200, await this.chat(searchParams.get('id')));
      if (request.method === 'GET' && pathname === '/v1/events') return this.openStream(request, response, device, searchParams.get('chat'), this.tutorOf(searchParams, device));
      if (request.method === 'POST' && pathname === '/v1/answer') return await this.takeAnswer(request, response, device);
      // Only the chat and the words (plus optional per-message provider/model/effort choice) are passed on.
      if (request.method === 'POST' && pathname === '/v1/send' && this.sendMessage) {
        const { chat, text, voice, attachments, provider, model, effort } = await this.body(request, MAX_MESSAGE_BODY);
        return this.send(response, 200, await this.sendMessage({
          chat, text, voice: voice === true, device: device.name,
          ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
          ...(typeof provider === 'string' && provider ? { provider } : {}),
          ...(typeof model === 'string' && model ? { model } : {}),
          ...(typeof effort === 'string' && effort ? { effort } : {}),
        }));
      }
      // A file, or a folder zipped, for the next message: kept on the Mac until that message is sent.
      if (request.method === 'POST' && pathname === '/v1/attach' && this.attach) {
        const folder = searchParams.get('folder') === '1', name = searchParams.get('name') ?? '';
        const bytes = await this.bytes(request, folder ? ATTACH_FOLDER_BODY : ATTACH_FILE_BODY);
        try { return this.send(response, 200, await this.attach({ name, folder, bytes })); }
        catch (error) { throw error.status ? error : failure(400, String(error.message || 'That can’t be attached.')); }
      }
      // The experiment tracker, read only (run-reader.mjs): the projects with runs, and one project's runs, only a
      // project the list names. Nothing here changes a run.
      if (request.method === 'GET' && pathname === '/v1/runs' && this.runs) return this.send(response, 200, { projects: await this.runs.projects() });
      if (request.method === 'GET' && pathname === '/v1/runs-list' && this.runs) {
        const folder = String(searchParams.get('folder') || ''), projects = await this.runs.projects();
        if (!projects.some(p => p.folder === folder)) return this.send(response, 404, { error: 'There are no runs there.' });
        const { kind, runs } = await this.runs.list(folder);
        return this.send(response, 200, { folder, kind, runs: runs.slice(0, 200).map(phoneRun) });
      }
      if (request.method === 'GET' && pathname === '/v1/week' && this.week) return this.send(response, 200, await this.week({ force: searchParams.get('force') === '1' }));
      if (request.method === 'GET' && pathname === '/v1/voice' && this.voicePart) {
        const part = this.voicePart(searchParams.get('chat'), Number(searchParams.get('part')));
        if (!part) return this.send(response, 404, { error: 'That clip isn’t ready.' });
        response.writeHead(200, { ...HEADERS, 'Content-Type': 'audio/mpeg', 'Content-Length': part.length });
        response.end(part);
        return;
      }
      // Pages and memory can be read from a phone, and only changed on the Mac.
      if (request.method === 'GET' && pathname === '/v1/pages' && this.pages) return this.send(response, 200, { pages: this.pages() });
      if (request.method === 'GET' && pathname === '/v1/memory' && this.memory) return this.send(response, 200, this.memory());
      if (request.method === 'GET' && pathname === '/v1/about' && this.about) return this.send(response, 200, await this.about());
      if (request.method === 'GET' && pathname === '/v1/page-file' && this.pageFile) {
        const { status, headers, body } = await this.pageFile({ id: searchParams.get('id'), seq: searchParams.get('seq'), path: searchParams.get('path'), range: request.headers.range });
        response.writeHead(status, { ...HEADERS, ...headers });
        response.end(body);
        return;
      }
      if (request.method === 'POST' && pathname === '/v1/stop' && this.stopTurn) {
        const { chat } = await this.body(request);
        return this.send(response, 200, this.stopTurn(chat));
      }
      // AudioPulse on a paired iPhone: one music request run as a tool call (no chat, tools or persona).
      if (request.method === 'POST' && pathname === '/v1/assist' && this.assist) {
        const { instructions, prompt } = await this.body(request, MAX_MESSAGE_BODY);
        let text;
        try { text = await this.assist({ instructions, prompt }); }
        catch (error) {
          if (error.status) throw error;
          throw failure(error.name === 'TimeoutError' ? 504 : 502, error.name === 'TimeoutError' ? 'Fairy took too long to answer.' : error.message || 'Fairy couldn’t answer.');
        }
        return this.send(response, 200, { text });
      }
      // The phone is listening for you (it says so every few seconds), so the Mac shouldn't answer its own wake word too.
      if (request.method === 'POST' && pathname === '/v1/listening' && this.listening) {
        const { on } = await this.body(request);
        this.listening(on === true, device.name);
        return this.send(response, 200, { ok: true });
      }
      // The phone's push token and its own key for sealing what pushes say, given over this pinned link only.
      if (request.method === 'POST' && pathname === '/v1/push') {
        await this.registerPush(device, await this.body(request));
        return this.send(response, 200, { ok: true });
      }
      // The one chat Home shows: briefs, check-ins and quick requests. Made the first time a phone asks.
      if (request.method === 'POST' && pathname === '/v1/thread' && this.thread) return this.send(response, 200, { id: await this.thread() });
      // Only you mark a task done, from the phone or the Mac.
      if (request.method === 'POST' && pathname === '/v1/task-done' && this.taskDone) {
        const { id, done } = await this.body(request);
        if (typeof id !== 'string' || !id) throw failure(400, 'Say which task.');
        await this.taskDone(id, done === true);
        return this.send(response, 200, { ok: true });
      }
      // Deleting a chat from the phone: it goes to the Mac's Trash, as deleting it on the Mac does.
      if (request.method === 'POST' && pathname === '/v1/chat-delete' && this.chatDelete) {
        const { id } = await this.body(request);
        if (typeof id !== 'string' || !id || id.length > 80) throw failure(400, 'Say which chat.');
        await this.chatDelete(id);
        return this.send(response, 200, { ok: true });
      }
      // Ticking off something you said you'd do, from Your week.
      if (request.method === 'POST' && pathname === '/v1/promise-done' && this.promiseDone) {
        const { id, done } = await this.body(request);
        if (typeof id !== 'string' || !id || id.length > 40) throw failure(400, 'Say which promise.');
        await this.promiseDone(id, done !== false);
        return this.send(response, 200, { ok: true });
      }
      // Starting work from a phone takes Face ID, like allowing a step, and only in a folder you've worked in before.
      if (request.method === 'POST' && pathname === '/v1/work' && this.startWork) {
        const { folder, prompt, approveKey } = await this.body(request, MAX_MESSAGE_BODY);
        if (typeof approveKey !== 'string' || !sameText(hashed(approveKey).toString('hex'), device.approveHash)) throw failure(403, 'Confirm with Face ID to start work.');
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) throw failure(400, 'Say what the task is, in up to 12,000 characters.');
        if (typeof folder !== 'string' || !folder) throw failure(400, 'Choose a folder.');
        const started = await this.startWork({ folder, prompt: prompt.trim(), device: device.name });
        this.onEvent({ type: 'work-started', device: device.name });
        return this.send(response, 200, started);
      }
      // Updates bound dataModel state for an inline A2UI surface from the phone.
      if (request.method === 'POST' && pathname === '/v1/a2ui-data' && this.a2uiData) {
        const { chat, messageAt = '', surfaceId, path = '/', value } = await this.body(request, MAX_MESSAGE_BODY);
        if (typeof chat !== 'string' || !chat || chat.length > 80) throw failure(400, 'Say which chat.');
        if (typeof surfaceId !== 'string' || !surfaceId || surfaceId.length > 80) throw failure(400, 'Say which surface.');
        if (typeof path !== 'string' || path.length > 200) throw failure(400, 'Invalid pointer path.');
        if (typeof messageAt !== 'string' || messageAt.length > 60) throw failure(400, 'Invalid message timestamp.');
        return this.send(response, 200, await this.a2uiData({ chat, messageAt, surfaceId, path: path || '/', value }));
      }
      // Dispatches an A2UI component action from the phone as a formatted turn in the target chat.
      if (request.method === 'POST' && pathname === '/v1/a2ui-action' && this.a2uiAction) {
        const { chat = '', surfaceId = '', title = '', actionName, sourceComponentId = '', context = {} } = await this.body(request, MAX_MESSAGE_BODY);
        if (chat !== null && chat !== undefined && (typeof chat !== 'string' || chat.length > 80)) throw failure(400, 'Invalid chat.');
        if (typeof surfaceId !== 'string' || surfaceId.length > 80) throw failure(400, 'Invalid surface.');
        if (typeof actionName !== 'string' || !actionName.trim() || actionName.length > 100) throw failure(400, 'Say which action.');
        if (typeof sourceComponentId !== 'string' || sourceComponentId.length > 80) throw failure(400, 'Invalid component id.');
        if (typeof title !== 'string' || title.length > 120) throw failure(400, 'Invalid title.');
        if (context !== null && context !== undefined && (typeof context !== 'object' || Array.isArray(context) || JSON.stringify(context).length > 16384)) throw failure(400, 'Action data is too large or invalid.');
        return this.send(response, 200, await this.a2uiAction({ chat: chat || '', surfaceId, title, actionName: actionName.trim(), sourceComponentId, context: context || {}, device: device.name }));
      }
      if (request.method === 'GET' && pathname === '/v1/usage' && this.usage) {
        return this.send(response, 200, await this.usage({ force: searchParams.get('force') === '1' }));
      }
      if (request.method === 'GET' && pathname === '/v1/models' && this.models) {
        return this.send(response, 200, await this.models());
      }
      if (request.method === 'POST' && pathname === '/v1/brief-run' && this.briefRun) {
        const { kind } = await this.body(request);
        if (kind !== undefined && kind !== 'brief' && kind !== 'check') throw failure(400, 'Choose brief or check.');
        return this.send(response, 200, await this.briefRun(kind === 'check' ? 'check' : 'brief'));
      }
      if (request.method === 'GET' && pathname === '/v1/goals' && this.goals) {
        return this.send(response, 200, await this.goals.list());
      }
      if (request.method === 'GET' && pathname === '/v1/goal' && this.goals) {
        const id = String(searchParams.get('id') || '').trim();
        if (!/^G\d{1,6}$/.test(id)) throw failure(400, 'Say which goal.');
        return this.send(response, 200, await this.goals.get(id));
      }
      if (request.method === 'POST' && pathname === '/v1/goal-action' && this.goals) {
        const { id, action, reason = '', approveKey } = await this.body(request);
        if (typeof id !== 'string' || !/^G\d{1,6}$/.test(id)) throw failure(400, 'Say which goal.');
        if (!['continue', 'pause', 'resume', 'done', 'drop', 'reopen'].includes(action)) throw failure(400, 'Unknown goal action.');
        if (action === 'continue' && !this.approves(device, approveKey)) throw failure(403, 'Confirm with Face ID to start this step.');
        return this.send(response, 200, await this.goals.action({ id, action, reason: String(reason || '').slice(0, 400), device: device.name }));
      }
      if (request.method === 'GET' && pathname === '/v1/research' && this.research) {
        return this.send(response, 200, await this.research.home());
      }
      if (request.method === 'GET' && pathname === '/v1/research-detail' && this.research) {
        const slug = String(searchParams.get('slug') || '').trim();
        if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) throw failure(400, 'Say which investigation.');
        return this.send(response, 200, await this.research.detail(slug));
      }
      if (request.method === 'GET' && pathname === '/v1/neutrino' && this.neutrino) {
        return this.send(response, 200, await this.neutrino.inbox());
      }
      if (request.method === 'GET' && pathname === '/v1/neutrino-pr' && this.neutrino) {
        const repo = String(searchParams.get('repo') || '').trim(), num = Number(searchParams.get('number'));
        if (!repo || repo.length > 160 || !Number.isInteger(num) || num < 1) throw failure(400, 'Say which pull request.');
        return this.send(response, 200, await this.neutrino.pr({ repo, number: num }));
      }
      if (request.method === 'POST' && pathname === '/v1/neutrino-action' && this.neutrino) {
        const { action, repo = '', number = null, job = null, run = null, strategy = 'merge', text = '', path = '', side = 'new', line = null, approve = true, approveKey } = await this.body(request, MAX_MESSAGE_BODY);
        if (!['merge', 'approve-job', 'rerun', 'note'].includes(action)) throw failure(400, 'Unknown Neutrino action.');
        if (typeof repo !== 'string' || !repo.trim() || repo.length > 160) throw failure(400, 'Say which repository.');
        if ((action === 'merge' || action === 'approve-job') && !this.approves(device, approveKey)) throw failure(403, 'Confirm with Face ID first.');
        return this.send(response, 200, await this.neutrino.act({ action, repo: repo.trim(), number, job, run, strategy, text, path, side, line, approve, device: device.name }));
      }
      if (request.method === 'GET' && pathname === '/v1/analytics' && this.analytics) {
        return this.send(response, 200, await this.analytics.overview());
      }
      if (request.method === 'GET' && pathname === '/v1/analytics-run' && this.analytics) {
        const id = String(searchParams.get('id') || '').trim();
        if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) throw failure(400, 'Say which Analytics run.');
        return this.send(response, 200, await this.analytics.run(id));
      }
      if (request.method === 'GET' && pathname === '/v1/boards' && this.boards) {
        return this.send(response, 200, await this.boards.list());
      }
      if (request.method === 'GET' && pathname === '/v1/board' && this.boards) {
        const id = String(searchParams.get('id') || '').trim();
        if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) throw failure(400, 'Say which board.');
        return this.send(response, 200, await this.boards.get(id));
      }
      if (request.method === 'POST' && pathname === '/v1/leave') { await this.forget(device.id); return this.send(response, 200, { ok: true }); }
      return this.send(response, 405, { error: 'Not allowed.' });
    } catch (error) {
      if (!response.headersSent) this.send(response, error.status ?? 500, { error: error.status ? error.message : 'Something went wrong on the Mac.' });
      else response.destroy();
    }
  }
  async takeCode(request, response) {
    const { code, name, kind = 'phone' } = await this.body(request), pairing = this.pairing;
    if (!pairing || pairing.expires <= this.now()) throw failure(403, 'That code has run out. Make a new one on the Mac.');
    // A code made for a phone can't pair a Mac, nor the other way round.
    if (typeof code !== 'string' || !sameText(code, pairing.code) || kind !== (pairing.kind ?? 'phone')) {
      if (++pairing.tries >= PAIR_TRIES) this.pairing = null;
      this.onEvent({ type: 'wrong-code' });
      throw failure(403, 'That code isn’t right. Make a new one on the Mac.');
    }
    this.pairing = null;
    const readKey = randomBytes(32).toString('base64url'), approveKey = randomBytes(32).toString('base64url'), at = new Date(this.now()).toISOString();
    const device = { id: randomUUID(), name: String(name || (pairing.kind === 'mac' ? 'Mac' : 'iPhone')).slice(0, 40), ...(pairing.kind === 'mac' ? { kind: 'mac' } : {}), readHash: hashed(readKey).toString('hex'), approveHash: hashed(approveKey).toString('hex'), paired: at, lastSeen: at };
    this.store.devices.push(device);
    await this.save();
    this.onEvent({ type: 'paired', device: device.name });
    this.onChange();
    this.send(response, 200, { readKey, approveKey, device: device.id });
  }
  // Yes or no for this one step. Trusting a whole chat stays on the Mac. The phone keeps the approve key behind
  // Face ID, so a yes needs it and a no doesn't.
  async takeAnswer(request, response, device) {
    const { id, decision, approveKey } = await this.body(request);
    if (decision !== 'allow' && decision !== 'deny') throw failure(400, 'Unknown answer.');
    const waiting = this.overview().approvals.find(item => item.id === id);
    if (!waiting) throw failure(409, 'That question has already been answered.');
    if (decision === 'allow') {
      if (waiting.tooBig) throw failure(409, 'This one is too long to show on a phone. Answer it on the Mac.');
      // Whatever reaches beyond the sandbox runs with your full access, so a phone can refuse it but never allow it.
      if (waiting.macOnly) throw failure(409, 'This one can only be allowed on the Mac.');
      if (typeof approveKey !== 'string' || !sameText(hashed(approveKey).toString('hex'), device.approveHash)) throw failure(403, 'Confirm with Face ID to allow this.');
    }
    this.answer(id, decision);
    this.onEvent({ type: 'answered', device: device.name, decision, title: waiting.title, chat: waiting.chat });
    await this.save();
    this.send(response, 200, { ok: true });
  }
  // Pushes the overview, and a chat if one is open, whenever they change. Nothing runs when no phone is listening.
  // A tutor chat a phone follows as well: { slug, chat }, for a phone only. A new chat has no id until it's asked in.
  tutorOf(searchParams, device) {
    const slug = searchParams.get('notebook'), chat = searchParams.get('tutor');
    if (!slug || !this.notebooks || device.kind === 'mac' || slug.length > 200 || (chat && !/^C\d{1,5}$/.test(chat))) return null;
    return { slug, chat: chat || null };
  }
  openStream(request, response, device, chat, tutor = null) {
    if (this.streams.size >= MAX_STREAMS) throw failure(503, 'Too many connections.');
    request.socket.setTimeout(0);
    response.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8' });
    const stream = { response, device: device.id, chat, tutor, last: '', pinged: this.now() };
    this.streams.add(stream);
    // The response, as a request counts as closed once it has been read.
    response.on('close', () => { this.streams.delete(stream); this.stopTicking(); });
    this.tickStream(stream);
    this.ticker ??= setInterval(() => { for (const each of this.streams) this.tickStream(each); }, STREAM_EVERY);
    this.ticker.unref?.();
  }
  stopTicking() { if (!this.streams.size && this.ticker) { clearInterval(this.ticker); this.ticker = null; } }
  async tickStream(stream) {
    if (stream.busy) return;
    stream.busy = true;
    try {
      let chat = null;
      if (stream.chat) { try { chat = await this.chat(stream.chat); } catch { chat = null; } }
      let tutor = null;
      if (stream.tutor) { try { tutor = this.notebooks.live(stream.tutor.slug, stream.tutor.chat); } catch { tutor = null; } }
      const text = JSON.stringify({ overview: this.overview(), chat, ...(tutor ? { tutor } : {}) });
      if (!this.streams.has(stream)) return;
      if (text !== stream.last) { stream.last = text; stream.pinged = this.now(); stream.response.write(`data: ${text}\n\n`); }
      else if (this.now() - stream.pinged >= STREAM_PING) { stream.pinged = this.now(); stream.response.write(': still here\n\n'); }
    } finally { stream.busy = false; }
  }
  endStreams(device) {
    for (const stream of this.streams) if (!device || stream.device === device) { this.streams.delete(stream); stream.response.destroy(); }
    this.stopTicking();
  }
}
