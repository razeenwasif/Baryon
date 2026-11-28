import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DeviceHelper, Simulators, buildProblems, parseDevices, runtimeName, typable } from '../desktop/simulator.mjs';
import { SIMULATOR_TOOLS, checkInput, describeInput } from '../desktop/simulator-tools.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { workInstructions } from '../desktop/work-agent.mjs';
import { toolset } from '../desktop/tool-registry.mjs';
import { deviceLabel, devicePoint, frameSize, isTablet, keyFor } from '../src/simulator-input.js';

const PHONE = '11111111-2222-3333-4444-555555555555', PAD = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', OLD = '99999999-8888-7777-6666-555555555555';
const LIST = { devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
    { udid: PAD, name: 'iPad Air', state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Air' },
    { udid: PHONE, name: 'iPhone 18', state: 'Booted', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18' },
  ],
  'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: OLD, name: 'Gone iPhone', state: 'Shutdown', isAvailable: false }],
} };

// A fake simctl, xcodebuild and plutil: it records each call and answers like the real ones.
function fakeXcode({ list = LIST, failBuild = '', products = null }: { list?: typeof LIST; failBuild?: string; products?: string | null } = {}) {
  const calls: any[] = [], state = structuredClone(list);
  const run = async (file: string, args: string[], options: { input?: string; cwd?: string } = {}) => {
    calls.push({ file, args, input: options.input ?? null, cwd: options.cwd });
    const [tool, verb, ...rest] = file === '/usr/bin/xcrun' ? args : [file, ...args];
    const device = (udid: string) => (Object.values(state.devices).flat() as any[]).find(entry => entry.udid === udid);
    if (tool === 'simctl') {
      if (verb === 'help') return { stdout: 'usage', stderr: '' };
      if (verb === 'list') return { stdout: JSON.stringify(state), stderr: '' };
      if (verb === 'boot') { const found = device(rest[0]); if (found.state === 'Booted') throw new Error('Unable to boot device in current state: Booted'); found.state = 'Booted'; return { stdout: '', stderr: '' }; }
      if (verb === 'shutdown') { device(rest[0]).state = 'Shutdown'; return { stdout: '', stderr: '' }; }
      if (verb === 'launch') return { stdout: `${rest.at(-1)}: 4242\n`, stderr: '' };
      if (verb === 'ui') return { stdout: rest.length > 1 ? '' : 'dark\n', stderr: '' };
      return { stdout: '', stderr: '' };
    }
    if (tool === 'xcodebuild') {
      if (verb === '-list') return { stdout: JSON.stringify({ project: { name: 'Orbit', schemes: ['Orbit', 'OrbitWidgets'] } }), stderr: '' };
      if (failBuild) throw Object.assign(new Error('xcodebuild failed'), { output: failBuild });
      const derived = args[args.indexOf('-derivedDataPath') + 1];
      const where = join(derived, 'Build', 'Products', 'Debug-iphonesimulator');
      mkdirSync(join(where, products ?? 'Orbit.app'), { recursive: true });
      return { stdout: 'Compiling…\nOrbit.swift:3: warning: unused\n** BUILD SUCCEEDED **\n', stderr: '' };
    }
    if (file === '/usr/bin/plutil') return { stdout: 'org.example.orbit\n', stderr: '' };
    throw new Error(`Unexpected ${file} ${args.join(' ')}`);
  };
  return { run, calls, state };
}
// A fake helper: answers each request at once, and remembers what it was asked.
function fakeHelpers() {
  const asked: any[] = [];
  const helper = ({ udid, onFrame }: { udid: string; onFrame: any }) => ({ udid, closed: false, onFrame,
    request: async (op: string, options: Record<string, any> = {}) => {
      asked.push({ udid, op, ...options });
      if (op === 'info') return { name: 'iPhone 18', points: [402, 874] };
      if (op === 'screenshot') return { image: 'AAAA', mime: 'image/jpeg', width: 402, height: 874, points: [402, 874] };
      return {};
    },
    close() { this.closed = true; } });
  return { helper, asked };
}
const project = (t: TestContext) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-sim-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'ios', 'Orbit.xcodeproj'), { recursive: true });
  return root;
};
const simulators = (t: TestContext, options: any = {}) => {
  const xcode = fakeXcode(options), helpers = fakeHelpers(), changes: any[] = [];
  const buildRoot = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-sim-builds-')));
  t.after(() => rmSync(buildRoot, { recursive: true, force: true }));
  const sims = new Simulators({ run: xcode.run as any, helper: helpers.helper as any, exists: () => true, buildRoot, onChange: change => changes.push(change), idle: 50 });
  t.after(() => sims.close());
  return { sims, xcode, helpers, changes, buildRoot };
};

