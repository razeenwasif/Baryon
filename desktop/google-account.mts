import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { googleClient, type GoogleClient, type GoogleTokens } from './google-connection.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_IDENTITY_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const);

export interface GoogleAccountProfile {
  email: string;
  name: string;
  picture: string;
  sub: string;
}

export interface GoogleAccountStoredValue {
  client?: GoogleClient;
  tokens?: GoogleTokens;
  profile?: GoogleAccountProfile;
}

export interface GoogleAccountServiceStatus {
  connected: boolean;
  configured: boolean;
  [key: string]: unknown;
}

export interface GoogleAccountServiceLike {
  value?: { client?: GoogleClient | null } | null;
  readScopes?: string[];
  writeScope?: string;
  status?: () => GoogleAccountServiceStatus;
  importClient?: (json: unknown) => Promise<unknown>;
  adoptSharedTokens?: (creds: { client: GoogleClient; tokens: GoogleTokens }) => Promise<unknown>;
  clearTokens?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
}

export type GoogleAccountServices = {
  calendar?: GoogleAccountServiceLike;
  gmail?: GoogleAccountServiceLike;
  drive?: GoogleAccountServiceLike;
  [key: string]: GoogleAccountServiceLike | undefined;
};

export interface GoogleAccountStatus {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  email: string;
  name: string;
  picture: string;
  scopes: string[];
  services: {
    calendar: GoogleAccountServiceStatus;
    gmail: GoogleAccountServiceStatus;
    drive: GoogleAccountServiceStatus;
  };
  error: string;
}

export interface GoogleAccountSyncResult {
  connected: string[];
  skipped: string[];
  status: GoogleAccountStatus;
}

export interface GoogleAccountConnectResult extends GoogleAccountStatus {
  autoConnected: string[];
  skipped: string[];
}

export interface GoogleAccountOptions {
  read: () => Promise<GoogleAccountStoredValue | null>;
  write: (value: GoogleAccountStoredValue | null) => Promise<void>;
  openExternal: (url: string) => Promise<unknown> | unknown;
  fetchImpl?: typeof fetch;
  now?: () => number;
  services?: GoogleAccountServices;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
}

/**
 * Safely decodes an unverified JWT payload for display fallback (email/name/picture).
 */
export function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const data: unknown = JSON.parse(json);
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Manages a unified Google OAuth Desktop sign-in and fans shared tokens out to
 * Google Workspace services (Calendar, Gmail, Drive/Docs/Sheets/Slides).
 */
export class GoogleAccount {
  read: () => Promise<GoogleAccountStoredValue | null>;
  write: (value: GoogleAccountStoredValue | null) => Promise<void>;
  openExternal: (url: string) => Promise<unknown> | unknown;
  fetch: typeof fetch;
  now: () => number;
  services: GoogleAccountServices;
  value: GoogleAccountStoredValue | null = null;
  epoch = 0;
  writes: Promise<void> = Promise.resolve();
  pending: { cancel: () => void } | null = null;
  warning = '';

  constructor({ read, write, openExternal, fetchImpl = fetch, now = Date.now, services = {} }: GoogleAccountOptions) {
    this.read = read;
    this.write = write;
    this.openExternal = openExternal;
    this.fetch = fetchImpl;
    this.now = now;
    this.services = services;
  }

  async load(): Promise<GoogleAccountStatus> {
    try {
      this.value = await this.read();
    } catch {
      this.warning = 'Google account credentials could not be unlocked. Import the desktop client again.';
    }
    return this.status();
  }

  resolveClient(): GoogleClient | null {
    return (
      this.value?.client ||
      this.services.calendar?.value?.client ||
      this.services.gmail?.value?.client ||
      this.services.drive?.value?.client ||
      null
    );
  }

  status(): GoogleAccountStatus {
    return {
      configured: Boolean(this.resolveClient()),
      connected: Boolean(this.value?.tokens?.refreshToken),
      connecting: Boolean(this.pending),
      email: this.value?.profile?.email || '',
      name: this.value?.profile?.name || '',
      picture: this.value?.profile?.picture || '',
      scopes: String(this.value?.tokens?.scope || '').split(/\s+/).filter(Boolean),
      services: {
        calendar: this.services.calendar?.status?.() || { connected: false, configured: false },
        gmail: this.services.gmail?.status?.() || { connected: false, configured: false },
        drive: this.services.drive?.status?.() || { connected: false, configured: false },
      },
      error: this.warning || '',
    };
  }

