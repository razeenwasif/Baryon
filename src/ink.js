// Fairy's ink window: draws her marks on the real screen in glowing LED pixels, and her cards as little terminal
// windows in the free space beside it. Everything moves in steps, like pixel art.
import 'katex/dist/katex.min.css';
import '@fontsource/doto/latin-700.css';
import '@fontsource/martian-mono/latin-400.css';
import '@fontsource/martian-mono/latin-600.css';
import './ink.css';
import { cardBody, CARD_WIDTHS } from './ink-cards.js';
import { layoutCards, tieEnds } from './ink-layout.js';
import { TONE_COLOURS } from './ink-tones.js';
import { InkCursor, flyTime } from './ink-cursor.js';

const api = window.fairyInk;
const SVG = 'http://www.w3.org/2000/svg';
const CARD_KINDS = new Set(Object.keys(CARD_WIDTHS));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Marks on the page stop matching it once you scroll or switch windows, so they fade after a while; cards stay.
const MARK_LIFE_MS = 45000;
// One ink pixel, in screen points: every mark sits on this grid.
const P = 4;
const snap = value => Math.round(value / P) * P;
const $ = selector => document.querySelector(selector);
const svg = (tag, attrs = {}) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

document.body.innerHTML = '<svg id="ink-marks" aria-hidden="true" shape-rendering="crispEdges"><defs><filter id="ink-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg><div id="ink-labels"></div><div id="ink-cards"></div><button class="ink-clear" hidden>[ CLEAR ]</button>';
const marksLayer = $('#ink-marks'), labelsLayer = $('#ink-labels'), cardsLayer = $('#ink-cards'), clearButton = $('.ink-clear');
const drawn = new Map(); // id -> { sig, nodes: [], card, stop, tie, moved }
const pen = new InkCursor(document.body, { snap });
// One clock for the whole drawing, started on its first painted frame: it lights each pixel, writes each label and
// switches on each window at its moment, and moves the pen, so the pen is always on the stroke it's drawing. It also
// tells Fairy when to turn into the pen and back.
const clock = { start: null, queue: [], frame: 0, morphed: false };
const at = (time, fn) => { if (reduced) fn(); else clock.queue.push({ time, fn }); };
function runClock(withPen) {
  cancelAnimationFrame(clock.frame); clock.start = null;
  if (withPen && !clock.morphed) { clock.morphed = true; api.pen?.('out'); rider.hold(true); }
  const step = now => {
    clock.start ??= now;
    const t = now - clock.start;
    if (clock.queue.length) { const due = clock.queue.filter(item => item.time <= t); if (due.length) { clock.queue = clock.queue.filter(item => item.time > t); for (const item of due) item.fn(); } }
    const penDone = pen.update(t);
    if (penDone && clock.morphed && !pen.stay) { clock.morphed = false; api.pen?.('in'); rider.hold(false); }
    if (clock.queue.length || !penDone) clock.frame = requestAnimationFrame(step);
  };
  clock.frame = requestAnimationFrame(step);
}
let state = { parts: [], region: null, avoid: [] };

