import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { nativeBin } from './bundle-path.cjs';
import { outsideEnvironment } from './work-sandbox.mjs';

// iOS Simulator devices for the Simulator panel and a work session's simulator tools. simctl lists, boots, installs and
// launches; xcodebuild builds; and Fairy's own helper (native/Simulator.swift) shows a device's screen and sends it
// touches and keys, which simctl can't. Every command runs with the PATH Fairy builds for itself, because Fairy opened
// from the Finder starts with a bare one. One helper runs per device, shared by the panel and the agent, and stops
// when nothing has used it for a while.
export const HELPER = nativeBin('fairy-simulator');
const IDLE = 5 * 60 * 1000, BUILD_TIMEOUT = 20 * 60 * 1000, KEEP_LOG = 6000;

// HID usages for keys a model or the panel can name, and modifiers.
export const KEYS = { return: 40, enter: 40, escape: 41, delete: 42, backspace: 42, tab: 43, space: 44, forward_delete: 76, right: 79, left: 80, down: 81, up: 82, home: 74, end: 77, page_up: 75, page_down: 78 };
export const MODIFIERS = { shift: 225, control: 224, ctrl: 224, option: 226, alt: 226, command: 227, cmd: 227 };
const EDITS = { select_all: [[4], [227]], undo: [[29], [227]], redo: [[29], [227, 225]], copy: [[6], [227]], paste: [[25], [227]], cut: [[27], [227]] };
// What the helper can type as keys on a US layout; anything else goes through the device's pasteboard.
const TYPABLE = /^[A-Za-z0-9 \n\t!@#$%^&*()\-_=+[\]{}\\|;:'",.<>/?`~]*$/;
export const typable = text => TYPABLE.test(text);

// "com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4" → "iOS 27.2"
export const runtimeName = key => { const match = /SimRuntime\.([A-Za-z]+)-(\d+)-(\d+)/.exec(key || ''); return match ? `${match[1].replace('xrOS', 'visionOS')} ${match[2]}.${match[3]}` : String(key || '').split('.').pop(); };
export function parseDevices(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json, list = [];
  for (const [runtime, devices] of Object.entries(data?.devices || {})) {
    for (const device of devices || []) {
      if (device.isAvailable === false) continue;
      list.push({ udid: device.udid, name: device.name, state: device.state, booted: device.state === 'Booted', runtime: runtimeName(runtime), type: String(device.deviceTypeIdentifier || '').split('.').pop() });
    }
  }
  // Booted first, then iPhones, then by name.
  const rank = device => (device.booted ? 0 : 2) + (/iPhone/i.test(device.name) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || b.runtime.localeCompare(a.runtime));
}

// Runs a program with Fairy's PATH and no shell, and gives back what it printed.
export function runProgram(file, args, { input = null, timeout = 120000, signal, cwd, env = outsideEnvironment() } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(file, args, { env, cwd, timeout, signal, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const said = `${stderr || ''}\n${stdout || ''}`.trim().split('\n').slice(-12).join('\n');
        reject(Object.assign(new Error(error.killed ? `${basename(file)} took too long.` : said || error.message), { code: error.code, output: `${stdout || ''}${stderr || ''}` }));
      } else resolvePromise({ stdout, stderr });
    });
    if (input !== null) { child.stdin.end(input); }
  });
}

// One helper process for one device: requests go in as JSON lines and come back by id; frames come without one.
export class DeviceHelper {
  constructor({ udid, executable = HELPER, spawnProcess = spawn, onFrame = () => {}, onExit = () => {} }) {
    Object.assign(this, { udid, onFrame, onExit });
    this.pending = new Map(); this.serial = 0; this.buffer = ''; this.closed = false; this.stderr = '';
    const child = this.child = spawnProcess(executable, ['serve', udid], { stdio: ['pipe', 'pipe', 'pipe'], env: outsideEnvironment() });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.read(chunk));
    child.stderr.on('data', chunk => { this.stderr = `${this.stderr}${chunk}`.slice(-2000); });
    child.on('error', error => this.close(new Error(`The simulator helper couldn’t start: ${error.message}`)));
    child.on('close', () => this.close(new Error(this.stderr.trim().split('\n').pop() || 'The simulator helper stopped.')));
    child.stdin.on('error', () => {});
  }
  read(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.frame || message.frameError) { this.onFrame(message); continue; }
      const waiting = this.pending.get(message.id);
      if (!waiting) continue;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error)); else waiting.resolve(message);
    }
  }
  request(op, options = {}, { timeout = 30000 } = {}) {
    if (this.closed) return Promise.reject(new Error('The simulator helper has stopped.'));
    const id = ++this.serial;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('The simulator didn’t answer in time.')); }, timeout);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolvePromise(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.child.stdin.write(`${JSON.stringify({ id, op, ...options })}\n`);
    });
  }
  close(error = new Error('The simulator helper has stopped.')) {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    try { this.child.stdin.end(); } catch {}
    try { this.child.kill(); } catch {}
    this.onExit(error);
  }
}

