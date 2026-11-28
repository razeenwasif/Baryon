import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GoogleAccount, GOOGLE_IDENTITY_SCOPES, decodeJwtPayload } from '../desktop/google-account.mjs';
import { CalendarConnection } from '../desktop/calendar.mjs';
import { GmailConnection } from '../desktop/gmail.mjs';
import { DriveConnection } from '../desktop/drive.mjs';
import { AntigravityConnection } from '../desktop/antigravity.mjs';
import { ConnectorStore } from '../desktop/mcp-client.mjs';
import { GOOGLE_SSO_PLUGINS, buildPluginAuthUrl, parseWwwAuthenticate, quickConnectPlugins } from '../desktop/plugin-quick-connect.mjs';
import { googleSsoPlugins } from '../src/plugins-catalog.js';
import { REMOTE, MINI_ONLY, READS, kindOf, isLong, isRead } from '../desktop/remote-channels.mjs';

const CLIENT_JSON = {
  installed: {
    client_id: '1234567890-abcdef123456.apps.googleusercontent.com',
    client_secret: 'test-secret-xyz',
  },
};

function memStore<T = any>(initial: T | null = null) {
  let value = initial;
  return {
    read: async () => value,
    write: async (next: T) => { value = next; },
    peek: () => value as any,
  };
}

test('GoogleConnection.adoptSharedTokens enforces required readScopes and clearTokens preserves client JSON', async () => {
  const calStore = memStore();
  const cal = new CalendarConnection({ read: calStore.read, write: calStore.write, openExternal: async () => {} });

  await assert.rejects(
    () => cal.adoptSharedTokens({
      client: { clientId: CLIENT_JSON.installed.client_id, clientSecret: 's' },
      tokens: { accessToken: 'tok', refreshToken: 'ref', scope: 'openid email' },
    }),
    /does not include Calendar permissions/,
  );

  const scopes = [...cal.readScopes, cal.writeScope].join(' ');
  const st = await cal.adoptSharedTokens({
    client: { clientId: CLIENT_JSON.installed.client_id, clientSecret: 's' },
    tokens: { accessToken: 'tok-1', refreshToken: 'ref-1', scope: scopes, expiresAt: Date.now() + 3600_000 },
  });
  assert.equal(st.connected, true);
  assert.equal(st.canWrite, true);

  const cleared = await cal.clearTokens();
  assert.equal(cleared.connected, false);
  assert.equal(cleared.configured, true);
  assert.equal(calStore.peek().client.clientId, CLIENT_JSON.installed.client_id);
});

