/**
 * Structured catalog and live status resolver for Fairy's Plugins gallery.
 * Covers existing Google OAuth integrations, built-in capabilities,
 * one-click MCP templates (Linear, Notion, GitHub, Figma, etc.), and planned plugins.
 */

export const PLUGIN_SHELVES = Object.freeze([
  Object.freeze({
    id: 'google',
    title: 'Google Workspace',
    subtitle: 'Connect to Google Workspace, including Docs, Sheets, Slides, Drive, Calendar, and Gmail.',
  }),
  Object.freeze({
    id: 'builtin',
    title: 'Built into Fairy',
    subtitle: 'Model subscriptions, local knowledge, folders, and media already wired into Fairy.',
  }),
  Object.freeze({
    id: 'future',
    title: 'Productivity & Developer',
    subtitle: 'Connect popular tools today via MCP or track upcoming first-party Fairy plugins.',
  }),
  Object.freeze({
    id: 'connectors',
    title: 'Custom MCP Connectors',
    subtitle: 'MCP servers attached to Fairy work sessions, plus add any command or URL endpoint.',
  }),
]);

export const PLUGIN_CATALOG = Object.freeze([
  // Google Workspace
  Object.freeze({
    id: 'google-docs',
    shelf: 'google',
    name: 'Google Docs',
    description: 'Read, create, edit, and export native Google Docs via Google Drive.',
    icon: 'google-docs',
    kind: 'google-drive-sub',
    driveService: 'drive',
    keywords: ['google', 'workspace', 'docs', 'documents', 'writing', 'export'],
  }),
  Object.freeze({
    id: 'google-sheets',
    shelf: 'google',
    name: 'Google Sheets',
    description: 'Read, create, update, and export Google Sheets via Google Drive.',
    icon: 'google-sheets',
    kind: 'google-drive-sub',
    driveService: 'drive',
    keywords: ['google', 'workspace', 'sheets', 'spreadsheets', 'csv', 'data'],
  }),
  Object.freeze({
    id: 'google-slides',
    shelf: 'google',
    name: 'Google Slides',
    description: 'Read, create, and export Google Slides via Google Drive.',
    icon: 'google-slides',
    kind: 'google-drive-sub',
    driveService: 'drive',
    keywords: ['google', 'workspace', 'slides', 'presentations', 'decks'],
  }),
  Object.freeze({
    id: 'google-drive',
    shelf: 'google',
    name: 'Google Drive',
    description: 'Search, read, export Docs & Sheets, and create files.',
    icon: 'google-drive',
    kind: 'google-oauth',
    service: 'drive',
    featured: true,
    keywords: ['google', 'workspace', 'drive', 'files', 'docs', 'sheets', 'oauth'],
  }),
  Object.freeze({
    id: 'google-calendar',
    shelf: 'google',
    name: 'Google Calendar',
    description: 'Check availability, inspect schedule, and create events.',
    icon: 'google-calendar',
    kind: 'google-oauth',
    service: 'calendar',
    featured: true,
    keywords: ['google', 'workspace', 'calendar', 'schedule', 'events', 'meetings'],
  }),
  Object.freeze({
    id: 'gmail',
    shelf: 'google',
    name: 'Gmail',
    description: 'Search, read, summarize, and save reply drafts in Gmail.',
    icon: 'gmail',
    kind: 'google-oauth',
    service: 'gmail',
    featured: true,
    keywords: ['google', 'workspace', 'gmail', 'email', 'mail', 'drafts'],
  }),

  // Built into Fairy
  Object.freeze({
    id: 'gemini-agy',
    shelf: 'builtin',
    name: 'Gemini · Antigravity',
    description: 'Chat, screen vision, live search, and work sessions via agy.',
    icon: 'gemini',
    kind: 'builtin',
    settingsPane: 'accounts',
    keywords: ['gemini', 'google', 'antigravity', 'agy', 'model', 'vision'],
  }),
  Object.freeze({
    id: 'claude-code',
    shelf: 'builtin',
    name: 'Claude Code',
    description: 'Claude subscription chat, work sessions, and Pages sync.',
    icon: 'claude',
    kind: 'builtin',
    settingsPane: 'accounts',
    keywords: ['claude', 'anthropic', 'fable', 'work', 'subscription'],
  }),
  Object.freeze({
    id: 'codex',
    shelf: 'builtin',
    name: 'ChatGPT · Codex',
    description: 'ChatGPT subscription chat, desktop tasks, and Google tools.',
    icon: 'codex',
    kind: 'builtin',
    settingsPane: 'accounts',
    keywords: ['codex', 'openai', 'chatgpt', 'astra', 'desktop'],
  }),
  Object.freeze({
    id: 'spotify',
    shelf: 'builtin',
    name: 'Spotify',
    description: 'Live playback status, headphone dancing, and music control.',
    icon: 'spotify',
    kind: 'builtin',
    settingsPane: 'ideas',
    keywords: ['spotify', 'music', 'audio', 'playback', 'headphones'],
  }),
  Object.freeze({
    id: 'local-files',
    shelf: 'builtin',
    name: 'Local Files',
    description: 'Approved folders on this Mac for private search and editing.',
    icon: 'local-files',
    kind: 'builtin',
    settingsPane: 'integrations',
    keywords: ['files', 'folders', 'local', 'disk', 'mac', 'search'],
  }),
  Object.freeze({
    id: 'notes-books',
    shelf: 'builtin',
    name: 'Notes & Books',
    description: 'Local Markdown second brain and PDF library retrieval.',
    icon: 'notes-books',
    kind: 'builtin',
    settingsPane: 'notes',
    keywords: ['notes', 'books', 'markdown', 'pdf', 'library', 'rag'],
  }),

  // Productivity & Developer (MCP templates + planned)
  Object.freeze({
    id: 'linear',
    shelf: 'future',
    name: 'Linear',
    description: 'Manage issues, projects, and cycles across your Linear workspace.',
    icon: 'linear',
    kind: 'mcp-template',
    featured: true,
    googleAuth: true,
    authUrl: 'https://linear.app/login',
    mcp: Object.freeze({ name: 'linear', kind: 'url', target: 'https://mcp.linear.app/mcp' }),
    keywords: ['linear', 'issues', 'tasks', 'roadmap', 'mcp'],
  }),
  Object.freeze({
    id: 'notion',
    shelf: 'future',
    name: 'Notion',
    description: 'Search pages, databases, and docs across your Notion workspace.',
    icon: 'notion',
    kind: 'mcp-template',
    featured: true,
    googleAuth: true,
    authUrl: 'https://www.notion.so/login',
    mcp: Object.freeze({ name: 'notion', kind: 'url', target: 'https://mcp.notion.com/mcp' }),
    keywords: ['notion', 'wiki', 'docs', 'database', 'notes', 'mcp'],
  }),
  Object.freeze({
    id: 'github',
    shelf: 'future',
    name: 'GitHub',
    description: 'Repos, pull requests, issues, reviews, and CI checks.',
    icon: 'github',
    kind: 'mcp-template',
    mcp: Object.freeze({ name: 'github', kind: 'url', target: 'https://api.githubcopilot.com/mcp/' }),
    keywords: ['github', 'git', 'repos', 'pr', 'pull requests', 'ci', 'mcp'],
  }),
  Object.freeze({
    id: 'slack',
    shelf: 'future',
    name: 'Slack',
    description: 'Search channels, threads, and workspace messages.',
    icon: 'slack',
    kind: 'mcp-template',
    featured: true,
    googleAuth: true,
    authUrl: 'https://slack.com/signin',
    mcp: Object.freeze({ name: 'slack', kind: 'url', target: 'https://mcp.slack.com/mcp' }),
    keywords: ['slack', 'chat', 'channels', 'messages', 'team', 'mcp'],
  }),
  Object.freeze({
    id: 'figma',
    shelf: 'future',
    name: 'Figma',
    description: 'Inspect frames, tokens, and turn designs into code.',
    icon: 'figma',
    kind: 'mcp-template',
    googleAuth: true,
    authUrl: 'https://www.figma.com/login',
    mcp: Object.freeze({ name: 'figma', kind: 'url', target: 'https://mcp.figma.com/mcp' }),
    keywords: ['figma', 'design', 'ui', 'components', 'mcp'],
  }),
  Object.freeze({
    id: 'chrome-devtools',
    shelf: 'future',
    name: 'Chrome DevTools',
    description: 'Live browser automation, console logs, network, and DOM debugging.',
    icon: 'chrome-devtools',
    kind: 'mcp-template',
    mcp: Object.freeze({ name: 'chrome-devtools', kind: 'command', target: 'npx -y chrome-devtools-mcp@latest' }),
    keywords: ['chrome', 'devtools', 'browser', 'debug', 'network', 'mcp'],
  }),
  Object.freeze({
    id: 'firebase',
    shelf: 'future',
    name: 'Firebase',
    description: 'Prototype, inspect, and manage Firestore, Auth, and Hosting.',
    icon: 'firebase',
    kind: 'mcp-template',
    googleAuth: true,
    authUrl: 'https://console.firebase.google.com/',
    mcp: Object.freeze({ name: 'firebase', kind: 'command', target: 'npx -y firebase-tools@latest mcp' }),
    keywords: ['firebase', 'google', 'firestore', 'hosting', 'auth', 'mcp'],
  }),
  Object.freeze({
    id: 'cloudflare',
    shelf: 'future',
    name: 'Cloudflare',
    description: 'Build and manage Workers, KV, D1, and R2 storage.',
    icon: 'cloudflare',
    kind: 'mcp-template',
    mcp: Object.freeze({ name: 'cloudflare', kind: 'url', target: 'https://bindings.mcp.cloudflare.com/mcp' }),
    keywords: ['cloudflare', 'workers', 'r2', 'd1', 'kv', 'mcp'],
  }),
  Object.freeze({
    id: 'supabase',
    shelf: 'future',
    name: 'Supabase',
    description: 'Inspect Postgres schemas, Edge Functions, logs, and branches.',
    icon: 'supabase',
    kind: 'mcp-template',
    mcp: Object.freeze({ name: 'supabase', kind: 'url', target: 'https://mcp.supabase.com/mcp' }),
    keywords: ['supabase', 'postgres', 'database', 'sql', 'auth', 'mcp'],
  }),
  Object.freeze({
    id: 'vercel',
    shelf: 'future',
    name: 'Vercel',
    description: 'Inspect deployments, build logs, projects, and domains.',
    icon: 'vercel',
    kind: 'mcp-template',
    googleAuth: true,
    authUrl: 'https://vercel.com/login',
    mcp: Object.freeze({ name: 'vercel', kind: 'url', target: 'https://mcp.vercel.com' }),
    keywords: ['vercel', 'deployments', 'builds', 'hosting', 'nextjs', 'mcp'],
  }),
  Object.freeze({
    id: 'sentry',
    shelf: 'future',
    name: 'Sentry',
    description: 'Triage errors, stack traces, and performance regressions.',
    icon: 'sentry',
    kind: 'mcp-template',
    googleAuth: true,
    authUrl: 'https://sentry.io/auth/login/',
    mcp: Object.freeze({ name: 'sentry', kind: 'url', target: 'https://mcp.sentry.dev/mcp' }),
    keywords: ['sentry', 'errors', 'crashes', 'traces', 'monitoring', 'mcp'],
  }),
]);

