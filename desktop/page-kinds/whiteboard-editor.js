// A whiteboard's page: draws the board, pans and zooms it, and edits it by hand once the Pages panel says it may.
// It runs after whiteboard-core and page-bridge, with no network and nothing but its own data.
let scene = cleanScene(JSON.parse(document.getElementById('fairy-data').textContent));
const SVG_NS = 'http://www.w3.org/2000/svg';
const app = document.getElementById('app');
app.innerHTML = `<svg id="board" aria-label="Whiteboard"><defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.1" fill="#ffffff22"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)"/><g id="world"></g><g id="marks"></g></svg>
<div id="tools" class="glass bar top" role="toolbar" aria-label="Whiteboard tools" hidden></div><div id="colours" class="glass bar left" role="toolbar" aria-label="Colours" hidden></div><div id="zoom" class="glass bar corner" role="toolbar" aria-label="Zoom"></div><p id="hint" class="hint"></p>
<textarea id="writer" aria-label="Text" spellcheck="true" hidden></textarea>`;
const board = document.getElementById('board'), world = document.getElementById('world'), marks = document.getElementById('marks'), dots = document.getElementById('dots');
const toolsBar = document.getElementById('tools'), coloursBar = document.getElementById('colours'), zoomBar = document.getElementById('zoom'), hintLine = document.getElementById('hint'), writer = document.getElementById('writer');
let view = { tx: 0, ty: 0, k: 1 }, moved = false, editable = false, current = 'select', colour = null, selected = new Set(), drag = null, writing = null, spaceHeld = false;
let undo = [], redo = [], dirty = false, saving = false, saveNote = '', saved = JSON.stringify(scene);
const MAX_UNDO = 100, MIN_ZOOM = 0.08, MAX_ZOOM = 4;
const bridge = fairyBridge({
  onEdit() { if (editable) return; editable = true; toolsBar.hidden = coloursBar.hidden = false; buildTools(); if (!moved) fit(); render(); },
  onSaved() { saving = false; saved = snapshot(); setDirty(false); },
  onFailed(message) { saving = false; saveNote = message; buildTools(); },
});

const find = id => scene.items.find(item => item.id === id);
const snapshot = () => JSON.stringify(scene);
function remember(before) {
  if (before === snapshot()) return;
  undo.push(before); if (undo.length > MAX_UNDO) undo.shift();
  redo = []; setDirty(snapshot() !== saved);
}
function restore(from, to) {
  const state = from.pop();
  if (!state) return;
  to.push(snapshot()); scene = JSON.parse(state);
  selected = new Set([...selected].filter(find)); setDirty(snapshot() !== saved); render();
}
function setDirty(value) { dirty = value; if (value) saveNote = ''; bridge.dirty(value); if (editable) buildTools(); }
const newId = () => { let n = scene.items.length + 1, id; do id = `i${n++}`; while (find(id)); return id; };
const colourFor = type => colour || ({ note: 'yellow', rect: 'blue', ellipse: 'teal', diamond: 'purple', text: 'white', arrow: 'gray', draw: 'white' })[type];

// --- Drawing ---------------------------------------------------------------------------------------------------------------

