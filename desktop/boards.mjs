import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { atomicJSON } from './json-store.mjs';

export const BOARD_FILE_VERSION = 1;
export const MAX_BOARD_EXPORT = 24 * 1024 * 1024;
const SAFE_ID = /^[a-zA-Z0-9_-]{4,64}$/;
const MAX_BOARD_BYTES = 16 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Strips active scripts, foreignObject HTML embeds, inline event handlers, and executable hrefs from imported SVGs.
export function sanitizeSvgImport(svgText) {
  return String(svgText ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<foreignObject\b[^>]*\/\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\b(?:xlink:)?href\s*=\s*)(?:"\s*(?:javascript:|vbscript:|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript:|vbscript:|data\s*:\s*text\/html)[^']*'|[^\s>]*?(?:javascript:|vbscript:|data\s*:\s*text\/html)[^\s>]*)/gi, '$1"#"');
}

// Local OS dialog handlers shared by desktop/main.cjs and desktop/face-main.cjs so Boards file operations work on both Macs.
export function createBoardsFileHandlers({ dialog, getWindow, createBoard }) {
  return {
    'boards-export-file': async ({ data, encoding = 'utf8', extension = 'png', defaultName = 'board' } = {}) => {
      const raw = String(data ?? '');
      if (raw.length > 36 * 1024 * 1024) return { canceled: false, error: 'Board export exceeds the 24 MB limit.' };
      const content = encoding === 'base64' ? Buffer.from(raw, 'base64') : raw;
      if (Buffer.byteLength(content, 'utf8') > MAX_BOARD_EXPORT) return { canceled: false, error: 'Board export exceeds the 24 MB limit.' };
      const ext = ['png', 'jpg', 'svg', 'json', 'miro'].includes(String(extension)) ? String(extension) : 'png';
      const base = String(defaultName || 'board').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'board';
      const chosen = await dialog.showSaveDialog(getWindow(), {
        defaultPath: `${base}.${ext}`,
        filters: [{ name: { png: 'PNG Image', jpg: 'JPEG Image', svg: 'SVG Image', json: 'JSON', miro: 'Miro Board' }[ext] || 'File', extensions: [ext] }],
      });
      if (chosen.canceled || !chosen.filePath) return { canceled: true };
      try {
        await writeFile(chosen.filePath, content, encoding === 'base64' ? undefined : 'utf8');
        return { canceled: false, filePath: chosen.filePath };
      } catch (error) {
        return { canceled: false, error: error.message };
      }
    },
    'boards-import-image': async () => {
      const chosen = await dialog.showOpenDialog(getWindow(), {
        title: 'Add images to board',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      });
      if (chosen.canceled || !chosen.filePaths?.length) return { canceled: true };
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
      const images = [];
      for (const filePath of chosen.filePaths.slice(0, 12)) {
        const info = await stat(filePath).catch(() => null);
        if (!info?.isFile() || info.size > 10 * 1024 * 1024) continue;
        const buf = await readFile(filePath);
        const mime = mimeMap[extname(filePath).toLowerCase()] || 'image/png';
        const payload = mime === 'image/svg+xml' ? Buffer.from(sanitizeSvgImport(buf.toString('utf8')), 'utf8') : buf;
        images.push(`data:${mime};base64,${payload.toString('base64')}`);
      }
      return { canceled: false, images };
    },
    'boards-open-file': async () => {
      const chosen = await dialog.showOpenDialog(getWindow(), {
        title: 'Open board file',
        properties: ['openFile'],
        filters: [{ name: 'Miro / JSON boards', extensions: ['miro', 'json'] }],
      });
      if (chosen.canceled || !chosen.filePaths?.[0]) return { canceled: true };
      try {
        const filePath = chosen.filePaths[0];
        const info = await stat(filePath);
        if (!info.isFile() || info.size > MAX_BOARD_BYTES) return { canceled: false, error: 'That board file is too large.' };
        const parsed = JSON.parse(await readFile(filePath, 'utf8'));
        const fallbackName = basename(filePath, extname(filePath)) || 'Imported board';
        const created = await createBoard({ name: parsed?.name || fallbackName, doc: { ...parsed, id: undefined } });
        return { canceled: false, ...created };
      } catch (error) {
        return { canceled: false, error: error.message || 'Could not open that board file.' };
      }
    },
  };
}

export const STICKY_PALETTE = [
  '#FFF9B1', // Yellow
  '#C5D0FF', // Indigo
  '#A9EDE4', // Teal
  '#FFCEA6', // Orange
  '#D9C7FF', // Violet
  '#C9F5D4', // Mint
  '#B3E5FC', // Sky
  '#FFCEE0', // Pink
];

const NAMED_COLORS = {
  yellow: '#FFF9B1',
  canary: '#FCE94F',
  orange: '#FFCEA6',
  red: '#FFB3B3',
  salmon: '#FFB3B3',
  pink: '#FFCEE0',
  violet: '#D9C7FF',
  purple: '#D9C7FF',
  indigo: '#C5D0FF',
  blue: '#C5D0FF',
  sky: '#B3E5FC',
  teal: '#A9EDE4',
  green: '#C9F5D4',
  mint: '#C9F5D4',
  grey: '#E6E6E6',
  gray: '#E6E6E6',
  white: '#FFFFFF',
  none: 'transparent',
  transparent: 'transparent',
};

const VALID_SHAPES = new Set([
  'rectangle', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon',
  'hexagon', 'star', 'arrowRight', 'parallelogram', 'cylinder', 'cross',
  'speechBubble', 'cloud',
]);

const DEFAULT_ELEMENT_STYLE = {
  fill: '#FFFFFF',
  stroke: 'auto',
  strokeWidth: 2,
  strokeStyle: 'solid',
  textColor: 'auto',
  fontFamily: 'sans',
  fontSize: 15,
  bold: false,
  italic: false,
  underline: false,
  textAlign: 'center',
  verticalAlign: 'middle',
};

export function parsePlanCommand(text) {
  const raw = String(text || '').trim();
  const match = /^\/plan(?:\s+([\s\S]+))?$/i.exec(raw);
  if (!match) return { matched: false, prompt: '' };
  return { matched: true, prompt: String(match[1] || '').trim() };
}

export function buildProjectPlanPrompt({ topic = '', existingBoard = null } = {}) {
  const existingNote = existingBoard?.name
    ? `\nYou may refine or replace elements on the existing board "${String(existingBoard.name).slice(0, 120)}".`
    : '';
  return `Create a thorough, actionable project plan for the user's request.${existingNote}

Produce TWO complementary parts in your response:
1. **Comprehensive Written Plan (Markdown)**:
   - Start with a top-level \`# <Concise Project Title>\` heading.
   - Include well-structured sections (\`## ...\`) covering: Executive Summary & Goals, Architecture & Key Components, Phased Roadmap & Milestones, Actionable Task Breakdown & Dependencies, Risks & Mitigations, and Verification / Success Criteria.
   - Be concrete, technical, and comprehensive.

2. **Paired Visual Miro Board Specification**:
   At the end of your response, include ONE fenced \`\`\`board code block containing a single valid JSON object structuring the entire plan as an interactive visual architecture & roadmap board:
\`\`\`board
{
  "title": "Short Board Title",
  "frames": [
    {
      "id": "frame-arch",
      "title": "Architecture & Components",
      "items": [
        { "id": "comp-1", "kind": "shape", "shape": "roundRect", "title": "Core Service", "body": "Brief responsibility", "color": "blue" },
        { "id": "comp-2", "kind": "sticky", "title": "Milestone / Note", "body": "Concrete deliverable", "color": "yellow" }
      ]
    }
  ],
  "connections": [
    { "from": "comp-1", "to": "comp-2", "label": "feeds", "shape": "curved" }
  ]
}
\`\`\`
Rules for \`\`\`board JSON:
- Include 3 to 6 distinct frames (e.g. Goals & Scope, System Architecture, Phase 1-3 Milestones, Risks & Open Questions, Verification).
- Each frame should contain 2 to 6 focused cards (\`kind\`: "sticky", "shape", or "text"; \`shape\`: "roundRect" | "rectangle" | "diamond" | "ellipse" | "cylinder"; \`color\`: "yellow" | "blue" | "teal" | "orange" | "violet" | "green" | "sky" | "pink").
- Connect related components, phase gates, and dependencies via \`connections\` referencing item or frame \`id\`s (\`shape\`: "curved" | "elbow" | "straight").
- Keep card titles crisp (2-6 words) and bodies concise (1-2 sentences).

User request: ${String(topic || '').trim()}`;
}

function resolveColor(input, fallbackIndex = 0, allowAuto = false) {
  if (typeof input !== 'string' || !input.trim()) {
    return STICKY_PALETTE[fallbackIndex % STICKY_PALETTE.length];
  }
  const lower = input.trim().toLowerCase();
  if (lower === 'auto' && allowAuto) return 'auto';
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  if (/^#[0-9a-f]{3,8}$/i.test(input.trim())) return input.trim();
  return STICKY_PALETTE[fallbackIndex % STICKY_PALETTE.length];
}

function makeBaseId(prefix = 'el') {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function cleanText(val, max = 500) {
  return String(val ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function estimateCardHeight(text, minHeight = 140) {
  const lines = cleanText(text).split('\n');
  let wrappedLines = 0;
  for (const line of lines) {
    wrappedLines += Math.max(1, Math.ceil(line.length / 26));
  }
  return Math.min(280, Math.max(minHeight, 52 + wrappedLines * 20));
}

export function buildBoardFromPlanSpec(spec = {}, { id = '', name = '' } = {}) {
  const src = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  const boardId = SAFE_ID.test(id || '') ? id : makeBaseId('brd');
  const boardName = cleanText(name || src.title || src.name || 'Project Plan', 120) || 'Project Plan';
  const rawFrames = Array.isArray(src.frames) ? src.frames.slice(0, 12) : [];

  const elements = {};
  const idMap = new Map();
  let order = 1;

  const frameLayouts = [];
  for (let fi = 0; fi < rawFrames.length; fi++) {
    const f = rawFrames[fi] && typeof rawFrames[fi] === 'object' ? rawFrames[fi] : {};
    const rawFrameId = cleanText(f.id || `frame-${fi + 1}`, 64) || `frame-${fi + 1}`;
    const frameElemId = makeBaseId('frm');
    const items = Array.isArray(f.items) ? f.items.slice(0, 18) : [];

    const cols = items.length <= 2 ? 1 : 2;
    const cardW = 220;
    const gapX = 28;
    const gapY = 24;
    const padX = 36;
    const padTop = 58;
    const padBottom = 34;

    const prepared = items.map((item, ii) => {
      const it = item && typeof item === 'object' ? item : { title: String(item ?? '') };
      const title = cleanText(it.title || it.label || '', 120);
      const body = cleanText(it.body || it.text || it.description || '', 360);
      const combined = title && body && body !== title ? `${title}\n\n${body}` : (title || body || `Item ${ii + 1}`);
      const kind = ['sticky', 'shape', 'text'].includes(it.kind) ? it.kind : (ii === 0 && !it.color ? 'shape' : 'sticky');
      const minH = kind === 'text' ? 76 : kind === 'shape' ? 116 : 148;
      return {
        rawId: cleanText(it.id || `${rawFrameId}-item-${ii + 1}`, 64),
        elemId: makeBaseId(kind === 'shape' ? 'shp' : kind === 'text' ? 'txt' : 'stk'),
        kind,
        shape: VALID_SHAPES.has(it.shape) ? it.shape : 'roundRect',
        text: combined,
        color: resolveColor(it.color, fi + ii),
        height: estimateCardHeight(combined, minH),
      };
    });

    const rowHeights = [];
    for (let r = 0; r < Math.ceil(Math.max(1, prepared.length) / cols); r++) {
      let maxH = 148;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (prepared[idx]) maxH = Math.max(maxH, prepared[idx].height);
      }
      rowHeights.push(maxH);
    }

    const contentH = rowHeights.reduce((a, b) => a + b, 0) + Math.max(0, rowHeights.length - 1) * gapY;
    const frameW = padX * 2 + cols * cardW + Math.max(0, cols - 1) * gapX;
    const frameH = padTop + (prepared.length ? contentH : 140) + padBottom;

    frameLayouts.push({
      rawFrameId,
      frameElemId,
      title: cleanText(f.title || f.name || `Phase ${fi + 1}`, 100) || `Section ${fi + 1}`,
      frameColor: f.color ? resolveColor(f.color, fi, true) : 'transparent',
      cols,
      cardW,
      gapX,
      gapY,
      padX,
      padTop,
      rowHeights,
      width: frameW,
      height: frameH,
      items: prepared,
    });
  }

  // Place frames in rows of up to 3 columns without overlapping.
  const gridCols = frameLayouts.length <= 2 ? frameLayouts.length || 1 : 3;
  const frameGapX = 100;
  const frameGapY = 110;
  let curY = 80;
  let maxRowWidth = 0;
  let totalMaxY = 80;

  for (let start = 0; start < frameLayouts.length; start += gridCols) {
    const row = frameLayouts.slice(start, start + gridCols);
    let curX = 80;
    let rowMaxH = 0;
    for (const fl of row) {
      fl.x = curX;
      fl.y = curY;
      curX += fl.width + frameGapX;
      rowMaxH = Math.max(rowMaxH, fl.height);
    }
    maxRowWidth = Math.max(maxRowWidth, curX - frameGapX - 80);
    curY += rowMaxH + frameGapY;
    totalMaxY = curY - frameGapY;
  }

  // Emit frame elements first (lowest z-order), then cards, then connectors.
  for (const fl of frameLayouts) {
    const frameEl = {
      id: fl.frameElemId,
      type: 'frame',
      name: fl.title,
      x: fl.x,
      y: fl.y,
      width: fl.width,
      height: fl.height,
      rotation: 0,
      order: order++,
      opacity: 1,
      locked: false,
      parentId: null,
      groupId: null,
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        fill: fl.frameColor === 'transparent' ? 'transparent' : fl.frameColor,
        stroke: 'auto',
        strokeWidth: 2,
        textColor: 'auto',
        fontSize: 16,
        bold: true,
      },
    };
    elements[frameEl.id] = frameEl;
    idMap.set(fl.rawFrameId, frameEl);
  }

  for (const fl of frameLayouts) {
    let rowY = fl.y + fl.padTop;
    for (let r = 0; r < fl.rowHeights.length; r++) {
      const rowH = fl.rowHeights[r];
      for (let c = 0; c < fl.cols; c++) {
        const item = fl.items[r * fl.cols + c];
        if (!item) continue;
        const x = fl.x + fl.padX + c * (fl.cardW + fl.gapX);
        const y = rowY;
        const base = {
          id: item.elemId,
          x,
          y,
          width: fl.cardW,
          height: rowH,
          rotation: 0,
          order: order++,
          opacity: 1,
          locked: false,
          parentId: fl.frameElemId,
          groupId: null,
        };

        let el;
        if (item.kind === 'shape') {
          el = {
            ...base,
            type: 'shape',
            shape: item.shape,
            text: item.text,
            style: {
              ...DEFAULT_ELEMENT_STYLE,
              fill: item.color,
              stroke: 'auto',
              strokeWidth: 2,
              textColor: item.color === 'transparent' ? 'auto' : '#1A1A1A',
              fontSize: 14,
            },
          };
        } else if (item.kind === 'text') {
          el = {
            ...base,
            type: 'text',
            text: item.text,
            autoHeight: true,
            style: {
              ...DEFAULT_ELEMENT_STYLE,
              fill: 'transparent',
              stroke: 'transparent',
              textColor: 'auto',
              fontSize: 15,
              textAlign: 'left',
              verticalAlign: 'top',
            },
          };
        } else {
          el = {
            ...base,
            type: 'sticky',
            text: item.text,
            style: {
              ...DEFAULT_ELEMENT_STYLE,
              fill: item.color,
              stroke: '#E5DEC9',
              strokeWidth: 1,
              textColor: '#1A1A1A',
              fontSize: 14,
            },
          };
        }
        elements[el.id] = el;
        if (item.rawId) idMap.set(item.rawId, el);
      }
      rowY += rowH + fl.gapY;
    }
  }

  const rawConnections = Array.isArray(src.connections) ? src.connections.slice(0, 60) : [];
  for (const conn of rawConnections) {
    if (!conn || typeof conn !== 'object') continue;
    const fromEl = idMap.get(String(conn.from || '').trim());
    const toEl = idMap.get(String(conn.to || '').trim());
    if (!fromEl || !toEl || fromEl.id === toEl.id) continue;

    const sx = fromEl.x + fromEl.width / 2;
    const sy = fromEl.y + fromEl.height / 2;
    const tx = toEl.x + toEl.width / 2;
    const ty = toEl.y + toEl.height / 2;
    const dx = tx - sx;
    const dy = ty - sy;

    let start;
    let end;
    if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
      if (dx >= 0) {
        start = { elementId: fromEl.id, nx: 1, ny: 0.5, x: 0, y: 0 };
        end = { elementId: toEl.id, nx: 0, ny: 0.5, x: 0, y: 0 };
      } else {
        start = { elementId: fromEl.id, nx: 0, ny: 0.5, x: 0, y: 0 };
        end = { elementId: toEl.id, nx: 1, ny: 0.5, x: 0, y: 0 };
      }
    } else if (dy >= 0) {
      start = { elementId: fromEl.id, nx: 0.5, ny: 1, x: 0, y: 0 };
      end = { elementId: toEl.id, nx: 0.5, ny: 0, x: 0, y: 0 };
    } else {
      start = { elementId: fromEl.id, nx: 0.5, ny: 0, x: 0, y: 0 };
      end = { elementId: toEl.id, nx: 0.5, ny: 1, x: 0, y: 0 };
    }

    const connEl = {
      id: makeBaseId('cnt'),
      type: 'connector',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      order: order++,
      opacity: 1,
      locked: false,
      parentId: null,
      groupId: null,
      start,
      end,
      shape: ['straight', 'elbow', 'curved'].includes(conn.shape) ? conn.shape : 'curved',
      startArrow: 'none',
      endArrow: 'arrow',
      text: cleanText(conn.label || '', 60),
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        fill: 'transparent',
        stroke: 'auto',
        strokeWidth: 2,
        textColor: 'auto',
        fontSize: 13,
      },
    };
    elements[connEl.id] = connEl;
  }

  const totalW = Math.max(800, maxRowWidth);
  const totalH = Math.max(500, totalMaxY - 80);
  const fitZoom = Math.max(0.32, Math.min(0.9, Math.min(1040 / (totalW + 120), 640 / (totalH + 120))));

  return {
    version: BOARD_FILE_VERSION,
    id: boardId,
    name: boardName,
    elements,
    camera: {
      x: Number((80 - 60).toFixed(1)),
      y: Number((80 - 60).toFixed(1)),
      zoom: Number(fitZoom.toFixed(2)),
    },
    background: 'dots',
  };
}

function synthesizeSpecFromMarkdown(markdown, fallbackTitle) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let docTitle = cleanText(fallbackTitle, 100) || 'Project Plan';
  const frames = [];
  let current = null;

  for (const raw of lines) {
    const h1 = /^#\s+(.+)$/.exec(raw.trim());
    if (h1 && !frames.length) {
      docTitle = cleanText(h1[1], 100) || docTitle;
      continue;
    }
    const h2 = /^#{2,3}\s+(.+)$/.exec(raw.trim());
    if (h2) {
      current = { id: `sec-${frames.length + 1}`, title: cleanText(h2[1], 80), items: [] };
      frames.push(current);
      continue;
    }
    const bullet = /^(?:[-*]|\d+[.)])\s+(.+)$/.exec(raw.trim());
    if (bullet && current && current.items.length < 8) {
      const txt = bullet[1].replace(/\*\*([^*]+)\*\*/g, '$1').trim();
      current.items.push({
        id: `${current.id}-it-${current.items.length + 1}`,
        kind: current.items.length === 0 ? 'shape' : 'sticky',
        title: txt.slice(0, 180),
        color: STICKY_PALETTE[(frames.length + current.items.length) % STICKY_PALETTE.length],
      });
    }
  }

  const connections = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const src = frames[i].items[0]?.id || frames[i].id;
    const dst = frames[i + 1].items[0]?.id || frames[i + 1].id;
    connections.push({ from: src, to: dst, shape: 'curved' });
  }

  return { title: docTitle, frames, connections };
}

