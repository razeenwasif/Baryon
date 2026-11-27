import { randomUUID } from 'node:crypto';
import { cleanWatcher, MAX_WATCHERS } from './watchers.mjs';

const text = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const CATCH_UP_MS = 3 * 60 * 60 * 1000;
export const HOOK_EVENTS = ['after-edit', 'after-turn'];
const cleanHook = value => value && typeof value.folder === 'string' && HOOK_EVENTS.includes(value.event) && typeof value.command === 'string' && value.command.trim() ? { id: String(value.id).slice(0, 64), folder: value.folder, event: value.event, command: value.command.slice(0, 2000) } : null;
function cleanSchedule(value) {
  if (!/^\d\d:\d\d$/.test(value?.time || '') || Number(value.time.slice(0, 2)) > 23 || Number(value.time.slice(3)) > 59) return null;
  const days = (Array.isArray(value.days) ? value.days : []).filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!days.length || typeof value.prompt !== 'string' || !value.prompt.trim()) return null;
  return { id: String(value.id).slice(0, 64), title: text(value.title, 80) || text(value.prompt, 60), prompt: value.prompt.slice(0, 4000), time: value.time, days: [...new Set(days)].sort(), enabled: value.enabled !== false, lastRun: typeof value.lastRun === 'string' ? value.lastRun.slice(0, 10) : '' };
}
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// The schedules due now. One missed while the Mac slept still runs if it's within a few hours; older ones wait for their next day.
export function dueSchedules(schedules, now = new Date()) {
  return schedules.filter(schedule => {
    if (!schedule.enabled || schedule.lastRun === dayKey(now) || !schedule.days.includes(now.getDay())) return false;
    const at = new Date(now); at.setHours(Number(schedule.time.slice(0, 2)), Number(schedule.time.slice(3)), 0, 0);
    return now >= at && now - at <= CATCH_UP_MS;
  });
}
// Rules kept in Fairy's own data, never in a project, so an agent editing the project can't add one.
export class AutomationStore {
  // checkWatch(path): where a file watcher may look (watchers.mjs' checkWatchPath, given Fairy's data folder).
  // checkFolder(path): where Work on it may work (work-sandbox.mjs' checkWorkFolder, given Fairy's data folder).
  constructor({ read, write, id = randomUUID, now = () => new Date(), checkWatch = null, checkFolder = null }) { Object.assign(this, { read, write, id, now, checkWatch, checkFolder }); this.hooks = []; this.schedules = []; this.watchers = []; }
  async load() {
    const saved = await this.read();
    this.hooks = (Array.isArray(saved?.hooks) ? saved.hooks : []).map(cleanHook).filter(Boolean);
    this.schedules = (Array.isArray(saved?.schedules) ? saved.schedules : []).map(cleanSchedule).filter(Boolean);
    this.watchers = (Array.isArray(saved?.watchers) ? saved.watchers : []).map(cleanWatcher).filter(Boolean).slice(0, MAX_WATCHERS);
  }
  save() { return this.write({ version: 1, hooks: this.hooks, schedules: this.schedules, watchers: this.watchers }); }
  // What the window shows of a watcher: everything but the keys of what it has seen.
  state() { return { hooks: this.hooks, schedules: this.schedules, watchers: this.watchers.map(({ state: { seen, fires, ...state }, ...w }) => ({ ...w, state: { ...state, seen: seen.length } })) }; }
  hooksFor(folder, event) { return this.hooks.filter(hook => hook.folder === folder && hook.event === event); }
  async addHook(value) {
    const hook = cleanHook({ ...value, id: this.id() });
    if (!hook) throw new Error('A hook needs a folder, when to run and a command.');
    this.hooks.push(hook); await this.save(); return this.state();
  }
  async removeHook(id) { this.hooks = this.hooks.filter(hook => hook.id !== id); await this.save(); return this.state(); }
  async addSchedule(value) {
    const schedule = cleanSchedule({ ...value, id: this.id(), lastRun: '' });
    if (!schedule) throw new Error('A scheduled task needs a prompt, a time and at least one day.');
    this.schedules.push(schedule); await this.save(); return this.state();
  }
  async updateSchedule(id, value) {
    if (typeof id !== 'string' || !id) throw new Error('Choose a routine to update.');
    const index = this.schedules.findIndex(entry => entry.id === id);
    if (index < 0) throw new Error('That routine is gone.');
    const current = this.schedules[index];
    const patch = value && typeof value === 'object' ? value : {};
    const next = cleanSchedule({ ...current, ...patch, id: current.id, lastRun: current.lastRun });
    if (!next) throw new Error('A scheduled task needs a prompt, a time and at least one day.');
    this.schedules[index] = next;
    await this.save(); return this.state();
  }
  async removeSchedule(id) { this.schedules = this.schedules.filter(schedule => schedule.id !== id); await this.save(); return this.state(); }
  async markRun(id) { const schedule = this.schedules.find(entry => entry.id === id); if (schedule) { schedule.lastRun = dayKey(this.now()); await this.save(); } }
  due() { return dueSchedules(this.schedules, this.now()); }
  // Watchers (docs/watchers-plan.md): what to watch and what to do; their state is the engine's.
  async addWatcher(value) {
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
  async removeWatcher(id) { this.watchers = this.watchers.filter(w => w.id !== id); await this.save(); return this.state(); }
  // On or off. Turned back on, one that paused itself starts afresh.
  async setWatcher(id, value) {
    const watcher = this.watchers.find(w => w.id === id), enabled = value && typeof value === 'object' ? value.enabled : undefined;
    if (!watcher) throw new Error('That watcher is gone.');
    if (typeof enabled !== 'boolean') throw new Error('Say whether the watcher is on.');
    watcher.enabled = enabled;
    if (enabled) { watcher.state.paused = ''; watcher.state.fires = []; }
    await this.save(); return this.state();
  }
  // A watcher tied to a goal wakes it when it fires (goals, stage 3); '' unties it.
  async tieWatcher(id, goal = '') {
    const watcher = this.watchers.find(w => w.id === id);
    if (!watcher) throw new Error('That watcher is gone.');
    if (goal && !/^G\d{1,5}$/.test(goal)) throw new Error('That isn’t a goal.');
    if (goal) watcher.goal = goal; else delete watcher.goal;
    await this.save(); return watcher;
  }
  saveWatchers() { return this.save(); }
}
