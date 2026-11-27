import '@xterm/xterm/css/xterm.css';
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
// See-through, so the window's background shows behind the shell.
const THEME = { background: 'rgba(0, 0, 0, 0)', foreground: '#dfe1e8', cursor: '#9fb2ff', selectionBackground: '#3e5aec66' };

// A real shell for each chat, opened in its work folder. It stays running while you're in other chats.
export function terminalPane({ api, sessionKey, folder, onError }) {
  const terminals = new Map(), byId = new Map();
  let shown = null, observer = null;
  if (api) {
    api.onTerminalData(({ id, data }) => byId.get(id)?.term.write(data));
    api.onTerminalExit(({ id }) => { const entry = byId.get(id); if (entry) { byId.delete(id); entry.id = null; entry.term.write('\r\n\x1b[90m[Shell ended. Press any key to start a new one.]\x1b[0m\r\n'); } });
  }
  async function start(entry) {
    const { id } = await api.terminalStart({ cwd: folder(), cols: entry.term.cols, rows: entry.term.rows });
    entry.id = id; byId.set(id, entry);
  }
  async function create() {
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
    const term = new Terminal({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, cursorBlink: true, scrollback: 5000, theme: THEME, allowTransparency: true, macOptionIsMeta: true });
    const fit = new FitAddon(), host = element('div', 'terminal-host'), entry = { term, fit, host, id: null, opened: false };
    term.loadAddon(fit);
    term.onData(data => {
      if (entry.id) api.terminalWrite(entry.id, data);
      else start(entry).catch(error => onError(error.message));
    });
    term.onResize(({ cols, rows }) => { if (entry.id) api.terminalResize(entry.id, cols, rows); });
    return entry;
  }
  const fitShown = () => { if (shown?.host.isConnected && shown.host.clientWidth) { try { shown.fit.fit(); } catch {} } };
  return {
    id: 'terminal', title: 'Terminal', wide: () => true,
    // Types into this chat's shell once the pane has made it (Sweep's "open sweep's own dashboard"): waits up to 4 s.
    async type(text) {
      for (let waited = 0; waited < 4000; waited += 100) {
        const entry = terminals.get(sessionKey());
        if (entry?.id) { await api.terminalWrite(entry.id, String(text)); return true; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return false;
    },
    leave() { observer?.disconnect(); observer = null; shown = null; },
    async render(body) {
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
      if (!entry.id) await start(entry).catch(error => onError(error.message));
      else if (api?.terminalSnapshot && entry.term.buffer?.active?.length <= 1) {
        const snap = await api.terminalSnapshot(entry.id).catch(() => null);
        if (snap?.scrollback) entry.term.write(snap.scrollback);
      }
      entry.term.focus();
    },
  };
}
