import { CalendarConnection, READ_SCOPES, WRITE_SCOPE } from '../desktop/calendar.mjs';
import { GmailConnection, GMAIL_READ_SCOPES, GMAIL_DRAFT_SCOPE } from '../desktop/gmail.mjs';
import { DriveConnection, DRIVE_READ_SCOPES, DRIVE_WRITE_SCOPE } from '../desktop/drive.mjs';
import type { GoogleConnectionStoredValue } from '../desktop/google-connection.mjs';

export interface FakeGoogleCalendar {
  id: string;
  name: string;
  timeZone: string;
  primary?: boolean;
  accessRole?: string;
}

export interface FakeGoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface FakeGoogleEvent {
  id?: string;
  calendarId?: string;
  summary?: string;
  description?: string;
  status?: string;
  transparency?: string;
  start: FakeGoogleEventTime;
  end: FakeGoogleEventTime;
  [key: string]: unknown;
}

export interface FakeGmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  unread?: boolean;
  starred?: boolean;
  inbox?: boolean;
  labels?: string[];
  replyTo?: string;
  messageId?: string;
}

export interface FakeGmailDraft {
  id: string;
  threadId: string | undefined;
  to: string | undefined;
  subject: string;
  inReplyTo: string | undefined;
  body: string;
}

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  content?: string;
  size?: number | string;
  description?: string;
  trashed?: boolean;
}

export interface FakeGoogleWorld {
  now?: string;
  offset?: string;
  zone?: string;
  calendar?: {
    calendars?: FakeGoogleCalendar[];
    events?: FakeGoogleEvent[];
    canCreate?: boolean;
  };
  gmail?: {
    email?: string;
    messages?: FakeGmailMessage[];
    canDraft?: boolean;
  };
  drive?: {
    files?: FakeDriveFile[];
    canCreate?: boolean;
  };
}

export interface FakeGoogleRequest {
  method: string;
  url: string;
}

export interface FakeGoogleCreated {
  events: FakeGoogleEvent[];
  drafts: FakeGmailDraft[];
  files: FakeDriveFile[];
}

export interface FakeGoogleConnections {
  calendar: CalendarConnection;
  gmail: GmailConnection;
  drive: DriveConnection;
}

// Google's web APIs, as far as Fairy's Calendar, Gmail and Drive code uses them, answered from a made-up world kept in
// memory. Fairy's real connections run on top through their fetch option, so their checks and result shaping are the
// ones under test, and nothing can reach a real account: the token is fake and every request stays in this file.
const CALENDAR = 'https://www.googleapis.com/calendar/v3', GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DRIVE = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const text = (data: string, status = 200): Response => new Response(data, { status, headers: { 'Content-Type': 'text/plain' } });
const missing = (): Response => json({ error: { code: 404, message: 'Not found in the eval world.' } }, 404);
const lower = (value: unknown): string => String(value ?? '').toLowerCase();

// An all-day event's date, read as midnight in the world's offset.
const instant = (value: string | undefined, offset: string): number =>
  Date.parse(/^\d{4}-\d\d-\d\d$/.test(value || '') ? `${value}T00:00:00${offset}` : (value || ''));
const overlaps = (event: FakeGoogleEvent, from: number, to: number, offset: string): boolean =>
  instant(event.start.dateTime || event.start.date, offset) < to && instant(event.end.dateTime || event.end.date, offset) > from;

