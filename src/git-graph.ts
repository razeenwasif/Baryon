// Lanes for the branch graph. Commits come children first, as git log --date-order gives them, each with its parents'
// ids. A lane holds the commit it's waiting for: a commit takes the lane waiting for it (or a free one, for a branch's
// tip), other lanes waiting for it join it there, its first parent carries on in its lane and any others take lanes of
// their own. Free lanes are reused, so a lane keeps its place, and its colour, for as long as it runs.

export interface GitGraphCommit {
  sha: string;
  parents?: string[];
}

export type LaneTopState = 'in' | 'pass' | null;

export interface GitGraphRow {
  col: number;
  top: LaneTopState[];
  down: boolean;
  forks: number[];
  bottom: boolean[];
  merge: boolean;
}

export interface GitGraphLanesResult {
  rows: GitGraphRow[];
  width: number;
}

export interface CalendarDayInput {
  date: string;
  count: number;
}

export type CalendarLevel = 0 | 1 | 2 | 3 | 4;

export interface CalendarCell {
  date: string;
  count: number;
  level: CalendarLevel;
}

export interface CalendarMonthMarker {
  week: number;
  month: number;
}

export interface CalendarWeeksOptions {
  today?: string;
  weeks?: number;
}

export interface CalendarWeeksResult {
  weeks: Array<Array<CalendarCell | null>>;
  months: CalendarMonthMarker[];
  cuts: [number, number, number];
}

export function graphLanes(commits: readonly GitGraphCommit[]): GitGraphLanesResult {
  const lanes: Array<string | null> = [];
  const rows: GitGraphRow[] = [];
  let width = 0;
  const free = (): number => { const at = lanes.indexOf(null); return at < 0 ? lanes.length : at; };
  for (const commit of commits) {
    const before = lanes.slice();
    let col = lanes.indexOf(commit.sha);
    if (col < 0) col = free();
    const top: LaneTopState[] = before.map(waiting => waiting == null ? null : waiting === commit.sha ? 'in' : 'pass');
    lanes.forEach((waiting, i) => { if (waiting === commit.sha && i !== col) lanes[i] = null; });
    const parents = commit.parents || [];
    lanes[col] = parents[0] ?? null;
    const forks: number[] = [];
    for (const parent of parents.slice(1)) {
      let at = lanes.indexOf(parent);
      if (at < 0) { at = free(); lanes[at] = parent; }
      forks.push(at);
    }
    while (lanes.length && lanes.at(-1) == null) lanes.pop();
    const bottom = lanes.map(waiting => waiting != null);
    rows.push({ col, top, down: parents.length > 0, forks, bottom, merge: parents.length > 1 });
    width = Math.max(width, top.length, bottom.length, col + 1);
  }
  return { rows, width };
}

// Day counts laid out as a calendar: whole weeks, Sunday first, ending with the week holding `today`, each day with a
// level from 0 (none) to 4 by where its count falls among the busy days. Days after today are left empty.
export function calendarWeeks(
  days: readonly CalendarDayInput[],
  { today = new Date().toISOString().slice(0, 10), weeks = 53 }: CalendarWeeksOptions = {},
): CalendarWeeksResult {
  const counts = new Map(days.map(day => [day.date, day.count]));
  const end = new Date(`${today}T00:00:00Z`), start = new Date(end);
  start.setUTCDate(end.getUTCDate() - end.getUTCDay() - 7 * (weeks - 1));
  // Only the days shown set the scale, so one busy day long ago doesn't wash the rest out.
  const first = start.toISOString().slice(0, 10);
  const busy = days.filter(day => day.date >= first && day.date <= today && day.count > 0).map(day => day.count).sort((a, b) => a - b);
  const at = (q: number): number => busy[Math.floor(q * (busy.length - 1))] ?? 0;
  const cuts: [number, number, number] = [at(0.25), at(0.5), at(0.75)];
  const level = (n: number): CalendarLevel => (n <= 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);
  const out: Array<Array<CalendarCell | null>> = [];
  const months: CalendarMonthMarker[] = [];
  for (let w = 0; w < weeks; w++) {
    const week: Array<CalendarCell | null> = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setUTCDate(start.getUTCDate() + w * 7 + d);
      const date = day.toISOString().slice(0, 10);
      if (date > today) { week.push(null); continue; }
      const count = counts.get(date) || 0;
      week.push({ date, count, level: level(count) });
      if (day.getUTCDate() === 1) months.push({ week: w, month: day.getUTCMonth() });
    }
    out.push(week);
  }
  return { weeks: out, months, cuts };
}
