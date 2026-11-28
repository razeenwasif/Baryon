import '@xterm/xterm/css/xterm.css';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// See-through, so the window's background shows behind the shell.
const THEME = { background: 'rgba(0, 0, 0, 0)', foreground: '#dfe1e8', cursor: '#9fb2ff', selectionBackground: '#3e5aec66' };
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface TerminalPaneApi {
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => unknown;
  onTerminalExit: (callback: (payload: { id: string }) => void) => unknown;
  terminalStart: (options?: { cwd?: string; cols: number; rows: number }) => Promise<{ id: string }>;
  terminalWrite: (id: string, data: string) => Promise<unknown> | unknown;
  terminalResize: (id: string, cols: number, rows: number) => Promise<unknown> | unknown;
  terminalSnapshot?: (id: string) => Promise<{ scrollback?: string } | null>;
}

export interface TerminalPaneOptions {
  api?: TerminalPaneApi | null;
  sessionKey: () => string;
  folder: () => string;
  onError: (message: string) => void;
}

export interface TerminalPaneController {
  id: 'terminal';
  title: string;
  wide: () => boolean;
  type: (text: unknown) => Promise<boolean>;
  leave: () => void;
  render: (body: HTMLElement) => Promise<void>;
}

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  id: string | null;
  opened: boolean;
}

// A real shell for each chat, opened in its work folder. It stays running while you're in other chats.
export function terminalPane({ api, sessionKey, folder, onError }: TerminalPaneOptions): TerminalPaneController {
  const terminals = new Map<string, TerminalEntry>(), byId = new Map<string, TerminalEntry>();
  let shown: TerminalEntry | null = null, observer: ResizeObserver | null = null;
  if (api) {
    api.onTerminalData(({ id, data }) => byId.get(id)?.term.write(data));
    api.onTerminalExit(({ id }) => {
      const entry = byId.get(id);
      if (entry) {
        byId.delete(id);
        entry.id = null;
        entry.term.write('\r\n\x1b[90m[Shell ended. Press any key to start a new one.]\x1b[0m\r\n');
      }
    });
  }
  async function start(entry: TerminalEntry): Promise<void> {
    if (!api) return;
    const { id } = await api.terminalStart({ cwd: folder(), cols: entry.term.cols, rows: entry.term.rows });
    entry.id = id; byId.set(id, entry);
  }
  async function create(): Promise<TerminalEntry> {
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
    const term = new Terminal({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, cursorBlink: true, scrollback: 5000, theme: THEME, allowTransparency: true, macOptionIsMeta: true });
    const fit = new FitAddon(), host = element('div', 'terminal-host'), entry: TerminalEntry = { term, fit, host, id: null, opened: false };
    term.loadAddon(fit);
    term.onData(data => {
      if (entry.id) api?.terminalWrite(entry.id, data);
      else start(entry).catch((error: unknown) => onError(errorMessage(error)));
    });
    term.onResize(({ cols, rows }) => { if (entry.id) api?.terminalResize(entry.id, cols, rows); });
    return entry;
  }
  const fitShown = () => { if (shown?.host.isConnected && shown.host.clientWidth) { try { shown.fit.fit(); } catch {} } };
  return {
    id: 'terminal', title: 'Terminal', wide: () => true,
    // Types into this chat's shell once the pane has made it (Sweep's "open sweep's own dashboard"): waits up to 4 s.
    async type(text: unknown) {
      for (let waited = 0; waited < 4000; waited += 100) {
        const entry = terminals.get(sessionKey());
        if (entry?.id && api) { await api.terminalWrite(entry.id, String(text)); return true; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return false;
    },
    leave() { observer?.disconnect(); observer = null; shown = null; },
    async render(body: HTMLElement) {
      if (!api) { body.replaceChildren(element('p', 'pane-empty', 'The terminal is available in the desktop app.')); return; }
      const key = sessionKey();
      let entry = terminals.get(key);
      if (!entry) { entry = await create(); terminals.set(key, entry); }
      if (sessionKey() !== key) return;
      if (shown === entry && entry.host.isConnected) { fitShown(); return; }
      const tools = element('div', 'page-head');
      const where = element('h4', '', folder() || 'Home folder'); where.title = 'This shell has your full access. Fairy’s agent can’t see or use it.';
      tools.append(where);
      body.replaceChildren(tools, entry.host);
      observer?.disconnect();
      shown = entry;
      if (!entry.opened) { entry.term.open(entry.host); entry.opened = true; }
      fitShown();
      observer = new ResizeObserver(fitShown); observer.observe(entry.host);
      if (!entry.id) await start(entry).catch((error: unknown) => onError(errorMessage(error)));
      else if (api?.terminalSnapshot && entry.term.buffer?.active?.length <= 1) {
        const snap = await api.terminalSnapshot(entry.id).catch(() => null);
        if (snap?.scrollback) entry.term.write(snap.scrollback);
      }
      entry.term.focus();
    },
  };
}