test('devices come from simctl, running ones and iPhones first, with their iOS version and without unavailable ones', () => {
  assert.equal(runtimeName('com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4'), 'iOS 27.2');
  assert.equal(runtimeName('com.apple.CoreSimulator.SimRuntime.xrOS-2-0'), 'visionOS 2.0');
  const list = parseDevices(JSON.stringify(LIST));
  assert.deepEqual(list.map(device => [device.name, device.runtime, device.booted]), [['iPhone 18', 'iOS 27.2', true], ['iPad Air', 'iOS 27.2', false]]);
  assert.equal(deviceLabel(list[0]), '● iPhone 18 · iOS 27.2');
});

test('a device is found by UDID or name, or else is the one on show or the only one running', async t => {
  const { sims } = simulators(t);
  assert.equal((await sims.device('ipad air')).udid, PAD);
  assert.equal((await sims.device(PHONE)).name, 'iPhone 18');
  assert.equal((await sims.device()).udid, PHONE, 'the only booted device');
  sims.show(PAD);
  assert.equal((await sims.device()).udid, PAD, 'the panel’s device wins');
  await assert.rejects(sims.booted(), /iPad Air isn’t running/);
  await assert.rejects(sims.device('Pixel'), /no simulator called Pixel.*iPhone 18/);
});

test('booting waits for the device and puts it in the panel; booting a running device is fine', async t => {
  const { sims, xcode, changes } = simulators(t);
  const booted = await sims.boot('iPad Air');
  assert.equal(booted.booted, true);
  assert.deepEqual(xcode.calls.filter(call => call.args[0] === 'simctl').map(call => call.args.slice(1, 2)[0]), ['list', 'boot', 'bootstatus']);
  assert.equal(sims.current, PAD);
  assert(changes.some(change => change.current === PAD));
  xcode.state.devices['com.apple.CoreSimulator.SimRuntime.iOS-27-2'][0].state = 'Shutdown';
  // simctl says "current state: Booted" when it raced another boot; that counts as booted.
  await sims.boot(PHONE);
  await sims.shutdown(PHONE);
  assert.equal(xcode.state.devices['com.apple.CoreSimulator.SimRuntime.iOS-27-2'][1].state, 'Shutdown');
});

test('commands run with Fairy’s own PATH, as the app opened from the Finder has a bare one', async () => {
  const { runProgram } = await import('../desktop/simulator.mjs');
  const { stdout } = await runProgram('/bin/sh', ['-c', 'echo "$PATH"']);
  assert.match(stdout, /\/opt\/homebrew\/bin/);
  assert.match(stdout, /\/usr\/bin/);
});

test('keys, shortcuts and text become HID usages, and text a keyboard can’t type is pasted', async t => {
  const { sims, xcode, helpers } = simulators(t);
  await sims.key(PHONE, 'return');
  await sims.key(PHONE, 'select_all');
  await sims.key(PHONE, 'z', { modifiers: ['command', 'shift'] });
  await sims.key(PHONE, 'left', { count: 3 });
  await assert.rejects(sims.key(PHONE, 'hyper'), /Unknown key/);
  assert.deepEqual(helpers.asked.map(entry => [entry.codes, entry.modifiers]), [[[40], []], [[4], [227]], [[29], [227, 225]], [[80], []], [[80], []], [[80], []]]);
  assert(typable('Hello, world! #1'));
  assert(!typable('café ✓'));
  await sims.type(PHONE, 'Hi there');
  await sims.type(PHONE, 'café ✓');
  assert.deepEqual(helpers.asked.slice(-2).map(entry => entry.op), ['text', 'keys']);
  assert.equal(helpers.asked.at(-2).text, 'Hi there');
  assert.deepEqual([helpers.asked.at(-1).codes, helpers.asked.at(-1).modifiers], [[25], [227]], 'pasted with ⌘V');
  assert.deepEqual(xcode.calls.find(call => call.args[1] === 'pbcopy'), { file: '/usr/bin/xcrun', args: ['simctl', 'pbcopy', PHONE], input: 'café ✓', cwd: undefined });
});