export class Simulators {
  constructor({ run = runProgram, helper = options => new DeviceHelper(options), helperPath = HELPER, buildRoot = '', exists = existsSync, now = Date.now, idle = IDLE, onChange = () => {} } = {}) {
    Object.assign(this, { run, makeHelper: helper, helperPath, buildRoot, exists, now, idle, onChange });
    this.helpers = new Map(); this.watchers = new Map(); this.current = '';
  }
  simctl(args, options) { return this.run('/usr/bin/xcrun', ['simctl', ...args], options); }
  // Whether this Mac can run simulators at all, and why not.
  async available() {
    try { await this.simctl(['help'], { timeout: 20000 }); } catch (error) { return { ok: false, reason: /xcode-select|developer tools|not a developer tool|unable to find utility/i.test(error.message) ? 'Install Xcode from the App Store and open it once, then try again.' : error.message }; }
    if (!this.exists(this.helperPath)) return { ok: false, reason: 'The simulator helper isn’t built. Run npm run build:simulator.' };
    return { ok: true };
  }
  async devices() { return parseDevices((await this.simctl(['list', 'devices', 'available', '--json'], { timeout: 30000 })).stdout); }
  // A device by UDID or name; without one, the device the panel shows, else the only booted one.
  async device(wanted = '') {
    const list = await this.devices(), text = String(wanted || '').trim().toLowerCase();
    if (!list.length) throw new Error('This Mac has no iOS simulators. Add one in Xcode, under Window, Devices and Simulators.');
    if (text) {
      const found = list.find(device => device.udid.toLowerCase() === text) || list.find(device => device.name.toLowerCase() === text) || list.find(device => device.name.toLowerCase().includes(text));
      if (!found) throw new Error(`There’s no simulator called ${wanted}. These are: ${list.slice(0, 12).map(device => `${device.name} (${device.runtime})`).join(', ')}.`);
      return found;
    }
    const shown = list.find(device => device.udid === this.current);
    if (shown) return shown;
    const booted = list.filter(device => device.booted);
    if (booted.length === 1) return booted[0];
    if (booted.length > 1) throw new Error(`More than one simulator is running (${booted.map(device => device.name).join(', ')}). Say which with device.`);
    throw new Error('No simulator is running. Boot one first, such as one of these: ' + list.slice(0, 8).map(device => `${device.name} (${device.runtime})`).join(', ') + '.');
  }
  async booted(wanted) {
    const device = await this.device(wanted);
    if (!device.booted) throw new Error(`${device.name} isn’t running. Boot it first.`);
    return device;
  }
  show(udid) { if (udid && udid !== this.current) { this.current = udid; this.onChange({ current: udid }); } }
  async boot(wanted, { signal } = {}) {
    const device = await this.device(wanted);
    if (!device.booted) {
      try { await this.simctl(['boot', device.udid], { timeout: 120000, signal }); }
      catch (error) { if (!/current state: Booted/i.test(error.message)) throw error; }
      await this.simctl(['bootstatus', device.udid, '-b'], { timeout: 300000, signal });
    }
    this.show(device.udid);
    this.onChange({ booted: device.udid });
    return { ...device, state: 'Booted', booted: true };
  }
  async shutdown(wanted, { signal } = {}) {
    const device = await this.device(wanted);
    this.stopHelper(device.udid);
    if (device.booted) {
      try { await this.simctl(['shutdown', device.udid], { timeout: 120000, signal }); }
      catch (error) { if (!/current state: Shutdown/i.test(error.message)) throw error; }
    }
    this.onChange({ shutdown: device.udid });
    return { ...device, state: 'Shutdown', booted: false };
  }
  // The helper for a booted device, started on first use.
  helper(udid) {
    let entry = this.helpers.get(udid);
    if (!entry || entry.helper.closed) {
      if (!this.exists(this.helperPath)) throw new Error('The simulator helper isn’t built. Run npm run build:simulator.');
      const started = this.now();
      const helper = this.makeHelper({ udid, executable: this.helperPath, onFrame: frame => this.frame(udid, frame), onExit: () => {
        if (this.helpers.get(udid)?.helper !== helper) return;
        this.helpers.delete(udid);
        this.onChange({ helperStopped: udid });
        // A helper that stops while the panel watches comes back, unless it can't even start.
        if (this.watchers.has(udid) && this.now() - started > 5000) setTimeout(() => { if (this.watchers.has(udid)) { try { this.helper(udid); } catch {} } }, 1000).unref?.();
      } });
      entry = { helper, used: this.now(), timer: null };
      this.helpers.set(udid, entry);
      const watching = this.watchers.get(udid);
      if (watching) void helper.request('frames', { on: true, fps: watching.fps, maxWidth: watching.maxWidth }).catch(() => {});
    }
    entry.used = this.now();
    clearTimeout(entry.timer);
    // Kept while the panel watches; otherwise stopped after a quiet spell.
    entry.timer = setTimeout(() => { if (!this.watchers.has(udid)) this.stopHelper(udid); }, this.idle);
    entry.timer.unref?.();
    return entry.helper;
  }
  stopHelper(udid) { const entry = this.helpers.get(udid); if (!entry) return; clearTimeout(entry.timer); this.helpers.delete(udid); entry.helper.close(); }
  // The panel watches one device's screen at a time.
  frame(udid, frame) { this.watchers.get(udid)?.listener?.({ udid, ...frame }); }
  // Frames go out as the device draws them, up to 60 a second (about 15% of a core while the screen moves, nothing while
  // it's still), so a drag follows the pointer.
  async watch(udid, listener, { fps = 60, maxWidth = 520 } = {}) {
    for (const other of [...this.watchers.keys()]) if (other !== udid) await this.unwatch(other);
    const helper = this.helper(udid);
    this.watchers.set(udid, { fps, maxWidth, listener });
    this.show(udid);
    await helper.request('frames', { on: true, fps, maxWidth });
    return this.helper(udid).request('info');
  }
  async unwatch(udid) {
    const watching = this.watchers.get(udid);
    this.watchers.delete(udid);
    const entry = this.helpers.get(udid);
    if (watching && entry && !entry.helper.closed) {
      await entry.helper.request('frames', { on: false }).catch(() => {});
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { if (!this.watchers.has(udid)) this.stopHelper(udid); }, this.idle);
      entry.timer.unref?.();
    }
  }
  info(udid) { return this.helper(udid).request('info'); }
  // A picture of the screen, the device's size in points unless maxWidth says otherwise.
  async screenshot(udid, { maxWidth = 0 } = {}) {
    const shot = await this.helper(udid).request('screenshot', { maxWidth }, { timeout: 20000 });
    return { url: `data:${shot.mime};base64,${shot.image}`, width: shot.width, height: shot.height, points: shot.points };
  }
  touch(udid, phase, x, y) { return this.helper(udid).request('touch', { phase, x, y }); }
  tap(udid, x, y, duration) { return this.helper(udid).request('tap', { x, y, ...(duration ? { duration } : {}) }); }
  swipe(udid, { x, y, x2, y2, duration = 0.3 }) { return this.helper(udid).request('swipe', { x, y, x2, y2, duration }, { timeout: 30000 }); }
  button(udid, name, duration) { return this.helper(udid).request('button', { name, ...(duration ? { duration } : {}) }); }
  // A named key or edit, such as return, left or select_all, pressed count times, with any modifiers.
  async key(udid, name, { modifiers = [], count = 1 } = {}) {
    const key = String(name || '').toLowerCase().replace(/[\s-]+/g, '_');
    const extra = modifiers.map(modifier => { const code = MODIFIERS[String(modifier).toLowerCase()]; if (!code) throw new Error(`Unknown modifier ${modifier}. Use shift, control, option or command.`); return code; });
    let codes, held;
    if (EDITS[key]) [codes, held] = EDITS[key];
    else if (KEYS[key]) [codes, held] = [[KEYS[key]], []];
    else if (/^[a-z0-9]$/.test(key)) [codes, held] = [[/\d/.test(key) ? (key === '0' ? 39 : 29 + Number(key)) : 4 + key.charCodeAt(0) - 97], []];
    else throw new Error(`Unknown key ${name}. Use a letter or digit, ${Object.keys(KEYS).join(', ')}, or ${Object.keys(EDITS).join(', ')}.`);
    for (let index = 0; index < Math.min(20, Math.max(1, Math.floor(count))); index++) await this.helper(udid).request('keys', { codes, modifiers: [...new Set([...held, ...extra])] });
  }
  // Text as key presses; text a US keyboard can't type is pasted instead.
  async type(udid, text, { signal } = {}) {
    const value = String(text ?? '');
    if (!value) return;
    if (typable(value)) { await this.helper(udid).request('text', { text: value }, { timeout: 30000 + value.length * 100 }); return; }
    await this.simctl(['pbcopy', udid], { input: value, signal, timeout: 20000 });
    await this.helper(udid).request('keys', { codes: [25], modifiers: [227] });
  }
  async appearance(udid, mode, { signal } = {}) {
    if (!['light', 'dark'].includes(mode)) throw new Error('Use light or dark.');
    await this.simctl(['ui', udid, 'appearance', mode], { signal, timeout: 30000 });
  }
  async currentAppearance(udid, { signal } = {}) { return (await this.simctl(['ui', udid, 'appearance'], { signal, timeout: 30000 })).stdout.trim(); }
  async openUrl(udid, url, { signal } = {}) {
    let parsed; try { parsed = new URL(url); } catch { throw new Error('Give a whole URL, such as https://example.com or myapp://path.'); }
    if (/^(?:file|javascript|data):$/i.test(parsed.protocol)) throw new Error('Open a web address or an app’s own link, not a file.');
    await this.simctl(['openurl', udid, parsed.href], { signal, timeout: 30000 });
  }
  async bundleId(appPath, { signal } = {}) {
    const { stdout } = await this.run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Info.plist')], { signal, timeout: 15000 });
    return stdout.trim();
  }
  async install(udid, appPath, { signal } = {}) {
    await this.simctl(['install', udid, appPath], { signal, timeout: 300000 });
    return { bundleId: await this.bundleId(appPath, { signal }).catch(() => '') };
  }
  async launch(udid, bundleId, { args = [], signal } = {}) {
    const { stdout } = await this.simctl(['launch', '--terminate-running-process', udid, bundleId, ...args.map(String)], { signal, timeout: 120000 });
    const pid = /:\s*(\d+)/.exec(stdout)?.[1];
    return { pid: pid ? Number(pid) : null };
  }
  async terminate(udid, bundleId, { signal } = {}) {
    try { await this.simctl(['terminate', udid, bundleId], { signal, timeout: 60000 }); }
    catch (error) { if (!/found nothing to terminate|not running/i.test(error.message)) throw error; }
  }
  async uninstall(udid, bundleId, { signal } = {}) { await this.simctl(['uninstall', udid, bundleId], { signal, timeout: 120000 }); }
  // Where builds for a project folder go: Fairy's own data, so the project stays clean and builds stay incremental.
  derivedData(root) { return join(this.buildRoot, createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16)); }
  // The Xcode project or workspace to build: the one named, else the only one in the folder or a folder below it.
  async findProject(root, named = '') {
    if (named) {
      const full = resolve(root, named), rel = relative(root, full);
      if (rel.startsWith('..') || rel.startsWith(sep)) throw new Error('The project has to be inside the work folder.');
      if (!/\.(?:xcodeproj|xcworkspace)$/.test(full) || !(await stat(full).catch(() => null))?.isDirectory()) throw new Error(`${named} isn’t an Xcode project or workspace.`);
      return full;
    }
    const found = [];
    const look = async (dir, depth) => {
      let entries = []; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules', 'Pods', 'build', 'DerivedData', 'dist'].includes(entry.name)) continue;
        if (/\.(?:xcodeproj|xcworkspace)$/.test(entry.name)) found.push(join(dir, entry.name));
        else if (depth < 2) await look(join(dir, entry.name), depth + 1);
      }
    };
    await look(root, 0);
    // A workspace includes its projects, so it wins over them.
    const workspaces = found.filter(path => path.endsWith('.xcworkspace') && !path.includes('.xcodeproj/')), pick = workspaces.length ? workspaces : found.filter(path => path.endsWith('.xcodeproj'));
    if (pick.length === 1) return pick[0];
    if (!pick.length) throw new Error('There’s no Xcode project in this folder. Say which with project.');
    throw new Error(`There’s more than one Xcode project here: ${pick.map(path => relative(root, path)).join(', ')}. Say which with project.`);
  }
  async schemes(project, { signal } = {}) {
    const { stdout } = await this.run('/usr/bin/xcrun', ['xcodebuild', '-list', '-json', project.endsWith('.xcworkspace') ? '-workspace' : '-project', project], { signal, timeout: 120000 });
    const data = JSON.parse(stdout), info = data.workspace || data.project || {};
    return info.schemes || [];
  }
  buildArguments({ project, scheme, configuration = 'Debug', udid, derivedData }) {
    return ['xcodebuild', project.endsWith('.xcworkspace') ? '-workspace' : '-project', project, '-scheme', scheme, '-configuration', configuration, '-destination', `platform=iOS Simulator,id=${udid}`, '-derivedDataPath', derivedData, 'build'];
  }
  // The scheme to build: the one named, else the only one, else the one named after the project.
  async scheme(project, wanted = '', { signal } = {}) {
    if (wanted) { if (!/^[\w .+-]{1,100}$/.test(wanted)) throw new Error('That isn’t a scheme name.'); return wanted; }
    const schemes = await this.schemes(project, { signal }), base = basename(project).replace(/\.(?:xcodeproj|xcworkspace)$/, '');
    const chosen = schemes.length === 1 ? schemes[0] : schemes.find(name => name === base);
    if (!chosen) throw new Error(schemes.length ? `Say which scheme to build with scheme: ${schemes.join(', ')}.` : 'That project has no shared schemes to build.');
    return chosen;
  }
  // Builds for one simulator and finds the app it made.
  async build({ root, project = '', scheme = '', configuration = 'Debug', udid, signal, onLine = () => {} }) {
    if (!/^[A-Za-z][\w-]{0,30}$/.test(configuration)) throw new Error('That isn’t a build configuration name.');
    const path = await this.findProject(root, project), chosen = await this.scheme(path, scheme, { signal });
    const derivedData = this.derivedData(root), args = this.buildArguments({ project: path, scheme: chosen, configuration, udid, derivedData });
    let log = '';
    try { log = (await this.run('/usr/bin/xcrun', args, { cwd: root, signal, timeout: BUILD_TIMEOUT })).stdout; }
    catch (error) {
      const output = error.output || error.message, problems = buildProblems(output);
      throw new Error(`The build failed.\n${problems || output.slice(-KEEP_LOG)}`);
    }
    onLine(log);
    const products = join(derivedData, 'Build', 'Products', `${configuration}-iphonesimulator`);
    const apps = (await readdir(products).catch(() => [])).filter(name => name.endsWith('.app'));
    const app = apps.find(name => name === `${chosen}.app`) || apps[0];
    if (!app) throw new Error(`The build finished, but no app was found in ${products}.`);
    const appPath = join(products, app);
    return { app: appPath, scheme: chosen, project: relative(root, path), bundleId: await this.bundleId(appPath, { signal }).catch(() => ''), warnings: (log.match(/: warning: /g) || []).length, command: ['xcrun', ...args].join(' ') };
  }
  // An app the agent may install: one this build made, or one inside the work folder.
  checkApp(appPath, root) {
    const full = resolve(root, appPath), inside = (parent, child) => child === parent || child.startsWith(parent + sep);
    if (!full.endsWith('.app')) throw new Error('Give the path of a built .app.');
    if (!inside(resolve(root), full) && !(this.buildRoot && inside(resolve(this.buildRoot), full))) throw new Error('Install an app from this work folder or one simulator_build made.');
    return full;
  }
  close() { for (const udid of [...this.helpers.keys()]) this.stopHelper(udid); this.watchers.clear(); }
}

// The lines of a failed build worth reading: its errors, with the file each is in.
export function buildProblems(output) {
  const lines = String(output || '').split('\n'), wanted = lines.filter(line => /(?:^|: )(?:error|fatal error):|^\*\* BUILD FAILED|xcodebuild: error|The following build commands failed/i.test(line));
  return [...new Set(wanted.map(line => line.trim()))].slice(0, 40).join('\n');
}
