import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

export const REDIRECT_URI = 'http://127.0.0.1:43821/callback';
export const SCOPES = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-read-currently-playing'];
const API = 'https://api.spotify.com/v1';
const TOKEN = 'https://accounts.spotify.com/api/token';
const idPattern = /^[A-Za-z0-9]{22}$/;

export interface SpotifyTrackArtist {
  name?: string;
}

export interface SpotifyTrackInput {
  type?: string;
  name?: string;
  artists?: SpotifyTrackArtist[];
  external_urls?: { spotify?: string };
  duration_ms?: number;
}

export interface SpotifyTrackView {
  name: string;
  artists: string;
  url: string | null;
  duration: number;
}

export interface SpotifySession {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export interface SpotifyStatus {
  connected: boolean;
  connecting: boolean;
  clientId: string;
  error: string;
  redirectUri: string;
}

export interface SpotifyTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface SpotifyConnectionOptions {
  read: () => Promise<SpotifySession | null>;
  write: (value: SpotifySession | null) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  redirectUri?: string;
}

interface SpotifyNowPlayingResponse {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrackInput | null;
}

interface SpotifyLibraryItem {
  id?: string;
  name?: string;
  external_urls?: { spotify?: string };
  owner?: { display_name?: string };
  items?: unknown;
  tracks?: unknown;
  track?: SpotifyTrackInput | null;
  item?: SpotifyTrackInput | null;
}

interface SpotifyLibraryResponse {
  items?: SpotifyLibraryItem[];
  total?: number;
  next?: string | null;
}

export interface SpotifyPlaylistView {
  id: string | undefined;
  name: string;
  url: string | null;
  owner: string;
  available: boolean;
}

export function clientId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value.trim())) throw new Error('Enter the 32-character Spotify Client ID, not the Client Secret.');
  return value.trim();
}
export function spotifyLink(value: unknown): string | null {
  try { const u = new URL(value as string); return u.protocol === 'https:' && u.hostname === 'open.spotify.com' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function trackView(track: SpotifyTrackInput | null | undefined): SpotifyTrackView | null {
  if (!track || track.type && track.type !== 'track') return null;
  return { name: String(track.name || 'Unavailable track'), artists: (track.artists || []).map(a => String(a.name || '')).join(', '), url: spotifyLink(track.external_urls?.spotify), duration: Number(track.duration_ms) || 0 };
}
export function pagePath(kind: string, offset = 0, playlistId?: string): string {
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid Spotify page.');
  const query = `?limit=50&offset=${offset}`;
  if (kind === 'liked') return '/me/tracks' + query;
  if (kind === 'playlists') return '/me/playlists' + query;
  if (kind === 'playlist' && typeof playlistId === 'string' && idPattern.test(playlistId)) return `/playlists/${playlistId}/items${query}`;
  throw new Error('Choose a valid Spotify library view.');
}

// Spotify data remains in this adapter and the dedicated library UI. It is
// never added to chat history, model prompts, speech requests or telemetry.
export class SpotifyConnection {
  read: () => Promise<SpotifySession | null>;
  write: (value: SpotifySession | null) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  fetch: typeof fetch;
  now: () => number;
  redirectUri: string;
  session: SpotifySession | null = null;
  epoch = 0;
  writes: Promise<unknown> = Promise.resolve();
  retryAt = 0;
  warning = '';
  pending: { cancel: () => void } | null = null;
  refreshing: Promise<string> | null = null;

  constructor({ read, write, openExternal, fetchImpl = fetch, now = Date.now, redirectUri = REDIRECT_URI }: SpotifyConnectionOptions) {
    this.read = read;
    this.write = write;
    this.openExternal = openExternal;
    this.fetch = fetchImpl;
    this.now = now;
    this.redirectUri = redirectUri;
  }
  async load(): Promise<SpotifyStatus> {
    try { this.session = await this.read(); } catch { this.warning = 'The saved Spotify connection could not be unlocked. Reconnect to continue.'; }
    return this.status();
  }
  status(): SpotifyStatus { return { connected: Boolean(this.session?.refreshToken), connecting: Boolean(this.pending), clientId: this.session?.clientId || '', error: this.warning || '', redirectUri: this.redirectUri }; }
  persist(value: SpotifySession | null): Promise<unknown> {
    const task = this.writes.catch(() => {}).then(() => this.write(value));
    this.writes = task; return task;
  }
  async disconnect(): Promise<SpotifyStatus> {
    this.epoch++; this.pending?.cancel(); this.session = null; this.warning = ''; this.retryAt = 0;
    await this.persist(null); return this.status();
  }
  close(): void { this.epoch++; this.pending?.cancel(); }
  async connect(value: unknown): Promise<SpotifyStatus> {
    const id = clientId(value);
    if (this.pending) throw new Error('Spotify sign-in is already open. Finish it or cancel first.');
    const epoch = ++this.epoch;
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirect = new URL(this.redirectUri);
    let server: Server | undefined, timer: ReturnType<typeof setTimeout> | undefined, finished = false, exchanging = false;
    return new Promise((resolve, reject) => {
      const finish = (err?: unknown) => {
        if (finished) return; finished = true; clearTimeout(timer); server?.close(); server?.closeAllConnections(); this.pending = null;
        if (err) reject(err); else resolve(this.status());
      };
      this.pending = { cancel: () => finish(new Error('Spotify sign-in cancelled.')) };
      server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const url = new URL(req.url ?? '/', this.redirectUri);
        if (req.method !== 'GET' || url.pathname !== redirect.pathname) { res.writeHead(404).end('Not found.'); return; }
        if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Sign-in could not be verified. Return to Fairy and try again.'); return; }
        if (exchanging) { res.writeHead(409).end('Sign-in is already finishing.'); return; }
        if (url.searchParams.has('error')) { res.end('Spotify access was declined. You can close this tab.'); finish(new Error('Spotify access was declined.')); return; }
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) { res.writeHead(400).end('Missing authorization code.'); return; }
        exchanging = true;
        try {
          const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, client_id: id, code_verifier: verifier });
          if (finished || epoch !== this.epoch) return;
          const session = this.tokenSession(tokens, id);
          await this.persist(session);
          if (finished || epoch !== this.epoch) return;
          this.session = session; this.warning = ''; this.retryAt = 0;
          res.end('Spotify is connected to Fairy. You can close this tab and return to the app.'); finish();
        } catch (error) { res.writeHead(400).end('Connection failed. Return to Fairy for details.'); finish(error); }
      });
      server.on('error', () => finish(new Error('Fairy could not open the Spotify sign-in port. Close any other sign-in attempt and try again.')));
      server.listen(Number(redirect.port), '127.0.0.1', async () => {
        const url = new URL('https://accounts.spotify.com/authorize');
        url.search = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: this.redirectUri, scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: challenge, show_dialog: 'true' }).toString();
        try { await this.openExternal(url.href); } catch { finish(new Error('Could not open the Spotify sign-in page.')); }
      });
      timer = setTimeout(() => finish(new Error('Spotify sign-in timed out. Please try again.')), 180000); timer.unref?.();
    });
  }
  async tokenRequest(values: Record<string, string>): Promise<SpotifyTokenResponse> {
    const response = await this.fetch(TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
    if (!response.ok) { const error = new Error('Spotify sign-in expired or was rejected. Reconnect in Music.') as Error & { auth?: boolean }; error.auth = response.status === 400 || response.status === 401; throw error; }
    return response.json() as Promise<SpotifyTokenResponse>;
  }
  tokenSession(tokens: SpotifyTokenResponse, id: string, previous?: SpotifySession): SpotifySession {
    const granted = new Set((tokens.scope ?? previous?.scope ?? '').split(' '));
    if (SCOPES.some(scope => !granted.has(scope))) throw new Error('Spotify did not grant all requested read permissions. Reconnect and allow library and playback access.');
    if (typeof tokens.access_token !== 'string' || !(tokens.refresh_token || previous?.refreshToken)) throw new Error('Spotify returned an incomplete connection. Please reconnect.');
    return { clientId: id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous!.refreshToken, expiresAt: this.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000, scope: [...granted].join(' ') };
  }
  async accessToken(force = false): Promise<string> {
    if (!this.session?.refreshToken) throw new Error('Connect Spotify in Music first.');
    if (!force && this.session.expiresAt > this.now() + 60000) return this.session.accessToken;
    if (this.refreshing) return this.refreshing;
    const session = this.session, epoch = this.epoch;
    this.refreshing = (async () => {
      try {
        const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: session.clientId });
        if (epoch !== this.epoch) throw new Error('Spotify connection changed.');
        const next = this.tokenSession(tokens, session.clientId, session); await this.persist(next);
        if (epoch !== this.epoch) throw new Error('Spotify connection changed.');
        this.session = next; return next.accessToken;
      } catch (error) {
        const err = error as Error & { auth?: boolean };
        if (err?.auth && epoch === this.epoch) { this.session = null; this.warning = err.message; await this.persist(null); }
        throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async request<T = unknown>(path: string): Promise<T | null> {
    const epoch = this.epoch;
    if (this.now() < this.retryAt) throw new Error(`Spotify asked Fairy to wait. Try again in ${Math.ceil((this.retryAt - this.now()) / 1000)} seconds.`);
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (epoch !== this.epoch) throw new Error('Spotify connection changed.');
      const response = await this.fetch(API + path, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (epoch !== this.epoch) throw new Error('Spotify connection changed.');
      if (response.status === 401 && attempt === 0) { token = await this.accessToken(true); continue; }
      if (response.status === 204) return null;
      if (response.status === 429) { this.retryAt = this.now() + Math.max(30, Number(response.headers.get('retry-after')) || 60) * 1000; throw new Error('Spotify rate limit reached. Updates will wait before trying again.'); }
      if (response.status === 403) throw new Error('Spotify denied access. Check Premium and the app’s allowed users. Playlist contents are only available for playlists you own or collaborate on.');
      if (!response.ok) throw new Error(`Spotify request failed (${response.status}). Try again or reconnect.`);
      return response.json() as Promise<T>;
    }
    return null;
  }
  async nowPlaying(): Promise<{ playing: boolean; progress?: number; track: SpotifyTrackView | null; fetchedAt?: number }> {
    const data = await this.request<SpotifyNowPlayingResponse>('/me/player/currently-playing');
    return data ? { playing: Boolean(data.is_playing), progress: Number(data.progress_ms) || 0, track: trackView(data.item), fetchedAt: this.now() } : { playing: false, track: null };
  }
  async library(kind: string, offset = 0, playlistId?: string): Promise<{ items: Array<SpotifyTrackView | SpotifyPlaylistView>; total: number; next: number | null }> {
    const data = await this.request<SpotifyLibraryResponse>(pagePath(kind, offset, playlistId));
    if (!data) return { items: [], total: 0, next: null };
    const items = (data.items || []).map(entry => kind === 'playlists' ? {
      id: entry.id, name: String(entry.name || 'Untitled playlist'), url: spotifyLink(entry.external_urls?.spotify),
      owner: String(entry.owner?.display_name || ''), available: Boolean(entry.items || entry.tracks),
    } : trackView(kind === 'liked' ? entry.track : entry.item ?? entry.track)).filter((item): item is SpotifyTrackView | SpotifyPlaylistView => Boolean(item));
    // Do not follow server-supplied URLs with authorization headers.
    return { items, total: Number(data.total) || 0, next: data.next ? offset + 50 : null };
  }
}
