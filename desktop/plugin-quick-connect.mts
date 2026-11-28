export interface McpPluginSpec {
  readonly name: string;
  readonly kind: 'url' | 'command';
  readonly target: string;
}

export interface GoogleSsoPlugin {
  readonly id: string;
  readonly name: string;
  readonly mcp: McpPluginSpec;
  readonly authUrl: string;
  readonly supportsLoginHint: boolean;
}

export interface WwwAuthenticateInfo {
  resourceMetadataUrl?: string;
  authorizationUri?: string;
}

export interface ProbeMcpResult extends WwwAuthenticateInfo {
  requiresAuth: boolean;
  reachable: boolean;
  status: number;
}

export interface McpConnectorItem {
  name?: string;
  target?: string;
}

export interface McpConnectorsClient {
  state?: () => McpConnectorItem[];
  add?: (mcp: McpPluginSpec) => Promise<unknown> | unknown;
}

export interface QuickConnectOptions {
  pluginIds?: string[];
  connectors?: McpConnectorsClient;
  email?: string;
  openExternal?: (url: string) => Promise<unknown> | unknown;
  openBrowser?: boolean;
  fetchImpl?: typeof fetch;
}

export interface QuickConnectResult {
  id: string;
  name: string;
  added: boolean;
  alreadyConnected: boolean;
  requiresAuth: boolean;
  resourceMetadataUrl?: string;
  authUrl: string;
  authOpened: boolean;
  detail: string;
}

const ALLOWED_AUTH_HOSTS = new Set([
  'www.notion.so',
  'linear.app',
  'slack.com',
  'www.figma.com',
  'console.firebase.google.com',
  'vercel.com',
  'sentry.io',
  'accounts.google.com',
]);

export const GOOGLE_SSO_PLUGINS = Object.freeze({
  notion: Object.freeze({
    id: 'notion',
    name: 'Notion',
    mcp: Object.freeze({ name: 'notion', kind: 'url' as const, target: 'https://mcp.notion.com/mcp' }),
    authUrl: 'https://www.notion.so/login',
    supportsLoginHint: false,
  }),
  linear: Object.freeze({
    id: 'linear',
    name: 'Linear',
    mcp: Object.freeze({ name: 'linear', kind: 'url' as const, target: 'https://mcp.linear.app/mcp' }),
    authUrl: 'https://linear.app/login',
    supportsLoginHint: false,
  }),
  slack: Object.freeze({
    id: 'slack',
    name: 'Slack',
    mcp: Object.freeze({ name: 'slack', kind: 'url' as const, target: 'https://mcp.slack.com/mcp' }),
    authUrl: 'https://slack.com/signin',
    supportsLoginHint: false,
  }),
  figma: Object.freeze({
    id: 'figma',
    name: 'Figma',
    mcp: Object.freeze({ name: 'figma', kind: 'url' as const, target: 'https://mcp.figma.com/mcp' }),
    authUrl: 'https://www.figma.com/login',
    supportsLoginHint: false,
  }),
  firebase: Object.freeze({
    id: 'firebase',
    name: 'Firebase',
    mcp: Object.freeze({ name: 'firebase', kind: 'command' as const, target: 'npx -y firebase-tools@latest mcp' }),
    authUrl: 'https://console.firebase.google.com/',
    supportsLoginHint: true,
  }),
  vercel: Object.freeze({
    id: 'vercel',
    name: 'Vercel',
    mcp: Object.freeze({ name: 'vercel', kind: 'url' as const, target: 'https://mcp.vercel.com' }),
    authUrl: 'https://vercel.com/login',
    supportsLoginHint: false,
  }),
  sentry: Object.freeze({
    id: 'sentry',
    name: 'Sentry',
    mcp: Object.freeze({ name: 'sentry', kind: 'url' as const, target: 'https://mcp.sentry.dev/mcp' }),
    authUrl: 'https://sentry.io/auth/login/',
    supportsLoginHint: false,
  }),
});

export type GoogleSsoPluginId = keyof typeof GOOGLE_SSO_PLUGINS;

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function isPrivateOrUnsafeHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return (
    !h ||
    h === 'localhost' ||
    h === 'metadata.google.internal' ||
    h === 'metadata.goog' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(h) ||
    /^\[?(?:::1|fe80:|fc00:|fd00:)/i.test(h)
  );
}

/**
 * Validates and builds an allowlisted HTTPS login URL for a Google-SSO plugin.
 */