function shown() {
  if (!writing) return scene;
  return { items: scene.items.map(item => (item.id !== writing.id ? item : item.type === 'arrow' ? { ...item, label: '' } : { ...item, text: '' })) };
}
function render() {
  const transform = `translate(${view.tx} ${view.ty}) scale(${view.k})`;
  world.innerHTML = sceneItemsSVG(shown(), { hit: true });
  world.setAttribute('transform', transform); marks.setAttribute('transform', transform); dots.setAttribute('patternTransform', transform);
  for (const id of selected) world.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add('picked');
  drawMarks();
  hintLine.textContent = scene.items.length ? '' : editable ? 'Pick a note, shape or the pen above, then click or drag on the board.' : 'This whiteboard is empty.';
  zoomLabel.textContent = `${Math.round(view.k * 100)}%`;
  board.style.cursor = drag?.kind === 'pan' ? 'grabbing' : spaceHeld || !editable ? 'grab' : current === 'select' ? 'default' : 'crosshair';
}
function mark(tag, attrs) { const node = document.createElementNS(SVG_NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); marks.append(node); return node; }
function drawMarks() {
  marks.replaceChildren();
  const byId = indexItems(scene), line = { fill: 'none', stroke: '#9fb2ff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' };
  for (const id of selected) {
    const item = find(id);
    if (!item) continue;
    if (item.type === 'arrow') {
      for (const [x, y] of arrowEnds(item, byId) || []) mark('circle', { cx: x, cy: y, r: 5 / view.k, fill: '#9fb2ff' });
      continue;
    }
    const box = itemBox(item, byId), pad = 4 / view.k;
    mark('rect', { x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, rx: 4 / view.k, ...line, 'stroke-dasharray': '5 4' });
    if (editable && selected.size === 1 && (BOX_TYPES.includes(item.type) || item.type === 'text')) {
      const size = 11 / view.k;
      mark('rect', { x: box.x + box.w - size / 2 + pad, y: box.y + box.h - size / 2 + pad, width: size, height: size, rx: 2 / view.k, fill: '#9fb2ff', stroke: '#0e1018', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'data-handle': 'resize', class: 'handle' });
    }
  }
  if (!drag) return;
  if (drag.kind === 'marquee') { const box = span(drag.start, drag.now); mark('rect', { ...box, ...line, fill: '#9fb2ff14' }); }
  if (drag.kind === 'create' && drag.big) {
    const box = span(drag.start, drag.now), colours = BOARD_COLOURS[colourFor(drag.type)];
    if (drag.type === 'ellipse') mark('ellipse', { cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2, ...line, stroke: colours.line });
    else mark('rect', { ...box, ...line, stroke: colours.line, rx: 6 / view.k });
  }
  if (drag.kind === 'arrow') {
    const start = drag.from ? (() => { const b = itemBox(find(drag.from)); return [b.x + b.w / 2, b.y + b.h / 2]; })() : drag.start;
    mark('line', { x1: start[0], y1: start[1], x2: drag.now[0], y2: drag.now[1], ...line, stroke: BOARD_COLOURS[colourFor('arrow')].line, 'stroke-dasharray': '6 5' });
  }
  if (drag.kind === 'pen' && drag.points.length > 1) mark('polyline', { points: drag.points.map(point => point.join(',')).join(' '), fill: 'none', stroke: BOARD_COLOURS[colourFor('draw')].line, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}
const span = ([x1, y1], [x2, y2]) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });

// --- Looking around ---------------------------------------------------------------------------------------------------

function fit() {
  const width = board.clientWidth, height = board.clientHeight, top = editable ? toolsBar.offsetHeight + 16 : 12, bounds = sceneBounds(scene), pad = 48;
  if (!scene.items.length || !width) { view = { tx: width / 2, ty: height / 2, k: 1 }; render(); return; }
  const k = Math.max(MIN_ZOOM, Math.min(1.25, (width - pad * 2) / Math.max(bounds.w, 1), (height - top - pad * 2) / Math.max(bounds.h, 1)));
  view = { k, tx: width / 2 - (bounds.x + bounds.w / 2) * k, ty: top + (height - top) / 2 - (bounds.y + bounds.h / 2) * k };
  render();
}
function zoomAt(factor, [sx, sy] = [board.clientWidth / 2, board.clientHeight / 2]) {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor)), wx = (sx - view.tx) / view.k, wy = (sy - view.ty) / view.k;
  view = { k, tx: sx - wx * k, ty: sy - wy * k }; moved = true; closeWriter(); render();
}
const zoomLabel = el('button', { type: 'button', class: 'word zoom-level', 'aria-label': 'Zoom to 100%', title: 'Zoom to 100%', onclick: () => zoomAt(1 / view.k) });
zoomBar.append(tool('minus', 'Zoom out', () => zoomAt(1 / 1.25), { shortcut: '−' }), zoomLabel, tool('plus', 'Zoom in', () => zoomAt(1.25), { shortcut: '+' }), tool('fit', 'Fit the board', () => { moved = false; fit(); }, { shortcut: '⇧1' }));
const local = event => { const box = board.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };
const toWorld = event => { const [x, y] = local(event); return [(x - view.tx) / view.k, (y - view.ty) / view.k]; };
board.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), local(event));
  else { view.tx -= event.deltaX; view.ty -= event.deltaY; moved = true; closeWriter(); render(); }
}, { passive: false });
addEventListener('resize', () => { if (!moved) fit(); else render(); });