export function extractPlanOutputs(reply, fallbackTitle = 'Project Plan') {
  const source = String(reply ?? '').replace(/\r\n/g, '\n');
  const boardFence = /```board(?:-json)?\s*\n([\s\S]*?)```/i;
  let spec = null;
  let markdown = source;
  let hasExplicitBoard = false;

  const matched = boardFence.exec(source);
  if (matched) {
    try {
      const parsed = JSON.parse(matched[1].trim());
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.frames) && parsed.frames.length) {
        spec = parsed;
        hasExplicitBoard = true;
        markdown = `${source.slice(0, matched.index)}${source.slice(matched.index + matched[0].length)}`.replace(/\n{3,}/g, '\n\n').trim();
      }
    } catch {
      // Malformed JSON falls back cleanly to Markdown heading synthesis below.
    }
  }

  const h1Match = /^#\s+(.+)$/m.exec(markdown);
  const title = cleanText(spec?.title || h1Match?.[1] || fallbackTitle, 100) || 'Project Plan';
  const finalSpec = spec || synthesizeSpecFromMarkdown(markdown, title);
  const boardDoc = buildBoardFromPlanSpec(finalSpec, { name: title });

  return {
    title,
    markdown: markdown || `# ${title}\n\nNo written details were returned.`,
    boardDoc,
    hasExplicitBoard,
  };
}

