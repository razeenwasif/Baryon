import { randomUUID } from 'node:crypto';
import { cleanWatcher, MAX_WATCHERS, type Watcher } from './watchers.mjs';

const text = (value: unknown, limit: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const CATCH_UP_MS = 3 * 60 * 60 * 1000;
export const HOOK_EVENTS = ['after-edit', 'after-turn'] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface AutomationHook {
  id: string;
  folder: string;
  event: HookEvent;
  command: string;
}

export interface AutomationSchedule {
  id: string;
  title: string;
  prompt: string;
  time: string;
  days: number[];
  enabled: boolean;
  lastRun: string;
}

export interface AutomationWatcherStateView {
  looked: string;
  fired: string;
  started: boolean;
  seen: number;
  error: string;
  paused: string;
  recentPapers?: Watcher['state']['recentPapers'];
}

export type AutomationWatcherView = Omit<Watcher, 'state'> & {
  state: AutomationWatcherStateView;
};

export interface AutomationPersistedData {
  version?: number;
  hooks: AutomationHook[];
  schedules: AutomationSchedule[];
  watchers: Watcher[];
}

export interface AutomationState {
  hooks: AutomationHook[];
  schedules: AutomationSchedule[];
  watchers: AutomationWatcherView[];
}

export interface AutomationStoreOptions {
  read: () => Promise<Partial<AutomationPersistedData> | null | undefined> | Partial<AutomationPersistedData> | null | undefined;
  write: (data: AutomationPersistedData) => Promise<unknown>;
  id?: () => string;
  now?: () => Date;
  checkWatch?: ((path: string) => Promise<string> | string) | null;
  checkFolder?: ((path: string) => Promise<string> | string) | null;
}

const cleanHook = (value: unknown): AutomationHook | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.folder === 'string' && typeof v.event === 'string' && (HOOK_EVENTS as readonly string[]).includes(v.event) && typeof v.command === 'string' && v.command.trim()
    ? { id: String(v.id).slice(0, 64), folder: v.folder, event: v.event as HookEvent, command: v.command.slice(0, 2000) }
    : null;
};

function cleanSchedule(value: unknown): AutomationSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const time = typeof v.time === 'string' ? v.time : '';
  if (!/^\d\d:\d\d$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59) return null;
  const days = (Array.isArray(v.days) ? v.days : []).filter((day): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6);
  if (!days.length || typeof v.prompt !== 'string' || !v.prompt.trim()) return null;
  return { id: String(v.id).slice(0, 64), title: text(v.title, 80) || text(v.prompt, 60), prompt: v.prompt.slice(0, 4000), time, days: [...new Set(days)].sort(), enabled: v.enabled !== false, lastRun: typeof v.lastRun === 'string' ? v.lastRun.slice(0, 10) : '' };
}
const dayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// The schedules due now. One missed while the Mac slept still runs if it's within a few hours; older ones wait for their next day.
export function dueSchedules(schedules: readonly AutomationSchedule[], now = new Date()): AutomationSchedule[] {
  return schedules.filter(schedule => {
    if (!schedule.enabled || schedule.lastRun === dayKey(now) || !schedule.days.includes(now.getDay())) return false;
    const at = new Date(now); at.setHours(Number(schedule.time.slice(0, 2)), Number(schedule.time.slice(3)), 0, 0);
    return now.getTime() >= at.getTime() && now.getTime() - at.getTime() <= CATCH_UP_MS;
  });
}
// Rules kept in Fairy's own data, never in a project, so an agent editing the project can't add one.
export class AutomationStore {
  read: AutomationStoreOptions['read'];
  write: AutomationStoreOptions['write'];
  id: () => string;
  now: () => Date;
  checkWatch: ((path: string) => Promise<string> | string) | null;
  checkFolder: ((path: string) => Promise<string> | string) | null;
  hooks: AutomationHook[];
  schedules: AutomationSchedule[];
  watchers: Watcher[];

