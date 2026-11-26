import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUGIN_CATALOG, PLUGIN_SHELVES, filterPlugins, resolvePluginStatus } from '../src/plugins-catalog.js';

test('PLUGIN_SHELVES and PLUGIN_CATALOG expose Google Workspace, Built-in, Productivity/MCP, and Connectors', () => {
  const shelfIds = PLUGIN_SHELVES.map(shelf => shelf.id);
  assert.deepEqual(shelfIds, ['google', 'builtin', 'future', 'connectors']);

  const ids = new Set(PLUGIN_CATALOG.map(plugin => plugin.id));
  for (const required of [
    'gmail',
    'google-calendar',
    'google-drive',
    'google-docs',
    'google-sheets',
    'google-slides',
    'spotify',
    'local-files',
    'notes-books',
    'gemini-agy',
    'claude-code',
    'codex',
    'linear',
    'notion',
    'github',
    'slack',
    'figma',
    'chrome-devtools',
    'firebase',
    'cloudflare',
    'supabase',
    'vercel',
    'sentry',
  ]) {
    assert.ok(ids.has(required), `Expected plugin ${required} in catalog`);
  }
});

test('resolvePluginStatus derives live status for Google OAuth, Drive sub-apps, built-ins, MCP connectors, and planned items', () => {
  const byId = id => PLUGIN_CATALOG.find(p => p.id === id);

  assert.deepEqual(
    resolvePluginStatus(byId('gmail'), { gmail: { connected: true, configured: true, canDraft: true } }),
    { state: 'connected', badge: 'Connected', detail: 'Read & write enabled', installed: true },
  );
  assert.deepEqual(
    resolvePluginStatus(byId('google-calendar'), { calendar: { configured: true, error: 'Token expired' } }),
    { state: 'attention', badge: 'Reconnect', detail: 'Token expired', installed: true },
  );
  assert.equal(resolvePluginStatus(byId('google-drive'), { drive: { configured: true } }).state, 'configured');
  assert.equal(resolvePluginStatus(byId('google-drive'), {}).state, 'available');

  // Docs, Sheets, and Slides derive their state from Google Drive.
  assert.equal(resolvePluginStatus(byId('google-docs'), { drive: { connected: true } }).badge, 'Via Drive');
  assert.equal(resolvePluginStatus(byId('google-sheets'), { drive: { connected: false } }).badge, 'Needs Drive');
  assert.equal(resolvePluginStatus(byId('google-slides'), { drive: { connected: true } }).badge, 'Via Drive');
  assert.equal(resolvePluginStatus(byId('google-slides'), { drive: { connected: false } }).badge, 'Needs Drive');

  // Built-in services.
  assert.equal(resolvePluginStatus(byId('spotify'), { spotify: { connected: true, name: 'Razeen' } }).installed, true);
  assert.equal(resolvePluginStatus(byId('local-files'), { files: [{ id: 'f1', path: '/tmp' }] }).badge, '1 folder');
  assert.equal(resolvePluginStatus(byId('notes-books'), { settings: { notesMode: 'off' } }).installed, false);
  assert.equal(resolvePluginStatus(byId('gemini-agy'), { accounts: { antigravity: { connected: true, models: ['a', 'b'] } } }).installed, true);

  // MCP template matching against installed connectors.
  const linearConnected = resolvePluginStatus(byId('linear'), {
    connectors: [{ id: 'conn-1', name: 'linear', kind: 'url', target: 'https://mcp.linear.app/mcp' }],
  });
  assert.equal(linearConnected.state, 'connected');
  assert.equal(linearConnected.installed, true);
  assert.equal(linearConnected.connectorId, 'conn-1');
  assert.equal(resolvePluginStatus(byId('notion'), { connectors: [] }).installed, false);

  for (const id of ['slack', 'supabase', 'vercel', 'sentry']) {
    const p = byId(id);
    assert.equal(p.kind, 'mcp-template');
    assert.equal(resolvePluginStatus(p, { connectors: [] }).badge, 'MCP');
    assert.equal(
      resolvePluginStatus(p, { connectors: [{ id: `c-${id}`, name: p.mcp.name, kind: 'url', target: p.mcp.target }] }).badge,
      'MCP active',
    );
  }

  // Planned plugins still resolve cleanly to 'planned'.
  assert.equal(resolvePluginStatus({ id: 'demo', kind: 'planned' }, {}).state, 'planned');
});

test('filterPlugins filters by search query, shelf, and installed-only toggle', () => {
  const live = {
    gmail: { connected: true, configured: true },
    drive: { connected: true, configured: true },
    connectors: [{ id: 'c1', name: 'linear', kind: 'url', target: 'https://mcp.linear.app/mcp' }],
  };

  const google = filterPlugins(PLUGIN_CATALOG, { shelf: 'google', live });
  assert.ok(google.every(p => p.shelf === 'google'));
  assert.equal(google.length, 6);

  const searchMail = filterPlugins(PLUGIN_CATALOG, { query: 'email', live });
  assert.equal(searchMail.length, 1);
  assert.equal(searchMail[0].id, 'gmail');

  const installedFuture = filterPlugins(PLUGIN_CATALOG, { shelf: 'future', installedOnly: true, live });
  assert.deepEqual(installedFuture.map(p => p.id), ['linear']);
});

test('Plugins view is wired into sidebar, workspace grid, wallpaper rules, slash commands, and settings', () => {
  const appJs = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  const wallpaperCss = readFileSync(new URL('../src/wallpaper.css', import.meta.url), 'utf8');
  const pluginsJs = readFileSync(new URL('../src/plugins-view.js', import.meta.url), 'utf8');
  const pluginsCss = readFileSync(new URL('../src/plugins-view.css', import.meta.url), 'utf8');

  assert.match(appJs, /id="sidebar-plugins"/);
  assert.match(appJs, /id="plugins-view"/);
  assert.match(appJs, /id="open-plugins-from-settings"/);
  assert.match(appJs, /name:\s*'plugins'/);
  assert.match(appJs, /import\('\.\/plugins-view\.js'\)/);
  assert.match(appJs, /'plugins-open'/);

  assert.match(workspaceCss, /#sidebar-plugins\{--icon:url\(/);
  assert.match(workspaceCss, /#sidebar-plugins\{--icon:url\("data:image\/svg\+xml,%3Csvg[^>]*%3E%3Cpath d='M5\.5 7H8\.5/, 'Plugins sidebar button uses jigsaw piece SVG icon');
  assert.match(workspaceCss, /\.plugins-open[,)]/);
  assert.match(wallpaperCss, /\.plugins-open/);
  assert.match(pluginsJs, /export function pluginsView\(/);
  assert.match(pluginsCss, /#plugins-view/);
});

test('read-only plugin status channels are allowed for MacBook face window', async () => {
  const { kindOf, READS } = await import('../desktop/remote-channels.mjs');
  for (const ch of ['calendar-status', 'gmail-status', 'drive-status', 'spotify-status', 'connectors-state', 'claude-status', 'antigravity-status', 'subscription-status']) {
    assert.equal(kindOf(ch), 'remote', `${ch} is remote-accessible`);
    assert.ok(READS.includes(ch), `${ch} is marked read-only`);
  }
});
