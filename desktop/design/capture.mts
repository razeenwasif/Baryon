// Phase 3: Offscreen Electron/Chromium Multi-Viewport Capture & Interactive State Verification.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CaptureViewport {
  name?: string;
  width: number;
  height: number;
}

export interface CaptureTransition {
  label: string;
  ok: boolean;
}

interface DomAuditProbe {
  scrollWidth: number;
  innerWidth: number;
  overflowX: boolean;
  textLen: number;
  interactiveCount: number;
  transitions: CaptureTransition[];
}

export interface CaptureBrowserWindow {
  webContents: {
    on(event: 'console-message', listener: (event: unknown, level: number, message: string) => void): unknown;
    once(event: 'did-finish-load', listener: () => void): unknown;
    once(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string) => void): unknown;
    executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
    capturePage(): Promise<{ resize(options: { width: number }): { toDataURL(): string } }>;
  };
  loadURL(url: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
}

export type CaptureBrowserWindowConstructor = new (options: Record<string, unknown>) => CaptureBrowserWindow;

export interface CaptureDesignPreviewOptions {
  html?: string;
  url?: string;
  viewports?: readonly CaptureViewport[];
  BrowserWindowCtor?: CaptureBrowserWindowConstructor | null;
  timeoutMs?: number;
}

export interface DesignCaptureEntry {
  name: string;
  width: number;
  height: number;
  dataUrl: string;
  overflowX: boolean;
  scrollWidth?: number;
  innerWidth?: number;
  interactiveCount: number;
  transitions: CaptureTransition[];
  consoleErrors: string[];
}

export interface CaptureDesignPreviewResult {
  available: boolean;
  captures: DesignCaptureEntry[];
  consoleErrors: string[];
  hasOverflow: boolean;
}

export const DEFAULT_VIEWPORTS: readonly CaptureViewport[] = Object.freeze([
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

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Render generated HTML across desktop (1440x900) & mobile (390x844) in isolated offscreen Chromium windows.
 */
export async function captureDesignPreview({
  html = '',
  url = '',
  viewports = DEFAULT_VIEWPORTS,
  BrowserWindowCtor = null,
  timeoutMs = 12_000,
}: CaptureDesignPreviewOptions = {}): Promise<CaptureDesignPreviewResult> {
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

  const captures: DesignCaptureEntry[] = [];
  const consoleErrors: string[] = [];
  let hasOverflow = false;

  try {
    for (const vp of viewports) {
      const width = Number(vp?.width) || 1440;
      const height = Number(vp?.height) || 900;
      const name = String(vp?.name || `${width}x${height}`);
      const vpConsoleErrors: string[] = [];
      let win: CaptureBrowserWindow | null = null;

      try {
        const bw = new BrowserWindowCtor({
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
        win = bw;

        bw.webContents.on('console-message', (_event, level, message) => {
          if (level >= 2 && message && !String(message).includes('ERR_FILE_NOT_FOUND')) {
            const clean = String(message).slice(0, 240);
            vpConsoleErrors.push(clean);
            consoleErrors.push(`[${name}] ${clean}`);
          }
        });

        await Promise.race([
          new Promise<void>((resolve, reject) => {
            bw.webContents.once('did-finish-load', resolve);
            bw.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`Load failed (${code}): ${desc}`)));
            void bw.loadURL(targetUrl);
          }),
          wait(timeoutMs).then(() => { throw new Error(`Capture timed out after ${timeoutMs}ms`); }),
        ]);

        await wait(280);
        const probe = await bw.webContents.executeJavaScript<DomAuditProbe>(DOM_AUDIT_SCRIPT, true).catch((): DomAuditProbe => ({
          scrollWidth: width,
          innerWidth: width,
          overflowX: false,
          textLen: 0,
          interactiveCount: 0,
          transitions: [],
        }));

        if (probe.overflowX) hasOverflow = true;

        const shot = await bw.webContents.capturePage();
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
        const msg = err instanceof Error ? err.message : String(err);
        vpConsoleErrors.push(msg);
        consoleErrors.push(`[${name}] ${msg}`);
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
