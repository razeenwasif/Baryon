import './side-sessions.css';
import { noteHeading } from './note-heading.js';
import type { NoteHeadingEntry } from './note-heading.js';
import { sessionMessages } from './session-messages.js';
import type { SessionMessagesApi, SessionMessagesController } from './session-messages.js';

export { noteHeading };

export interface SideNoteEntry extends NoteHeadingEntry {
  from?: NoteHeadingEntry['from'] & {
    id?: string;
    project?: string;
  };
  note?: NoteHeadingEntry['note'] & {
    text?: string;
  };
  content?: string;
}

export interface NoteViewOptions {
  onOpen: (id: string) => void;
  renderText?: (container: HTMLElement, text: string) => void;
}

export interface LinkedSessionItem {
  id: string;
  title: string;
  queued?: boolean;
  branch?: string;
}

export interface LinkedProposalItem {
  id: string;
  title: string;
  folder?: string;
  where?: string;
  expires: string | number | Date;
  brief: string;
}

export interface LinkedStripState {
  active: string;
  work?: unknown;
  running?: Record<string, string>;
  links?: {
    parent?: { id: string; title: string } | null;
    children: LinkedSessionItem[];
    proposals: LinkedProposalItem[];
  } | null;
}

export interface LinkedStripApi extends SessionMessagesApi {
  sideProposalDismiss: (parent: string, proposalId: string) => Promise<unknown>;
  sideProposalStart: (parent: string, proposalId: string) => Promise<unknown>;
}

export interface LinkedStripOptions {
  api: LinkedStripApi;
  onOpen: (id: string) => void;
  onError: (message: string) => void;
  holder: HTMLElement;
}

export interface LinkedStripController {
  update: (state: LinkedStripState | null | undefined) => void;
}

// The panel for messaging a session by hand, which the strip makes; a message's card opens it with Reply.
let composer: SessionMessagesController | null = null;
const REPLY_KINDS = new Set(['peer', 'peer-reply', 'child', 'reply']);

// Side sessions in the window: a note from a linked chat in the conversation, and the strip above it that links a chat
// to the one that started it, to the sessions it started, and to the cards it left for sessions it noticed.
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (className: string, text: string, onclick: (ev: MouseEvent) => void, label?: string): HTMLButtonElement => {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onclick;
  if (label) node.setAttribute('aria-label', label);
  return node;
};
const STATUS: Readonly<Record<string, string>> = { working: 'Working', waiting: 'Needs your OK', queued: 'Waiting for a free slot' };
const when = (iso: string | number | Date): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// One note, drawn from what it carries rather than the text the model reads. renderText draws Markdown as replies are.
export function noteView(entry: SideNoteEntry, { onOpen, renderText }: NoteViewOptions): HTMLElement {
  const card = element('article', `side-note ${entry.from?.kind || 'child'}${entry.note?.status ? ` ${entry.note.status}` : ''}`);
  const head = element('div', 'side-note-head');
  // A session outside this chat's links says which project it's in.
  head.append(element('span', 'side-note-title', `${noteHeading(entry)}${entry.from?.project && ['peer', 'peer-reply', 'sent'].includes(entry.from.kind || '') ? ` · ${entry.from.project}` : ''}`));
  const fromId = entry.from?.id;
  if (fromId && composer && entry.from?.kind && REPLY_KINDS.has(entry.from.kind)) {
    const activeComposer = composer;
    head.append(button('side-note-open', 'Reply', () => activeComposer.open({ to: fromId }), `Reply to ${entry.from?.title}`));
  }
  if (fromId) head.append(button('side-note-open', 'Open', () => onOpen(fromId), `Open ${entry.from?.title}`));
  const body = element('div', 'side-note-body');
  const noteText = entry.note?.text ?? entry.content ?? '';
  if (renderText) renderText(body, noteText); else body.textContent = noteText;
  card.append(head, body);
  return card;
}

