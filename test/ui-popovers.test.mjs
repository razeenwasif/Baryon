import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AutomationStore } from '../desktop/automation.mjs';

test('AutomationStore.updateSchedule updates routine fields and enabled state safely while preserving id and lastRun', async () => {
  let saved = {
    version: 1,
    hooks: [],
    schedules: [
      { id: 'r1', title: 'Morning Brief', prompt: 'Check calendar', time: '09:00', days: [1, 2, 3, 4, 5], enabled: true, lastRun: '2026-11-22' },
    ],
    watchers: [],
  };
  const store = new AutomationStore({
    read: async () => saved,
    write: async v => { saved = v; },
    id: () => 'new-id',
  });
  await store.load();

  const paused = await store.updateSchedule('r1', { enabled: false });
  assert.equal(paused.schedules[0].enabled, false);
  assert.equal(paused.schedules[0].lastRun, '2026-11-22');

  const edited = await store.updateSchedule('r1', {
    id: '../spoof',
    lastRun: '1999-01-01',
    title: 'Daily Standup',
    prompt: 'Summarize PRs',
    time: '08:30',
    days: [1, 3, 5],
    enabled: true,
  });
  assert.deepEqual(edited.schedules[0], {
    id: 'r1',
    title: 'Daily Standup',
    prompt: 'Summarize PRs',
    time: '08:30',
    days: [1, 3, 5],
    enabled: true,
    lastRun: '2026-11-22',
  });

  await assert.rejects(store.updateSchedule('missing', { enabled: false }), /gone/);
  await assert.rejects(store.updateSchedule('r1', { time: '99:99' }), /prompt, a time/);
});

test('always-visible user bubble actions, input-required icons, Threads/Activity/Routines popovers are wired cleanly', () => {
  const css = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const sessionList = readFileSync(new URL('../src/session-list.js', import.meta.url), 'utf8');
  const threadsPop = readFileSync(new URL('../src/threads-popover.js', import.meta.url), 'utf8');
  const activityPop = readFileSync(new URL('../src/activity-popover.js', import.meta.url), 'utf8');
  const routinesPop = readFileSync(new URL('../src/routines-popover.js', import.meta.url), 'utf8');

  assert.match(css, /\.message-actions\{[^}]*opacity:\.72;pointer-events:auto/);
  assert.match(css, /#app \.message\.user:has\(\.message-actions\)\{margin-bottom:26px\}/);
  assert.match(css, /\.session-input-required\{/);
  assert.match(css, /\.fairy-popover\{/);

  assert.match(sessionList, /inputRequiredIcon/);
  assert.match(sessionList, /run === 'waiting'\) item\.append\(inputRequiredIcon/);
  assert.match(sessionList, /head\.classList\.contains\('waiting'\)\) head\.append\(inputRequiredIcon/);

  assert.match(app, /id="threads-menu"/);
  assert.match(app, /id="activity-bell"/);
  assert.match(app, /id="chat-header-input"/);
  assert.match(app, /routinesPopover\.toggle\(\)/);

  assert.match(threadsPop, /export function createThreadsPopover\(/);
  assert.match(activityPop, /export function createActivityPopover\(/);
  assert.match(routinesPop, /export function createRoutinesPopover\(/);
});
