// The panel for sending a message by hand from the chat on screen to another work session (docs/session-messages.md):
// pick a session, grouped by project with what each is doing, write, and Send. Its answer comes back to this chat.
export type SessionDirectoryStatus = 'working' | 'waiting' | 'queued' | 'idle';

export interface SessionDirectoryEntry {
  id: string;
  project: string;
  title: string;
  status: SessionDirectoryStatus | string;
  branch?: string;
}

export interface SessionMessagesApi {
  sessionDirectory: (query: string) => Promise<SessionDirectoryEntry[]>;
  sessionMessage: (to: string, text: string) => Promise<unknown>;
}

export interface SessionMessagesOptions {
  api: SessionMessagesApi;
  onError: (message: string) => void;
  onSent?: (result: unknown) => void;
  holder?: HTMLElement;
}

export interface SessionMessagesController {
  open: (options?: { to?: string | null }) => Promise<void>;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const STATUS: Readonly<Record<string, string>> = { working: 'Working', waiting: 'Needs your OK', queued: 'Waiting for a free slot', idle: '' };
const MAX = 8000;

const errMessage = (error: unknown): string => (
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
);

// holder is where the panel goes, inside the window so it takes the window's colours.
export function sessionMessages({ api, onError, onSent = () => {}, holder = document.body }: SessionMessagesOptions): SessionMessagesController {
  const dialog = element('dialog', 'session-message');
  dialog.setAttribute('aria-labelledby', 'session-message-title');
  const head = element('div', 'session-message-head'), title = element('h3', '', 'Message a session');
  title.id = 'session-message-title';
  const close = element('button', 'session-message-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.onclick = () => dialog.close();
  head.append(title, close);
  const search = element('input', 'session-message-search');
  search.type = 'search';
  search.placeholder = 'Search sessions or projects';
  search.setAttribute('aria-label', 'Search sessions or projects');
  const list = element('div', 'session-message-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Sessions');
  const text = element('textarea', 'session-message-text');
  text.rows = 4;
  text.maxLength = MAX;
  text.placeholder = 'What should it know or do? It can’t see this chat.';
  text.setAttribute('aria-label', 'Message');
  const foot = element('div', 'session-message-foot'), hint = element('span', 'session-message-hint', 'Its answer comes back to this chat.');
  const send = element('button', 'primary', 'Send');
  send.type = 'button';
  foot.append(hint, send);
  dialog.append(head, search, list, text, foot);
  holder.append(dialog);

  let picked: string | null = null, found: SessionDirectoryEntry[] = [], asked = 0, sending = false;
  const ready = (): void => { send.disabled = sending || !picked || !text.value.trim(); };
  function draw(): void {
    const rows: HTMLElement[] = [];
    if (!found.length) rows.push(element('p', 'session-message-empty', search.value.trim() ? 'No work session matches that.' : 'No other work sessions this week.'));
    const projects = new Map<string, SessionDirectoryEntry[]>();
    for (const entry of found) {
      let group = projects.get(entry.project);
      if (!group) { group = []; projects.set(entry.project, group); }
      group.push(entry);
    }
    for (const [project, entries] of projects) {
      rows.push(element('div', 'session-message-project', project || 'No project'));
      for (const entry of entries) {
        const row = element('button', `session-message-row${entry.status !== 'idle' ? ` ${entry.status}` : ''}`);
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(entry.id === picked));
        row.append(element('span', 'side-chip-dot'), element('span', 'session-message-name', entry.title));
        const detail = [STATUS[entry.status], entry.branch].filter(Boolean).join(' · ');
        if (detail) row.append(element('span', 'session-message-state', detail));
        row.onclick = () => { picked = entry.id; draw(); ready(); text.focus(); };
        rows.push(row);
      }
    }
    list.replaceChildren(...rows);
  }
  async function load(): Promise<void> {
    const ask = ++asked;
    try { const result = await api.sessionDirectory(search.value); if (ask === asked) { found = result; draw(); } }
    catch (error: unknown) { onError(errMessage(error)); }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 150); };
  text.oninput = ready;
  text.onkeydown = event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send.click(); } };
  send.onclick = async () => {
    if (send.disabled || !picked) return;
    sending = true;
    ready();
    try { const result = await api.sessionMessage(picked, text.value.trim()); dialog.close(); onSent(result); }
    catch (error: unknown) { onError(errMessage(error)); }
    finally { sending = false; ready(); }
  };
  return {
    // to picks a session, for Reply on a message's card.
    async open({ to = null }: { to?: string | null } = {}) {
      picked = to;
      search.value = '';
      text.value = '';
      found = [];
      draw();
      ready();
      dialog.showModal();
      await load();
      // A session idle for over a week isn't listed, so there's nothing to pick; open it to write there instead.
      if (to && !found.some(entry => entry.id === to)) picked = null;
      draw();
      ready();
      (to && picked ? text : search).focus();
    },
  };
}
