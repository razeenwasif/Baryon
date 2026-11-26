import './panels.css';
import { meetingActive, meetingSummary } from './meeting-panel.js';

// Meeting mode beside the chat: the whole running transcript while it's on, then the summary once it ends.
export function meetingPane({ api, meeting, toggle, render: renderText, onError = () => {} }) {
  let shownBody = null, drawn = '';
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (className, text, onclick) => { const node = el('button', className, text); node.type = 'button'; node.onclick = onclick; return node; };
  const clock = at => new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?$/i, ' $1m');

  function summaryCard(summary) {
    const card = el('section', 'panel-card meeting-summary');
    const head = el('div', 'panel-card-head');
    head.append(el('h3', '', `Summary · ${clock(summary.startedAt)}–${clock(summary.endedAt)}`));
    card.append(head);
    if (summary.status === 'writing') { card.append(el('p', 'panel-note busy', 'Writing a summary of the meeting…')); return card; }
    if (summary.status === 'failed') card.append(el('p', 'panel-note', `Couldn’t write a summary: ${summary.error}`));
    else { const text = el('div', 'meeting-summary-text'); renderText(text, summary.text); card.append(text); }
    const actions = el('div', 'panel-actions');
    if (summary.status === 'done') actions.append(button('panel-button', 'Copy', async event => {
      try { await navigator.clipboard.writeText(summary.text); event.target.textContent = 'Copied'; setTimeout(() => { event.target.textContent = 'Copy'; }, 1500); } catch (error) { onError(error.message); }
    }));
    actions.append(button('panel-button quiet', 'Dismiss', () => api.meetingSummaryDismiss().catch(error => onError(error.message))));
    card.append(actions);
    return card;
  }

  async function transcript(body, list) {
    let lines = [];
    try { lines = await api.meetingLines(); } catch (error) { list.replaceChildren(el('li', 'panel-note', error.message)); return; }
    if (shownBody !== body) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.replaceChildren(...(lines.length ? lines.map(line => {
      const item = el('li', line.source === 'me' ? 'me' : 'others');
      item.append(el('span', 'meeting-when', clock(line.at)), el('b', '', line.source === 'me' ? 'You' : 'Others'), el('span', 'meeting-text', line.text));
      return item;
    }) : [el('li', 'panel-note', 'Listening. What’s said will appear here.')]));
    // Follow the conversation unless you've scrolled up to read something.
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  return {
    id: 'meeting', title: 'Meeting',
    render(body) {
      shownBody = body;
      const m = meeting(), active = meetingActive(m);
      // Redraw the frame only when the state changes, so new lines don't jump the transcript about.
      const key = JSON.stringify([m.status, m.error, m.summary?.status, m.summary?.startedAt]);
      if (key !== drawn || !body.querySelector('.meeting')) {
        drawn = key;
        const root = el('div', 'meeting panel-stack'), head = el('header', 'panel-head');
        head.append(el('h2', '', 'Meeting'), button(active ? 'panel-button stop' : 'panel-button primary', active ? 'End meeting' : 'Start meeting', toggle));
        root.append(head, el('p', `panel-note meeting-status${active ? ' live' : ''}`, active ? meetingSummary(m) : m.error || 'Meeting mode is off.'));
        if (active) root.append(el('ol', 'meeting-lines'));
        if (m.summary) root.append(summaryCard(m.summary));
        if (!active && !m.summary) root.append(el('p', 'panel-note', 'Start meeting mode to see a live transcript here. When it ends, Fairy writes a summary, unless you’ve turned that off in Settings → Voice & listening.'));
        body.replaceChildren(root);
      } else body.querySelector('.meeting-status').textContent = active ? meetingSummary(m) : m.error || 'Meeting mode is off.';
      const list = body.querySelector('.meeting-lines');
      if (list) void transcript(body, list);
    },
    leave() { shownBody = null; drawn = ''; },
  };
}
