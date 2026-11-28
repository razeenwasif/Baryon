import { randomBytes } from 'node:crypto';
import { GoogleConnection, type GoogleConnectionOptions, type GoogleConnectionStatus } from './google-connection.mjs';
export { googleClient } from './google-connection.mjs';

const API = 'https://www.googleapis.com/calendar/v3';
export const READ_SCOPES = ['calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.freebusy'].map(s => `https://www.googleapis.com/auth/${s}`);
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const limited = (v: unknown, n = 300): string => String(v ?? '').slice(0, n);

export interface TimeRange {
  timeMin: string;
  timeMax: string;
}

export interface EventDraftInput {
  summary?: unknown;
  start?: unknown;
  end?: unknown;
  timeZone?: unknown;
  allDay?: unknown;
  [key: string]: unknown;
}

export interface EventDraft {
  summary: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
}

export interface RawCalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  organizer?: { displayName?: string };
  status?: string;
  transparency?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string } | null | undefined>;
  };
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | undefined;
  end: string | undefined;
  allDay: boolean;
  location: string;
  joinUrl: string;
  calendarName: string;
  color: string;
  status: string | undefined;
  availability: 'free' | 'busy';
  url: string | null;
}

export interface CalendarSummary {
  id: string;
  name: string;
  timeZone: string;
  primary: boolean;
  accessRole: string | undefined;
}

export interface CalendarConnectionStatus extends GoogleConnectionStatus {
  canCreate: boolean;
}

export type CalendarConnectionOptions = Omit<GoogleConnectionOptions, 'service' | 'apiRoot' | 'readScopes' | 'writeScope'>;