// A little unevenness, the same each time a part is drawn, so the ink looks hand-made.
const seeded = id => { let seed = [...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1; return () => (seed = (seed * 16807) % 2147483647) / 2147483647; };

// A path as pixels on the grid: sampled along its length, snapped, each pixel once.
let probe;
function along(d) {
  probe ||= marksLayer.appendChild(svg('path', { visibility: 'hidden', fill: 'none' }));
  probe.setAttribute('d', d);
  const length = probe.getTotalLength(), seen = new Set(), out = [];
  for (let along = 0; along <= length + 0.1; along += P * 0.7) {
    const point = probe.getPointAtLength(Math.min(along, length)), x = snap(point.x), y = snap(point.y), key = `${x},${y}`;
    if (!seen.has(key)) { seen.add(key); out.push([x, y]); }
  }
  return out;
}
// Lights pixels one after another: each turns on in a single step, never fades.
function light(group, points, { delay = 0, duration = 500, size = P - 1, every = 1, className = 'ink-px', order = (_, i, list) => i / list.length } = {}) {
  const shown = points.filter((_, i) => i % every === 0);
  shown.forEach((point, i) => {
    const pixel = svg('rect', { x: point[0] - size / 2, y: point[1] - size / 2, width: size, height: size, class: className });
    if (!reduced && !className.includes('ink-still')) { pixel.classList.add('ink-wait'); at(delay + order(point, i, shown) * duration, () => pixel.classList.remove('ink-wait')); }
    group.append(pixel);
  });
  return shown;
}
// The arrowhead as a little pixel triangle pointing along (dx, dy).
function arrowhead(end, dx, dy) {
  const length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length, out = [];
  for (let k = 0; k <= 3; k++) for (let j = -k; j <= k; j++) out.push([snap(end.x - ux * k * P + -uy * j * P), snap(end.y - uy * k * P + ux * j * P)]);
  return out;
}
// Types text into an element a character at a time.
function typeInto(node, text, delay, speed = 28) {
  if (reduced || !text) { node.textContent = text; return; }
  node.textContent = '';
  let shown = 0;
  at(delay, function step() { node.textContent = text.slice(0, ++shown); if (shown < text.length && node.isConnected) setTimeout(step, speed); });
}

// begin(point) is asked when the pen should start at a mark's first pixel, and gives the time it gets there; the pixels
// then light up as the pen traces them. The returned nodes carry that trace for the pen's route.
function screenMark(part, begin) {
  const tone = TONE_COLOURS[part.tone] || TONE_COLOURS.blue, r = part.rect, rand = seeded(part.id), nodes = [];
  const group = svg('g', { class: 'ink-mark', filter: 'url(#ink-glow)' }); group.style.setProperty('--tone', tone);
  marksLayer.append(group);
  let trace = [], delay = 0, duration = 0, after = 0;
  if (part.kind === 'underline') {
    const y = r.y + r.h + 4, wob = () => (rand() - 0.5) * 3;
    trace = along(`M${r.x - 2},${y + wob()} Q${r.x + r.w * 0.33},${y + wob() + 1} ${r.x + r.w * 0.55},${y + wob()} T${r.x + r.w + 3},${y + wob()}`);
    delay = begin(trace[0]); duration = 260 + Math.min(420, r.w);
    light(group, trace, { delay, duration });
  } else if (part.kind === 'highlight') {
    // A dithered block behind the words, filled in column by column as the pen sweeps across.
    const points = [], x0 = snap(r.x - 3), y0 = snap(r.y - 2);
    for (let x = x0; x <= r.x + r.w + 3; x += P) for (let y = y0; y <= r.y + r.h + 2; y += P) if ((x / P + y / P) % 2 === 0) points.push([x, y]);
    for (let x = x0; x <= r.x + r.w + 3; x += P) trace.push([x, snap(r.y + r.h / 2)]);
    group.removeAttribute('filter');
    delay = begin(trace[0]); duration = 360;
    light(group, points, { delay, duration, size: P, className: 'ink-px ink-dither', order: point => (point[0] - x0) / Math.max(P, r.w + 6) });
  } else if (part.kind === 'ring') {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 14, ry = r.h / 2 + 10, start = -2.3 + rand() * 0.4, points = [];
    for (let i = 0; i <= 44; i++) { const a = start + i / 44 * Math.PI * 2.12, k = 1 + (rand() - 0.5) * 0.05; points.push(`${(cx + Math.cos(a) * rx * k).toFixed(1)},${(cy + Math.sin(a) * ry * k).toFixed(1)}`); }
    trace = along(`M${points.join(' L')}`);
    delay = begin(trace[0]); duration = 620;
    light(group, trace, { delay, duration });
  } else if (part.kind === 'label' || part.kind === 'arrow') {
    let from = { x: r.x + r.w + 4, y: r.y + r.h / 2 }, to;
    if (part.kind === 'arrow') { const t = part.toRect; to = { x: t.x + (t.x > from.x ? -6 : t.w + 6), y: t.y + t.h / 2 }; }
    // A label sits in the margin beside the window being read, level with its words, so it never covers the text.
    else if (margin(r)) to = { x: margin(r), y: r.y + r.h / 2 };
    else to = { x: Math.min(innerWidth - 160, r.x + r.w + 46), y: Math.max(24, r.y - 26) };
    const bend = Math.max(30, Math.abs(to.x - from.x) * 0.4);
    trace = along(`M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`);
    delay = begin(trace[0]); duration = 420;
    light(group, trace, { delay, duration, every: part.kind === 'arrow' ? 1 : 2 });
    if (part.kind === 'arrow') { light(group, arrowhead(to, bend, to.y - from.y), { delay: delay + 420, duration: 80 }); after = 80; }
    if (part.text) {
      const label = el('div', 'ink-label'); label.style.setProperty('--tone', tone);
      const mid = part.kind === 'arrow' ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 28 } : { x: to.x + 6, y: to.y - 12 };
      label.style.left = `${snap(Math.min(innerWidth - 220, mid.x))}px`; label.style.top = `${snap(mid.y)}px`;
      const words = el('span'); label.append('▸ ', words);
      words.textContent = part.text.toUpperCase();
      labelsLayer.append(label); nodes.push(label);
      nodes.avoid = { x: label.offsetLeft - 8, y: label.offsetTop - 8, w: label.offsetWidth + 16, h: label.offsetHeight + 16 };
      if (!reduced) { label.classList.add('ink-wait'); at(delay + 400, () => label.classList.remove('ink-wait')); typeInto(words, part.text.toUpperCase(), delay + 420, 22); after = Math.max(after, 22 * part.text.length); }
    }
  }
  nodes.push(group);
  nodes.trace = { points: trace, t0: delay, t1: delay + duration };
  nodes.done = delay + duration + after;
  return nodes;
}

