import './side-sessions.css';
import { noteHeading } from './note-heading.js';
import { sessionMessages } from './session-messages.js';

export { noteHeading };
// The panel for messaging a session by hand, which the strip makes; a message's card opens it with Reply.
let composer = null;
const REPLY_KINDS = new Set(['peer', 'peer-reply', 'child', 'reply']);

// Side sessions in the window: a note from a linked chat in the conversation, and the strip above it that links a chat
// to the one that started it, to the sessions it started, and to the cards it left for sessions it noticed.
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (className, text, onclick, label) => { const node = element('button', className, text); node.type = 'button'; node.onclick = onclick; if (label) node.setAttribute('aria-label', label); return node; };
const STATUS = { working: 'Working', waiting: 'Needs your OK', queued: 'Waiting for a free slot' };
const when = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); };

// One note, drawn from what it carries rather than the text the model reads. renderText draws Markdown as replies are.
export function noteView(entry, { onOpen, renderText }) {
  const card = element('article', `side-note ${entry.from?.kind || 'child'}${entry.note?.status ? ` ${entry.note.status}` : ''}`);
  const head = element('div', 'side-note-head');
  // A session outside this chat's links says which project it's in.
  head.append(element('span', 'side-note-title', `${noteHeading(entry)}${entry.from?.project && ['peer', 'peer-reply', 'sent'].includes(entry.from.kind) ? ` · ${entry.from.project}` : ''}`));
  if (entry.from?.id && composer && REPLY_KINDS.has(entry.from.kind)) head.append(button('side-note-open', 'Reply', () => composer.open({ to: entry.from.id }), `Reply to ${entry.from.title}`));
  if (entry.from?.id) head.append(button('side-note-open', 'Open', () => onOpen(entry.from.id), `Open ${entry.from.title}`));
  const body = element('div', 'side-note-body');
  if (renderText) renderText(body, entry.note?.text ?? entry.content); else body.textContent = entry.note?.text ?? entry.content;
  card.append(head, body);
  return card;
}

// The strip at the top of a chat. state is the sessions state, with links for the chat on screen.
export function linkedStrip({ api, onOpen, onError, holder }) {
  const strip = element('section', 'side-strip'); strip.hidden = true; strip.setAttribute('aria-label', 'Linked sessions');
  holder.before(strip);
  composer = sessionMessages({ api, onError, holder: holder.closest('#app') || document.body });
  // Messaging any work session by hand, from a work chat or one with linked sessions.
  const compose = button('side-compose', 'Message a session', () => composer.open(), 'Message another session from this chat');
  let busy = false;
  const act = async work => {
    if (busy) return;
    busy = true; strip.querySelectorAll('button').forEach(node => { node.disabled = true; });
    try { await work(); } catch (error) { onError(error.message); }
    finally { busy = false; strip.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
  };
  function chip(session, running) {
    const state = running?.[session.id] || (session.queued ? 'queued' : ''), chipButton = button(`side-chip${state ? ` ${state}` : ''}`, '', () => onOpen(session.id), `Open ${session.title}${state ? `, ${STATUS[state].toLowerCase()}` : ''}`);
    chipButton.append(element('span', 'side-chip-dot'), element('span', 'side-chip-title', session.title));
    if (state) chipButton.append(element('span', 'side-chip-state', STATUS[state]));
    else if (session.branch) chipButton.append(element('span', 'side-chip-state', session.branch));
    chipButton.title = [session.title, state ? STATUS[state] : '', session.branch ? `On ${session.branch}` : ''].filter(Boolean).join(' · ');
    return chipButton;
  }
  function proposal(parent, item) {
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
      const links = state?.links, rows = [];
      strip.hidden = !links && !state?.work;
      if (strip.hidden) { strip.replaceChildren(); return; }
      if (!links) { const row = element('div', 'side-row'); row.append(compose); strip.replaceChildren(row); return; }
      if (links.parent) {
        const row = element('div', 'side-row');
        row.append(element('span', 'side-label', 'Started from'), button('side-parent', links.parent.title, () => onOpen(links.parent.id), `Open ${links.parent.title}, the chat that started this one`));
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