// --- Tools ------------------------------------------------------------------------------------------------------------------

const TOOLS = [['select', 'Select and move', 'V'], ['note', 'Sticky note', 'N'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['diamond', 'Diamond', 'D'], ['text', 'Text', 'T'], ['arrow', 'Arrow', 'A'], ['pen', 'Pen', 'P']];
function choose(name) { current = name; closeWriter(); buildTools(); render(); }
function buildTools() {
  if (!editable) return;
  const group = (...children) => el('div', { class: 'group' }, ...children);
  const tools = TOOLS.map(([name, label, key]) => { const button = tool(name, label, () => choose(name), { shortcut: key }); button.setAttribute('aria-pressed', String(current === name)); return button; });
  const swatches = Object.keys(BOARD_COLOURS).map(name => {
    const active = selected.size ? [...selected].every(id => find(id)?.color === name) : colour === name;
    return el('button', { type: 'button', class: 'swatch', style: `--swatch:${BOARD_COLOURS[name].paper}`, 'aria-label': `${name[0].toUpperCase()}${name.slice(1)}`, title: `${name[0].toUpperCase()}${name.slice(1)}`, 'aria-pressed': String(active), onclick: () => paint(name) });
  });
  const back = tool('undo', 'Undo', () => restore(undo, redo), { shortcut: isMac ? '⌘Z' : 'Ctrl+Z' }), again = tool('redo', 'Redo', () => restore(redo, undo), { shortcut: isMac ? '⇧⌘Z' : 'Ctrl+Y' }), remove = tool('trash', 'Delete', removeSelected, { shortcut: '⌫' });
  back.disabled = !undo.length; again.disabled = !redo.length; remove.disabled = !selected.size;
  const save = el('button', { type: 'button', class: 'save', onclick: saveBoard, title: `Save as a new version (${isMac ? '⌘S' : 'Ctrl+S'})`, text: saving ? 'Saving…' : dirty ? 'Save' : 'Saved' });
  save.disabled = !dirty || saving;
  const note = saveNote ? el('span', { class: 'save-note', role: 'status', text: saveNote }) : null;
  toolsBar.replaceChildren(group(...tools), group(back, again, remove), group(note, save));
  coloursBar.replaceChildren(...swatches);
}
function paint(name) {
  colour = name;
  if (selected.size) { const before = snapshot(); for (const id of selected) { const item = find(id); if (item) item.color = name; } remember(before); }
  buildTools(); render();
}
function removeSelected() {
  if (!selected.size) return;
  const before = snapshot(), gone = new Set(selected);
  scene.items = scene.items.filter(item => !gone.has(item.id) && !(item.type === 'arrow' && (gone.has(item.from) || gone.has(item.to))));
  selected.clear(); remember(before); buildTools(); render();
}
function duplicate() {
  if (!selected.size) return;
  const before = snapshot(), copies = new Map();
  for (const id of selected) copies.set(id, newId() + Math.random().toString(36).slice(2, 5));
  for (const item of scene.items.filter(entry => selected.has(entry.id))) {
    const copy = structuredClone(item); copy.id = copies.get(item.id);
    if ('x' in copy) { copy.x += 24; copy.y += 24; }
    if (copy.points) copy.points = copy.points.map(([x, y]) => [x + 24, y + 24]);
    if (copy.type === 'arrow') { if (copy.from) copy.from = copies.get(copy.from) || copy.from; if (copy.to) copy.to = copies.get(copy.to) || copy.to; for (const key of ['x1', 'y1', 'x2', 'y2']) if (key in copy) copy[key] += 24; }
    scene.items.push(copy);
  }
  selected = new Set(copies.values()); remember(before); buildTools(); render();
}
function moveBy(ids, dx, dy, origin) {
  for (const id of ids) {
    const item = find(id), from = origin.get(id);
    if (!item || !from) continue;
    if ('x' in from) { item.x = Math.round(from.x + dx); item.y = Math.round(from.y + dy); }
    if (from.points) item.points = from.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
    for (const [kx, ky] of [['x1', 'y1'], ['x2', 'y2']]) if (kx in from) { item[kx] = Math.round(from[kx] + dx); item[ky] = Math.round(from[ky] + dy); }
  }
}
function saveBoard() {
  if (!dirty || saving) return;
  closeWriter(); saving = true; saveNote = ''; buildTools();
  bridge.save(JSON.parse(snapshot()));
}

// --- Pointer ----------------------------------------------------------------------------------------------------------------

const hitAt = event => event.target.closest?.('#world [data-id]')?.dataset.id;
const boxAt = event => { const id = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('#world [data-id]')?.dataset.id, item = id && find(id); return item && item.type !== 'arrow' && item.type !== 'draw' ? id : null; };
board.addEventListener('pointerdown', event => {
  if (event.button === 2) return;
  closeWriter();
  board.setPointerCapture(event.pointerId);
  const at = toWorld(event), id = hitAt(event);
  if (event.button === 1 || spaceHeld || !editable || (current === 'select' && !id && !event.shiftKey && !event.target.closest('[data-handle]'))) {
    if (editable && current === 'select' && !id && !spaceHeld && event.button === 0) { selected.clear(); buildTools(); }
    drag = { kind: 'pan', sx: event.clientX, sy: event.clientY, tx: view.tx, ty: view.ty }; render(); return;
  }
  const before = snapshot();
  if (current === 'select') {
    if (event.target.closest('[data-handle]')) { const item = find([...selected][0]); drag = { kind: 'resize', id: item.id, start: at, box: itemBox(item), before }; return; }
    if (!id) { drag = { kind: 'marquee', start: at, now: at, base: new Set(selected) }; return; }
    if (event.shiftKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); }
    else if (!selected.has(id)) selected = new Set([id]);
    const origin = new Map([...selected].map(key => [key, structuredClone(find(key))]));
    drag = { kind: 'move', start: at, origin, before };
    buildTools(); render(); return;
  }
  if (current === 'arrow') { drag = { kind: 'arrow', start: at, now: at, from: boxAt(event), before }; return; }
  if (current === 'pen') { drag = { kind: 'pen', points: [at.map(Math.round)], before }; return; }
  drag = { kind: 'create', type: current, start: at, now: at, big: false, before };
});
board.addEventListener('pointermove', event => {
  if (!drag) return;
  const at = toWorld(event);
  if (drag.kind === 'pan') { view.tx = drag.tx + event.clientX - drag.sx; view.ty = drag.ty + event.clientY - drag.sy; moved = true; render(); return; }
  if (drag.kind === 'move') { moveBy(drag.origin.keys(), at[0] - drag.start[0], at[1] - drag.start[1], drag.origin); render(); return; }
  if (drag.kind === 'resize') {
    const item = find(drag.id), w = Math.max(40, Math.round(drag.box.w + at[0] - drag.start[0])), h = Math.max(30, Math.round(drag.box.h + at[1] - drag.start[1]));
    if (item.type === 'text') item.w = w; else { item.w = w; item.h = h; }
    render(); return;
  }
  if (drag.kind === 'marquee') {
    drag.now = at;
    const box = span(drag.start, drag.now), byId = indexItems(scene);
    selected = new Set(drag.base);
    for (const item of scene.items) { const b = itemBox(item, byId); if (b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.width && b.y + b.h <= box.y + box.height) selected.add(item.id); }
    render(); return;
  }
  if (drag.kind === 'pen') { const last = drag.points.at(-1); if (Math.hypot(at[0] - last[0], at[1] - last[1]) * view.k >= 2) drag.points.push(at.map(Math.round)); drawMarks(); return; }
  drag.now = at;
  if (drag.kind === 'create') drag.big ||= Math.hypot(at[0] - drag.start[0], at[1] - drag.start[1]) * view.k > 6;
  drawMarks();
});
board.addEventListener('pointerup', event => {
  const done = drag; drag = null;
  if (!done) return;
  if (done.kind === 'pan') { render(); return; }
  if (done.kind === 'move' || done.kind === 'resize') { remember(done.before); buildTools(); render(); return; }
  if (done.kind === 'marquee') { buildTools(); render(); return; }
  if (done.kind === 'pen') {
    if (done.points.length > 1) { const item = { id: newId(), type: 'draw', color: colourFor('draw'), points: done.points, width: 3 }; scene.items.push(item); remember(done.before); }
    render(); return;
  }
  if (done.kind === 'arrow') {
    const to = boxAt(event), at = toWorld(event), item = { id: newId(), type: 'arrow', color: colourFor('arrow') };
    if (done.from) item.from = done.from; else { item.x1 = Math.round(done.start[0]); item.y1 = Math.round(done.start[1]); }
    if (to && to !== done.from) item.to = to; else { item.x2 = Math.round(at[0]); item.y2 = Math.round(at[1]); }
    const far = Math.hypot(at[0] - done.start[0], at[1] - done.start[1]) * view.k > 8;
    if (far || (item.to && item.from)) { scene.items.push(item); selected = new Set([item.id]); remember(done.before); }
    choose('select'); return;
  }
  // A click makes the usual size, centred where you clicked; a drag makes it the size you drew.
  const type = done.type, [dw, dh] = { note: [200, 150], rect: [180, 100], ellipse: [170, 110], diamond: [180, 120], text: [0, 0] }[type];
  const box = done.big ? span(done.start, done.now) : { x: done.start[0] - dw / 2, y: done.start[1] - dh / 2, width: dw, height: dh };
  const item = { id: newId(), type, color: colourFor(type), x: Math.round(box.x), y: Math.round(box.y), text: '' };
  if (type === 'text') { item.x = Math.round(done.start[0]); item.y = Math.round(done.start[1]); item.size = 22; if (done.big) item.w = Math.max(60, Math.round(box.width)); }
  else { item.w = Math.max(40, Math.round(box.width)); item.h = Math.max(30, Math.round(box.height)); }
  scene.items.push(item); selected = new Set([item.id]);
  current = 'select'; buildTools();
  openWriter(item, done.before);
});
board.addEventListener('dblclick', event => {
  if (!editable) return;
  const id = hitAt(event), item = id && find(id);
  if (item && item.type !== 'draw') { selected = new Set([id]); buildTools(); openWriter(item); return; }
  if (!id) { const at = toWorld(event), before = snapshot(), text = { id: newId(), type: 'text', color: colourFor('text'), x: Math.round(at[0]), y: Math.round(at[1] - 12), text: '', size: 22 }; scene.items.push(text); selected = new Set([text.id]); openWriter(text, before); }
});

