// The bodies of Fairy's ink cards. Text always goes in as text; only the bounded Markdown/KaTeX renderer makes HTML.
import { replyHTML } from './reply-renderer.js';
import { TONE_COLOURS } from './ink-tones.js';
import { modelView } from './ink-model.js';
import { plotView } from './ink-plot.js';
import { quizBody } from './ink-quiz.js';

export const CARD_WIDTHS = { card: 288, steps: 288, timeline: 304, bars: 304, flow: 324, table: 340, math: 316, model: 264, plot: 320, quiz: 340 };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; };

// Returns { node, stop } — stop releases anything still running (a model's WebGL loop).
export function cardBody(part, { reduced = false, ask } = {}) {
  const tone = TONE_COLOURS[part.tone] || TONE_COLOURS.blue;
  const body = el('div', `ink-body ink-k-${part.kind}`);
  body.style.setProperty('--tone', tone);
  let stop = () => {}, begin = null;
  if (part.kind === 'card') { body.classList.add('rich-reply'); body.innerHTML = replyHTML(part.text); }
  else if (part.kind === 'steps') part.items.forEach((item, i) => { const line = el('div', 'ink-line'); line.append(el('span', 'ink-num', String(i + 1).padStart(2, '0')), el('span', '', item)); body.append(line); });
  else if (part.kind === 'timeline') {
    for (const event of part.events) { const row = el('div', 'ink-event'); row.append(el('span', 'ink-dot'), el('b', '', event.when), el('span', 'ink-what', event.what)); body.append(row); }
  } else if (part.kind === 'bars') {
    const most = Math.max(...part.bars.map(bar => Math.abs(bar.value))) || 1;
    for (const bar of part.bars) {
      const row = el('div', 'ink-bar'), track = el('span', 'ink-track'), fill = el('span', 'ink-fill');
      fill.style.width = `${Math.max(2, Math.abs(bar.value) / most * 100)}%`; track.append(fill);
      row.append(el('span', 'ink-bar-label', bar.label), track, el('span', 'ink-bar-value', `${formatNumber(bar.value)}${part.unit ? ` ${part.unit}` : ''}`));
      body.append(row);
    }
  } else if (part.kind === 'flow') body.append(flowDiagram(part, tone));
  else if (part.kind === 'table') {
    const table = el('table'), head = el('tr');
    for (const column of part.columns) head.append(el('th', '', column));
    table.append(head);
    for (const row of part.rows) { const line = el('tr'); for (const cell of row) line.append(el('td', '', cell)); table.append(line); }
    body.append(table);
  } else if (part.kind === 'math') {
    for (const step of part.steps) {
      const row = el('div', 'ink-step rich-reply'); row.innerHTML = replyHTML(`$$${step.tex.replaceAll('$$', '')}$$`);
      if (step.note) row.append(el('p', 'ink-note', step.note));
      body.append(row);
    }
  } else if (part.kind === 'quiz') {
    ({ stop } = quizBody(part, body, { reduced, ask }));
  } else if (part.kind === 'plot') {
    const stage = el('div', 'ink-plot'), canvas = el('canvas', 'ink-plot-canvas'), overlay = el('div', 'ink-plot-overlay');
    stage.append(canvas, overlay); body.append(stage);
    // A key: curves, the path, the sweep and the constraints, each in its colour, and a replay for the animation.
    const keys = [...part.curves.map(c => [c.label || `y = ${c.fn}`, c.tone]), ...(part.path ? [[part.path.label || 'iterates', part.path.tone]] : []),
      ...(part.sweep ? [[part.sweep.label || `${part.sweep.fn} = c`, part.sweep.tone]] : []), ...part.constraints.map((c, i) => [c.label || c.rule, ['cyan', 'violet', 'amber', 'rose', 'white', 'blue'][i % 6]])];
    const legend = el('div', 'ink-legend');
    for (const [name, keyTone] of keys) { const key = el('span', 'ink-key', name); key.style.setProperty('--tone', TONE_COLOURS[keyTone] || tone); legend.append(key); }
    const replay = el('button', 'ink-replay', '[▶ replay]'); replay.type = 'button'; legend.append(replay); body.append(legend);
    // The plot starts once its window has switched on (begin), not while it's still being drawn.
    let view = null, wait = 0;
    requestAnimationFrame(() => { if (canvas.isConnected) { view = plotView(canvas, overlay, part, { reduced, delay: wait }); replay.onclick = () => view.replay(); } });
    stop = () => view?.stop();
    begin = delay => { wait = delay; view?.replay(delay); };
  } else if (part.kind === 'model') {
    const canvas = el('canvas', 'ink-canvas'); canvas.width = 120; canvas.height = 84; body.append(canvas);
    const labelled = part.parts.filter(p => p.label);
    if (labelled.length) { const legend = el('div', 'ink-legend'); for (const p of labelled) { const key = el('span', 'ink-key', p.label); key.style.setProperty('--tone', TONE_COLOURS[p.tone]); legend.append(key); } body.append(legend); }
    // Started once the card is in the page, so the canvas has its size.
    let view = null;
    requestAnimationFrame(() => { if (canvas.isConnected) view = modelView(canvas, part.parts, { spin: part.spin, reduced, duration: part.duration }); });
    stop = () => view?.stop();
  }
  return { node: body, stop, begin };
}
const formatNumber = value => Math.abs(value) >= 1e5 || (Math.abs(value) < 0.01 && value !== 0) ? value.toExponential(2) : String(Math.round(value * 100) / 100);