test('the panel streams one device at a time, and its frames reach the listener', async t => {
  const { sims, helpers } = simulators(t);
  const frames: any[] = [];
  const info = await sims.watch(PHONE, frame => frames.push(frame));
  assert.deepEqual(info.points, [402, 874]);
  assert.deepEqual(helpers.asked.filter(entry => entry.op === 'frames'), [{ udid: PHONE, op: 'frames', on: true, fps: 60, maxWidth: 520 }], 'asked to stream once');
  sims.frame(PHONE, { frame: 'JPEG', width: 260, height: 565 });
  sims.frame(PAD, { frame: 'other' });
  assert.deepEqual<any>(frames, [{ udid: PHONE, frame: 'JPEG', width: 260, height: 565 }]);
  await sims.watch(PAD, frame => frames.push(frame));
  assert(helpers.asked.some(entry => entry.udid === PHONE && entry.op === 'frames' && entry.on === false), 'the first stops streaming');
  assert.equal(sims.current, PAD);
});

test('the helper speaks JSON lines: answers by id, frames without one, and a crash fails what was waiting', async () => {
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough(), child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill() {} });
  let spawned: any;
  const frames: any[] = [], helper = new DeviceHelper({ udid: PHONE, executable: '/x/fairy-simulator', spawnProcess: ((file: string, args: string[]) => { spawned = [file, args]; return child; }) as any, onFrame: frame => frames.push(frame) });
  assert.deepEqual(spawned, ['/x/fairy-simulator', ['serve', PHONE]]);
  const written: any[] = [];
  stdin.on('data', chunk => written.push(...String(chunk).trim().split('\n').map(line => JSON.parse(line))));
  const tap = helper.request('tap', { x: 10, y: 20 }), info = helper.request('info');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(written, [{ id: 1, op: 'tap', x: 10, y: 20 }, { id: 2, op: 'info' }]);
  stdout.write('{"frame":"AAA","width":2}\n{"id":2,"ok":true,"name":"iPhone"}\n{"id":1,"er');
  stdout.write('ror":"(500, 20) is off the screen"}\n');
  assert.equal((await info).name, 'iPhone');
  await assert.rejects(tap, /off the screen/);
  assert.deepEqual(frames, [{ frame: 'AAA', width: 2 }]);
  const waiting = helper.request('screenshot');
  stderr.write('There’s no simulator X.\n');
  child.emit('close', 1);
  await assert.rejects(waiting, /no simulator X/);
  await assert.rejects(helper.request('info'), /stopped/);
});

test('a build finds the project and its scheme, builds into Fairy’s own folder, and finds the app it made', async t => {
  const root = project(t), { sims, xcode, buildRoot } = simulators(t);
  assert.equal(await sims.findProject(root), join(root, 'ios', 'Orbit.xcodeproj'));
  await assert.rejects(sims.findProject(root, '../elsewhere.xcodeproj'), /inside the work folder/);
  const built = await sims.build({ root, udid: PHONE });
  assert.equal(built.scheme, 'Orbit', 'the scheme named after the project, of two');
  assert.equal(built.bundleId, 'org.example.orbit');
  assert.equal(built.warnings, 1);
  assert(built.app.startsWith(buildRoot) && built.app.endsWith('/Debug-iphonesimulator/Orbit.app'));
  const build = xcode.calls.find(call => call.args.includes('build'));
  assert.deepEqual(build.args.slice(0, 8), ['xcodebuild', '-project', join(root, 'ios', 'Orbit.xcodeproj'), '-scheme', 'Orbit', '-configuration', 'Debug', '-destination']);
  assert.equal(build.args[8], `platform=iOS Simulator,id=${PHONE}`);
  assert.equal(build.cwd, root);
  assert.equal(sims.checkApp(built.app, root), built.app);
  assert.throws(() => sims.checkApp('/Applications/Safari.app', root), /from this work folder/);
  await assert.rejects(sims.build({ root, udid: PHONE, configuration: 'Debug; rm -rf ~' }), /configuration name/);
});