/**
 * Returns plugins supporting guided Google-SSO connection.
 */
export function googleSsoPlugins() {
  return PLUGIN_CATALOG.filter(plugin => Boolean(plugin.googleAuth));
}

function matchConnector(plugin, connectors = []) {
  const list = Array.isArray(connectors) ? connectors : [];
  const nameKey = (plugin.mcp?.name || plugin.id || '').toLowerCase();
  const idKey = (plugin.id || '').toLowerCase();
  const targetKey = (plugin.mcp?.target || '').toLowerCase();
  return list.find(item => {
    const itemName = String(item?.name || '').trim().toLowerCase();
    const itemTarget = String(item?.target || '').trim().toLowerCase();
    return (
      (nameKey && itemName === nameKey) ||
      (idKey && itemName === idKey) ||
      (targetKey && itemTarget === targetKey)
    );
  }) || null;
}

/**
 * Resolves a plugin's live status badge, state, and install flag from Fairy's current state.
 */
export function resolvePluginStatus(plugin, live = {}) {
  if (!plugin) return { state: 'available', badge: 'Available', detail: '', installed: false };

  if (plugin.kind === 'google-oauth') {
    const status = live?.[plugin.service] || {};
    if (status.connected) {
      const write = Boolean(status.canCreate || status.canDraft);
      return {
        state: 'connected',
        badge: 'Connected',
        detail: write ? 'Read & write enabled' : 'Read access active',
        installed: true,
      };
    }
    if (status.error && status.configured) {
      return {
        state: 'attention',
        badge: 'Reconnect',
        detail: status.error,
        installed: true,
      };
    }
    if (status.configured) {
      return {
        state: 'configured',
        badge: 'Configured',
        detail: 'OAuth client ready — connect with Google to finish sign-in',
        installed: true,
      };
    }
    return {
      state: 'available',
      badge: 'Setup',
      detail: 'Import your Google Desktop app OAuth JSON to connect',
      installed: false,
    };
  }

  if (plugin.kind === 'google-drive-sub') {
    const drive = live?.drive || {};
    if (drive.connected) {
      return {
        state: 'connected',
        badge: 'Via Drive',
        detail: drive.canCreate ? 'Read & create files via Google Drive' : 'Export & read via Google Drive',
        installed: true,
      };
    }
    return {
      state: 'available',
      badge: 'Needs Drive',
      detail: 'Connect Google Drive to enable reading and exporting',
      installed: false,
    };
  }

  if (plugin.kind === 'builtin') {
    if (plugin.id === 'spotify') {
      const sp = live?.spotify || {};
      return sp.connected
        ? { state: 'connected', badge: 'Connected', detail: sp.name ? `Signed in as ${sp.name}` : 'Spotify account linked', installed: true }
        : { state: 'available', badge: 'Connect', detail: 'Link Spotify for live playback state and Music controls', installed: false };
    }
    if (plugin.id === 'local-files') {
      const count = Array.isArray(live?.files) ? live.files.length : 0;
      return count > 0
        ? { state: 'connected', badge: `${count} ${count === 1 ? 'folder' : 'folders'}`, detail: `${count} approved folder${count === 1 ? '' : 's'}`, installed: true }
        : { state: 'available', badge: 'Available', detail: 'Approve local folders for private read & search access', installed: false };
    }
    if (plugin.id === 'notes-books') {
      const enabled = live?.settings?.notesMode !== 'off';
      return enabled
        ? { state: 'connected', badge: 'Enabled', detail: 'Indexing Markdown notes and PDF library locally', installed: true }
        : { state: 'available', badge: 'Off', detail: 'Disabled in Settings -> Notes & books', installed: false };
    }
    if (plugin.id === 'gemini-agy') {
      const agy = live?.accounts?.antigravity || {};
      return agy.connected
        ? { state: 'connected', badge: 'Connected', detail: `${Array.isArray(agy.models) ? agy.models.length : 0} Gemini models ready via agy`, installed: true }
        : { state: 'available', badge: 'Setup', detail: agy.error || 'Sign in with Antigravity CLI under Accounts & keys', installed: false };
    }
    if (plugin.id === 'claude-code') {
      const claude = live?.accounts?.claude || {};
      return claude.connected
        ? { state: 'connected', badge: 'Connected', detail: claude.plan || 'Claude Code subscription active', installed: true }
        : { state: 'available', badge: 'Setup', detail: claude.error || 'Run claude auth login in Terminal', installed: false };
    }
    if (plugin.id === 'codex') {
      const sub = live?.accounts?.subscription || live?.accounts?.codex || {};
      return sub.connected
        ? { state: 'connected', badge: 'Connected', detail: 'ChatGPT subscription connected', installed: true }
        : { state: 'available', badge: 'Setup', detail: sub.error || 'Sign in with ChatGPT under Accounts & keys', installed: false };
    }
  }

  if (plugin.kind === 'mcp-template') {
    const match = matchConnector(plugin, live?.connectors);
    if (match) {
      return {
        state: 'connected',
        badge: 'MCP active',
        detail: match.target || 'Attached to work sessions',
        installed: true,
        connectorId: match.id,
      };
    }
    return {
      state: 'available',
      badge: 'MCP',
      detail: `Connect via ${plugin.mcp?.kind === 'command' ? 'local MCP command' : 'remote MCP URL'}`,
      installed: false,
    };
  }

  if (plugin.kind === 'planned') {
    return {
      state: 'planned',
      badge: 'Planned',
      detail: 'Coming natively to Fairy — or attach a custom MCP server today',
      installed: false,
    };
  }

  return { state: 'available', badge: 'Available', detail: '', installed: false };
}

/**
 * Filters plugin entries by text query, shelf category, and installed status.
 */
export function filterPlugins(plugins, { query = '', shelf = 'all', installedOnly = false, live = {} } = {}) {
  const list = Array.isArray(plugins) ? plugins : [];
  const q = String(query || '').trim().toLowerCase();
  return list.filter(plugin => {
    if (shelf && shelf !== 'all' && plugin.shelf !== shelf) return false;
    if (installedOnly && !resolvePluginStatus(plugin, live).installed) return false;
    if (!q) return true;
    const haystack = [
      plugin.name,
      plugin.description,
      plugin.shelf,
      ...(Array.isArray(plugin.keywords) ? plugin.keywords : []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