// Just outside the right edge of the window being read, when there's room there.
const margin = r => { const region = state.region; return region && r.x < region.x + region.w && region.x + region.w + 230 < innerWidth ? region.x + region.w + 14 : 0; };

const KIND_NAMES = { card: 'note', steps: 'steps', timeline: 'timeline', bars: 'chart', flow: 'flow', table: 'table', math: 'maths', model: '3d', plot: 'plot', quiz: 'quiz' };
function cardElement(part) {
  const tone = TONE_COLOURS[part.tone] || TONE_COLOURS.blue;
  const card = el('section', 'ink-card'); card.dataset.id = part.id; card.style.setProperty('--tone', tone);
  card.style.width = `${CARD_WIDTHS[part.kind]}px`;
  // A little terminal window: a title bar with its lights, the screen, and a blinking cursor.
  const frame = el('div', 'ink-frame'), screen = el('div', 'ink-screen');
  const head = el('header', 'ink-head'), lights = el('span', 'ink-lights'), title = el('span', 'ink-title'), close = el('button', 'ink-x', '[x]');
  lights.append(el('i'), el('i'), el('i'));
  close.setAttribute('aria-label', 'Close'); close.title = 'Close';
  close.onclick = () => api.close(part.id);
  head.append(lights, title, el('span', 'ink-kind', KIND_NAMES[part.kind]), close);
  const { node, stop, begin } = cardBody(part, { reduced, ask: text => api.ask?.(text) });
  const wave = el('div', 'ink-wave'); for (let i = 0; i < 14; i++) wave.append(el('i'));
  screen.append(head, node, wave, el('span', 'ink-cursor'));
  frame.append(screen); card.append(frame);
  card.typeTitle = delay => typeInto(title, (part.title || KIND_NAMES[part.kind]).toUpperCase(), delay, 30);
  dragBy(head, card, part.id);
  return { card, stop, begin };
}

function dragBy(handle, card, id) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const startX = event.clientX - card.offsetLeft, startY = event.clientY - card.offsetTop;
    handle.setPointerCapture(event.pointerId); card.classList.add('dragging');
    // Cards move on the pixel grid too.
    const move = e => { card.style.left = `${snap(Math.max(0, Math.min(innerWidth - 60, e.clientX - startX)))}px`; card.style.top = `${snap(Math.max(0, Math.min(innerHeight - 40, e.clientY - startY)))}px`; const entry = drawn.get(id); if (entry) { entry.moved = true; drawTie(entry, false); } placeClear(); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); card.classList.remove('dragging'); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

// A dotted line of pixels from a card to the words it explains, lit from the card outwards.
function drawTie(entry, animate, delay = 0) {
  entry.tie?.remove(); entry.tie = null;
  const rect = entry.part.tieRect; if (!rect || !entry.card) return;
  const box = { x: entry.card.offsetLeft, y: entry.card.offsetTop, w: entry.card.offsetWidth, h: entry.card.offsetHeight };
  const { start, end } = tieEnds(box, rect);
  const group = svg('g', { class: 'ink-mark ink-tie', filter: 'url(#ink-glow)' }); group.style.setProperty('--tone', TONE_COLOURS[entry.part.tone] || TONE_COLOURS.blue);
  const dx = (end.x - start.x) * 0.45;
  marksLayer.append(group); entry.tie = group;
  const quiet = { delay, duration: animate && !reduced ? 520 : 0 };
  const points = light(group, along(`M${start.x},${start.y} C${start.x + dx},${start.y} ${end.x - dx},${end.y} ${end.x},${end.y}`), { ...quiet, every: 3, className: animate ? 'ink-px' : 'ink-px ink-still' });
  light(group, [[snap(end.x), snap(end.y)]], { delay: delay + quiet.duration, duration: 0, size: P * 2 - 1, className: animate ? 'ink-px' : 'ink-px ink-still' });
  if (entry.faded) group.classList.add('faded');
  return { points, duration: quiet.duration };
}

// Cards switch off like an old screen, collapsing to a line; marks blink out.
function remove(id) {
  const entry = drawn.get(id); if (!entry) return;
  drawn.delete(id); clearTimeout(entry.fade);
  const nodes = [...entry.nodes, entry.tie].filter(Boolean);
  const gone = () => { for (const node of [...nodes, entry.card]) node?.remove(); entry.stop?.(); };
  if (reduced) return gone();
  for (const node of nodes) node.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 0.8 }, { opacity: 0 }], { duration: 240, easing: 'steps(1, end)', fill: 'forwards' });
  if (entry.card) entry.card.animate([{ clipPath: 'inset(0 0 0 0)', filter: 'brightness(1)' }, { clipPath: 'inset(48% 0 48% 0)', filter: 'brightness(1.8)', offset: 0.7 }, { clipPath: 'inset(50% 50% 50% 50%)', filter: 'brightness(2)' }], { duration: 280, easing: 'steps(6, end)', fill: 'forwards' });
  setTimeout(gone, 300);
}