function sanitizeElementsMap(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [key, val] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(key) || !val || typeof val !== 'object') continue;
    clean[key] = val;
  }
  return clean;
}

export function normalizeStoredBoard(raw, fallbackId = '', fallbackName = 'Untitled board') {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const id = SAFE_ID.test(src.id || '') ? src.id : (SAFE_ID.test(fallbackId || '') ? fallbackId : makeBaseId('brd'));
  const name = cleanText(src.name || fallbackName, 120) || 'Untitled board';
  const camera = src.camera && typeof src.camera === 'object'
    ? {
        x: Number.isFinite(Number(src.camera.x)) ? Number(src.camera.x) : 0,
        y: Number.isFinite(Number(src.camera.y)) ? Number(src.camera.y) : 0,
        zoom: Number.isFinite(Number(src.camera.zoom)) ? Math.max(0.1, Math.min(4, Number(src.camera.zoom))) : 1,
      }
    : { x: 0, y: 0, zoom: 1 };
  const background = ['dots', 'grid', 'lines', 'plain', 'none'].includes(src.background) ? src.background : 'dots';
  return {
    version: BOARD_FILE_VERSION,
    id,
    name,
    elements: sanitizeElementsMap(src.elements),
    camera,
    background,
  };
}

export class BoardStore {
  constructor({ dir, onChange = () => {}, now = () => new Date().toISOString() }) {
    this.dir = dir;
    this.onChange = onChange;
    this.now = now;
    this.items = [];
  }

