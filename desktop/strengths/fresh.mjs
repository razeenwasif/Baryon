// Keeping the strengths table fresh (docs/auto-by-task-plan.md, stage 7). Pure: the table, what's offered now and the
// time are passed in, and it says what to do.
//
//   A new model    one a provider offers that the table hadn't seen. A notice says so, and that its scores are guesses
//                  from the web until you run evals on it (decision 5: Fairy asks, never runs them on its own).
//   Stale numbers  the web numbers are 30 days old. With strengthsRefresh 'auto' the web numbers are read again; with
//                  'ask' (the default, since a refresh spends a little allowance) a notice asks.
// The first look only learns what's offered, so the models there already aren't all "new".
import { modelKey } from './table.mjs';

export const STALE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// The newest time any source was read, or null.
export function lastRead(table) {
  const times = Object.values(table.sources || {}).map(status => Date.parse(status?.fetched || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

// models: offeredModels(…) ({ id, provider, tier }). Returns { table, notices (new ones), refresh }.
export function freshness(table, { models = [], now, mode = 'ask' }) {
  const known = { ...(table.known || {}) }, firstLook = !Object.keys(known).length, notices = [];
  const seen = new Set(Object.values(known).flat());
  for (const { id, provider } of models) {
    const key = modelKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    known[provider] = [...(known[provider] || []), key];
    if (!firstLook) notices.push({ id: `new-${key}`, type: 'new-model', provider, model: key, level: id, at: now });
  }
  let refresh = false;
  const read = lastRead(table), age = read ? (Date.parse(now) - Date.parse(read)) / DAY : null;
  const already = new Set((table.notices || []).map(notice => notice.id));
  // A new model's web numbers, if any, come with a refresh; stale numbers too. Never a first refresh: that's yours.
  if (read && (notices.length || age >= STALE_DAYS)) {
    if (mode === 'auto') refresh = true;
    else if (age >= STALE_DAYS) notices.push({ id: `stale-${read.slice(0, 10)}`, type: 'stale', days: Math.floor(age), at: now });
  }
  const fresh = notices.filter(notice => !already.has(notice.id));
  return { table: { ...table, known, notices: [...(table.notices || []), ...fresh].slice(-40) }, notices: fresh, refresh };
}

// A notice put away from the Strengths page.
export const dismiss = (table, id) => ({ ...table, notices: (table.notices || []).map(notice => notice.id === id ? { ...notice, dismissed: true } : notice) });

// What a notice says, for the page and a notification.
export function noticeWords(notice, { name = id => id } = {}) {
  if (notice.type === 'new-model') return { title: `New model: ${name(notice.model)}`, body: `Its scores are only what the web says until you run evals on it: node scripts/eval.mjs --kinds code,maths,circuits --provider ${notice.provider} --model ${notice.level}` };
  if (notice.type === 'stale') return { title: 'The web numbers are a month old', body: `They were last read ${notice.days} days ago. Refresh reads the benchmark pages again, one light scout turn each.` };
  return { title: 'Strengths table', body: '' };
}
