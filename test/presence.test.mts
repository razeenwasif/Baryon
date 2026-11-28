import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginItemChange, windowPresence, trayMenuTemplate, trayTooltip } from '../desktop/presence.mjs';
import { DEFAULTS, cleanSettings } from '../desktop/core.mjs';

test('the login item is only rewritten when the setting differs from macOS', () => {
  assert.deepEqual(loginItemChange({ startAtLogin: 'on' }, { openAtLogin: false }), { openAtLogin: true });
  assert.deepEqual(loginItemChange({ startAtLogin: 'off' }, { openAtLogin: true }), { openAtLogin: false });
  assert.equal(loginItemChange({ startAtLogin: 'on' }, { openAtLogin: true }), null);
  assert.equal(loginItemChange({ startAtLogin: 'off' }, {}), null);
});

test('the floating avatar follows the user across Spaces and full-screen apps', () => {
  const floatingWindow = windowPresence(true);
  assert.equal(floatingWindow.alwaysOnTop, true);
  assert.equal(floatingWindow.level, 'screen-saver');
  assert.equal(floatingWindow.visibleOnAllWorkspaces, true);
  assert.equal(floatingWindow.options.visibleOnFullScreen, true);
  const workspace = windowPresence(false, true);
  assert.equal(workspace.visibleOnAllWorkspaces, false, 'the workspace window stays on its own Space');
  assert.equal(workspace.alwaysOnTop, true, 'an explicit pin is kept');
  assert.equal(windowPresence(false).alwaysOnTop, false);
});

test('the menu bar menu reflects what Fairy is doing', () => {
  const idle = trayMenuTemplate({ settings: { ...DEFAULTS }, name: 'Astra' });
  assert.equal(idle.find(item => item.id === 'show')!.label, 'Show Astra');
  assert.equal(idle.find(item => item.id === 'quit')!.label, 'Quit Astra');
  assert.equal(idle.find(item => item.id === 'meeting')!.label, 'Start meeting mode');
  assert.equal(idle.find(item => item.id === 'ideas')!.checked, true);
  assert.equal(idle.find(item => item.id === 'login')!.checked, false);
  assert.equal(idle.find(item => item.id === 'companion')!.checked, false);
  assert.ok(!idle.some(item => item.id === 'floating'), 'floating mode is gone');
  const busy = trayMenuTemplate({ settings: { ...DEFAULTS, muted: 'on', startAtLogin: 'on' }, companion: true, visible: true, meeting: 'listening' });
  assert.equal(busy.find(item => item.id === 'show')!.label, 'Hide Baryon');
  assert.equal(busy.find(item => item.id === 'companion')!.checked, true);
  assert.equal(busy.find(item => item.id === 'mute')!.checked, true);
  assert.equal(busy.find(item => item.id === 'meeting')!.label, 'End meeting mode');
  assert.equal(busy.find(item => item.id === 'login')!.checked, true);
  assert(idle.some(item => item.type === 'separator'));
});

test('the menu bar tooltip names the loudest state, and the setting validates', () => {
  assert.equal(trayTooltip({ name: 'Astra', meeting: 'listening', settings: { muted: 'on' } }), 'Astra · transcribing this meeting');
  assert.equal(trayTooltip({ settings: { muted: 'on' } }), 'Baryon · muted');
  assert.equal(trayTooltip({ name: 'Astra', settings: {} }), 'Astra');
  assert.equal(cleanSettings({ startAtLogin: 'on' }).startAtLogin, 'on');
  assert.throws(() => cleanSettings({ startAtLogin: 'sometimes' as any }), /opens at login/);
});

test('the window opens filling the screen', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /new BrowserWindow\(\{ \.\.\.fullWindowBounds\(\), minWidth: 820,/);
  assert.match(main, /getDisplayNearestPoint\(screen\.getCursorScreenPoint\(\)\)\.workArea/);
  assert.match(main, /new BrowserWindow\(\{ \.\.\.fullWindowBounds\(\)[^\n]*\n[^\n]*Stage Manager[^\n]*\n\s*window\.setBounds\(fullWindowBounds\(\)\);/, 'set again after Stage Manager has shrunk it');
  assert.ok(!main.includes('workspaceBounds'), 'no floating size to come back from');
});