// --- Writing in a note, shape, text or an arrow's label ------------------------------------------------------------------

function openWriter(item, before = snapshot()) {
  writing = { id: item.id, before };
  render();
  const byId = indexItems(scene);
  let box = itemBox(item, byId), size = 16, align = 'left', ink = '#e8e9ee', pad = 14;
  if (item.type === 'note') ink = '#1c1d21';
  else if (item.type === 'text') { size = item.size; pad = 0; ink = BOARD_COLOURS[item.color].line; box = { ...box, w: Math.max(box.w, 220), h: Math.max(box.h, size * 1.4) }; }
  else if (item.type === 'arrow') { const [[x1, y1], [x2, y2]] = arrowEnds(item, byId); size = 13; align = 'center'; pad = 4; box = { x: (x1 + x2) / 2 - 90, y: (y1 + y2) / 2 - 18, w: 180, h: 36 }; }
  else { size = 15; align = 'center'; pad = 10; }
  Object.assign(writer.style, { left: `${box.x * view.k + view.tx}px`, top: `${box.y * view.k + view.ty}px`, width: `${box.w * view.k}px`, height: `${box.h * view.k}px`, fontSize: `${size * view.k}px`, padding: `${pad * view.k}px`, textAlign: align, color: ink, fontWeight: item.type === 'text' && item.size >= 28 ? 650 : item.type === 'note' || item.type === 'text' ? 400 : 500 });
  writer.dataset.kind = item.type;
  writer.value = item.type === 'arrow' ? item.label || '' : item.text;
  writer.hidden = false; writer.focus(); writer.select();
}
function closeWriter() {
  if (!writing) return;
  const { id, before } = writing, item = find(id);
  writing = null; writer.hidden = true;
  if (item) {
    const value = writer.value.replace(/\r\n?/g, '\n').slice(0, 2000);
    if (item.type === 'arrow') { if (value.trim()) item.label = value.slice(0, 200); else delete item.label; }
    else item.text = value;
    if (item.type === 'text' && !value.trim()) { scene.items = scene.items.filter(entry => entry.id !== id); selected.delete(id); }
  }
  remember(before); buildTools(); render();
}
writer.addEventListener('blur', () => setTimeout(closeWriter));
writer.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape' || (event.key === 'Enter' && (modKey(event) || writer.dataset.kind === 'arrow'))) { event.preventDefault(); writer.blur(); }
});
writer.addEventListener('input', () => {
  if (writer.dataset.kind !== 'text') return;
  writer.style.height = 'auto'; writer.style.height = `${writer.scrollHeight}px`;
});