function placeCards(fresh) {
  const cards = [...drawn.values()].filter(e => e.card && !e.moved);
  const labels = [...drawn.values()].filter(e => e.avoid).map(e => e.avoid);
  const avoid = [...(state.avoid || []), ...[...drawn.values()].filter(e => e.card && e.moved).map(e => ({ x: e.card.offsetLeft, y: e.card.offsetTop, w: e.card.offsetWidth, h: e.card.offsetHeight }))];
  const { places, over } = layoutCards({ width: innerWidth, height: innerHeight, region: state.region, avoid, minX: Math.max(0, ...labels.map(r => r.x + r.w + 12)),
    cards: cards.map(e => ({ id: e.part.id, w: CARD_WIDTHS[e.part.kind], h: e.card.offsetHeight, tie: e.part.tieRect })) });
  cardsLayer.classList.toggle('over', over);
  for (const entry of cards) {
    const place = places[entry.part.id]; if (!place) continue;
    const x = snap(place.x), y = snap(place.y), moving = !fresh.has(entry.part.id) && entry.card.style.left;
    entry.card.style.width = `${snap(place.w)}px`; entry.placedH = entry.card.offsetHeight;
    if (moving && !reduced) entry.card.animate([{ left: entry.card.style.left, top: entry.card.style.top }, { left: `${x}px`, top: `${y}px` }], { duration: 240, easing: 'steps(6, end)' });
    entry.card.style.left = `${x}px`; entry.card.style.top = `${y}px`;
  }
}
function placeClear() {
  const cards = [...drawn.values()].filter(e => e.card);
  clearButton.hidden = !drawn.size;
  if (!cards.length) { clearButton.style.left = `${innerWidth - 130}px`; clearButton.style.top = '40px'; return; }
  const last = cards.reduce((a, b) => a.card.offsetTop + a.card.offsetHeight > b.card.offsetTop + b.card.offsetHeight ? a : b).card;
  // Under the lowest card, or beside it when that card reaches the bottom of the screen.
  const below = last.offsetTop + last.offsetHeight + 10, room = below + 34 <= innerHeight;
  const beside = last.offsetLeft + last.offsetWidth + 10 + 100 <= innerWidth ? last.offsetLeft + last.offsetWidth + 10 : last.offsetLeft - 110;
  clearButton.style.left = `${room ? last.offsetLeft + last.offsetWidth - 96 : beside}px`;
  clearButton.style.top = `${room ? below : last.offsetTop + last.offsetHeight - 30}px`;
}

// A ring of pixels bursting out of a point (Fairy turning into the pen) or closing in on it (the pen turning back).
function burst(point, inward = false) {
  if (reduced || !point) return;
  const group = svg('g', { class: 'ink-mark ink-burst', filter: 'url(#ink-glow)' });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, pixel = svg('rect', { x: snap(point[0]) - 2, y: snap(point[1]) - 2, width: 4, height: 4, class: inward ? 'ink-burst-in' : 'ink-burst-out' });
    pixel.style.setProperty('--dx', `${snap(Math.cos(a) * 34)}px`); pixel.style.setProperty('--dy', `${snap(Math.sin(a) * 34)}px`);
    group.append(pixel);
  }
  marksLayer.append(group); setTimeout(() => group.remove(), 600);
}

// A bubble's tail: three dots, small to large, from the pen's tip to the corner the card grows from, then gone.
function tail(from, to, tone) {
  if (reduced) return;
  const group = svg('g', { class: 'ink-mark ink-tail', filter: 'url(#ink-glow)' }); group.style.setProperty('--tone', tone);
  [[0.3, 3], [0.6, 5], [0.88, 7]].forEach(([k, size]) => group.append(svg('rect', { x: snap(from[0] + (to[0] - from[0]) * k) - size / 2, y: snap(from[1] + (to[1] - from[1]) * k) - size / 2, width: size, height: size })));
  marksLayer.append(group); setTimeout(() => group.remove(), 900);
}
// Where the pen comes from and goes back to: Fairy riding beside the pointer, else Fairy (or the companion) when she's
// on this screen.
const home = () => { const riding = rider.at(); if (riding) return riding; if (state.home) return state.home; const rect = state.avoid?.[0]; return rect ? [rect.x + rect.w / 2, rect.y + rect.h / 2] : null; };

