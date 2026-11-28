// Relay's window logic (relay.js draws it): sizes and times in words, the icon's state, and the daily time's steps.

export interface RelayJob {
  enabled?: boolean;
}

export interface RelayHistoryItem {
  ok?: boolean;
}

export interface RelayMiniState {
  reachable?: boolean;
  free?: number;
}

export interface RelayServiceState {
  loaded?: boolean;
}

export interface RelayRunningState {
  expected?: number;
  bytes: number;
  total?: number;
  index: number;
}

export interface RelayMacState {
  installed?: boolean;
  running?: RelayRunningState | null;
  history?: RelayHistoryItem[];
  last?: RelayHistoryItem | null;
  mini?: RelayMiniState | null;
  floor?: number;
  service?: RelayServiceState | null;
  jobs?: RelayJob[];
}

export type RelayIconState = 'idle' | 'syncing' | 'done' | 'failed' | 'waiting' | 'off';

export interface RelayStateInput {
  mac?: RelayMacState | null;
  doneAt?: number;
  now?: number;
}

// Sizes as relay's repos come: kilobytes for a few notes, gigabytes for ~/Github.
export const bytes = (value: unknown): string => size(value).replace(/\.0 /, ' ');
function size(value: unknown): string {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1e3) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e8 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(n < 1e11 ? 1 : 0)} GB`;
}
export const count = (n: unknown): string => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US');
export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;

// When the next daily sync is, said as the card says it: "Tonight 02:00", "Today 14:30", "Tomorrow 09:00".
export function nextWords(next: string | number | Date | null | undefined, now: string | number | Date = Date.now()): string {
  if (!next) return '—';
  const at = new Date(next), today = new Date(now), tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`, small = at.getHours() < 5;
  if (at.toDateString() === today.toDateString()) return `${small ? 'Tonight' : 'Today'} ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `${small && today.getHours() >= 12 ? 'Tonight' : 'Tomorrow'} ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

// Which way relay reached the mini, in words: its routes are tried in order (Tailscale, Bonjour, the home network).
export const routeName = (host: string): string => (/^100\./.test(host) ? 'Tailscale' : /\.local$/.test(host) ? 'Bonjour' : /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? 'home network' : '');

// The daily time moved by half an hour, round the clock.
export function stepTime(hhmm: string | number | null | undefined, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
  const total = m ? Number(m[1]) * 60 + Number(m[2]) : 120;
  const next = (((Math.round((total + minutes) / 30) * 30) % 1440) + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

// How the icon stands: syncing; just synced (3 minutes); the last sync failed; waiting for the mini (out of reach, or
// under relay's floor); its schedule off; idle. A window with no relay of its own shows the MacBook's.
export function relayState({ mac, doneAt = 0, now = Date.now() }: RelayStateInput): RelayIconState {
  if (!mac || mac.installed === false) return 'idle';
  if (mac.running) return 'syncing';
  if (doneAt && now - doneAt < 180_000) return mac.history?.[0]?.ok === false || mac.last?.ok === false ? 'failed' : 'done';
  const last = mac.history?.[0] ?? mac.last;
  if (last && last.ok === false) return 'failed';
  if (mac.mini && (!mac.mini.reachable || (mac.mini.free && mac.floor && mac.mini.free < mac.floor))) return 'waiting';
  if (mac.service && !mac.service.loaded) return 'off';
  return 'idle';
}

// How far a sync has got: repos finished out of all, nudged by bytes when the dry run said how much was waiting.
export function syncProgress(running: RelayRunningState | null | undefined): number {
  if (!running) return 0;
  if (running.expected) return Math.min(0.98, Math.max(0.03, running.bytes / running.expected));
  if (!running.total) return 0.06;
  return Math.max(0.04, Math.max(0, running.index - 1) / running.total);
}

// The sync button's words: how many repos are on, and how much the dry run said they'd send.
export function syncLabel(mac: RelayMacState | null | undefined): string {
  const on = (mac?.jobs || []).filter(j => j.enabled).length;
  return on ? `Sync ${on === 1 ? '1 repo' : `${on} repos`} now` : 'No repos on';
}
