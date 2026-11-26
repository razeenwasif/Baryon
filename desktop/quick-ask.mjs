// Quicker ways to ask Fairy, from any app (as Roamies does):
//   hold ⌃⌥      talk while held, sent when you let go; circle something with the pointer meanwhile and "this" is it
//   tap ⌥⌘       a small text box at the pointer
//   ⌃⌥A          drag over an area of the screen, then ask about it in the box beside it
// The keys come from native/Guide.swift's listen-only watcher ({"keys": true}). Electron parts are passed in.
import { spawn } from 'node:child_process';
import { nativeBin } from './bundle-path.cjs';

const HELPER = nativeBin('fairy-guide');

// Whether a pointer path went round something: long enough, wide and tall enough, and ending near where it began (or
// turning most of the way round). Returns the area it went round, or null.
export function circledArea(points) {
  if (points.length < 8) return null;
  let length = 0, turned = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x), b = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turned += d;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  if (w < 24 || h < 24 || length < 120) return null;
  const closed = Math.hypot(points.at(-1).x - points[0].x, points.at(-1).y - points[0].y) < Math.max(60, 0.45 * Math.min(w, h));
  return closed || Math.abs(turned) > Math.PI * 1.5 ? { x, y, w, h } : null;
}

export class QuickAsk {
  // electron: { BrowserWindow, screen, ipcMain }; ink: the InkOverlay; voice(): Fairy's main window, which owns the
  // microphone; asker(): the window that answers (the companion while it's out, otherwise the main window); allowed():
  // false while the Mac is locked or asleep; preload/page: the quick box's files.
  // keys(): which keys to listen for, from Settings ({ hold, tap, area }; see quickKeys in main.cjs).
  constructor({ electron, ink, voice, asker = voice, allowed = () => true, keys = () => ({ hold: 'control+option', tap: 'option+command', area: true }), preload, page, spawnProcess = spawn }) {
    Object.assign(this, { electron, ink, voice, asker, allowed, keys, preload, page, spawnProcess });
    this.trail = []; this.focus = null; this.box = null;
    electron.ipcMain.on('fairy:quick-submit', (event, text) => {
      if (!this.box || this.box.isDestroyed() || event.sender !== this.box.webContents) return;
      const question = String(text || '').trim().slice(0, 4000), area = this.boxArea;
      this.closeBox();
      if (!question) return;
      if (area) this.focus = { rect: area, how: 'selected', at: Date.now() };
      this.ask(question, area ? 'explain' : null);
    });
    // What was heard while ⌃⌥ was held; asked about what was circled, if anything was.
    electron.ipcMain.on('fairy:quick-heard', (event, text) => {
      const window = this.voice();
      if (!window || window.isDestroyed() || event.sender !== window.webContents) return;
      const question = String(text || '').trim().slice(0, 4000), mode = this.heardMode; this.heardMode = null;
      if (question) this.ask(question, mode);
    });
    electron.ipcMain.on('fairy:quick-close', event => { if (this.box && !this.box.isDestroyed() && event.sender === this.box.webContents) this.closeBox(); });
  }
  start() {
    if (process.platform !== 'darwin' || this.child) return;
    this.stopped = false; clearTimeout(this.retry);
    const keys = this.keys();
    if (keys.hold === 'off' && keys.tap === 'off' && !keys.area) return;
    const child = this.child = this.spawnProcess(HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', errors = '';
    // If the watcher stops on its own, say why (its exit and last words), so a missing permission isn't silent.
    child.stderr?.setEncoding?.('utf8'); child.stderr?.on?.('data', chunk => { errors = (errors + chunk).slice(-1000); });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      const said = errors.trim().slice(-300);
      if (said !== this.lastProblem) console.warn(`The quick-keys watcher stopped (${signal || `exit ${code}`})${said ? `: ${said}` : ''}`);
      this.lastProblem = said;
      // Usually Accessibility isn't granted yet: try again every half minute, so the keys work as soon as it is.
      if (!this.stopped) { clearTimeout(this.retry); this.retry = setTimeout(() => this.start(), 30_000); this.retry.unref?.(); }
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.hold === 'start') this.holdStart();
        else if (event.hold === 'end' || event.hold === 'cancel') this.holdEnd(event.hold === 'cancel');
        else if (event.tap === 'type') this.openBox();
        else if (event.area) void this.askArea();
      }
    });
    child.on('error', () => { this.child = null; });
    child.on('close', () => { if (this.child === child) this.child = null; });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ keys: true, hold: keys.hold, tap: keys.tap, area: keys.area }) + '\n');
  }
  // After the keys change in Settings: the watcher starts again with the new ones (or not at all, if all are off).
  restart() { const child = this.child; this.child = null; child?.stdin.end(); child?.kill?.(); clearTimeout(this.retry); this.start(); }
  stop() { this.stopped = true; clearTimeout(this.retry); this.child?.stdin.end(); this.child = null; clearInterval(this.sampler); this.sampler = null; this.closeBox(); }
  talk(value) { const window = this.voice(); if (window && !window.isDestroyed()) window.webContents.send('fairy:quick-talk', value); }
  ask(text, mode) { const window = this.asker(); if (window && !window.isDestroyed()) window.webContents.send('fairy:quick-ask', { text, mode }); }
  // What was circled or selected for the question being asked now, once, if it's fresh.
  // The rect is in global screen points; display is the one Explain looks at, so it comes back in that display's points.
  takeFocus(display) {
    const focus = this.focus; this.focus = null;
    if (!focus || Date.now() - focus.at > 45_000 || !display) return null;
    const b = display.bounds, r = focus.rect;
    if (r.x + r.w <= b.x || r.y + r.h <= b.y || r.x >= b.x + b.width || r.y >= b.y + b.height) return null;
    return { rect: { x: r.x - b.x, y: r.y - b.y, w: r.w, h: r.h }, how: focus.how, size: { width: b.width, height: b.height } };
  }

  // Hold ⌃⌥: Fairy listens, and a trail follows the pointer in case you circle something.
  holdStart() {
    if (!this.allowed()) return;
    const { screen } = this.electron, at = screen.getCursorScreenPoint();
    this.display = screen.getDisplayNearestPoint(at); this.trail = [at];
    this.heardMode = null; this.talk({ phase: 'start' });
    this.drawTrail(true);
    clearInterval(this.sampler);
    this.sampler = setInterval(() => {
      const point = screen.getCursorScreenPoint(), last = this.trail.at(-1);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 3 && this.trail.length < 600) { this.trail.push(point); this.drawTrail(true); }
    }, 40);
  }
  holdEnd(cancelled) {
    if (!this.sampler) return;
    clearInterval(this.sampler); this.sampler = null;
    const circle = cancelled ? null : circledArea(this.trail);
    if (circle) { this.focus = { rect: circle, how: 'circled', at: Date.now() }; this.heardMode = 'explain'; }
    this.drawTrail(false, circle);
    this.talk({ phase: cancelled ? 'cancel' : 'stop' });
  }
  drawTrail(listening, circle = null) {
    const bounds = this.display?.bounds; if (!bounds) return;
    const local = point => ({ x: point.x - bounds.x, y: point.y - bounds.y });
    const at = this.trail.at(-1);
    void this.ink.quick({ listening, at: at && local(at), trail: listening ? this.trail.map(local) : [], circle: circle && { ...local(circle), w: circle.w, h: circle.h } }, bounds, this.display.id);
  }

  // Tap ⌥⌘: a small text box at the pointer (or beside an area you selected).
  openBox(area = null) {
    if (!this.allowed()) return;
    const { BrowserWindow, screen } = this.electron, at = area ? { x: area.x + area.w + 12, y: area.y } : screen.getCursorScreenPoint();
    const work = screen.getDisplayNearestPoint(at).workArea, width = 380, height = 54;
    const x = Math.max(work.x + 8, Math.min(work.x + work.width - width - 8, at.x + (area ? 0 : 14))), y = Math.max(work.y + 8, Math.min(work.y + work.height - height - 8, at.y + (area ? 0 : 18)));
    this.closeBox();
    const box = this.box = new BrowserWindow({ x, y, width, height, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Ask Fairy',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.boxArea = area;
    box.setAlwaysOnTop(true, 'screen-saver');
    box.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    box.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    box.webContents.on('will-navigate', event => event.preventDefault());
    box.on('blur', () => { if (this.box === box) this.closeBox(); });
    box.on('closed', () => { if (this.box === box) { this.box = null; this.boxArea = null; } });
    // Fairy is in the background when you tap the keys, so it takes the focus for the box, or typing would go elsewhere.
    box.loadFile(this.page, { query: area ? { area: '1' } : {} }).then(() => { if (box.isDestroyed()) return; this.electron.app?.focus({ steal: true }); box.show(); box.focus(); });
  }
  closeBox() { const box = this.box; this.box = null; this.boxArea = null; if (box && !box.isDestroyed()) box.close(); }

  // ⌃⌥A: drag over an area, then ask about it.
  async askArea() {
    if (!this.allowed()) return;
    const { screen } = this.electron, display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const rect = await this.ink.selectArea(display.bounds, display.id);
    if (!rect || rect.w < 8 || rect.h < 8) return;
    this.openBox({ x: rect.x + display.bounds.x, y: rect.y + display.bounds.y, w: rect.w, h: rect.h });
  }
}
