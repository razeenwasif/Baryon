import test from 'node:test';
import assert from 'node:assert/strict';
import { appAsked, findApp, listApps, AppLauncher } from '../desktop/apps.mjs';

const apps = ['Flux', 'Tachyon', 'Nova', 'Neutron', 'Calypso', 'Google Chrome', 'Safari', 'Calendar', 'Claude Code URL Handler', 'Notes', 'Nexus'].map(name => ({ name, path: `/Applications/${name}.app`, mine: false }));

test('the words that ask to open an app, and the app they mean', () => {
  const cases = { 'open Flux': 'Flux', 'launch tachyon': 'Tachyon', 'can you open nova please': 'Nova', 'Fairy, open the Neutron app': 'Neutron', 'open calypo': 'Calypso', 'open Chrome': 'Google Chrome', 'switch to Safari': 'Safari', 'start nexus': 'Nexus' };
  for (const [text, name] of Object.entries(cases)) assert.equal(findApp(appAsked(text)!, apps)?.name, name, text);
  for (const text of ['open a new tab', 'start a timer for 5 minutes', 'open the file notes.md', 'open this', 'run the tests in the project folder and fix what fails', 'what does open source mean']) assert.equal(appAsked(text), null, text);
  assert.equal(findApp('photoshop', apps), null, 'nothing close, so nothing opens');
});

test('apps are found in sub-folders, but not inside other apps', async () => {
  const tree: Record<string, [string, boolean][]> = { '/A': [['Flux.app', true], ['Utilities', true], ['notes.txt', false]], '/A/Utilities': [['Terminal.app', true]], '/B': [['Nova.app', true]] };
  const read = async (folder: string) => { if (!tree[folder]) throw new Error('missing'); return tree[folder].map(([name, dir]) => ({ name, isDirectory: () => dir, isSymbolicLink: () => false })); };
  const found = await listApps(['/A', '/B', '/missing'], { read: read as any });
  assert.deepEqual(found.map(app => app.name).sort(), ['Flux', 'Nova', 'Terminal']);
});

test('opening asks the system to open the app it found, and nothing otherwise', async () => {
  const opened: string[] = [];
  const launcher = new AppLauncher({ folders: () => [], open: async path => { opened.push(path); } });
  launcher.cache = { at: Date.now(), apps };
  assert.equal((await launcher.openAsked('open flux'))!.name, 'Flux');
  assert.equal(await launcher.openAsked('open photoshop'), null);
  assert.equal(await launcher.openAsked('what is flux'), null);
  assert.deepEqual(opened, ['/Applications/Flux.app']);
});

test('the velvet button switches to Velvet and back to the picture it came from', async () => {
  const { cleanSettings } = await import('../desktop/core.mjs');
  const { DEFAULTS } = await import('../src/defaults.js');
  const { wallpaperState } = await import('../src/wallpaper-state.js');
  const { reach } = await import('../src/velvet-ripple.js');
  const start = cleanSettings({ windowWallpaper: 'nebula' }, DEFAULTS as any);
  const velvet = cleanSettings({ windowWallpaper: 'velvet', wallpaperLast: start.windowWallpaper }, start);
  assert.equal(velvet.windowWallpaper, 'velvet'); assert.equal(velvet.wallpaperLast, 'nebula');
  assert.equal(cleanSettings({ wallpaperLast: 'velvet' }, velvet).wallpaperLast, 'aurora', 'it never goes back to velvet itself');
  assert.deepEqual([wallpaperState({ settings: velvet }).on, (wallpaperState({ settings: velvet }) as any).motion], [true, 'still'], 'velvet is a still picture');
  assert.ok(Math.abs(reach(0, 0, 300, 400) - (500 + 24)) < 0.001, 'the ring runs to the far corner');
});

test('the ripple’s wallpaper copy lines up with the wallpaper on screen', async () => {
  const { coverMap } = await import('../src/velvet-ripple.js');
  // A 1600 × 1000 picture covering a 1000 × 1000 box is scaled to 1000 tall and centred.
  assert.deepEqual(coverMap({ x: 0, y: 0, w: 1000, h: 1000 }, { w: 1600, h: 1000 }), [-300, 0, 1600, 1000]);
  // The picture layer is 7% larger than the window on each side.
  const [x, y, w, h] = coverMap({ x: -70, y: -70, w: 1140, h: 1140 }, { w: 1000, h: 1000 });
  assert.deepEqual([x, y, w, h].map(Math.round), [-70, -70, 1140, 1140]);
});