  // checkWatch(path): where a file watcher may look (watchers.mjs' checkWatchPath, given Fairy's data folder).
  // checkFolder(path): where Work on it may work (work-sandbox.mjs' checkWorkFolder, given Fairy's data folder).
  constructor({ read, write, id = randomUUID, now = () => new Date(), checkWatch = null, checkFolder = null }: AutomationStoreOptions) {
    this.read = read;
    this.write = write;
    this.id = id;
    this.now = now;
    this.checkWatch = checkWatch;
    this.checkFolder = checkFolder;
    this.hooks = [];
    this.schedules = [];
    this.watchers = [];
  }
  async load(): Promise<void> {
    const saved = await this.read();
    this.hooks = (Array.isArray(saved?.hooks) ? saved.hooks : []).map(cleanHook).filter((h): h is AutomationHook => Boolean(h));
    this.schedules = (Array.isArray(saved?.schedules) ? saved.schedules : []).map(cleanSchedule).filter((s): s is AutomationSchedule => Boolean(s));
    this.watchers = (Array.isArray(saved?.watchers) ? saved.watchers : []).map(cleanWatcher).filter((w): w is Watcher => Boolean(w)).slice(0, MAX_WATCHERS);
  }
  save(): Promise<unknown> { return this.write({ version: 1, hooks: this.hooks, schedules: this.schedules, watchers: this.watchers }); }
  // What the window shows of a watcher: everything but the keys of what it has seen.
  state(): AutomationState { return { hooks: this.hooks, schedules: this.schedules, watchers: this.watchers.map(({ state: { seen, fires, ...state }, ...w }) => ({ ...w, state: { ...state, seen: seen.length } })) }; }
  hooksFor(folder: string, event: HookEvent | string): AutomationHook[] { return this.hooks.filter(hook => hook.folder === folder && hook.event === event); }
  async addHook(value: Record<string, unknown>): Promise<AutomationState> {
    const hook = cleanHook({ ...value, id: this.id() });
    if (!hook) throw new Error('A hook needs a folder, when to run and a command.');
    this.hooks.push(hook); await this.save(); return this.state();
  }
  async removeHook(id: string): Promise<AutomationState> { this.hooks = this.hooks.filter(hook => hook.id !== id); await this.save(); return this.state(); }
  async addSchedule(value: Record<string, unknown>): Promise<AutomationState> {
    const schedule = cleanSchedule({ ...value, id: this.id(), lastRun: '' });
    if (!schedule) throw new Error('A scheduled task needs a prompt, a time and at least one day.');
    this.schedules.push(schedule); await this.save(); return this.state();
  }
  async updateSchedule(id: string, value: unknown): Promise<AutomationState> {
    if (typeof id !== 'string' || !id) throw new Error('Choose a routine to update.');
    const index = this.schedules.findIndex(entry => entry.id === id);
    if (index < 0) throw new Error('That routine is gone.');
    const current = this.schedules[index];
    const patch = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const next = cleanSchedule({ ...current, ...patch, id: current.id, lastRun: current.lastRun });
    if (!next) throw new Error('A scheduled task needs a prompt, a time and at least one day.');
    this.schedules[index] = next;
    await this.save(); return this.state();
  }
  async removeSchedule(id: string): Promise<AutomationState> { this.schedules = this.schedules.filter(schedule => schedule.id !== id); await this.save(); return this.state(); }
  async markRun(id: string): Promise<void> { const schedule = this.schedules.find(entry => entry.id === id); if (schedule) { schedule.lastRun = dayKey(this.now()); await this.save(); } }
  due(): AutomationSchedule[] { return dueSchedules(this.schedules, this.now()); }
  // Watchers (docs/watchers-plan.md): what to watch and what to do; their state is the engine's.
  async addWatcher(value: Record<string, unknown>): Promise<AutomationState> {
    if (this.watchers.length >= MAX_WATCHERS) throw new Error(`That’s ${MAX_WATCHERS} watchers, the most Fairy keeps. Remove one first.`);
    const watcher = cleanWatcher({ ...value, id: this.id(), enabled: true, state: {} });
    if (!watcher) throw new Error('A watcher needs what to watch: for a check, a repository as owner/name and a branch or a pull request number if you name one; for reviews, a pull request number needs its repository; for a Nexus job, its id; for files, a full path; for papers, some words; to work on it, a folder given as a full path. It looks every 2 to 60 minutes (papers every 1 to 24 hours).');
    if (watcher.action === 'work') {
      if (!this.checkFolder) throw new Error('Fairy can’t start work from a watcher here.');
      watcher.folder = await this.checkFolder(watcher.folder);
    }
    if (watcher.event === 'file') {
      if (!this.checkWatch) throw new Error('Fairy can’t watch files here.');
      watcher.path = await this.checkWatch(watcher.path);
    }
    this.watchers.push(watcher); await this.save(); return this.state();
  }
  async removeWatcher(id: string): Promise<AutomationState> { this.watchers = this.watchers.filter(w => w.id !== id); await this.save(); return this.state(); }
  // On or off. Turned back on, one that paused itself starts afresh.
  async setWatcher(id: string, value: unknown): Promise<AutomationState> {
    const watcher = this.watchers.find(w => w.id === id), enabled = value && typeof value === 'object' ? (value as { enabled?: unknown }).enabled : undefined;
    if (!watcher) throw new Error('That watcher is gone.');
    if (typeof enabled !== 'boolean') throw new Error('Say whether the watcher is on.');
    watcher.enabled = enabled;
    if (enabled) { watcher.state.paused = ''; watcher.state.fires = []; }
    await this.save(); return this.state();
  }
  // A watcher tied to a goal wakes it when it fires (goals, stage 3); '' unties it.
  async tieWatcher(id: string, goal = ''): Promise<Watcher> {
    const watcher = this.watchers.find(w => w.id === id);
    if (!watcher) throw new Error('That watcher is gone.');
    if (goal && !/^G\d{1,5}$/.test(goal)) throw new Error('That isn’t a goal.');
    if (goal) watcher.goal = goal; else delete watcher.goal;
    await this.save(); return watcher;
  }
  saveWatchers(): Promise<unknown> { return this.save(); }
}