export function buildPluginAuthUrl(plugin: Pick<GoogleSsoPlugin, 'authUrl' | 'supportsLoginHint'> | null | undefined, email = ''): string {
  if (!plugin?.authUrl) return '';
  let url: URL;
  try {
    url = new URL(plugin.authUrl);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (!ALLOWED_AUTH_HOSTS.has(url.hostname.toLowerCase())) return '';
  if (plugin.supportsLoginHint && typeof email === 'string' && EMAIL_RE.test(email.trim())) {
    url.searchParams.set('authuser', email.trim());
  }
  return url.href;
}

/**
 * Safely extracts HTTPS resource_metadata or authorization_uri from a WWW-Authenticate header.
 */
export function parseWwwAuthenticate(header = ''): WwwAuthenticateInfo {
  const text = String(header || '');
  const out: WwwAuthenticateInfo = {};
  for (const key of ['resource_metadata', 'authorization_uri']) {
    const m = new RegExp(`${key}="([^"]{1,1000})"`, 'i').exec(text);
    if (!m) continue;
    try {
      const u = new URL(m[1]);
      if (u.protocol === 'https:' && !isPrivateOrUnsafeHost(u.hostname)) {
        out[key === 'resource_metadata' ? 'resourceMetadataUrl' : 'authorizationUri'] = u.href;
      }
    } catch {}
  }
  return out;
}

/**
 * Probes a remote https:// MCP endpoint with an initialize payload to check for 401 OAuth challenges.
 */
export async function probeMcpEndpoint(targetUrl: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<ProbeMcpResult> {
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'https:' || isPrivateOrUnsafeHost(u.hostname)) {
      return { requiresAuth: false, reachable: false, status: 0 };
    }
    const res = await fetchImpl(u.href, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fairy-probe-1',
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fairy', version: '1.0.0' } },
      }),
    });
    if (res.status === 401 || res.status === 403) {
      const meta = parseWwwAuthenticate(res.headers?.get?.('www-authenticate') || '');
      return { requiresAuth: true, reachable: true, status: res.status, ...meta };
    }
    return { requiresAuth: false, reachable: res.ok, status: res.status };
  } catch {
    return { requiresAuth: false, reachable: false, status: 0 };
  }
}

/**
 * Registers selected Google-SSO-compatible MCP plugins in Fairy and opens each service's sign-in flow.
 */
export async function quickConnectPlugins({
  pluginIds = [],
  connectors,
  email = '',
  openExternal,
  openBrowser = true,
  fetchImpl = fetch,
}: QuickConnectOptions = {}): Promise<{ email: string; results: QuickConnectResult[] }> {
  const uniqueIds = [...new Set((Array.isArray(pluginIds) ? pluginIds : []).filter((v): v is string => typeof v === 'string').map(v => v.trim()))]
    .filter((id): id is GoogleSsoPluginId => Object.hasOwn(GOOGLE_SSO_PLUGINS, id))
    .slice(0, 10);

  const existingList = Array.isArray(connectors?.state?.()) ? connectors.state() : [];
  const results: QuickConnectResult[] = [];

  for (const id of uniqueIds) {
    const plugin = GOOGLE_SSO_PLUGINS[id];
    const match = existingList.find(
      item =>
        String(item?.name || '').trim().toLowerCase() === plugin.mcp.name.toLowerCase() ||
        String(item?.target || '').trim().toLowerCase() === plugin.mcp.target.toLowerCase(),
    );

    let added = false;
    const alreadyConnected = Boolean(match);
    let detail = '';

    if (!match && typeof connectors?.add === 'function') {
      try {
        await connectors.add(plugin.mcp);
        added = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: unknown }).message ?? '') : '');
        detail = msg || 'Could not add MCP connector.';
      }
    }

    const probe: ProbeMcpResult = plugin.mcp.kind === 'url'
      ? await probeMcpEndpoint(plugin.mcp.target, { fetchImpl })
      : { requiresAuth: false, reachable: true, status: 0 };

    const authUrl = buildPluginAuthUrl(plugin, email);
    let authOpened = false;
    if (openBrowser && typeof openExternal === 'function' && authUrl) {
      try {
        await openExternal(authUrl);
        authOpened = true;
      } catch {}
    }

    if (!detail) {
      if (added) {
        detail = authOpened
          ? 'Added MCP connector and opened Google-SSO sign-in in your browser.'
          : 'Added MCP connector; complete sign-in in the app or MCP OAuth prompt.';
      } else if (alreadyConnected) {
        detail = authOpened
          ? 'MCP connector already active; opened sign-in page in your browser.'
          : 'MCP connector already active.';
      }
    }

    results.push({
      id: plugin.id,
      name: plugin.name,
      added,
      alreadyConnected,
      requiresAuth: Boolean(probe.requiresAuth),
      ...(probe.resourceMetadataUrl ? { resourceMetadataUrl: probe.resourceMetadataUrl } : {}),
      authUrl,
      authOpened,
      detail,
    });
  }

  return { email: typeof email === 'string' ? email : '', results };
}