export function timeRange(args: { timeMin?: unknown; timeMax?: unknown }): TimeRange {
  const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
  if (!iso(args.timeMin) || !iso(args.timeMax)) throw new Error('Use start and end timestamps with an explicit time-zone offset.');
  const duration = Date.parse(args.timeMax) - Date.parse(args.timeMin);
  if (duration <= 0 || duration > 31 * 86400000) throw new Error('Choose a calendar range of at most 31 days, with the end after the start.');
  return { timeMin: args.timeMin, timeMax: args.timeMax };
}
export function eventDraft(args: EventDraftInput | null | undefined): EventDraft {
  if (!args || Object.keys(args).some(k => !['summary', 'start', 'end', 'timeZone', 'allDay'].includes(k))) throw new Error('This version supports personal events only, without guests, recurrence, or attachments.');
  if (typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 200 || /[\x00-\x1f]/.test(args.summary)) throw new Error('Give the event a single-line title of 1–200 characters.');
  if (typeof args.allDay !== 'boolean') throw new Error('Specify whether this is an all-day event.');
  try { new Intl.DateTimeFormat('en', { timeZone: args.timeZone as string | undefined }).format(); } catch { throw new Error('Choose a valid IANA time zone.'); }
  if (typeof args.timeZone !== 'string' || !args.timeZone) throw new Error('Specify the event time zone.');
  if (args.allDay) {
    for (const date of [args.start, args.end]) if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Use valid YYYY-MM-DD dates for an all-day event.');
    const start = args.start as string;
    const end = args.end as string;
    timeRange({ timeMin: start + 'T00:00:00Z', timeMax: end + 'T00:00:00Z' });
    return { summary: args.summary.trim(), start: { date: start }, end: { date: end } };
  } else {
    timeRange({ timeMin: args.start, timeMax: args.end });
    const start = args.start as string;
    const end = args.end as string;
    for (const value of [start, end]) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: args.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
      if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== value.slice(0, 16)) throw new Error('The event timestamps do not match the selected time zone. Check the date and daylight-saving offset.');
    }
    return { summary: args.summary.trim(), start: { dateTime: start, timeZone: args.timeZone }, end: { dateTime: end, timeZone: args.timeZone } };
  }
}
const safeWebUrl = (raw: unknown, allowedHosts: readonly string[] | null = null): string | null => {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (allowedHosts && !allowedHosts.includes(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
};
const extractJoinUrl = (e: RawCalendarEvent): string => {
  const candidates: Array<string | undefined> = [
    e?.hangoutLink,
    ...(Array.isArray(e?.conferenceData?.entryPoints)
      ? e.conferenceData.entryPoints.filter(p => p?.entryPointType === 'video').map(p => p?.uri)
      : []),
  ];
  for (const field of [e?.location, e?.description]) {
    if (typeof field === 'string' && field) {
      const match = field.match(/https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[^\s<>"']*zoom\.us\/(?:j|my)\/[^\s<>"']+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+)/i);
      if (match) candidates.push(match[0]);
    }
  }
  for (const c of candidates) {
    const valid = safeWebUrl(c);
    if (valid) return valid;
  }
  return '';
};
export function calendarEvent(e: RawCalendarEvent): CalendarEvent {
  const url = safeWebUrl(e.htmlLink, ['calendar.google.com', 'www.google.com']);
  const joinUrl = extractJoinUrl(e);
  return {
    id: limited(e.id),
    title: limited(e.summary || '(Untitled event)'),
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: Boolean(e.start?.date),
    location: limited(e.location || ''),
    joinUrl,
    calendarName: limited(e.organizer?.displayName || 'Google Calendar', 120),
    color: '#4C8BF5',
    status: e.status,
    availability: e.transparency === 'transparent' ? 'free' : 'busy',
    url,
  };
}

export class CalendarConnection extends GoogleConnection {
  constructor(options: CalendarConnectionOptions) { super({ ...options, service: 'Calendar', apiRoot: API, readScopes: READ_SCOPES, writeScope: WRITE_SCOPE }); }
  override status(): CalendarConnectionStatus { return { ...super.status(), canCreate: super.status().canWrite }; }
  async calendars(signal?: AbortSignal): Promise<{ calendars: CalendarSummary[]; truncated: boolean }> {
    const items: CalendarSummary[] = []; let pageToken: string | undefined;
    for (let p = 0; p < 5; p++) {
      const q = new URLSearchParams({ maxResults: '100', minAccessRole: 'freeBusyReader', ...(pageToken ? { pageToken } : {}) });
      const data = await this.request<{ items?: Array<{ id?: string; summary?: string; timeZone?: string; primary?: boolean; accessRole?: string }>; nextPageToken?: string }>('/users/me/calendarList?' + q, { signal });
      items.push(...(data.items || []).map(c => ({ id: limited(c.id), name: limited(c.summary), timeZone: limited(c.timeZone), primary: Boolean(c.primary), accessRole: c.accessRole })));
      pageToken = data.nextPageToken; if (!pageToken) break;
    }
    return { calendars: items, truncated: Boolean(pageToken) };
  }
  async events(args: { timeMin?: unknown; timeMax?: unknown; calendarId?: unknown; query?: unknown }, signal?: AbortSignal): Promise<{ calendarId: string; timeZone: string | undefined; timeMin: string; timeMax: string; events: CalendarEvent[]; truncated: boolean }> {
    const range = timeRange(args), id = args.calendarId || 'primary';
    if (typeof id !== 'string' || id.length > 300 || !id) throw new Error('Choose a valid calendar.');
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
    const q = new URLSearchParams({ ...range, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '100', ...(query ? { q: query } : {}) });
    const data = await this.request<{ timeZone?: string; items?: RawCalendarEvent[]; nextPageToken?: string }>(`/calendars/${encodeURIComponent(id)}/events?${q}`, { signal });
    return { calendarId: id, timeZone: data.timeZone, ...range, events: (data.items || []).filter(e => e.status !== 'cancelled').map(calendarEvent), truncated: Boolean(data.nextPageToken) };
  }
  async eventsForWindow({ from, to }: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<{ connected: boolean; events: CalendarEvent[]; updatedAt: number }> {
    if (!this.status().connected) return { connected: false, events: [], updatedAt: Date.now() };
    const now = Date.now();
    const timeMin = from || new Date(now - 3 * 86400000).toISOString();
    const timeMax = to || new Date(now + 27 * 86400000).toISOString();
    const { events } = await this.events({ timeMin, timeMax }, signal);
    return { connected: true, events, updatedAt: Date.now() };
  }
  async freeBusy(args: { timeMin?: unknown; timeMax?: unknown; calendarIds?: unknown }, signal?: AbortSignal): Promise<{ timeMin: string; timeMax: string; calendars: Record<string, { busy: unknown[]; errors: unknown[] }>; incomplete: boolean }> {
    const range = timeRange(args), ids = args.calendarIds || ['primary'];
    if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => typeof id !== 'string' || !id || id.length > 300)) throw new Error('Choose between 1 and 10 calendars.');
    const data = await this.request<{ calendars?: Record<string, { busy?: unknown[]; errors?: unknown[] }> }>('/freeBusy', { method: 'POST', signal, body: { ...range, items: ids.map(id => ({ id })) } });
    return { ...range, calendars: Object.fromEntries(Object.entries(data.calendars || {}).map(([id, c]) => [id, { busy: c.busy || [], errors: c.errors || [] }])), incomplete: ids.some(id => !data.calendars?.[id] || Boolean(data.calendars[id].errors?.length)) };
  }
  async eventById(eventId: unknown, signal?: AbortSignal): Promise<CalendarEvent | null> {
    const clean = String(eventId || '').trim();
    if (!/^[a-v0-9]{5,1024}$/i.test(clean)) return null;
    try {
      const result = await this.request<RawCalendarEvent | null>(`/calendars/primary/events/${encodeURIComponent(clean)}`, { signal });
      return !result || result.status === 'cancelled' ? null : calendarEvent(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message || '');
      if (/\b404\b|not found/i.test(message)) return null;
      throw error;
    }
  }
  async create(
    args: EventDraftInput,
    approve: (summary: { calendar: string; calendarId: string; timeZone: unknown } & EventDraft) => Promise<boolean> | boolean,
    signal?: AbortSignal,
    { eventId = '' }: { eventId?: string } = {},
  ): Promise<{ created: true; event: CalendarEvent } | { created: false; cancelled: true }> {
    const draft = eventDraft(args), epoch = this.epoch;
    if (!this.status().canCreate) throw new Error('Enable event creation and reconnect Google Calendar in Settings first.');
    const data = await this.calendars(signal), primary = data.calendars.find(c => c.primary);
    if (!primary || primary.accessRole !== 'owner') throw new Error('Could not verify your primary calendar. Nothing was created.');
    signal?.throwIfAborted();
    if (!await approve({ calendar: primary.name, calendarId: primary.id, timeZone: args.timeZone, ...draft })) return { created: false, cancelled: true };
    signal?.throwIfAborted(); if (epoch !== this.epoch) throw new Error('Calendar connection changed.');
    const id = /^[a-v0-9]{5,1024}$/i.test(String(eventId || '')) ? String(eventId) : randomBytes(16).toString('hex');
    const body = { ...draft, id, reminders: { useDefault: true } };
    const result = await this.request<RawCalendarEvent>('/calendars/primary/events?sendUpdates=none', { method: 'POST', body, signal });
    return { created: true, event: calendarEvent(result) };
  }
}
