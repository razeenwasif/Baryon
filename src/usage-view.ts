import './usage-view.css';
import { providerLogo } from './provider-logos.js';
import {
  PROVIDER_META,
  RANGES,
  breakdownByType,
  buildDailySeries,
  filterUsageEvents,
  formatPct,
  formatTokens,
  groupByModel,
  groupByProvider,
  groupBySession,
  summarizeUsage,
  type UsageEvent,
} from './usage-logic.js';
import type { Unsubscribe } from '../desktop/ipc-contract';

export type UsageMode = 'cost' | 'tokens' | 'limits';
export type UsageMetric = 'cost' | 'tokens';
export type UsageRange = '24h' | '7d' | '30d' | 'all';

export interface PlanMeter {
  label?: string;
  short?: string;
  text?: string;
  used?: number | string;
  level?: string;
  resets?: string;
}

export interface PlanStatus {
  at?: string | number;
  failed?: boolean;
  meters?: PlanMeter[];
}

export interface UsagePayload {
  generatedAt?: string;
  events?: UsageEvent[];
  plans?: Record<string, PlanStatus | undefined>;
}

export interface UsageState {
  generatedAt: string;
  events: UsageEvent[];
  plans: Record<string, PlanStatus | undefined>;
}

export interface UsageViewApi {
  tokenUsage?: (options?: { force?: boolean }) => Promise<UsagePayload | null | undefined>;
  onPlanUsage?: (callback: (plans: Record<string, PlanStatus | undefined> | null | undefined) => void) => Unsubscribe;
}

export interface UsageViewOptions {
  api?: UsageViewApi | null;
  root: HTMLElement;
  sidebarButton?: HTMLElement | null;
  onOpenChat?: (sessionId: string) => void;
  onError?: (message: string) => void;
  onShow?: () => void;
  onHide?: () => void;
}

export interface UsageViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  refresh: () => Promise<void>;
}

interface BreakdownItem {
  label: string;
  value: number;
  share: number;
  color: string;
  selected?: boolean;
  onclick?: () => void;
}

interface SplinePoint {
  x: number;
  y: number;
  val: number;
}

