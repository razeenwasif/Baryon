// Your week, for the phone's week dashboard: this week's calendar day by day, what's coming that has a date to count
// down to, and how much unread mail is waiting. Calendar titles and an unread count only; nothing goes to a model.
const DAY = 86400000;
// What reads like something to count down to.
const COUNTDOWN = /\b(exam|final|midterm|quiz|test|due|deadline|submit|submission|assignment|report|launch|release|interview|presentation|defen[cs]e|trip|flight|wedding|birthday)\b/i;

const pad = number => String(number).padStart(2, '0');
// A date on the Mac's own calendar, as YYYY-MM-DD.
export const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Monday at midnight, of the week holding this date.
export function weekStart(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
const startOf = event => event.allDay ? new Date(`${event.start}T00:00:00`) : new Date(event.start);

// The shape the phone draws, from the raw pieces.
// promises: what you said you'd do, still open (promises.mjs view().open).
export function weekView({ now = new Date(), week = [], ahead = [], unread = null, calendar = {}, email = {}, promises = [] }) {
  const start = weekStart(now), days = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    days.push({ date: dayKey(date), events: [] });
  }
  for (const event of week) {
    const key = event.allDay ? String(event.start).slice(0, 10) : dayKey(new Date(event.start));
    days.find(day => day.date === key)?.events.push({ title: event.title, start: event.start, end: event.end, allDay: Boolean(event.allDay) });
  }
  const timed = week.filter(event => !event.allDay);
  const left = timed.filter(event => new Date(event.end || event.start) > now).length;
  // The countdown: the soonest thing that reads like a deadline, from tomorrow on; else nothing.
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = ahead.filter(event => COUNTDOWN.test(event.title) && startOf(event) >= tomorrow).sort((a, b) => startOf(a) - startOf(b))[0];
  const countdown = target ? { title: target.title, date: target.allDay ? target.start : target.start, allDay: Boolean(target.allDay),
    days: Math.max(1, Math.round((new Date(startOf(target)).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY)) } : null;
  return {
    updated: now.toISOString(), start: days[0].date, end: days[6].date, days,
    meetings: { week: timed.length, left },
    unread, countdown, promises,
    sources: { calendar: { connected: Boolean(calendar.connected), error: calendar.error || '', off: Boolean(calendar.off) },
               email: { connected: Boolean(email.connected), error: email.error || '', off: Boolean(email.off) } },
  };
}

// Compact goal card for the iPhone Week dashboard (goals-board-plan stage 3; reproduce-plan stage 6).
export function weekGoalCard(goal, comparison = null) {
  const done = Array.isArray(goal.steps) ? goal.steps.filter(step => step.state === 'done').length : (Number(goal.done) || 0);
  const steps = Array.isArray(goal.steps) ? goal.steps.length : (Number(goal.steps) || 0);
  const running = Array.isArray(goal.steps) ? goal.steps.some(step => step.state === 'doing') : Boolean(goal.running);
  const next = Array.isArray(goal.steps) ? (goal.steps.find(step => step.state === 'todo')?.what || '') : (goal.next || '');
  let repro = null;
  if (goal.paper) {
    const counts = comparison?.counts || { reproduced: 0, total: (goal.claims || []).filter(c => c.picked).length, notReproduced: 0, couldntRun: 0 };
    const summary = counts.total > 0
      ? `${counts.reproduced}/${counts.total} claims reproduced${counts.notReproduced ? ` · ${counts.notReproduced} missed` : ''}${counts.couldntRun ? ` · ${counts.couldntRun} couldn’t run` : ''}`
      : 'Claims not picked yet';
    repro = {
      arxiv: `${goal.paper.id}${goal.paper.version || ''}`,
      reproduced: counts.reproduced,
      total: counts.total,
      notReproduced: counts.notReproduced || 0,
      couldntRun: counts.couldntRun || 0,
      hasReport: Boolean(goal.report?.compiled),
      summary,
    };
  }
  return {
    id: goal.id,
    outcome: goal.outcome,
    state: goal.state,
    ...(goal.reason ? { reason: goal.reason } : {}),
    next,
    running,
    done,
    steps,
    ...(repro ? { repro } : {}),
  };
}

// Gathers it from Google through the Mac's connections, at most every five minutes unless asked to refresh.
// Promises are read fresh every time, so one ticked off shows as done straight away.
// goals(): the goals Fairy is working towards that are still open (goals.mjs, stage 3), read fresh like promises.
export function weekSource({ calendar, gmail, allowed = () => true, promises = () => [], goals = async () => [], now = () => new Date(), every = 5 * 60 * 1000 }) {
  let cached = null;
  const fresh = () => { try { return promises(); } catch { return []; } };
  const working = async () => { try { return (await goals()).slice(0, 5); } catch { return []; } };
  return async ({ force = false } = {}) => {
    if (!force && cached && Date.now() - cached.at < every) return { ...cached.view, promises: fresh(), goals: await working() };
    const at = now(), signal = AbortSignal.timeout(15000), off = !allowed();
    // Not connected, with the reason when there is one: a sign-in Google refused is dropped and leaves a message saying so.
    const source = connection => { const status = connection.status(); return { connected: !off && status.connected, off, error: !off && !status.connected && status.error ? String(status.error) : '' }; };
    const sources = { calendar: source(calendar), email: source(gmail) };
    let week = [], ahead = [], unread = null;
    if (sources.calendar.connected) {
      try {
        const start = weekStart(at), end = new Date(start.getTime() + 7 * DAY);
        week = (await calendar.events({ timeMin: start.toISOString(), timeMax: end.toISOString() }, signal)).events;
        // Calendar ranges are kept to a month, so the countdown looks four weeks ahead.
        ahead = (await calendar.events({ timeMin: at.toISOString(), timeMax: new Date(at.getTime() + 30 * DAY).toISOString() }, signal)).events;
      } catch (error) { console.warn('Week calendar skipped:', error.message); sources.calendar.error = 'Couldn’t reach Google Calendar just now.'; }
    }
    if (sources.email.connected) {
      try { unread = await gmail.unreadEstimate(signal); } catch (error) { console.warn('Week email skipped:', error.message); sources.email.error = 'Couldn’t reach Gmail just now.'; }
    }
    const view = weekView({ now: at, week, ahead, unread, ...sources, promises: fresh() });
    cached = { at: Date.now(), view };
    return { ...view, goals: await working() };
  };
}