test('a failed build reports its errors with their files and lines', async t => {
  const root = project(t), output = 'CompileSwift normal\n/p/ios/Orbit/View.swift:12:5: error: cannot find \'Lable\' in scope\nnote: something\n** BUILD FAILED **\n';
  const { sims } = simulators(t, { failBuild: output });
  await assert.rejects(sims.build({ root, udid: PHONE, scheme: 'Orbit' }), (error: any) => /The build failed\.\n.*View\.swift:12:5: error: cannot find 'Lable'/.test(error.message) && !/note: something/.test(error.message));
  assert.equal(buildProblems('fine\nwarning: x'), '');
});

test('a batch of input is checked before any of it runs, and described in words', () => {
  const checked = checkInput([{ type: 'tap', x: 10, y: 20 }, { type: 'swipe', x: 200, y: 700, x2: 200, y2: 100 }, { type: 'type', text: 'hello' }, { type: 'key', key: 'return' }, { type: 'button', name: 'home' }, { type: 'long_press', x: 5, y: 5 }], [402, 874]);
  assert.equal(describeInput(checked), 'tap (10, 20), swipe (200, 700) → (200, 100), type “hello”, press return, press the home button, press and hold (5, 5) for 1s');
  assert.throws(() => checkInput([{ type: 'tap', x: 10, y: 20 }, { type: 'tap', x: 500, y: 20 }], [402, 874]), /\(500, 20\) is off the screen, which is 402 × 874 points/);
  assert.throws(() => checkInput([{ type: 'shake' }] as any, [402, 874]), /tap, long_press/);
  assert.throws(() => checkInput([], [402, 874]), /1–20/);
  assert.throws(() => checkInput([{ type: 'button', name: 'volume' }] as any), /home, lock/);
});

// A work session with the simulator tools, and every approval it asks for.
function session(t: TestContext, { permission = 'ask', answer = 'allow' }: { permission?: string; answer?: string | ((request: any) => string) } = {}) {
  const root = project(t), sim = simulators(t), asked: any[] = [], events: any[] = [], outside: any[] = [];
  const tools = new WorkTools({ root, permission, simulators: sim.sims as any, signal: new AbortController().signal, runCommand: (async () => ({ exitCode: 0, output: '' })) as any,
    approve: async request => { asked.push(request); return typeof answer === 'function' ? answer(request) : answer; }, onEvent: event => events.push(event), onOutside: entry => outside.push(entry) });
  return { tools, asked, events, outside, root, ...sim };
}
const text = (result: any) => result.contentItems.map((item: any) => item.text || item.imageUrl).join('\n');

test('the simulator tools are offered only when the Mac can run simulators, and the agent is told about them', t => {
  const { tools } = session(t);
  assert.deepEqual(tools.available().filter(tool => tool.name.startsWith('simulator_')).map(tool => tool.name), SIMULATOR_TOOLS.map(tool => tool.name));
  assert(!new WorkTools({ root: process.cwd(), runCommand: (async () => ({})) as any }).available().some(tool => tool.name.startsWith('simulator_')));
  assert.match(workInstructions({ root: '/p', permission: 'ask', sandboxed: true, simulator: true }), /simulator_build/);
  assert.doesNotMatch(workInstructions({ root: '/p', permission: 'ask', sandboxed: true }), /simulator_/);
  assert.deepEqual(SIMULATOR_TOOLS.filter(tool => tool.risk === 'read').map(tool => tool.name), ['simulator_devices', 'simulator_screenshot']);
});