function render(next) {
  state = next;
  const wanted = new Map(next.parts.map(part => [part.id, part]));
  for (const [id, entry] of drawn) if (!wanted.has(id) || entry.sig !== JSON.stringify(wanted.get(id))) remove(id);
  if (!next.parts.length) { pen.stop(); clock.queue = []; if (clock.morphed) { clock.morphed = false; api.pen?.('in'); rider.hold(false); } }
  const fresh = new Set(), marks = [], cards = [];
  for (const part of next.parts) {
    if (drawn.has(part.id)) continue;
    fresh.add(part.id);
    const entry = { part, sig: JSON.stringify(part), nodes: [], delay: 0 };
    if (CARD_KINDS.has(part.kind)) { const { card, stop, begin } = cardElement(part); Object.assign(entry, { card, stop, begin }); card.style.visibility = 'hidden'; cardsLayer.append(card); cards.push(entry); }
    else marks.push(entry);
    drawn.set(part.id, entry);
    entry.fade = setTimeout(() => { entry.faded = true; for (const node of entry.nodes) node.classList.add('faded'); entry.tie?.classList.add('faded'); }, MARK_LIFE_MS);
  }
  // The pen's route: from Fairy to each mark on the page in turn, then to each window, tracing its outline before it
  // switches on and running its tie line out to the words; then it rests by the last window and flies home.
  const route = [], moving = !reduced && fresh.size > 0;
  const fromFairy = moving && !clock.morphed && Boolean(home());
  let t = fromFairy ? 680 : 150, where = moving ? (clock.morphed && pen.at ? pen.at : home()) : null;
  const goTo = point => {
    if (!moving) return 0;
    if (!where) { where = point; return t; }
    const d = flyTime(where, point); route.push({ fly: [where, point], t0: t, t1: t + d }); t += d; where = point; return t;
  };
  const traced = ({ points, t0, t1 }) => { if (moving && points.length) { route.push({ trace: points, t0, t1 }); where = points.at(-1); } };
  for (const entry of marks) {
    entry.nodes = screenMark(entry.part, goTo); entry.avoid = entry.nodes.avoid;
    traced(entry.nodes.trace); if (moving) t = entry.nodes.done + 80;
  }
  // Cards are measured hidden and placed, then the pen draws each one.
  placeCards(fresh);
  for (const entry of cards) {
    const card = entry.card, box = { x: card.offsetLeft, y: card.offsetTop, w: card.offsetWidth, h: card.offsetHeight };
    if (moving) {
      // The pen stops just off the card's nearest corner, and the card grows out of its tip like a speech bubble, joined
      // to it by a tail of dots while it does.
      const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
      const from = where || [box.x - 40, box.y - 30];
      const corner = corners.reduce((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) <= Math.hypot(b[0] - from[0], b[1] - from[1]) ? a : b);
      const away = [corner[0] === box.x ? -1 : 1, corner[1] === box.y ? -1 : 1];
      const tip = [snap(Math.max(8, Math.min(innerWidth - 8, corner[0] + away[0] * 30))), snap(Math.max(8, Math.min(innerHeight - 8, corner[1] + away[1] * 22)))];
      const t0 = goTo(tip), grow = 560;
      route.push({ trace: [tip], t0, t1: t0 + grow }); where = tip;
      at(t0, () => tail(tip, corner, TONE_COLOURS[entry.part.tone] || TONE_COLOURS.blue));
      entry.origin = [corner[0] - box.x, corner[1] - box.y];
      t = t0 + grow;
      entry.delay = t0 + 60;
    }
    if (!moving) entry.delay = 0;
    card.typeTitle(entry.delay + 200);
    at(entry.delay, () => {
      card.style.visibility = '';
      entry.begin?.(300);
      if (reduced) return;
      // A bubble growing out of the pen: a small blob at the corner nearest it, swelling to the whole card in steps.
      const [ox, oy] = entry.origin || [0, 0], w = card.offsetWidth, h = card.offsetHeight;
      const blob = (bw, bh) => `inset(${oy ? h - bh : 0}px ${ox ? 0 : w - bw}px ${oy ? 0 : h - bh}px ${ox ? w - bw : 0}px)`;
      card.animate([{ clipPath: blob(26, 20), filter: 'brightness(1.9)' }, { clipPath: blob(w * 0.45, h * 0.35), filter: 'brightness(1.5)', offset: 0.45 }, { clipPath: blob(w, h), filter: 'brightness(1)' }],
        { duration: 500, easing: 'steps(8, end)' });
      [...card.querySelector('.ink-body').children].forEach((child, i) => { const delay = `${380 + i * 120}ms`; child.classList.add('ink-row'); child.style.animationDelay = delay; for (const fill of child.querySelectorAll('.ink-fill')) fill.style.animationDelay = delay; });
    });
    const tieAt = entry.delay + 380, tie = drawTie(entry, true, tieAt);
    if (moving && tie?.points.length) {
      route.push({ fly: [where, tie.points[0]], t0: t, t1: tieAt }); where = tie.points[0];
      traced({ points: tie.points, t0: tieAt, t1: tieAt + tie.duration }); t = tieAt + tie.duration + 60;
    } else if (moving) t = entry.delay + 320;
  }
  for (const entry of drawn.values()) if (entry.card && !fresh.has(entry.part.id)) drawTie(entry, false);
  placeClear();
  if (moving && route.length) {
    // Rest beside the last window drawn (or the last mark), then fly back to Fairy.
    const last = cards.at(-1)?.card;
    if (last) goTo([snap(last.offsetLeft + last.offsetWidth + 10), snap(last.offsetTop + 8)]);
    t += 2600;
    const back = home();
    if (back) goTo(back); else route.push({ trace: [where], t0: t, t1: t + 1 });
    pen.load(route);
    // Fairy bursts into the pen as she squashes away, and the pen bursts back into her at the end.
    if (fromFairy) { const start = home(); at(220, () => burst(start)); if (back) at(t - 80, () => burst(back, true)); }
  }
  if (fresh.size) runClock(moving && route.length > 0);
}

