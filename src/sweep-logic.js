// Sweep's window logic (sweep.js draws it): sizes and times in words, the broom's state, and what a sweep by hand takes.

export const GB = 1e9;
export const gb = bytes => { const n = Math.max(0, Number(bytes) || 0) / GB; return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} GB`; };
export const gbFine = bytes => { const n = Math.max(0, Number(bytes) || 0); return n < 0.005 * GB ? '—' : `${(n / GB).toFixed(2)} GB`; };
export function ago(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const clock = ms => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—');
// How the broom stands: sweeping, just swept (for 3 minutes), low on space, its watcher off, or idle.
export function broomState({ here, other, doneAt = 0, now = Date.now() }) {
  if (here?.running || other?.running) return 'sweeping';
  if (doneAt && now - doneAt < 180_000) return 'done';
  if (here?.below || other?.below) return 'low';
  if (here && here.service && !here.service.loaded) return 'off';
  return 'idle';
}
// A sweep by hand cleans the targets on at Safe and Moderate; Aggressive ones (Trash, old installers, stale Rust
// target/ folders) only when you tick them.
export const sweepTier = aggressive => (aggressive ? 'aggressive' : 'moderate');
export const tierOf = name => ({ safe: 'SAFE', moderate: 'MOD', aggressive: 'AGGR', optin: 'OPT' })[String(name).toLowerCase()] || String(name).toUpperCase();
export function sweepCount(targets, aggressive = false) {
  const allowed = aggressive ? ['SAFE', 'MOD', 'AGGR'] : ['SAFE', 'MOD'];
  const list = (targets || []).filter(t => t.enabled && allowed.includes(tierOf(t.tier)));
  return { count: list.length, bytes: list.reduce((sum, t) => sum + (t.bytes || 0), 0) };
}