// Gmail's search operators that Fairy's prompts lead models to use. Anything else is matched as words, so an unusual
// query finds what it plainly asks for rather than failing the task on syntax.
export function gmailMatches(
  message: Pick<FakeGmailMessage, 'date'> & Partial<Omit<FakeGmailMessage, 'date'>>,
  query: string | null | undefined,
  now: number,
): boolean {
  const tokens = String(query || '').match(/-?\w+:\([^)]*\)|-?\w+:"[^"]*"|-?\w+:\S+|"[^"]*"|\S+/g) || [];
  const words = [message.from, message.to, message.subject, message.body].map(lower).join('\n');
  return tokens.every(raw => {
    const negate = raw.startsWith('-'), token = negate ? raw.slice(1) : raw;
    if (/^or$/i.test(token)) return true;
    const [, key = '', value = token] = token.match(/^(\w+):(.*)$/) || [];
    const clean = lower(value).replace(/^[("]|[)"]$/g, '');
    let ok: boolean;
    if (key === 'is') ok = clean === 'unread' ? Boolean(message.unread) : clean === 'read' ? !message.unread : clean === 'starred' ? Boolean(message.starred) : true;
    else if (key === 'in' || key === 'label') ok = clean === 'inbox' ? message.inbox !== false : clean === 'anywhere' || clean === 'all' ? true : (message.labels || []).map(lower).includes(clean);
    else if (key === 'from' || key === 'to' || key === 'subject') ok = clean.split(/\s+/).every(part => lower(message[key]).includes(part));
    else if (key === 'newer_than' || key === 'older_than') {
      const [, count, unit] = clean.match(/^(\d+)([dmy])$/) || [];
      const age = count ? Number(count) * ({ d: 1, m: 30, y: 365 }[unit as 'd' | 'm' | 'y']) * 86400000 : 0;
      ok = !count || (key === 'newer_than' ? now - Date.parse(message.date) <= age : now - Date.parse(message.date) > age);
    } else if (key === 'after' || key === 'before') {
      const when = Date.parse(clean.replace(/\//g, '-'));
      ok = !Number.isFinite(when) || (key === 'after' ? Date.parse(message.date) >= when : Date.parse(message.date) < when);
    } else if (key) ok = true; // category:, has:, and others the world doesn't model
    else ok = clean.split(/\s+/).every(part => words.includes(part));
    return negate ? !ok : ok;
  });
}

function mime(message: FakeGmailMessage) {
  const headers = [['From', message.from], ['To', message.to], ['Subject', message.subject], ['Date', new Date(message.date).toUTCString()], ['Message-ID', `<${message.id}@eval.example>`], ...(message.replyTo ? [['Reply-To', message.replyTo]] : [])];
  return { id: message.id, threadId: message.threadId, labelIds: [...(message.inbox === false ? [] : ['INBOX']), ...(message.unread ? ['UNREAD'] : [])], snippet: message.body.replace(/\s+/g, ' ').slice(0, 140), internalDate: String(Date.parse(message.date)),
    payload: { mimeType: 'text/plain', headers: headers.map(([name, value]) => ({ name, value })), body: { data: Buffer.from(message.body).toString('base64url') } } };
}

// Reads a draft back the way Gmail would store it, so checks can look at its recipient and words.
export function readDraft(raw: string): Omit<FakeGmailDraft, 'id' | 'threadId'> {
  const source = Buffer.from(raw, 'base64url').toString('utf8'), [head, ...rest] = source.split('\r\n\r\n');
  const headers = Object.fromEntries(head.replace(/\r\n /g, ' ').split('\r\n').map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
  const subject = headers.subject.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, data: string) => Buffer.from(data, 'base64').toString('utf8'));
  return { to: headers.to, subject, inReplyTo: headers['in-reply-to'], body: Buffer.from(rest.join('\r\n\r\n').replace(/\s+/g, ''), 'base64').toString('utf8') };
}

function driveMatches(file: FakeDriveFile, query: string): boolean {
  if (file.trashed) return false;
  const names = [...query.matchAll(/name contains '((?:\\.|[^'])*)'/g)].map(m => lower(m[1].replace(/\\(.)/g, '$1')));
  const mimes = [...query.matchAll(/mimeType = '((?:\\.|[^'])*)'/g)].map(m => m[1]);
  return names.every(term => lower(file.name).includes(term) || lower(file.content).includes(term)) && mimes.every(type => file.mimeType === type);
}
const driveView = (file: FakeDriveFile) => ({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, ...(file.size ? { size: String(file.size) } : {}), webViewLink: `https://docs.google.com/document/d/${file.id}/view`, shared: false });

export class FakeGoogle {
  world: FakeGoogleWorld;
  now: number;
  offset: string;
  calendars: FakeGoogleCalendar[];
  events: FakeGoogleEvent[];
  messages: FakeGmailMessage[];
  files: FakeDriveFile[];
  requests: FakeGoogleRequest[];
  created: FakeGoogleCreated;

