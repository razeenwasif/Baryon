export function isSessionSnoozed(session, nowMs = Date.now()) {
  if (!session?.snoozedUntil) return false;
  const ts = Date.parse(session.snoozedUntil);
  return Number.isFinite(ts) && ts > nowMs;
}

export function formatSnoozeRemaining(untilIso, nowMs = Date.now()) {
  if (!untilIso) return '';
  const ts = Date.parse(untilIso);
  if (!Number.isFinite(ts) || ts <= nowMs) return '';
  const mins = Math.max(1, Math.round((ts - nowMs) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function snoozePresets(nowMs = Date.now()) {
  const in1h = new Date(nowMs + 3600_000).toISOString();
  const in3h = new Date(nowMs + 3 * 3600_000).toISOString();
  const tmr = new Date(nowMs);
  tmr.setDate(tmr.getDate() + 1);
  tmr.setHours(9, 0, 0, 0);
  return [
    { id: '1h', label: '1h', until: in1h },
    { id: '3h', label: '3h', until: in3h },
    { id: 'tomorrow', label: '9am', until: tmr.toISOString() },
  ];
}

/**
 * Orders sessions for the Inbox view: needs-input & finished threads first, excluding snoozed threads unless requested.
 */
export function sortInboxByReturn(sessions = [], { nowMs = Date.now(), running = {}, finished = [], includeSnoozed = false } = {}) {
  const finSet = new Set(Array.isArray(finished) ? finished : []);
  const filtered = (Array.isArray(sessions) ? sessions : []).filter(s => s && (includeSnoozed || !isSessionSnoozed(s, nowMs)));

  const priority = s => {
    const r = running?.[s.id];
    if (r === 'waiting') return 0;
    if (finSet.has(s.id)) return 1;
    if (r) return 2;
    return 3;
  };

  return [...filtered].sort((a, b) => {
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pa - pb;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}
