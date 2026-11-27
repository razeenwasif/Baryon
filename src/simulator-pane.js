import './panels.css';
import { deviceLabel, devicePoint, frameSize, isTablet, keyFor } from './simulator-input.js';

// The Simulator panel: an iOS simulator's screen, live, beside the chat. Pick a device, start it, and use it here:
// a click taps, a drag swipes, and with the screen selected, typing goes to the device. Fairy's agent uses the same
// device through its simulator tools, and the panel follows whichever device it's working on. Nothing here needs the
// Simulator app open.
export function simulatorPane({ api, onError = () => {} }) {
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (className, text, onclick, title) => { const node = el('button', className, text); node.type = 'button'; node.onclick = onclick; if (title) node.title = title; return node; };
  let state = { available: true, devices: [], current: '' }, selected = '', watching = '', points = null, busy = '', note = '', appearance = '', loaded = false, visible = false;
  const root = el('div', 'panel-stack sim-pane');
  const screen = el('img', 'sim-screen'); screen.alt = 'The simulator’s screen'; screen.tabIndex = 0; screen.draggable = false;
  const stage = el('div', 'sim-stage');
  // The phone's outline around its screen: a dark body with the iPhone's rounded corners, a metal edge, and its action,
  // volume and power buttons where Xcode's own device frame puts them. Sized from the screen's width, so it scales with
  // the panel; the screen inside stays the only thing you click.
  const frame = el('div', 'sim-frame');
  for (const side of ['action', 'volume-up', 'volume-down', 'power']) { const knob = el('span', `sim-knob ${side}`); knob.setAttribute('aria-hidden', 'true'); frame.append(knob); }
  frame.prepend(screen);
  new ResizeObserver(() => {
    const { bezel, corner } = frameSize(screen.clientWidth, frame.classList.contains('tablet'));
    frame.style.setProperty('--sim-bezel', `${bezel}px`);
    frame.style.setProperty('--sim-corner', `${corner}px`);
  }).observe(screen);
  const device = () => state.devices.find(entry => entry.udid === selected);

  // Input goes in order: a touch's moves are coalesced so a drag never falls behind the pointer.
  let queue = Promise.resolve(), pendingMove = null, down = false;
  const send = run => { queue = queue.then(run).catch(error => onError(error.message)); return queue; };
  const touch = (phase, point) => {
    if (!point || !watching) return;
    if (phase === 'move') {
      const queued = pendingMove; pendingMove = point;
      if (queued) return;
      send(() => { const at = pendingMove; pendingMove = null; return at ? api.simulatorTouch(watching, 'move', at.x, at.y) : null; });
      return;
    }
    pendingMove = null;
    send(() => api.simulatorTouch(watching, phase, point.x, point.y));
  };
  screen.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); screen.focus(); screen.setPointerCapture(event.pointerId); down = true;
    touch('down', devicePoint(event, screen.getBoundingClientRect(), points));
  });
  screen.addEventListener('pointermove', event => { if (down) touch('move', devicePoint(event, screen.getBoundingClientRect(), points)); });
  const lift = event => { if (!down) return; down = false; touch('up', devicePoint(event, screen.getBoundingClientRect(), points)); };
  screen.addEventListener('pointerup', lift); screen.addEventListener('pointercancel', lift);
  screen.addEventListener('keydown', event => {
    if (!watching) return;
    const press = keyFor(event);
    if (!press) return;
    event.preventDefault();
    send(() => press.text ? api.simulatorType(watching, press.text) : api.simulatorKey(watching, press.key, press.modifiers));
  });
  screen.addEventListener('paste', event => { const text = event.clipboardData?.getData('text/plain'); if (text && watching) { event.preventDefault(); send(() => api.simulatorType(watching, text)); } });

  if (api) {
    api.onSimulatorFrame(frame => {
      if (frame.udid !== watching) return;
      if (frame.frameError) { note = frame.frameError; draw(); return; }
      screen.src = `data:image/jpeg;base64,${frame.frame}`;
      if (frame.points) points = frame.points;
      if (note) { note = ''; draw(); }
    });
    // A device started, stopped or picked by the agent.
    api.onSimulator(change => {
      if (change.current && change.current !== selected) selected = change.current;
      if (visible) void refresh();
    });
  }
  async function refresh() {
    try { state = await api.simulatorState(); loaded = true; }
    catch (error) { onError(error.message); }
    if (!state.devices.some(entry => entry.udid === selected)) selected = state.current || state.devices.find(entry => entry.booted)?.udid || state.devices[0]?.udid || '';
    await follow();
    draw();
  }
  // Streams the selected device while it's running and the panel is open.
  async function follow() {
    const wanted = visible && device()?.booted ? selected : '';
    if (wanted === watching) return;
    if (watching) { const old = watching; watching = ''; await api.simulatorUnwatch(old).catch(() => {}); }
    points = null; screen.removeAttribute('src');
    if (!wanted) return;
    watching = wanted;
    try {
      const info = await api.simulatorWatch(wanted);
      if (info?.points) points = info.points;
      appearance = await api.simulatorAppearance(wanted).catch(() => '');
    } catch (error) { watching = ''; note = error.message; }
  }
  async function act(label, run) {
    busy = label; draw();
    try { await run(); } catch (error) { onError(error.message); }
    busy = ''; await refresh();
  }
  function draw() {
    const focused = document.activeElement === screen;
    paint();
    if (focused && screen.isConnected) screen.focus();
  }
  function paint() {
    const head = el('div', 'panel-head'); head.append(el('h2', '', 'Simulator'));
    if (!loaded) { root.replaceChildren(head, el('p', 'panel-note busy', 'Looking for simulators…')); return; }
    if (!state.available) { root.replaceChildren(head, el('p', 'panel-note', state.reason || 'Simulators aren’t available on this Mac.')); return; }
    if (!state.devices.length) { root.replaceChildren(head, el('p', 'panel-note', 'This Mac has no iOS simulators. Add one in Xcode, under Window, Devices and Simulators.')); return; }
    const picker = el('select', 'sim-device'); picker.setAttribute('aria-label', 'Simulator');
    for (const entry of state.devices) { const option = el('option', '', deviceLabel(entry)); option.value = entry.udid; option.selected = entry.udid === selected; picker.append(option); }
    picker.onchange = () => { selected = picker.value; void follow().then(draw); };
    const current = device(), bar = el('div', 'sim-bar');
    const power = current?.booted ? button('panel-button quiet', busy === 'stop' ? 'Shutting down…' : 'Shut down', () => act('stop', () => api.simulatorShutdown(selected)))
      : button('panel-button primary', busy === 'start' ? 'Starting…' : 'Start', () => act('start', () => api.simulatorBoot(selected)));
    power.disabled = Boolean(busy);
    bar.append(picker, power);
    const parts = [head, bar];
    if (current?.booted) {
      frame.classList.toggle('tablet', isTablet(current));
      stage.replaceChildren(frame);
      const tools = el('div', 'panel-actions sim-tools');
      tools.append(
        button('panel-button quiet', 'Home', () => send(() => api.simulatorButton(selected, 'home')), 'Press the Home button'),
        button('panel-button quiet', 'Lock', () => send(() => api.simulatorButton(selected, 'lock')), 'Press the side button to lock or wake it'),
        button('panel-button quiet', appearance === 'dark' ? 'Light mode' : 'Dark mode', () => { const next = appearance === 'dark' ? 'light' : 'dark'; send(async () => { appearance = await api.simulatorAppearance(selected, next); draw(); }); }, 'Switch between light and dark mode'));
      parts.push(stage, tools, el('p', 'panel-note sim-hint', note || 'Click to tap and drag to swipe. Click the screen, then type to send keys. Fairy’s agent can use this device too, and asks first.'));
    } else parts.push(el('p', 'panel-note', busy === 'start' ? 'Starting the simulator. The first start after an update can take a minute.' : 'Start this simulator to see its screen here. The Simulator app needn’t be open.'));
    root.replaceChildren(...parts);
  }
  return {
    id: 'simulator', title: 'Simulator',
    leave() { visible = false; down = false; void follow(); },
    async render(body) {
      if (!api) { body.replaceChildren(el('p', 'pane-empty', 'The simulator is available in the desktop app.')); return; }
      visible = true;
      if (!root.isConnected) body.replaceChildren(root);
      if (!loaded) draw();
      await refresh();
    },
  };
}