  indexPath() { return join(this.dir, 'index.json'); }
  boardPath(id) {
    if (!SAFE_ID.test(id || '')) throw new Error('Invalid board identifier.');
    return join(this.dir, `${id}.json`);
  }

  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(await readFile(this.indexPath(), 'utf8'));
      const list = Array.isArray(raw?.items) ? raw.items : [];
      this.items = list
        .filter(item => item && SAFE_ID.test(item.id || ''))
        .map(item => ({
          id: item.id,
          name: cleanText(item.name || 'Untitled board', 120) || 'Untitled board',
          description: cleanText(item.description || '', 280),
          session: typeof item.session === 'string' ? item.session.slice(0, 80) : '',
          docId: typeof item.docId === 'string' ? item.docId.slice(0, 80) : '',
          elementCount: Math.max(0, Number(item.elementCount) || 0),
          createdAt: String(item.createdAt || this.now()),
          updatedAt: String(item.updatedAt || this.now()),
        }));
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not read boards index:', error.message);
      this.items = [];
    }
    return this.list();
  }

  list() {
    return [...this.items]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(item => ({ ...item }));
  }

  async saveIndex() {
    await atomicJSON(this.indexPath(), JSON.stringify({ version: 1, items: this.items }, null, 2));
  }

  async get(id) {
    const meta = this.items.find(item => item.id === id);
    if (!meta) throw new Error('That board was not found.');
    const raw = JSON.parse(await readFile(this.boardPath(id), 'utf8'));
    const doc = normalizeStoredBoard(raw, id, meta.name);
    return { meta: { ...meta }, document: doc };
  }

  async create({ name = 'Untitled board', doc = null, session = '', docId = '', description = '' } = {}) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const id = SAFE_ID.test(doc?.id || '') && !this.items.some(i => i.id === doc.id) ? doc.id : makeBaseId('brd');
    const cleanName = cleanText(name || doc?.name || 'Untitled board', 120) || 'Untitled board';
    const normalized = normalizeStoredBoard(doc ? { ...doc, id, name: cleanName } : { version: BOARD_FILE_VERSION, id, name: cleanName, elements: {}, camera: { x: 0, y: 0, zoom: 1 }, background: 'dots' }, id, cleanName);
    const jsonText = JSON.stringify(normalized);
    if (Buffer.byteLength(jsonText, 'utf8') > MAX_BOARD_BYTES) throw new Error('Board data exceeds maximum size.');

    await atomicJSON(this.boardPath(id), jsonText);
    const timestamp = this.now();
    const meta = {
      id,
      name: cleanName,
      description: cleanText(description, 280),
      session: String(session || '').slice(0, 80),
      docId: String(docId || '').slice(0, 80),
      elementCount: Object.keys(normalized.elements).length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.items.push(meta);
    await this.saveIndex();
    this.onChange(this.list());
    return { meta: { ...meta }, document: normalized };
  }

  async save(id, document, metaPatch = null) {
    const idx = this.items.findIndex(item => item.id === id);
    if (idx < 0) throw new Error('That board was not found.');
    const prev = this.items[idx];
    const normalized = normalizeStoredBoard({ ...document, id }, id, document?.name || prev.name);
    const jsonText = JSON.stringify(normalized);
    if (Buffer.byteLength(jsonText, 'utf8') > MAX_BOARD_BYTES) throw new Error('Board data exceeds maximum size.');

    await atomicJSON(this.boardPath(id), jsonText);
    const updated = {
      ...prev,
      name: normalized.name,
      elementCount: Object.keys(normalized.elements).length,
      ...(metaPatch && typeof metaPatch === 'object' ? {
        ...(typeof metaPatch.docId === 'string' ? { docId: metaPatch.docId.slice(0, 80) } : {}),
        ...(typeof metaPatch.description === 'string' ? { description: cleanText(metaPatch.description, 280) } : {}),
        ...(typeof metaPatch.session === 'string' ? { session: metaPatch.session.slice(0, 80) } : {}),
      } : {}),
      updatedAt: this.now(),
    };
    this.items[idx] = updated;
    await this.saveIndex();
    this.onChange(this.list());
    return { meta: { ...updated }, document: normalized };
  }

  async rename(id, name) {
    const cleanName = cleanText(name, 120);
    if (!cleanName) throw new Error('Enter a board name.');
    const { document } = await this.get(id);
    return this.save(id, { ...document, name: cleanName });
  }

  async remove(id) {
    const idx = this.items.findIndex(item => item.id === id);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    await rm(this.boardPath(id), { force: true });
    await this.saveIndex();
    this.onChange(this.list());
    return true;
  }
}

