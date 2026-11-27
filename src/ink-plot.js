// An animated maths plot in Fairy's pixel ink: curves, contours, a feasible region, points, vectors, a path of iterates
// that steps along, and an objective's level line sweeping across. Drawn on a small canvas blown up with square pixels,
// at 12 frames a second. Expressions go through desktop/ink-math.mjs, so nothing a model writes is run.
import { compile, compileRule } from '../desktop/ink-math.mjs';
import { TONE_COLOURS } from './ink-tones.js';

const SCALE = 2, FPS = 12, HOLD = 30;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const AXIS = [110, 120, 170];

// Pixels of the line from a to b (Bresenham).
function line([x0, y0], [x1, y1]) {
  const out = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let n = 0; n < 2000; n++) { out.push([x, y]); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
  return out;
}
const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// The range of y to show when the sketch didn't give one: the middle of the curves' values, with room around them.
export function autoRange(curves, [x0, x1]) {
  const values = [];
  for (const curve of curves) for (let i = 0; i <= 200; i++) { const y = curve(x0 + (x1 - x0) * i / 200); if (Number.isFinite(y)) values.push(y); }
  if (!values.length) return [x0, x1];
  values.sort((a, b) => a - b);
  let lo = values[Math.floor(values.length * 0.03)], hi = values[Math.ceil(values.length * 0.97) - 1];
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

// Levels for contours: given ones, or levels packed toward the minimum so the rings close in on it.
export function contourLevels(values, wanted) {
  if (Array.isArray(wanted) && wanted.length) return [...wanted].sort((a, b) => b - a);
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const lo = sorted[0], hi = sorted[Math.floor(sorted.length * 0.85)], n = wanted || 8;
  return Array.from({ length: n }, (_, k) => lo + (hi - lo) * Math.pow((n - k) / (n + 1), 2));
}

export function plotView(canvas, overlay, part, { reduced = false, delay = 0 } = {}) {
  const width = Math.max(120, Math.floor((canvas.clientWidth || 348) / SCALE)), height = Math.max(80, Math.floor((canvas.clientHeight || 232) / SCALE));
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d'), image = g.createImageData(width, height);
  const curves = part.curves.map(c => ({ ...c, f: compile(c.fn, ['x']) }));
  const [x0, x1] = part.x, [y0, y1] = part.y || (curves.length ? autoRange(curves.map(c => c.f), part.x) : part.x);
  const toGrid = (x, y) => [Math.round((x - x0) / (x1 - x0) * (width - 1)), Math.round((1 - (y - y0) / (y1 - y0)) * (height - 1))];
  const fromGrid = (gx, gy) => [x0 + (gx + 0.5) / width * (x1 - x0), y1 - (gy + 0.5) / height * (y1 - y0)];
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  // Still pixels: [x, y, r, g, b, alpha, tick it appears].
  const still = [];
  const put = (x, y, colour, alpha, tick) => { if (inside(x, y)) still.push([x, y, ...colour, alpha, tick]); };
  // Axes where 0 is in view, else along the edges.
  const [ax, ay] = toGrid(Math.min(Math.max(0, x0), x1), Math.min(Math.max(0, y0), y1));
  for (let x = 0; x < width; x++) put(x, ay, AXIS, x % 2 ? 0.55 : 0.9, Math.floor(x / width * 3));
  for (let y = 0; y < height; y++) put(ax, y, AXIS, y % 2 ? 0.55 : 0.9, Math.floor((height - y) / height * 3));
  let tick = 4;
  // The feasible region, dithered, filling in over a few frames.
  const rules = part.constraints.map(c => compileRule(c.rule));
  if (rules.length) {
    const region = rgb(TONE_COLOURS.green);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((x + y) % 2) continue;
      const [px, py] = fromGrid(x, y);
      if (rules.every(rule => rule.test(px, py))) put(x, y, region, 0.32, tick + hash(x, y) % 6);
    }
    tick += 6;
    // Each constraint's boundary, where it changes sign between neighbouring pixels.
    rules.forEach((rule, i) => {
      const colour = rgb(TONE_COLOURS[['cyan', 'violet', 'amber', 'rose', 'white', 'blue'][i % 6]]);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const [px, py] = fromGrid(x, y), [qx, qy] = fromGrid(x + 1, y + 1);
        const here = rule.boundary(px, py), right = rule.boundary(qx, py), down = rule.boundary(px, qy);
        if (Math.sign(here) !== Math.sign(right) || Math.sign(here) !== Math.sign(down)) put(x, y, colour, 1, tick + Math.floor(x / width * 4));
      }
      tick += 3;
    });
  }
  // Contours, outermost first, closing in on the minimum.
  if (part.contours) {
    const f = compile(part.contours.fn, ['x', 'y']), values = new Float64Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = f(...fromGrid(x, y));
    const levels = contourLevels(Array.from(values), part.contours.levels), base = rgb(TONE_COLOURS[part.contours.tone] || TONE_COLOURS.blue);
    levels.forEach((level, k) => {
      const shade = 0.45 + 0.55 * (k + 1) / levels.length;
      for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
        const here = values[y * width + x] - level, right = values[y * width + x + 1] - level, down = values[(y + 1) * width + x] - level;
        if ((here > 0) !== (right > 0) || (here > 0) !== (down > 0)) put(x, y, base, shade, tick + k * 2);
      }
    });
    tick += levels.length * 2;
  }
  // Curves, drawn left to right.
  curves.forEach((curve, i) => {
    const colour = rgb(TONE_COLOURS[curve.tone] || TONE_COLOURS.cyan);
    let last = null;
    for (let x = 0; x < width; x++) {
      const y = curve.f(fromGrid(x, 0)[0]);
      if (!Number.isFinite(y)) { last = null; continue; }
      const gy = toGrid(0, y)[1], at = tick + Math.floor(x / width * 14) + i * 4;
      if (last !== null && Math.abs(gy - last) < height) for (const [px, py] of line([x - 1, last], [x, gy])) put(px, py, colour, 1, at);
      else put(x, gy, colour, 1, at);
      last = gy;
    }
  });
  if (curves.length) tick += 14 + (curves.length - 1) * 4;
  // Points as 3×3 blocks, vectors as lines with a pixel arrowhead.
  for (const point of part.points) { const [px, py] = toGrid(...point.at), colour = rgb(TONE_COLOURS[point.tone] || TONE_COLOURS.white); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) put(px + dx, py + dy, colour, 1, tick); }
  if (part.points.length) tick += 2;
  for (const vector of part.vectors) {
    const a = toGrid(...vector.from), b = toGrid(...vector.to), colour = rgb(TONE_COLOURS[vector.tone] || TONE_COLOURS.rose), pixels = line(a, b);
    pixels.forEach(([px, py], i) => put(px, py, colour, 1, tick + Math.floor(i / pixels.length * 4)));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    for (let k = 1; k <= 3; k++) for (let j = -k; j <= k; j++) put(Math.round(b[0] - ux * k + -uy * j), Math.round(b[1] - uy * k + ux * j), colour, 1, tick + 4);
  }
  if (part.vectors.length) tick += 5;
  const settled = tick;
  // The path of iterates: each step drawn pixel by pixel, the newest point blinking; then a pause and it plays again.
  const path = part.path ? part.path.points.map(p => toGrid(...p)) : [];
  const pathColour = part.path ? rgb(TONE_COLOURS[part.path.tone] || TONE_COLOURS.amber) : null, STEP = 5;
  const sweep = part.sweep ? { f: compile(part.sweep.fn, ['x', 'y']), colour: rgb(TONE_COLOURS[part.sweep.tone] || TONE_COLOURS.green), ...part.sweep } : null, SWEEP = 30;
  const sweepValues = sweep ? (() => { const v = new Float64Array(width * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) v[y * width + x] = sweep.f(...fromGrid(x, y)); return v; })() : null;
  const cycle = Math.max(path.length ? (path.length - 1) * STEP + 2 : 0, sweep ? SWEEP : 0);
  const data = image.data;
  const plotPixel = (x, y, colour, alpha) => { if (!inside(x, y)) return; const i = (y * width + x) * 4, a = Math.min(1, alpha); data[i] = colour[0]; data[i + 1] = colour[1]; data[i + 2] = colour[2]; data[i + 3] = Math.max(data[i + 3], Math.round(a * 255)); };
  let frame = 0, shown = -1, stopped = false, start = performance.now() + delay;
  function draw(now) {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    const t = reduced ? 1e6 : Math.floor((now - start) / (1000 / FPS));
    if (t < 0) { if (shown !== -2) { data.fill(0); g.putImageData(image, 0, 0); shown = -2; } return; }
    if (t === shown) return;
    shown = t;
    data.fill(0);
    for (const [x, y, r, gg, b, alpha, at] of still) if (at <= t) plotPixel(x, y, [r, gg, b], alpha);
    if (cycle && t >= settled) {
      const c = reduced ? cycle : (t - settled) % (cycle + HOLD);
      if (sweep) {
        const level = sweep.from + (sweep.to - sweep.from) * Math.min(1, c / SWEEP);
        for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
          const here = sweepValues[y * width + x] - level, right = sweepValues[y * width + x + 1] - level, down = sweepValues[(y + 1) * width + x] - level;
          if ((here > 0) !== (right > 0) || (here > 0) !== (down > 0)) plotPixel(x, y, sweep.colour, 0.95);
        }
      }
      if (path.length) {
        const steps = Math.min(path.length - 1, c / STEP);
        for (let s = 0; s < Math.ceil(steps); s++) {
          const pixels = line(path[s], path[s + 1]), share = Math.min(1, steps - s);
          pixels.slice(0, Math.max(1, Math.round(pixels.length * share))).forEach(([x, y], i) => { if (i % 2 === 0) plotPixel(x, y, pathColour, 1); });
        }
        for (let s = 0; s <= Math.floor(steps); s++) { const [x, y] = path[s]; plotPixel(x, y, pathColour, 1); plotPixel(x + 1, y, pathColour, 1); plotPixel(x, y + 1, pathColour, 1); plotPixel(x + 1, y + 1, pathColour, 1); }
        // The newest iterate blinks.
        const [nx, ny] = path[Math.floor(steps)];
        if (Math.floor(t / 3) % 2 === 0) for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.abs(dx) === 2 || Math.abs(dy) === 2) plotPixel(nx + dx, ny + dy, [255, 255, 255], 0.9);
      }
    }
    g.putImageData(image, 0, 0);
  }
  frame = requestAnimationFrame(draw);
  // Labels in the terminal font, over the canvas: the ranges at the edges and each point's name beside it.
  const label = (text, x, y, className) => { const node = document.createElement('span'); node.className = `ink-plot-label ${className || ''}`; node.textContent = text; node.style.left = `${x}px`; node.style.top = `${y}px`; overlay.append(node); return node; };
  const fmt = n => Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0) ? n.toExponential(1) : String(Math.round(n * 100) / 100);
  label(`${part.labels.x} ${fmt(x0)}…${fmt(x1)}`, width * SCALE - 4, height * SCALE - 14, 'right');
  label(`${part.labels.y} ${fmt(y0)}…${fmt(y1)}`, 4, 2, '');
  // A name that would run off the right edge sits to the left of its point instead.
  const named = (text, px, py) => { const node = label(text, px * SCALE + 8, Math.max(0, py * SCALE - 16), 'point'); if (node.offsetLeft + node.offsetWidth > width * SCALE - 2) { node.classList.add('right'); node.style.left = `${px * SCALE - 6}px`; } };
  for (const point of part.points) if (point.label) named(point.label, ...toGrid(...point.at));
  for (const vector of part.vectors) if (vector.label) named(vector.label, ...toGrid(...vector.to));
  return { stop() { stopped = true; cancelAnimationFrame(frame); }, replay(after = 0) { start = performance.now() + after; shown = -1; } };
}
