import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
const TOKEN = 'https://oauth2.googleapis.com/token';
export function googleClient(json) {
  const c = json?.installed;
  if (!c || !/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(c.client_id || '') || c.client_id.length > 250) throw new Error('Choose the JSON for a Google OAuth Desktop app, not a web app or service account.');
  if (c.client_secret !== undefined && (typeof c.client_secret !== 'string' || c.client_secret.length > 300)) throw new Error('Invalid Google desktop client.');
  // Never use endpoints supplied in the imported file.
  return { clientId: c.client_id, clientSecret: c.client_secret || '' };
}

export class GoogleConnection {
  constructor({ read, write, openExternal, fetchImpl = fetch, now = Date.now, service, apiRoot, readScopes, writeScope }) {
    Object.assign(this, { read, write, openExternal, fetch: fetchImpl, now, service, apiRoot, readScopes, writeScope });
    this.value = null; this.epoch = 0; this.writes = Promise.resolve(); this.retryAt = 0;
  }
  async load() { try { this.value = await this.read(); } catch { this.warning = `${this.service} credentials could not be unlocked. Import the desktop client again.`; } return this.status(); }
  status() { return { configured: Boolean(this.value?.client), connected: Boolean(this.value?.tokens?.refreshToken), connecting: Boolean(this.pending), canWrite: Boolean(this.value?.tokens?.scope?.split(' ').includes(this.writeScope)), error: this.warning || '' }; }
  async persist(value, epoch = this.epoch) {
    const task = this.writes.catch(() => {}).then(async () => { if (epoch !== this.epoch) throw new Error(`${this.service} connection changed.`); await this.write(value); });
    this.writes = task; await task;
    if (epoch !== this.epoch) throw new Error(`${this.service} connection changed.`);
    this.value = value;
  }
  async importClient(json) { const client = googleClient(json); this.close(); await this.persist({ client }); this.warning = ''; return this.status(); }
  close() { this.epoch++; this.pending?.cancel(); }
  async adoptSharedTokens({ client, tokens }) {
    if (!client?.clientId || !tokens?.refreshToken || typeof tokens?.accessToken !== 'string') {
      throw new Error(`Invalid shared Google credentials for ${this.service}.`);
    }
    const granted = String(tokens.scope || '').split(/\s+/).filter(Boolean);
    if (this.readScopes.some(s => !granted.includes(s))) {
      throw new Error(`Shared Google sign-in does not include ${this.service} permissions.`);
    }
    this.close();
    const epoch = ++this.epoch;
    await this.persist({
      client: { clientId: client.clientId, clientSecret: client.clientSecret || '' },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scope: granted.join(' '),
        expiresAt: Number(tokens.expiresAt) || 0,
      },
    }, epoch);
    this.warning = '';
    this.retryAt = 0;
    return this.status();
  }
  async clearTokens() {
    this.close();
    const epoch = ++this.epoch;
    await this.persist(this.value?.client ? { client: this.value.client } : null, epoch);
    this.warning = '';
    this.retryAt = 0;
    return this.status();
  }
  async disconnect() { this.close(); await this.persist(null); this.warning = ''; return this.status(); }
  async tokenRequest(body) {
    const r = await this.fetch(TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    if (!r.ok) throw Object.assign(new Error(`Google sign-in expired or was rejected. Reconnect ${this.service} in Settings.`), { auth: r.status === 400 || r.status === 401 });
    return r.json();
  }
  tokens(data, scopes, previous) {
    const scope = data.scope ?? previous?.scope ?? '';
    if (scopes.some(s => !scope.split(' ').includes(s))) throw new Error(`Google did not grant the requested ${this.service} permissions. Reconnect and enable the requested access.`);
    if (typeof data.access_token !== 'string' || !(data.refresh_token || previous?.refreshToken)) throw new Error('Google returned an incomplete connection. Please reconnect.');
    return { accessToken: data.access_token, refreshToken: data.refresh_token || previous.refreshToken, scope, expiresAt: this.now() + Math.max(0, Number(data.expires_in) || 0) * 1000 };
  }
  async connect(writeAccess = false) {
    if (typeof writeAccess !== 'boolean') throw new Error(`Choose valid ${this.service} permissions.`);
    if (!this.value?.client) throw new Error('Import your Google Desktop app JSON first.');
    if (this.pending) throw new Error('Google sign-in is already open. Finish or disconnect first.');
    const client = this.value.client, epoch = ++this.epoch;
    const scopes = [...this.readScopes, ...(writeAccess ? [this.writeScope] : [])];
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
    let server, timer, finished = false, exchanging = false, redirect;
    return new Promise((resolve, reject) => {
      const finish = error => { if (finished) return; finished = true; clearTimeout(timer); server?.close(); server?.closeAllConnections(); this.pending = null; error ? reject(error) : resolve(this.status()); };
      this.pending = { cancel: () => finish(new Error('Google sign-in cancelled.')) };
      server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const u = new URL(req.url, redirect);
        if (req.method !== 'GET' || u.pathname !== '/') { res.writeHead(404).end('Not found.'); return; }
        if (u.searchParams.get('state') !== state) { res.writeHead(400).end('Sign-in could not be verified.'); return; }
        if (exchanging) { res.writeHead(409).end('Sign-in already finishing.'); return; }
        if (u.searchParams.has('error')) { res.end('Access declined. Return to Fairy.'); finish(new Error(`Google ${this.service} access was declined.`)); return; }
        const code = u.searchParams.get('code'); if (!code || code.length > 4096) { res.writeHead(400).end('Missing code.'); return; }
        exchanging = true;
        try {
          const data = await this.tokenRequest({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
          if (finished || epoch !== this.epoch) return;
          await this.persist({ client, tokens: this.tokens(data, scopes) }, epoch);
          if (finished || epoch !== this.epoch) return;
          this.warning = ''; this.retryAt = 0; res.end(`Google ${this.service} is connected. You can return to Fairy.`); finish();
        } catch (error) { res.writeHead(400).end('Connection failed. Return to Fairy for details.'); finish(error); }
      });
      server.on('error', () => finish(new Error('Could not start Google sign-in. Close other sign-in attempts and retry.')));
      server.listen(0, '127.0.0.1', async () => {
        if (finished) return;
        redirect = `http://127.0.0.1:${server.address().port}/`;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
        try { await this.openExternal(url.href); } catch { finish(new Error('Could not open Google sign-in in your browser.')); }
      });
      timer = setTimeout(() => { this.epoch++; finish(new Error('Google sign-in timed out. Reconnect to try again.')); }, 300000); timer.unref?.();
    });
  }
  async accessToken(force = false) {
    if (!this.value?.tokens?.refreshToken) throw new Error(`Connect Google ${this.service} in Settings first.`);
    if (!force && this.value.tokens.expiresAt > this.now() + 60000) return this.value.tokens.accessToken;
    if (this.refreshing) return this.refreshing;
    const value = this.value, epoch = this.epoch;
    this.refreshing = (async () => {
      try {
        const data = await this.tokenRequest({ client_id: value.client.clientId, client_secret: value.client.clientSecret, grant_type: 'refresh_token', refresh_token: value.tokens.refreshToken });
        const next = { client: value.client, tokens: this.tokens(data, this.readScopes, value.tokens) }; await this.persist(next, epoch); return next.tokens.accessToken;
      } catch (e) { if (e.auth && epoch === this.epoch) { await this.persist({ client: value.client }, epoch); this.warning = e.message; } throw e; }
      finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async request(path, { method = 'GET', body, signal } = {}) {
    const epoch = this.epoch;
    if (this.now() < this.retryAt) throw new Error(`Google ${this.service} asked Fairy to wait. Try again later.`);
    let token = await this.accessToken();
    for (let i = 0; i < 2; i++) {
      signal?.throwIfAborted(); if (epoch !== this.epoch) throw new Error(`${this.service} connection changed.`);
      let r;
      try { r = await this.fetch(this.apiRoot + path, { method, redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20000)]), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
      catch (e) { if (method !== 'GET' && (path.includes('/events') || path === '/drafts')) throw new Error(`The write request was interrupted; it may have been saved. Check Google ${this.service} before trying again.`); throw e; }
      signal?.throwIfAborted(); if (epoch !== this.epoch) throw new Error(`${this.service} connection changed.`);
      if (r.status === 401 && i === 0) { token = await this.accessToken(true); continue; }
      if (r.status === 429) { this.retryAt = this.now() + Math.max(30, Math.min(3600, Number(r.headers.get('retry-after')) || 60)) * 1000; throw new Error(`Google ${this.service} rate limit reached. Try again later.`); }
      if (r.status === 403) throw new Error(`Google ${this.service} denied access. Check that its API is enabled and reconnect with the required permissions.`);
      if (!r.ok) throw new Error(`Google ${this.service} request failed (${r.status}).${method !== 'GET' && (path.includes('/events') || path === '/drafts') ? ` Check ${this.service} before retrying; the change may have been saved.` : ''}`);
      const data = await r.json(); signal?.throwIfAborted(); if (epoch !== this.epoch) throw new Error(`${this.service} connection changed.`); return data;
    }
  }
}
