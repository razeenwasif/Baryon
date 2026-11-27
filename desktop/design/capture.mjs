// Phase 3: Offscreen Electron/Chromium Multi-Viewport Capture & Interactive State Verification.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]);

const DOM_AUDIT_SCRIPT = `(() => {
  const root = document.documentElement;
  const scrollWidth = Math.max(root ? root.scrollWidth : 0, document.body ? document.body.scrollWidth : 0);
  const innerWidth = window.innerWidth || 0;
  const textLen = (document.body?.innerText || '').trim().length;
  const controls = document.querySelectorAll('button, a, input, select, [role="tab"]');
  const transitions = [];
  const clickTargets = [...document.querySelectorAll('[role="tab"], [data-tab], [data-view], [data-theme-toggle]')].slice(0, 2);
  for (const el of clickTargets) {
    try {
      const label = (el.textContent || el.getAttribute('aria-label') || 'tab').trim().slice(0, 32);
      el.click();
      const postOverflow = Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0) > (window.innerWidth || 0) + 2;
      transitions.push({ label, ok: !postOverflow });
    } catch {}
  }
  return {
    scrollWidth,
    innerWidth,
    overflowX: scrollWidth > innerWidth + 2,
    textLen,
    interactiveCount: controls.length,
    transitions,
  };
})()`;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Render generated HTML across desktop (1440x900) & mobile (390x844) in isolated offscreen Chromium windows.
 */
export async function captureDesignPreview({
  html = '',
  url = '',
  viewports = DEFAULT_VIEWPORTS,
  BrowserWindowCtor = null,
  timeoutMs = 12_000,
} = {}) {
  if (!BrowserWindowCtor || (!html && !url)) {
    return {
      available: false,
      captures: [],
      consoleErrors: [],
      hasOverflow: false,
    };
  }

  let tempDir = '';
  let targetUrl = String(url || '').trim();
  if (!targetUrl) {
    tempDir = await mkdtemp(join(tmpdir(), 'baryon-design-cap-'));
    const htmlPath = join(tempDir, 'preview.html');
    await writeFile(htmlPath, String(html), 'utf8');
    targetUrl = pathToFileURL(htmlPath).href;
  }

  const captures = [];
  const consoleErrors = [];
  let hasOverflow = false;

  try {
    for (const vp of viewports) {
      const width = Number(vp?.width) || 1440;
      const height = Number(vp?.height) || 900;
      const name = String(vp?.name || `${width}x${height}`);
      const vpConsoleErrors = [];
      let win = null;

      try {
        win = new BrowserWindowCtor({
          show: false,
          width,
          height,
          useContentSize: true,
          backgroundColor: '#050507',
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            offscreen: false,
          },
        });

        win.webContents.on('console-message', (_event, level, message) => {
          if (level >= 2 && message && !String(message).includes('ERR_FILE_NOT_FOUND')) {
            const clean = String(message).slice(0, 240);
            vpConsoleErrors.push(clean);
            consoleErrors.push(`[${name}] ${clean}`);
          }
        });

        await Promise.race([
          new Promise((resolve, reject) => {
            win.webContents.once('did-finish-load', resolve);
            win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`Load failed (${code}): ${desc}`)));
            void win.loadURL(targetUrl);
          }),
          wait(timeoutMs).then(() => { throw new Error(`Capture timed out after ${timeoutMs}ms`); }),
        ]);

        await wait(280);
        const probe = await win.webContents.executeJavaScript(DOM_AUDIT_SCRIPT, true).catch(() => ({
          scrollWidth: width,
          innerWidth: width,
          overflowX: false,
          textLen: 0,
          interactiveCount: 0,
          transitions: [],
        }));

        if (probe.overflowX) hasOverflow = true;

        const shot = await win.webContents.capturePage();
        const scaledWidth = Math.min(width, 960);
        const dataUrl = shot.resize({ width: scaledWidth }).toDataURL();

        captures.push({
          name,
          width,
          height,
          dataUrl,
          overflowX: Boolean(probe.overflowX),
          scrollWidth: probe.scrollWidth,
          innerWidth: probe.innerWidth,
          interactiveCount: probe.interactiveCount || 0,
          transitions: Array.isArray(probe.transitions) ? probe.transitions : [],
          consoleErrors: vpConsoleErrors,
        });
      } catch (err) {
        vpConsoleErrors.push(err.message);
        consoleErrors.push(`[${name}] ${err.message}`);
        captures.push({
          name,
          width,
          height,
          dataUrl: '',
          overflowX: false,
          interactiveCount: 0,
          transitions: [],
          consoleErrors: vpConsoleErrors,
        });
      } finally {
        try {
          if (win && !win.isDestroyed()) win.destroy();
        } catch {}
      }
    }
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    available: true,
    captures,
    consoleErrors,
    hasOverflow,
  };
}
