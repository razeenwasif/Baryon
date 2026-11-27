// Token use, step 9: rules before models. A few requests are answered by code when they match plainly, with no model
// call: a timer or an alarm ("set a timer for 10 minutes", "wake me at 6:30"), stopping them, a reminder with a plain
// time ("remind me in 20 minutes to call Sam", "remind me tomorrow at 9 to email Jo"), and what's next on your calendar
// ("what's next?", "what do I have tomorrow?"). Anything these don't read for certain goes to the model as before.
// The timer grammar is the iPhone's (ios/Fairy/TimerWords.swift), so the same words do the same thing on both.

const straight = text => String(text || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
const UNITS = { second: 1, seconds: 1, sec: 1, secs: 1, s: 1, minute: 60, minutes: 60, min: 60, mins: 60, m: 60, hour: 3600, hours: 3600, hr: 3600, hrs: 3600, h: 3600 };
const ONES = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, couple: 2, few: 3 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NOT_LABELS = new Set(['a', 'an', 'the', 'my', 'set', 'start', 'new', 'quick', 'another', 'one', 'fairy', 'please', 'for', 'am', 'pm']);
const LONGEST = 24 * 3600;
// "Hey Fairy, can you please …?": the words around a request that don't change it.
const POLITE = /^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:fairy[,!]?\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?/i;
const plain = text => straight(text).replace(POLITE, '').replace(/\s*(?:,?\s*please)?\s*[?.!]*\s*$/i, '').trim();

const words = text => text.split(/[^a-z0-9.]+/).map(word => word.replace(/^\.+|\.+$/g, '')).filter(Boolean);
const unitAhead = (list, start) => {
  for (const word of list.slice(start, start + 3)) { if (UNITS[word]) return true; if (!['a', 'an', 'of'].includes(word)) return false; }
  return false;
};

// A length of time in words: "10 minutes", "an hour and a half", "1h30m", "half an hour". Seconds, or null.
export function lengthIn(text) {
  const spaced = straight(text).toLowerCase().replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2'), list = words(spaced);
  let total = 0, number = null, lastUnit = 0, fraction = null, found = false;
  for (let index = 0; index < list.length; index++) {
    const word = list[index];
    if (/^\d+(?:\.\d+)?$/.test(word)) number = (number ?? 0) + Number(word);
    else if (TENS[word]) number = (number ?? 0) + TENS[word];
    else if ((word === 'a' || word === 'an') && fraction !== null) { /* "half an hour": the fraction already says how much. */ }
    else if (ONES[word] && (!(word === 'a' || word === 'an') || unitAhead(list, index + 1))) number = (number ?? 0) + ONES[word];
    else if (word === 'half' || word === 'quarter') {
      const share = word === 'half' ? 0.5 : 0.25;
      if (unitAhead(list, index + 1)) { fraction = share; number = null; } else if (lastUnit) { total += lastUnit * share; found = true; }
    } else if (UNITS[word]) {
      if (number === null && fraction === null) continue;
      total += (fraction ?? number ?? 1) * UNITS[word]; lastUnit = UNITS[word]; number = null; fraction = null; found = true;
    } else if (!['and', 'of', 'for', 'in', 'it', 'set', 'timer', 'timers', 'to'].includes(word)) number = null;
  }
  const seconds = Math.round(total);
  return found && seconds >= 1 && seconds <= LONGEST ? seconds : null;
}

// "7am", "6:30 pm", "at 7", "for 18:45", "noon": the next time that clock time comes round. Without am or pm, 7 means
// whichever of 7:00 and 19:00 is sooner. A number followed by a unit is a length, not a time.
export function clockIn(text, now = new Date(), { day = null } = {}) {
  const lower = straight(text).toLowerCase();
  let hour = -1, minute = 0, half = null;
  if (/\bnoon\b|\bmidday\b/.test(lower)) { hour = 12; half = 'pm'; }
  else if (/\bmidnight\b/.test(lower)) hour = 0;
  else {
    const pattern = /(?:\b(?:at|for)\s+)?\b(\d{1,2})(?!\d)(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\s*(?:minutes?|mins?|m\b|hours?|hrs?|h\b|seconds?|secs?|s\b))/g;
    for (const match of lower.matchAll(pattern)) {
      const digits = Number(match[1]), minutes = match[2] === undefined ? null : Number(match[2]), meridiem = match[3] ? match[3].replace(/\./g, '') : null;
      if (minutes === null && !meridiem && !/^(?:at|for)\b/.test(match[0])) continue;
      if (digits > 23 || (minutes ?? 0) > 59 || (meridiem && (digits < 1 || digits > 12))) continue;
      hour = digits; minute = minutes ?? 0; half = meridiem; break;
    }
  }
  if (hour < 0) return null;
  const candidates = half ? [hour % 12 + (half === 'pm' ? 12 : 0)] : hour >= 13 || hour === 0 ? [hour] : [hour % 12, hour % 12 + 12];
  const times = candidates.map(h => {
    const at = new Date(now); at.setHours(h, minute, 0, 0);
    if (day === 'tomorrow') at.setDate(at.getDate() + 1);
    else if (day !== 'today' && at <= now) at.setDate(at.getDate() + 1);
    return at;
  }).filter(at => at > now);
  return times.length ? new Date(Math.min(...times)) : null;
}

function timerLabel(list) {
  const spoken = list.filter(word => !/^\d/.test(word) && !UNITS[word] && !ONES[word] && !TENS[word] && !['half', 'quarter', 'and', 'hey', 'can', 'you', 'could', 'would', 'please', 'fairy'].includes(word));
  const at = list.findIndex(word => word === 'timer' || word === 'alarm');
  if (at > 0) { const before = list[at - 1]; if (!NOT_LABELS.has(before) && spoken.includes(before)) return before[0].toUpperCase() + before.slice(1); }
  const named = list.join(' ').match(/(?:called|named|labelled|labeled|for (?:the|my)) ([a-z][a-z ]{1,30})$/);
  if (!named) return null;
  const name = named[1].split(' ').filter(word => !['the', 'my'].includes(word) && spoken.includes(word)).join(' ');
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}

// A timer or an alarm asked for plainly: { kind, seconds, label, at }, or null.
export function timerRequest(text, now = new Date()) {
  const lower = straight(text).toLowerCase(), timer = /\btimers?\b/.test(lower), alarm = /\balarms?\b|\bwake me\b/.test(lower);
  if (!(timer || alarm) || /\b(?:cancel|stop|delete|remove|turn off|snooze|how long|how much time|what's left|left on|what time|remind)\b/.test(lower)) return null;
  // A timer in something being built or explained ("add a 10 minute timer to the quiz page", "how do I write a timer
  // for 5 seconds") is a question for the model, not one to set.
  if (/\b(?:implement|write|code|coding|build|add|create|function|component|script|program|app|page|game|countdown|javascript|python|react|swift|how (?:do|can|would|to|does))\b/.test(lower)) return null;
  const list = words(lower);
  if (alarm && !timer) {
    const at = clockIn(lower, now);
    if (at) return { kind: 'alarm', seconds: Math.max(1, Math.round((at - now) / 1000)), label: timerLabel(list), at, clock: true };
  }
  const seconds = lengthIn(lower);
  return seconds ? { kind: timer ? 'timer' : 'alarm', seconds, label: timerLabel(list), at: new Date(now.getTime() + seconds * 1000) } : null;
}

// "Cancel the timer", "stop my alarms", "turn off the timer".
export const stopTimersRequest = text => /^(?:cancel|stop|turn off|clear|delete|remove)\s+(?:the\s+|my\s+|all\s+(?:of\s+)?(?:the\s+|my\s+)?)?(?:timers?|alarms?)(?:\s+(?:too|now))?$/i.test(plain(text));

// A reminder with a plain time: "remind me in 20 minutes to call Sam", "remind me to call Sam at 3pm", "remind me
// tomorrow at 9 to email Jo". { what, at }, or null for anything else (a date, a part of the day, no time), which goes
// to the model as before.
export function reminderRequest(text, now = new Date()) {
  const said = plain(text), match = said.match(/^remind me\s+(.+)$/i);
  if (!match) return null;
  let rest = match[1], at = null, when = null;
  const length = /\bin\s+((?:(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|half|quarter|couple|few|and|of|\d+(?:\.\d+)?)\s*)+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)(?:\s+and\s+(?:a\s+)?(?:half|quarter|\d+\s*(?:minutes?|mins?|seconds?|secs?)))?)\b/i.exec(rest);
  const clock = /\b(?:(today|tonight|tomorrow)\s+)?at\s+(\d{1,2}(?:[:.]\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?|noon|midday|midnight)(?:\s+(today|tonight|tomorrow))?/i.exec(rest);
  if (length && !clock) { const seconds = lengthIn(length[1]); if (seconds) { at = new Date(now.getTime() + seconds * 1000); when = length[0]; } }
  else if (clock && !length) {
    const day = (clock[1] || clock[3] || '').toLowerCase(), time = /^\d{1,2}$/.test(clock[2]) && day === 'tonight' ? `${clock[2]}pm` : clock[2];
    at = clockIn(`at ${time}`, now, { day: day === 'tomorrow' ? 'tomorrow' : day ? 'today' : null }); when = clock[0];
  }
  if (!at || at - now > 366 * 86400_000) return null;
  rest = rest.replace(when, ' ').replace(/\s+/g, ' ').trim();
  const said2 = rest.match(/^(to|that|about)\s+(.+)$/i), what = said2?.[2]?.trim();
  if (!what || what.length < 3 || what.length > 120 || /\b(?:remind|every|each|daily|weekly|tomorrow|today|tonight|on|at|in|before|after|by)$/i.test(what) || /\b(?:every|each)\s+(?:day|week|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(what)) return null;
  return { what: what[0].toUpperCase() + what.slice(1), at, word: said2[1].toLowerCase() };
}

// What's next on the calendar, asked plainly: { day: 'next' | 'today' | 'tomorrow' }, or null.
export function agendaRequest(text) {
  const said = plain(text).toLowerCase();
  if (/^(?:what'?s|what is)\s+next(?:\s+(?:today|on my (?:calendar|schedule)))?$|^(?:when'?s|when is|what'?s|what is)\s+my\s+next\s+(?:meeting|event|appointment|thing)$/.test(said)) return { day: 'next' };
  const day = said.match(/^(?:what'?s|what is)\s+on\s+(?:my\s+(?:calendar|schedule)\s+)?(today|tomorrow)$|^(?:what\s+(?:do i have|have i got|am i doing)|what'?s my (?:day|schedule|calendar|agenda) (?:like|look like)?|what does my (?:day|calendar|schedule) look like)\s*(today|tomorrow)?$|^(?:my\s+)?(?:calendar|schedule|agenda)\s+(?:for\s+)?(today|tomorrow)$/);
  if (!day) return null;
  return { day: day[1] || day[2] || day[3] || 'today' };
}

const clock12 = date => `${date.getHours() % 12 || 12}${date.getMinutes() ? `:${String(date.getMinutes()).padStart(2, '0')}` : ''} ${date.getHours() < 12 ? 'am' : 'pm'}`;
export function dayWords(date, now = new Date()) {
  const start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()), days = Math.round((start(date) - start(now)) / 86400_000);
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
export const atWords = (date, now = new Date()) => `${dayWords(date, now)} at ${clock12(date)}`;
// "1 hour and 30 minutes".
export function spokenLength(seconds) {
  const parts = [[Math.floor(seconds / 3600), 'hour'], [Math.floor(seconds % 3600 / 60), 'minute'], [seconds % 60, 'second']].filter(([n]) => n > 0).map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`);
  return parts.length <= 1 ? parts[0] || '0 seconds' : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
const inWords = (from, to) => { const minutes = Math.round((to - from) / 60000); return minutes < 1 ? 'now' : minutes < 60 ? `in ${minutes} minute${minutes === 1 ? '' : 's'}` : `in ${spokenLength(Math.round(minutes / 60) * 3600 + (minutes >= 180 ? 0 : (minutes % 60) * 60))}`; };

// The calendar's events for the question, as Fairy says them. Events are { title, start, end, allDay }.
export function agendaReply(events, { day }, now = new Date()) {
  const when = event => new Date(event.allDay ? `${event.start}T00:00` : event.start), until = event => new Date(event.allDay ? `${event.end}T00:00` : event.end);
  const startOf = offset => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset); return d; };
  const list = events.filter(event => event?.start).sort((a, b) => when(a) - when(b));
  const name = event => String(event.title || '(Untitled event)').replace(/\s+/g, ' ').slice(0, 120);
  if (day === 'next') {
    const next = list.find(event => !event.allDay && when(event) > now);
    if (!next) return 'Nothing else on your calendar in the next week.';
    return `Next: ${name(next)}, ${atWords(when(next), now)} (${inWords(now, when(next))}).`;
  }
  const from = day === 'tomorrow' ? startOf(1) : startOf(0), to = day === 'tomorrow' ? startOf(2) : startOf(1);
  const shown = list.filter(event => until(event) > (day === 'today' ? now : from) && when(event) < to);
  if (!shown.length) return day === 'today' ? 'Nothing else on your calendar today.' : 'Nothing on your calendar tomorrow.';
  const lines = shown.slice(0, 8).map(event => event.allDay ? `all day: ${name(event)}` : `${clock12(when(event))}${when(event) < now ? ' (on now)' : ''}: ${name(event)}${event.end ? `, until ${clock12(until(event))}` : ''}`);
  return `${day === 'today' ? 'Still today' : 'Tomorrow'}:\n${lines.map(line => `- ${line}`).join('\n')}${shown.length > 8 ? `\n- and ${shown.length - 8} more` : ''}`;
}

// Timers and alarms on the Mac. Kept in a file so they survive a restart; one whose time passed while Fairy was closed
// goes off as soon as she starts, saying when it was due.
export class MacTimers {
  constructor({ read, write, ring, now = () => new Date(), id = () => Math.random().toString(36).slice(2, 10), schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { read, write, ring, now, makeId: id, schedule, unschedule });
    this.items = []; this.handles = new Map();
  }
  async load() {
    const saved = await this.read().catch(() => null);
    this.items = (Array.isArray(saved?.items) ? saved.items : []).filter(item => item?.id && Number.isFinite(Date.parse(item.at))).slice(0, 50);
    for (const item of this.items) this.arm(item);
  }
  save() { return this.write({ items: this.items }); }
  arm(item) {
    // setTimeout holds at most about 24.8 days; timers and alarms here are at most a day off.
    const handle = this.schedule(() => { void this.fire(item.id); }, Math.max(0, Date.parse(item.at) - this.now()));
    handle?.unref?.(); this.handles.set(item.id, handle);
  }
  async add({ kind, seconds, label = null, at }) {
    const item = { id: this.makeId(), kind, seconds, label, at: at.toISOString(), set: this.now().toISOString() };
    this.items.push(item); this.arm(item); await this.save();
    return item;
  }
  async fire(id) {
    const item = this.items.find(entry => entry.id === id);
    if (!item) return;
    this.items = this.items.filter(entry => entry.id !== id); this.handles.delete(id);
    await this.save();
    const late = this.now() - Date.parse(item.at) > 60_000;
    await this.ring(item, { late });
  }
  async stop() {
    const stopped = this.items.length;
    for (const handle of this.handles.values()) this.unschedule(handle);
    this.items = []; this.handles.clear(); await this.save();
    return stopped;
  }
}

// What a timer says when it goes off.
export function ringText(item, { late = false } = {}, now = new Date()) {
  const what = item.label ? `${item.label} ${item.kind}` : item.kind === 'alarm' ? 'Alarm' : 'Timer';
  const title = item.kind === 'alarm' ? `${what[0].toUpperCase()}${what.slice(1)}` : `${what[0].toUpperCase()}${what.slice(1)} done`;
  const body = late ? `It was set for ${atWords(new Date(item.at), now)}, while Fairy was closed or asleep.` : item.kind === 'alarm' ? `It's ${clock12(new Date(item.at))}.` : `${spokenLength(item.seconds)}, done.`;
  return { title, body };
}

// The rules, in order. Each returns { kind, text } when it answered, or null to leave the request to the model.
// timers: a MacTimers; remind(item): sets a reminder like one the model picked out; events(range): calendar events, or
// null when no calendar is connected.
export async function answerByRule(text, { timers = null, remind = null, events = null, now = new Date() } = {}) {
  if (typeof text !== 'string' || text.length > 300) return null;
  if (timers && stopTimersRequest(text)) {
    const stopped = await timers.stop();
    return { kind: 'timer-stop', text: stopped ? `Stopped ${stopped === 1 ? 'your timer' : `all ${stopped} timers and alarms`}.` : 'There’s no timer or alarm running.' };
  }
  const timer = timers && timerRequest(text, now);
  if (timer) {
    await timers.add(timer);
    const what = timer.label ? `${timer.label} ${timer.kind}` : `${timer.kind[0].toUpperCase()}${timer.kind.slice(1)}`;
    return { kind: timer.kind, text: timer.clock ? `${what} set for ${atWords(timer.at, now)}.` : `${what} set for ${spokenLength(timer.seconds)}, until ${clock12(timer.at)}.` };
  }
  const reminder = remind && reminderRequest(text, now);
  if (reminder) {
    await remind({ what: reminder.what, at: reminder.at, said: straight(text).trim().slice(0, 200) });
    const what = /^[A-Z][a-z]/.test(reminder.what) ? reminder.what[0].toLowerCase() + reminder.what.slice(1) : reminder.what;
    return { kind: 'reminder', text: `I’ll remind you ${reminder.word} ${what} ${atWords(reminder.at, now)}.` };
  }
  const agenda = events && agendaRequest(text);
  if (agenda) {
    const day = offset => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const [from, to] = { next: [day(0), day(8)], today: [day(0), day(1)], tomorrow: [day(1), day(2)] }[agenda.day];
    const found = await events({ timeMin: from.toISOString(), timeMax: to.toISOString() });
    if (!found) return null;
    return { kind: 'agenda', text: agendaReply(found, agenda, now) };
  }
  return null;
}