// --- Keys -------------------------------------------------------------------------------------------------------------------

addEventListener('keydown', event => {
  if (event.target === writer) return;
  if (event.key === ' ' && !spaceHeld) { spaceHeld = true; render(); event.preventDefault(); return; }
  if (event.key === '+' || event.key === '=') { if (!modKey(event)) { zoomAt(1.25); return; } }
  if (event.key === '-' || event.key === '_') { if (!modKey(event)) { zoomAt(1 / 1.25); return; } }
  if (event.key === '!' || (event.key === '1' && event.shiftKey)) { moved = false; fit(); return; }
  if (!editable) return;
  const key = event.key.toLowerCase();
  if (modKey(event)) {
    if (key === 'z') { event.preventDefault(); if (event.shiftKey) restore(redo, undo); else restore(undo, redo); }
    else if (key === 'y') { event.preventDefault(); restore(redo, undo); }
    else if (key === 's') { event.preventDefault(); saveBoard(); }
    else if (key === 'a') { event.preventDefault(); selected = new Set(scene.items.map(item => item.id)); buildTools(); render(); }
    else if (key === 'd') { event.preventDefault(); duplicate(); }
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); removeSelected(); return; }
  if (event.key === 'Escape') { selected.clear(); choose('select'); return; }
  if (event.key === 'Enter' && selected.size === 1) { const item = find([...selected][0]); if (item.type !== 'draw') { event.preventDefault(); openWriter(item); } return; }
  const step = event.shiftKey ? 10 : 1, nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (nudge && selected.size) { event.preventDefault(); const before = snapshot(), origin = new Map([...selected].map(id => [id, structuredClone(find(id))])); moveBy(selected, nudge[0], nudge[1], origin); remember(before); render(); return; }
  const picked = TOOLS.find(([, , shortcut]) => shortcut.toLowerCase() === key);
  if (picked && !event.altKey) choose(picked[0]);
});
addEventListener('keyup', event => { if (event.key === ' ') { spaceHeld = false; render(); } });
addEventListener('beforeunload', event => { if (dirty && !saving && window.parent === window) event.preventDefault(); });

requestAnimationFrame(fit);