// A small layered diagram: each node one row below the deepest node that leads to it.
export function flowLevels(nodes, links) {
  const level = Object.fromEntries(nodes.map(n => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const link of links) if (level[link.to] < level[link.from] + 1 && level[link.from] + 1 < nodes.length) { level[link.to] = level[link.from] + 1; changed = true; }
    if (!changed) break;
  }
  return level;
}
const wrap = (text, width) => {
  const words = text.split(' '), lines = [''];
  for (const word of words) { if ((lines.at(-1) + ' ' + word).trim().length > width && lines.at(-1)) lines.push(word); else lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim(); }
  return lines.slice(0, 3);
};
function flowDiagram(part, tone) {
  const level = flowLevels(part.nodes, part.links), rows = [];
  for (const node of part.nodes) (rows[level[node.id]] ||= []).push(node);
  const width = 296, rowHeight = 62, boxHeight = 40, place = {};
  rows.forEach((row, r) => row.forEach((node, i) => {
    const w = Math.min(130, (width - 10 * (row.length + 1)) / row.length);
    place[node.id] = { x: 12 + i * (w + 12) + (width - (row.length * (w + 12) + 12)) / 2, y: 8 + r * rowHeight, w, h: boxHeight };
  }));
  const height = rows.length * rowHeight;
  const drawing = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ink-flow-svg' });
  const defs = svg('defs'), arrow = svg('marker', { id: `arrow-${part.id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  arrow.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: tone })); defs.append(arrow); drawing.append(defs);
  for (const link of part.links) {
    const a = place[link.from], b = place[link.to]; if (!a || !b) continue;
    const down = b.y > a.y, x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h / 2;
    const d = down ? `M${x1},${y1} C${x1},${y1 + 24} ${x2},${y2 - 24} ${x2},${y2 - 2}` : `M${a.x + a.w},${y1} C${width},${y1} ${width},${y2} ${b.x + b.w + 2},${y2}`;
    drawing.append(svg('path', { d, class: 'ink-flow-link', stroke: tone, 'marker-end': `url(#arrow-${part.id})` }));
    if (link.text) { const label = svg('text', { x: (x1 + x2) / 2 + 6, y: (y1 + y2) / 2 + 4, class: 'ink-flow-label' }); label.textContent = link.text; drawing.append(label); }
  }
  for (const node of part.nodes) {
    const p = place[node.id];
    drawing.append(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 0, class: 'ink-flow-node', stroke: tone }));
    const lines = wrap(node.text, Math.max(10, Math.floor(p.w / 7.2))), text = svg('text', { x: p.x + p.w / 2, y: p.y + p.h / 2 - (lines.length - 1) * 7 + 4, class: 'ink-flow-text' });
    lines.forEach((line, i) => { const span = svg('tspan', { x: p.x + p.w / 2, dy: i ? 14 : 0 }); span.textContent = line; text.append(span); });
    drawing.append(text);
  }
  return drawing;
}
