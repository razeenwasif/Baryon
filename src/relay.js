import './sweep.css';
import './relay.css';

// Relay in Fairy's window (desktop/relay.mjs does the asking): an icon on the action rail, under Sweep's broom, whose
// arrows turn while the user's repo syncer pushes the MacBook's repos to the Mac mini; a card when you rest the pointer
// on it; a small notification when the daily sync starts and when a sync ends or can't reach the mini; and a Relay
// panel beside the chat with relay's own dashboard: the route, the mini's free space against relay's floor, the repos,
// history and the schedule. relay lives on the MacBook, so that Mac's window drives it; the mini's window shows it as
// the MacBook's window last told it. It reuses Sweep's card and panel styles, in sky blue.

import { bytes, count, nextWords, plural, relayState, routeName, stepTime, syncLabel, syncProgress } from './relay-logic.js';
import { ago } from './sweep-logic.js';

const ARROWS = '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>';
const svg = (inner, size = 18, stroke = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const button = (className, text, onclick, title) => { const node = el('button', className, text); node.type = 'button'; node.onclick = onclick; if (title) { node.title = title; if (!text) node.setAttribute('aria-label', title); } return node; };

export function relayView({ api, rail, after = null, sidePane = () => null, onError = () => {} }) {
  let here = null, doneAt = 0, tab = 'repos', open = null, logLines = null, loading = null;
  let paneBody = null, card = null, cardTimer = 0, leaveTimer = 0, toast = null, toastTimer = 0;

  // The Mac whose relay is shown: this one's, or (on the mini) the MacBook's as it last told this Mac.
  const mac = () => (here?.installed ? here : here?.peer?.installed ? { ...here.peer, told: true } : null);
  const own = () => Boolean(here?.installed);
  const fail = error => onError(`Relay: ${error.message}`);

  /* ── the icon on the rail ──────────────────────────────────────────── */
  const icon = document.createElement('button');
  icon.type = 'button'; icon.id = 'relay-button'; icon.className = 'side-item'; icon.textContent = 'Relay';
  icon.setAttribute('aria-label', 'Relay');
  icon.insertAdjacentHTML('beforeend', `<span class="relay-icon" aria-hidden="true"><svg class="relay-ring" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" class="relay-track"/><circle cx="18" cy="18" r="16" class="relay-arc"/></svg>${svg(`<g class="relay-arrows">${ARROWS}</g>`, 19)}<span class="relay-badge"></span><span class="relay-pop"></span></span>`);
  if (after?.parentElement === rail) after.after(icon); else rail.append(icon);
  icon.onclick = () => { hideCard(); sidePane()?.show('relay'); };
  icon.addEventListener('pointerenter', () => { clearTimeout(leaveTimer); clearTimeout(cardTimer); cardTimer = setTimeout(showCard, 350); });
  icon.addEventListener('pointerleave', () => { clearTimeout(cardTimer); leaveTimer = setTimeout(hideCard, 220); });
  icon.addEventListener('focus', () => { cardTimer = setTimeout(showCard, 350); });
  icon.addEventListener('blur', () => { clearTimeout(cardTimer); leaveTimer = setTimeout(hideCard, 220); });

  function drawIcon() {
    const m = mac(), state = relayState({ mac: m, doneAt });
    icon.dataset.state = state;
    icon.hidden = !m && here != null && !here.error; // no relay on this Mac and no word from the MacBook yet
    const words = { syncing: 'syncing now', done: 'just synced', failed: 'the last sync failed', waiting: m?.mini?.reachable === false ? 'waiting for the mini' : 'the mini is under its floor', off: 'its schedule is off' }[state];
    icon.title = words ? `Relay: ${words}` : m?.schedule ? `Relay · next ${m.schedule.time}` : 'Relay';
    icon.setAttribute('aria-label', icon.title);
  }

  /* ── reading ───────────────────────────────────────────────────────── */
  async function load({ fresh = false } = {}) {
    loading ??= (async () => {
      try { here = await api.relay('state', fresh); here.error = null; }
      catch (error) { here = { error: error.message }; }
      finally { loading = null; }
      drawAll();
    })();
    return loading;
  }
  const drawAll = () => { drawIcon(); if (card) fillCard(); if (paneBody?.isConnected) drawPane(); };

  // What a sync says as it goes: which repo, how much so far; and when it ends, or couldn't begin.
  api.onRelay?.(event => {
    if (!event || typeof event !== 'object' || !here?.installed) return;
    if (event.type === 'start' || event.type === 'progress') here.running = event.running;
    if (event.type === 'done') {
      // The tick is for a sync that went; one that didn't shows as waiting or failed once relay is read again.
      here.running = null; doneAt = event.problem ? 0 : Date.now();
      if (!event.problem && event.record) pop(event.record.bytes);
      void load({ fresh: true });
    }
    showToast(event);
    drawAll();
  });
  // What went rises off the icon once.
  function pop(sent) {
    const node = icon.querySelector('.relay-pop');
    node.textContent = `↑ ${bytes(sent)}`;
    node.classList.remove('on'); void node.offsetWidth; node.classList.add('on');
  }

  /* ── shared pieces ─────────────────────────────────────────────────── */
  function route(m, compact) {
    const row = el('div', `relay-route${compact ? ' compact' : ''}`);
    const end = (name, sub, right) => { const box = el('div', `relay-end${right ? ' right' : ''}`); box.append(el('span', 'relay-end-name', name)); if (sub) box.append(el('span', 'sweep-faint sweep-small', sub)); return box; };
    const line = el('span', `relay-line${m.running ? ' moving' : ''}${m.mini?.reachable === false ? ' broken' : ''}`); line.setAttribute('aria-hidden', 'true');
    const via = m.mini?.reachable ? routeName(m.mini.route) : '';
    const away = m.mini?.reachable === false ? 'out of reach' : '';
    row.append(end(m.name || 'MacBook', compact ? '' : m.host), line, end('Mac mini', compact ? (via ? `via ${via}` : away) : [m.mini?.name, via].filter(Boolean).join(' · ') || away, true));
    return row;
  }
  function gauge(m, height) {
    const box = el('div', 'relay-space');
    const words = el('div', 'sweep-row baseline sweep-small');
    if (m.mini?.total) words.append(el('span', 'sweep-dim', 'The mini has'), el('span', 'sweep-mono', bytes(m.mini.free)), el('span', 'sweep-dim', `free of ${bytes(m.mini.total)}`));
    else if (m.mini?.free) words.append(el('span', 'sweep-dim', 'The mini had'), el('span', 'sweep-mono', bytes(m.mini.free)), el('span', 'sweep-dim', 'free when last reached'));
    else words.append(el('span', 'sweep-dim', 'The mini’s free space isn’t known yet'));
    const bar = el('div', 'sweep-gauge'); bar.style.height = `${height}px`;
    if (m.mini?.total) {
      const used = el('div', 'sweep-gauge-used'); used.style.width = `${(100 * (m.mini.total - m.mini.free) / m.mini.total).toFixed(1)}%`;
      const line = el('span', 'sweep-gauge-line'); line.style.left = `${(100 * (1 - m.floor / m.mini.total)).toFixed(1)}%`; line.title = `relay pauses under ${bytes(m.floor)} free`;
      bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(m.mini.total)); bar.setAttribute('aria-valuenow', String(m.mini.total - m.mini.free));
      bar.setAttribute('aria-label', `The mini has ${bytes(m.mini.free)} free of ${bytes(m.mini.total)}; relay pauses under ${bytes(m.floor)}`);
      bar.append(used, line);
    }
    box.append(words, bar);
    return box;
  }
  const chipFor = m => (m.running ? ['Syncing', 'sky'] : m.mini?.reachable === false ? ['Mini out of reach', 'warn'] : m.mini?.total && m.mini.free < m.floor ? ['Mini under its floor', 'warn'] : ['Mini reachable', 'blue']);
  const jobName = (m, id) => m.jobs?.find(j => j.id === id)?.name || id;
  const progressWords = (r, m) => [r.current ? `${jobName(m, r.current)}${r.total ? ` · ${r.index} of ${r.total}` : ''}` : 'Reaching the mini', r.expected ? `${bytes(r.bytes)} of ${bytes(r.expected)}` : r.bytes ? `${bytes(r.bytes)} sent` : ''].filter(Boolean).join(' · ');
  const lastWords = m => {
    const last = m.history?.[0] ?? m.last;
    if (!last) return m.lastSyncAt ? `${ago(m.lastSyncAt)}` : 'None yet';
    return `${ago(last.at)} · ${last.ok ? `${bytes(last.bytes)}, ${plural(last.files, 'file')}` : 'failed'}`;
  };

  /* ── the hover card ────────────────────────────────────────────────── */
  function showCard() {
    if (!card) {
      card = el('div', 'sweep-card relay'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Relay');
      card.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
      card.addEventListener('pointerleave', () => { leaveTimer = setTimeout(hideCard, 220); });
      document.body.append(card);
    }
    fillCard(); place(card, 26);
    void load();
  }
  function hideCard() { card?.remove(); card = null; }
  function place(node, tip) {
    const box = icon.getBoundingClientRect();
    node.style.left = `${Math.round(box.right + 12)}px`;
    const top = Math.max(10, Math.min(window.innerHeight - node.offsetHeight - 10, box.top + box.height / 2 - tip));
    node.style.top = `${Math.round(top)}px`;
    node.style.setProperty('--tip', `${Math.round(box.top + box.height / 2 - top)}px`);
  }
  function fillCard() {
    if (!card) return;
    const m = mac(), parts = [], head = el('div', 'sweep-card-head');
    if (!m) {
      head.append(el('b', '', 'Relay'));
      card.replaceChildren(head, el('p', 'sweep-note', here?.error || (here ? 'relay lives on the MacBook. Open Fairy’s window there and it tells this Mac.' : 'Reading relay…')));
      return;
    }
    const chip = chipFor(m);
    head.append(el('b', '', 'Relay'), el('span', `sweep-chip ${chip[1]}`, chip[0]), el('span', 'sweep-fill'), el('span', 'sweep-faint sweep-small', m.service?.loaded === false ? 'Schedule off' : m.schedule ? `Daily at ${m.schedule.time}` : ''));
    parts.push(head, route(m, true), gauge(m, 6));
    if (m.running) parts.push(el('span', 'relay-sky sweep-small', `Syncing · ${progressWords(m.running, m)}`));
    const facts = el('dl', 'sweep-facts');
    const fact = (term, ...value) => { const dd = el('dd'); dd.append(...value); facts.append(el('dt', '', term), dd); };
    const pending = m.diff ?? m.pending;
    fact('Waiting to go', pending ? (pending.bytes ? el('span', 'relay-sky sweep-mono', bytes(pending.bytes)) : el('span', 'sweep-mint', 'Nothing')) : el('span', 'sweep-faint', 'Preview to see'), pending?.bytes ? ` · ${plural(pending.files, 'file')}` : '');
    for (const job of (m.jobs || []).filter(j => j.enabled)) {
      const p = pending?.jobs?.find(j => j.id === job.id);
      fact(job.name, p ? (p.ok === false ? el('span', 'sweep-amber', 'Couldn’t check') : p.files ? `${plural(p.files, 'file')} · ${bytes(p.bytes)}` : el('span', 'sweep-mint', 'Up to date')) : el('span', 'sweep-faint', 'On'));
    }
    if (m.schedule) fact('Next sync', m.service?.loaded === false ? 'Schedule off' : `${nextWords(m.schedule.next)}, or on waking after`);
    fact('Last sync', lastWords(m));
    parts.push(facts);
    if (m.told) parts.push(el('p', 'sweep-note sweep-small', `As the ${m.name} told this Mac ${ago(m.at)}.`));
    else {
      const acts = el('div', 'sweep-acts');
      const now = button('sweep-primary', m.running ? 'Syncing…' : 'Sync now', () => void syncNow());
      now.disabled = Boolean(m.running) || !(m.jobs || []).some(j => j.enabled);
      const panel = button('sweep-soft sweep-square', '', () => { hideCard(); sidePane()?.show('relay'); }, 'Open the Relay panel');
      panel.innerHTML = svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/>', 15);
      acts.append(now, button('sweep-soft', 'Preview', () => void preview()), panel);
      parts.push(acts);
    }
    card.replaceChildren(...parts);
  }

  /* ── doing ─────────────────────────────────────────────────────────── */
  async function syncNow() {
    if (!own()) return;
    here.running = { trigger: 'manual', index: 0, total: 0, current: null, files: 0, bytes: 0, expected: here.diff?.bytes ?? null };
    drawAll();
    try { const next = await api.relay('sync', {}); if (next?.installed) here = next; }
    catch (error) { here.running = null; fail(error); }
    drawAll();
  }
  async function preview() {
    if (!own()) return;
    tab = 'repos'; hideCard(); sidePane()?.show('relay');
    here.diffing = true; drawAll();
    try { here = await api.relay('diff', true); } catch (error) { here.diffing = false; fail(error); }
    drawAll();
  }
  const change = (...args) => api.relay(...args).then(next => { if (next?.installed) here = next; drawAll(); }).catch(fail);

  /* ── the notification ──────────────────────────────────────────────── */
  function showToast(event) {
    // A sync you started shows on the icon and the panel; the daily one, and every ending, get a notification.
    if (event.type !== 'done' && event.running?.trigger === 'manual' && !toast) return;
    clearTimeout(toastTimer);
    if (!toast) { toast = el('div', 'sweep-card sweep-toast relay'); toast.setAttribute('role', 'status'); document.body.append(toast); }
    const m = mac() || {}, head = el('div', 'sweep-card-head'), close = button('sweep-x', '', () => { toast?.remove(); toast = null; }, 'Dismiss');
    close.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 12);
    const parts = [head], acts = el('div', 'sweep-acts');
    const later = ms => { toastTimer = setTimeout(() => { toast?.remove(); toast = null; }, ms); };
    if (event.type === 'done' && !event.problem) {
      const r = event.record;
      const tick = el('span', 'sweep-tick'); tick.innerHTML = svg('<path d="M5 12l5 5 9-10"/>', 10, 3.4);
      head.append(tick, el('b', '', r ? `Synced ${bytes(r.bytes)} to the Mac mini` : 'Synced to the Mac mini'), el('span', 'sweep-fill'), close);
      if (r) parts.push(el('p', 'sweep-small sweep-dim', `${plural(r.files, 'file')} across ${plural(r.jobs.length, 'repo')} in ${Math.max(1, Math.round(r.ms / 60_000))} min.${event.free ? ` The mini now has ${bytes(event.free)} free.` : ''}`));
      acts.append(button('sweep-soft', 'See what went', () => { tab = 'history'; sidePane()?.show('relay'); toast?.remove(); toast = null; }));
      later(15_000);
    } else if (event.type === 'done') {
      const away = /unreach|reach|connect|timed out|No route/i.test(event.problem) && !event.floor;
      const mark = el('span', `relay-mark ${event.floor || away ? 'amber' : 'coral'}`, '!');
      head.append(mark, el('b', '', event.floor ? 'The mini is under relay’s floor' : away ? 'Couldn’t reach the Mac mini' : 'A sync didn’t finish'), el('span', 'sweep-fill'), close);
      parts.push(el('p', 'sweep-small sweep-dim', away ? `Tried ${(m.routes || []).length > 1 ? `all ${m.routes.length} routes` : 'the mini'}. Nothing was sent; relay tries again at the next wake.` : event.problem));
      if (own()) acts.append(button('sweep-soft', 'Try again', () => { toast?.remove(); toast = null; void syncNow(); }));
      acts.append(button('sweep-soft', 'Open Relay', () => { tab = event.floor || away ? 'schedule' : 'history'; sidePane()?.show('relay'); toast?.remove(); toast = null; }));
      later(30_000);
    } else {
      const r = event.running || {};
      head.append(el('span', 'sweep-dot relay-dot'), el('b', '', 'Syncing to the Mac mini'), el('span', 'sweep-fill'), close);
      parts.push(el('p', 'sweep-small sweep-dim', `${r.trigger === 'daily' ? `The ${m.schedule?.time || 'daily'} sync` : 'A sync you started'}${r.mini ? `, to ${r.mini}` : ''}.`));
      const bar = el('div', 'sweep-progress'), fill = el('div', 'sweep-progress-fill relay-flow');
      fill.style.width = `${(100 * syncProgress(r)).toFixed(1)}%`;
      bar.append(fill);
      const line = el('div', 'sweep-row sweep-small');
      line.append(el('span', 'sweep-dim', r.current ? `${jobName(m, r.current)} · ${r.index} of ${r.total}` : 'Reaching the mini'), el('span', 'relay-sky sweep-mono', r.expected ? `${bytes(r.bytes)} of ${bytes(r.expected)}` : `${bytes(r.bytes)} sent`));
      parts.push(bar, line);
    }
    if (acts.childElementCount) parts.push(acts);
    toast.replaceChildren(...parts);
    place(toast, 22);
  }

  /* ── the panel ─────────────────────────────────────────────────────── */
  function drawPane() {
    const body = paneBody;
    if (!body) return;
    const m = mac(), root = el('div', 'sweep-pane relay');
    const head = el('header', 'sweep-pane-head');
    const badge = el('span', 'sweep-pane-icon'); badge.innerHTML = svg(ARROWS, 16);
    head.append(badge, el('b', '', 'Relay'), el('span', 'sweep-fill'));
    if (m) { const chip = chipFor(m); head.append(el('span', `sweep-chip ${chip[1]}`, chip[0])); }
    root.append(head);
    if (!m) { root.append(el('p', 'sweep-note relay-pad', here?.error || (here ? 'relay lives on the MacBook. Open Fairy’s window there to see it here.' : 'Reading relay…'))); body.replaceChildren(root); return; }

    const top = el('section', 'relay-top');
    top.append(route(m, false), gauge(m, 6));
    const floor = el('span', `sweep-small ${m.mini?.total && m.mini.free < m.floor ? 'sweep-amber' : 'relay-floor'}`, m.mini?.reachable === false ? (m.mini.problem || 'The mini isn’t answering on any route.') : `Relay pauses if it falls under ${bytes(m.floor)}`);
    top.append(floor);
    if (m.running) top.append(el('span', 'relay-sky sweep-small', `Syncing · ${progressWords(m.running, m)}`));
    root.append(top);

    const tabs = el('nav', 'sweep-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Relay');
    for (const [id, label] of [['repos', 'Repos'], ['history', 'History'], ['schedule', 'Schedule']]) {
      if (m.told && id === 'schedule') continue;
      const b = button('', label, () => { tab = id; drawPane(); if (id === 'schedule') void readLog(); });
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id)); tabs.append(b);
    }
    root.append(tabs);
    const content = el('div', 'sweep-content');
    if (tab === 'history') content.append(...historyTab(m));
    else if (tab === 'schedule' && !m.told) content.append(...scheduleTab(m));
    else content.append(...reposTab(m));
    root.append(content);

    if (m.told) root.append(el('p', 'sweep-note sweep-small relay-pad', `As the ${m.name} told this Mac ${ago(m.at)}. Open Fairy’s window there to sync or change repos.`));
    else {
      const foot = el('footer', 'sweep-foot');
      if (m.running) foot.append(button('sweep-stop', 'Stop syncing', () => void api.relay('stop').catch(fail)));
      else {
        const dry = button('sweep-soft', m.diffing ? 'Previewing…' : 'Preview', () => void preview()); dry.disabled = Boolean(m.diffing);
        const go = button('sweep-primary grow', syncLabel(m), () => void syncNow()); go.disabled = !(m.jobs || []).some(j => j.enabled);
        foot.append(dry, go);
      }
      const tui = button('sweep-soft sweep-square', '', () => void api.relay('tui').catch(fail), 'Open relay’s own dashboard in a terminal');
      tui.innerHTML = svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M12.5 15H17"/>', 16);
      foot.append(tui);
      root.append(foot);
    }
    const scroll = body.querySelector('.sweep-content')?.scrollTop ?? 0;
    body.replaceChildren(root);
    root.querySelector('.sweep-content').scrollTop = scroll;
  }

  function reposTab(m) {
    const pending = m.diff ?? m.pending, on = (m.jobs || []).filter(j => j.enabled).length;
    const top = el('div', 'sweep-row sweep-small sweep-pad');
    top.append(el('span', 'sweep-dim', `${plural(on, 'repo')} on${pending ? ` · preview ${ago(pending.at)}` : m.diffing ? ' · previewing…' : ''}`), el('span', 'sweep-fill'));
    if (pending) top.append(el('span', 'relay-sky sweep-mono', bytes(pending.bytes)), el('span', 'sweep-dim', ` · ${plural(pending.files, 'file')} to send`));
    const list = el('ul', 'relay-repos');
    for (const job of m.jobs || []) {
      const p = pending?.jobs?.find(j => j.id === job.id), li = el('li', job.enabled ? '' : 'off');
      const row = el('div', 'relay-repo');
      const box = el('input'); box.type = 'checkbox'; box.checked = job.enabled; box.disabled = Boolean(m.told || m.running);
      box.setAttribute('aria-label', `Sync ${job.name}`);
      box.onchange = () => void api.relay('job', job.id, box.checked).then(next => { if (next?.installed) here = next; drawAll(); }).catch(error => { box.checked = !box.checked; fail(error); });
      const words = button('relay-repo-words', null, () => { open = open === job.id ? null : job.id; drawPane(); });
      words.setAttribute('aria-expanded', String(open === job.id));
      const name = el('span', 'relay-repo-name'); name.append(el('span', '', job.name)); if (job.source) name.append(el('span', 'sweep-mono sweep-faint relay-paths', `${job.source} → mini:${job.dest.replace(/^\/Users\/[^/]+/, '~')}`));
      const state = !job.enabled ? ['Off: not synced', 'sweep-faint'] : !p ? [m.diffing ? 'Previewing…' : 'Preview to see what would go', 'sweep-faint'] : p.ok === false ? [p.error || 'Couldn’t check', 'sweep-amber'] : p.files ? [`${count(p.files)} new or changed${p.totalFiles ? ` of ${count(p.totalFiles)} files` : ''}`, 'relay-sky'] : [`Up to date${p.totalFiles ? ` · ${plural(p.totalFiles, 'file')}` : ''}`, 'sweep-mint'];
      words.append(name, el('span', `sweep-small ${state[1]}`, state[0]));
      row.append(box, words, el('span', `sweep-mono ${p?.files ? 'relay-sky' : 'sweep-faint'}`, p ? (p.files ? bytes(p.bytes) : '—') : ''));
      li.append(row);
      if (open === job.id && p) {
        const files = el('div', 'relay-files');
        // relay marks each path as rsync does: + new, ~ changed.
        for (const path of (p.paths || []).slice(0, 12)) {
          const [, mark = '+', words = path] = /^([+~*-])\s+(.*)$/.exec(path) || [];
          const line = el('span', 'sweep-mono'); line.title = words;
          line.append(el('span', mark === '+' ? 'relay-sky' : 'sweep-amber', `${mark} `), document.createTextNode(words)); files.append(line);
        }
        const rest = p.files - Math.min(12, (p.paths || []).length);
        files.append(el('span', 'sweep-small sweep-faint', !p.files ? 'Nothing to send.' : !(p.paths || []).length ? 'Preview again to list them.' : rest > 0 ? `and ${count(rest)} more` : ''));
        li.append(files);
      }
      list.append(li);
    }
    return [top, list, el('p', 'sweep-small sweep-dim relay-pad', `Adds and updates only: nothing on the mini is deleted, and anything newer there is kept.${m.excludes ? ` target/, node_modules/, .venv/ and ${m.excludes - 3} more never go.` : ''}`)];
  }
  function historyTab(m) {
    const history = m.history || (m.last ? [m.last] : []);
    if (!history.length) {
      const empty = el('div', 'sweep-empty');
      empty.append(el('b', '', 'No syncs yet'), el('span', 'sweep-small', `The first runs ${m.schedule ? nextWords(m.schedule.next).toLowerCase() : 'at the daily time'}, or the next time the MacBook wakes after it, or when you press Sync now. Each one is kept here with what it sent.`));
      return [empty];
    }
    const stats = el('div', 'sweep-stats'), stat = (label, value, sky) => { const s = el('div'); s.append(el('span', 'sweep-faint sweep-small', label), el('span', `sweep-mono${sky ? ' relay-sky' : ''}`, value)); stats.append(s); };
    stat('Sent in all', bytes(m.totals?.bytes ?? history.reduce((n, r) => n + r.bytes, 0)), true);
    stat('Syncs', count(m.totals?.runs ?? history.length));
    stat('Last good', m.lastSuccessAt ? ago(m.lastSuccessAt) : '—');
    const list = el('ol', 'sweep-history');
    for (const r of history) {
      const li = el('li');
      li.append(el('span', '', `${new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${r.trigger === 'daily' ? 'daily' : 'by hand'}`),
        el('span', `sweep-mono ${r.ok ? 'relay-sky' : 'relay-coral'}`, r.ok ? `↑ ${bytes(r.bytes)}` : 'failed'),
        el('span', 'sweep-dim sweep-small', r.ok ? `${plural(r.files, 'file')} · ${Math.max(1, Math.round(r.ms / 1000))} s${r.route ? ` · ${routeName(r.route) || r.route}` : ''}` : (r.note || (r.jobs || []).filter(j => !j.ok).map(j => `${j.name}: ${j.error || 'failed'}`).join('; ') || 'failed')),
        el('span', 'sweep-dim sweep-small right', (r.jobs || []).filter(j => j.files).map(j => j.name).join(', ')));
      list.append(li);
    }
    return [stats, list];
  }
  function scheduleTab(m) {
    const row = el('div', 'sweep-row relay-pad');
    const step = el('div', 'sweep-stepper'); step.setAttribute('role', 'group'); step.setAttribute('aria-label', 'Sync time');
    step.append(button('', '−', () => void change('time', stepTime(m.schedule.time, -30)), '30 minutes earlier'), el('span', 'sweep-mono', m.schedule.time), button('', '+', () => void change('time', stepTime(m.schedule.time, 30)), '30 minutes later'));
    row.append(el('span', 'sweep-dim', 'Syncs daily at'), el('span', 'sweep-fill'), step);
    const facts = el('dl', 'sweep-facts wide');
    const fact = (term, value, cls = '') => facts.append(el('dt', '', term), el('dd', cls, value));
    fact('Background schedule', m.service.loaded ? 'Loaded' : m.service.installed ? 'Installed, not loaded' : 'Off', m.service.loaded ? 'sweep-mint' : 'sweep-amber');
    fact('Next', m.service.loaded ? nextWords(m.schedule.next) : '—');
    fact('Missed while asleep', 'runs on waking');
    fact('macOS notifications', m.schedule.notify ? 'On (relay’s own)' : 'Off');
    fact('Floor on the mini', `${bytes(m.floor)} free`);
    fact('Last exit', m.service.lastExit == null ? '—' : String(m.service.lastExit));
    fact('Agent', m.service.label, 'sweep-mono');
    const routes = el('ol', 'relay-routes');
    m.routes.forEach((host, i) => {
      const li = el('li', m.mini?.route === host ? 'on' : ''), left = el('span');
      left.append(el('span', 'sweep-mono', host), document.createTextNode(` ${routeName(host)}`));
      li.append(left, el('span', 'sweep-small', m.mini?.route === host ? 'in use' : i === 0 ? 'first' : 'fallback'));
      routes.append(li);
    });
    const acts = el('div', 'sweep-acts relay-pad');
    acts.append(button('sweep-soft', 'Run now in the background', () => void change('service', 'trigger')), button('sweep-soft', m.service.loaded ? 'Stop the schedule' : 'Start the schedule', () => void change('service', m.service.loaded ? 'uninstall' : 'install')));
    const log = el('pre', 'sweep-log sweep-mono', logLines ? (logLines.length ? logLines.join('\n') : 'Nothing logged yet: relay hasn’t synced.') : 'Reading the log…');
    return [row, facts, el('span', 'sweep-label', 'Routes to the mini, in order'), routes, acts, el('span', 'sweep-label', 'Log · ~/Library/Logs/relay.log'), log];
  }
  async function readLog() {
    if (!own()) return;
    try { logLines = (await api.relay('logs', 40)).lines.slice().reverse(); } catch (error) { logLines = [error.message]; }
    if (paneBody?.isConnected && tab === 'schedule') drawPane();
  }

  // Every minute while it's on screen; the icon itself on load, every five minutes, and after each sync.
  void load();
  let quiet = 0;
  setInterval(() => { quiet += 1; if (card || paneBody?.isConnected || quiet % 5 === 0) void load(); else drawIcon(); }, 60_000);

  return {
    button: icon,
    refresh: () => load({ fresh: true }),
    pane: {
      id: 'relay', title: 'Relay',
      render(body) { paneBody = body; drawPane(); void load(); if (tab === 'schedule') void readLog(); },
      leave() { paneBody = null; },
    },
  };
}
