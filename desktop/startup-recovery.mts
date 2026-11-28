export interface StartupRecoveryOptions {
  title?: string;
  error?: unknown;
  logPath?: string;
  version?: string;
  recoveryActions?: readonly string[];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Generates a self-contained, zero-bundle recovery HTML page with strict CSP and escaped diagnostics.
 */
export function buildStartupRecoveryHtml({
  title = 'Fairy could not load its window',
  error = 'Renderer bundle failed to load.',
  logPath = '',
  version = '',
  recoveryActions = ['Run npm run build in the repo', 'Restart Fairy from Applications', 'Inspect the main process log'],
}: StartupRecoveryOptions = {}): string {
  const actionsHtml = (Array.isArray(recoveryActions) ? recoveryActions : [])
    .map(step => `<li>${escapeHtml(step)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #08080a; color: #eceef4; font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; }
  main { max-width: 560px; width: 100%; background: #14151a; border: 1px solid rgba(159,178,255,.24); border-radius: 16px; padding: 22px 24px; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  .meta { font-size: 12px; color: #9da3b4; margin-bottom: 14px; }
  pre { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #0c0d11; border: 1px solid rgba(255,255,255,.08); white-space: pre-wrap; word-break: break-word; color: #fecdd3; font-size: 12px; }
  ul { margin: 8px 0 0 18px; padding: 0; color: #d5d8e2; }
  li { margin: 4px 0; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${version ? `Version ${escapeHtml(version)}` : 'Startup Recovery'}${logPath ? ` · Log: <code>${escapeHtml(logPath)}</code>` : ''}</div>
  <pre>${escapeHtml(error)}</pre>
  <strong>Suggested recovery steps</strong>
  <ul>${actionsHtml}</ul>
</main>
</body>
</html>`;
}

export function buildStartupRecoveryDataUrl(options: StartupRecoveryOptions = {}): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildStartupRecoveryHtml(options))}`;
}