// Clicks go through to your apps except over a card or the Clear button.
let interactive = false;
const setInteractive = value => { if (value !== interactive) { interactive = value; api.interactive(value); } };
document.addEventListener('mousemove', event => { if (!areaActive) setInteractive(Boolean(event.target.closest?.('.ink-card, .ink-clear, .ink-guide-card'))); });
document.addEventListener('mouseleave', () => setInteractive(false));
clearButton.onclick = () => { setInteractive(false); api.clear(); };
// Show me how: each step is drawn here. The pen flies to the control, rings it, and rests pointing at it while a small
// terminal caption says the step, with [next] and [stop]; at the end the pen flies back and turns into Fairy again.
const guideLayer = el('div'); guideLayer.id = 'ink-guide'; document.body.insertBefore(guideLayer, pen.node);
let guideHome = null, guideMarks = null;
function guideStep(step) {
  guideHome = rider.at() || step.home || guideHome;
  guideMarks?.remove(); guideMarks = null; guideLayer.replaceChildren();
  clock.queue = [];
  const route = [], fromFairy = !reduced && !clock.morphed && Boolean(guideHome);
  let t = fromFairy ? 680 : 60, where = clock.morphed && pen.at ? pen.at : guideHome;
  const goTo = point => {
    if (reduced) return 0;
    if (!where) { where = point; return t; }
    const d = flyTime(where, point); route.push({ fly: [where, point], t0: t, t1: t + d }); t += d; where = point; return t;
  };
  if (fromFairy) at(220, () => burst(guideHome));
  if (step.done) {
    const card = el('section', 'ink-guide-card ink-guide-done'); card.textContent = step.finished ? 'DONE ✓' : 'STOPPED';
    card.style.left = `${snap(innerWidth / 2 - 60)}px`; card.style.top = '40px'; guideLayer.append(card);
    if (guideHome && clock.morphed) { goTo(guideHome); route.push({ trace: [guideHome], t0: t, t1: t + 1 }); at(t - 80, () => burst(guideHome, true)); }
    pen.load(route); runClock(route.length > 0);
    setTimeout(() => { if (guideLayer.contains(card)) guideLayer.replaceChildren(); }, 1600);
    return;
  }
  const r = step.rect;
  if (r) {
    // A ring around the control, drawn by the pen, then pulsing while Fairy waits for your click.
    const group = svg('g', { class: 'ink-mark ink-guide-ring', filter: 'url(#ink-glow)' }); group.style.setProperty('--tone', TONE_COLOURS.cyan);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 10, ry = r.h / 2 + 8, points = [];
    for (let i = 0; i <= 44; i++) { const a = -2.2 + i / 44 * Math.PI * 2.1; points.push(`${(cx + Math.cos(a) * rx).toFixed(1)},${(cy + Math.sin(a) * ry).toFixed(1)}`); }
    const ring = along(`M${points.join(' L')}`), t0 = goTo(ring[0]), duration = 520;
    marksLayer.append(group); guideMarks = group;
    light(group, ring, { delay: t0, duration });
    if (!reduced) { route.push({ trace: ring, t0, t1: t0 + duration }); where = ring.at(-1); t = t0 + duration; }
    at(t, () => group.classList.add('ink-pulse'));
    // Rest with the tip on the control's lower right, pointing at it without covering its name.
    goTo([snap(r.x + r.w - 6), snap(r.y + r.h - 4)]);
  }
  const card = el('section', 'ink-guide-card');
  const head = el('div', 'ink-guide-head', `STEP ${step.index + 1}/${step.total}`);
  const words = el('div', 'ink-guide-say', step.say);
  card.append(head, words);
  if (step.type) card.append(el('div', 'ink-guide-type', `type: “${step.type}”, then [next]`));
  if (!r) card.append(el('div', 'ink-guide-missing', step.missing ? `I can’t see “${step.missing}” yet. Do this yourself, then [next].` : 'Do this yourself, then [next].'));
  const actions = el('div', 'ink-guide-actions'), next = el('button', '', step.index + 1 < step.total ? '[next ▸]' : '[done ✓]'), stop = el('button', '', '[stop]');
  next.type = stop.type = 'button';
  next.onclick = () => { next.disabled = true; setInteractive(false); api.guide?.('next'); };
  stop.onclick = () => { stop.disabled = true; setInteractive(false); api.guide?.('stop'); };
  actions.append(stop, next); card.append(actions);
  card.style.visibility = 'hidden'; guideLayer.append(card);
  // Beside the control: below it when there's room, else above; with no control, at the top of the screen.
  const w = card.offsetWidth, h = card.offsetHeight;
  const x = r ? Math.max(16, Math.min(innerWidth - w - 16, r.x)) : innerWidth / 2 - w / 2;
  const y = r ? (r.y + r.h + 18 + h < innerHeight - 16 ? r.y + r.h + 18 : Math.max(16, r.y - 18 - h)) : 48;
  card.style.left = `${snap(x)}px`; card.style.top = `${snap(y)}px`;
  at(r ? t - 120 : 0, () => { card.style.visibility = ''; });
  pen.load(route, { stay: true }); runClock(route.length > 0);
}
api.onGuide?.(step => guideStep(step));

