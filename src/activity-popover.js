import { createPopover, el, inputRequiredSvg } from './popover.js';
import { relativeAge } from './session-list.js';

/**
 * Activity & notifications popover + badge counter on #activity-bell.
 * Aggregates waiting input requests, running work/swarms, recently finished background threads, and recent approvals/routines.
 */
export function createActivityPopover({ api, anchor, getState = () => ({}), onOpenSession = () => {} } = {}) {
  let badge = anchor?.querySelector('.rail-badge');
  if (anchor && !badge) {
    badge = el('span', 'rail-badge');
    badge.hidden = true;
    anchor.append(badge);
  }

  let recentApprovals = [];
  let recentAutomation = null;

  function collectCounts(snap) {
    const running = snap?.running || {};
    const swarms = snap?.swarms || {};
    const finished = Array.isArray(snap?.finished) ? snap.finished : [];
    const sessions = Array.isArray(snap?.sessions) ? snap.sessions : [];

    const waiting = sessions.filter(s => running[s.id] === 'waiting');
    const working = sessions.filter(s => (running[s.id] && running[s.id] !== 'waiting') || swarms[s.id]?.status === 'running');
    const done = sessions.filter(s => finished.includes(s.id) && s.id !== snap?.active && !running[s.id]);
    return { waiting, working, done, attentionCount: waiting.length + done.length };
  }

  function syncBadge() {
    if (!anchor || !badge) return;
    const snap = getState()?.sessions || {};
    const { waiting, working, done, attentionCount } = collectCounts(snap);
    const total = attentionCount + working.length;
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.toggle('is-waiting', waiting.length > 0);
    badge.classList.toggle('is-working', waiting.length === 0 && working.length > 0);
    anchor.classList.toggle('has-waiting', waiting.length > 0);
    const parts = [];
    if (waiting.length) parts.push(`${waiting.length} waiting for input`);
    if (working.length) parts.push(`${working.length} working`);
    if (done.length) parts.push(`${done.length} finished`);
    anchor.title = parts.length ? `Activity: ${parts.join(', ')}` : 'Activity & notifications';
  }

  const pop = createPopover({
    anchor,
    className: 'fairy-popover--activity',
    label: 'Activity and notifications',
    align: 'right-of',
    width: 360,
    onOpen: async () => {
      render();
      const [approvals, automation] = await Promise.all([
        api?.approvalsRecent?.().catch(() => []) ?? [],
        api?.automationState?.().catch(() => null) ?? null,
      ]);
      recentApprovals = Array.isArray(approvals) ? approvals : [];
      recentAutomation = automation;
      if (pop.isOpen()) {
        render();
        pop.position();
      }
    },
  });

  function renderSessionRow(session, kindLabel, kindClass) {
    const btn = el('button', 'fp-row');
    btn.type = 'button';
    const icon = el('span', `fp-row-icon is-${kindClass}`);
    if (kindClass === 'waiting') icon.append(inputRequiredSvg(13));
    else icon.append(el('span', `fp-dot is-${kindClass}`));
    const col = el('span', 'fp-row-text');
    col.append(el('span', 'fp-row-title', session.title || 'Untitled'));
    const sub = [kindLabel, session.work ? 'Work' : 'Chat', relativeAge(session.updatedAt)].filter(Boolean).join(' · ');
    col.append(el('span', 'fp-row-sub', sub));
    btn.append(icon, col);
    btn.onclick = () => {
      pop.close();
      void onOpenSession(session.id);
    };
    return btn;
  }

  function render() {
    const snap = getState()?.sessions || {};
    const { waiting, working, done } = collectCounts(snap);

    const header = el('div', 'fp-head');
    header.append(el('strong', 'fp-title', 'Activity & notifications'));

    const scroll = el('div', 'fp-scroll');
    const sections = [];

    if (waiting.length) {
      const sec = el('div', 'fp-section');
      sec.append(el('div', 'fp-sec-label is-waiting', `Input required (${waiting.length})`));
      for (const s of waiting) sec.append(renderSessionRow(s, 'Needs your OK', 'waiting'));
      sections.push(sec);
    }

    if (working.length) {
      const sec = el('div', 'fp-section');
      sec.append(el('div', 'fp-sec-label is-working', `Running now (${working.length})`));
      for (const s of working) sec.append(renderSessionRow(s, 'In progress', 'working'));
      sections.push(sec);
    }

    if (done.length) {
      const sec = el('div', 'fp-section');
      sec.append(el('div', 'fp-sec-label is-finished', `Finished (${done.length})`));
      for (const s of done) sec.append(renderSessionRow(s, 'Completed', 'finished'));
      sections.push(sec);
    }

    const recentEvents = [];
    for (const item of (recentApprovals || []).slice(0, 8)) {
      recentEvents.push({
        at: item.at || '',
        title: item.title || item.tool || 'Action',
        sub: [item.outcome || item.decision || '', relativeAge(item.at)].filter(Boolean).join(' · '),
        sessionId: item.chat || '',
      });
    }
    for (const s of recentAutomation?.schedules || []) {
      if (s.lastRun) {
        recentEvents.push({
          at: s.lastRun,
          title: `Routine: ${s.title}`,
          sub: `Last ran ${s.lastRun}`,
          sessionId: '',
        });
      }
    }
    if (recentEvents.length) {
      recentEvents.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const sec = el('div', 'fp-section');
      sec.append(el('div', 'fp-sec-label', 'Recent history'));
      for (const ev of recentEvents.slice(0, 8)) {
        const row = ev.sessionId ? el('button', 'fp-row') : el('div', 'fp-row is-static');
        if (ev.sessionId) {
          row.type = 'button';
          row.onclick = () => { pop.close(); void onOpenSession(ev.sessionId); };
        }
        const col = el('span', 'fp-row-text');
        col.append(el('span', 'fp-row-title', ev.title));
        if (ev.sub) col.append(el('span', 'fp-row-sub', ev.sub));
        row.append(col);
        sec.append(row);
      }
      sections.push(sec);
    }

    if (!sections.length) sections.push(el('p', 'fp-empty', 'All caught up — no pending input requests or background alerts.'));
    scroll.replaceChildren(...sections);
    pop.panel.replaceChildren(header, scroll);
  }

  syncBadge();

  return {
    toggle: () => pop.toggle(),
    close: () => pop.close(),
    syncBadge,
    refresh: () => {
      syncBadge();
      if (pop.isOpen()) render();
    },
  };
}
