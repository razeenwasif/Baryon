import { createCipheriv, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { connect, type ClientHttp2Session, type ClientHttp2Stream, type IncomingHttpHeaders } from 'node:http2';

// Pushes from this Mac straight to Apple, and from Apple to the paired iPhones: no server of Fairy's in between. Each
// phone gave the Mac a key of its own when it registered, and what a push says is sealed with it (AES-256-GCM), so Apple
// carries only "Fairy" and a sealed blob; the phone's notification extension opens it. The APNs key that lets the Mac
// send is yours, made in your Apple Developer account, and is kept encrypted on this Mac.
export const TOPIC = 'dev.razeen.fairy';
const HOSTS = { production: 'https://api.push.apple.com', development: 'https://api.sandbox.push.apple.com' } as const;
const TOKEN_LIFE = 50 * 60 * 1000, MAX_BODY = 1500, MAX_TITLE = 120;
const base64url = (value: string): string => Buffer.from(value).toString('base64url');

export interface AuthKeyInput {
  pem?: unknown;
  fileName?: string;
  keyId?: string;
  teamId?: unknown;
}

export interface AuthKeyCredentials {
  pem: string;
  keyId: string;
  teamId: string;
}

export interface PushPayloadOptions {
  key: unknown;
  title?: unknown;
  body?: unknown;
  kind?: string;
  chat?: string;
  id?: string;
  allow?: boolean | null;
  promise?: string;
}

export interface PushPayload {
  aps: {
    alert: { title: string; body: string };
    sound: string;
    'mutable-content': number;
    'thread-id': string;
  };
  sealed: string;
}

export interface PushSendResult {
  ok: boolean;
  status?: number;
  reason?: string;
}

export interface PusherOptions {
  credentials: () => AuthKeyCredentials | null | undefined;
  open?: (host: string) => ClientHttp2Session;
  now?: () => number;
  idle?: number;
}

export interface QuietHoursRange {
  from?: string;
  to?: string;
}

interface SessionEntry {
  session: ClientHttp2Session;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CachedToken {
  keyId: string;
  at: number;
  value: string;
}

// The APNs key file Apple gives you once: AuthKey_<key id>.p8, a PEM private key.
export function readAuthKey({ pem, fileName = '', keyId = '', teamId }: AuthKeyInput): AuthKeyCredentials {
  const text = String(pem ?? '').trim();
  if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(text)) throw new Error('That isn’t an APNs key. Choose the AuthKey_….p8 file you downloaded from Apple.');
  try { createPrivateKey(text); } catch { throw new Error('That key file is damaged. Download a new one from Apple.'); }
  const id = String(keyId || /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(fileName)?.[1] || '').toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(id)) throw new Error('Fairy needs the key’s 10-character Key ID. Keep the file’s name as Apple gave it (AuthKey_….p8).');
  if (!/^[A-Z0-9]{10}$/.test(String(teamId ?? ''))) throw new Error('Fairy needs your 10-character Team ID.');
  return { pem: text, keyId: id, teamId: String(teamId) };
}