  async persist(value: GoogleAccountStoredValue | null, epoch = this.epoch): Promise<void> {
    const task = this.writes.catch(() => {}).then(async () => {
      if (epoch !== this.epoch) throw new Error('Google account connection changed.');
      await this.write(value);
    });
    this.writes = task;
    await task;
    if (epoch !== this.epoch) throw new Error('Google account connection changed.');
    this.value = value;
  }

  close(): void {
    this.epoch++;
    this.pending?.cancel();
  }

  async importClient(json: unknown): Promise<GoogleAccountStatus> {
    const client = googleClient(json);
    this.close();
    const epoch = ++this.epoch;
    const sameClient = this.value?.client?.clientId === client.clientId;
    const nextValue: GoogleAccountStoredValue = sameClient && this.value?.tokens
      ? { client, tokens: this.value.tokens, ...(this.value.profile ? { profile: this.value.profile } : {}) }
      : { client };
    await this.persist(nextValue, epoch);
    const wrapped = { installed: { client_id: client.clientId, client_secret: client.clientSecret } };
    for (const svc of Object.values(this.services || {})) {
      if (svc && !svc.value?.client && typeof svc.importClient === 'function') {
        await svc.importClient(wrapped).catch(() => {});
      }
    }
    this.warning = '';
    return this.status();
  }

