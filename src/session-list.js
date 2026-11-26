import { dotLoader } from './dot-loader.js';
import { providerLogo } from './provider-logos.js';
import { inputRequiredSvg } from './popover.js';
import { createSidebarShiftGuard } from './sidebar-shift-guard.js';
import { formatSnoozeRemaining, isSessionSnoozed } from './thread-inbox.js';

const newestFirst = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt));
const PROVIDER_FAMILY = { claude: 'anthropic', anthropic: 'anthropic', codex: 'openai', openai: 'openai', gpt: 'openai', gemini: 'google', google: 'google', antigravity: 'google', deepseek: 'deepseek' };
const PROVIDER_NAMES = { anthropic: 'Claude', openai: 'Codex', google: 'Gemini', deepseek: 'DeepSeek' };
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(paths, size = 12, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const [tag, attrs] of paths) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}

const FOLDER_ICONS = {
  chevron: [['path', { d: 'm9 6 6 6-6 6' }]],
  branch: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
  diff: [['path', { d: 'M6 4v12M18 8v12' }], ['circle', { cx: 6, cy: 18, r: 2.2 }], ['circle', { cx: 18, cy: 6, r: 2.2 }], ['path', { d: 'M9 6h6' }]],
  local: [['rect', { x: 2.5, y: 4, width: 19, height: 12, rx: 2 }], ['path', { d: 'M8 20h8M12 16v4' }]],
  remote: [['rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }], ['rect', { x: 3, y: 13, width: 18, height: 7, rx: 2 }], ['line', { x1: 7, y1: 7.5, x2: 7.01, y2: 7.5 }], ['line', { x1: 7, y1: 16.5, x2: 7.01, y2: 16.5 }]],
  swarm: [['circle', { cx: 12, cy: 5, r: 2.3 }], ['circle', { cx: 5, cy: 18.5, r: 2.3 }], ['circle', { cx: 12, cy: 18.5, r: 2.3 }], ['circle', { cx: 19, cy: 18.5, r: 2.3 }], ['path', { d: 'M12 7.3v8.9M10.4 6.8 6.4 16.5M13.6 6.8l4 9.7' }]],
};

function swarmBadge(info) {
  if (!info) return null;
  if (info.status === 'running') {
    const el = document.createElement('span');
    el.className = 'folder-session-swarm is-running';
    const tip = `Agent swarm running (${info.active}/${info.total || info.active})`;
    el.title = tip; el.setAttribute('aria-label', tip);
    const num = document.createElement('span'); num.textContent = String(info.active);
    el.append(svgIcon(FOLDER_ICONS.swarm, 11), num);
    return el;
  }
  if (info.status === 'done' && info.unmerged > 0) {
    const el = document.createElement('span');
    el.className = 'folder-session-swarm has-merge';
    const tip = `Swarm finished — ${info.unmerged} unmerged`;
    el.title = tip; el.setAttribute('aria-label', tip);
    const num = document.createElement('span'); num.textContent = String(info.unmerged);
    el.append(svgIcon(FOLDER_ICONS.swarm, 11), num);
    return el;
  }
  return null;
}

function finishedDot(title = 'Agent finished') {
  const dot = document.createElement('span');
  dot.className = 'session-status-dot is-finished';
  dot.title = title;
  dot.setAttribute('aria-label', title);
  return dot;
}

function inputRequiredIcon(title = 'Input required') {
  const icon = document.createElement('span');
  icon.className = 'session-input-required';
  icon.title = title;
  icon.setAttribute('aria-label', title);
  icon.append(inputRequiredSvg(12));
  return icon;
}

/** Derive branch, provider, and local/remote metadata for a session row inside a Work folder. */
export function sessionFolderMeta(session, { folderBranch = '', statsMap = {}, isRemote = false, defaultProvider = 'claude' } = {}) {
  const provider = session?.provider || defaultProvider || '';
  const family = PROVIDER_FAMILY[provider] || '';
  const stats = session?.workPath ? (statsMap[session.workPath] || null) : null;
  const branch = session?.branch || stats?.branch || folderBranch || (session?.isolate ? 'own branch' : '');
  const providerLabel = PROVIDER_NAMES[family] || (provider ? `${provider[0].toUpperCase()}${provider.slice(1)}` : '');
  return {
    branch,
    provider,
    family,
    providerLabel,
    remote: Boolean(session?.remote ?? isRemote),
  };
}

export function relativeAge(iso, now = Date.now()) {
  if (!iso) return '';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, Math.floor((now - ts) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function monogramOf(repo, folderName) {
  const leaf = String(repo || folderName || 'P').split('/').filter(Boolean).pop() || String(folderName || 'P');
  const words = leaf.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  const compact = leaf.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (compact.slice(0, 2) || 'P').trim();
}

/** Derive display metadata and Git stats for a project folder card in Work mode. */
export function folderProjectMeta(folder, statsMap = {}, now = Date.now()) {
  const sessions = Array.isArray(folder?.sessions) ? [...folder.sessions].sort(newestFirst) : [];
  const counts = new Map();
  for (const s of sessions) {
    if (s?.workPath) counts.set(s.workPath, (counts.get(s.workPath) || 0) + 1);
  }
  let workPath = '';
  let bestCount = -1;
  for (const s of sessions) {
    const p = s?.workPath;
    if (!p) continue;
    const c = counts.get(p) || 0;
    if (c > bestCount) { bestCount = c; workPath = p; }
  }
  const newest = sessions[0] || null;
  const newestWork = sessions.find(s => s?.work) || null;
  const newestBranch = sessions.find(s => s?.branch) || null;
  const newestProvider = sessions.find(s => s?.provider) || null;
  const stats = workPath ? (statsMap[workPath] || null) : null;
  const repo = stats?.repo || newestWork?.work || folder?.name || 'Project';
  const branch = stats?.branch || newestBranch?.branch || '';
  const updatedAt = newest?.updatedAt || '';
  return {
    workPath,
    repo,
    branch,
    changed: Number(stats?.changed) || 0,
    ahead: Number(stats?.ahead) || 0,
    behind: Number(stats?.behind) || 0,
    updatedAt,
    age: relativeAge(updatedAt, now),
    provider: newestProvider?.provider || '',
    sessionCount: sessions.length,
    monogram: monogramOf(stats?.repo || newestWork?.work || '', folder?.name),
  };
}

// Pinned chats first, then your sections with their folders, then folders in no section, then everything else. A pinned
// chat shows only under Pinned. Folders and sections keep the order you dragged them into; chats stay newest first.
export function arrangeSessions({ sessions = [], folders = [], categories = [] } = {}) {
  const sorted = [...sessions].sort(newestFirst), known = new Set(folders.map(folder => folder.id)), sections = new Set(categories.map(category => category.id));
  const filled = folders.map(folder => ({ ...folder, sessions: sorted.filter(session => !session.pinned && session.folder === folder.id) }));
  return {
    pinned: sorted.filter(session => session.pinned),
    categories: categories.map(category => ({ ...category, folders: filled.filter(folder => folder.category === category.id) })),
    folders: filled.filter(folder => !sections.has(folder.category)),
    rest: sorted.filter(session => !session.pinned && !known.has(session.folder)),
  };
}

// The sidebar's two modes, as in Claude Code: Chat lists your ordinary chats; Work lists your sections (Research,
// Development…) with their folders, folders in no section, and work sessions in no folder. Pinned chats show in the mode
// they belong to. A chat inside a folder belongs to Work, whatever it is, because its folder does.
export const MODES = Object.freeze(['chat', 'work']);
export const sessionMode = session => session?.work ? 'work' : 'chat';
export function forMode(arranged, mode = 'chat') {
  const mine = session => sessionMode(session) === mode;
  if (mode === 'work') return { ...arranged, pinned: arranged.pinned.filter(mine), rest: arranged.rest.filter(mine) };
  return { ...arranged, pinned: arranged.pinned.filter(mine), categories: [], folders: [], rest: arranged.rest.filter(mine) };
}
// Which mode shows a chat: Work if it's a work session or sits in a folder, otherwise Chat.
export function modeOf(session, folders = []) {
  if (!session) return null;
  if (!session.pinned && session.folder && folders.some(folder => folder.id === session.folder)) return 'work';
  return sessionMode(session);
}

// What's being dragged, by its kind: a chat, a folder or a section.
export const DRAG = { session: 'application/x-fairy-session', folder: 'application/x-fairy-folder', category: 'application/x-fairy-category' };

export function setupSessionList({ api, root, notebooks, selectButton, selectionBar, label, onOpen, onError, isBusy, isRemote = () => false, defaultProvider = () => 'claude', mode: startMode = 'chat', onMode = () => {}, onConvertToWork = null }) {
  let state = { active: null, sessions: [], folders: [], categories: [] }, results = null, query = '', editing = null, searchRun = 0, selected = null, lastPicked = null;
  let mode = MODES.includes(startMode) ? startMode : 'chat', shownKey = '';
  const shiftGuard = createSidebarShiftGuard({ container: root });
  const setMode = next => { if (!MODES.includes(next) || next === mode) return; mode = next; onMode(mode); render(); };
  // A chat opened from elsewhere (a new work session, a notification, search) shows in its own mode, and converting an
  // open chat to Work moves the list with it; otherwise the mode stays put so you can switch away from it manually.
  const follow = () => {
    const wanted = modeOf(state.sessions.find(session => session.id === state.active), state.folders);
    const key = state.active ? `${state.active}:${wanted || ''}` : '';
    if (key === shownKey) return;
    shownKey = key;
    if (wanted && wanted !== mode) { mode = wanted; onMode(mode); }
  };
  const closeMenu = () => document.querySelector('.session-menu')?.remove();
  const guard = async work => { try { const next = await work(); if (next?.sessions) state = next; render(); return next; } catch (error) { onError(error.message); } };
  let folderStats = {}, folderStatsPending = false;
  const folderStatsAt = new Map(), FOLDER_STATS_TTL_MS = 30_000;
  function scheduleFolderStats(categories, folders) {
    if (mode !== 'work' || folderStatsPending || typeof api?.folderProjectStats !== 'function') return;
    const allFolders = [...categories.flatMap(category => category.folders), ...folders];
    const now = Date.now();
    const paths = [...new Set(allFolders.map(folder => folderProjectMeta(folder, folderStats, now).workPath).filter(Boolean))]
      .filter(workPath => now - (folderStatsAt.get(workPath) || 0) >= FOLDER_STATS_TTL_MS);
    if (!paths.length) return;
    folderStatsPending = true;
    void Promise.resolve(api.folderProjectStats(paths)).then(next => {
      const stamp = Date.now();
      for (const workPath of paths) folderStatsAt.set(workPath, stamp);
      if (next && typeof next === 'object') { folderStats = { ...folderStats, ...next }; if (mode === 'work') render(); }
    }).catch(() => {
      const stamp = Date.now();
      for (const workPath of paths) folderStatsAt.set(workPath, stamp - FOLDER_STATS_TTL_MS + 3_000);
    }).finally(() => { folderStatsPending = false; });
  }

  function menuButton(open) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'session-more'; button.textContent = '⋯'; button.setAttribute('aria-haspopup', 'menu');
    button.onclick = event => { event.stopPropagation(); open(button); };
    return button;
  }
  function showMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div'); menu.className = 'session-menu'; menu.setAttribute('role', 'menu');
    for (const item of items) {
      if (item.heading) { const heading = document.createElement('p'); heading.textContent = item.heading; menu.append(heading); continue; }
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'menuitem'); button.textContent = item.label; button.disabled = Boolean(item.disabled);
      if (item.danger) button.className = 'danger';
      button.onclick = () => { closeMenu(); item.run(); };
      menu.append(button);
    }
    document.body.append(menu);
    const box = anchor.getBoundingClientRect(), { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    menu.style.top = `${box.bottom + height + 8 > innerHeight ? Math.max(8, box.top - height - 4) : box.bottom + 4}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  // Rename happens in place, because the window has no prompt dialog.
  function nameInput(value, ariaLabel, commit) {
    const input = document.createElement('input');
    input.className = 'session-name'; input.value = value; input.maxLength = 80; input.setAttribute('aria-label', ariaLabel);
    let finished = false;
    const finish = save => { if (finished) return; finished = true; editing = null; if (save && input.value.trim() && input.value.trim() !== value) void guard(() => commit(input.value)); else render(); };
    input.onkeydown = event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finish(true); } if (event.key === 'Escape') { event.preventDefault(); finish(false); } };
    input.onblur = () => finish(true);
    input.onclick = event => event.stopPropagation();
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }
  const open = async id => {
    if (id === state.active) return;
    await guardOpen(() => api.sessionOpen(id));
  };
  const guardOpen = async work => { try { const next = await work(); if (next) await onOpen(next); } catch (error) { onError(error.message); } };

  // A chat that's working can't be deleted, so it can't be ticked either.
  const selectable = session => !state.running?.[session.id] && !(session.id === state.active && isBusy());
  const startSelecting = ids => { selected = new Set(ids); lastPicked = null; render(); };
  const stopSelecting = () => { selected = null; lastPicked = null; render(); };
  const shownChats = () => [...notebooks.querySelectorAll('[data-session]'), ...root.querySelectorAll('[data-session]')].map(element => element.dataset.session);
  function pick(session, event) {
    if (!selectable(session)) return;
    selected ??= new Set();
    const shown = shownChats(), from = shown.indexOf(lastPicked), to = shown.indexOf(session.id);
    if (event.shiftKey && from >= 0 && to >= 0) {
      for (const id of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) { const other = state.sessions.find(entry => entry.id === id); if (other && selectable(other)) selected.add(id); }
    } else if (!selected.delete(session.id)) selected.add(session.id);
    lastPicked = session.id;
    render();
  }
  async function trashSelected() {
    const ids = state.sessions.filter(session => selected.has(session.id) && selectable(session)).map(session => session.id);
    if (!ids.length || !confirm(`Move ${ids.length} ${ids.length === 1 ? 'chat' : 'chats'} to the Trash?`)) return;
    const showing = state.active;
    await guardOpen(async () => {
      const { state: next, removed, failed } = await api.sessionsRemove(ids);
      selected = failed.length ? new Set(failed.map(entry => entry.id)) : null;
      lastPicked = null;
      results = results?.filter(hit => !removed.includes(hit.id)) ?? null;
      if (failed.length) onError(`${failed.length} couldn’t be moved to the Trash: ${failed[0].message}`);
      // Removing other chats must leave the one on screen alone, even mid-reply.
      if (removed.includes(showing)) return next;
      state = next.sessions; render(); return null;
    });
  }
  function renderSelectionBar() {
    selectButton.setAttribute('aria-pressed', String(Boolean(selected)));
    selectionBar.hidden = !selected;
    if (!selected) { selectionBar.replaceChildren(); return; }
    const count = document.createElement('span'); count.className = 'selection-count'; count.textContent = selected.size ? `${selected.size} selected` : 'Tick the chats to delete';
    const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'danger'; trash.textContent = 'Move to Trash'; trash.disabled = !selected.size; trash.onclick = () => void trashSelected();
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.onclick = stopSelecting;
    selectionBar.replaceChildren(count, trash, cancel);
  }
  function sessionMenu(session, anchor) {
    const items = [
      { label: 'Rename', run: () => { editing = session.id; render(); } },
      { label: session.pinned ? 'Unpin' : 'Pin', run: () => void guard(() => api.sessionPin(session.id, !session.pinned)) },
      { label: 'Select', disabled: !selectable(session), run: () => startSelecting([session.id]) },
    ];
    if (!session.work && api?.sessionToWork) {
      items.push(
        { label: 'Convert to work session…', disabled: !selectable(session), run: () => void guardOpen(() => (onConvertToWork ? onConvertToWork(session.id) : api.sessionToWork(session.id))) },
        { label: 'Convert to scratch session', disabled: !selectable(session), run: () => void guardOpen(() => (onConvertToWork ? onConvertToWork(session.id, 'scratch') : api.sessionToWork(session.id, 'scratch'))) },
      );
    }
    if (state.folders.length || session.folder) items.push({ heading: 'Move to' });
    for (const folder of state.folders) if (folder.id !== session.folder) items.push({ label: folder.name, run: () => void guard(() => api.sessionMove(session.id, folder.id)) });
    if (session.folder) items.push({ label: 'Out of folder', run: () => void guard(() => api.sessionMove(session.id, null)) });
    items.push({ label: 'Move to Trash', danger: true, disabled: Boolean(state.running?.[session.id]) || (session.id === state.active && isBusy()), run: () => {
      if (!confirm(`Move “${session.title}” to the Trash?`)) return;
      // Removing another chat must leave the one on screen alone, even mid-reply.
      const showing = session.id === state.active;
      void guardOpen(async () => { const next = await api.sessionRemove(session.id); if (showing) return next; state = next.sessions; render(); return null; });
    } });
    showMenu(anchor, items);
  }
  function row(session, extra) {
    const item = document.createElement('div');
    item.className = 'session-row'; item.dataset.session = session.id;
    if (session.id === state.active) item.classList.add('current');
    const run = state.running?.[session.id], replying = session.id === state.active && isBusy();
    const swarm = state.swarms?.[session.id] || null;
    const isFinished = Array.isArray(state.finished) && state.finished.includes(session.id) && session.id !== state.active && !run && !replying && swarm?.status !== 'running';
    if (run === 'waiting') item.classList.add('waiting');
    else if (run || replying) item.classList.add('busy');
    if (swarm?.status === 'running') item.classList.add('is-swarming');
    if (isFinished) item.classList.add('is-finished');
    if (editing === session.id) { item.append(nameInput(session.title, 'Chat name', value => api.sessionRename(session.id, value))); return item; }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sessionId = session.id;
    if (session.id === state.active) button.setAttribute('aria-current', 'true');
    button.onclick = event => { if (selected || event.metaKey || event.shiftKey) pick(session, event); else void open(session.id).then(() => extra?.onOpened?.()); };
    const inWorkFolder = mode === 'work' && extra?.inFolder && !selected && !extra?.snippet;
    const swarmTip = swarm?.status === 'running' ? `swarm (${swarm.active}/${swarm.total} active)` : swarm?.unmerged ? `swarm (${swarm.unmerged} unmerged)` : '';
    if (inWorkFolder) {
      item.classList.add('folder-session');
      button.className = 'side-recent-item folder-session-btn';
      const sm = sessionFolderMeta(session, {
        folderBranch: extra.folderBranch || '',
        statsMap: folderStats,
        isRemote: Boolean(isRemote()),
        defaultProvider: defaultProvider() || 'claude',
      });
      const titleLine = document.createElement('span'); titleLine.className = 'folder-session-title'; titleLine.textContent = session.title;
      const metaLine = document.createElement('span'); metaLine.className = 'folder-session-meta';
      if (sm.branch) {
        const br = document.createElement('span'); br.className = 'folder-session-branch';
        const brName = document.createElement('span'); brName.className = 'folder-session-branch-name'; brName.textContent = sm.branch;
        br.append(svgIcon(FOLDER_ICONS.branch, 10.5), brName);
        metaLine.append(br);
      }
      const badges = document.createElement('span'); badges.className = 'folder-session-badges';
      const swarmPill = swarmBadge(swarm);
      if (swarmPill) badges.append(swarmPill);
      const locLabel = sm.remote ? 'Remote' : 'Local';
      const loc = document.createElement('span'); loc.className = 'folder-session-loc';
      loc.title = locLabel; loc.setAttribute('aria-label', locLabel);
      loc.append(svgIcon(sm.remote ? FOLDER_ICONS.remote : FOLDER_ICONS.local, 11.5));
      badges.append(loc);
      const logo = sm.family ? providerLogo(sm.family) : null;
      if (logo) {
        const p = document.createElement('span'); p.className = 'folder-session-provider';
        p.title = sm.providerLabel; p.setAttribute('aria-label', sm.providerLabel);
        p.append(logo);
        badges.append(p);
      }
      metaLine.append(badges);
      button.append(titleLine, metaLine);
      button.title = [session.title, session.work, sm.branch, sm.providerLabel, locLabel, swarmTip, run === 'waiting' ? 'needs your OK' : run ? 'working' : isFinished ? 'finished' : ''].filter(Boolean).join(' · ');
    } else {
      button.className = 'side-recent-item'; button.textContent = session.title; button.title = session.title;
      if (session.work) button.title = [session.title, session.work, swarmTip, run === 'waiting' ? 'needs your OK' : run ? 'working' : isFinished ? 'finished' : ''].filter(Boolean).join(' · ');
    }
    if (session.work) item.classList.add('work');
    // A session another chat started says which, and is marked in the list.
    const parent = session.parent && state.sessions.find(entry => entry.id === session.parent);
    if (parent) { item.classList.add('linked'); button.title += ` · started from ${parent.title}`; }
    if (extra?.snippet) { const line = document.createElement('span'); line.className = 'session-snippet'; line.textContent = extra.snippet; button.append(line); item.classList.add('with-snippet'); }
    if (selected) {
      const picked = selected.has(session.id), can = selectable(session);
      item.classList.add('selecting'); item.classList.toggle('picked', picked);
      button.setAttribute('role', 'checkbox'); button.setAttribute('aria-checked', String(picked)); button.disabled = !can;
      if (!can) button.title = `${session.title} · still working`;
      item.append(button);
      item.oncontextmenu = event => event.preventDefault();
      return item;
    }
    item.append(button, menuButton(anchor => sessionMenu(session, anchor)));
    // Waiting for input, a work session running, Fairy replying here, or recently finished in the background.
    if (run === 'waiting') item.append(inputRequiredIcon('Input required — needs your OK'));
    else {
      const dots = run ? (session.work ? 'orbit' : 'scan') : replying ? 'scan' : null;
      if (dots) item.append(dotLoader(dots));
      else if (isFinished) item.append(finishedDot());
    }
    const snoozeText = isSessionSnoozed(session) ? formatSnoozeRemaining(session.snoozedUntil) : '';
    if (snoozeText) {
      item.classList.add('is-snoozed');
      const badge = document.createElement('span');
      badge.className = 'snooze-badge';
      badge.textContent = snoozeText;
      badge.title = `Snoozed (${snoozeText} left)`;
      item.append(badge);
    }
    if (!inWorkFolder && swarm) {
      const pill = swarmBadge(swarm);
      if (pill) item.append(pill);
    }
    draggable(item, DRAG.session, session.id);
    item.oncontextmenu = event => { event.preventDefault(); sessionMenu(session, { getBoundingClientRect: () => ({ left: event.clientX, top: event.clientY, bottom: event.clientY }) }); };
    return item;
  }
  function draggable(element, kind, id) {
    element.draggable = true;
    element.ondragstart = event => { event.stopPropagation(); event.dataTransfer.setData(kind, id); event.dataTransfer.effectAllowed = 'move'; element.classList.add('dragging'); };
    element.ondragend = () => element.classList.remove('dragging');
  }
  // Each place takes some kinds of thing: dropping a chat on a folder files it there, dropping a folder on a folder puts
  // it just above, dropping a folder on a section moves it in, and dropping a section on a section puts it just above.
  function dropTarget(element, takes) {
    const kind = event => Object.keys(takes).find(name => event.dataTransfer.types.includes(DRAG[name]));
    element.ondragover = event => { if (kind(event)) { event.preventDefault(); event.stopPropagation(); element.classList.add('drop'); } };
    element.ondragleave = () => element.classList.remove('drop');
    element.ondrop = event => {
      const found = kind(event);
      if (!found) return;
      event.preventDefault(); event.stopPropagation(); element.classList.remove('drop');
      const id = event.dataTransfer.getData(DRAG[found]);
      if (id) void guard(() => takes[found](id));
    };
  }
  function folderBlock(folder) {
    const block = document.createElement('div'); block.className = 'session-folder';
    const head = document.createElement('div'); head.className = 'session-row folder-row';
    const meta = mode === 'work' ? folderProjectMeta(folder, folderStats) : null;
    const folderSwarmActive = folder.sessions.reduce((sum, s) => sum + (state.swarms?.[s.id]?.status === 'running' ? (state.swarms[s.id].active || 1) : 0), 0);
    const folderHasFinished = folder.collapsed && folder.sessions.some(s => Array.isArray(state.finished) && state.finished.includes(s.id) && s.id !== state.active && !state.running?.[s.id]);
    if (folder.collapsed && folder.sessions.some(session => state.running?.[session.id] === 'waiting')) head.classList.add('waiting');
    else if (folder.collapsed && (folderSwarmActive > 0 || folder.sessions.some(session => state.running?.[session.id] || (session.id === state.active && isBusy())))) head.classList.add('busy');
    else if (folderHasFinished) head.classList.add('is-finished');
    if (head.classList.contains('waiting')) head.append(inputRequiredIcon('Input required in this folder'));
    else if (head.classList.contains('busy')) head.append(dotLoader('orbit'));
    else if (head.classList.contains('is-finished')) head.append(finishedDot('Agent finished in this folder'));
    if (editing === folder.id) head.append(nameInput(folder.name, 'Folder name', value => api.folderRename(folder.id, value)));
    else {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('aria-expanded', String(!folder.collapsed));
      button.onclick = () => void guard(() => api.folderCollapse(folder.id, !folder.collapsed));
      const ready = folder.sessions.filter(selectable).map(session => session.id);
      const tick = selected ? (() => {
        const all = ready.length && ready.every(id => selected.has(id)), some = ready.some(id => selected.has(id));
        const box = document.createElement('button');
        box.type = 'button'; box.className = 'folder-tick'; box.disabled = !ready.length; box.setAttribute('role', 'checkbox'); box.setAttribute('aria-checked', all ? 'true' : some ? 'mixed' : 'false');
        box.setAttribute('aria-label', `Select everything in ${folder.name}`); box.title = `Select everything in ${folder.name}`;
        box.onclick = () => { for (const id of ready) { if (all) selected.delete(id); else selected.add(id); } render(); };
        return box;
      })() : null;
      const more = selected ? null : menuButton(anchor => showMenu(anchor, [
        { label: 'Select its chats', disabled: !ready.length, run: () => startSelecting(ready) },
        { label: 'Rename', run: () => { editing = folder.id; render(); } },
        ...(state.categories?.length ? [{ heading: 'Move to section' },
          ...state.categories.filter(category => category.id !== folder.category).map(category => ({ label: category.name, run: () => void guard(() => api.folderPlace(folder.id, { category: category.id })) })),
          ...(folder.category ? [{ label: 'Out of section', run: () => void guard(() => api.folderPlace(folder.id, { category: null })) }] : [])] : []),
        { label: 'Delete folder', danger: true, run: () => { if (!folder.sessions.length || confirm(`Delete “${folder.name}”? Its chats go back in the list.`)) void guard(() => api.folderRemove(folder.id)); } },
      ]));
      if (meta) {
        head.classList.add('folder-card');
        button.className = 'side-recent-item folder-card-btn';
        const top = document.createElement('span'); top.className = 'folder-card-top';
        const mono = document.createElement('span'); mono.className = 'folder-card-monogram'; mono.setAttribute('aria-hidden', 'true'); mono.textContent = meta.monogram;
        const chev = svgIcon(FOLDER_ICONS.chevron, 11, 'folder-card-chev');
        const repo = document.createElement('span'); repo.className = 'folder-card-repo'; repo.textContent = meta.repo;
        top.append(mono, chev, repo);
        if (meta.age) { const age = document.createElement('span'); age.className = 'folder-card-age'; age.textContent = meta.age; top.append(age); }
        const title = document.createElement('span'); title.className = 'folder-card-title'; title.textContent = folder.name;
        const foot = document.createElement('span'); foot.className = 'folder-card-foot';
        const branchWrap = document.createElement('span'); branchWrap.className = 'folder-card-branch';
        const branchName = document.createElement('span'); branchName.className = 'folder-card-branch-name';
        branchName.textContent = meta.branch || `${meta.sessionCount} ${meta.sessionCount === 1 ? 'session' : 'sessions'}`;
        branchWrap.append(svgIcon(FOLDER_ICONS.branch, 11), branchName);
        const stats = document.createElement('span'); stats.className = 'folder-card-stats';
        if (folderSwarmActive > 0) {
          const pill = swarmBadge({ status: 'running', active: folderSwarmActive, total: folderSwarmActive });
          if (pill) stats.append(pill);
        }
        if (meta.ahead > 0) {
          const stat = document.createElement('span'); stat.className = 'folder-card-stat is-ahead';
          const num = document.createElement('span'); num.textContent = `+${meta.ahead}`;
          stat.append(svgIcon(FOLDER_ICONS.branch, 11), num); stats.append(stat);
        } else if (meta.changed > 0) {
          const stat = document.createElement('span'); stat.className = 'folder-card-stat is-changed';
          const num = document.createElement('span'); num.textContent = String(meta.changed);
          stat.append(svgIcon(FOLDER_ICONS.diff, 11), num); stats.append(stat);
        }
        const count = document.createElement('span'); count.className = 'session-count folder-card-count'; count.textContent = folder.sessions.length;
        stats.append(count);
        const logo = meta.provider ? providerLogo(PROVIDER_FAMILY[meta.provider] || meta.provider) : null;
        if (logo) { const p = document.createElement('span'); p.className = 'folder-card-provider'; p.append(logo); stats.append(p); }
        foot.append(branchWrap, stats);
        button.append(top, title, foot);
        button.title = [folder.name, meta.repo, meta.branch, meta.ahead > 0 ? `+${meta.ahead} ahead` : '', meta.changed > 0 ? `${meta.changed} changed` : '', folderSwarmActive > 0 ? `${folderSwarmActive} swarm active` : '', folderHasFinished ? 'agent finished' : '', `${meta.sessionCount} ${meta.sessionCount === 1 ? 'session' : 'sessions'}`].filter(Boolean).join(' · ');
        head.append(button, ...(tick ? [tick] : [more]));
      } else {
        button.className = 'side-recent-item';
        button.textContent = folder.name; button.title = folder.name;
        const count = document.createElement('span'); count.className = 'session-count'; count.textContent = folder.sessions.length;
        head.append(button, count, ...(tick ? [tick] : [more]));
      }
      draggable(block, DRAG.folder, folder.id);
    }
    dropTarget(head, {
      session: id => api.sessionMove(id, folder.id),
      folder: id => api.folderPlace(id, { category: folder.category ?? null, before: folder.id }),
    });
    block.append(head);
    if (!folder.collapsed) block.append(...folder.sessions.map(session => row(session, { inFolder: mode === 'work', folderBranch: meta?.branch || '' })));
    return block;
  }
  // A section: its name (click to fold it away), how many folders it holds, and its folders in your order. Drag folders
  // onto it to file them, or drag the section itself above another.
  function categoryBlock(category) {
    const block = document.createElement('div'); block.className = 'session-category';
    const head = document.createElement('div'); head.className = 'session-row category-row';
    if (editing === category.id) head.append(nameInput(category.name, 'Section name', value => api.categoryRename(category.id, value)));
    else {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'side-recent-item'; button.setAttribute('aria-expanded', String(!category.collapsed));
      button.textContent = category.name; button.title = category.name;
      button.onclick = () => void guard(() => api.categoryCollapse(category.id, !category.collapsed));
      const count = document.createElement('span'); count.className = 'session-count'; count.textContent = category.folders.length;
      head.append(button, count);
      if (!selected) {
        head.append(menuButton(anchor => showMenu(anchor, [
          { label: 'Rename', run: () => { editing = category.id; render(); } },
          { label: 'Delete section', danger: true, run: () => { if (!category.folders.length || confirm(`Delete the section “${category.name}”? Its folders and chats stay.`)) void guard(() => api.categoryRemove(category.id)); } },
        ])));
        draggable(block, DRAG.category, category.id);
      }
    }
    dropTarget(head, {
      folder: id => api.folderPlace(id, { category: category.id }),
      category: id => api.categoryPlace(id, category.id),
    });
    block.append(head);
    if (!category.collapsed) {
      const inside = document.createElement('div'); inside.className = 'session-category-folders';
      if (category.folders.length) inside.append(...category.folders.map(folderBlock));
      else { const empty = document.createElement('p'); empty.className = 'session-empty category-empty'; empty.textContent = 'Drag folders here'; inside.append(empty); dropTarget(empty, { folder: id => api.folderPlace(id, { category: category.id }) }); }
      block.append(inside);
    }
    return block;
  }
  function render() {
    renderSelectionBar();
    label.textContent = results ? 'Matches' : mode === 'work' ? 'Work' : 'Chats';
    if (results) {
      root.replaceChildren(...results.map(hit => row({ ...state.sessions.find(session => session.id === hit.id), ...hit }, { snippet: hit.snippet, onOpened: () => onSearchOpen(query) })));
      if (!results.length) { const empty = document.createElement('p'); empty.className = 'session-empty'; empty.textContent = 'No chats match.'; root.append(empty); }
      return;
    }
    const { pinned, categories, folders: allFolders, rest } = forMode(arrangeSessions(state), mode), parts = [];
    const visibleCategories = categories.map(category => ({ ...category, folders: category.folders.filter(folder => folder.section !== 'notebooks') }));
    const folders = allFolders.filter(folder => folder.section !== 'notebooks');
    scheduleFolderStats(visibleCategories, folders);
    // Chats copied in from Proton notebooks stay saved and searchable, but aren't listed here: Study notebooks is where notebooks live now.
    notebooks.replaceChildren();
    if (pinned.length) { const heading = document.createElement('p'); heading.className = 'session-heading'; heading.textContent = 'Pinned'; parts.push(heading, ...pinned.map(session => row(session))); }
    parts.push(...visibleCategories.map(categoryBlock));
    if (visibleCategories.length && folders.length) { const heading = document.createElement('p'); heading.className = 'session-heading'; heading.textContent = 'Folders'; parts.push(heading); }
    parts.push(...folders.map(folderBlock));
    if (rest.length && (pinned.length || folders.length || categories.length)) { const heading = document.createElement('p'); heading.className = 'session-heading'; heading.textContent = mode === 'work' ? 'Work sessions' : 'Everything else'; parts.push(heading); }
    parts.push(...rest.map(session => row(session)));
    if (!parts.length) { const empty = document.createElement('p'); empty.className = 'session-empty'; empty.textContent = mode === 'work' ? 'No work sessions or sections yet.' : 'No chats yet.'; parts.push(empty); }
    root.replaceChildren(...parts);
    // Dropped anywhere else: a chat leaves its folder, a folder leaves its section, a section goes to the bottom.
    dropTarget(root, {
      session: id => api.sessionMove(id, null),
      folder: id => api.folderPlace(id, { category: null }),
      category: id => api.categoryPlace(id, null),
    });
    shiftGuard.afterRender();
  }
  let onSearchOpen = () => {};
  document.addEventListener('click', event => { if (!event.target.closest('.session-menu')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(); if (selected) stopSelecting(); } });
  selectButton.onclick = () => { if (selected) stopSelecting(); else startSelecting([]); };
  return {
    update(next) {
      if (next) state = next;
      follow();
      if (selected) selected = new Set(state.sessions.filter(session => selected.has(session.id) && selectable(session)).map(session => session.id));
      render();
    },
    render,
    mode: () => mode,
    setMode,
    newCategory: () => guard(async () => { const next = await api.categoryNew(); editing = next.categories.at(-1)?.id ?? null; return next; }),
    newFolder: () => guard(async () => { const next = await api.folderNew(); editing = next.folders.at(-1)?.id ?? null; return next; }),
    search: async value => {
      query = value.trim();
      const run = ++searchRun;
      if (!query) { results = null; render(); return; }
      try { const found = await api.sessionSearch(query); if (run === searchRun) { results = found; render(); } } catch (error) { onError(error.message); }
    },
    onSearchOpen: fn => { onSearchOpen = fn; },
  };
}
