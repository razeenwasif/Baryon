import { randomBytes } from 'node:crypto';
import { GoogleConnection } from './google-connection.mjs';
export { googleClient } from './google-connection.mjs';

const API = 'https://www.googleapis.com/calendar/v3';
export const READ_SCOPES = ['calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.freebusy'].map(s => `https://www.googleapis.com/auth/${s}`);
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const limited = (v, n = 300) => String(v ?? '').slice(0, n);
export function timeRange(args) {
  const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
  if (!iso(args.timeMin) || !iso(args.timeMax)) throw new Error('Use start and end timestamps with an explicit time-zone offset.');
  const duration = Date.parse(args.timeMax) - Date.parse(args.timeMin);
  if (duration <= 0 || duration > 31 * 86400000) throw new Error('Choose a calendar range of at most 31 days, with the end after the start.');
  return { timeMin: args.timeMin, timeMax: args.timeMax };
}
export function eventDraft(args) {
  if (!args || Object.keys(args).some(k => !['summary', 'start', 'end', 'timeZone', 'allDay'].includes(k))) throw new Error('This version supports personal events only, without guests, recurrence, or attachments.');
  if (typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 200 || /[\x00-\x1f]/.test(args.summary)) throw new Error('Give the event a single-line title of 1–200 characters.');
  if (typeof args.allDay !== 'boolean') throw new Error('Specify whether this is an all-day event.');
  try { new Intl.DateTimeFormat('en', { timeZone: args.timeZone }).format(); } catch { throw new Error('Choose a valid IANA time zone.'); }
  if (typeof args.timeZone !== 'string' || !args.timeZone) throw new Error('Specify the event time zone.');
  if (args.allDay) {
    for (const date of [args.start, args.end]) if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Use valid YYYY-MM-DD dates for an all-day event.');
    timeRange({ timeMin: args.start + 'T00:00:00Z', timeMax: args.end + 'T00:00:00Z' });
  } else {
    timeRange({ timeMin: args.start, timeMax: args.end });
    for (const value of [args.start, args.end]) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: args.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
      if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== value.slice(0, 16)) throw new Error('The event timestamps do not match the selected time zone. Check the date and daylight-saving offset.');
    }
  }
  return { summary: args.summary.trim(), start: args.allDay ? { date: args.start } : { dateTime: args.start, timeZone: args.timeZone }, end: args.allDay ? { date: args.end } : { dateTime: args.end, timeZone: args.timeZone } };
}
const safeWebUrl = (raw, allowedHosts = null) => {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (allowedHosts && !allowedHosts.includes(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
};
const extractJoinUrl = e => {
  const candidates = [
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
export function calendarEvent(e) {
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
  constructor(options) { super({ ...options, service: 'Calendar', apiRoot: API, readScopes: READ_SCOPES, writeScope: WRITE_SCOPE }); }
  status() { return { ...super.status(), canCreate: super.status().canWrite }; }
  async calendars(signal) {
    const items = []; let pageToken;
    for (let p = 0; p < 5; p++) {
      const q = new URLSearchParams({ maxResults: '100', minAccessRole: 'freeBusyReader', ...(pageToken ? { pageToken } : {}) });
      const data = await this.request('/users/me/calendarList?' + q, { signal });
      items.push(...(data.items || []).map(c => ({ id: limited(c.id), name: limited(c.summary), timeZone: limited(c.timeZone), primary: Boolean(c.primary), accessRole: c.accessRole })));
      pageToken = data.nextPageToken; if (!pageToken) break;
    }
    return { calendars: items, truncated: Boolean(pageToken) };
  }
  async events(args, signal) {
    const range = timeRange(args), id = args.calendarId || 'primary';
    if (typeof id !== 'string' || id.length > 300 || !id) throw new Error('Choose a valid calendar.');
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
    const q = new URLSearchParams({ ...range, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '100', ...(query ? { q: query } : {}) });
    const data = await this.request(`/calendars/${encodeURIComponent(id)}/events?${q}`, { signal });
    return { calendarId: id, timeZone: data.timeZone, ...range, events: (data.items || []).filter(e => e.status !== 'cancelled').map(calendarEvent), truncated: Boolean(data.nextPageToken) };
  }
  async eventsForWindow({ from, to } = {}, signal) {
    if (!this.status().connected) return { connected: false, events: [], updatedAt: Date.now() };
    const now = Date.now();
    const timeMin = from || new Date(now - 3 * 86400000).toISOString();
    const timeMax = to || new Date(now + 27 * 86400000).toISOString();
    const { events } = await this.events({ timeMin, timeMax }, signal);
    return { connected: true, events, updatedAt: Date.now() };
  }
  async freeBusy(args, signal) {
    const range = timeRange(args), ids = args.calendarIds || ['primary'];
    if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => typeof id !== 'string' || !id || id.length > 300)) throw new Error('Choose between 1 and 10 calendars.');
    const data = await this.request('/freeBusy', { method: 'POST', signal, body: { ...range, items: ids.map(id => ({ id })) } });
    return { ...range, calendars: Object.fromEntries(Object.entries(data.calendars || {}).map(([id, c]) => [id, { busy: c.busy || [], errors: c.errors || [] }])), incomplete: ids.some(id => !data.calendars?.[id] || data.calendars[id].errors?.length) };
  }
  async eventById(eventId, signal) {
    const clean = String(eventId || '').trim();
    if (!/^[a-v0-9]{5,1024}$/i.test(clean)) return null;
    try {
      const result = await this.request(`/calendars/primary/events/${encodeURIComponent(clean)}`, { signal });
      return result?.status === 'cancelled' ? null : calendarEvent(result);
    } catch (error) {
      if (/\b404\b|not found/i.test(String(error?.message || ''))) return null;
      throw error;
    }
  }
  async create(args, approve, signal, { eventId = '' } = {}) {
    const draft = eventDraft(args), epoch = this.epoch;
    if (!this.status().canCreate) throw new Error('Enable event creation and reconnect Google Calendar in Settings first.');
    const data = await this.calendars(signal), primary = data.calendars.find(c => c.primary);
    if (!primary || primary.accessRole !== 'owner') throw new Error('Could not verify your primary calendar. Nothing was created.');
    signal?.throwIfAborted();
    if (!await approve({ calendar: primary.name, calendarId: primary.id, timeZone: args.timeZone, ...draft })) return { created: false, cancelled: true };
    signal?.throwIfAborted(); if (epoch !== this.epoch) throw new Error('Calendar connection changed.');
    const id = /^[a-v0-9]{5,1024}$/i.test(String(eventId || '')) ? String(eventId) : randomBytes(16).toString('hex');
    const body = { ...draft, id, reminders: { useDefault: true } };
    const result = await this.request('/calendars/primary/events?sendUpdates=none', { method: 'POST', body, signal });
    return { created: true, event: calendarEvent(result) };
  }
}
