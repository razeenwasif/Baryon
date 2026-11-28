// A whiteboard: sticky notes, shapes, text, arrows and free drawing, kept as a plain list of items.
// This file runs in Node (for checking scenes and exporting them) and, copied in, inside a whiteboard's page,
// so it imports nothing and only exports functions and constants.

export const BOARD_LIMITS = { items: 2000, text: 2000, points: 4000, coord: 200000 };
// Each colour has a paper for notes and a line for shapes, text and arrows, readable on the board's dark ground.
export const BOARD_COLOURS = {
  yellow: { paper: '#fde68a', line: '#f5c542' }, orange: { paper: '#fdc193', line: '#fb923c' }, pink: { paper: '#f9bdd6', line: '#f472b6' },
  purple: { paper: '#d9cbfd', line: '#b49cfb' }, blue: { paper: '#c3d3ff', line: '#9fb2ff' }, teal: { paper: '#aef0e6', line: '#5eead4' },
  green: { paper: '#c3f0cb', line: '#6ee7a0' }, gray: { paper: '#d9dbe1', line: '#a2a4ad' }, white: { paper: '#f4f5f8', line: '#e8e9ee' },
};
export const BOARD_GROUND = '#0e1018';
export const BOARD_INK = '#e8e9ee';
const NOTE_INK = '#1c1d21';
export const BOARD_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const BOX_TYPES = ['note', 'rect', 'ellipse', 'diamond'] as const;

export type BoardColourName = keyof typeof BOARD_COLOURS;
export type BoxType = (typeof BOX_TYPES)[number];
export type BoardItemType = BoxType | 'text' | 'arrow' | 'draw';
export type Point2D = [number, number];

export interface BoardBoxShape<T extends BoxType = BoxType> {
  id: string;
  type: T;
  color: BoardColourName;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export type BoardBoxItem =
  | BoardBoxShape<'note'>
  | BoardBoxShape<'rect'>
  | BoardBoxShape<'ellipse'>
  | BoardBoxShape<'diamond'>;

export interface BoardTextItem {
  id: string;
  type: 'text';
  color: BoardColourName;
  x: number;
  y: number;
  text: string;
  size: number;
  w?: number;
}

export interface BoardArrowItem {
  id: string;
  type: 'arrow';
  color: BoardColourName;
  from?: string;
  to?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  label?: string;
  dashed?: boolean;
  head?: 'both' | 'none';
}

export interface BoardDrawItem {
  id: string;
  type: 'draw';
  color: BoardColourName;
  points: Point2D[];
  width: number;
}

export type BoardItem = BoardBoxItem | BoardTextItem | BoardArrowItem | BoardDrawItem;

export interface BoardScene {
  items: BoardItem[];
}

export interface BoardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIZES: Record<BoxType, [number, number]> = { note: [200, 150], rect: [180, 100], ellipse: [170, 110], diamond: [180, 120] };
const DEFAULT_COLOUR: Record<BoardItemType, BoardColourName> = { note: 'yellow', rect: 'blue', ellipse: 'teal', diamond: 'purple', text: 'white', arrow: 'gray', draw: 'white' };
const TYPE_NAMES: Record<string, BoardItemType> = { note: 'note', sticky: 'note', 'sticky note': 'note', stickynote: 'note', postit: 'note', rect: 'rect', rectangle: 'rect', box: 'rect', square: 'rect', shape: 'rect',
  ellipse: 'ellipse', circle: 'ellipse', oval: 'ellipse', diamond: 'diamond', decision: 'diamond', rhombus: 'diamond', text: 'text', label: 'text', heading: 'text', title: 'text',
  arrow: 'arrow', connector: 'arrow', edge: 'arrow', link: 'arrow', line: 'arrow', draw: 'draw', path: 'draw', pen: 'draw', freehand: 'draw', stroke: 'draw', scribble: 'draw' };

const isBoxType = (type: BoardItemType): type is BoxType => (BOX_TYPES as readonly string[]).includes(type);
const isBoxItem = (item: BoardItem): item is BoardBoxItem => (BOX_TYPES as readonly string[]).includes(item.type);
const finite = (value: unknown): boolean => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
const coord = (value: unknown): number => Math.round(Math.min(BOARD_LIMITS.coord, Math.max(-BOARD_LIMITS.coord, Number(value))) * 10) / 10;
const size = (value: unknown, fallback: number, low = 16, high = 4000): number => (finite(value) ? Math.round(Math.min(high, Math.max(low, Number(value)))) : fallback);
const words = (value: unknown): string => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, BOARD_LIMITS.text);
const colourOf = (value: unknown, type: BoardItemType): BoardColourName => {
  const name = String(value ?? '').toLowerCase().replace('grey', 'gray');
  return Object.prototype.hasOwnProperty.call(BOARD_COLOURS, name) ? (name as BoardColourName) : DEFAULT_COLOUR[type];
};