// The strip at the top of a chat. state is the sessions state, with links for the chat on screen.
export function linkedStrip({ api, onOpen, onError, holder }: LinkedStripOptions): LinkedStripController {
  const strip = element('section', 'side-strip'); strip.hidden = true; strip.setAttribute('aria-label', 'Linked sessions');
  holder.before(strip);
  composer = sessionMessages({ api, onError, holder: holder.closest<HTMLElement>('#app') || document.body });
  // Messaging any work session by hand, from a work chat or one with linked sessions.
  const compose = button('side-compose', 'Message a session', () => composer?.open(), 'Message another session from this chat');
  let busy = false;
  const act = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    busy = true; strip.querySelectorAll('button').forEach(node => { node.disabled = true; });
    try { await work(); } catch (error: unknown) { onError(errMessage(error)); }
    finally { busy = false; strip.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
  };
  function chip(session: LinkedSessionItem, running?: Record<string, string>): HTMLButtonElement {
    const state = running?.[session.id] || (session.queued ? 'queued' : '');
    const statusText = state ? (STATUS[state] || state) : '';
    const chipButton = button(`side-chip${state ? ` ${state}` : ''}`, '', () => onOpen(session.id), `Open ${session.title}${statusText ? `, ${statusText.toLowerCase()}` : ''}`);
    chipButton.append(element('span', 'side-chip-dot'), element('span', 'side-chip-title', session.title));
    if (state) chipButton.append(element('span', 'side-chip-state', statusText));
    else if (session.branch) chipButton.append(element('span', 'side-chip-state', session.branch));
    chipButton.title = [session.title, statusText, session.branch ? `On ${session.branch}` : ''].filter(Boolean).join(' · ');
    return chipButton;
  }
  function proposal(parent: string, item: LinkedProposalItem): HTMLDivElement {
    const card = element('div', 'side-card'); card.setAttribute('role', 'group'); card.setAttribute('aria-label', `Suggested session: ${item.title}`);
    const text = element('div', 'side-card-text');
    text.append(element('span', 'side-card-kicker', 'Suggested session'), element('strong', '', item.title));
    const brief = element('details', 'side-card-brief');
    const name = String(item.folder || '').split('/').filter(Boolean).pop() || 'this folder';
    brief.append(element('summary', '', `${item.where === 'own_branch' ? `On its own branch of ${name}` : `In ${name}`} · until ${when(item.expires)}`), element('p', '', item.brief));
    text.append(brief);
    const actions = element('div', 'side-card-actions');
    actions.append(button('quiet', 'Dismiss', () => act(() => api.sideProposalDismiss(parent, item.id))), button('primary', 'Start', () => act(() => api.sideProposalStart(parent, item.id))));
    card.append(text, actions);
    return card;
  }
  return {
    update(state) {
      const links = state?.links, rows: HTMLElement[] = [];
      strip.hidden = !links && !state?.work;
      if (strip.hidden) { strip.replaceChildren(); return; }
      if (!links) { const row = element('div', 'side-row'); row.append(compose); strip.replaceChildren(row); return; }
      if (links.parent) {
        const parent = links.parent;
        const row = element('div', 'side-row');
        row.append(element('span', 'side-label', 'Started from'), button('side-parent', parent.title, () => onOpen(parent.id), `Open ${parent.title}, the chat that started this one`));
        rows.push(row);
      }
      if (links.children.length) {
        const row = element('div', 'side-row');
        row.append(element('span', 'side-label', 'Linked sessions'), ...links.children.map(session => chip(session, state.running)));
        rows.push(row);
      }
      if (links.proposals.length) rows.push(...links.proposals.map(item => proposal(state.active, item)));
      // The button sits at the end of the last row of chips, or on a row of its own under the cards.
      let last = rows.findLast(row => row.classList.contains('side-row'));
      if (!last) rows.push(last = element('div', 'side-row'));
      last.append(compose);
      strip.replaceChildren(...rows);
    },
  };
}
