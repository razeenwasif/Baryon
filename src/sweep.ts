import './sweep.css';

// Sweep in Fairy's window (desktop/sweep.mjs does the asking): a broom on the action rail that sweeps while the user's
// disk cleaner runs, a card when you rest the pointer on it, a small notification when a sweep starts on its own and
// when one ends, and a Sweep panel beside the chat with sweep's own dashboard: the disk and its auto-clean line,
// targets, history and the background watcher. Each Mac's window shows its own Mac first and the other one too: a
// window on the MacBook asks the Mac Fairy lives on (sweepMini); the Mac Fairy lives on shows the MacBook as its
// window last told it. Nothing is ever cleaned without your click, and a sweep always asks first.

import { GB, ago, broomState, clock, gb, gbFine, sweepCount, sweepTier, tierOf } from './sweep-logic.js';
import type { BroomHostState, SweepTarget } from './sweep-logic.js';

export interface SweepTargetEntry extends SweepTarget {
  id: string;
  name: string;
  bytes: number;
  enabled: boolean;
  tier: string;
  description?: string;
  note?: string;
  denied?: boolean;
}

export interface SweepRunningInfo {
  trigger?: string;
  index: number;
  total: number;
  current: string | null;
  freed: number;
  reason?: string;
}

export interface SweepHistoryRecord {
  at: number | string;
  trigger: string;
  freed: number;
  freeBefore: number;
  freeAfter: number;
  targets: number;
  ms: number;
  top: Array<{ name: string }>;
}

export interface SweepDoneRecord {
  freed: number;
  freeAfter: number;
  targets: number;
  ms: number;
  warnings: unknown[];
}

export interface SweepServiceInfo {
  loaded?: boolean;
  installed?: boolean;
  lastExit?: number | null;
}

export interface SweepConfigInfo {
  interval: number;
  cooldown: number;
  emergency: number;
  notify?: boolean;
}

export interface SweepMacState {
  host?: string;
  name?: string;
  error?: string | null;
  told?: boolean;
  at?: number;
  below?: boolean;
  scanning?: boolean;
  running?: SweepRunningInfo | null;
  disk?: { free: number; total: number };
  threshold?: number;
  lastCheckAt?: number | null;
  lastSweepAt?: number | null;
  lastFreed?: number;
  totalFreed?: number;
  config?: SweepConfigInfo;
  service?: SweepServiceInfo | null;
  scan?: { at: number; targets: SweepTargetEntry[] } | null;
  history?: SweepHistoryRecord[];
  peer?: SweepMacState | null;
}

export interface SweepEvent {
  type: 'start' | 'progress' | 'done' | string;
  host?: string;
  name?: string;
  running?: SweepRunningInfo | null;
  record?: SweepDoneRecord | null;
  problem?: string;
}

export interface SweepApi {
  sweep: (action: string, ...args: unknown[]) => Promise<any>;
  sweepMini?: (action: string, ...args: unknown[]) => Promise<any>;
  onSweep?: (callback: (event: SweepEvent) => void) => () => void;
}

export interface SweepSidePaneRef {
  show: (tab: string) => void;
}

export interface SweepTerminalRef {
  type: (text: string) => unknown;
}

export interface SweepViewOptions {
  api: SweepApi;
  rail: HTMLElement;
  after?: Element | null;
  sidePane?: () => SweepSidePaneRef | null;
  terminal?: SweepTerminalRef | null;
  onError?: (message: string) => void;
}

export interface SweepViewController {
  button: HTMLButtonElement;
  refresh: () => Promise<void>;
  pane: {
    id: 'sweep';
    title: 'Sweep';
    render: (body: HTMLElement) => void;
    leave: () => void;
  };
}

type MacKey = 'here' | 'other';
type SweepTab = 'targets' | 'history' | 'service';
type SweepCallFn = (action: string, ...args: unknown[]) => Promise<any>;