// The short-lived token Apple wants with each push, signed with your key. It's made again before it runs out.
export function providerToken({ pem, keyId, teamId }: AuthKeyCredentials, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId })), claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${signature.toString('base64url')}`;
}

// What a push says, sealed for one phone: 12 bytes of nonce, the ciphertext, then the 16-byte tag, as CryptoKit's
// AES.GCM.SealedBox(combined:) reads it.
export function sealFor(key: unknown, message: unknown): string {
  const secret = Buffer.from(String(key ?? ''), 'base64');
  if (secret.length !== 32) throw new Error('That phone’s push key isn’t usable. Open Fairy on the phone to register again.');
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
}

const clip = (text: unknown, limit: number): string => { const value = String(text ?? '').replace(/\s+/g, ' ').trim(); return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value; };
// One push for one phone. Apple sees only the app's name and a sealed blob; the lock screen shows the real words once
// the phone has opened it. kind says what tapping it opens: ask (Tasks), chat (that chat). For a question, allow says
// whether the phone may say yes to it, so the notification offers Allow as well as Don't allow. A promise's reminder
// carries the promise, so the notification offers Done.
export function pushPayload({ key, title, body, kind = 'chat', chat = '', id = '', allow = null, promise = '' }: PushPayloadOptions): PushPayload {
  const message = { title: clip(title, MAX_TITLE) || 'Fairy', body: clip(body, MAX_BODY), kind, ...(chat ? { chat } : {}), ...(id ? { id } : {}), ...(allow === null ? {} : { allow: allow ? 'yes' : 'no' }), ...(promise ? { promise: String(promise).slice(0, 40) } : {}) };
  return { aps: { alert: { title: 'Fairy', body: kind === 'ask' ? 'Needs your OK' : 'Something new from Fairy' }, sound: 'default', 'mutable-content': 1, 'thread-id': kind === 'ask' ? 'asks' : chat || 'fairy' }, sealed: sealFor(key, message) };
}

// Sends over HTTP/2 to Apple, one connection per environment, kept open while pushes go out and closed when idle.
export class Pusher {
  credentials: () => AuthKeyCredentials | null | undefined;
  open: (host: string) => ClientHttp2Session;
  now: () => number;
  idle: number;
  sessions: Map<string, SessionEntry>;
  token: CachedToken | null;

  constructor({ credentials, open = (host) => connect(host), now = Date.now, idle = 60000 }: PusherOptions) {
    this.credentials = credentials;
    this.open = open;
    this.now = now;
    this.idle = idle;
    this.sessions = new Map();
    this.token = null;
  }

  bearer(): string {
    const credentials = this.credentials();
    if (!credentials) throw new Error('Add your APNs key in Settings, under Phone, first.');
    if (!this.token || this.token.keyId !== credentials.keyId || this.now() - this.token.at > TOKEN_LIFE) this.token = { keyId: credentials.keyId, at: this.now(), value: providerToken(credentials, this.now()) };
    return this.token.value;
  }

  session(environment?: string): ClientHttp2Session {
    const host = HOSTS[environment === 'production' ? 'production' : 'development'];
    let entry = this.sessions.get(host);
    if (!entry || entry.session.closed || entry.session.destroyed) {
      const session = this.open(host);
      session.on('error', () => {});
      session.on('close', () => { if (this.sessions.get(host)?.session === session) this.sessions.delete(host); });
      entry = { session, timer: null };
      this.sessions.set(host, entry);
    }
    if (entry.timer) clearTimeout(entry.timer);
    const activeEntry = entry;
    entry.timer = setTimeout(() => activeEntry.session.close(), this.idle);
    entry.timer.unref?.();
    return entry.session;
  }

  // Resolves with Apple's answer: { ok: true } or { ok: false, status, reason }. A reason of BadDeviceToken or
  // Unregistered means the phone has gone, and the caller forgets that token.
  send({ token, environment, payload, collapse = '' }: { token: string; environment?: string; payload: unknown; collapse?: string }): Promise<PushSendResult> {
    const authorization = `bearer ${this.bearer()}`, body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 4096) return Promise.resolve({ ok: false, status: 413, reason: 'PayloadTooLarge' });
    return new Promise(resolve => {
      let stream: ClientHttp2Stream;
      try {
        stream = this.session(environment).request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization, 'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10', ...(collapse ? { 'apns-collapse-id': collapse.slice(0, 64) } : {}), 'content-type': 'application/json' });
      } catch (error) { resolve({ ok: false, status: 0, reason: error instanceof Error ? error.message : String(error) }); return; }
      let status = 0, text = '';
      stream.setEncoding('utf8');
      stream.on('response', (headers: IncomingHttpHeaders) => { status = Number(headers[':status']) || 0; });
      stream.on('data', (chunk: string) => { text += chunk; });
      stream.on('end', () => {
        if (status === 200) return resolve({ ok: true });
        let reason = '';
        try { reason = (JSON.parse(text) as { reason?: string }).reason || ''; } catch { reason = text.slice(0, 200); }
        resolve({ ok: false, status, reason });
      });
      stream.on('error', (error: Error) => resolve({ ok: false, status, reason: error.message }));
      stream.setTimeout(15000, () => { stream.close(); resolve({ ok: false, status: 0, reason: 'Apple didn’t answer in time.' }); });
      stream.end(body);
    });
  }

  close(): void { for (const { session, timer } of this.sessions.values()) { if (timer) clearTimeout(timer); session.close(); } this.sessions.clear(); }
}

// Quiet hours, as "22:00" to "07:00", which may run past midnight. An empty range is never quiet.
export function inQuietHours({ from, to }: QuietHoursRange = {}, now = new Date()): boolean {
  const minutes = (value?: string): number | null => /^\d\d:\d\d$/.test(value || '') ? Number(value!.slice(0, 2)) * 60 + Number(value!.slice(3)) : null;
  const start = minutes(from), end = minutes(to);
  if (start === null || end === null || start === end) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return start < end ? at >= start && at < end : at >= start || at < end;
}
