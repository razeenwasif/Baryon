import { createPopover, el, inputRequiredSvg, svgIcon } from './popover.js';
import { relativeAge } from './session-list.js';
import { formatSnoozeRemaining, isSessionSnoozed, snoozePresets, sortInboxByReturn } from './thread-inbox.js';

const THREAD_ICON = [
  ['path', { d: 'M4 6h16M4 12h16M4 18h10' }],
];

/**
 * Floating popup next to section & folder icons that groups and jumps between inbox, waiting, running, finished, snoozed, and open threads.
 */
export function createThreadsPopover({ anchor, getState = () => ({}), onOpenSession = () => {}, onSnooze = () => {} } = {}) {
  let query = '';
  let filter = 'all';

  const pop = createPopover({
    anchor,
    className: 'fairy-popover--threads',
    label: 'Open threads',
    align: 'right-of',
    width: 340,
    onOpen: () => {
      query = '';
      renderBody();
      pop.panel.querySelector('.fp-search')?.focus();
    },
  });

  function statusOf(session, snap) {
    const running = snap?.running || {};
    const swarms = snap?.swarms || {};
    const finished = Array.isArray(snap?.finished) ? snap.finished : [];
    const run = running[session.id];
    const swarm = swarms[session.id];
    if (run === 'waiting') return 'waiting';
    if (run || swarm?.status === 'running') return 'working';
    if (finished.includes(session.id) && session.id !== snap?.active) return 'finished';
    return 'open';
  }

  function renderThreadButton(session, snap, folderMap) {
    const st = statusOf(session, snap);
    const snoozed = isSessionSnoozed(session);
    const snoozeText = snoozed ? formatSnoozeRemaining(session.snoozedUntil) : '';
    const rowWrap = el('div', `fp-row-wrap${snoozed ? ' is-snoozed' : ''}`);
    const btn = el('button', `fp-row${session.id === snap?.active ? ' is-current' : ''}`);
    btn.type = 'button';

    const iconWrap = el('span', `fp-row-icon is-${st}`);
    if (st === 'waiting') iconWrap.append(inputRequiredSvg(13));
    else if (st === 'working') iconWrap.append(el('span', 'fp-dot is-working'));
    else if (st === 'finished') iconWrap.append(el('span', 'fp-dot is-finished'));
    else iconWrap.append(svgIcon(THREAD_ICON, 12));

    const textCol = el('span', 'fp-row-text');
    textCol.append(el('span', 'fp-row-title', session.title || 'Untitled'));
    const folderName = session.folder ? (folderMap.get(session.folder) || '') : '';
    const subParts = [
      st === 'waiting' ? 'Input required' : st === 'working' ? 'Working' : st === 'finished' ? 'Finished' : '',
      snoozeText ? `Snoozed (${snoozeText})` : '',
      folderName || (session.work ? 'Work' : 'Chat'),
      session.branch || '',
      relativeAge(session.updatedAt),
    ].filter(Boolean);
    textCol.append(el('span', 'fp-row-sub', subParts.join(' · ')));

    btn.append(iconWrap, textCol);
    btn.onclick = () => {
      pop.close();
      void onOpenSession(session.id);
    };
    const snoozeBtn = el('button', 'fp-snooze-btn', snoozed ? 'Wake' : '1h');
    snoozeBtn.type = 'button';
    snoozeBtn.title = snoozed ? 'Wake thread back into Inbox' : 'Snooze thread for 1 hour';
    snoozeBtn.onclick = ev => {
      ev.stopPropagation();
      const until = snoozed ? null : snoozePresets()[0].until;
      void Promise.resolve(onSnooze(session.id, until)).then(() => renderBody());
    };
    rowWrap.append(btn, snoozeBtn);
    return rowWrap;
  }

  function renderBody() {
    const snap = getState()?.sessions || {};
    const sessions = Array.isArray(snap.sessions) ? [...snap.sessions] : [];
    sessions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const folders = Array.isArray(snap.folders) ? snap.folders : [];
    const folderMap = new Map(folders.map(f => [f.id, f.name]));

    const header = el('div', 'fp-head');
    header.append(el('strong', 'fp-title', 'Open threads'));
    header.append(el('span', 'fp-count', String(sessions.length)));

    const controls = el('div', 'fp-controls');
    const search = el('input', 'fp-search');
    search.type = 'search';
    search.placeholder = 'Filter threads or folders…';
    search.value = query;
    search.oninput = () => {
      query = search.value;
      renderListOnly(listWrap, sessions, snap, folderMap);
      pop.position();
    };
    const pills = el('div', 'fp-pills');
    for (const [id, label] of [['all', 'All'], ['inbox', 'Inbox'], ['active', 'Active'], ['waiting', 'Needs input'], ['snoozed', 'Snoozed']]) {
      const p = el('button', `fp-pill${filter === id ? ' is-selected' : ''}`, label);
      p.type = 'button';
      p.onclick = () => {
        filter = id;
        renderBody();
      };
      pills.append(p);
    }
    controls.append(search, pills);

    const listWrap = el('div', 'fp-scroll');
    renderListOnly(listWrap, sessions, snap, folderMap);

    pop.panel.replaceChildren(header, controls, listWrap);
  }

  function renderListOnly(listWrap, sessions, snap, folderMap) {
    const q = query.trim().toLowerCase();
    const nowMs = Date.now();
    const base = filter === 'inbox'
      ? sortInboxByReturn(sessions, { nowMs, running: snap?.running, finished: snap?.finished, includeSnoozed: false })
      : sessions;
    const visible = base.filter(s => {
      const snoozed = isSessionSnoozed(s, nowMs);
      if (filter === 'snoozed') { if (!snoozed) return false; }
      else if (snoozed) return false;
      const st = statusOf(s, snap);
      if (filter === 'waiting' && st !== 'waiting') return false;
      if (filter === 'active' && !['waiting', 'working', 'finished'].includes(st)) return false;
      if (!q) return true;
      const folderName = s.folder ? (folderMap.get(s.folder) || '') : '';
      return [s.title, s.work, s.branch, folderName].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    const groups = filter === 'inbox'
      ? [
          { key: 'waiting', title: 'Input required', items: [] },
          { key: 'finished', title: 'Recently finished', items: [] },
          { key: 'working', title: 'Working', items: [] },
        ]
      : [
          { key: 'waiting', title: 'Input required', items: [] },
          { key: 'working', title: 'Working', items: [] },
          { key: 'finished', title: 'Recently finished', items: [] },
        ];
    const openByFolder = new Map();

    for (const s of visible) {
      const st = statusOf(s, snap);
      const hit = groups.find(g => g.key === st);
      if (hit) hit.items.push(s);
      else {
        const label = s.folder ? (folderMap.get(s.folder) || 'Folder') : 'Chats';
        if (!openByFolder.has(label)) openByFolder.set(label, []);
        openByFolder.get(label).push(s);
      }
    }

    const nodes = [];
    for (const group of groups) {
      if (!group.items.length) continue;
      const sec = el('div', 'fp-section');
      sec.append(el('div', `fp-sec-label is-${group.key}`, `${group.title} (${group.items.length})`));
      for (const s of group.items) sec.append(renderThreadButton(s, snap, folderMap));
      nodes.push(sec);
    }
    for (const [label, list] of openByFolder) {
      const sec = el('div', 'fp-section');
      sec.append(el('div', 'fp-sec-label', `${label} (${list.length})`));
      for (const s of list.slice(0, 15)) sec.append(renderThreadButton(s, snap, folderMap));
      nodes.push(sec);
    }
    if (!nodes.length) nodes.push(el('p', 'fp-empty', filter === 'snoozed' ? 'No snoozed threads.' : 'No matching threads.'));
    listWrap.replaceChildren(...nodes);
  }

  return {
    toggle: () => pop.toggle(),
    close: () => pop.close(),
    isOpen: () => pop.isOpen(),
    refresh: () => { if (pop.isOpen()) renderBody(); },
  };
}