// Accepts { items: [...] } or a bare list, from a model, a file or the page, and keeps it within the limits.
// Items with no position are laid out in rows below the rest; arrows to items that don't exist are dropped.
export function cleanScene(value: unknown): BoardScene {
  const rawInput = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : []);
  const items: BoardItem[] = [], ids = new Set<string>(), unplaced: Array<BoardBoxItem | BoardTextItem> = [];
  let counter = 0;
  const freshId = (): string => { let id: string; do id = `i${++counter}`; while (ids.has(id)); return id; };
  for (const rawItem of rawInput) {
    if (items.length >= BOARD_LIMITS.items) break;
    if (!rawItem || typeof rawItem !== 'object') continue;
    const raw = rawItem as Record<string, unknown>;
    let type: BoardItemType | undefined = TYPE_NAMES[String(raw.type ?? '').toLowerCase().trim()];
    if (type === 'arrow' && Array.isArray(raw.points) && !raw.from && !raw.to) type = 'draw';
    if (!type) continue;
    let id = String(raw.id ?? '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!id || ids.has(id)) id = freshId();
    ids.add(id);
    const color = colourOf(raw.color ?? raw.colour, type);
    if (isBoxType(type)) {
      const [w, h] = SIZES[type];
      const boxItem: BoardBoxItem = { id, type, color, x: finite(raw.x) ? coord(raw.x) : 0, y: finite(raw.y) ? coord(raw.y) : 0, w: size(raw.w ?? raw.width, w), h: size(raw.h ?? raw.height, h), text: words(raw.text ?? raw.label) };
      if (!finite(raw.x) || !finite(raw.y)) unplaced.push(boxItem);
      items.push(boxItem);
    } else if (type === 'text') {
      const textItem: BoardTextItem = { id, type, color, x: finite(raw.x) ? coord(raw.x) : 0, y: finite(raw.y) ? coord(raw.y) : 0, text: words(raw.text ?? raw.label), size: size(raw.size ?? raw.fontSize, 22, 10, 160) };
      if (finite(raw.w ?? raw.width)) textItem.w = size(raw.w ?? raw.width, 300, 40);
      if (!textItem.text.trim()) { ids.delete(id); continue; }
      if (!finite(raw.x) || !finite(raw.y)) unplaced.push(textItem);
      items.push(textItem);
    } else if (type === 'arrow') {
      const arrowItem: BoardArrowItem = { id, type, color };
      for (const end of ['from', 'to'] as const) if (raw[end] !== undefined && raw[end] !== null && raw[end] !== '') arrowItem[end] = String(raw[end]).replace(/[^\w-]/g, '').slice(0, 40);
      for (const key of ['x1', 'y1', 'x2', 'y2'] as const) if (finite(raw[key])) arrowItem[key] = coord(raw[key]);
      const label = words(raw.label ?? raw.text).slice(0, 200);
      if (label.trim()) arrowItem.label = label;
      if (raw.dashed === true) arrowItem.dashed = true;
      if (raw.head === 'both' || raw.head === 'none') arrowItem.head = raw.head;
      items.push(arrowItem);
    } else {
      const points: Point2D[] = (Array.isArray(raw.points) ? raw.points : []).slice(0, BOARD_LIMITS.points)
        .map((point: unknown): [unknown, unknown] => (Array.isArray(point) ? [point[0], point[1]] : [(point as { x?: unknown } | null | undefined)?.x, (point as { y?: unknown } | null | undefined)?.y]))
        .filter(([x, y]) => finite(x) && finite(y))
        .map(([x, y]): Point2D => [coord(x), coord(y)]);
      if (points.length < 2) { ids.delete(id); continue; }
      items.push({ id, type, color, points, width: size(raw.width ?? raw.strokeWidth, 3, 1, 24) });
    }
  }
  // An arrow needs two ends: an item at each, or a point.
  const kept = items.filter(item => {
    if (item.type !== 'arrow') return true;
    if (item.from && !ids.has(item.from)) delete item.from;
    if (item.to && !ids.has(item.to)) delete item.to;
    if (item.from && item.from === item.to) delete item.to;
    const start = item.from || (finite(item.x1) && finite(item.y1)), end = item.to || (finite(item.x2) && finite(item.y2));
    return Boolean(start && end);
  });
  placeLoose(kept, unplaced);
  return { items: kept };
}
function placeLoose(items: readonly BoardItem[], unplaced: readonly (BoardBoxItem | BoardTextItem)[]): void {
  if (!unplaced.length) return;
  const placed = items.filter(item => !unplaced.includes(item as BoardBoxItem | BoardTextItem)), bounds = sceneBounds({ items: placed });
  let x = placed.length ? bounds.x : 0, y = placed.length ? bounds.y + bounds.h + 60 : 0, rowHeight = 0;
  const left = x, maxWidth = Math.max(900, placed.length ? bounds.w : 0);
  for (const item of unplaced) {
    const box = itemBox(item);
    if (x > left && x + box.w > left + maxWidth) { x = left; y += rowHeight + 40; rowHeight = 0; }
    item.x = x; item.y = y; x += box.w + 40; rowHeight = Math.max(rowHeight, box.h);
  }
}

