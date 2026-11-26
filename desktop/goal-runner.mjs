// When a goal's step may start on its own (docs/goals-board-plan.md, stage 4). Pure: the goal, the time and the plan
// bars are passed in. Only goals set to On its own; decisions (19 Nov): 3 steps a day unless the goal says otherwise,
// started after a good step, when a watcher it waits on fires, or at a time each day (each a tick on the goal), and
// overnight too, within the steps a day and while the work provider's bars are under 85%, as Research's rounds are.
export const START_BELOW = 0.85;
export const TRIGGERS = Object.freeze(['afterStep', 'onEvent', 'daily']);

const pad = number => String(number).padStart(2, '0');
// The local day of a time, as YYYY-MM-DD, and its HH:MM.
export const dayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const clockOf = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// The steps a goal started today, its own and Continue's alike.
export function stepsToday(goal, now = new Date()) {
  const today = dayOf(now);
  return goal.steps.filter(step => step.startedAt && dayOf(new Date(step.startedAt)) === today).length;
}

// How full the work provider's bars are, from usageFrom's shape: its plan's own bar, or the fullest of its models'.
export function fullness(usage = {}, provider = 'claude') {
  const bars = usage[provider];
  if (bars == null) return 0;
  if (typeof bars === 'number') return bars;
  return Math.max(bars.all ?? 0, ...Object.values(bars.models || {}).map(Number).filter(Number.isFinite));
}

// Whether a step may start on its own now: { ok } or { ok: false, wait: 'state' | 'budget' | 'bars', why }.
export function ownStart(goal, { now = new Date(), usage = {}, provider = 'claude' } = {}) {
  if (goal.plan?.status === 'pending') return { ok: false, wait: 'state', why: `${goal.id}’s reproduction plan is waiting for your OK.` };
  if (goal.moves !== 'own') return { ok: false, wait: 'state', why: `${goal.id} asks first.` };
  if (goal.state !== 'active') return { ok: false, wait: 'state', why: `${goal.id} isn’t active.` };
  if (!goal.folder) return { ok: false, wait: 'state', why: `${goal.id} has no folder.` };
  if (goal.steps.some(step => step.state === 'doing')) return { ok: false, wait: 'state', why: 'A step is running.' };
  const today = stepsToday(goal, now), budget = goal.budget?.steps ?? 3;
  if (today >= budget) return { ok: false, wait: 'budget', why: `${today} of ${budget} steps today; it goes on tomorrow.` };
  const full = fullness(usage, provider);
  if (full >= START_BELOW) return { ok: false, wait: 'bars', why: `Your plan is ${Math.round(full * 100)}% used; it goes on once it’s under ${Math.round(START_BELOW * 100)}%.` };
  return { ok: true };
}

// Whether a goal's daily time has come and it hasn't started then today.
export function dailyDue(goal, now = new Date()) {
  const at = goal.triggers?.daily;
  if (!at || goal.moves !== 'own') return false;
  return clockOf(now) >= at && goal.lastDaily !== dayOf(now);
}