export function summarizeBoardForAI(doc = {}, selectedIds = []) {
  const norm = normalizeStoredBoard(doc);
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []);
  const els = Object.values(norm.elements || {}).sort((a, b) => (a.order || 0) - (b.order || 0));
  const frames = [];
  const items = [];
  const connections = [];

  for (const el of els) {
    const sel = selectedSet.has(el.id);
    if (el.type === 'frame') {
      frames.push({
        id: el.id,
        title: cleanText(el.name || 'Frame', 80),
        x: Math.round(el.x || 0),
        y: Math.round(el.y || 0),
        width: Math.round(el.width || 0),
        height: Math.round(el.height || 0),
        ...(sel ? { selected: true } : {}),
      });
    } else if (el.type === 'connector') {
      connections.push({
        id: el.id,
        from: el.start?.elementId || null,
        to: el.end?.elementId || null,
        label: cleanText(el.text || '', 60),
        shape: el.shape || 'curved',
      });
    } else if (items.length < 80) {
      items.push({
        id: el.id,
        type: el.type,
        ...(el.shape ? { shape: el.shape } : {}),
        ...(el.parentId ? { frameId: el.parentId } : {}),
        text: cleanText(el.text || '', 180),
        color: el.style?.fill || '#FFFFFF',
        x: Math.round(el.x || 0),
        y: Math.round(el.y || 0),
        ...(sel ? { selected: true } : {}),
      });
    }
  }

  return {
    id: norm.id,
    name: norm.name,
    counts: {
      total: els.length,
      frames: frames.length,
      items: els.filter(e => e.type !== 'frame' && e.type !== 'connector').length,
      connectors: connections.length,
    },
    selectedIds: [...selectedSet].filter(id => Boolean(norm.elements[id])),
    frames: frames.slice(0, 24),
    items,
    connections: connections.slice(0, 60),
  };
}