// --- Geometry -----------------------------------------------------------------------------------------------------------

export function wrapLines(text: unknown, width: number, fontSize: number): string[] {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.56))), lines: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > perLine) { if (line) { lines.push(line); line = ''; } lines.push(word.slice(0, perLine)); word = word.slice(perLine); }
      if (!line) line = word; else if (line.length + 1 + word.length <= perLine) line += ` ${word}`; else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}
function textLines(item: BoardTextItem): string[] { return item.w ? wrapLines(item.text, item.w, item.size) : String(item.text).split('\n'); }
export function itemBox(item: BoardItem, byId?: Map<string, BoardItem>): BoardBox {
  if (isBoxItem(item)) return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.type === 'text') {
    const lines = textLines(item), longest = Math.max(1, ...lines.map(line => line.length));
    return { x: item.x, y: item.y, w: item.w || Math.ceil(longest * item.size * 0.56) + 4, h: Math.ceil(lines.length * item.size * 1.25) };
  }
  if (item.type === 'draw') {
    const xs = item.points.map(point => point[0]), ys = item.points.map(point => point[1]), pad = item.width / 2;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + item.width, h: Math.max(...ys) - Math.min(...ys) + item.width };
  }
  const ends = arrowEnds(item, byId);
  if (!ends) return { x: 0, y: 0, w: 0, h: 0 };
  const [[x1, y1], [x2, y2]] = ends;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