test('looking needs no OK, so plan mode can list devices and take screenshots but not use them', async t => {
  const { tools, asked, helpers, events, sims } = session(t, { permission: 'plan' });
  assert.match(text(await tools.handle({ tool: 'simulator_devices', arguments: {} })), /"name":"iPhone 18".*"state":"Booted"/);
  const shot = await tools.handle({ tool: 'simulator_screenshot', arguments: {} });
  assert.equal(shot.success, true);
  assert.match((shot.contentItems[0] as any).text, /402 × 874: one pixel is one point/);
  assert.equal((shot.contentItems[1] as any).imageUrl, 'data:image/jpeg;base64,AAAA');
  assert(events.some(event => event.type === 'simulator-open' && event.udid === PHONE), 'the panel opens to the device');
  assert.equal(sims.current, PHONE);
  const tap = await tools.handle({ tool: 'simulator_input', arguments: { actions: [{ type: 'tap', x: 10, y: 10 }] } });
  assert.equal(tap.success, false);
  assert.match(text(tap), /plan mode/);
  assert.equal((await tools.handle({ tool: 'simulator_build', arguments: {} })).success, false);
  assert.deepEqual(asked, []);
  assert(!helpers.asked.some(entry => entry.op === 'tap'));
});

test('using a device asks once, and Allow in this chat covers the rest of the chat', async t => {
  const { tools, asked, helpers } = session(t, { answer: 'always' });
  const first = await tools.handle({ tool: 'simulator_input', arguments: { actions: [{ type: 'tap', x: 100, y: 200 }, { type: 'type', text: 'hi' }], reason: 'Try the sign-in button' } });
  assert.equal(first.success, true);
  assert.match(text(first), /Done: tap \(100, 200\), type “hi”\./);
  assert.equal((first.contentItems[1] as any).imageUrl, 'data:image/jpeg;base64,AAAA', 'a fresh screenshot comes back');
  assert.deepEqual(asked.map(request => [request.kind, request.title, request.tool]), [['simulator', 'Use the iPhone 18 simulator?', 'simulator_input']]);
  assert.match(asked[0].detail, /Try the sign-in button · tap \(100, 200\), type “hi”/);
  await tools.handle({ tool: 'simulator_open_url', arguments: { url: 'orbit://settings' } });
  await tools.handle({ tool: 'simulator_appearance', arguments: { mode: 'dark' } });
  assert.equal(asked.length, 1);
  assert.deepEqual(helpers.asked.filter(entry => ['tap', 'text'].includes(entry.op)).map(entry => entry.op), ['tap', 'text']);
});

test('waiting changes nothing, so a batch of only waits doesn’t ask', async t => {
  const { tools, asked } = session(t, { answer: 'deny' });
  const result = await tools.handle({ tool: 'simulator_input', arguments: { actions: [{ type: 'wait', duration: 0 }] } });
  assert.equal(result.success, true, text(result));
  assert.deepEqual(asked, []);
});

test('a refusal stops the action, and nothing reaches the device', async t => {
  const { tools, helpers, xcode } = session(t, { answer: 'deny' });
  const result = await tools.handle({ tool: 'simulator_input', arguments: { actions: [{ type: 'button', name: 'home' }] } });
  assert.equal(result.success, false);
  assert.match(text(result), /didn’t allow this/);
  assert(!helpers.asked.some(entry => entry.op === 'button'));
  const boot = await tools.handle({ tool: 'simulator_boot', arguments: { device: 'iPad Air' } });
  assert.equal(boot.success, false);
  assert(!xcode.calls.some(call => call.args[1] === 'boot'));
});