export function buildBoardTaskPrompt({ prompt = '', doc = null, selectedIds = [], history = [] } = {}) {
  const boardSummary = summarizeBoardForAI(doc || {}, selectedIds);
  const recentTurns = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map(m => `${m?.role === 'assistant' ? 'Fairy' : 'User'}: ${cleanText(m?.content || '', 400)}`)
    .filter(Boolean)
    .join('\n');

  const instructions = `You are Fairy, embedded inside an infinite visual Miro-style whiteboard workspace.
Help the user inspect, brainstorm, diagram, organize, or edit the active board cleanly.

Output rules:
1. Reply concisely in plain prose (1-4 sentences) explaining what you answered or changed on the board.
2. Whenever the user's request involves creating, adding, connecting, updating, deleting, renaming, or reorganizing board objects, append ONE fenced \`\`\`board-ops JSON block at the very end of your reply.
3. If the user asks a pure question (e.g. "summarize this board", "what are the risks?"), do NOT include a \`\`\`board-ops block.
4. Valid \`\`\`board-ops JSON formats:
   - Incremental edits (preferred when items already exist):
     \`\`\`board-ops
     {
       "mode": "ops",
       "summary": "Added risk mitigation stickies",
       "ops": [
         { "op": "add_frame", "id": "f1", "title": "Section Title", "color": "transparent", "items": [
           { "id": "c1", "kind": "sticky", "title": "Short title", "body": "1-2 line detail", "color": "yellow" }
         ]},
         { "op": "add_card", "id": "c2", "frameId": "existing_frame_id", "kind": "shape", "shape": "roundRect", "title": "Card Title", "body": "Details", "color": "blue" },
         { "op": "connect", "from": "c1", "to": "c2", "label": "feeds", "shape": "curved" },
         { "op": "update", "id": "existing_id", "title": "Updated Title", "body": "Updated detail", "color": "green" },
         { "op": "delete", "ids": ["existing_id"] },
         { "op": "rename", "name": "New Board Title" }
       ]
     }
     \`\`\`
   - Full board replacement (use when the board is blank or user explicitly asks to build/replace the whole board):
     \`\`\`board-ops
     {
       "mode": "replace",
       "title": "Board Title",
       "frames": [
         { "id": "f1", "title": "Frame", "items": [{ "id": "n1", "kind": "shape", "shape": "roundRect", "title": "Node", "body": "Detail", "color": "teal" }] }
       ],
       "connections": [{ "from": "n1", "to": "n2", "label": "label", "shape": "curved" }]
     }
     \`\`\`
5. Supported colors: yellow, orange, red, pink, violet, indigo, blue, sky, teal, green, mint, white, grey, transparent. Shapes: roundRect, rectangle, diamond, ellipse, cylinder, triangle, hexagon, star, parallelogram, speechBubble, cloud.`;

  const userPrompt = [
    `Active board snapshot (JSON):\n${JSON.stringify(boardSummary)}`,
    recentTurns ? `Recent board chat:\n${recentTurns}` : '',
    `User request: ${cleanText(prompt, 4000)}`,
  ].filter(Boolean).join('\n\n');

  return { instructions, userPrompt };
}

function connectAnchorPair(fromEl, toEl) {
  const sx = (fromEl.x || 0) + (fromEl.width || 0) / 2;
  const sy = (fromEl.y || 0) + (fromEl.height || 0) / 2;
  const tx = (toEl.x || 0) + (toEl.width || 0) / 2;
  const ty = (toEl.y || 0) + (toEl.height || 0) / 2;
  const dx = tx - sx;
  const dy = ty - sy;

  if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
    if (dx >= 0) {
      return {
        start: { elementId: fromEl.id, nx: 1, ny: 0.5, x: 0, y: 0 },
        end: { elementId: toEl.id, nx: 0, ny: 0.5, x: 0, y: 0 },
      };
    }
    return {
      start: { elementId: fromEl.id, nx: 0, ny: 0.5, x: 0, y: 0 },
      end: { elementId: toEl.id, nx: 1, ny: 0.5, x: 0, y: 0 },
    };
  }
  if (dy >= 0) {
    return {
      start: { elementId: fromEl.id, nx: 0.5, ny: 1, x: 0, y: 0 },
      end: { elementId: toEl.id, nx: 0.5, ny: 0, x: 0, y: 0 },
    };
  }
  return {
    start: { elementId: fromEl.id, nx: 0.5, ny: 0, x: 0, y: 0 },
    end: { elementId: toEl.id, nx: 0.5, ny: 1, x: 0, y: 0 },
  };
}