export const indexItems = (scene: BoardScene): Map<string, BoardItem> => new Map(scene.items.map(item => [item.id, item]));
// Where a line from the middle of a box toward a point leaves the box's outline.
function edgePoint(item: BoardItem, toward: Point2D, gap = 6): Point2D {
  const box = itemBox(item), cx = box.x + box.w / 2, cy = box.y + box.h / 2, dx = toward[0] - cx, dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = box.w / 2, hh = box.h / 2;
  let t: number;
  if (item.type === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (item.type === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const length = Math.hypot(dx, dy), pull = Math.min(gap / length, t);
  return [cx + dx * (t + pull), cy + dy * (t + pull)];
}
const middle = (item: BoardItem): Point2D => { const box = itemBox(item); return [box.x + box.w / 2, box.y + box.h / 2]; };
export function arrowEnds(item: BoardArrowItem, byId?: Map<string, BoardItem>): [Point2D, Point2D] | null {
  const from = item.from ? byId?.get(item.from) : undefined, to = item.to ? byId?.get(item.to) : undefined;
  const loose1: Point2D | null = finite(item.x1) ? [item.x1!, item.y1!] : null, loose2: Point2D | null = finite(item.x2) ? [item.x2!, item.y2!] : null;
  const aim1 = from ? middle(from) : loose1, aim2 = to ? middle(to) : loose2;
  if (!aim1 || !aim2) return null;
  return [from ? edgePoint(from, aim2) : aim1, to ? edgePoint(to, aim1) : aim2];
}
export function sceneBounds(scene: BoardScene): BoardBox {
  const byId = indexItems(scene);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const item of scene.items) {
    const box = itemBox(item, byId);
    x1 = Math.min(x1, box.x); y1 = Math.min(y1, box.y); x2 = Math.max(x2, box.x + box.w); y2 = Math.max(y2, box.y + box.h);
    if (item.type === 'arrow' && item.label) { const [[ax, ay], [bx, by]] = arrowEnds(item, byId) || [[0, 0], [0, 0]], half = item.label.length * 4 + 10; x1 = Math.min(x1, (ax + bx) / 2 - half); x2 = Math.max(x2, (ax + bx) / 2 + half); }
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : { x: 0, y: 0, w: 0, h: 0 };
}

// --- Drawing --------------------------------------------------------------------------------------------------------------

export const escapeXML = (value: unknown): string => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round = (value: number): number => Math.round(value * 10) / 10;
function textSVG(lines: readonly string[], { x, y, size: fontSize, fill, anchor = 'start', weight = 400 }: { x: number; y: number; size: number; fill: string; anchor?: string; weight?: number }): string {
  if (!lines.length || lines.every(line => !line)) return '';
  const lineHeight = round(fontSize * 1.25);
  return `<text x="${round(x)}" y="${round(y)}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="hanging">${lines.map((line, index) => `<tspan x="${round(x)}" dy="${index ? lineHeight : 0}">${escapeXML(line) || ' '}</tspan>`).join('')}</text>`;
}
// Lines that fit inside a box, the last cut with an ellipsis when there's too much.
function fitted(text: string, width: number, height: number, fontSize: number): string[] {
  const lines = wrapLines(text, width, fontSize), room = Math.max(1, Math.floor(height / (fontSize * 1.25)));
  if (lines.length <= room) return lines;
  const kept = lines.slice(0, room);
  kept[room - 1] = `${kept[room - 1].replace(/.{0,1}$/, '')}…`;
  return kept;
}
function smoothPath(points: readonly Point2D[]): string {
  if (points.length < 3) return `M${points.map(point => point.map(round).join(' ')).join(' L')}`;
  let path = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    path += ` Q${round(x)} ${round(y)} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
  }
  const last = points.at(-1)!;
  return `${path} L${round(last[0])} ${round(last[1])}`;
}
function arrowHead([x1, y1]: Point2D, [x2, y2]: Point2D, colour: string, width: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1), length = 8 + width * 2.4, spread = 0.42;
  const a: Point2D = [x2 - length * Math.cos(angle - spread), y2 - length * Math.sin(angle - spread)], b: Point2D = [x2 - length * Math.cos(angle + spread), y2 - length * Math.sin(angle + spread)];
  return `<path d="M${round(a[0])} ${round(a[1])} L${round(x2)} ${round(y2)} L${round(b[0])} ${round(b[1])}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// One item as SVG. `hit` adds a wide see-through outline that the editor uses to pick thin things up.
export function itemSVG(item: BoardItem, byId?: Map<string, BoardItem>, { hit = false }: { hit?: boolean } = {}): string {
  const colour = BOARD_COLOURS[item.color] || BOARD_COLOURS.white, open = `<g data-id="${escapeXML(item.id)}" data-type="${item.type}">`;
  if (item.type === 'note') {
    const lines = fitted(item.text, item.w - 28, item.h - 28, 16);
    return `${open}<rect x="${round(item.x + 2)}" y="${round(item.y + 4)}" width="${item.w}" height="${item.h}" rx="6" fill="#000" opacity=".28"/><rect x="${round(item.x)}" y="${round(item.y)}" width="${item.w}" height="${item.h}" rx="6" fill="${colour.paper}"/>${textSVG(lines, { x: item.x + 14, y: item.y + 14, size: 16, fill: NOTE_INK })}</g>`;
  }
  if (item.type === 'rect' || item.type === 'ellipse' || item.type === 'diamond') {
    const { x, y, w, h } = item, cx = x + w / 2, cy = y + h / 2, style = `fill="${colour.line}" fill-opacity=".14" stroke="${colour.line}" stroke-width="2"`;
    const shape = item.type === 'rect' ? `<rect x="${round(x)}" y="${round(y)}" width="${w}" height="${h}" rx="10" ${style}/>`
      : item.type === 'ellipse' ? `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(w / 2)}" ry="${round(h / 2)}" ${style}/>`
        : `<path d="M${round(cx)} ${round(y)} L${round(x + w)} ${round(cy)} L${round(cx)} ${round(y + h)} L${round(x)} ${round(cy)} Z" ${style} stroke-linejoin="round"/>`;
    const inset = item.type === 'rect' ? 0.88 : item.type === 'ellipse' ? 0.72 : 0.56, lines = fitted(item.text, w * inset, h * inset, 15);
    const top = cy - (lines.length * 15 * 1.25) / 2;
    return `${open}${shape}${textSVG(lines, { x: cx, y: top, size: 15, fill: BOARD_INK, anchor: 'middle', weight: 500 })}</g>`;
  }
  if (item.type === 'text') return `${open}${hit ? (() => { const box = itemBox(item); return `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.w)}" height="${round(box.h)}" fill="transparent"/>`; })() : ''}${textSVG(textLines(item), { x: item.x, y: item.y, size: item.size, fill: colour.line, weight: item.size >= 28 ? 650 : 450 })}</g>`;
  if (item.type === 'draw') {
    const path = smoothPath(item.points);
    return `${open}${hit ? `<path d="${path}" fill="none" stroke="transparent" stroke-width="${item.width + 14}" stroke-linecap="round"/>` : ''}<path d="${path}" fill="none" stroke="${colour.line}" stroke-width="${item.width}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  const ends = arrowEnds(item, byId);
  if (!ends) return '';
  const [start, end] = ends, width = 2;
  const line = `M${round(start[0])} ${round(start[1])} L${round(end[0])} ${round(end[1])}`;
  let label = '';
  if (item.label) {
    const mx = (start[0] + end[0]) / 2, my = (start[1] + end[1]) / 2, lines = item.label.split('\n'), widest = Math.max(...lines.map(text => text.length)) * 13 * 0.56 + 14, tall = lines.length * 13 * 1.25 + 8;
    label = `<rect x="${round(mx - widest / 2)}" y="${round(my - tall / 2)}" width="${round(widest)}" height="${round(tall)}" rx="${round(Math.min(tall / 2, 10))}" fill="${BOARD_GROUND}" stroke="${colour.line}" stroke-opacity=".5"/>${textSVG(lines, { x: mx, y: my - tall / 2 + 4, size: 13, fill: BOARD_INK, anchor: 'middle' })}`;
  }
  const head = item.head === 'none' ? '' : arrowHead(start, end, colour.line, width) + (item.head === 'both' ? arrowHead(end, start, colour.line, width) : '');
  return `${open}${hit ? `<path d="${line}" stroke="transparent" stroke-width="16"/>` : ''}<path d="${line}" fill="none" stroke="${colour.line}" stroke-width="${width}" stroke-linecap="round"${item.dashed ? ' stroke-dasharray="7 6"' : ''}/>${head}${label}</g>`;
}
// Arrows go on top, so a line is never hidden under the boxes it joins.
export function sceneItemsSVG(scene: BoardScene, options?: { hit?: boolean }): string {
  const byId = indexItems(scene), order = [...scene.items.filter(item => item.type !== 'arrow'), ...scene.items.filter(item => item.type === 'arrow')];
  return order.map(item => itemSVG(item, byId, options)).join('');
}
// The whole board as a standalone SVG file, on its own ground, framed to what's on it.
export function sceneSVG(scene: BoardScene, { padding = 48, background = true }: { padding?: number; background?: boolean } = {}): string {
  const bounds = sceneBounds(scene), x = Math.floor(bounds.x - padding), y = Math.floor(bounds.y - padding), w = Math.ceil(bounds.w + padding * 2), h = Math.ceil(bounds.h + padding * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" font-family="${escapeXML(BOARD_FONT)}">${background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BOARD_GROUND}"/>` : ''}${sceneItemsSVG(scene)}</svg>`;
}
// One item to a line, so a model reading it back (or a person) can follow it.
export function sceneJSON(scene: BoardScene): string {
  return `{"items":[${scene.items.length ? `\n${scene.items.map(item => `  ${JSON.stringify(item)}`).join(',\n')}\n` : ''}]}\n`;
}