test('building and installing ask every time with the exact command, even in Run on its own', async t => {
  const { tools, asked, outside, xcode, helpers, root } = session(t, { permission: 'auto' });
  const result = await tools.handle({ tool: 'simulator_build', arguments: {} });
  assert.equal(result.success, true, text(result));
  assert.match(text(result), /Built Orbit \(ios\/Orbit\.xcodeproj\) for iPhone 18, with 1 warnings\.\nApp: .*Orbit\.app\nBundle ID: org\.example\.orbit\nInstalled\.\nLaunched\./);
  assert.equal((result.contentItems[1] as any).imageUrl, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(asked.map(request => request.kind), ['outside']);
  assert.equal(asked[0].title, 'Build this app for iPhone 18, install it and start it?');
  assert.match(asked[0].command, new RegExp(`^xcrun xcodebuild -project ${root}/ios/Orbit\\.xcodeproj -scheme Orbit -configuration Debug -destination platform=iOS Simulator,id=${PHONE} -derivedDataPath `));
  assert.deepEqual(outside.map(entry => entry.answer), ['allow'], 'the outside log keeps it');
  const order = xcode.calls.map(call => call.args[0] === 'simctl' ? call.args[1] : call.args[0] === 'xcodebuild' ? `xcodebuild${call.args[1] === '-list' ? ' -list' : ''}` : call.file).filter(step => step !== 'list');
  assert.deepEqual(order, ['xcodebuild -list', 'xcodebuild', '/usr/bin/plutil', 'install', '/usr/bin/plutil', 'launch']);
  // Using the device needs no OK in Run on its own, but building again asks again.
  await tools.handle({ tool: 'simulator_input', arguments: { actions: [{ type: 'tap', x: 1, y: 1 }] } });
  assert.equal(asked.length, 1);
  await tools.handle({ tool: 'simulator_build', arguments: { launch: false, install: false } });
  assert.deepEqual(asked.map(request => request.kind), ['outside', 'outside']);
  const app = await tools.handle({ tool: 'simulator_app', arguments: { action: 'install', app: '/Applications/Safari.app' } });
  assert.match(text(app), /from this work folder/);
  assert.equal(asked.length, 2, 'refused before asking');
  assert(helpers.asked.some(entry => entry.op === 'tap'));
});

test('a refused build doesn’t run, and the rest of the turn knows', async t => {
  const { tools, xcode } = session(t, { answer: request => request.kind === 'outside' ? 'deny' : 'allow' });
  const result = await tools.handle({ tool: 'simulator_build', arguments: {} });
  assert.equal(result.success, false);
  assert(!xcode.calls.some(call => call.args.includes('build')));
  assert.equal(tools.outsideRefused, true);
});

test('the registry runs simulator tools for any caller with the same rules', async t => {
  const { sims } = simulators(t), asked: string[] = [];
  const set = toolset(SIMULATOR_TOOLS, { context: { simulators: sims, root: '/nowhere', ask: async (kind: string, _request: any) => { asked.push(kind); throw new Error('No.'); }, opened: () => {} } });
  assert.deepEqual((await set.execute('simulator_appearance', { mode: 'dark' })), { error: 'No.' });
  assert.deepEqual(asked, ['simulator']);
  assert.match(((await set.execute('simulator_devices', {})) as any).text, /iPhone 18/);
});

test('the panel turns a click into the device’s points, and keys into what the device should get', () => {
  const rect = { left: 100, top: 50, width: 201, height: 437 };
  assert.deepEqual(devicePoint({ clientX: 100 + 100.5, clientY: 50 + 218.5 } as any, rect as any, [402, 874]), { x: 201, y: 437 });
  assert.deepEqual(devicePoint({ clientX: 0, clientY: 9999 } as any, rect as any, [402, 874]), { x: 0, y: 874 }, 'kept on the screen');
  assert.equal(devicePoint({ clientX: 1, clientY: 1 } as any, rect as any, null), null);
  const key = (key: string, extra: Record<string, any> = {}) => keyFor({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra } as any);
  assert.deepEqual(key('a'), { text: 'a' });
  assert.deepEqual(key('Enter'), { key: 'return', modifiers: [] });
  assert.deepEqual(key('ArrowLeft', { shiftKey: true }), { key: 'left', modifiers: ['shift'] });
  assert.deepEqual(key('v', { metaKey: true }), { key: 'v', modifiers: ['command'] });
  assert.equal(key('r', { ctrlKey: true }), null);
  assert.equal(key('F5'), null);
});

test('the iPhone outline scales with the screen and is gentler on an iPad', () => {
  assert.deepEqual(frameSize(245), { bezel: 8, corner: 33 });
  assert.deepEqual(frameSize(490), { bezel: 17, corner: 66 });
  assert.deepEqual(frameSize(400, true), { bezel: 18, corner: 22 });
  assert.deepEqual(frameSize(undefined as any), { bezel: 0, corner: 0 });
  assert.equal(isTablet({ name: 'iPad Air' }), true);
  assert.equal(isTablet({ name: 'iPhone 18 Pro' }), false);
  assert.equal(isTablet(null), false);
});