function makeCardElement({ raw, x, y, width = 220, height = null, order = 1, parentId = null, colorIdx = 0 }) {
  const title = cleanText(raw?.title || raw?.label || '', 120);
  const body = cleanText(raw?.body || raw?.text || raw?.description || '', 360);
  const combined = title && body && body !== title ? `${title}\n\n${body}` : (title || body || 'Note');
  const kind = ['sticky', 'shape', 'text'].includes(raw?.kind) ? raw.kind : 'sticky';
  const minH = kind === 'text' ? 68 : kind === 'shape' ? 112 : 148;
  const h = Number.isFinite(Number(height)) && Number(height) > 20 ? Number(height) : estimateCardHeight(combined, minH);
  const w = Number.isFinite(Number(width)) && Number(width) > 40 ? Number(width) : 220;
  const color = resolveColor(raw?.color, colorIdx);
  const id = makeBaseId(kind === 'shape' ? 'shp' : kind === 'text' ? 'txt' : 'stk');
  const common = {
    id,
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    order,
    opacity: 1,
    locked: false,
    parentId,
    groupId: null,
  };

  if (kind === 'shape') {
    return {
      ...common,
      type: 'shape',
      shape: VALID_SHAPES.has(raw?.shape) ? raw.shape : 'roundRect',
      text: combined,
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        fill: color,
        stroke: 'auto',
        strokeWidth: 2,
        textColor: color === 'transparent' ? 'auto' : '#1A1A1A',
        fontSize: 14,
      },
    };
  }
  if (kind === 'text') {
    return {
      ...common,
      type: 'text',
      text: combined,
      autoHeight: true,
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        fill: 'transparent',
        stroke: 'transparent',
        textColor: 'auto',
        fontSize: 15,
        textAlign: 'left',
        verticalAlign: 'top',
      },
    };
  }
  return {
    ...common,
    type: 'sticky',
    text: combined,
    style: {
      ...DEFAULT_ELEMENT_STYLE,
      fill: color,
      stroke: '#E5DEC9',
      strokeWidth: 1,
      textColor: '#1A1A1A',
      fontSize: 14,
    },
  };
}

function boardContentBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of Object.values(elements)) {
    if (!el || el.type === 'connector') continue;
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, maxX, maxY };
}