// Quicker ways to ask. While ⌃⌥ is held: a LISTENING badge by the pointer and a trail of dots behind it; let go after
// going round something and a ring stays round it for a moment, since that's what "this" means in the question.
const quickMarks = svg('g', { class: 'ink-mark ink-quick', filter: 'url(#ink-glow)' }); quickMarks.style.setProperty('--tone', TONE_COLOURS.cyan); marksLayer.append(quickMarks);
const listenBadge = el('div', 'ink-listen'); listenBadge.innerHTML = '<i></i>LISTENING'; listenBadge.hidden = true; document.body.append(listenBadge);
let quickFade = 0;
api.onQuick?.(state => {
  clearTimeout(quickFade); quickMarks.replaceChildren();
  listenBadge.hidden = !state.listening;
  if (state.listening && state.at) { listenBadge.style.left = `${snap(Math.min(innerWidth - 120, state.at.x + 18))}px`; listenBadge.style.top = `${snap(Math.min(innerHeight - 30, state.at.y + 20))}px`; }
  (state.trail || []).forEach((point, i, all) => { if (i % 2 || i === all.length - 1) return; const pixel = svg('rect', { x: snap(point.x) - 1.5, y: snap(point.y) - 1.5, width: 3, height: 3, class: 'ink-px ink-still' }); pixel.style.opacity = String(0.25 + 0.75 * i / all.length); quickMarks.append(pixel); });
  if (state.circle) {
    const r = state.circle, cx = r.x + r.w / 2, cy = r.y + r.h / 2, points = [];
    for (let i = 0; i <= 44; i++) { const a = i / 44 * Math.PI * 2; points.push(`${(cx + Math.cos(a) * (r.w / 2 + 10)).toFixed(1)},${(cy + Math.sin(a) * (r.h / 2 + 8)).toFixed(1)}`); }
    light(quickMarks, along(`M${points.join(' L')}`), { className: 'ink-px ink-still' });
    quickFade = setTimeout(() => quickMarks.replaceChildren(), 3500);
  }
});

// Ride along: Fairy, cursor-sized, beside the pointer. A pixel eye that trails it a little, looks the way it's going,
// bobs and blinks. The pointer's position comes from the moves the click-through window still hears.
const rider = (() => {
  const box = el('div', 'ink-rider'), eye = svg('svg', { viewBox: '0 0 9 9', width: 22, height: 22, 'shape-rendering': 'crispEdges' });
  const ring = svg('g', { class: 'ink-rider-ring' }), iris = svg('g', { class: 'ink-rider-iris' }), lid = svg('g', { class: 'ink-rider-lid' });
  const dots = (group, cells) => cells.forEach(([x, y]) => group.append(svg('rect', { x, y, width: 1, height: 1 })));
  dots(ring, [[3,0],[4,0],[5,0],[1,1],[2,1],[6,1],[7,1],[1,2],[7,2],[0,3],[8,3],[0,4],[8,4],[0,5],[8,5],[1,6],[7,6],[1,7],[2,7],[6,7],[7,7],[3,8],[4,8],[5,8]]);
  dots(iris, [[3,3],[4,3],[5,3],[3,4],[5,4],[3,5],[4,5],[5,5]]);
  const pupil = svg('rect', { x: 4, y: 4, width: 1, height: 1, class: 'ink-rider-pupil' }); iris.append(pupil);
  dots(lid, [[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4]]);
  eye.append(ring, iris, lid); box.append(eye); box.hidden = true; document.body.append(box);
  let on = false, fresh = false, held = false, x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, frame = 0, settled = true, blinkTimer = 0;
  const place = () => { box.style.transform = `translate(${snap(x)}px, ${snap(y)}px)`; };
  const step = () => {
    frame = 0;
    const dx = tx - x, dy = ty - y;
    x += dx * 0.22; y += dy * 0.22;
    // The eye looks where the pointer is heading, one pixel at most.
    const look = Math.hypot(dx, dy) > 3 ? [Math.sign(dx) * (Math.abs(dx) > Math.abs(dy) / 2 ? 1 : 0), Math.sign(dy) * (Math.abs(dy) > Math.abs(dx) / 2 ? 1 : 0)] : [0, 0];
    iris.setAttribute('transform', `translate(${look[0]} ${look[1]})`);
    place();
    settled = Math.hypot(dx, dy) < 0.5;
    if (!settled && on) frame = requestAnimationFrame(step);
  };
  const blink = () => { if (!on) return; box.classList.add('blink'); setTimeout(() => box.classList.remove('blink'), 140); blinkTimer = setTimeout(blink, 2800 + Math.random() * 3200); };
  const follow = (px, py) => {
    if (!on || !Number.isFinite(px) || !Number.isFinite(py)) return;
    tx = px + 16; ty = py + 18;
    // The first position after she arrives is where she appears, not somewhere she glides from.
    if (fresh) { fresh = false; x = tx; y = ty; settled = true; place(); return; }
    // A glide starts whenever none is running. (Waiting for "settled" as well left her stuck for good when Ride along
    // went off and on mid-glide: the glide was cancelled but she never counted as settled again.)
    if (!frame) { settled = false; frame = requestAnimationFrame(step); }
  };
  // Main sends the pointer's position while she rides; moves heard here directly (when Fairy is in front) help too.
  document.addEventListener('mousemove', event => follow(event.clientX, event.clientY));
  api.onRideAt?.(point => follow(Number(point?.x), Number(point?.y)));
  return {
    // Where she's riding to (she's a few frames behind the pointer), for the Explain pen to start from and come back
    // to; null when she isn't riding.
    at: () => on ? [snap(tx + 11), snap(ty + 11)] : null,
    // Hidden while she's out as the pen, following the pointer all the same, so she comes back beside it.
    hold(value) { held = Boolean(value); box.classList.toggle('held', held && on); },
    set(value) {
      on = Boolean(value); clearTimeout(blinkTimer); cancelAnimationFrame(frame); frame = 0; settled = true;
      box.classList.toggle('arriving', on); box.classList.toggle('held', held && on); box.hidden = !on;
      if (on) { fresh = true; place(); setTimeout(() => box.classList.remove('arriving'), 420); blinkTimer = setTimeout(blink, 2200); }
    },
  };
})();
api.onRide?.(state => rider.set(state?.on));