test('GoogleAccount signs in once, auto-connects Calendar/Gmail/Drive, switches accounts cleanly, and signs out', async () => {
  const gaStore = memStore();
  const calStore = memStore();
  const gmailStore = memStore();
  const driveStore = memStore();

  const calendar = new CalendarConnection({ read: calStore.read, write: calStore.write, openExternal: async () => {} });
  const gmail = new GmailConnection({ read: gmailStore.read, write: gmailStore.write, openExternal: async () => {} });
  const drive = new DriveConnection({ read: driveStore.read, write: driveStore.write, openExternal: async () => {} });

  // Import client JSON only into Calendar first to verify resolveClient() inheritance.
  await calendar.importClient(CLIENT_JSON);

  const authRequests: URL[] = [];
  let tokenCounter = 0;

  const account = new GoogleAccount({
    read: gaStore.read,
    write: gaStore.write,
    services: { calendar, gmail, drive } as any,
    fetchImpl: (async (url: any, init: any) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        tokenCounter += 1;
        const body = init.body.toString();
        const params = new URLSearchParams(body);
        assert.equal(params.get('grant_type'), 'authorization_code');
        const allScopes = [
          ...GOOGLE_IDENTITY_SCOPES,
          ...calendar.readScopes, calendar.writeScope,
          ...gmail.readScopes, gmail.writeScope,
          ...drive.readScopes, drive.writeScope,
        ].join(' ');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `access-${tokenCounter}`,
            refresh_token: `refresh-${tokenCounter}`,
            expires_in: 3600,
            scope: allScopes,
          }),
        };
      }
      if (String(url).includes('openidconnect.googleapis.com/v1/userinfo')) {
        const email = tokenCounter === 1 ? 'alice@example.edu' : 'bob@work.dev';
        const name = tokenCounter === 1 ? 'Alice' : 'Bob';
        return {
          ok: true,
          status: 200,
          json: async () => ({ sub: `sub-${tokenCounter}`, email, name, picture: 'https://example.com/p.png' }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as any,
    openExternal: async href => {
      const authUrl = new URL(href);
      authRequests.push(authUrl);
      const redirect = new URL(authUrl.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('state', authUrl.searchParams.get('state')!);
      redirect.searchParams.set('code', `auth-code-${authRequests.length}`);
      const cbRes = await fetch(redirect.href);
      assert.equal(cbRes.status, 200);
    },
  });

  await account.load();
  assert.equal(account.status().configured, true);
  assert.equal(account.status().connected, false);

  const first = await account.connect({ writeAccess: true });
  assert.equal(first.connected, true);
  assert.equal(first.email, 'alice@example.edu');
  assert.deepEqual(first.autoConnected.sort(), ['calendar', 'drive', 'gmail']);
  assert.equal(calendar.status().connected, true);
  assert.equal(gmail.status().connected, true);
  assert.equal(drive.status().connected, true);
  assert.equal(calendar.status().canCreate, true);
  assert.equal(gmail.status().canDraft, true);
  assert.equal(drive.status().canCreate, true);
  assert.equal(authRequests[0].searchParams.get('include_granted_scopes'), 'true');
  assert.equal(authRequests[0].searchParams.get('prompt'), 'consent');

  // Switch Google account with select_account prompt.
  const second = await account.connect({ writeAccess: true, switchAccount: true });
  assert.equal(second.email, 'bob@work.dev');
  assert.equal(authRequests[1].searchParams.get('prompt'), 'select_account consent');
  assert.equal(gmailStore.peek().tokens.refreshToken, 'refresh-2');
  assert.equal(driveStore.peek().tokens.refreshToken, 'refresh-2');

  // Sign out keeping client JSON intact for instant next login.
  const signedOut = await account.disconnect({ keepClient: true, disconnectServices: true });
  assert.equal(signedOut.connected, false);
  assert.equal(signedOut.configured, true);
  assert.equal(signedOut.email, '');
  assert.equal(calendar.status().connected, false);
  assert.equal(calendar.status().configured, true);
  assert.equal(gmail.status().connected, false);
  assert.equal(drive.status().connected, false);
});

test('decodeJwtPayload parses valid unverified base64url JWT claims safely', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'jwt@example.com', name: 'JWT User' })).toString('base64url');
  assert.deepEqual(decodeJwtPayload(`hdr.${payload}.sig`), { email: 'jwt@example.com', name: 'JWT User' });
  assert.equal(decodeJwtPayload('not-a-jwt'), null);
});

test('AntigravityConnection.logout, switchAccount, and refreshAccount clear spare process and refresh usage', async () => {
  let spareKilled = 0;
  let modelsCall = 0;
  const terminalOpened: any[] = [];
  const usageCalls: any[] = [];

  const conn = new AntigravityConnection({
    cwd: '/tmp/fairy-agy-test-unused',
    executable: '/usr/local/bin/agy',
    listModels: async () => {
      modelsCall += 1;
      if (modelsCall === 1) return ''; // Simulate signed-out after headless /logout
      return 'gemini-4-carbon\tGemini 4 Carbon\n';
    },
    execFileProcess: ((_exe: any, args: any, _opts: any, cb: any) => {
      assert.ok(args.includes('/logout'));
      cb(null, 'logged out', '');
      return { stdin: { end: () => {} } };
    }) as any,
    openTerminal: async opts => { terminalOpened.push(opts); },
  });
  (conn as any).prepare = async () => {};
  (conn as any).spare = { closed: false, child: { kill: () => { spareKilled += 1; } } };

  const sw = await conn.switchAccount();
  assert.equal(spareKilled, 1);
  assert.equal(sw.started, true);
  assert.equal(sw.loggedOutHeadless, true);
  assert.equal(terminalOpened.length, 1);

  (conn as any).spare = { closed: false, child: { kill: () => { spareKilled += 1; } } };
  const refreshed = await conn.refreshAccount({
    planUsage: {
      refresh: async (opts: any) => { usageCalls.push(opts); },
    },
  });
  assert.equal(spareKilled, 2);
  assert.equal(refreshed.connected, true);
  assert.equal(refreshed.usageRefreshed, true);
  assert.deepEqual(usageCalls, [{ force: true, explicit: true }]);
});