  constructor(world: FakeGoogleWorld = {}) {
    this.world = world; this.now = Date.parse(world.now || new Date().toISOString()); this.offset = world.offset || '+00:00';
    this.calendars = world.calendar?.calendars || [{ id: 'you@example.com', name: 'You', timeZone: world.zone || 'UTC', primary: true, accessRole: 'owner' }];
    this.events = structuredClone(world.calendar?.events || []);
    this.messages = structuredClone(world.gmail?.messages || []);
    this.files = structuredClone(world.drive?.files || []);
    this.requests = []; this.created = { events: [], drafts: [], files: [] };
    this.fetch = this.fetch.bind(this);
  }
  primary(): FakeGoogleCalendar { return this.calendars.find(c => c.primary) || this.calendars[0]; }
  async fetch(input: string | URL | Request, { method = 'GET', body }: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input)), path = url.origin + url.pathname, route = `${method} ${path}`;
    this.requests.push({ method, url: url.href });
    if (route === `POST ${UPLOAD}`) return this.upload(body);
    const parsedBody = body ? JSON.parse(String(body)) as Record<string, unknown> : undefined;
    if (path.startsWith(CALENDAR)) return this.calendar(method, path.slice(CALENDAR.length), url.searchParams, parsedBody);
    if (path.startsWith(GMAIL)) return this.gmail(method, path.slice(GMAIL.length), url.searchParams, parsedBody);
    if (path.startsWith(DRIVE)) return this.drive(method, path.slice(DRIVE.length), url.searchParams);
    return missing();
  }
  calendar(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | undefined): Response {
    if (method === 'GET' && path === '/users/me/calendarList') return json({ items: this.calendars.map(c => ({ id: c.id, summary: c.name, timeZone: c.timeZone, primary: Boolean(c.primary), accessRole: c.accessRole || 'owner' })) });
    const events = path.match(/^\/calendars\/([^/]+)\/events$/);
    if (events && method === 'GET') {
      const id = decodeURIComponent(events[1]), calendar = id === 'primary' ? this.primary() : this.calendars.find(c => c.id === id);
      if (!calendar) return missing();
      const from = Date.parse(query.get('timeMin') ?? ''), to = Date.parse(query.get('timeMax') ?? ''), q = lower(query.get('q'));
      const items = this.events.filter(e => (e.calendarId || this.primary().id) === calendar.id && overlaps(e, from, to, this.offset) && (!q || lower(`${e.summary}\n${e.description}`).includes(q)))
        .sort((a, b) => instant(a.start.dateTime || a.start.date, this.offset) - instant(b.start.dateTime || b.start.date, this.offset));
      return json({ timeZone: calendar.timeZone, items: items.map(e => ({ status: 'confirmed', ...e, htmlLink: `https://calendar.google.com/calendar/event?eid=${e.id}` })) });
    }
    if (method === 'POST' && path === '/freeBusy') {
      const freeBusyBody = body as { timeMin: string; timeMax: string; items: Array<{ id: string }> };
      const from = Date.parse(freeBusyBody.timeMin), to = Date.parse(freeBusyBody.timeMax);
      return json({ calendars: Object.fromEntries(freeBusyBody.items.map(({ id }) => {
        const calendar = id === 'primary' ? this.primary() : this.calendars.find(c => c.id === id);
        if (!calendar) return [id, { errors: [{ reason: 'notFound' }] }];
        const busy = this.events.filter(e => (e.calendarId || this.primary().id) === calendar.id && e.transparency !== 'transparent' && overlaps(e, from, to, this.offset))
          .map(e => ({ start: new Date(instant(e.start.dateTime || e.start.date, this.offset)).toISOString(), end: new Date(instant(e.end.dateTime || e.end.date, this.offset)).toISOString() }));
        return [id, { busy }];
      })) });
    }
    const singleEvent = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/);
    if (singleEvent && method === 'GET') {
      const calId = decodeURIComponent(singleEvent[1]), eventId = decodeURIComponent(singleEvent[2]);
      const calendar = calId === 'primary' ? this.primary() : this.calendars.find(c => c.id === calId);
      if (!calendar) return missing();
      const found = this.events.find(e => (e.calendarId || this.primary().id) === calendar.id && e.id === eventId && e.status !== 'cancelled');
      return found ? json({ status: 'confirmed', ...found, htmlLink: `https://calendar.google.com/calendar/event?eid=${found.id}` }) : missing();
    }
    if (method === 'POST' && path === '/calendars/primary/events') {
      const event = { ...(body as FakeGoogleEvent), calendarId: this.primary().id, status: 'confirmed' };
      this.events.push(event); this.created.events.push(event);
      return json({ ...event, htmlLink: `https://calendar.google.com/calendar/event?eid=${event.id}` });
    }
    return missing();
  }
  gmail(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | undefined): Response {
    if (method === 'GET' && path === '/profile') return json({ emailAddress: this.world.gmail?.email || 'you@example.com' });
    if (method === 'GET' && path === '/messages') {
      const found = this.messages.filter(m => gmailMatches(m, query.get('q'), this.now)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return json({ messages: found.slice(0, Number(query.get('maxResults')) || 10).map(m => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: found.length });
    }
    const message = path.match(/^\/messages\/([a-z0-9]+)$/i);
    if (method === 'GET' && message) { const found = this.messages.find(m => m.id === message[1]); return found ? json(mime(found)) : missing(); }
    const thread = path.match(/^\/threads\/([a-z0-9]+)$/i);
    if (method === 'GET' && thread) {
      const found = this.messages.filter(m => m.threadId === thread[1]);
      return found.length ? json({ id: thread[1], messages: found.map(mime) }) : missing();
    }
    if (method === 'GET' && path === '/drafts') {
      return json({ drafts: this.created.drafts.map(d => ({ id: d.id, message: { id: `${d.id}m`, threadId: d.threadId } })) });
    }
    const singleDraft = path.match(/^\/drafts\/([a-z0-9_-]+)$/i);
    if (method === 'GET' && singleDraft) {
      const found = this.created.drafts.find(d => d.id === singleDraft[1]);
      if (!found) return missing();
      return json({
        id: found.id,
        message: {
          id: `${found.id}m`,
          threadId: found.threadId,
          payload: {
            mimeType: 'text/plain',
            headers: [{ name: 'To', value: found.to || '' }, { name: 'Subject', value: found.subject || '' }],
            body: { data: Buffer.from(found.body || '').toString('base64url') },
          },
        },
      });
    }
    if (method === 'POST' && path === '/drafts') {
      const draftBody = body as { message: { threadId?: string; raw: string } };
      const draft: FakeGmailDraft = { id: `draft${this.created.drafts.length + 1}`, threadId: draftBody.message.threadId, ...readDraft(draftBody.message.raw) };
      this.created.drafts.push(draft);
      return json({ id: draft.id, message: { id: `${draft.id}m`, threadId: draft.threadId } });
    }
    return missing();
  }
  drive(method: string, path: string, query: URLSearchParams): Response {
    if (method !== 'GET') return missing();
    if (path === '/files') {
      const found = this.files.filter(f => driveMatches(f, query.get('q') || '')).sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
      return json({ files: found.slice(0, Number(query.get('pageSize')) || 10).map(driveView) });
    }
    const [, id, rest = ''] = path.match(/^\/files\/([\w-]+)(\/export)?$/) || [];
    const file = this.files.find(f => f.id === id);
    if (!file) return missing();
    if (rest || query.get('alt') === 'media') return text(file.content || '');
    return json({ ...driveView(file), description: file.description || '' });
  }
  upload(body: unknown): Response {
    const parts = String(body).split(/\r\n--[^\r\n]+(?:--)?(?:\r\n|$)/).filter(Boolean);
    const metadata = JSON.parse(parts[0].split('\r\n\r\n').slice(1).join('\r\n\r\n')) as { name: string; mimeType: string };
    const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const file: FakeDriveFile = { id: `created${this.created.files.length + 1}`, name: metadata.name, mimeType: metadata.mimeType, modifiedTime: new Date(this.now).toISOString(), content };
    this.files.push(file); this.created.files.push(file);
    return json(driveView(file));
  }
  // Fairy's own connections, signed in with a fake token whose scopes say what the world allows.
  async connections(): Promise<FakeGoogleConnections> {
    const signedIn = (read: string[], write: string, allowed: boolean) => async (): Promise<GoogleConnectionStoredValue> => ({
      client: { clientId: 'eval', clientSecret: '' },
      tokens: { accessToken: 'eval', refreshToken: 'eval', scope: [...read, ...(allowed ? [write] : [])].join(' '), expiresAt: Date.now() + 86400000 },
    });
    const options = { write: async () => {}, openExternal: () => {}, fetchImpl: this.fetch as typeof fetch };
    const calendar = new CalendarConnection({ ...options, read: signedIn(READ_SCOPES, WRITE_SCOPE, this.world.calendar?.canCreate !== false) });
    const gmail = new GmailConnection({ ...options, read: signedIn(GMAIL_READ_SCOPES, GMAIL_DRAFT_SCOPE, this.world.gmail?.canDraft !== false) });
    const drive = new DriveConnection({ ...options, read: signedIn(DRIVE_READ_SCOPES, DRIVE_WRITE_SCOPE, this.world.drive?.canCreate !== false) });
    await Promise.all([calendar.load(), gmail.load(), drive.load()]);
    return { calendar, gmail, drive };
  }
}
