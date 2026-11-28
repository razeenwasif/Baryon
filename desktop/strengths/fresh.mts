// Keeping the strengths table fresh (docs/auto-by-task-plan.md, stage 7). Pure: the table, what's offered now and the
// time are passed in, and it says what to do.
//
//   A new model    one a provider offers that the table hadn't seen. A notice says so, and that its scores are guesses
//                  from the web until you run evals on it (decision 5: Fairy asks, never runs them on its own).
//   Stale numbers  the web numbers are 30 days old. With strengthsRefresh 'auto' the web numbers are read again; with
//                  'ask' (the default, since a refresh spends a little allowance) a notice asks.
// The first look only learns what's offered, so the models there already aren't all "new".
import { modelKey, type StrengthsTableInput } from './table.mjs';

export const STALE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface StrengthsSourceStatus {
  fetched?: string;
  [key: string]: unknown;
}

export interface StrengthsNoticeInput {
  type?: string;
  model?: string;
  provider?: string;
  level?: string;
  days?: number;
}

export interface StrengthsNotice extends StrengthsNoticeInput {
  id: string;
  type: string;
  at?: string;
  dismissed?: boolean;
}

export interface FreshnessModelInput {
  id: string;
  provider: string;
  tier?: string;
}

export interface FreshnessOptions {
  models?: readonly FreshnessModelInput[];
  now: string;
  mode?: string;
}

export interface FreshnessResult<TTable extends StrengthsTableInput = StrengthsTableInput> {
  table: TTable & {
    known: Record<string, string[]>;
    notices: StrengthsNotice[];
  };
  notices: StrengthsNotice[];
  refresh: boolean;
}

// The newest time any source was read, or null.
export function lastRead(table: StrengthsTableInput): string | null {
  const times = Object.values(table.sources || {})
    .map(status => Date.parse((status as StrengthsSourceStatus | null | undefined)?.fetched || ''))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

// models: offeredModels(…) ({ id, provider, tier }). Returns { table, notices (new ones), refresh }.
export function freshness<TTable extends StrengthsTableInput>(
  table: TTable,
  { models = [], now, mode = 'ask' }: FreshnessOptions,
): FreshnessResult<TTable> {
  const known: Record<string, string[]> = { ...((table.known as Record<string, string[]> | undefined) || {}) };
  const firstLook = !Object.keys(known).length;
  const notices: StrengthsNotice[] = [];
  const seen = new Set(Object.values(known).flat());
  for (const { id, provider } of models) {
    const key = modelKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    known[provider] = [...(known[provider] || []), key];
    if (!firstLook) notices.push({ id: `new-${key}`, type: 'new-model', provider, model: key, level: id, at: now });
  }
  let refresh = false;
  const read = lastRead(table);
  const age = read ? (Date.parse(now) - Date.parse(read)) / DAY : null;
  const existingNotices = (table.notices || []) as StrengthsNotice[];
  const already = new Set(existingNotices.map(notice => notice.id));
  // A new model's web numbers, if any, come with a refresh; stale numbers too. Never a first refresh: that's yours.
  if (read && (notices.length || (age !== null && age >= STALE_DAYS))) {
    if (mode === 'auto') refresh = true;
    else if (age !== null && age >= STALE_DAYS) notices.push({ id: `stale-${read.slice(0, 10)}`, type: 'stale', days: Math.floor(age), at: now });
  }
  const fresh = notices.filter(notice => !already.has(notice.id));
  return { table: { ...table, known, notices: [...existingNotices, ...fresh].slice(-40) }, notices: fresh, refresh };
}

// A notice put away from the Strengths page.
export const dismiss = <TTable extends StrengthsTableInput>(
  table: TTable,
  id: string,
): TTable & { notices: StrengthsNotice[] } => ({
  ...table,
  notices: ((table.notices || []) as StrengthsNotice[]).map(notice => notice.id === id ? { ...notice, dismissed: true } : notice),
});

// What a notice says, for the page and a notification.
export function noticeWords(
  notice: StrengthsNoticeInput,
  { name = (id?: string) => id ?? '' }: { name?: (id?: string) => string } = {},
): { title: string; body: string } {
  if (notice.type === 'new-model') return { title: `New model: ${name(notice.model)}`, body: `Its scores are only what the web says until you run evals on it: node scripts/eval.mjs --kinds code,maths,circuits --provider ${notice.provider} --model ${notice.level}` };
  if (notice.type === 'stale') return { title: 'The web numbers are a month old', body: `They were last read ${notice.days} days ago. Refresh reads the benchmark pages again, one light scout turn each.` };
  return { title: 'Strengths table', body: '' };
}