test('plugin-quick-connect validates allowlisted Google-SSO URLs, adds MCP connectors, and avoids duplicates', async () => {
  assert.ok(googleSsoPlugins().some(p => p.id === 'notion'));
  assert.equal(buildPluginAuthUrl(GOOGLE_SSO_PLUGINS.firebase, 'dev@example.com'), 'https://console.firebase.google.com/?authuser=dev%40example.com');
  assert.equal(buildPluginAuthUrl({ authUrl: 'https://evil.example/phish', supportsLoginHint: true } as any, 'a@b.com'), '');
  assert.deepEqual(parseWwwAuthenticate('Bearer resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource"'), {
    resourceMetadataUrl: 'https://mcp.notion.com/.well-known/oauth-protected-resource',
  });
  assert.deepEqual(parseWwwAuthenticate('Bearer resource_metadata="http://169.254.169.254/latest"'), {});

  const store = memStore<any>({ version: 1, items: [] });
  let seq = 0;
  const connectors = new ConnectorStore({ read: store.read, write: store.write, id: () => `conn-${++seq}` });
  await connectors.load();

  const opened: string[] = [];
  const res1 = await quickConnectPlugins({
    pluginIds: ['notion', 'firebase'],
    connectors,
    email: 'me@gmail.com',
    openExternal: async url => { opened.push(url); },
    fetchImpl: (async () => ({
      ok: false,
      status: 401,
      headers: { get: (k: string) => (k === 'www-authenticate' ? 'Bearer resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource"' : null) },
    })) as any,
  });

  assert.equal(res1.results.length, 2);
  assert.equal(res1.results[0].id, 'notion');
  assert.equal(res1.results[0].added, true);
  assert.equal(res1.results[0].requiresAuth, true);
  assert.equal(res1.results[0].authOpened, true);
  assert.equal(res1.results[1].id, 'firebase');
  assert.equal(res1.results[1].added, true);
  assert.deepEqual(opened, ['https://www.notion.so/login', 'https://console.firebase.google.com/?authuser=me%40gmail.com']);
  assert.equal(connectors.state().length, 2);

  // Re-running with Notion should not add a duplicate connector.
  const res2 = await quickConnectPlugins({
    pluginIds: ['notion'],
    connectors,
    email: 'me@gmail.com',
    openBrowser: false,
    fetchImpl: (async () => ({ ok: true, status: 200, headers: { get: () => null } })) as any,
  });
  assert.equal(res2.results[0].added, false);
  assert.equal(res2.results[0].alreadyConnected, true);
  assert.equal(connectors.state().length, 2);

  // Hostile or unknown plugin IDs are rejected without adding connectors.
  const hostile = await quickConnectPlugins({
    pluginIds: ['../..', 'http://evil', '__proto__', 42, {}] as any,
    connectors,
    openBrowser: false,
  });
  assert.deepEqual(hostile.results, []);
  assert.equal(connectors.state().length, 2);
});

test('remote channels and UI files wire Google Account hub, SSO quick-connect, and Antigravity switcher', () => {
  assert.equal(kindOf('google-account-status'), 'remote');
  assert.equal(isRead('google-account-status'), true);
  assert.equal(isLong('google-account-status'), true);
  assert.equal(kindOf('antigravity-refresh'), 'remote');
  assert.equal(isLong('antigravity-refresh'), true);
  assert.equal(kindOf('plugin-quick-connect'), 'remote');
  assert.equal(isLong('plugin-quick-connect'), true);

  for (const ch of [
    'google-account-import',
    'google-account-help',
    'google-account-connect',
    'google-account-switch',
    'google-account-sync',
    'google-account-disconnect',
    'antigravity-logout',
    'antigravity-switch-account',
  ]) {
    assert.equal(kindOf(ch), 'mini-only', `${ch} must stay mini-only`);
  }
  assert.ok(READS.includes('google-account-status'));
  assert.ok(REMOTE.includes('antigravity-refresh'));
  assert.ok(REMOTE.includes('plugin-quick-connect'));

  const appJs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const pluginsJs = readFileSync(new URL('../src/plugins-view.ts', import.meta.url), 'utf8');
  const settingsJs = readFileSync(new URL('../src/google-account-settings.ts', import.meta.url), 'utf8');

  assert.match(appJs, /setupGoogleAccountSettings/);
  assert.match(appJs, /id="accounts-antigravity-switch"/);
  assert.match(appJs, /id="accounts-antigravity-logout"/);
  assert.match(appJs, /antigravityRefresh/);
  assert.match(pluginsJs, /renderGoogleAccountBar/);
  assert.match(pluginsJs, /quick-connect-sso/);
  assert.match(pluginsJs, /antigravitySwitchAccount/);
  assert.match(pluginsJs, /api\.openSource/);
  assert.match(settingsJs, /google-account-connect/);
  assert.match(settingsJs, /google-account-also-agy/);
});
