// What's coming up on its own, for the phone's Up next: the morning brief, check-ins and your schedules, each with when
// it next runs. Titles and times only.
const DAY = 86400000;
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface CheckInsBriefConfig {
  enabled?: boolean;
  time: string;
}

export interface CheckInsIntervalConfig {
  enabled?: boolean;
  everyHours: number;
  quietFrom: string;
  quietTo: string;
}

export interface CheckInsState {
  brief?: CheckInsBriefConfig;
  lastBrief?: string;
  checkIns?: CheckInsIntervalConfig;
  lastCheck?: string;
}

export interface ScheduleRoutine {
  id: string;
  enabled?: boolean;
  days: number[];
  time: string;
  title: string;
  lastRun?: string;
}

export interface ScheduledEntry {
  id: string;
  kind: 'brief' | 'check-in' | 'routine';
  title: string;
  every: string;
  next: string | null;
}

const at = (date: Date, time: string): Date => { const next = new Date(date); next.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0); return next; };
const clock = (time: string): string => { const hour = Number(time.slice(0, 2)), minute = time.slice(3); return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`; };

// Which days, said the way you'd say them.
export function daysWords(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  return set.map(day => NAMES[day].slice(0, 3)).join(', ');
}

// The next time on one of these days, from now on (today counts if the time is still to come and it hasn't run today).
export function nextOn(days: number[], time: string, now: Date, ranToday = false): Date | null {
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const day = new Date(now.getTime() + ahead * DAY), when = at(day, time);
    if (days.includes(day.getDay()) && when > now && !(ahead === 0 && ranToday)) return when;
  }
  return null;
}

const inQuiet = (date: Date, from: string, to: string): boolean => {
  const minutes = date.getHours() * 60 + date.getMinutes(), f = Number(from.slice(0, 2)) * 60 + Number(from.slice(3)), t = Number(to.slice(0, 2)) * 60 + Number(to.slice(3));
  return f <= t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
};

export function scheduledFor({ checkIns, schedules = [], now = new Date() }: { checkIns?: CheckInsState | null; schedules?: ScheduleRoutine[]; now?: Date }): ScheduledEntry[] {
  const list: ScheduledEntry[] = [], today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (checkIns?.brief?.enabled) {
    const next = nextOn([0, 1, 2, 3, 4, 5, 6], checkIns.brief.time, now, checkIns.lastBrief === today);
    list.push({ id: 'brief', kind: 'brief', title: 'Morning brief', every: `Every day at ${clock(checkIns.brief.time)}`, next: next?.toISOString() ?? null });
  }
  if (checkIns?.checkIns?.enabled) {
    const { everyHours, quietFrom, quietTo } = checkIns.checkIns, last = Date.parse(checkIns.lastCheck || '');
    let next = new Date(Number.isFinite(last) ? Math.max(now.getTime(), last + everyHours * 3600000) : now.getTime());
    // Not in quiet hours: it waits for them to end.
    if (inQuiet(next, quietFrom, quietTo)) { next = at(next, quietTo); if (next < now) next = new Date(next.getTime() + DAY); }
    list.push({ id: 'check-in', kind: 'check-in', title: 'Check-in', every: `Every ${everyHours} ${everyHours === 1 ? 'hour' : 'hours'}, quiet ${clock(quietFrom)}–${clock(quietTo)}`, next: next.toISOString() });
  }
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const next = nextOn(schedule.days, schedule.time, now, schedule.lastRun === today);
    list.push({ id: schedule.id, kind: 'routine', title: schedule.title, every: `${daysWords(schedule.days)} at ${clock(schedule.time)}`, next: next?.toISOString() ?? null });
  }
  return list.sort((a, b) => (a.next ?? '9') < (b.next ?? '9') ? -1 : 1).slice(0, 20);
}