type DailySeries = ReturnType<typeof buildDailySeries>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANGE_ITEMS: ReadonlyArray<readonly [UsageRange, string]> = [
  ['24h', 'Past 24h'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All'],
];
const LOGO_KEY: Readonly<Record<string, string>> = {
  claude: 'anthropic',
  gemini: 'google',
  codex: 'openai',
  deepseek: 'deepseek',
};
const PLAN_DISPLAY: Readonly<Record<string, { name: string; tint: string; fill: string }>> = {
  codex: { name: 'Codex', tint: '#8b93a7', fill: 'rgba(148,163,184,.36)' },
  gemini: { name: 'Antigravity', tint: '#818cf8', fill: 'rgba(99,102,241,.42)' },
  claude: { name: 'Claude', tint: '#e58b5b', fill: 'rgba(229,139,91,.36)' },
  deepseek: { name: 'DeepSeek', tint: '#38bdf8', fill: 'rgba(56,189,248,.34)' },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const cleanErr = (error: unknown): string => {
  const msg = error && typeof error === 'object' && 'message' in error
    ? (error as { message: unknown }).message
    : error;
  return String(msg || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
};

const formatMoneyExact = (value: number | string | null | undefined): string => {
  const n = Math.max(0, Number(value) || 0);
  if (n > 0 && n < 0.01) return `$${n.toFixed(3)}`;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function resetLabel(resets: string | undefined): string {
  if (!resets) return '';
  const d = new Date(resets);
  if (/^\d{4}-/.test(resets) && !Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  return resets;
}

function providerMarkNode(provider: string, { dotColor = '', size = 16 }: { dotColor?: string; size?: number } = {}): HTMLSpanElement {
  const wrap = el('span', 'uv-prov-mark');
  if (dotColor) {
    const d = el('i', 'uv-dot');
    d.style.background = dotColor;
    wrap.append(d);
  }
  const logoKey = LOGO_KEY[provider] || '';
  const logo = logoKey ? providerLogo(logoKey) : null;
  if (logo) {
    logo.style.width = `${size}px`;
    logo.style.height = `${size}px`;
    logo.classList.add('uv-prov-svg');
    wrap.append(logo);
  } else {
    const letter = el('span', 'uv-prov-fallback', (PROVIDER_META[provider]?.label || '?')[0]);
    wrap.append(letter);
  }
  return wrap;
}

// Monotone Fritsch-Carlson cubic spline path so smooth curves never undershoot below zero.
function monotoneSplinePath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  const tangent: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const xStep = Math.max(1e-4, pts[i + 1].x - pts[i].x);
    const yStep = pts[i + 1].y - pts[i].y;
    dx.push(xStep);
    dy.push(yStep);
    slope.push(yStep / xStep);
  }
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tangent[i] = 0;
    else {
      const common = dx[i - 1] + dx[i];
      tangent[i] = (3 * common) / ((common + dx[i]) / slope[i - 1] + (common + dx[i - 1]) / slope[i]);
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const step = dx[i] / 3;
    const c1x = pts[i].x + step;
    const c1y = pts[i].y + tangent[i] * step;
    const c2x = pts[i + 1].x - step;
    const c2y = pts[i + 1].y - tangent[i + 1] * step;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

function gaugeIconSvg(): SVGSVGElement {
  const pic = svgEl('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'uv-limit-ico' });
  pic.append(
    svgEl('path', { d: 'M12 14l4-4' }),
    svgEl('path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }),
  );
  return pic;
}

/** Render T3 Code–style Usage dashboard (Cost / Tokens / Limits) in Fairy's main view. */
export function usageView({
  api,
  root,
  sidebarButton,
  onOpenChat = () => {},
  onError = () => {},
  onShow = () => {},
  onHide = () => {},
}: UsageViewOptions): UsageViewController {
  void RANGES;
  let data: UsageState = { generatedAt: '', events: [], plans: {} };
  let mode: UsageMode = 'cost'; // 'cost' | 'tokens' | 'limits'
  let range: UsageRange = '30d';
  let providerFilter = 'all';
  let modelFilter = 'all';
  let loading = false;
  let unsubPlans: Unsubscribe | null = null;
  let gradSeed = 0;

  const isOpen = (): boolean => !root.hidden;

  async function load({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!api?.tokenUsage || loading) return;
    loading = true;
    render();
    try {
      const next = await api.tokenUsage(force ? { force: true } : undefined);
      if (next && typeof next === 'object') {
        data = {
          generatedAt: next.generatedAt || new Date().toISOString(),
          events: Array.isArray(next.events) ? next.events : [],
          plans: next.plans || {},
        };
      }
    } catch (err) {
      onError(`Couldn’t load usage: ${cleanErr(err)}`);
    } finally {
      loading = false;
      render();
    }
  }

  function renderSplineChart(series: DailySeries, metric: UsageMetric): HTMLElement {
    const col = el('section', 'uv-chart-col');
    const head = el('div', 'uv-chart-head');
    head.append(el('h2', 'uv-chart-title', metric === 'cost' ? 'Daily cost' : 'Daily tokens'));
    if (series.legend?.length) {
      const leg = el('div', 'uv-legend');
      for (const item of series.legend) {
        const pill = el('span', 'uv-legend-item');
        const dot = el('i', 'uv-dot');
        dot.style.background = item.color;
        pill.append(dot, el('span', '', item.label));
        leg.append(pill);
      }
      head.append(leg);
    }
    col.append(head);

    if (series.totalValue <= 0) {
      const empty = el('div', 'uv-empty uv-chart-empty');
      empty.append(
        el('p', 'uv-empty-title', 'No measured turns in this window'),
        el('p', 'uv-empty-sub', 'Switch to a wider range (e.g. All) or clear active filters to inspect older sessions.'),
      );
      col.append(empty);
      return col;
    }

    const wrap = el('div', 'uv-chart-wrap');
    const tooltip = el('div', 'uv-tooltip');
    tooltip.hidden = true;

    const W = 680, H = 276, padL = 58, padR = 16, padT = 14, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const baseY = padT + plotH;
    const niceMax = Math.max(series.maxValue * 1.15, metric === 'cost' ? 0.05 : 1000);
    const svg = svgEl('svg', { class: 'uv-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': metric === 'cost' ? 'Daily cost spline chart' : 'Daily tokens spline chart' });

    const fmtY = (v: number): string => (metric === 'cost' ? formatMoneyExact(v).replace(/\.00$/, '') : formatTokens(v));
    for (let g = 0; g <= 4; g++) {
      const ratio = g / 4;
      const y = padT + plotH * (1 - ratio);
      svg.append(svgEl('line', {
        x1: padL, x2: W - padR, y1: y.toFixed(1), y2: y.toFixed(1),
        class: g === 0 ? 'uv-axis-line' : 'uv-grid-line',
      }));
      const lbl = svgEl('text', { x: padL - 10, y: (y + 3.5).toFixed(1), class: 'uv-y-label' });
      lbl.textContent = g === 0 ? (metric === 'cost' ? '$0' : '0') : fmtY(niceMax * ratio);
      svg.append(lbl);
    }

    const defs = svgEl('defs');
    svg.append(defs);

    const days = series.days;
    const n = days.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xOf = (idx: number): number => (n > 1 ? padL + idx * stepX : padL + plotW / 2);
    const yOf = (val: number): number => padT + plotH * (1 - Math.max(0, Math.min(1, val / niceMax)));

    // Draw one smooth area spline per series key in series.legend.
    const splinePtsByKey = new Map<string, { meta: { key: string; label: string; color: string }; pts: SplinePoint[] }>();
    const seriesKeys = series.legend.length ? series.legend : [{ key: 'all', label: 'Total', color: '#e58b5b' }];
    for (const sMeta of seriesKeys) {
      const pts: SplinePoint[] = days.map((day, idx) => {
        const seg = day.segments.find(s => s.key === sMeta.key);
        const val = seg ? seg.value : 0;
        return { x: xOf(idx), y: yOf(val), val };
      });
      if (!pts.some(p => p.val > 0)) continue;
      splinePtsByKey.set(sMeta.key, { meta: sMeta, pts });

      const gid = `uv-grad-${++gradSeed}`;
      const grad = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
      grad.append(
        svgEl('stop', { offset: '0%', 'stop-color': sMeta.color, 'stop-opacity': '0.26' }),
        svgEl('stop', { offset: '100%', 'stop-color': sMeta.color, 'stop-opacity': '0.01' }),
      );
      defs.append(grad);

      const strokeD = monotoneSplinePath(pts);
      const lastPt = pts[pts.length - 1];
      const areaD = `${strokeD} L${lastPt.x.toFixed(2)},${baseY.toFixed(2)} L${pts[0].x.toFixed(2)},${baseY.toFixed(2)} Z`;
      svg.append(
        svgEl('path', { d: areaD, fill: `url(#${gid})`, class: 'uv-area-path' }),
        svgEl('path', { d: strokeD, fill: 'none', stroke: sMeta.color, 'stroke-width': '1.85', 'stroke-linecap': 'round', class: 'uv-line-path' }),
      );
    }

    // X-axis uppercase ticks (e.g. NOV 1, NOV 15, NOV 24).
    const tickCount = Math.min(n, 4);
    const tickIndices = new Set<number>();
    if (n <= 4) { for (let i = 0; i < n; i++) tickIndices.add(i); }
    else { for (let t = 0; t < tickCount; t++) tickIndices.add(Math.round((t * (n - 1)) / (tickCount - 1))); }
    for (const idx of tickIndices) {
      const tx = svgEl('text', { x: xOf(idx).toFixed(1), y: H - 6, class: 'uv-x-label' });
      tx.textContent = String(days[idx].label || '').toUpperCase();
      svg.append(tx);
    }

    // Interactive crosshair + dots + tooltip.
    const guide = svgEl('line', { x1: padL, x2: padL, y1: padT, y2: baseY, class: 'uv-guide', visibility: 'hidden' });
    svg.append(guide);
    const hoverDots = new Map<string, SVGCircleElement>();
    for (const [k, { meta }] of splinePtsByKey) {
      const c = svgEl('circle', { r: 3.8, fill: meta.color, stroke: '#08080a', 'stroke-width': 1.6, visibility: 'hidden' });
      hoverDots.set(k, c);
      svg.append(c);
    }

    const colW = n > 1 ? plotW / (n - 1) : plotW;
    days.forEach((day, idx) => {
      const cx = xOf(idx);
      const rx = n > 1 ? Math.max(padL, cx - colW / 2) : padL;
      const rw = n > 1 ? Math.min(W - padR - rx, cx + colW / 2 - rx) : plotW;
      const band = svgEl('rect', { x: rx.toFixed(2), y: padT, width: Math.max(2, rw).toFixed(2), height: plotH, class: 'uv-hover-band' });

      const fmtVal = (v: number): string => (metric === 'cost' ? formatMoneyExact(v) : formatTokens(v));
      band.addEventListener('mouseenter', () => {
        guide.setAttribute('x1', cx.toFixed(2));
        guide.setAttribute('x2', cx.toFixed(2));
        guide.setAttribute('visibility', 'visible');
        for (const [k, dotNode] of hoverDots) {
          const pt = splinePtsByKey.get(k)?.pts[idx];
          if (pt && pt.val > 0) {
            dotNode.setAttribute('cx', pt.x.toFixed(2));
            dotNode.setAttribute('cy', pt.y.toFixed(2));
            dotNode.setAttribute('visibility', 'visible');
          } else {
            dotNode.setAttribute('visibility', 'hidden');
          }
        }
        tooltip.replaceChildren();
        const tHead = el('div', 'uv-tip-head');
        tHead.append(el('strong', '', day.label), el('span', '', `${day.turns} ${day.turns === 1 ? 'turn' : 'turns'}`));
        tooltip.append(tHead, el('div', 'uv-tip-total', fmtVal(day.total)));
        for (const seg of [...day.segments].sort((a, b) => b.value - a.value)) {
          if (seg.value <= 0) continue;
          const row = el('div', 'uv-tip-row');
          const d = el('i', 'uv-dot');
          d.style.background = seg.color;
          row.append(d, el('span', 'uv-tip-lbl', seg.label), el('span', 'uv-tip-val', fmtVal(seg.value)));
          tooltip.append(row);
        }
        tooltip.hidden = false;
        const pct = (cx / W) * 100;
        tooltip.style.left = `${Math.max(16, Math.min(82, pct))}%`;
      });
      band.addEventListener('mouseleave', () => {
        guide.setAttribute('visibility', 'hidden');
        for (const dotNode of hoverDots.values()) dotNode.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
      });
      svg.append(band);
    });

    wrap.append(svg, tooltip);
    col.append(wrap);
    return col;
  }

  function renderBreakdownCard(
    title: string,
    items: ReadonlyArray<BreakdownItem>,
    fmtVal: (value: number) => string,
    { clickable = false }: { clickable?: boolean } = {},
  ): HTMLDivElement {
    const card = el('div', 'uv-break-card');
    const head = el('div', 'uv-break-head');
    head.append(el('span', 'uv-break-title', title));
    card.append(head);

    const track = el('div', 'uv-stack-track');
    const positive = items.filter(i => i.value > 0);
    if (!positive.length) {
      track.append(el('div', 'uv-stack-empty'));
    } else {
      for (const seg of positive) {
        const part = el('div', 'uv-stack-seg');
        part.style.width = `${Math.max(1.2, seg.share * 100).toFixed(2)}%`;
        part.style.background = seg.color;
        part.title = `${seg.label}: ${fmtVal(seg.value)} (${formatPct(seg.share)})`;
        track.append(part);
      }
    }
    card.append(track);

    const legend = el('div', 'uv-break-legend');
    for (const seg of items) {
      const btn = clickable
        ? el('button', `uv-break-item${seg.selected ? ' is-selected' : ''}`)
        : el('div', `uv-break-item${seg.selected ? ' is-selected' : ''}`);
      if (clickable && btn instanceof HTMLButtonElement) {
        btn.type = 'button';
        btn.onclick = seg.onclick ?? null;
      }
      const sw = el('i', 'uv-swatch');
      sw.style.background = seg.color;
      btn.append(sw, el('span', 'uv-break-lbl', seg.label), el('span', 'uv-break-val uv-mono', fmtVal(seg.value)));
      legend.append(btn);
    }
    card.append(legend);
    return card;
  }

  function renderLimitsView(): HTMLDivElement {
    const wrap = el('div', 'uv-limits-list');
    const plans = data.plans || {};
    const names = ['codex', 'gemini', 'claude', 'deepseek'].filter(k => plans[k]?.meters?.length);
    if (!names.length) {
      const panel = el('section', 'uv-limit-panel uv-limit-empty');
      panel.append(
        el('h2', 'uv-card-title', 'Subscription & Balance Limits'),
        el('p', 'uv-empty-sub', 'No plan usage meters available yet. Sign in to Claude, Gemini, Codex, or DeepSeek in Settings and click Refresh.'),
      );
      wrap.append(panel);
      return wrap;
    }

    for (const key of names) {
      const plan = plans[key];
      if (!plan) continue;
      const disp = PLAN_DISPLAY[key] || { name: key, tint: '#818cf8', fill: 'rgba(129,140,248,.38)' };
      const group = el('section', 'uv-limit-section');

      const gHead = el('div', 'uv-limit-group-head');
      const gTitle = el('div', 'uv-limit-group-title');
      gTitle.append(providerMarkNode(key, { size: 18 }), el('span', '', disp.name));
      const updated = plan.at ? new Date(plan.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      gHead.append(gTitle, el('span', 'uv-card-sub', updated ? (plan.failed ? `Cached · ${updated}` : `Updated ${updated}`) : ''));
      group.append(gHead);

      const panels = el('div', 'uv-limit-panels');
      const meters = plan.meters || [];
      meters.forEach((m, idx) => {
        const panel = el('div', 'uv-limit-panel');
        const left = el('div', 'uv-limit-left');
        const title = el('div', 'uv-limit-name', key === 'gemini' && !/gemini/i.test(m.label || '') ? `Gemini · ${m.label || m.short || 'Limit'}` : (m.label || m.short || 'Limit'));

        const isBalance = Boolean(m.text);
        const usedPct = Number.isFinite(Number(m.used)) ? Math.max(0, Math.min(100, Math.round(Number(m.used)))) : null;
        const leftPct = usedPct != null ? Math.max(0, Math.min(100, 100 - usedPct)) : null;

        const hero = el('div', 'uv-limit-hero');
        if (isBalance) {
          hero.append(el('span', 'uv-limit-pct', m.text ?? ''));
        } else {
          hero.append(el('span', 'uv-limit-pct', `${leftPct}%`), el('span', 'uv-limit-word', 'left'), gaugeIconSvg());
        }

        const subText = isBalance
          ? (m.level === 'full' ? 'Balance depleted' : m.level === 'high' ? 'Low credit balance' : 'Available credit balance')
          : [resetLabel(m.resets) ? `Resets ${resetLabel(m.resets)}` : '', `${usedPct}% used`].filter(Boolean).join(' · ');
        left.append(title, hero, el('div', 'uv-limit-reset', subText));
        panel.append(left);

        const right = el('div', 'uv-limit-right');
        const track = el('div', 'uv-limit-track');
        if (leftPct != null && leftPct > 0) {
          const fillColor = leftPct <= 5 ? 'rgba(248,113,113,.42)' : leftPct <= 20 ? 'rgba(251,191,36,.36)' : disp.fill;
          const fill = el('div', 'uv-limit-fill');
          fill.style.width = `${leftPct}%`;
          fill.style.background = fillColor;
          fill.style.borderColor = leftPct <= 5 ? 'rgba(248,113,113,.6)' : leftPct <= 20 ? 'rgba(251,191,36,.5)' : disp.tint;
          fill.append(el('span', 'uv-limit-badge', String(idx + 1)));
          track.append(fill);
        }
        right.append(track);

        const row = el('div', 'uv-limit-legend-row');
        row.append(
          el('span', 'uv-limit-num', String(idx + 1)),
          el('span', 'uv-limit-acct', disp.name),
          el('span', 'uv-limit-row-val uv-mono', isBalance ? (m.text ?? '') : `${leftPct}% left`),
        );
        right.append(row);
        panel.append(right);
        panels.append(panel);
      });

      group.append(panels);
      wrap.append(group);
    }
    return wrap;
  }

  function render(): void {
    if (root.hidden) return;
    const body = el('div', 'uv-body');

    // T3 Code–style top header: breadcrumb on left, Cost/Tokens/Limits + range pills on right.
    const topbar = el('header', 'uv-topbar');
    const crumbs = el('nav', 'uv-breadcrumbs');
    crumbs.setAttribute('aria-label', 'Usage breadcrumb');
    const rootCrumb = el('button', 'uv-crumb is-muted', 'Usage');
    rootCrumb.type = 'button';
    rootCrumb.onclick = () => { providerFilter = 'all'; modelFilter = 'all'; mode = 'cost'; render(); };
    const envCrumb = el('span', 'uv-crumb', 'All sessions');
    const provLabel = providerFilter === 'all' ? 'All providers' : (PROVIDER_META[providerFilter]?.label || providerFilter);
    const provCrumb = el('button', `uv-crumb${providerFilter !== 'all' ? ' is-clickable' : ''}`, provLabel);
    provCrumb.type = 'button';
    provCrumb.onclick = () => { if (providerFilter !== 'all' || modelFilter !== 'all') { providerFilter = 'all'; modelFilter = 'all'; render(); } };
    crumbs.append(rootCrumb, el('span', 'uv-crumb-sep', '/'), envCrumb, el('span', 'uv-crumb-sep', '/'), provCrumb);
    if (modelFilter !== 'all') {
      const mCrumb = el('button', 'uv-crumb is-clickable', `${modelFilter} ×`);
      mCrumb.type = 'button';
      mCrumb.onclick = () => { modelFilter = 'all'; render(); };
      crumbs.append(el('span', 'uv-crumb-sep', '/'), mCrumb);
    }

    const actions = el('div', 'uv-actions');
    const modeSeg = el('div', 'uv-seg');
    const modes: ReadonlyArray<readonly [UsageMode, string]> = [['cost', 'Cost'], ['tokens', 'Tokens'], ['limits', 'Limits']];
    for (const [k, lbl] of modes) {
      const btn = el('button', `uv-seg-btn${mode === k ? ' is-active' : ''}`, lbl);
      btn.type = 'button';
      btn.onclick = () => { mode = k; render(); };
      modeSeg.append(btn);
    }
    actions.append(modeSeg);

    if (mode !== 'limits') {
      const rangeSeg = el('div', 'uv-seg');
      for (const [r, lbl] of RANGE_ITEMS) {
        const btn = el('button', `uv-seg-btn${range === r ? ' is-active' : ''}`, lbl);
        btn.type = 'button';
        btn.onclick = () => { range = r; render(); };
        rangeSeg.append(btn);
      }
      actions.append(rangeSeg);
    }

    const refreshBtn = el('button', `uv-refresh${loading ? ' is-loading' : ''}`, loading ? 'Refreshing…' : 'Refresh');
    refreshBtn.type = 'button';
    refreshBtn.disabled = loading;
    refreshBtn.onclick = () => void load({ force: true });
    actions.append(refreshBtn);

    topbar.append(crumbs, actions);
    body.append(topbar);

    if (mode === 'limits') {
      body.append(renderLimitsView());
      root.replaceChildren(body);
      return;
    }

    const metric: UsageMetric = mode === 'tokens' ? 'tokens' : 'cost';
    const rangeEvents = filterUsageEvents(data.events, { range, provider: 'all', model: 'all' });
    const filtered = filterUsageEvents(data.events, { range, provider: providerFilter, model: modelFilter });

    const summary = summarizeUsage(filtered);
    const providers = groupByProvider(rangeEvents, metric);
    const series = buildDailySeries(filtered, { range, metric, groupBy: 'provider' });
    const typeBreak = breakdownByType(filtered, metric);
    const models = groupByModel(filtered, metric);
    const sessions = groupBySession(filtered, metric, 12);

    const fmtPrimary = metric === 'cost' ? formatMoneyExact : formatTokens;
    const totalSessions = new Set(filtered.map(e => (e.sessionId ? `s:${e.sessionId}` : `t:${e.title || 'Session'}`))).size;

    // Hero two-column row: left total + provider list; right smooth Daily spline area chart.
    const heroGrid = el('div', 'uv-hero-grid');
    const provCol = el('div', 'uv-provider-col');

    const heroBlock = el('div', 'uv-hero-stat');
    heroBlock.append(
      el('div', 'uv-hero-value', fmtPrimary(metric === 'cost' ? summary.totalCost : summary.totalTokens)),
      el('div', 'uv-hero-sub', `${totalSessions.toLocaleString()} sessions · ${summary.turns.toLocaleString()} turns · API estimate`),
    );
    provCol.append(heroBlock);

    const provList = el('div', 'uv-prov-list');
    const displayProviders = providers.length
      ? providers
      : ['codex', 'claude', 'gemini', 'deepseek'].map(k => ({
          provider: k,
          label: PROVIDER_META[k].label,
          color: PROVIDER_META[k].color,
          sessions: 0,
          total: 0,
          cost: 0,
          share: 0,
        }));
    for (const row of displayProviders) {
      const selected = providerFilter === row.provider;
      const btn = el('button', `uv-prov-row${selected ? ' is-selected' : ''}`);
      btn.type = 'button';
      btn.onclick = () => {
        providerFilter = selected ? 'all' : row.provider;
        modelFilter = 'all';
        render();
      };
      const line1 = el('div', 'uv-prov-top');
      const left = el('div', 'uv-prov-id');
      left.append(
        providerMarkNode(row.provider, { dotColor: row.color, size: 15 }),
        el('span', 'uv-prov-name', row.label),
        el('span', 'uv-prov-sessions', `${row.sessions.toLocaleString()} ${row.sessions === 1 ? 'session' : 'sessions'}`),
      );
      line1.append(left, el('span', 'uv-prov-total', fmtPrimary(metric === 'cost' ? row.cost : row.total)));

      const pctWord = row.share > 0 && row.share < 0.001 ? '<0.1%' : formatPct(row.share);
      const secondary = metric === 'cost'
        ? `${pctWord} of cost · ${formatTokens(row.total)} tokens`
        : `${pctWord} of tokens · ${formatMoneyExact(row.cost)}`;
      btn.append(line1, el('div', 'uv-prov-sub', secondary));
      provList.append(btn);
    }
    provCol.append(provList);

    heroGrid.append(provCol, renderSplineChart(series, metric));
    body.append(heroGrid);

    // Totals 5-column stat strip.
    const totalsSec = el('section', 'uv-totals-sec');
    totalsSec.append(el('h3', 'uv-sec-title', 'Totals'));
    const totalsGrid = el('div', 'uv-totals-grid');
    const uncachedInput = Math.max(0, summary.inputTokens - summary.cachedTokens);
    for (const [lbl, val] of [
      ['Processed tokens', formatTokens(summary.totalTokens)],
      ['Cached input', formatTokens(summary.cachedTokens)],
      ['Uncached input', formatTokens(uncachedInput)],
      ['Output', formatTokens(summary.outputTokens)],
      ['Cache savings', formatMoneyExact(summary.cacheSaved)],
    ]) {
      const item = el('div', 'uv-total-item');
      item.append(el('span', 'uv-total-lbl', lbl), el('span', 'uv-total-val', val));
      totalsGrid.append(item);
    }
    totalsSec.append(totalsGrid);
    body.append(totalsSec);

    // Bottom 2-column horizontal stacked bars: By type | By model.
    const modelPalette = ['#e4e4e7', '#a1a1aa', '#e58b5b', '#818cf8', '#34d399', '#38bdf8'];
    const topModels: BreakdownItem[] = models.slice(0, 5).map((m, idx) => ({
      label: m.model,
      value: metric === 'cost' ? m.cost : m.total,
      share: m.share,
      color: (PROVIDER_META[m.provider]?.color) || modelPalette[idx % modelPalette.length],
      selected: modelFilter === m.model,
      onclick: () => { modelFilter = modelFilter === m.model ? 'all' : m.model; render(); },
    }));
    const modelGrand = models.reduce((s, m) => s + (metric === 'cost' ? m.cost : m.total), 0);
    const typeItems: BreakdownItem[] = typeBreak.segments.map(s => ({ label: s.label, value: s.value, share: s.share, color: s.color }));
    if (models.length > 5 && modelGrand > 0) {
      const restVal = models.slice(5).reduce((s, m) => s + (metric === 'cost' ? m.cost : m.total), 0);
      topModels.push({ label: 'Other', value: restVal, share: restVal / modelGrand, color: '#52525b', selected: false, onclick: () => { modelFilter = 'all'; render(); } });
    }

    const breakGrid = el('section', 'uv-break-grid');
    breakGrid.append(
      renderBreakdownCard(metric === 'cost' ? 'Cost by type' : 'Tokens by type', typeItems, fmtPrimary),
      renderBreakdownCard(metric === 'cost' ? 'Cost by model' : 'Tokens by model', topModels, fmtPrimary, { clickable: true }),
    );
    body.append(breakGrid);

    // Compact Top Sessions section.
    if (sessions.length) {
      const sessSec = el('section', 'uv-sessions-sec');
      const sHead = el('div', 'uv-break-head');
      sHead.append(el('span', 'uv-break-title', 'Top sessions'), el('span', 'uv-card-sub', 'Highest usage in range'));
      const list = el('div', 'uv-session-list');
      for (const item of sessions) {
        const canOpen = Boolean(item.sessionId && !item.sessionId.startsWith('research:'));
        const row = canOpen
          ? el('button', 'uv-session-row is-clickable')
          : el('div', 'uv-session-row');
        if (canOpen && row instanceof HTMLButtonElement) {
          row.type = 'button';
          row.onclick = () => onOpenChat(item.sessionId);
          row.title = `Open "${item.title}"`;
        }
        const left = el('div', 'uv-session-main');
        const sub = el('div', 'uv-session-sub');
        if (item.project) sub.append(el('span', 'uv-pill', item.project));
        sub.append(el('span', '', `${item.turns} ${item.turns === 1 ? 'turn' : 'turns'}`));
        left.append(el('div', 'uv-session-title', item.title), sub);
        const right = el('div', 'uv-session-right');
        right.append(el('span', 'uv-mono uv-muted', formatTokens(item.total)), el('span', 'uv-mono uv-cost', formatMoneyExact(item.cost)));
        row.append(left, right);
        list.append(row);
      }
      sessSec.append(sHead, list);
      body.append(sessSec);
    }

    root.replaceChildren(body);
  }

  function show(): void {
    root.hidden = false;
    document.documentElement.classList.add('usage-open');
    sidebarButton?.setAttribute('aria-pressed', 'true');
    sidebarButton?.classList.add('current');
    if (!unsubPlans && api?.onPlanUsage) {
      unsubPlans = api.onPlanUsage(plans => {
        data = { ...data, plans: plans || {} };
        if (isOpen() && mode === 'limits') render();
      });
    }
    render();
    void load();
    onShow();
  }

  function hide(): void {
    if (root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('usage-open');
    sidebarButton?.setAttribute('aria-pressed', 'false');
    sidebarButton?.classList.remove('current');
    onHide();
  }

  function toggle(): void {
    if (isOpen()) hide();
    else show();
  }

  return { show, hide, toggle, isOpen, refresh: () => load({ force: true }) };
}