// ⌃⌥A: drag over an area of the screen to ask about it; Esc cancels.
let areaActive = false;
api.onAreaStart?.(() => {
  document.querySelector('.ink-area')?.remove();
  areaActive = true;
  const veil = el('div', 'ink-area'), box = el('div', 'ink-area-box'), hint = el('div', 'ink-area-hint', 'DRAG OVER WHAT TO ASK ABOUT · ESC TO CANCEL');
  veil.append(box, hint); document.body.append(veil); veil.tabIndex = -1; veil.focus();
  let start = null, rect = null;
  const finish = value => { if (!areaActive) return; areaActive = false; veil.remove(); api.area?.(value); };
  veil.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY }; veil.setPointerCapture(event.pointerId); box.style.display = 'block'; });
  veil.addEventListener('pointermove', event => {
    if (!start) return;
    rect = { x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), w: Math.abs(event.clientX - start.x), h: Math.abs(event.clientY - start.y) };
    Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  });
  veil.addEventListener('pointerup', () => finish(rect && rect.w >= 8 && rect.h >= 8 ? rect : null));
  veil.addEventListener('keydown', event => { if (event.key === 'Escape') finish(null); });
  window.addEventListener('blur', () => finish(null), { once: true });
});

// Fairy's voice: while she speaks, the newest card's last line becomes pixel bars that follow how loud she is.
let quiet = 0;
api.onVoice?.(level => {
  const entry = [...drawn.values()].filter(e => e.card?.isConnected).at(-1);
  if (!entry) return;
  const card = entry.card, bars = card.querySelectorAll('.ink-wave i');
  if (level > 0.03) {
    card.classList.add('speaking'); clearTimeout(quiet);
    quiet = setTimeout(() => card.classList.remove('speaking'), 700);
    bars.forEach((bar, i) => { const shape = 0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + performance.now() / 140)); bar.style.height = `${3 * Math.max(1, Math.min(4, Math.round(level * 6 * shape)))}px`; });
  }
});

// The pixel fonts load as soon as the window opens, and a drawing waits for them, so windows are measured at their real size.
for (const font of ['700 15px Doto', '400 11px "Martian Mono"', '600 11px "Martian Mono"']) document.fonts.load(font).catch(() => {});
// A window that grows after it's placed (late fonts or maths) gets the others moved out of its way.
let relayout = 0;
const grown = new ResizeObserver(() => {
  if (![...drawn.values()].some(entry => entry.card && entry.placedH !== undefined && Math.abs(entry.card.offsetHeight - entry.placedH) > 6)) return;
  clearTimeout(relayout); relayout = setTimeout(() => {
  placeCards(new Set()); for (const entry of drawn.values()) if (entry.card && entry.tie) drawTie(entry, false); placeClear();
}, 150); });
api.onScene(async next => { await document.fonts.ready; render(next); for (const entry of drawn.values()) if (entry.card && !entry.watched) { entry.watched = true; grown.observe(entry.card); } if (!next.parts.length) setInteractive(false); });