const BROOM = '<path d="M20.5 3.5 13 11"/><path d="M11.2 9.8l3 3"/><path d="M11.8 10.6 5 16.2c-.9.8-1 2.2-.2 3l.4.4c.8.8 2.2.7 3-.2l5.6-6.8"/><path d="M7.2 14.6l2.4 2.4M5.6 16.6l1.8 1.8"/>';
const svg = (inner: string, size = 18, stroke = 1.8): string => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const button = (className: string, text: string, onclick: (ev: MouseEvent) => void, title?: string): HTMLButtonElement => {
  const node = el('button', className, text);
  node.type = 'button';
  node.onclick = onclick;
  if (title) { node.title = title; if (!text) node.setAttribute('aria-label', title); }
  return node;
};
const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const toBroomHost = (mac: SweepMacState | null): BroomHostState | null => (
  mac ? { running: Boolean(mac.running), below: mac.below, service: mac.service } : null
);

export function sweepView({ api, rail, after = null, sidePane = () => null, terminal = null, onError = () => {} }: SweepViewOptions): SweepViewController {
  const remote = (): boolean => document.documentElement.classList.contains('remote-window');
  const macs: Record<MacKey, SweepMacState | null> = { here: null, other: null };
  let doneAt = 0;
  let selected: MacKey = 'here';
  let tab: SweepTab = 'targets';
  let aggressive = false;
  let confirming: MacKey | null = null;
  let logLines: string[] | null = null;
  let loading: Promise<void> | null = null;
  let paneBody: HTMLElement | null = null;
  let card: HTMLDivElement | null = null;
  let cardTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let toast: HTMLDivElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Which call reaches a Mac: its own window's Mac directly; from a window on the MacBook, the Mac Fairy lives on.
  const callFor = (key: MacKey): SweepCallFn | null => (
    key === 'here'
      ? (...args) => api.sweep(...args)
      : remote() && api.sweepMini
        ? (...args) => api.sweepMini!(...args)
        : null
  );
  const full = (key: MacKey): boolean => Boolean(macs[key]?.history);

  /* ── the broom on the rail ─────────────────────────────────────────── */
  const broom = document.createElement('button');
  broom.type = 'button'; broom.id = 'sweep-button'; broom.className = 'side-item'; broom.textContent = 'Sweep';
  broom.setAttribute('aria-label', 'Sweep');
  broom.insertAdjacentHTML('beforeend', `<span class="sweep-icon" aria-hidden="true"><svg class="sweep-ring" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" class="sweep-track"/><circle cx="18" cy="18" r="16" class="sweep-arc"/></svg>${svg(`<g class="sweep-broom">${BROOM}</g><circle class="sweep-dust" cx="4" cy="21" r="1" fill="currentColor" stroke="none"/><circle class="sweep-dust b" cx="7" cy="22" r=".8" fill="currentColor" stroke="none"/><circle class="sweep-dust c" cx="2.6" cy="18.5" r=".7" fill="currentColor" stroke="none"/>`, 20)}<span class="sweep-badge"></span></span>`);
  if (after?.parentElement === rail) after.after(broom); else rail.append(broom);
  broom.onclick = () => { hideCard(); sidePane()?.show('sweep'); };
  broom.addEventListener('pointerenter', () => { clearTimeout(leaveTimer); clearTimeout(cardTimer); cardTimer = setTimeout(showCard, 350); });
  broom.addEventListener('pointerleave', () => { clearTimeout(cardTimer); leaveTimer = setTimeout(hideCard, 220); });
  broom.addEventListener('focus', () => { cardTimer = setTimeout(showCard, 350); });
  broom.addEventListener('blur', () => { clearTimeout(cardTimer); leaveTimer = setTimeout(hideCard, 220); });

  function drawBroom(): void {
    const state = broomState({ here: toBroomHost(macs.here), other: toBroomHost(macs.other), doneAt });
    broom.dataset.state = state;
    const h = macs.here;
    broom.title = state === 'sweeping' ? 'Sweep: sweeping now' : h?.disk ? `Sweep · ${gb(h.disk.free)} free` : 'Sweep';
    broom.setAttribute('aria-label', broom.title);
  }

  /* ── reading ───────────────────────────────────────────────────────── */
  async function load({ fresh = false }: { fresh?: boolean } = {}): Promise<void> {
    loading ??= (async () => {
      try {
        try {
          const nextHere = await api.sweep('state', fresh) as SweepMacState;
          macs.here = nextHere;
          macs.here.error = null;
        }
        catch (error: unknown) { macs.here = { error: errMessage(error) }; }
        if (remote() && api.sweepMini) {
          try { macs.other = await api.sweepMini('state', fresh) as SweepMacState; } catch { macs.other = null; }
        } else macs.other = macs.here?.peer ? { ...macs.here.peer, told: true } : null;
      } finally { loading = null; }
      drawAll();
    })();
    return loading;
  }
  const drawAll = (): void => { drawBroom(); if (card) fillCard(); if (paneBody?.isConnected) drawPane(); };

  // What a sweep says as it goes: which Mac, which target, how much so far; and when it ends.
  api.onSweep?.(event => {
    if (!event || typeof event !== 'object') return;
    const key: MacKey = macs.here?.host && event.host === macs.here.host ? 'here' : macs.other && event.host === macs.other.host ? 'other' : macs.here?.host ? 'other' : 'here';
    const mac = macs[key] ?? (macs[key] = { host: event.host, name: event.name });
    if (event.type === 'start' || event.type === 'progress') mac.running = event.running;
    if (event.type === 'done') { mac.running = null; doneAt = Date.now(); void load({ fresh: true }); }
    showToast(event, mac);
    drawAll();
  });

  /* ── the hover card ────────────────────────────────────────────────── */
  function showCard(): void {
    if (!card) {
      card = el('div', 'sweep-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Sweep');
      card.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
      card.addEventListener('pointerleave', () => { leaveTimer = setTimeout(hideCard, 220); });
      document.body.append(card);
    }
    fillCard(); place(card, 26);
    void load();
  }
  function hideCard(): void { if (card?.contains(document.activeElement) && confirming) return; card?.remove(); card = null; confirming = null; }
  function place(node: HTMLElement, tip: number): void {
    const box = broom.getBoundingClientRect();
    node.style.left = `${Math.round(box.right + 12)}px`;
    const top = Math.max(10, Math.min(window.innerHeight - node.offsetHeight - 10, box.top + box.height / 2 - tip));
    node.style.top = `${Math.round(top)}px`;
    node.style.setProperty('--tip', `${Math.round(box.top + box.height / 2 - top)}px`);
  }
  function diskRow(mac: SweepMacState, label: string): HTMLDivElement {
    const row = el('div', 'sweep-mac');
    const head = el('div', 'sweep-mac-head');
    head.append(el('span', 'sweep-mac-name', label), el('span', 'sweep-faint', mac.told ? `${mac.host} · ${ago(mac.at)}` : mac.host || ''), el('span', 'sweep-fill'));
    if (mac.disk) head.append(el('span', 'sweep-mono', gb(mac.disk.free)), el('span', 'sweep-faint', `free of ${gb(mac.disk.total)}`));
    row.append(head, gauge(mac, 6));
    if (mac.running) row.append(el('span', 'sweep-mint sweep-small', `Sweeping · ${progressWords(mac.running, mac)}`));
    return row;
  }
  function gauge(mac: SweepMacState, height: number): HTMLDivElement {
    const bar = el('div', 'sweep-gauge'); bar.style.height = `${height}px`;
    if (!mac?.disk?.total) return bar;
    const threshold = mac.threshold ?? 0;
    const used = el('div', 'sweep-gauge-used'); used.style.width = `${(100 * (mac.disk.total - mac.disk.free) / mac.disk.total).toFixed(1)}%`;
    const line = el('span', 'sweep-gauge-line'); line.style.left = `${(100 * (1 - (threshold * GB) / mac.disk.total)).toFixed(1)}%`;
    line.title = `Auto-clean below ${threshold} GB`;
    bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(mac.disk.total)); bar.setAttribute('aria-valuenow', String(mac.disk.total - mac.disk.free));
    bar.setAttribute('aria-label', `${gb(mac.disk.free)} free of ${gb(mac.disk.total)}; auto-clean below ${threshold} GB`);
    bar.append(used, line);
    return bar;
  }
  // A target by its name from the last dry run, else its id in words.
  const targetName = (mac: SweepMacState, id: string): string => (mac?.scan?.targets?.find(t => t.id === id)?.name || String(id).replace(/_/g, ' ')).replace(/ \(.*\)$/, '');
  const progressWords = (r: SweepRunningInfo, mac: SweepMacState): string => [r.current ? `${targetName(mac, r.current)}${r.total ? ` · ${r.index} of ${r.total}` : ''}` : 'starting', r.freed ? `${gb(r.freed)} freed` : ''].filter(Boolean).join(' · ');
  function fillCard(): void {
    if (!card) return;
    const h = macs.here, o = macs.other;
    const parts: HTMLElement[] = [];
    const head = el('div', 'sweep-card-head');
    const chip = h?.error ? ['Not set up', 'warn'] : h?.running || o?.running ? ['Sweeping', 'mint'] : h?.below ? ['Low on space', 'warn'] : ['Healthy', 'blue'];
    head.append(el('b', '', 'Sweep'), el('span', `sweep-chip ${chip[1]}`, chip[0]), el('span', 'sweep-fill'), el('span', 'sweep-faint', h?.service ? (h.service.loaded ? 'Auto-clean on' : 'Auto-clean off') : ''));
    parts.push(head);
    if (h?.error) { parts.push(el('p', 'sweep-note', h.error)); card.replaceChildren(...parts); return; }
    if (!h) { parts.push(el('p', 'sweep-note', 'Reading sweep…')); card.replaceChildren(...parts); return; }
    parts.push(diskRow(h, `${h.name} · this Mac`));
    if (o) parts.push(diskRow(o, o.name || 'Other Mac'));
    const facts = el('dl', 'sweep-facts');
    const fact = (term: string, ...value: Array<Node | string>): void => { const dd = el('dd'); dd.append(...value); facts.append(el('dt', '', term), dd); };
    const ready = h.scan ? sweepCount(h.scan.targets, false) : null;
    fact('Ready to clear', ready ? el('span', 'sweep-mint sweep-mono', `≈ ${gb(ready.bytes)}`) : el('span', 'sweep-faint', 'Dry run to see'), ready ? ` · ${ready.count} targets` : '');
    fact('Cleans when', 'free space falls under ', el('span', 'sweep-amber', `${h.threshold} GB`));
    fact('Checked', `${clock(h.lastCheckAt)} · every ${Math.round((h.config?.interval ?? 0) / 60)} min`);
    fact('Last sweep', h.lastSweepAt ? `${ago(h.lastSweepAt)} · freed ${gb(h.lastFreed)}` : 'None yet');
    parts.push(facts);
    parts.push(confirming === 'here' ? confirmBox('here', () => { confirming = null; fillCard(); }) : (() => {
      const acts = el('div', 'sweep-acts');
      const now = button('sweep-primary', h.running ? 'Sweeping…' : 'Sweep now', () => { confirming = 'here'; fillCard(); });
      now.disabled = Boolean(h.running);
      const openBtn = button('sweep-soft sweep-square', '', () => { hideCard(); sidePane()?.show('sweep'); }, 'Open the Sweep panel');
      openBtn.innerHTML = svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/>', 15);
      acts.append(now, button('sweep-soft', 'Dry run', () => void dryRun('here')), openBtn);
      return acts;
    })());
    card.replaceChildren(...parts);
  }

  // Sweeping asks first, with what it will do; Aggressive targets only when ticked.
  function confirmBox(key: MacKey, cancel: () => void): HTMLDivElement {
    const mac = macs[key], box = el('div', 'sweep-confirm');
    const count = mac?.scan ? sweepCount(mac.scan.targets, aggressive) : null;
    box.append(el('b', '', `Sweep the ${mac?.name || 'Mac'} now?`),
      el('p', 'sweep-small sweep-dim', `${count ? `${count.count} targets, about ${gb(count.bytes)}. ` : ''}Caches rebuild themselves; Documents, Desktop and your projects are never touched.`));
    const label = el('label', 'sweep-check'), box2 = el('input'); box2.type = 'checkbox'; box2.checked = aggressive;
    box2.onchange = () => { aggressive = box2.checked; const fresh = confirmBox(key, cancel); box.replaceWith(fresh); };
    label.append(box2, document.createTextNode('Include Aggressive: Trash, old installers, stale Rust target/'));
    const acts = el('div', 'sweep-acts end');
    acts.append(button('sweep-soft', 'Cancel', cancel), button('sweep-primary', 'Sweep', () => { confirming = null; void sweepNow(key); }));
    box.append(label, acts);
    return box;
  }
  async function sweepNow(key: MacKey): Promise<void> {
    const call = callFor(key);
    if (!call) return;
    const mac = macs[key];
    if (mac) mac.running = { trigger: 'manual', index: 0, total: 0, current: null, freed: 0 };
    drawAll();
    try { const next = await call('clean', { tier: sweepTier(aggressive) }) as SweepMacState | null; if (next && typeof next === 'object' && next.host) macs[key] = next; }
    catch (error: unknown) { if (mac) mac.running = null; onError(`Sweep: ${errMessage(error)}`); }
    drawAll();
  }
  async function dryRun(key: MacKey): Promise<void> {
    const call = callFor(key);
    if (!call) return;
    selected = key; tab = 'targets';
    hideCard(); sidePane()?.show('sweep');
    if (macs[key]) macs[key]!.scanning = true;
    drawAll();
    try { macs[key] = await call('scan', true) as SweepMacState; } catch (error: unknown) { onError(`Sweep: ${errMessage(error)}`); if (macs[key]) macs[key]!.scanning = false; }
    drawAll();
  }

  /* ── the notification ──────────────────────────────────────────────── */
  function showToast(event: SweepEvent, mac: SweepMacState): void {
    if (event.type === 'start' && event.running?.trigger !== 'auto' && !toast) return; // a sweep you started shows on the broom and the panel
    clearTimeout(toastTimer);
    if (!toast) {
      toast = el('div', 'sweep-card sweep-toast'); toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    const head = el('div', 'sweep-card-head'), close = button('sweep-x', '', () => { toast?.remove(); toast = null; }, 'Dismiss');
    close.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 12);
    const parts: HTMLElement[] = [head];
    if (event.type === 'done') {
      const r = event.record;
      const tick = el('span', 'sweep-tick'); tick.innerHTML = svg('<path d="M5 12l5 5 9-10"/>', 10, 3.4);
      head.append(tick, el('b', '', event.problem ? `Sweep stopped on the ${mac.name || 'Mac'}` : `Swept ${gb(r?.freed || 0)} on the ${mac.name || 'Mac'}`), el('span', 'sweep-fill'), close);
      parts.push(el('p', 'sweep-small sweep-dim', event.problem || (r ? `Now ${gb(r.freeAfter)} free · ${r.targets} targets in ${Math.max(1, Math.round(r.ms / 1000))} s.${r.warnings.length ? ' Some targets need Full Disk Access.' : ''}` : 'Done.')));
      const acts = el('div', 'sweep-acts');
      acts.append(button('sweep-soft', 'See what went', () => { selected = mac === macs.here ? 'here' : 'other'; tab = 'history'; sidePane()?.show('sweep'); toast?.remove(); toast = null; }));
      parts.push(acts);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; }, 15_000);
    } else {
      const r: Partial<SweepRunningInfo> = event.running || {};
      head.append(el('span', 'sweep-dot'), el('b', '', `Sweeping the ${mac.name || 'Mac'}`), el('span', 'sweep-fill'), close);
      if (r.reason) parts.push(el('p', 'sweep-small sweep-dim', r.reason));
      const bar = el('div', 'sweep-progress'), fill = el('div', 'sweep-progress-fill');
      fill.style.width = r.total ? `${Math.max(4, (100 * Math.max(0, (r.index ?? 0) - 1)) / r.total)}%` : '12%';
      bar.append(fill);
      const line = el('div', 'sweep-row sweep-small');
      line.append(el('span', 'sweep-dim', r.current ? `${targetName(mac, r.current)} · ${r.index} of ${r.total}` : 'Starting'), el('span', 'sweep-mint sweep-mono', `${gb(r.freed || 0)} freed`));
      parts.push(bar, line);
    }
    toast.replaceChildren(...parts);
    place(toast, 22);
  }

  /* ── the panel ─────────────────────────────────────────────────────── */
  function drawPane(): void {
    const body = paneBody;
    if (!body) return;
    const key: MacKey = macs[selected] ? selected : 'here', mac = macs[key];
    const root = el('div', 'sweep-pane');
    const head = el('header', 'sweep-pane-head');
    const icon = el('span', 'sweep-pane-icon'); icon.innerHTML = svg(BROOM, 17);
    head.append(icon, el('b', '', 'Sweep'), el('span', 'sweep-fill'));
    if (macs.other) {
      const pick = el('div', 'sweep-seg'); pick.setAttribute('role', 'group'); pick.setAttribute('aria-label', 'Which Mac');
      for (const k of ['here', 'other'] as const) {
        const b = button('', macs[k]?.name || (k === 'here' ? 'This Mac' : 'Other Mac'), () => { selected = k; tab = 'targets'; logLines = null; drawPane(); });
        b.setAttribute('aria-pressed', String(key === k)); pick.append(b);
      }
      head.append(pick);
    }
    root.append(head);
    if (!mac) { root.append(el('p', 'sweep-note', 'Reading sweep…')); body.replaceChildren(root); return; }
    if (mac.error) { root.append(el('p', 'sweep-note', mac.error)); body.replaceChildren(root); return; }

    const disk = mac.disk!;
    const threshold = mac.threshold ?? 0;
    const space = el('section', 'sweep-space');
    const big = el('div', 'sweep-row baseline');
    const chip = mac.running ? ['Sweeping', 'mint'] : mac.below ? ['Low on space', 'warn'] : ['Healthy', 'blue'];
    big.append(el('span', 'sweep-big', gb(disk.free)), el('span', 'sweep-dim', `free of ${gb(disk.total)}`), el('span', 'sweep-fill'), el('span', `sweep-chip ${chip[1]}`, chip[0]));
    space.append(big, gauge(mac, 10));
    const under = el('div', 'sweep-row sweep-small');
    under.append(el('span', 'sweep-dim', `${gb(disk.total - disk.free)} used · ${mac.host}`), el('span', 'sweep-fill'), el('span', 'sweep-amber', 'Auto-clean below'));
    const call = callFor(key);
    if (call && full(key)) {
      const step = el('div', 'sweep-stepper'); step.setAttribute('role', 'group'); step.setAttribute('aria-label', 'Auto-clean line');
      const set = (gbValue: number) => () => void call('threshold', gbValue).then(next => { macs[key] = next as SweepMacState; drawAll(); }).catch((error: unknown) => onError(`Sweep: ${errMessage(error)}`));
      step.append(button('', '−', set(Math.max(5, threshold - 5)), '5 GB lower'), el('span', 'sweep-mono', `${threshold} GB`), button('', '+', set(threshold + 5), '5 GB higher'));
      under.append(step);
    } else under.append(el('span', 'sweep-mono', `${threshold} GB`));
    space.append(under);
    if (mac.running) space.append(el('p', 'sweep-mint sweep-small', `Sweeping · ${progressWords(mac.running, mac)}`));
    root.append(space);

    if (!full(key) || !call) {
      root.append(el('p', 'sweep-note', mac.told ? `As the ${mac.name} told this Mac ${ago(mac.at)}. Open Fairy’s window there to sweep it or see its targets.` : 'Only this Mac’s summary is here.'));
      body.replaceChildren(root); return;
    }

    const tabs = el('nav', 'sweep-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sweep');
    for (const [id, label] of [['targets', 'Targets'], ['history', 'History'], ['service', 'Service']] as const) {
      const b = button('', label, () => { tab = id; drawPane(); if (id === 'service') void readLog(key); });
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id)); tabs.append(b);
    }
    root.append(tabs);
    const content = el('div', 'sweep-content');
    if (tab === 'targets') content.append(...targetsTab(key, mac, call));
    else if (tab === 'history') content.append(...historyTab(mac));
    else content.append(...serviceTab(key, mac, call));
    root.append(content);

    const foot = el('footer', 'sweep-foot');
    if (confirming === key) foot.append(confirmBox(key, () => { confirming = null; drawPane(); }));
    else if (mac.running) foot.append(button('sweep-stop', 'Stop sweeping', () => void call('stop').catch((error: unknown) => onError(`Sweep: ${errMessage(error)}`))));
    else {
      const dry = button('sweep-soft', mac.scanning ? 'Scanning…' : 'Dry run', () => void dryRun(key)); dry.disabled = Boolean(mac.scanning);
      const n = mac.scan ? sweepCount(mac.scan.targets, false).count : null;
      foot.append(dry, button('sweep-primary grow', n == null ? 'Sweep now' : `Sweep ${n} targets`, () => { confirming = key; drawPane(); }));
    }
    // sweep's own TUI, in the chat's terminal, which runs on the Mac Fairy lives on.
    if (terminal && ((key === 'here' && !remote()) || (key === 'other' && remote()))) {
      const tui = button('sweep-soft sweep-square', '', () => { sidePane()?.show('terminal'); void terminal.type('sweep\r'); }, 'Open sweep’s own dashboard in the terminal');
      tui.innerHTML = svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M12.5 15H17"/>', 16);
      foot.append(tui);
    }
    root.append(foot);
    const scroll = body.querySelector('.sweep-content')?.scrollTop ?? 0;
    body.replaceChildren(root);
    const nextContent = root.querySelector<HTMLElement>('.sweep-content');
    if (nextContent) nextContent.scrollTop = scroll;
  }

  function targetsTab(key: MacKey, mac: SweepMacState, call: SweepCallFn): HTMLElement[] {
    if (!mac.scan) {
      const empty = el('div', 'sweep-empty');
      empty.append(el('b', '', mac.scanning ? 'Scanning the targets…' : 'No dry run yet'), el('span', 'sweep-small', mac.scanning ? 'A read-only pass over every target; nothing is touched. This can take a minute.' : 'A dry run measures every target without touching anything.'));
      if (!mac.scanning) empty.append(button('sweep-soft', 'Dry run', () => void dryRun(key)));
      return [empty];
    }
    const ready = sweepCount(mac.scan.targets, false), on = mac.scan.targets.filter(t => t.enabled).length;
    const top = el('div', 'sweep-row sweep-small sweep-pad');
    top.append(el('span', 'sweep-dim', `${on} of ${mac.scan.targets.length} on · dry run ${ago(mac.scan.at)}`), el('span', 'sweep-fill'), el('span', 'sweep-mint sweep-mono', `≈ ${gb(ready.bytes)}`), el('span', 'sweep-dim', ' to clear'));
    const max = Math.max(1, ...mac.scan.targets.map(t => t.bytes));
    const list = el('ul', 'sweep-targets');
    for (const t of mac.scan.targets) {
      const li = el('li'), label = el('label', `sweep-target${t.enabled ? '' : ' off'}`);
      label.title = [t.description, t.note, t.denied ? 'Some of it needs Full Disk Access for ~/.local/bin/sweep.' : ''].filter(Boolean).join('\n');
      const box = el('input'); box.type = 'checkbox'; box.checked = t.enabled;
      box.onchange = () => void call('target', t.id, box.checked).then(next => { macs[key] = next as SweepMacState; drawAll(); }).catch((error: unknown) => { box.checked = !box.checked; onError(`Sweep: ${errMessage(error)}`); });
      const words = el('span', 'sweep-target-words');
      const bar = el('span', 'sweep-target-bar'), fill = el('span'); fill.style.width = `${Math.max(2, (100 * t.bytes) / max).toFixed(0)}%`; bar.append(fill);
      words.append(el('span', 'sweep-target-name', t.name), bar);
      const tier = tierOf(t.tier);
      label.append(box, words, el('span', `sweep-tier ${tier.toLowerCase()}`, tier), el('span', 'sweep-mono sweep-size', gbFine(t.bytes)));
      li.append(label); list.append(li);
    }
    const notes: HTMLElement[] = [];
    if (mac.scan.targets.some(t => t.denied)) notes.push(el('p', 'sweep-warn sweep-small sweep-pad', 'Some targets need Full Disk Access for ~/.local/bin/sweep; Trash empties through Finder meanwhile.'));
    return [top, list, ...notes];
  }
  function historyTab(mac: SweepMacState): HTMLElement[] {
    const history = mac.history || [];
    if (!history.length) {
      const empty = el('div', 'sweep-empty');
      empty.append(el('b', '', 'No sweeps yet'), el('span', 'sweep-small', `The first runs when free space falls under ${mac.threshold} GB, or when you sweep by hand. Each one is kept here with what it freed.`));
      return [empty];
    }
    const stats = el('div', 'sweep-stats');
    const stat = (label: string, value: string, mint = false): void => { const s = el('div'); s.append(el('span', 'sweep-faint sweep-small', label), el('span', `sweep-mono${mint ? ' sweep-mint' : ''}`, value)); stats.append(s); };
    stat('Freed in all', gb(mac.totalFreed), true);
    stat('On its own', String(history.filter(r => r.trigger.startsWith('auto')).length));
    stat('By hand', String(history.filter(r => !r.trigger.startsWith('auto')).length));
    const list = el('ol', 'sweep-history');
    for (const r of history) {
      const li = el('li');
      li.append(el('span', '', `${new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${r.trigger.startsWith('auto') ? 'on its own' : 'by hand'}`), el('span', 'sweep-mint sweep-mono', `−${gb(r.freed)}`),
        el('span', 'sweep-dim sweep-small', `${gb(r.freeBefore)} → ${gb(r.freeAfter)} free · ${r.targets} targets · ${Math.max(1, Math.round(r.ms / 1000))} s`), el('span', 'sweep-dim sweep-small right', r.top.slice(0, 2).map(t => t.name.split(' (')[0]).join(', ')));
      list.append(li);
    }
    return [stats, list];
  }
  function serviceTab(key: MacKey, mac: SweepMacState, call: SweepCallFn): HTMLElement[] {
    const serviceInfo = mac.service!;
    const config = mac.config!;
    const facts = el('dl', 'sweep-facts wide');
    const fact = (term: string, value: string, cls = ''): void => { facts.append(el('dt', '', term), el('dd', cls, value)); };
    fact('Background watcher', serviceInfo.loaded ? 'Loaded' : serviceInfo.installed ? 'Installed, not loaded' : 'Off', serviceInfo.loaded ? 'sweep-mint' : 'sweep-amber');
    fact('Last exit', serviceInfo.lastExit == null ? '—' : String(serviceInfo.lastExit));
    fact('Checks', `every ${Math.round(config.interval / 60)} min · last ${clock(mac.lastCheckAt)}`);
    fact('Cooldown', `${config.cooldown} min, skipped on a ${config.emergency} GB drop`);
    fact('macOS notifications', config.notify ? 'On (sweep’s own)' : 'Off');
    fact('Agent', 'com.razeenwasif.sweep', 'sweep-mono');
    const acts = el('div', 'sweep-acts sweep-pad');
    const service = (action: string) => () => void call('service', action).then(next => { macs[key] = next as SweepMacState; drawAll(); }).catch((error: unknown) => onError(`Sweep: ${errMessage(error)}`));
    acts.append(button('sweep-soft', 'Check now', service('trigger')), button('sweep-soft', serviceInfo.loaded ? 'Stop the watcher' : 'Start the watcher', service(serviceInfo.loaded ? 'uninstall' : 'install')));
    const log = el('pre', 'sweep-log sweep-mono', logLines ? logLines.join('\n') : 'Reading the log…');
    return [facts, acts, el('span', 'sweep-label', 'Log · ~/Library/Logs/sweep.log'), log];
  }
  async function readLog(key: MacKey): Promise<void> {
    const call = callFor(key);
    if (!call) return;
    try { logLines = ((await call('logs', 40)) as { lines: string[] }).lines.slice().reverse(); } catch (error: unknown) { logLines = [errMessage(error)]; }
    if (paneBody?.isConnected && tab === 'service') drawPane();
  }

  // Every minute while it's on screen; the broom itself on load and after each sweep.
  void load();
  setInterval(() => { if (card || paneBody?.isConnected) void load(); else drawBroom(); }, 60_000);

  return {
    button: broom,
    refresh: () => load({ fresh: true }),
    pane: {
      id: 'sweep', title: 'Sweep',
      render(body) { paneBody = body; drawPane(); void load(); },
      leave() { paneBody = null; },
    },
  };
}
