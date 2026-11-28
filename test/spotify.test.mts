import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { SpotifyConnection, SCOPES, pagePath, spotifyLink } from '../desktop/spotify.mjs';
const id = 'a'.repeat(32);
const session = { clientId: id, accessToken: 'old-access', refreshToken: 'refresh', expiresAt: 1000000, scope: SCOPES.join(' ') };
const json = (body: any, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
function connection(fetchImpl: any, initial: any = session) {
  let saved = initial;
  const api = new SpotifyConnection({ read: async () => saved, write: async value => { saved = value; }, openExternal: async () => {}, fetchImpl, now: () => 1000 });
  return { api, saved: () => saved };
}
test('library pagination accepts only known routes and safe offsets', () => {
  assert.equal(pagePath('playlist', 50, 'A'.repeat(22)), `/playlists/${'A'.repeat(22)}/items?limit=50&offset=50`);
  assert.throws(() => pagePath('playlist', 0, '../../me'));
  assert.throws(() => pagePath('liked', -1));
  assert.throws(() => pagePath('https://attacker.test'));
  assert.equal(spotifyLink('https://open.spotify.com.evil.test/track/x'), null);
  assert.equal(spotifyLink('javascript:alert(1)'), null);
});
test('401 refresh retries once, persists rotated tokens, keeps secrets out of public status', async () => {
  const calls: any[] = [];
  const { api, saved } = connection(async (url: string, opts: any) => {
    calls.push([url, opts]);
    if (url.includes('/api/token')) return json({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 });
    if (opts.headers.Authorization === 'Bearer old-access') return json({}, 401);
    return new Response(null, { status: 204 });
  });
  await api.load(); assert.deepEqual(await api.nowPlaying(), { playing: false, track: null });
  assert.equal(calls.length, 3); assert.equal(saved().refreshToken, 'rotated');
  assert.ok(!JSON.stringify(api.status()).includes('rotated'));
});
test('new playlist item schema and null tracks render safely; next URLs are not followed', async () => {
  const urls: string[] = [];
  const { api } = connection(async (url: string) => { urls.push(url); return json({ total: 51, next: 'https://evil.test', items: [{ item: { type: 'track', name: '<script>unsafe</script>', artists: [{ name: 'Artist' }], external_urls: { spotify: 'https://open.spotify.com/track/abc' } } }, { item: null }] }); });
  await api.load(); const page = await api.library('playlist', 0, 'B'.repeat(22));
  assert.equal(page.next, 50); assert.equal(page.items.length, 1); assert.equal((page.items[0] as any).artists, 'Artist');
  assert.ok(urls.every(url => url.startsWith('https://api.spotify.com/v1/')));
});
test('429 blocks follow-up requests until retry window', async () => {
  let calls = 0; const { api } = connection(async () => { calls++; return json({}, 429, { 'retry-after': '120' }); });
  await api.load(); await assert.rejects(api.nowPlaying(), /rate limit/); await assert.rejects(api.nowPlaying(), /120 seconds/); assert.equal(calls, 1);
});
test('disconnect during token refresh cannot restore tokens or return library data', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const { api, saved } = connection(async () => { await gate; return json({ access_token: 'late', expires_in: 3600 }); }, { ...session, expiresAt: 0 });
  await api.load(); const result = api.nowPlaying(); await api.disconnect(); release();
  await assert.rejects(result, /connection changed/); assert.equal(saved(), null); assert.equal(api.status().connected, false);
});
test('OAuth binds loopback, validates state, uses PKCE and completes with read scopes', async () => {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as any).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  let opened!: (url: URL) => void; const openedPromise = new Promise<URL>(resolve => { opened = resolve; });
  let tokenBody: any;
  const { api, saved } = connection(async (_url: string, opts: any) => { tokenBody = opts.body; return json({ access_token: 'secret', refresh_token: 'refresh', expires_in: 3600, scope: SCOPES.join(' ') }); }, null);
  api.redirectUri = `http://127.0.0.1:${port}/callback`; api.openExternal = async url => opened(new URL(url));
  const login = api.connect(id); const auth = await openedPromise;
  assert.equal(auth.hostname, 'accounts.spotify.com'); assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const invalid = await fetch(`${api.redirectUri}?state=wrong&code=abc`); assert.equal(invalid.status, 400); assert.equal(saved(), null);
  const callback = await fetch(`${api.redirectUri}?state=${auth.searchParams.get('state')}&code=abc`);
  assert.equal(callback.status, 200); assert.equal((await login).connected, true);
  assert.equal(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.ok(SCOPES.every(scope => !scope.includes('modify') && !scope.includes('streaming')));
  await api.disconnect();
});