export function applyBoardTaskResponse(currentDoc = {}, replyText = '') {
  const baseDoc = normalizeStoredBoard(currentDoc);
  const source = String(replyText ?? '').replace(/\r\n/g, '\n');
  const fence = /```board(?:-ops)?\s*\n([\s\S]*?)```/i;
  const matched = fence.exec(source);

  if (!matched) {
    return { reply: source.trim(), document: baseDoc, changed: false, opsApplied: 0, summary: '' };
  }

  const cleanReply = `${source.slice(0, matched.index)}${source.slice(matched.index + matched[0].length)}`.replace(/\n{3,}/g, '\n\n').trim();
  let spec = null;
  try {
    spec = JSON.parse(matched[1].trim());
  } catch {
    return {
      reply: cleanReply || 'Could not apply board changes because the AI returned invalid board JSON.',
      document: baseDoc,
      changed: false,
      opsApplied: 0,
      summary: '',
    };
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { reply: cleanReply, document: baseDoc, changed: false, opsApplied: 0, summary: '' };
  }

  // Full board build/replace path
  if (spec.mode === 'replace' || (Array.isArray(spec.frames) && !Array.isArray(spec.ops))) {
    const boardPayload = spec.board && typeof spec.board === 'object' ? spec.board : spec;
    if (!Array.isArray(boardPayload.frames) || !boardPayload.frames.length) {
      return { reply: cleanReply, document: baseDoc, changed: false, opsApplied: 0, summary: '' };
    }
    const nextDoc = buildBoardFromPlanSpec(boardPayload, {
      id: baseDoc.id,
      name: cleanText(boardPayload.title || boardPayload.name || baseDoc.name, 120) || baseDoc.name,
    });
    nextDoc.background = baseDoc.background;
    const count = Object.keys(nextDoc.elements).length;
    return {
      reply: cleanReply || `Built board "${nextDoc.name}" with ${count} objects.`,
      document: nextDoc,
      changed: true,
      opsApplied: count,
      summary: cleanText(spec.summary || `Built ${boardPayload.frames.length} sections`, 80),
    };
  }

  const ops = Array.isArray(spec.ops) ? spec.ops.slice(0, 80) : [];
  if (!ops.length) {
    return { reply: cleanReply, document: baseDoc, changed: false, opsApplied: 0, summary: '' };
  }

  const nextElements = structuredClone(baseDoc.elements);
  let nextName = baseDoc.name;
  let maxOrder = Object.values(nextElements).reduce((m, e) => Math.max(m, Number(e?.order) || 0), 0);
  const aliasMap = new Map();
  for (const el of Object.values(nextElements)) aliasMap.set(el.id, el);

  const resolveEl = ref => {
    const key = cleanText(ref || '', 80);
    if (!key) return null;
    return aliasMap.get(key) || nextElements[key] || null;
  };

  let opsApplied = 0;
  let freeCardCount = 0;

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const kind = String(op.op || '').trim();

    if (kind === 'rename') {
      const next = cleanText(op.name || op.title || '', 120);
      if (next && next !== nextName) {
        nextName = next;
        opsApplied += 1;
      }
      continue;
    }

    if (kind === 'delete') {
      const ids = Array.isArray(op.ids) ? op.ids : (op.id ? [op.id] : []);
      const removed = new Set();
      for (const rawId of ids) {
        const target = resolveEl(rawId);
        if (target && nextElements[target.id]) {
          delete nextElements[target.id];
          removed.add(target.id);
          opsApplied += 1;
        }
      }
      if (removed.size) {
        for (const [elId, el] of Object.entries(nextElements)) {
          if (el.type === 'connector' && (removed.has(el.start?.elementId) || removed.has(el.end?.elementId))) {
            delete nextElements[elId];
          } else if (removed.has(el.parentId)) {
            nextElements[elId] = { ...el, parentId: null };
          }
        }
      }
      continue;
    }

    if (kind === 'update') {
      const target = resolveEl(op.id);
      if (!target || !nextElements[target.id]) continue;
      const updated = { ...nextElements[target.id], style: { ...nextElements[target.id].style } };
      let touched = false;
      if (updated.type === 'frame' && (typeof op.name === 'string' || typeof op.title === 'string')) {
        updated.name = cleanText(op.name || op.title, 100) || updated.name;
        touched = true;
      } else if ('text' in updated) {
        if (typeof op.text === 'string') {
          updated.text = cleanText(op.text, 500);
          touched = true;
        } else if (typeof op.title === 'string' || typeof op.body === 'string') {
          const t = cleanText(op.title || '', 120);
          const b = cleanText(op.body || '', 360);
          updated.text = t && b ? `${t}\n\n${b}` : (t || b || updated.text);
          touched = true;
        }
      }
      if (typeof op.color === 'string' && op.color.trim()) {
        const fill = resolveColor(op.color, opsApplied, updated.type === 'frame');
        updated.style.fill = fill;
        if (updated.type !== 'frame' && updated.type !== 'connector') {
          updated.style.textColor = fill === 'transparent' ? 'auto' : '#1A1A1A';
        }
        touched = true;
      }
      if (touched) {
        nextElements[updated.id] = updated;
        aliasMap.set(updated.id, updated);
        opsApplied += 1;
      }
      continue;
    }

    if (kind === 'add_frame') {
      const bounds = boardContentBounds(nextElements);
      const originX = bounds ? bounds.maxX + 100 : 80;
      const originY = bounds ? bounds.y : 80;
      const items = Array.isArray(op.items) ? op.items.slice(0, 18) : [];
      const built = buildBoardFromPlanSpec({
        title: nextName,
        frames: [{
          id: op.id || 'added-frame',
          title: cleanText(op.title || op.name || 'New Section', 100),
          color: op.color || 'transparent',
          items,
        }],
      });
      const builtList = Object.values(built.elements).sort((a, b) => (a.order || 0) - (b.order || 0));
      const frameIdxMap = new Map();
      const dx = originX - 80;
      const dy = originY - 80;

      for (const el of builtList) {
        const mappedParent = el.parentId ? frameIdxMap.get(el.parentId) || el.parentId : null;
        const shifted = {
          ...el,
          x: (el.x || 0) + dx,
          y: (el.y || 0) + dy,
          parentId: mappedParent,
          order: ++maxOrder,
        };
        if (el.type === 'frame') {
          frameIdxMap.set(el.id, shifted.id);
          if (op.id) aliasMap.set(String(op.id), shifted);
        }
        nextElements[shifted.id] = shifted;
        aliasMap.set(shifted.id, shifted);
      }
      // Match item alias ids from op.items onto the newly inserted non-frame cards
      const newCards = builtList.filter(e => e.type !== 'frame');
      items.forEach((item, idx) => {
        if (item && typeof item === 'object' && item.id && newCards[idx]) {
          aliasMap.set(String(item.id), nextElements[newCards[idx].id]);
        }
      });
      opsApplied += 1;
      continue;
    }

    if (kind === 'add_card') {
      const frameRef = op.frameId ? resolveEl(op.frameId) : null;
      let x = Number(op.x);
      let y = Number(op.y);
      let parentId = null;

      if (frameRef && frameRef.type === 'frame' && nextElements[frameRef.id]) {
        parentId = frameRef.id;
        const kids = Object.values(nextElements).filter(e => e.parentId === frameRef.id);
        const col = kids.length % 2;
        const row = Math.floor(kids.length / 2);
        const cardW = Number(op.width) || 220;
        const padX = 36;
        const gapX = 28;
        const padTop = 58;
        const rowStride = 180;
        if (!Number.isFinite(x)) x = frameRef.x + padX + col * (cardW + gapX);
        if (!Number.isFinite(y)) y = frameRef.y + padTop + row * rowStride;
        const neededH = (y - frameRef.y) + 190 + 34;
        const neededW = (x - frameRef.x) + cardW + 36;
        if (neededH > frameRef.height || neededW > frameRef.width) {
          const grown = { ...frameRef, height: Math.max(frameRef.height, neededH), width: Math.max(frameRef.width, neededW) };
          nextElements[grown.id] = grown;
          aliasMap.set(grown.id, grown);
        }
      } else {
        const bounds = boardContentBounds(nextElements);
        const col = freeCardCount % 3;
        const row = Math.floor(freeCardCount / 3);
        if (!Number.isFinite(x)) x = (bounds ? bounds.maxX + 80 : 120) + col * 244;
        if (!Number.isFinite(y)) y = (bounds ? bounds.y : 120) + row * 184;
        freeCardCount += 1;
      }

      const cardEl = makeCardElement({
        raw: op,
        x,
        y,
        width: op.width,
        height: op.height,
        order: ++maxOrder,
        parentId,
        colorIdx: opsApplied,
      });
      nextElements[cardEl.id] = cardEl;
      aliasMap.set(cardEl.id, cardEl);
      if (op.id) aliasMap.set(String(op.id), cardEl);
      opsApplied += 1;
      continue;
    }

    if (kind === 'connect') {
      const fromEl = resolveEl(op.from);
      const toEl = resolveEl(op.to);
      if (!fromEl || !toEl || fromEl.id === toEl.id) continue;
      const anchors = connectAnchorPair(fromEl, toEl);
      const connEl = {
        id: makeBaseId('cnt'),
        type: 'connector',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        order: ++maxOrder,
        opacity: 1,
        locked: false,
        parentId: null,
        groupId: null,
        start: anchors.start,
        end: anchors.end,
        shape: ['straight', 'elbow', 'curved'].includes(op.shape) ? op.shape : 'curved',
        startArrow: 'none',
        endArrow: 'arrow',
        text: cleanText(op.label || '', 60),
        style: {
          ...DEFAULT_ELEMENT_STYLE,
          fill: 'transparent',
          stroke: 'auto',
          strokeWidth: 2,
          textColor: 'auto',
          fontSize: 13,
        },
      };
      nextElements[connEl.id] = connEl;
      aliasMap.set(connEl.id, connEl);
      opsApplied += 1;
    }
  }

  const nextDoc = normalizeStoredBoard({ ...baseDoc, name: nextName, elements: nextElements }, baseDoc.id, nextName);
  return {
    reply: cleanReply || (opsApplied > 0 ? `Updated "${nextDoc.name}".` : ''),
    document: nextDoc,
    changed: opsApplied > 0,
    opsApplied,
    summary: opsApplied > 0 ? cleanText(spec.summary || `${opsApplied} board update${opsApplied === 1 ? '' : 's'}`, 80) : '',
  };
}
