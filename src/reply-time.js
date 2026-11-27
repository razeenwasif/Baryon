/**
 * Formats an assistant reply timestamp with both date and time for display.
 * Accepts ISO strings, Date instances, or epoch numbers (seconds or ms).
 */
export function formatReplyTime(at, { now = new Date(), locale } = {}) {
  if (at == null || at === '') return null;
  let date;
  if (at instanceof Date) {
    date = at;
  } else if (typeof at === 'number' || (typeof at === 'string' && /^\d+(?:\.\d+)?$/.test(at.trim()))) {
    const num = Number(at);
    if (!Number.isFinite(num)) return null;
    date = new Date(num < 1e12 ? num * 1000 : num);
  } else {
    date = new Date(at);
  }
  if (Number.isNaN(date.getTime())) return null;

  const ref = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const sameYear = date.getFullYear() === ref.getFullYear();

  return {
    label: date.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    }),
    iso: date.toISOString(),
    title: date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'medium' }),
  };
}
