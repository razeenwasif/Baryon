// Plain-language times for the Today panel, in the Mac's own time zone.
const time = date => date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?$/i, ' $1m');
const startOfDay = date => { const day = new Date(date); day.setHours(0, 0, 0, 0); return day; };
const daysApart = (date, now) => Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
function dayName(date, now) {
  const apart = daysApart(date, now);
  return apart === 0 ? 'Today' : apart === 1 ? 'Tomorrow' : date.toLocaleDateString('en-AU', { weekday: 'long' });
}
// All-day events come as dates, which mean midnight where you are, not in UTC.
const parse = (value, allDay) => new Date(allDay && /^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T00:00:00` : value);

// Events still to come or happening now, timed ones in order, then all-day ones.
export function upcomingEvents(events = [], now = new Date()) {
  return (Array.isArray(events) ? events : []).filter(event => event?.start && event.title)
    .map(event => { const startAt = parse(event.start, event.allDay); return { ...event, startAt, endAt: event.end ? parse(event.end, event.allDay) : startAt }; })
    .filter(event => !Number.isNaN(event.startAt.getTime()) && (event.endAt > now || (!event.allDay && event.startAt >= now)))
    .sort((a, b) => Number(Boolean(a.allDay)) - Number(Boolean(b.allDay)) || a.startAt - b.startAt);
}

export function whenLabel(event, now = new Date()) {
  if (event.allDay) return event.startAt <= now ? 'All day' : `${dayName(event.startAt, now)} · all day`;
  if (event.startAt <= now) return `Now · until ${time(event.endAt)}`;
  const minutes = Math.max(1, Math.round((event.startAt - now) / 60000));
  if (minutes < 60) return `In ${minutes} min`;
  return daysApart(event.startAt, now) === 0 ? time(event.startAt) : `${dayName(event.startAt, now)} ${time(event.startAt)}`;
}

// The next time any enabled routine will run, within a week.
export function nextRoutine(schedules = [], now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let next = null;
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    if (!schedule?.enabled || !/^\d\d:\d\d$/.test(schedule.time || '') || !Array.isArray(schedule.days)) continue;
    for (let ahead = 0; ahead <= 7; ahead++) {
      const at = new Date(now); at.setDate(at.getDate() + ahead); at.setHours(Number(schedule.time.slice(0, 2)), Number(schedule.time.slice(3)), 0, 0);
      if (!schedule.days.includes(at.getDay()) || at <= now || (ahead === 0 && schedule.lastRun === today)) continue;
      if (!next || at < next.at) next = { title: schedule.title || 'Routine', at };
      break;
    }
  }
  return next && { ...next, label: `${dayName(next.at, now)} at ${time(next.at)}` };
}

// Chats that are working or waiting for you, waiting ones first.
export function runningChats(sessions = {}) {
  const titles = new Map((sessions.sessions || []).map(session => [session.id, session.title]));
  return Object.entries(sessions.running || {}).filter(([, status]) => status)
    .map(([id, status]) => ({ id, title: titles.get(id) || 'A chat', waiting: status === 'waiting' }))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || a.title.localeCompare(b.title));
}

// Compact at-a-glance pills for Home, derived purely from Today state (max 3 items).
export function homeSummary({ data = null, sessions = {}, routines = [], now = new Date() } = {}) {
  const items = [];
  const chats = runningChats(sessions);
  const waiting = chats.filter(chat => chat.waiting);
  const working = chats.filter(chat => !chat.waiting);
  if (waiting.length) items.push({ kind: 'waiting', badge: waiting.length === 1 ? 'Needs OK' : `${waiting.length} waiting`, text: waiting[0].title, sessionId: waiting[0].id });
  if (working.length) items.push({ kind: 'working', badge: working.length === 1 ? 'Working' : `${working.length} working`, text: working[0].title, sessionId: working[0].id });

  const calOk = Boolean(data?.calendar?.connected && !data.calendar.error);
  const upcoming = calOk ? upcomingEvents(data.calendar.events, now) : [];
  if (upcoming.length && items.length < 3) {
    const next = upcoming[0];
    items.push({ kind: 'event', badge: whenLabel(next, now), text: next.title, url: next.url || '' });
  }

  const emailOk = Boolean(data?.email?.connected && !data.email.error && typeof data.email.unread === 'number');
  if (emailOk && data.email.unread > 0 && items.length < 3) {
    items.push({ kind: 'email', badge: String(data.email.unread), text: data.email.unread === 1 ? 'unread email' : 'unread emails' });
  }

  if (items.length < 3) {
    const routine = nextRoutine(routines, now);
    if (routine) items.push({ kind: 'routine', badge: routine.label, text: routine.title });
  }

  if (!items.length && (calOk || emailOk)) {
    items.push({ kind: 'clear', badge: 'Today', text: calOk && emailOk ? 'Calendar & inbox clear' : calOk ? 'Calendar clear' : 'Inbox clear' });
  }
  return items.slice(0, 3);
}
