export const RANGES = Object.freeze(['24h', '7d', '30d', '90d', 'all'] as const);

export interface ProviderVisualMeta {
  label: string;
  color: string;
}

export const PROVIDER_META: Readonly<Record<string, ProviderVisualMeta>> = Object.freeze({
  claude: { label: 'Claude', color: '#e58b5b' },
  gemini: { label: 'Gemini', color: '#818cf8' },
  codex: { label: 'Codex', color: '#34d399' },
  deepseek: { label: 'DeepSeek', color: '#38bdf8' },
  other: { label: 'Other', color: '#9da2b0' },
});

export const SPLIT_SEGMENTS = Object.freeze([
  { key: 'fresh', label: 'Input', color: '#60a5fa' },
  { key: 'output', label: 'Output', color: '#a78bfa' },
  { key: 'cached', label: 'Cached Read', color: '#34d399' },
]);

export interface UsageEvent {
  at?: string | number | Date;
  provider?: string;
  model?: string;
  sessionId?: string;
  title?: string;
  project?: string;
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
  cost?: number;
  cacheSaved?: number;
}

/** Convert an ISO timestamp or Date into a local YYYY-MM-DD calendar day key. */
export function localDayKey(input: string | number | Date | undefined): string {
  if (input === undefined) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

function shortDayLabel(dayKey: string): string {
  const [y, m, d] = String(dayKey || '').split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Format large token totals compactly (e.g. 12.4M, 845K, 420). */
export function formatTokens(n: number | string | null | undefined): string {
  const value = Math.max(0, Number(n) || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10e9 ? 1 : 2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100e6 ? 0 : value >= 10e6 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100e3 ? 0 : 1)}K`;
  return String(Math.round(value));
}

/** Format estimated USD spend cleanly. */
export function formatCost(n: number | string | null | undefined): string {
  const value = Math.max(0, Number(n) || 0);
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(3)}`;
  return '$0.00';
}

export function formatPct(ratio: number | string | null | undefined): string {
  const pct = Math.max(0, Math.min(100, (Number(ratio) || 0) * 100));
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** Filter raw usage events by date range, provider, and optional model. */
export function filterUsageEvents(
  events: UsageEvent[] = [],
  { range = '30d', provider = 'all', model = 'all', now = new Date() }: { range?: string; provider?: string; model?: string; now?: Date } = {},
): UsageEvent[] {
  const cutoffTs = range === '24h' ? now.getTime() - 86_400_000 : 0;
  const spanDays = ({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[range] || 0;
  const minKey = spanDays > 0 ? localDayKey(addDays(now, -(spanDays - 1))) : '';
  return (Array.isArray(events) ? events : []).filter(event => {
    if (!event) return false;
    if (cutoffTs > 0) {
      const ts = event.at instanceof Date ? event.at.getTime() : Date.parse(String(event.at ?? ''));
      if (!Number.isFinite(ts) || ts < cutoffTs) return false;
    } else if (minKey) {
      const dk = localDayKey(event.at);
      if (!dk || dk < minKey) return false;
    }
    if (provider && provider !== 'all' && event.provider !== provider) return false;
    if (model && model !== 'all' && event.model !== model) return false;
    return true;
  });
}

/** Compute KPI summary metrics for a filtered set of turn events. */
export function summarizeUsage(events: UsageEvent[] = []) {
  let totalTokens = 0, inputTokens = 0, outputTokens = 0, cachedTokens = 0, totalCost = 0, cacheSaved = 0;
  const days = new Set<string>();
  const list = Array.isArray(events) ? events : [];
  for (const e of list) {
    const inp = Math.max(0, Number(e.input) || 0);
    const out = Math.max(0, Number(e.output) || 0);
    const cac = Math.min(inp, Math.max(0, Number(e.cached) || 0));
    totalTokens += Number(e.total) || (inp + out);
    inputTokens += inp;
    outputTokens += out;
    cachedTokens += cac;
    totalCost += Number(e.cost) || 0;
    cacheSaved += Number(e.cacheSaved) || 0;
    const dk = localDayKey(e.at);
    if (dk) days.add(dk);
  }
  const activeDays = days.size;
  const turns = list.length;
  const cacheHitRate = inputTokens > 0 ? Math.min(1, cachedTokens / inputTokens) : 0;
  const avgPerDay = activeDays > 0 ? totalTokens / activeDays : 0;
  const avgCostPerDay = activeDays > 0 ? totalCost / activeDays : 0;
  return { totalTokens, inputTokens, outputTokens, cachedTokens, totalCost, cacheSaved, cacheHitRate, turns, activeDays, avgPerDay, avgCostPerDay };
}

interface DailyBucket {
  day: string;
  label: string;
  turns: number;
  split: Record<string, number>;
  provider: Record<string, number>;
}

/** Build continuous calendar-day stacked bar series for Tokens or Cost. */
export function buildDailySeries(
  events: UsageEvent[] = [],
  { range = '30d', metric = 'tokens', groupBy = 'split', now = new Date() }: { range?: string; metric?: string; groupBy?: string; now?: Date } = {},
) {
  const list = Array.isArray(events) ? events : [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let span = ({ '24h': 2, '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[range] || 0;
  if (!span) {
    let earliest = today;
    for (const e of list) {
      const ts = e.at instanceof Date ? e.at.getTime() : Date.parse(String(e.at ?? ''));
      if (Number.isFinite(ts) && ts < earliest.getTime()) earliest = new Date(ts);
    }
    const earliestDay = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
    const diff = Math.round((today.getTime() - earliestDay.getTime()) / 86_400_000) + 1;
    span = Math.max(14, Math.min(180, diff || 14));
  }

  const buckets = new Map<string, DailyBucket>();
  const keys: string[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const dk = localDayKey(addDays(today, -i));
    keys.push(dk);
    buckets.set(dk, {
      day: dk,
      label: shortDayLabel(dk),
      turns: 0,
      split: { fresh: 0, output: 0, cached: 0 },
      provider: { claude: 0, gemini: 0, codex: 0, deepseek: 0, other: 0 },
    });
  }

  const activeProviders = new Set<string>();
  for (const e of list) {
    const dk = localDayKey(e.at);
    const b = buckets.get(dk);
    if (!b) continue;
    b.turns += 1;
    const inp = Math.max(0, Number(e.input) || 0);
    const out = Math.max(0, Number(e.output) || 0);
    const cac = Math.min(inp, Math.max(0, Number(e.cached) || 0));
    const fresh = Math.max(0, inp - cac);
    const prov = e.provider && PROVIDER_META[e.provider] ? e.provider : 'other';
    activeProviders.add(prov);

    if (metric === 'cost') {
      const cost = Math.max(0, Number(e.cost) || 0);
      const wFresh = fresh;
      const wOut = out * 4;
      const wCache = cac * 0.12;
      const wTotal = wFresh + wOut + wCache;
      if (wTotal > 0) {
        b.split.fresh += cost * (wFresh / wTotal);
        b.split.output += cost * (wOut / wTotal);
        b.split.cached += cost * (wCache / wTotal);
      } else {
        b.split.fresh += cost;
      }
      b.provider[prov] += cost;
    } else {
      b.split.fresh += fresh;
      b.split.output += out;
      b.split.cached += cac;
      b.provider[prov] += inp + out;
    }
  }

  const providerKeys = Object.keys(PROVIDER_META).filter(k => activeProviders.has(k));
  const legend: Array<{ key: string; label: string; color: string }> = groupBy === 'provider'
    ? (providerKeys.length ? providerKeys : ['claude', 'gemini', 'codex']).map(k => ({ key: k, ...PROVIDER_META[k] }))
    : [...SPLIT_SEGMENTS];

  let maxValue = 0;
  let totalValue = 0;
  const days = keys.map(dk => {
    const b = buckets.get(dk)!;
    const segments = legend.map(seg => ({
      key: seg.key,
      label: seg.label,
      color: seg.color,
      value: groupBy === 'provider' ? (b.provider[seg.key] || 0) : (b.split[seg.key] || 0),
    }));
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    if (total > maxValue) maxValue = total;
    totalValue += total;
    return { day: dk, label: b.label, total, turns: b.turns, segments };
  });

  return { days, legend, maxValue, totalValue };
}

/** Group turn events by model and rank by tokens or cost. */
export function groupByModel(events: UsageEvent[] = [], sortBy = 'tokens') {
  const map = new Map<string, { model: string; provider: string; turns: number; input: number; output: number; cached: number; total: number; cost: number; cacheSaved: number }>();
  let grandTotal = 0;
  for (const e of Array.isArray(events) ? events : []) {
    const key = e.model || e.provider || 'unknown';
    const cur = map.get(key) || { model: key, provider: e.provider || 'other', turns: 0, input: 0, output: 0, cached: 0, total: 0, cost: 0, cacheSaved: 0 };
    const inp = Math.max(0, Number(e.input) || 0);
    const out = Math.max(0, Number(e.output) || 0);
    const cac = Math.min(inp, Math.max(0, Number(e.cached) || 0));
    const tot = Number(e.total) || (inp + out);
    cur.turns += 1;
    cur.input += inp;
    cur.output += out;
    cur.cached += cac;
    cur.total += tot;
    cur.cost += Number(e.cost) || 0;
    cur.cacheSaved += Number(e.cacheSaved) || 0;
    map.set(key, cur);
    grandTotal += sortBy === 'cost' ? (Number(e.cost) || 0) : tot;
  }
  const rows = [...map.values()].map(r => ({
    ...r,
    cacheHitRate: r.input > 0 ? Math.min(1, r.cached / r.input) : 0,
    share: grandTotal > 0 ? (sortBy === 'cost' ? r.cost : r.total) / grandTotal : 0,
  }));
  rows.sort((a, b) => (sortBy === 'cost' ? b.cost - a.cost : b.total - a.total));
  return rows;
}

/** Group turn events by session/project and return top consumers. */
export function groupBySession(events: UsageEvent[] = [], sortBy = 'tokens', limit = 15) {
  const map = new Map<string, { sessionId: string; title: string; project: string; provider: string; turns: number; total: number; cost: number; lastAt: string }>();
  let grandTotal = 0;
  for (const e of Array.isArray(events) ? events : []) {
    const key = e.sessionId ? `s:${e.sessionId}` : `t:${e.title || 'Session'}`;
    const cur = map.get(key) || { sessionId: e.sessionId || '', title: e.title || 'Session', project: e.project || '', provider: e.provider || 'other', turns: 0, total: 0, cost: 0, lastAt: e.at ? String(e.at) : '' };
    const tot = Number(e.total) || ((Number(e.input) || 0) + (Number(e.output) || 0));
    cur.turns += 1;
    cur.total += tot;
    cur.cost += Number(e.cost) || 0;
    if (e.at && String(e.at) > String(cur.lastAt)) cur.lastAt = String(e.at);
    map.set(key, cur);
    grandTotal += sortBy === 'cost' ? (Number(e.cost) || 0) : tot;
  }
  const rows = [...map.values()].map(r => ({
    ...r,
    share: grandTotal > 0 ? (sortBy === 'cost' ? r.cost : r.total) / grandTotal : 0,
  }));
  rows.sort((a, b) => (sortBy === 'cost' ? b.cost - a.cost : b.total - a.total));
  return rows.slice(0, limit);
}

/** Group turn events by provider with session counts, totals, and shares. */
export function groupByProvider(events: UsageEvent[] = [], sortBy = 'cost') {
  const map = new Map<string, { provider: string; label: string; color: string; sessionKeys: Set<string>; turns: number; input: number; output: number; cached: number; total: number; cost: number; cacheSaved: number }>();
  let grandTotal = 0;
  for (const e of Array.isArray(events) ? events : []) {
    const key = e.provider && PROVIDER_META[e.provider] ? e.provider : 'other';
    const meta = PROVIDER_META[key];
    const cur = map.get(key) || {
      provider: key,
      label: meta.label,
      color: meta.color,
      sessionKeys: new Set<string>(),
      turns: 0,
      input: 0,
      output: 0,
      cached: 0,
      total: 0,
      cost: 0,
      cacheSaved: 0,
    };
    const inp = Math.max(0, Number(e.input) || 0);
    const out = Math.max(0, Number(e.output) || 0);
    const cac = Math.min(inp, Math.max(0, Number(e.cached) || 0));
    const tot = Number(e.total) || (inp + out);
    cur.turns += 1;
    cur.input += inp;
    cur.output += out;
    cur.cached += cac;
    cur.total += tot;
    cur.cost += Number(e.cost) || 0;
    cur.cacheSaved += Number(e.cacheSaved) || 0;
    cur.sessionKeys.add(e.sessionId ? `s:${e.sessionId}` : `t:${e.title || 'Session'}`);
    map.set(key, cur);
    grandTotal += sortBy === 'cost' ? (Number(e.cost) || 0) : tot;
  }
  const rows = [...map.values()].map(({ sessionKeys, ...r }) => ({
    ...r,
    sessions: sessionKeys.size,
    uncachedInput: Math.max(0, r.input - r.cached),
    share: grandTotal > 0 ? (sortBy === 'cost' ? r.cost : r.total) / grandTotal : 0,
  }));
  rows.sort((a, b) => (sortBy === 'cost' ? b.cost - a.cost : b.total - a.total));
  return rows;
}

/** Summarize Input vs Cache read vs Output shares by tokens or estimated cost. */
export function breakdownByType(events: UsageEvent[] = [], metric = 'cost') {
  let fresh = 0, cached = 0, output = 0;
  for (const e of Array.isArray(events) ? events : []) {
    const inp = Math.max(0, Number(e.input) || 0);
    const out = Math.max(0, Number(e.output) || 0);
    const cac = Math.min(inp, Math.max(0, Number(e.cached) || 0));
    const uncached = Math.max(0, inp - cac);
    if (metric === 'cost') {
      const cost = Math.max(0, Number(e.cost) || 0);
      const wFresh = uncached, wOut = out * 4, wCache = cac * 0.12;
      const wTotal = wFresh + wOut + wCache;
      if (wTotal > 0) {
        fresh += cost * (wFresh / wTotal);
        cached += cost * (wCache / wTotal);
        output += cost * (wOut / wTotal);
      } else {
        fresh += cost;
      }
    } else {
      fresh += uncached;
      cached += cac;
      output += out;
    }
  }
  const total = fresh + cached + output;
  const segments = [
    { key: 'fresh', label: 'Input', color: '#6b7280', value: fresh, share: total > 0 ? fresh / total : 0 },
    { key: 'cached', label: 'Cache read', color: '#a1a1aa', value: cached, share: total > 0 ? cached / total : 0 },
    { key: 'output', label: 'Output', color: '#f4f4f5', value: output, share: total > 0 ? output / total : 0 },
  ];
  return { total, segments };
}
