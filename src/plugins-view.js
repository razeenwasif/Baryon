import './plugins-view.css';
import { PLUGIN_CATALOG, PLUGIN_SHELVES, filterPlugins, googleSsoPlugins, resolvePluginStatus } from './plugins-catalog.js';

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};

const cleanErr = error => String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

const ICONS = {
  'google-docs': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 2.5h8.2L19.5 7.8V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5Z" fill="#4285F4"/><path d="M14.2 2.5v5.3h5.3L14.2 2.5Z" fill="#A1C2FA"/><path d="M8 11.5h8M8 14.5h8M8 17.5h5.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  'google-sheets': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5" fill="#0F9D58"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10.5M15.5 9.5v10.5" stroke="#fff" stroke-width="1.35" stroke-opacity=".92"/></svg>`,
  'google-slides': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5" fill="#F4B400"/><rect x="7" y="8" width="10" height="8" rx="1" stroke="#fff" stroke-width="1.7" fill="none"/></svg>`,
  'google-drive': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.6 4.2h6.8l5.6 9.8h-6.8L8.6 4.2Z" fill="#FBBC04"/><path d="M3 14l3.4 5.8h11.2L21 14H3Z" fill="#4285F4"/><path d="M8.6 4.2 3 14l3.4 5.8L12 10 8.6 4.2Z" fill="#0F9D58"/></svg>`,
  'google-calendar': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16.5" rx="3" fill="#4285F4"/><rect x="6" y="7.5" width="12" height="10" rx="1.5" fill="#fff"/><text x="12" y="15.2" text-anchor="middle" font-size="8.2" font-weight="700" font-family="Inter,-apple-system,sans-serif" fill="#1967D2">31</text></svg>`,
  gmail: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7.5v9.8a1.2 1.2 0 0 0 1.2 1.2H7V11l5 3.7L17 11v7.5h1.8A1.2 1.2 0 0 0 20 17.3V7.5L12 13.4 4 7.5Z" fill="#EA4335"/><path d="M4 7.5V17.3A1.2 1.2 0 0 0 5.2 18.5H7V11L4 8.8V7.5Z" fill="#4285F4"/><path d="M20 7.5V17.3a1.2 1.2 0 0 1-1.2 1.2H17V11l3-2.2V7.5Z" fill="#34A853"/><path d="M4 7.3A1.5 1.5 0 0 1 6.4 6.1L12 10.3l5.6-4.2A1.5 1.5 0 0 1 20 7.3v1.5L12 14.7 4 8.8V7.3Z" fill="#FBBC04" fill-opacity=".92"/></svg>`,
  gemini: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5c.8 5.2 3.8 8.2 9 9-5.2.8-8.2 3.8-9 9-.8-5.2-3.8-8.2-9-9 5.2-.8 8.2-3.8 9-9Z" fill="url(#pv-gem)"/><defs><linearGradient id="pv-gem" x1="3" y1="3" x2="21" y2="21"><stop stop-color="#60A5FA"/><stop offset=".55" stop-color="#818CF8"/><stop offset="1" stop-color="#34D399"/></linearGradient></defs></svg>`,
  claude: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="#E58B5B" stroke-width="2" stroke-linecap="round"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 12M6 18 18 6" opacity=".95"/></g></svg>`,
  codex: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="#10A37F" stroke-width="1.9"/><path d="M8.5 10.2 12 8.2l3.5 2v3.6L12 15.8l-3.5-2v-3.6Z" stroke="#6EE7B7" stroke-width="1.6"/></svg>`,
  spotify: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#1DB954"/><path d="M7.6 9.8c3-.9 6.6-.6 9.2.8M8.3 12.8c2.4-.7 5.2-.4 7.3.7M9 15.6c1.8-.4 3.8-.2 5.4.6" stroke="#08120B" stroke-width="1.65" stroke-linecap="round"/></svg>`,
  'local-files': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.5a2 2 0 0 1 2-2H9.6l2 2H18.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-11Z" fill="#60A5FA" fill-opacity=".22" stroke="#9FB2FF" stroke-width="1.7"/></svg>`,
  'notes-books': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 4.5A2 2 0 0 1 7.5 3H18.5v15.5H7.5a2 2 0 0 0-2 2V4.5Z" fill="#9FB2FF" fill-opacity=".2" stroke="#9FB2FF" stroke-width="1.7"/><path d="M5.5 19.5A2 2 0 0 1 7.5 18H18.5v2.8H7.5" stroke="#9FB2FF" stroke-width="1.6"/><path d="M9.5 7.5h6M9.5 11h4.5" stroke="#ECEEF4" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  linear: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#5E6AD2" fill-opacity=".22" stroke="#8F9BFF" stroke-width="1.6"/><path d="M5.5 13.8 10.2 18.5M4.6 10.6 13.4 19.4M6.8 7.3 16.7 17.2" stroke="#8F9BFF" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  notion: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="#ECEEF4" fill-opacity=".92"/><path d="M8.5 16.5V8l6.8 8.5V8" stroke="#111216" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  github: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#ECEEF4" fill-opacity=".12" stroke="#ECEEF4" stroke-width="1.5"/><path d="M9.5 17.8v-2.1c-2.6.6-3.1-1.1-3.1-1.1-.4-1-1-1.3-1-1.3-.8-.5.1-.5.1-.5.9.1 1.4.9 1.4.9.8 1.3 2.1 1 2.6.7.1-.6.3-1 .6-1.2-2.1-.2-4.3-1-4.3-4.6 0-1 .4-1.9 1-2.5-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.6 1 1.5 1 2.5 0 3.6-2.2 4.4-4.3 4.6.3.3.6.9.6 1.8v2.7" stroke="#ECEEF4" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  slack: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 4v5.5H7.8a1.7 1.7 0 1 1 0-3.4H9.5M4 14.5h5.5v1.7a1.7 1.7 0 1 1-3.4 0V14.5" stroke="#E01E5A" stroke-width="2" stroke-linecap="round"/><path d="M14.5 4v5.5h1.7a1.7 1.7 0 1 0 0-3.4H14.5M20 9.5h-5.5V7.8a1.7 1.7 0 1 0 3.4 0V9.5" stroke="#2EB67D" stroke-width="2" stroke-linecap="round"/><path d="M14.5 20v-5.5h1.7a1.7 1.7 0 1 1 0 3.4H14.5M9.5 20v-5.5H7.8a1.7 1.7 0 1 0 0 3.4H9.5" stroke="#ECB22E" stroke-width="2" stroke-linecap="round"/></svg>`,
  figma: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4.5h3v4.5H9a2.25 2.25 0 0 1 0-4.5Z" fill="#F24E1E"/><path d="M12 4.5h3a2.25 2.25 0 0 1 0 4.5h-3V4.5Z" fill="#FF7262"/><path d="M9 9h3v4.5H9A2.25 2.25 0 0 1 9 9Z" fill="#A259FF"/><circle cx="14.25" cy="11.25" r="2.25" fill="#1ABCFE"/><path d="M9 13.5h3v2.25a2.25 2.25 0 1 1-3-2.12Z" fill="#0ACF83"/></svg>`,
  'chrome-devtools': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="#4285F4" stroke-width="2.2"/><path d="M5.5 7.5h6.5a4.5 4.5 0 0 1 4 2.4l3.5-2.4" stroke="#EA4335" stroke-width="2" stroke-linecap="round"/><path d="M4 13.2a8.8 8.8 0 0 0 7.5 7.7l3.2-5.5" stroke="#34A853" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3.4" fill="#4285F4" stroke="#ECEEF4" stroke-width="1.3"/></svg>`,
  firebase: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.2 17.2 8.7 4.6a.6.6 0 0 1 1.1-.1l2.8 5.2 2.9-3.6a.6.6 0 0 1 1 .2l1.8 10.9-6 3.5-6.1-3.5Z" fill="#FFA000"/><path d="m12.6 9.7 3.9 7.5-4.3 3.5-6-3.5 6.4-7.5Z" fill="#FFCA28"/></svg>`,
  cloudflare: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.8 17.5h11a3.2 3.2 0 0 0 .4-6.3 5 5 0 0 0-9.6-1.3 3.8 3.8 0 0 0-1.8 7.6Z" fill="#F38020" fill-opacity=".9"/></svg>`,
  supabase: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.3 20.4c-.4.5-1.3.2-1.3-.5v-6.4h7.1c1.1 0 1.7 1.2 1 2.1l-6.8 4.8ZM10.7 3.6c.4-.5 1.3-.2 1.3.5v6.4H4.9c-1.1 0-1.7-1.2-1-2.1l6.8-4.8Z" fill="#3ECF8E"/></svg>`,
  vercel: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.5 21 19.5H3L12 4.5Z" fill="#ECEEF4"/></svg>`,
  sentry: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.1 4.9a1.3 1.3 0 0 0-2.2 0L4.1 16.7a1.3 1.3 0 0 0 1.1 2h2.2a6.4 6.4 0 0 0-1.9-4.5l2-3.4a9.2 9.2 0 0 1 3.7 7.9h1.6a10.8 10.8 0 0 0-4.4-9l1.3-2.3 5.2 9a1.3 1.3 0 0 0 1.1.7h2.2a1.3 1.3 0 0 0 1.1-2L13.1 4.9Z" fill="#FB4226"/></svg>`,
  mcp: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7V3.5M15 7V3.5M7 7h10v4.8a5 5 0 0 1-10 0V7ZM12 17v3.5" stroke="#9FB2FF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  google: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6Z" fill="#4285F4"/><path d="M12 22c2.7 0 5-0.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H2.9v2.7A10 10 0 0 0 12 22Z" fill="#34A853"/><path d="M6.3 13.8a6 6 0 0 1 0-3.7V7.4H2.9a10 10 0 0 0 0 9.1l3.4-2.7Z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A10 10 0 0 0 2.9 7.4l3.4 2.7C7.1 7.8 9.4 6 12 6Z" fill="#EA4335"/></svg>`,
};

function iconSpan(name, className = 'pv-icon') {
  const box = el('span', className);
  box.innerHTML = ICONS[name] || ICONS.mcp;
  return box;
}

/**
 * Renders and manages Fairy's Antigravity-style Plugins & Integrations canvas view.
 */
export function pluginsView({
  api,
  root,
  sidebarButton,
  getSettings = () => ({}),
  isRemote = () => false,
  onOpenSettings = () => {},
  onOpenMusic = () => {},
  onIntegrationsChanged = () => {},
  onShow = () => {},
  onHide = () => {},
}) {
  let shown = false;
  let query = '';
  let activeShelf = 'all';
  let installedOnly = false;
  let plannedOnly = false;
  let featuredIndex = 0;
  let openItem = null; // plugin object or { kind: 'custom-mcp', connector? }
  let busyMessage = '';
  let busyError = false;
  let refreshSeq = 0;
  let live = {
    googleAccount: {},
    gmail: {},
    calendar: {},
    drive: {},
    spotify: {},
    files: [],
    connectors: [],
    settings: getSettings(),
    accounts: {},
  };

  const FEATURED_PLUGINS = PLUGIN_CATALOG.filter(p => p.featured);

  const safe = async (fn, fallback) => {
    try { return await fn(); } catch { return fallback; }
  };

  async function refresh() {
    if (!api) { render(); return; }
    const seq = ++refreshSeq;
    const fastPromise = Promise.all([
      safe(() => api.googleAccountStatus?.(), {}),
      safe(() => api.gmailStatus?.(), {}),
      safe(() => api.calendarStatus?.(), {}),
      safe(() => api.driveStatus?.(), {}),
      safe(() => api.spotifyStatus?.(), {}),
      safe(() => api.filesStatus?.(), []),
      safe(() => api.connectorsState?.(), []),
    ]);
    const accountsPromise = Promise.all([
      safe(() => api.claudeStatus?.(), {}),
      safe(() => api.antigravityStatus?.(), {}),
      safe(() => api.subscriptionStatus?.(false), {}),
    ]);

    const [googleAccount, gmail, calendar, drive, spotify, files, connectors] = await fastPromise;
    if (seq !== refreshSeq) return;
    live = {
      ...live,
      googleAccount: googleAccount || {},
      gmail: gmail || {},
      calendar: calendar || {},
      drive: drive || {},
      spotify: spotify || {},
      files: Array.isArray(files) ? files : [],
      connectors: Array.isArray(connectors) ? connectors : [],
      settings: getSettings() || {},
    };
    render();

    const [claude, antigravity, subscription] = await accountsPromise;
    if (seq !== refreshSeq) return;
    live = {
      ...live,
      settings: getSettings() || {},
      accounts: { claude: claude || {}, antigravity: antigravity || {}, subscription: subscription || {} },
    };
    render();
  }

  function renderGoogleAccountBar() {
    if (query.trim() || !['all', 'google', 'future'].includes(activeShelf) || installedOnly || plannedOnly) return null;
    const ga = live.googleAccount || {};
    const bar = el('section', 'pv-google-bar');
    bar.setAttribute('aria-label', 'Google Account hub');

    const info = el('div', 'pv-google-info');
    const badge = el('span', 'pv-google-badge');
    badge.innerHTML = ICONS.google;
    const copy = el('div', 'pv-google-copy');
    const title = ga.connected
      ? `Google Account · ${ga.email || ga.name || 'Signed in'}`
      : 'Google Account & Auto-Connect';
    const svcs = ga.services || {};
    const linkedCount = ['calendar', 'gmail', 'drive'].filter(k => svcs[k]?.connected).length;
    const subtitle = ga.connected
      ? `${linkedCount}/3 Workspace services active (Gmail, Calendar, Drive/Docs/Sheets/Slides). Also quick-connect Notion & SSO plugins.`
      : ga.configured
        ? 'Sign in with Google once to auto-connect Gmail, Calendar, Drive, Docs, Sheets & Slides.'
        : 'Import your Google OAuth JSON client once to unlock one-click Google Workspace sign-in.';
    copy.append(el('strong', '', title), el('p', '', subtitle));
    info.append(badge, copy);

    const actions = el('div', 'pv-google-actions');
    if (!ga.configured) {
      const importBtn = el('button', 'pv-btn-primary', 'Import Google JSON');
      importBtn.type = 'button';
      importBtn.disabled = !api?.googleAccountImport;
      importBtn.onclick = async () => {
        try {
          await api.googleAccountImport();
          await refresh();
          onIntegrationsChanged();
        } catch {}
      };
      const helpBtn = el('button', 'pv-btn-quiet', 'Google setup ↗');
      helpBtn.type = 'button';
      helpBtn.disabled = !api?.googleAccountHelp;
      helpBtn.onclick = () => api?.googleAccountHelp?.();
      const ssoBtn = el('button', 'pv-btn-quiet', 'Quick-connect SSO…');
      ssoBtn.type = 'button';
      ssoBtn.onclick = () => openDrawer({ kind: 'quick-connect-sso', name: 'Quick-connect Google-SSO plugins', description: 'Connect Notion, Linear, Slack, Figma, and other Google-SSO apps via MCP.', icon: 'google' });
      actions.append(importBtn, helpBtn, ssoBtn);
    } else if (!ga.connected) {
      const signBtn = el('button', 'pv-btn-primary', 'Sign in & Auto-Connect Google');
      signBtn.type = 'button';
      signBtn.onclick = () => openDrawer({ kind: 'google-account', name: 'Google Account', description: 'Sign in with one Google account to auto-connect Workspace plugins.', icon: 'google' });
      const ssoBtn = el('button', 'pv-btn-quiet', 'Quick-connect SSO…');
      ssoBtn.type = 'button';
      ssoBtn.onclick = () => openDrawer({ kind: 'quick-connect-sso', name: 'Quick-connect Google-SSO plugins', description: 'Connect Notion, Linear, Slack, Figma, and other Google-SSO apps via MCP.', icon: 'google' });
      actions.append(signBtn, ssoBtn);
    } else {
      const switchBtn = el('button', 'pv-btn-primary', 'Manage / Switch account');
      switchBtn.type = 'button';
      switchBtn.onclick = () => openDrawer({ kind: 'google-account', name: 'Google Account', description: 'Switch Google accounts or update auto-connected Workspace plugins.', icon: 'google' });
      const ssoBtn = el('button', 'pv-btn-quiet', 'Quick-connect Notion & SSO…');
      ssoBtn.type = 'button';
      ssoBtn.onclick = () => openDrawer({ kind: 'quick-connect-sso', name: 'Quick-connect Google-SSO plugins', description: 'Connect Notion, Linear, Slack, Figma, and other Google-SSO apps via MCP.', icon: 'google' });
      actions.append(switchBtn, ssoBtn);
    }

    bar.append(info, actions);
    return bar;
  }

  function renderFeaturedCard() {
    const featured = FEATURED_PLUGINS[featuredIndex] || FEATURED_PLUGINS[0];
    if (!featured || query.trim() || activeShelf !== 'all' || installedOnly || plannedOnly) return null;

    const card = el('section', 'pv-featured');
    card.setAttribute('aria-label', 'Featured plugin');

    const art = el('div', 'pv-featured-art');
    FEATURED_PLUGINS.slice(0, 6).forEach((plugin, index) => {
      const status = resolvePluginStatus(plugin, live);
      const tile = el('button', `pv-tile${index === featuredIndex ? ' is-selected' : ''}`);
      tile.type = 'button';
      tile.title = plugin.name;
      tile.setAttribute('aria-label', `Feature ${plugin.name}`);
      tile.append(iconSpan(plugin.icon, 'pv-tile-icon'));
      if (status.state === 'connected') tile.append(el('span', 'pv-tile-check', '✓'));
      tile.onclick = () => { featuredIndex = index; render(); };
      art.append(tile);
    });

    const copy = el('div', 'pv-featured-copy');
    const fStatus = resolvePluginStatus(featured, live);
    copy.append(
      el('span', 'pv-eyebrow', 'Featured'),
      el('h2', '', featured.name),
      el('p', '', featured.description),
    );

    const actions = el('div', 'pv-featured-actions');
    const primaryLabel = fStatus.installed ? 'Manage' : '+ Add';
    const primaryBtn = el('button', 'pv-btn-primary', primaryLabel);
    primaryBtn.type = 'button';
    primaryBtn.onclick = () => openDrawer(featured);
    const detailsBtn = el('button', 'pv-btn-quiet', 'Details');
    detailsBtn.type = 'button';
    detailsBtn.onclick = () => openDrawer(featured);
    actions.append(primaryBtn, detailsBtn);
    copy.append(actions);

    card.append(art, copy);
    return card;
  }

  function renderPluginRow(plugin) {
    const status = resolvePluginStatus(plugin, live);
    const row = el('div', 'pv-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${plugin.name} (${status.badge})`);

    const main = el('div', 'pv-row-main');
    const title = el('div', 'pv-row-title');
    title.append(el('strong', '', plugin.name));
    const badgeClass =
      status.state === 'connected' ? 'is-connected' :
      status.state === 'attention' ? 'is-attention' :
      status.state === 'configured' ? 'is-configured' :
      status.state === 'planned' ? 'is-planned' : '';
    title.append(el('span', `pv-badge ${badgeClass}`.trim(), status.badge));
    main.append(title, el('p', 'pv-row-desc', plugin.description));

    const act = el('button', 'pv-row-act', status.installed ? '⋮' : '+');
    act.type = 'button';
    act.title = status.installed ? `Configure ${plugin.name}` : `Add ${plugin.name}`;
    act.setAttribute('aria-label', act.title);
    act.onclick = event => { event.stopPropagation(); openDrawer(plugin); };

    row.onclick = () => openDrawer(plugin);
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrawer(plugin); } };

    row.append(iconSpan(plugin.icon), main, act);
    return row;
  }

  function renderCustomConnectorRow(connector) {
    const row = el('div', 'pv-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const item = { kind: 'custom-mcp', connector };
    const main = el('div', 'pv-row-main');
    const title = el('div', 'pv-row-title');
    title.append(el('strong', '', connector.name), el('span', 'pv-badge is-connected', 'MCP active'));
    main.append(title, el('p', 'pv-row-desc', connector.target || ''));

    const act = el('button', 'pv-row-act', '⋮');
    act.type = 'button';
    act.title = `Configure ${connector.name}`;
    act.onclick = event => { event.stopPropagation(); openDrawer(item); };

    row.onclick = () => openDrawer(item);
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrawer(item); } };

    row.append(iconSpan('mcp'), main, act);
    return row;
  }

  function openDrawer(item) {
    openItem = item;
    busyMessage = '';
    busyError = false;
    renderSheet();
  }

  function closeDrawer() {
    openItem = null;
    busyMessage = '';
    busyError = false;
    renderSheet();
  }

  function googleHandlers(plugin) {
    const s = plugin.service;
    if (s === 'calendar') {
      return {
        status: () => api.calendarStatus(),
        importClient: () => api.calendarImport(),
        help: () => api.calendarHelp(),
        connect: write => api.calendarConnect(write),
        disconnect: () => api.calendarDisconnect(),
        check: async () => {
          const res = await api.calendarCheck();
          return `Verified · ${res.count} calendar${res.count === 1 ? '' : 's'} accessible${res.primary ? ` (${res.primary})` : ''}.`;
        },
        accessOptions: [['read', 'Read schedules & availability'], ['create', 'Read + create personal events']],
        canWrite: live.calendar?.canCreate,
        useSharedClient: null,
      };
    }
    if (s === 'gmail') {
      return {
        status: () => api.gmailStatus(),
        importClient: () => api.gmailImport(),
        help: () => api.gmailHelp(),
        connect: write => api.gmailConnect(write),
        disconnect: () => api.gmailDisconnect(),
        check: async () => {
          const res = await api.gmailCheck();
          return `Verified · signed in as ${res.email || 'Gmail account'}.`;
        },
        accessOptions: [['read', 'Read email'], ['create', 'Read + save reply drafts']],
        canWrite: live.gmail?.canDraft,
        useSharedClient: { label: 'Use Calendar’s Google client', run: () => api.gmailUseCalendarClient() },
      };
    }
    return {
      status: () => api.driveStatus(),
      importClient: () => api.driveImport(),
      help: () => api.driveHelp(),
      connect: write => api.driveConnect(write),
      disconnect: () => api.driveDisconnect(),
      check: async () => {
        const res = await api.driveCheck();
        return `Verified · ${res.email || res.name || 'Google Drive connected'}.`;
      },
      accessOptions: [['read', 'Read files, Docs, Sheets & Slides'], ['create', 'Read + create/update Docs, Sheets & Slides']],
      canWrite: live.drive?.canCreate,
      useSharedClient: { label: 'Use Calendar/Gmail client', run: () => api.driveUseGoogleClient() },
    };
  }

  function renderSheet() {
    const backdrop = root.querySelector('.pv-sheet-backdrop');
    if (!backdrop) return;
    if (!openItem) {
      backdrop.hidden = true;
      backdrop.replaceChildren();
      return;
    }

    backdrop.hidden = false;
    const sheet = el('div', 'pv-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const isCustom = openItem.kind === 'custom-mcp';
    const titleText = isCustom ? (openItem.connector ? openItem.connector.name : 'Add custom MCP connector') : openItem.name;
    const iconName = isCustom ? 'mcp' : openItem.icon;

    const top = el('div', 'pv-sheet-top');
    const id = el('div', 'pv-sheet-id');
    id.append(iconSpan(iconName), el('div', '', ''));
    id.lastChild.append(el('h2', '', titleText), el('p', 'pv-sheet-note', isCustom ? 'Attach any local MCP CLI command or remote MCP URL endpoint to work sessions.' : openItem.description));
    const closeBtn = el('button', 'pv-sheet-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close plugin details');
    closeBtn.onclick = closeDrawer;
    top.append(id, closeBtn);
    sheet.append(top);

    const feedback = el('p', `pv-sheet-msg${busyError ? ' is-error' : ''}`, busyMessage);
    feedback.setAttribute('role', 'status');
    const setMsg = (msg, isError = false) => {
      busyMessage = msg;
      busyError = isError;
      feedback.textContent = msg;
      feedback.classList.toggle('is-error', isError);
    };

    const isHubSheet = openItem.kind === 'google-account' || openItem.kind === 'quick-connect-sso';
    if (!isCustom && !isHubSheet) {
      const status = resolvePluginStatus(openItem, live);
      const statusBox = el('div', `pv-sheet-status ${status.state === 'connected' ? 'is-connected' : status.state === 'attention' ? 'is-attention' : ''}`.trim());
      statusBox.textContent = `${status.badge}${status.detail ? ` — ${status.detail}` : ''}`;
      sheet.append(statusBox);
    }

    if (openItem.kind === 'quick-connect-sso' && isRemote()) {
      sheet.append(el('p', 'pv-sheet-note', 'Connected to your Mac mini: MCP connectors save on your mini, and Google-SSO login opens right here in this MacBook’s browser.'));
    } else if (isRemote() && (openItem.kind === 'google-oauth' || (openItem.kind === 'mcp-template' && !openItem.googleAuth) || isCustom || openItem.kind === 'google-account' || openItem.id === 'local-files' || openItem.id === 'gemini-agy')) {
      sheet.append(el('p', 'pv-sheet-note', 'Live status is synced from your Mac mini. Sign-in and credential changes happen on your Mac mini.'));
    }

    const runAction = async fn => {
      try {
        await fn();
        await refresh();
        onIntegrationsChanged();
      } catch (error) {
        setMsg(cleanErr(error), true);
      }
    };

    if (openItem.kind === 'google-account') {
      const ga = live.googleAccount || {};
      const statusBox = el('div', `pv-sheet-status ${ga.connected ? 'is-connected' : ga.error ? 'is-attention' : ''}`.trim());
      statusBox.textContent = ga.error
        ? `Reconnect — ${ga.error}`
        : ga.connected
          ? `Signed in — ${ga.name ? `${ga.name} (${ga.email || 'Google'})` : ga.email || 'Google account'}`
          : ga.configured
            ? 'Client ready — sign in with Google to auto-connect Workspace plugins'
            : 'Setup — import a Google OAuth Desktop JSON client first';
      sheet.append(statusBox);

      const accessWrap = el('label', 'pv-field');
      accessWrap.append('Workspace access scope');
      const select = el('select');
      select.append(
        new Option('Read Gmail, Calendar & Drive', 'read'),
        new Option('Read + save drafts, events & Docs', 'create'),
      );
      accessWrap.append(select);
      sheet.append(accessWrap);

      const svcChoices = [
        ['calendar', 'Google Calendar'],
        ['gmail', 'Gmail'],
        ['drive', 'Google Drive (includes Docs, Sheets & Slides)'],
      ];
      const svcBoxes = new Map();
      const checkList = el('div', 'pv-check-list');
      for (const [key, label] of svcChoices) {
        const row = el('label', 'pv-check-row');
        const left = el('span', 'pv-check-left');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = true;
        svcBoxes.set(key, cb);
        left.append(cb, el('span', '', label));
        const connected = Boolean(ga.services?.[key]?.connected);
        row.append(left, el('span', `pv-badge ${connected ? 'is-connected' : ''}`.trim(), connected ? 'Connected' : 'Ready'));
        checkList.append(row);
      }

      const agyRow = el('label', 'pv-check-row');
      const agyLeft = el('span', 'pv-check-left');
      const alsoAgyCb = el('input');
      alsoAgyCb.type = 'checkbox';
      agyLeft.append(alsoAgyCb, el('span', '', 'Also switch Antigravity (agy) Gemini account when switching'));
      agyRow.append(agyLeft);
      checkList.append(agyRow);
      sheet.append(checkList);

      const selectedServices = () => [...svcBoxes.entries()].filter(([, cb]) => cb.checked).map(([k]) => k);
      const actions = el('div', 'pv-sheet-actions');

      const connectBtn = el('button', 'pv-btn-primary', ga.connected ? 'Reconnect & Auto-Connect' : 'Sign in & Auto-Connect');
      connectBtn.type = 'button';
      connectBtn.disabled = !api?.googleAccountConnect || !ga.configured || isRemote();
      connectBtn.onclick = () => runAction(async () => {
        setMsg('Finish Google sign-in in your browser…');
        const res = await api.googleAccountConnect({
          services: selectedServices(),
          writeAccess: select.value === 'create',
        });
        const count = Array.isArray(res?.autoConnected) ? res.autoConnected.length : 0;
        setMsg(`Signed in${res?.email ? ` as ${res.email}` : ''} and auto-connected ${count} Workspace service${count === 1 ? '' : 's'}.`);
      });

      const switchBtn = el('button', 'pv-btn-quiet', 'Switch Google account');
      switchBtn.type = 'button';
      switchBtn.disabled = !api?.googleAccountSwitch || !ga.configured || isRemote();
      switchBtn.onclick = () => runAction(async () => {
        setMsg('Choose a Google account in your browser…');
        const res = await api.googleAccountSwitch({
          services: selectedServices(),
          writeAccess: select.value === 'create',
          alsoSwitchAntigravity: Boolean(alsoAgyCb.checked),
        });
        let msg = `Switched Google account${res?.email ? ` to ${res.email}` : ''}.`;
        if (res?.antigravitySwitch?.message) msg += ` ${res.antigravitySwitch.message}`;
        setMsg(msg);
      });

      const ssoNextBtn = el('button', 'pv-btn-quiet', 'Quick-connect Notion & SSO…');
      ssoNextBtn.type = 'button';
      ssoNextBtn.onclick = () => openDrawer({ kind: 'quick-connect-sso', name: 'Quick-connect Google-SSO plugins', description: 'Connect Notion, Linear, Slack, Figma, and other Google-SSO apps via MCP.', icon: 'google' });

      const signOutBtn = el('button', 'pv-btn-danger', 'Sign out');
      signOutBtn.type = 'button';
      signOutBtn.disabled = !api?.googleAccountDisconnect || !ga.connected || isRemote();
      signOutBtn.onclick = () => runAction(async () => {
        await api.googleAccountDisconnect({ keepClient: true, disconnectServices: true });
        setMsg('Signed out of Google Account and cleared Workspace tokens.');
      });
      actions.append(connectBtn, switchBtn, ssoNextBtn, signOutBtn);
      sheet.append(actions);

      const clientActions = el('div', 'pv-sheet-actions');
      const importBtn = el('button', 'pv-btn-quiet', 'Import Google client JSON');
      importBtn.type = 'button';
      importBtn.disabled = !api?.googleAccountImport || isRemote();
      importBtn.onclick = () => runAction(async () => {
        await api.googleAccountImport();
        setMsg('Google client JSON imported.');
      });
      const helpBtn = el('button', 'pv-btn-quiet', 'Open Google setup ↗');
      helpBtn.type = 'button';
      helpBtn.disabled = !api?.googleAccountHelp;
      helpBtn.onclick = () => runAction(() => api.googleAccountHelp());
      clientActions.append(importBtn, helpBtn);
      sheet.append(clientActions);
    } else if (openItem.kind === 'quick-connect-sso') {
      const ga = live.googleAccount || {};
      sheet.append(el('p', 'pv-sheet-note', ga.email
        ? `Signed in with Google as ${ga.email}. Third-party apps like Notion use their own Google-SSO browser consent; Fairy adds their MCP connector and opens each login page.`
        : 'Third-party apps like Notion and Linear issue their own OAuth tokens via Google SSO. Fairy adds their MCP connectors and opens each login page in your browser.'));
      const ssoList = googleSsoPlugins();
      const ssoBoxes = new Map();
      const checkList = el('div', 'pv-check-list');
      for (const plugin of ssoList) {
        const st = resolvePluginStatus(plugin, live);
        const row = el('label', 'pv-check-row');
        const left = el('span', 'pv-check-left');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !st.installed && (plugin.id === 'notion' || plugin.id === 'linear' || plugin.id === 'slack');
        ssoBoxes.set(plugin.id, cb);
        left.append(cb, iconSpan(plugin.icon), el('span', '', plugin.name));
        row.append(left, el('span', `pv-badge ${st.installed ? 'is-connected' : ''}`.trim(), st.installed ? 'MCP active' : 'SSO'));
        checkList.append(row);
      }
      sheet.append(checkList);

      const actions = el('div', 'pv-sheet-actions');
      const connectBtn = el('button', 'pv-btn-primary', 'Connect selected plugins');
      connectBtn.type = 'button';
      connectBtn.disabled = !api?.pluginQuickConnect;
      connectBtn.onclick = () => runAction(async () => {
        const picked = [...ssoBoxes.entries()].filter(([, cb]) => cb.checked).map(([id]) => id);
        if (!picked.length) throw new Error('Select at least one plugin to connect.');
        setMsg(`Adding MCP connectors & opening sign-in for ${picked.length} plugin${picked.length === 1 ? '' : 's'}…`);
        const res = await api.pluginQuickConnect({ pluginIds: picked, openBrowser: false });
        const results = res?.results || [];
        const addedCount = results.filter(r => r.added).length;
        let openedCount = 0;
        for (const r of results) {
          if (r.authUrl && api?.openSource) {
            try { await api.openSource(r.authUrl); openedCount += 1; } catch {}
          }
        }
        setMsg(`Processed ${results.length} plugin(s): ${addedCount} added to MCP, ${openedCount} browser sign-in window(s) opened.`);
      });
      actions.append(connectBtn);
      sheet.append(actions);
    } else if (!isCustom && openItem.kind === 'google-oauth') {
      const h = googleHandlers(openItem);
      const accessWrap = el('label', 'pv-field');
      accessWrap.append('Access scope');
      const select = el('select');
      for (const [val, label] of h.accessOptions) select.append(new Option(label, val));
      select.value = h.canWrite ? 'create' : 'read';
      accessWrap.append(select);
      sheet.append(accessWrap);

      const primaryRow = el('div', 'pv-sheet-actions');
      const status = resolvePluginStatus(openItem, live);
      const connectBtn = el('button', 'pv-btn-primary', status.state === 'attention' ? `Reconnect ${openItem.name}` : status.state === 'connected' ? `Update & Reconnect` : `Connect ${openItem.name}`);
      connectBtn.type = 'button';
      connectBtn.disabled = !api || status.state === 'available';
      connectBtn.onclick = () => runAction(async () => {
        setMsg('Finish Google sign-in in your browser…');
        await h.connect(select.value === 'create');
        setMsg(`${openItem.name} connected.`);
      });

      const checkBtn = el('button', 'pv-btn-quiet', 'Check connection');
      checkBtn.type = 'button';
      checkBtn.disabled = !api || status.state !== 'connected';
      checkBtn.onclick = () => runAction(async () => {
        setMsg(await h.check());
      });

      const disconnectBtn = el('button', 'pv-btn-danger', 'Disconnect');
      disconnectBtn.type = 'button';
      disconnectBtn.disabled = !api || status.state === 'available';
      disconnectBtn.onclick = () => runAction(async () => {
        await h.disconnect();
        setMsg(`${openItem.name} disconnected.`);
      });
      primaryRow.append(connectBtn, checkBtn, disconnectBtn);
      sheet.append(primaryRow);

      const setupNote = el('p', 'pv-sheet-note', 'Import a Google Desktop app OAuth JSON client (stored encrypted on this Mac), or reuse your existing Calendar/Gmail OAuth client.');
      sheet.append(setupNote);

      const clientRow = el('div', 'pv-sheet-actions');
      if (h.useSharedClient) {
        const reuseBtn = el('button', 'pv-btn-quiet', h.useSharedClient.label);
        reuseBtn.type = 'button';
        reuseBtn.disabled = !api;
        reuseBtn.onclick = () => runAction(async () => {
          await h.useSharedClient.run();
          setMsg('Shared Google OAuth client applied.');
        });
        clientRow.append(reuseBtn);
      }
      const importBtn = el('button', 'pv-btn-quiet', 'Import Google client JSON');
      importBtn.type = 'button';
      importBtn.disabled = !api;
      importBtn.onclick = () => runAction(async () => {
        await h.importClient();
        setMsg('Google client JSON imported.');
      });
      const helpBtn = el('button', 'pv-btn-quiet', 'Open Google setup');
      helpBtn.type = 'button';
      helpBtn.disabled = !api;
      helpBtn.onclick = () => runAction(() => h.help());
      clientRow.append(importBtn, helpBtn);
      sheet.append(clientRow);
    } else if (!isCustom && openItem.kind === 'google-drive-sub') {
      const drivePlugin = PLUGIN_CATALOG.find(p => p.id === 'google-drive');
      const note = el('p', 'pv-sheet-note', 'Fairy reads, exports, creates, and updates Google Docs, Google Sheets, and Google Slides through your Google Drive OAuth connection.');
      const actions = el('div', 'pv-sheet-actions');
      const openDriveBtn = el('button', 'pv-btn-primary', live.drive?.connected ? 'Manage Google Drive connection' : 'Configure Google Drive');
      openDriveBtn.type = 'button';
      openDriveBtn.onclick = () => { if (drivePlugin) openDrawer(drivePlugin); };
      actions.append(openDriveBtn);
      sheet.append(note, actions);
    } else if (isCustom || openItem.kind === 'mcp-template') {
      const status = isCustom ? (openItem.connector ? { installed: true, connectorId: openItem.connector.id } : { installed: false }) : resolvePluginStatus(openItem, live);
      const existing = openItem.connector || live.connectors.find(c => c.id === status.connectorId);

      const nameField = el('label', 'pv-field');
      nameField.append('Connector name');
      const nameInput = el('input');
      nameInput.maxLength = 30;
      nameInput.value = existing?.name || openItem.mcp?.name || '';
      nameInput.placeholder = 'linear';
      nameInput.disabled = Boolean(existing);
      nameField.append(nameInput);

      const kindField = el('label', 'pv-field');
      kindField.append('Runs as');
      const kindSelect = el('select');
      kindSelect.append(new Option('Remote MCP address (URL)', 'url'), new Option('Local command on this Mac', 'command'));
      kindSelect.value = existing?.kind || openItem.mcp?.kind || 'url';
      kindSelect.disabled = Boolean(existing);
      kindField.append(kindSelect);

      const targetField = el('label', 'pv-field');
      targetField.append('Command or URL endpoint');
      const targetInput = el('input');
      targetInput.maxLength = 2000;
      targetInput.value = existing?.target || openItem.mcp?.target || '';
      targetInput.placeholder = kindSelect.value === 'url' ? 'https://mcp.linear.app/mcp' : 'npx -y some-mcp-server';
      targetInput.disabled = Boolean(existing);
      kindSelect.onchange = () => { targetInput.placeholder = kindSelect.value === 'url' ? 'https://example.com/mcp' : 'npx -y some-mcp-server'; };
      targetField.append(targetInput);

      sheet.append(nameField, kindField, targetField);
      sheet.append(el('p', 'pv-sheet-note', 'MCP connectors give Fairy work sessions extra tools and run with your local account access. Fairy always asks for approval before running connector tools unless allowed for that chat.'));

      const actions = el('div', 'pv-sheet-actions');
      if (existing) {
        const testBtn = el('button', 'pv-btn-primary', 'Test tools');
        testBtn.type = 'button';
        testBtn.disabled = !api?.connectorTest;
        testBtn.onclick = () => runAction(async () => {
          setMsg('Connecting to MCP server…');
          const tools = await api.connectorTest(existing.id);
          setMsg(tools.length ? `${tools.length} tool${tools.length === 1 ? '' : 's'} discovered: ${tools.slice(0, 6).join(', ')}` : 'Connected, no tools listed.');
        });

        const removeBtn = el('button', 'pv-btn-danger', 'Remove connector');
        removeBtn.type = 'button';
        removeBtn.disabled = !api?.connectorRemove;
        removeBtn.onclick = () => runAction(async () => {
          await api.connectorRemove(existing.id);
          setMsg(`Removed ${existing.name}.`);
          if (isCustom) openItem = { kind: 'custom-mcp' };
        });
        actions.append(testBtn, removeBtn);
      } else {
        const addBtn = el('button', 'pv-btn-primary', '+ Add MCP connector');
        addBtn.type = 'button';
        addBtn.disabled = !api?.connectorAdd;
        addBtn.onclick = () => runAction(async () => {
          const added = await api.connectorAdd({ name: nameInput.value.trim(), kind: kindSelect.value, target: targetInput.value.trim() });
          setMsg(`Added ${nameInput.value.trim()} MCP connector.`);
          if (isCustom && Array.isArray(added)) openItem = { kind: 'custom-mcp', connector: added.at(-1) };
        });
        actions.append(addBtn);
      }
      if (!isCustom && openItem.googleAuth && api?.pluginQuickConnect) {
        const ssoBtn = el('button', 'pv-btn-quiet', existing ? 'Google SSO sign-in ↗' : 'Connect with Google SSO ↗');
        ssoBtn.type = 'button';
        ssoBtn.onclick = () => runAction(async () => {
          const res = await api.pluginQuickConnect({ pluginIds: [openItem.id], openBrowser: false });
          const r = res?.results?.[0];
          let opened = false;
          if (r?.authUrl && api?.openSource) {
            try { await api.openSource(r.authUrl); opened = true; } catch {}
          }
          setMsg(opened ? `Registered ${openItem.name} & opened Google SSO sign-in in your browser.` : (r?.detail || `Processed ${openItem.name}.`));
        });
        actions.append(ssoBtn);
      }
      sheet.append(actions);
    } else if (openItem.kind === 'builtin') {
      if (openItem.id === 'local-files') {
        const list = el('div', 'pv-folder-list');
        if (live.files.length) {
          for (const folder of live.files) {
            const row = el('div', 'pv-folder-row');
            row.append(el('span', '', folder.path || folder.name));
            const rm = el('button', 'pv-btn-quiet', 'Remove');
            rm.type = 'button';
            rm.onclick = () => runAction(() => api.filesRemove(folder.id));
            row.append(rm);
            list.append(row);
          }
        } else {
          list.append(el('p', 'pv-sheet-note', 'No local folders approved yet.'));
        }
        const actions = el('div', 'pv-sheet-actions');
        const addBtn = el('button', 'pv-btn-primary', 'Add approved folder…');
        addBtn.type = 'button';
        addBtn.disabled = !api?.filesAdd;
        addBtn.onclick = () => runAction(() => api.filesAdd());
        actions.append(addBtn);
        sheet.append(list, actions);
      } else {
        const actions = el('div', 'pv-sheet-actions');
        if (openItem.id === 'spotify') {
          const musicBtn = el('button', 'pv-btn-primary', 'Open Music & Spotify');
          musicBtn.type = 'button';
          musicBtn.onclick = () => { closeDrawer(); onOpenMusic(); };
          actions.append(musicBtn);
        }
        if (openItem.id === 'gemini-agy') {
          const switchBtn = el('button', 'pv-btn-primary', 'Switch Google account');
          switchBtn.type = 'button';
          switchBtn.disabled = !api?.antigravitySwitchAccount || isRemote();
          switchBtn.onclick = () => runAction(async () => {
            setMsg('Signing out and opening Antigravity login in Terminal…');
            const res = await api.antigravitySwitchAccount();
            setMsg(res?.message || 'Sign in with your other Google account in Terminal, then click Refresh & reload quota.');
          });
          actions.append(switchBtn);

          const refreshBtn = el('button', 'pv-btn-quiet', 'Refresh & reload quota');
          refreshBtn.type = 'button';
          refreshBtn.disabled = !(api?.antigravityRefresh || api?.antigravityStatus);
          refreshBtn.onclick = () => runAction(async () => {
            setMsg('Reloading Antigravity account & usage quota…');
            const st = api.antigravityRefresh ? await api.antigravityRefresh() : await api.antigravityStatus();
            setMsg(st?.connected ? `Connected · ${Array.isArray(st.models) ? st.models.length : 0} models ready.` : (st?.error || 'Not connected.'));
          });
          actions.append(refreshBtn);
        }
        if (openItem.settingsPane) {
          const settingsBtn = el('button', 'pv-btn-quiet', 'Open in Settings ↗');
          settingsBtn.type = 'button';
          settingsBtn.onclick = () => { closeDrawer(); onOpenSettings(openItem.settingsPane); };
          actions.append(settingsBtn);
        }
        sheet.append(actions);
      }
    } else if (openItem.kind === 'planned') {
      const note = el('p', 'pv-sheet-note', 'First-party Fairy OAuth support for this integration is planned. In the meantime, you can connect an MCP server endpoint or CLI immediately.');
      const actions = el('div', 'pv-sheet-actions');
      const mcpBtn = el('button', 'pv-btn-primary', 'Connect via custom MCP instead');
      mcpBtn.type = 'button';
      mcpBtn.onclick = () => openDrawer({ kind: 'custom-mcp', mcp: { name: openItem.id, kind: 'command', target: '' } });
      actions.append(mcpBtn);
      sheet.append(note, actions);
    }

    sheet.append(feedback);
    backdrop.replaceChildren(sheet);
  }

  function render() {
    const body = el('div', 'pv-body');

    // Top search & filters
    const top = el('div', 'pv-top');
    const searchWrap = el('div', 'pv-search-wrap');
    const searchIcon = el('span', 'pv-search-icon');
    searchIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`;
    const searchInput = el('input', 'pv-search');
    searchInput.type = 'search';
    searchInput.value = query;
    searchInput.placeholder = 'Search plugins, Google services, or MCP servers…';
    searchInput.setAttribute('aria-label', 'Search plugins');
    searchInput.oninput = () => {
      query = searchInput.value;
      renderShelvesOnly();
    };
    searchWrap.append(searchIcon, searchInput);
    if (query) {
      const clearBtn = el('button', 'pv-clear', '×');
      clearBtn.type = 'button';
      clearBtn.setAttribute('aria-label', 'Clear search');
      clearBtn.onclick = () => { query = ''; searchInput.value = ''; renderShelvesOnly(); searchInput.focus(); };
      searchWrap.append(clearBtn);
    }
    top.append(searchWrap);

    const chipsRow = el('div', 'pv-chips-row');
    const chips = el('div', 'pv-chips');
    const makeChip = (label, pressed, onclick) => {
      const b = el('button', 'pv-chip', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pressed));
      b.onclick = onclick;
      return b;
    };
    const installedCount = PLUGIN_CATALOG.filter(p => resolvePluginStatus(p, live).installed).length + (live.connectors?.length || 0);
    const plannedCount = PLUGIN_CATALOG.filter(p => resolvePluginStatus(p, live).state === 'planned').length;
    chips.append(
      makeChip('All', !installedOnly && !plannedOnly && activeShelf === 'all', () => { installedOnly = false; plannedOnly = false; activeShelf = 'all'; render(); }),
      makeChip(`Installed · ${installedCount}`, installedOnly, () => { installedOnly = !installedOnly; if (installedOnly) plannedOnly = false; render(); }),
      makeChip(`Planned · ${plannedCount}`, plannedOnly, () => { plannedOnly = !plannedOnly; if (plannedOnly) installedOnly = false; render(); }),
      ...PLUGIN_SHELVES.map(shelf =>
        makeChip(shelf.title, !installedOnly && !plannedOnly && activeShelf === shelf.id, () => {
          installedOnly = false;
          plannedOnly = false;
          activeShelf = activeShelf === shelf.id ? 'all' : shelf.id;
          render();
        }),
      ),
    );
    const headerActions = el('div', 'pv-header-actions');
    const settingsBtn = el('button', 'pv-link-btn', 'Settings -> Integrations ↗');
    settingsBtn.type = 'button';
    settingsBtn.onclick = () => onOpenSettings('integrations');
    headerActions.append(settingsBtn);
    chipsRow.append(chips, headerActions);
    top.append(chipsRow);

    const content = el('div', 'pv-content');
    body.append(top, content);

    const backdrop = el('div', 'pv-sheet-backdrop');
    backdrop.hidden = !openItem;
    backdrop.onclick = event => { if (event.target === backdrop) closeDrawer(); };

    root.replaceChildren(body, backdrop);

    function renderShelvesOnly() {
      const nodes = [];
      const gaBar = renderGoogleAccountBar();
      if (gaBar) nodes.push(gaBar);
      const banner = renderFeaturedCard();
      if (banner) nodes.push(banner);

      let matchedCatalog = filterPlugins(PLUGIN_CATALOG, { query, shelf: activeShelf === 'connectors' ? 'all' : activeShelf, installedOnly, live });
      if (plannedOnly) matchedCatalog = matchedCatalog.filter(p => resolvePluginStatus(p, live).state === 'planned');
      let anyShown = false;

      for (const shelf of PLUGIN_SHELVES) {
        if (activeShelf !== 'all' && activeShelf !== shelf.id) continue;
        if (shelf.id === 'connectors') {
          if (plannedOnly) continue;
          const q = query.trim().toLowerCase();
          const connectors = (live.connectors || []).filter(c => !q || `${c.name} ${c.target}`.toLowerCase().includes(q));
          if (installedOnly && !connectors.length) continue;
          if (q && !connectors.length) continue;
          anyShown = true;
          const sec = el('section', 'pv-shelf');
          const head = el('div', 'pv-shelf-head');
          head.append(el('h3', '', shelf.title), el('p', '', shelf.subtitle));
          const grid = el('div', 'pv-grid');
          for (const connector of connectors) grid.append(renderCustomConnectorRow(connector));

          if (!installedOnly) {
            const addRow = el('div', 'pv-row pv-add-row');
            addRow.setAttribute('role', 'button');
            addRow.tabIndex = 0;
            const addMain = el('div', 'pv-row-main');
            addMain.append(el('div', 'pv-row-title', ''), el('p', 'pv-row-desc', 'Attach any local stdio command or remote MCP URL endpoint'));
            addMain.firstChild.append(el('strong', '', 'Add custom MCP server'));
            const addBtn = el('button', 'pv-row-act', '+');
            addBtn.type = 'button';
            addBtn.setAttribute('aria-label', 'Add custom MCP server');
            addRow.onclick = () => openDrawer({ kind: 'custom-mcp' });
            addRow.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer({ kind: 'custom-mcp' }); } };
            addRow.append(iconSpan('mcp'), addMain, addBtn);
            grid.append(addRow);
          }

          sec.append(head, grid);
          nodes.push(sec);
          continue;
        }

        const items = matchedCatalog.filter(p => p.shelf === shelf.id);
        if (!items.length) continue;
        anyShown = true;
        const sec = el('section', 'pv-shelf');
        const head = el('div', 'pv-shelf-head');
        head.append(el('h3', '', shelf.title), el('p', '', shelf.subtitle));
        const grid = el('div', 'pv-grid');
        for (const item of items) grid.append(renderPluginRow(item));
        sec.append(head, grid);
        nodes.push(sec);
      }

      if (!anyShown) {
        nodes.push(el('div', 'pv-empty', 'No plugins match that filter yet — clear search or add a custom MCP server.'));
      }
      content.replaceChildren(...nodes);
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.gap = '24px';
    }

    renderShelvesOnly();
    renderSheet();
  }

  function setShown(value) {
    if (shown === value) return;
    shown = value;
    root.hidden = !value;
    document.documentElement.classList.toggle('plugins-open', value);
    sidebarButton?.classList.toggle('current', value);
    sidebarButton?.setAttribute('aria-pressed', String(value));
    if (value) {
      onShow();
      render();
      void refresh();
    } else {
      openItem = null;
      onHide();
    }
  }

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openItem) {
      event.stopPropagation();
      closeDrawer();
    }
  });

  return {
    show: () => setShown(true),
    hide: () => setShown(false),
    toggle: () => setShown(!shown),
    isShown: () => shown,
    refresh: () => (shown ? refresh() : Promise.resolve()),
  };
}