  async tokenRequest(body: Record<string, string>): Promise<GoogleTokenResponse> {
    const r = await this.fetch(TOKEN_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (!r.ok) {
      throw Object.assign(new Error('Google sign-in expired or was rejected. Reconnect your Google account in Settings.'), {
        auth: r.status === 400 || r.status === 401,
      });
    }
    return r.json() as Promise<GoogleTokenResponse>;
  }

  async fetchProfile(accessToken: string, idToken: unknown): Promise<GoogleAccountProfile> {
    let info: Record<string, unknown> | null = null;
    try {
      const r = await this.fetch(USERINFO_URL, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) info = (await r.json()) as Record<string, unknown>;
    } catch {}
    if (!info || typeof info !== 'object') info = decodeJwtPayload(idToken) || {};
    return {
      email: typeof info.email === 'string' ? info.email : '',
      name: typeof info.name === 'string' ? info.name : '',
      picture: typeof info.picture === 'string' ? info.picture : '',
      sub: typeof info.sub === 'string' ? info.sub : '',
    };
  }

  async syncServices({
    client = this.value?.client || this.resolveClient(),
    tokens = this.value?.tokens,
  }: { client?: GoogleClient | null; tokens?: GoogleTokens } = {}): Promise<GoogleAccountSyncResult> {
    const connected: string[] = [];
    const skipped: string[] = [];
    if (!client?.clientId || !tokens?.refreshToken) {
      return { connected, skipped, status: this.status() };
    }
    for (const [name, svc] of Object.entries(this.services || {})) {
      if (!svc || typeof svc.adoptSharedTokens !== 'function') {
        skipped.push(name);
        continue;
      }
      try {
        await svc.adoptSharedTokens({ client, tokens });
        connected.push(name);
      } catch {
        skipped.push(name);
      }
    }
    return { connected, skipped, status: this.status() };
  }

  async connect({
    services = ['calendar', 'gmail', 'drive'],
    writeAccess = false,
    switchAccount = false,
    loginHint = '',
  }: {
    services?: string[];
    writeAccess?: boolean;
    switchAccount?: boolean;
    loginHint?: string;
  } = {}): Promise<GoogleAccountConnectResult> {
    if (this.pending) throw new Error('Google sign-in is already open. Finish or cancel first.');
    const client = this.resolveClient();
    if (!client) throw new Error('Import your Google Desktop app JSON first.');
    const selectedNames = Array.isArray(services)
      ? services.filter(name => ['calendar', 'gmail', 'drive'].includes(name))
      : ['calendar', 'gmail', 'drive'];
    const scopeSet = new Set<string>(GOOGLE_IDENTITY_SCOPES);
    for (const name of selectedNames) {
      const svc = this.services?.[name];
      if (!svc) continue;
      for (const s of svc.readScopes || []) scopeSet.add(s);
      if (writeAccess && svc.writeScope) scopeSet.add(svc.writeScope);
    }
    const scopes = [...scopeSet];
    const epoch = ++this.epoch;
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    let server: Server | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let exchanging = false;
    let redirect = '';

    const result = await new Promise<GoogleAccountConnectResult>((resolve, reject) => {
      const finish = (error: unknown, value?: GoogleAccountConnectResult): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        server?.close();
        server?.closeAllConnections?.();
        this.pending = null;
        error ? reject(error) : resolve(value as GoogleAccountConnectResult);
      };
      this.pending = { cancel: () => finish(new Error('Google sign-in cancelled.')) };
      server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const u = new URL(req.url ?? '', redirect);
        if (req.method !== 'GET' || u.pathname !== '/') { res.writeHead(404).end('Not found.'); return; }
        if (u.searchParams.get('state') !== state) { res.writeHead(400).end('Sign-in could not be verified.'); return; }
        if (exchanging) { res.writeHead(409).end('Sign-in already finishing.'); return; }
        if (u.searchParams.has('error')) { res.end('Access declined. Return to Fairy.'); finish(new Error('Google sign-in was declined.')); return; }
        const code = u.searchParams.get('code');
        if (!code || code.length > 4096) { res.writeHead(400).end('Missing code.'); return; }
        exchanging = true;
        try {
          const data = await this.tokenRequest({
            client_id: client.clientId,
            client_secret: client.clientSecret || '',
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            redirect_uri: redirect,
          });
          if (finished || epoch !== this.epoch) return;
          const grantedScope = String(data.scope || scopes.join(' '));
          const refreshToken = (typeof data.refresh_token === 'string' && data.refresh_token) || this.value?.tokens?.refreshToken;
          if (typeof data.access_token !== 'string' || !refreshToken) {
            throw new Error('Google returned an incomplete connection. Please reconnect.');
          }
          const tokens: GoogleTokens = {
            accessToken: data.access_token,
            refreshToken,
            scope: grantedScope,
            expiresAt: this.now() + Math.max(0, Number(data.expires_in) || 0) * 1000,
          };
          const profile = await this.fetchProfile(tokens.accessToken, data.id_token);
          if (finished || epoch !== this.epoch) return;
          await this.persist({ client, tokens, profile }, epoch);
          if (finished || epoch !== this.epoch) return;
          this.warning = '';
          const syncResult = await this.syncServices({ client, tokens });
          res.end(`Google account${profile.email ? ` (${profile.email})` : ''} is connected to Fairy. You can return to Fairy.`);
          finish(null, { ...syncResult.status, autoConnected: syncResult.connected, skipped: syncResult.skipped });
        } catch (error: unknown) {
          res.writeHead(400).end('Connection failed. Return to Fairy for details.');
          finish(error);
        }
      });
      server.on('error', () => finish(new Error('Could not start Google sign-in. Close other sign-in attempts and retry.')));
      server.listen(0, '127.0.0.1', async () => {
        if (finished) return;
        redirect = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        const params: Record<string, string> = {
          client_id: client.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          scope: scopes.join(' '),
          access_type: 'offline',
          include_granted_scopes: 'true',
          prompt: switchAccount ? 'select_account consent' : 'consent',
          state,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        };
        if (!switchAccount && loginHint && typeof loginHint === 'string' && loginHint.includes('@')) {
          params.login_hint = loginHint.trim();
        }
        url.search = new URLSearchParams(params).toString();
        try {
          await this.openExternal(url.href);
        } catch {
          finish(new Error('Could not open Google sign-in in your browser.'));
        }
      });
      timer = setTimeout(() => {
        this.epoch++;
        finish(new Error('Google sign-in timed out. Reconnect to try again.'));
      }, 300000);
      timer.unref?.();
    });
    return result;
  }

  async disconnect({ keepClient = true, disconnectServices = true }: { keepClient?: boolean; disconnectServices?: boolean } = {}): Promise<GoogleAccountStatus> {
    this.close();
    const epoch = ++this.epoch;
    const client = this.value?.client || (keepClient ? this.resolveClient() : null);
    await this.persist(keepClient && client ? { client } : null, epoch);
    if (disconnectServices) {
      for (const svc of Object.values(this.services || {})) {
        if (!svc) continue;
        if (keepClient && typeof svc.clearTokens === 'function') await svc.clearTokens().catch(() => {});
        else if (typeof svc.disconnect === 'function') await svc.disconnect().catch(() => {});
      }
    }
    this.warning = '';
    return this.status();
  }
}
