// Declarative Agent-to-User Interface (A2UI v0.9.1) core: validation, JSON Pointer bindings,
// safe expressions, incremental message reducer, and markdown block extraction.
// Zero imports so it runs in Node ESM, Vite bundles, and inlined fairy-artifact:// pages.

export const A2UI_PROTOCOL_VERSION = '0.9.1';
export const A2UI_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
export const FAIRY_CATALOG_ID = 'fairy:v1';

export const BASIC_COMPONENTS = Object.freeze([
  'Column', 'Row', 'List', 'Card', 'Tabs', 'Modal', 'Divider',
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer',
  'Button', 'TextField', 'CheckBox', 'Switch', 'Slider', 'ChoicePicker', 'DateTimeInput',
]);

export const FAIRY_COMPONENTS = Object.freeze([
  'Markdown', 'CodeBlock', 'Math', 'MetricTile', 'Sparkline', 'Badge',
]);

export const ALL_COMPONENTS = Object.freeze([...BASIC_COMPONENTS, ...FAIRY_COMPONENTS]);

export const A2UI_LIMITS = Object.freeze({
  components: 200,
  depth: 24,
  dataBytes: 65536,
  listItems: 100,
  surfaces: 6,
  stringChars: 16000,
  titleChars: 120,
  idChars: 80,
});

const COMPONENT_CANONICAL = (() => {
  const map = new Map();
  for (const name of ALL_COMPONENTS) map.set(name.toLowerCase(), name);
  map.set('dropdown', 'ChoicePicker');
  map.set('select', 'ChoicePicker');
  map.set('checkbox', 'CheckBox');
  return map;
})();

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_JSON_DEPTH = 32;

const utf8Bytes = text => {
  const value = String(text ?? '');
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
};

const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function normalizeComponentType(name) {
  if (typeof name !== 'string') return '';
  return COMPONENT_CANONICAL.get(name.trim().toLowerCase()) || '';
}

export function cleanId(value, limit = A2UI_LIMITS.idChars) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const cleaned = String(value).trim().replace(/[^\w.:/-]/g, '').slice(0, limit);
  return cleaned;
}

export function cleanString(value, limit = A2UI_LIMITS.stringChars) {
  return String(value ?? '').replace(/\0/g, '').slice(0, limit);
}

export function safeMediaUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 4096) return '';
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
  if (/^fairy-artifact:\/\/[a-z0-9_./%-]+$/i.test(trimmed)) return trimmed;
  if (/^_blob\/[0-9a-f]{32}$/.test(trimmed)) return trimmed;
  return '';
}

export function cloneSafeJSON(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'string' ? cleanString(value) : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length && i < 500; i++) out.push(cloneSafeJSON(value[i], depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(k) || count >= 300) continue;
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      out[k] = cloneSafeJSON(v, depth + 1);
      count++;
    }
    return out;
  }
  return null;
}

export function clampDataModel(data) {
  const safe = isPlain(data) ? cloneSafeJSON(data) : {};
  const encoded = JSON.stringify(safe);
  if (utf8Bytes(encoded) <= A2UI_LIMITS.dataBytes) return safe;
  // Trim largest top-level keys first so partial model state still fits cleanly.
  const pruned = {};
  let running = 2;
  for (const [key, val] of Object.entries(safe)) {
    const piece = JSON.stringify({ [key]: val });
    const add = utf8Bytes(piece) - 1;
    if (running + add > A2UI_LIMITS.dataBytes) continue;
    pruned[key] = val;
    running += add;
  }
  return pruned;
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') return null;
  const raw = pointer.trim();
  if (!raw || raw === '/') return { absolute: raw.startsWith('/'), segments: [] };
  const absolute = raw.startsWith('/');
  const body = absolute ? raw.slice(1) : raw;
  const parts = body.split('/').map(seg => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(seg => UNSAFE_KEYS.has(seg))) return null;
  return { absolute, segments: parts };
}

function readSegments(target, segments) {
  let cursor = target;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return undefined;
      cursor = cursor[idx];
    } else {
      if (!Object.hasOwn(cursor, seg)) return undefined;
      cursor = cursor[seg];
    }
  }
  return cursor;
}

export function pointerGet(dataModel, pointer, scopeData = null) {
  const parsed = parsePointer(pointer);
  if (!parsed) return undefined;
  if (!parsed.segments.length) return parsed.absolute ? dataModel : (scopeData ?? dataModel);
  if (!parsed.absolute && scopeData != null) {
    const scoped = readSegments(scopeData, parsed.segments);
    if (scoped !== undefined) return scoped;
  }
  return readSegments(dataModel, parsed.segments);
}

export function pointerSet(dataModel, pointer, value) {
  const base = isPlain(dataModel) ? cloneSafeJSON(dataModel) : {};
  const parsed = parsePointer(pointer);
  if (!parsed) return base;
  const safeVal = cloneSafeJSON(value);
  if (!parsed.segments.length) return clampDataModel(isPlain(safeVal) ? safeVal : base);
  let cursor = base;
  for (let i = 0; i < parsed.segments.length - 1; i++) {
    const seg = parsed.segments[i];
    const nextSeg = parsed.segments[i + 1];
    const nextIsIndex = /^\d+$/.test(nextSeg);
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= A2UI_LIMITS.listItems) return base;
      if (cursor[idx] == null || typeof cursor[idx] !== 'object') cursor[idx] = nextIsIndex ? [] : {};
      cursor = cursor[idx];
    } else {
      if (!Object.hasOwn(cursor, seg) || cursor[seg] == null || typeof cursor[seg] !== 'object') {
        cursor[seg] = nextIsIndex ? [] : {};
      }
      cursor = cursor[seg];
    }
  }
  const leaf = parsed.segments[parsed.segments.length - 1];
  if (Array.isArray(cursor)) {
    const idx = Number(leaf);
    if (Number.isInteger(idx) && idx >= 0 && idx < A2UI_LIMITS.listItems) cursor[idx] = safeVal;
  } else if (!UNSAFE_KEYS.has(leaf)) {
    cursor[leaf] = safeVal;
  }
  return clampDataModel(base);
}

export function pointerDelete(dataModel, pointer) {
  const base = isPlain(dataModel) ? cloneSafeJSON(dataModel) : {};
  const parsed = parsePointer(pointer);
  if (!parsed) return base;
  if (!parsed.segments.length) return {};
  let cursor = base;
  for (let i = 0; i < parsed.segments.length - 1; i++) {
    const seg = parsed.segments[i];
    if (cursor == null || typeof cursor !== 'object') return base;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return base;
      cursor = cursor[idx];
    } else {
      if (!Object.hasOwn(cursor, seg)) return base;
      cursor = cursor[seg];
    }
  }
  const leaf = parsed.segments[parsed.segments.length - 1];
  if (Array.isArray(cursor)) {
    const idx = Number(leaf);
    if (Number.isInteger(idx) && idx >= 0 && idx < cursor.length) cursor.splice(idx, 1);
  } else if (isPlain(cursor) && Object.hasOwn(cursor, leaf)) {
    delete cursor[leaf];
  }
  return base;
}

export function bindingPath(value) {
  if (isPlain(value) && typeof value.path === 'string' && parsePointer(value.path)) return value.path;
  return '';
}

function evalCall(expr, dataModel, scopeData, depth) {
  const fn = String(expr.call || '').trim();
  const args = expr.args ?? expr.arguments ?? {};
  const r = val => resolveDynamic(val, dataModel, scopeData, depth + 1);
  if (fn === 'formatString') {
    const tpl = String(r(args.value ?? args.template ?? args.pattern ?? '') ?? '');
    return tpl.replace(/\$\{([^}]+)\}/g, (_m, ref) => {
      const trimmed = ref.trim();
      if (trimmed.startsWith('/') || /^[\w.]+$/.test(trimmed)) {
        const direct = isPlain(args) && Object.hasOwn(args, trimmed) ? r(args[trimmed]) : pointerGet(dataModel, trimmed.startsWith('/') ? trimmed : `/${trimmed}`, scopeData);
        return direct == null ? '' : String(direct);
      }
      return '';
    });
  }
  if (fn === 'formatNumber') {
    const num = Number(r(args.value ?? args.number ?? 0));
    if (!Number.isFinite(num)) return '';
    const dec = Number(args.decimals ?? args.fractionDigits);
    return Number.isInteger(dec) && dec >= 0 && dec <= 8 ? num.toFixed(dec) : String(num);
  }
  if (fn === 'not') return !r(args.value ?? args.condition ?? args[0]);
  if (fn === 'and') return (Array.isArray(args.values ?? args) ? (args.values ?? args) : []).every(v => Boolean(r(v)));
  if (fn === 'or') return (Array.isArray(args.values ?? args) ? (args.values ?? args) : []).some(v => Boolean(r(v)));
  if (fn === 'eq') return r(args.left ?? args.a ?? args[0]) === r(args.right ?? args.b ?? args[1]);
  if (fn === 'neq') return r(args.left ?? args.a ?? args[0]) !== r(args.right ?? args.b ?? args[1]);
  if (fn === 'gt') return Number(r(args.left ?? args.a ?? args[0])) > Number(r(args.right ?? args.b ?? args[1]));
  if (fn === 'gte') return Number(r(args.left ?? args.a ?? args[0])) >= Number(r(args.right ?? args.b ?? args[1]));
  if (fn === 'lt') return Number(r(args.left ?? args.a ?? args[0])) < Number(r(args.right ?? args.b ?? args[1]));
  if (fn === 'lte') return Number(r(args.left ?? args.a ?? args[0])) <= Number(r(args.right ?? args.b ?? args[1]));
  if (fn === 'coalesce') {
    for (const v of (Array.isArray(args.values ?? args) ? (args.values ?? args) : [])) {
      const res = r(v);
      if (res !== null && res !== undefined && res !== '') return res;
    }
    return '';
  }
  if (fn === 'join') {
    const list = r(args.values ?? args.list);
    const sep = String(args.separator ?? ', ');
    return Array.isArray(list) ? list.map(x => String(x ?? '')).join(sep) : '';
  }
  if (fn === 'count') {
    const list = r(args.values ?? args.list);
    return Array.isArray(list) ? list.length : 0;
  }
  if (fn === 'if') return r(args.condition ?? args.cond) ? r(args.true ?? args.then) : r(args.false ?? args.else);
  return undefined;
}

export function resolveDynamic(value, dataModel, scopeData = null, depth = 0) {
  if (depth > 16 || value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => resolveDynamic(item, dataModel, scopeData, depth + 1));
  if (isPlain(value)) {
    if (typeof value.path === 'string') return pointerGet(dataModel, value.path, scopeData);
    if (typeof value.literalString === 'string') return value.literalString;
    if (typeof value.literalNumber === 'number') return value.literalNumber;
    if (typeof value.literalBoolean === 'boolean') return value.literalBoolean;
    if (Object.hasOwn(value, 'literal')) return value.literal;
    if (typeof value.call === 'string') return evalCall(value, dataModel, scopeData, depth);
    return value;
  }
  return value;
}

function normalizeComponentEntry(raw, fallbackId) {
  if (!isPlain(raw)) return null;
  const id = cleanId(raw.id ?? fallbackId);
  if (!id) return null;

  let type = '';
  let props = {};
  if (typeof raw.component === 'string') {
    type = normalizeComponentType(raw.component);
    props = { ...raw };
    delete props.id;
    delete props.component;
  } else if (isPlain(raw.component)) {
    // Support v0.8 wrapper `{ component: { Text: { text: ... } } }`.
    const entries = Object.entries(raw.component);
    if (entries.length) {
      type = normalizeComponentType(entries[0][0]);
      props = isPlain(entries[0][1]) ? { ...entries[0][1] } : {};
    }
  } else if (typeof raw.type === 'string') {
    type = normalizeComponentType(raw.type);
    props = { ...raw };
    delete props.id;
    delete props.type;
  }
  if (!type) return null;

  const cleaned = cloneSafeJSON(props) || {};
  // Strip unsafe media URLs; keep dynamic path references intact.
  for (const urlKey of ['url', 'src', 'poster']) {
    if (typeof cleaned[urlKey] === 'string') {
      const safe = safeMediaUrl(cleaned[urlKey]);
      if (safe) cleaned[urlKey] = safe; else delete cleaned[urlKey];
    }
  }
  if (Array.isArray(cleaned.children)) {
    cleaned.children = cleaned.children.map(c => cleanId(c)).filter(Boolean).slice(0, A2UI_LIMITS.listItems);
  } else if (isPlain(cleaned.children)) {
    if (Array.isArray(cleaned.children.explicitList)) {
      cleaned.children = cleaned.children.explicitList.map(c => cleanId(c)).filter(Boolean).slice(0, A2UI_LIMITS.listItems);
    } else if (isPlain(cleaned.children.template)) {
      cleaned.children = {
        componentId: cleanId(cleaned.children.template.componentId),
        path: String(cleaned.children.template.dataBinding || cleaned.children.template.path || ''),
      };
    } else if (cleaned.children.componentId || cleaned.children.path) {
      cleaned.children = {
        componentId: cleanId(cleaned.children.componentId),
        path: String(cleaned.children.path || ''),
      };
    }
  }
  if (typeof cleaned.child === 'string') cleaned.child = cleanId(cleaned.child);
  return { id, component: type, ...cleaned };
}

export function childIdsOf(node) {
  if (!node) return [];
  const ids = [];
  if (Array.isArray(node.children)) ids.push(...node.children);
  else if (isPlain(node.children) && node.children.componentId) ids.push(node.children.componentId);
  if (typeof node.child === 'string' && node.child) ids.push(node.child);
  if (Array.isArray(node.tabItems)) {
    for (const tab of node.tabItems) if (typeof tab?.child === 'string') ids.push(tab.child);
  }
  if (Array.isArray(node.tabs)) {
    for (const tab of node.tabs) if (typeof tab?.child === 'string') ids.push(tab.child);
  }
  if (typeof node.entryPointChild === 'string') ids.push(node.entryPointChild);
  if (typeof node.contentChild === 'string') ids.push(node.contentChild);
  return ids.filter(Boolean);
}

// Removes back-edges so cyclic references cannot cause infinite recursion in any renderer.
function breakCycles(components, rootId) {
  const byId = new Map(components.map(c => [c.id, c]));
  const visiting = new Set();
  const visited = new Set();

  function walk(id, depth) {
    const node = byId.get(id);
    if (!node || visited.has(id)) return;
    if (depth >= A2UI_LIMITS.depth) {
      if (Array.isArray(node.children)) node.children = [];
      else if (isPlain(node.children)) delete node.children;
      delete node.child;
      if (Array.isArray(node.tabItems)) node.tabItems = [];
      if (Array.isArray(node.tabs)) node.tabs = [];
      delete node.entryPointChild;
      delete node.contentChild;
      return;
    }
    visiting.add(id);
    if (Array.isArray(node.children)) {
      node.children = node.children.filter(cid => {
        if (visiting.has(cid)) return false;
        walk(cid, depth + 1);
        return true;
      });
    } else if (isPlain(node.children) && node.children.componentId) {
      if (visiting.has(node.children.componentId)) delete node.children;
      else walk(node.children.componentId, depth + 1);
    }
    if (node.child) {
      if (visiting.has(node.child)) delete node.child;
      else walk(node.child, depth + 1);
    }
    for (const key of ['tabItems', 'tabs']) {
      if (Array.isArray(node[key])) {
        node[key] = node[key].filter(tab => !tab?.child || !visiting.has(tab.child));
        for (const tab of node[key]) if (tab?.child) walk(tab.child, depth + 1);
      }
    }
    for (const key of ['entryPointChild', 'contentChild']) {
      if (node[key]) {
        if (visiting.has(node[key])) delete node[key];
        else walk(node[key], depth + 1);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  if (rootId && byId.has(rootId)) walk(rootId, 0);
  return components;
}

export function cleanSurface(raw) {
  const src = isPlain(raw) ? raw : {};
  const surfaceId = cleanId(src.surfaceId || src.id || 'surface-1') || 'surface-1';
  const catalogId = typeof src.catalogId === 'string' && src.catalogId.trim() ? cleanString(src.catalogId, 200) : A2UI_CATALOG_ID;
  const title = cleanString(src.title || '', A2UI_LIMITS.titleChars).trim();

  const list = [];
  const seen = new Set();
  if (Array.isArray(src.components)) {
    for (const item of src.components) {
      if (list.length >= A2UI_LIMITS.components) break;
      const entry = normalizeComponentEntry(item, `c-${list.length + 1}`);
      if (!entry) continue;
      if (seen.has(entry.id)) {
        const idx = list.findIndex(c => c.id === entry.id);
        if (idx >= 0) list[idx] = entry;
      } else {
        seen.add(entry.id);
        list.push(entry);
      }
    }
  } else if (isPlain(src.components)) {
    for (const [key, item] of Object.entries(src.components)) {
      if (list.length >= A2UI_LIMITS.components) break;
      const entry = normalizeComponentEntry(item, key);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      list.push(entry);
    }
  }

  let root = cleanId(src.root || src.rootId || '');
  if (!root || !seen.has(root)) {
    root = seen.has('root') ? 'root' : (list[0]?.id || 'root');
  }

  breakCycles(list, root);
  const dataModel = clampDataModel(src.dataModel ?? src.data ?? {});
  return {
    surfaceId,
    catalogId,
    ...(title ? { title } : {}),
    root,
    components: list,
    dataModel,
  };
}

function normalizeMessageEnvelope(msg) {
  if (!isPlain(msg)) return null;
  if (isPlain(msg.createSurface)) return { kind: 'createSurface', body: msg.createSurface };
  if (isPlain(msg.beginRendering)) return { kind: 'createSurface', body: msg.beginRendering };
  if (isPlain(msg.updateComponents)) return { kind: 'updateComponents', body: msg.updateComponents };
  if (isPlain(msg.surfaceUpdate)) return { kind: 'updateComponents', body: msg.surfaceUpdate };
  if (isPlain(msg.updateDataModel)) return { kind: 'updateDataModel', body: msg.updateDataModel };
  if (isPlain(msg.dataModelUpdate)) return { kind: 'updateDataModel', body: msg.dataModelUpdate };
  if (isPlain(msg.deleteSurface)) return { kind: 'deleteSurface', body: msg.deleteSurface };
  if (typeof msg.deleteSurface === 'string') return { kind: 'deleteSurface', body: { surfaceId: msg.deleteSurface } };
  if (typeof msg.type === 'string') return { kind: msg.type, body: msg };
  if (Array.isArray(msg.components) || isPlain(msg.components)) return { kind: 'fullSurface', body: msg };
  return null;
}

export function applyA2UIMessages(existingSurfaces, inputMessages) {
  const byId = new Map();
  const initialList = Array.isArray(existingSurfaces) ? existingSurfaces : existingSurfaces instanceof Map ? [...existingSurfaces.values()] : [];
  for (const s of initialList) {
    const cleaned = cleanSurface(s);
    byId.set(cleaned.surfaceId, cleaned);
  }
  const messages = Array.isArray(inputMessages) ? inputMessages : inputMessages ? [inputMessages] : [];
  const deletedIds = [];
  let changed = false;

  for (const rawMsg of messages) {
    const env = normalizeMessageEnvelope(rawMsg);
    if (!env) continue;
    const body = env.body;
    const id = cleanId(body.surfaceId || body.id || [...byId.keys()].at(-1) || 'surface-1') || 'surface-1';

    if (env.kind === 'deleteSurface') {
      if (byId.delete(id)) { deletedIds.push(id); changed = true; }
      continue;
    }

    if (env.kind === 'fullSurface') {
      if (!byId.has(id) && byId.size >= A2UI_LIMITS.surfaces) continue;
      byId.set(id, cleanSurface({ ...body, surfaceId: id }));
      changed = true;
      continue;
    }

    if (env.kind === 'createSurface') {
      const prev = byId.get(id);
      if (!prev && byId.size >= A2UI_LIMITS.surfaces) continue;
      byId.set(id, cleanSurface({
        ...(prev || {}),
        surfaceId: id,
        catalogId: body.catalogId || prev?.catalogId || A2UI_CATALOG_ID,
        title: body.title ?? prev?.title ?? '',
        root: body.root || body.rootId || prev?.root || 'root',
        components: prev?.components || [],
        dataModel: body.dataModel ?? body.data ?? prev?.dataModel ?? {},
      }));
      changed = true;
      continue;
    }

    if (env.kind === 'updateComponents') {
      const prev = byId.get(id) || (byId.size < A2UI_LIMITS.surfaces ? cleanSurface({ surfaceId: id, root: body.root || 'root', components: [] }) : null);
      if (!prev) continue;
      const incoming = Array.isArray(body.components) ? body.components : [];
      const merged = [...prev.components];
      const indexById = new Map(merged.map((c, idx) => [c.id, idx]));
      for (const item of incoming) {
        const entry = normalizeComponentEntry(item, `c-${merged.length + 1}`);
        if (!entry) continue;
        if (indexById.has(entry.id)) {
          merged[indexById.get(entry.id)] = entry;
        } else if (merged.length < A2UI_LIMITS.components) {
          indexById.set(entry.id, merged.length);
          merged.push(entry);
        }
      }
      byId.set(id, cleanSurface({
        ...prev,
        ...(body.title ? { title: body.title } : {}),
        ...(body.root ? { root: body.root } : {}),
        components: merged,
      }));
      changed = true;
      continue;
    }

    if (env.kind === 'updateDataModel') {
      const prev = byId.get(id) || (byId.size < A2UI_LIMITS.surfaces ? cleanSurface({ surfaceId: id, components: [] }) : null);
      if (!prev) continue;
      const path = typeof body.path === 'string' ? body.path : '/';
      let nextData = prev.dataModel;
      if (Object.hasOwn(body, 'value')) {
        nextData = body.value === undefined ? pointerDelete(nextData, path) : pointerSet(nextData, path, body.value);
      } else if (isPlain(body.contents) && (path === '/' || !path)) {
        nextData = clampDataModel({ ...nextData, ...body.contents });
      } else if (Object.hasOwn(body, 'op') && body.op === 'remove') {
        nextData = pointerDelete(nextData, path);
      }
      byId.set(id, cleanSurface({ ...prev, dataModel: nextData }));
      changed = true;
    }
  }

  return { surfaces: [...byId.values()], changed, deletedIds };
}

function parseA2UIPayload(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.length > 512 * 1024) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}
  // Fallback: JSONL lines.
  const out = [];
  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    try { out.push(JSON.parse(t)); } catch { return null; }
  }
  return out.length ? out : null;
}

export function extractA2UIBlocks(text, existingSurfaces = []) {
  const source = String(text ?? '');
  const fence = /```(?:a2ui|application\/a2ui\+json|a2ui-json)\s*\n([\s\S]*?)```/gi;
  let surfaces = Array.isArray(existingSurfaces) ? existingSurfaces.map(cleanSurface) : [];
  let matchedAny = false;
  const stripped = source.replace(fence, (full, body) => {
    const msgs = parseA2UIPayload(body);
    if (!msgs) return full;
    const res = applyA2UIMessages(surfaces, msgs);
    if (!res.changed && !res.deletedIds.length) return full;
    surfaces = res.surfaces;
    matchedAny = true;
    return '';
  });
  const cleanText = matchedAny ? stripped.replace(/\n{3,}/g, '\n\n').trim() : source;
  return { text: cleanText, surfaces: matchedAny ? surfaces : [] };
}

export function resolveActionContext(component, dataModel, scopeData = null, surfaceId = 'surface-1') {
  const rawAction = isPlain(component?.action) ? component.action : null;
  const eventSpec = isPlain(rawAction?.event) ? rawAction.event : rawAction;
  const actionName = cleanString(
    typeof component?.action === 'string' ? component.action : (eventSpec?.name || component?.label || 'submit'),
    100,
  ).trim() || 'submit';
  const contextSpec = isPlain(eventSpec?.context) ? eventSpec.context : {};
  const context = {};
  if (Object.keys(contextSpec).length) {
    for (const [k, v] of Object.entries(contextSpec)) {
      if (UNSAFE_KEYS.has(k)) continue;
      context[k] = cloneSafeJSON(resolveDynamic(v, dataModel, scopeData));
    }
  } else {
    // Include current dataModel snapshot when button did not declare an explicit narrow context.
    Object.assign(context, cloneSafeJSON(dataModel));
  }
  return {
    surfaceId: cleanId(surfaceId),
    actionName,
    sourceComponentId: cleanId(component?.id || ''),
    context,
    timestamp: new Date().toISOString(),
  };
}

export const surfaceJSON = surface => JSON.stringify(cleanSurface(surface), null, 2);

export function buildA2UIPrompt({ existingSurfaces = [], fenced = true } = {}) {
  const active = Array.isArray(existingSurfaces) && existingSurfaces.length
    ? `\nActive surfaces you may update by surfaceId: ${existingSurfaces.map(s => `${cleanId(s.surfaceId)}${s.title ? ` (${s.title})` : ''}`).join(', ')}.`
    : '';
  const body = `You can render an interactive UI using A2UI v0.9.1 JSON messages.${active}
Message envelopes:
- {"createSurface":{"surfaceId":"ui-1","title":"Short Title","catalogId":"${A2UI_CATALOG_ID}"}}
- {"updateComponents":{"surfaceId":"ui-1","root":"root","components":[...]}}
- {"updateDataModel":{"surfaceId":"ui-1","path":"/","value":{...}}}
- {"deleteSurface":{"surfaceId":"ui-1"}}

Rules:
- Components live in a flat list with string "id", "component", and child references by ID ("child" or "children":["id1","id2"] or {"componentId":"tpl","path":"/items"}).
- Basic components: Column, Row, List, Card, Tabs (tabItems:[{title,child}]), Modal (entryPointChild,contentChild), Divider, Text (text, variant:"h1".."h5"|"body"|"caption"), Image (url), Icon (name), Video (url), AudioPlayer (url), Button (child or label, variant:"primary"|"secondary"|"quiet"|"danger", action:{event:{name,context:{...}}}), TextField (label, value:{path:"/..."}, variant:"shortText"|"longText"|"number"|"obscured"), CheckBox (label, value:{path:"/..."}), Switch (label, value:{path:"/..."}), Slider (label, value:{path:"/..."}, min, max, step), ChoicePicker (label, value:{path:"/..."}, options:[{label,value}], variant:"chips"|"dropdown"|"radio"), DateTimeInput (label, value:{path:"/..."}, enableDate, enableTime).
- Fairy extensions allowed alongside Basic components: Markdown (text), CodeBlock (code, language), Math (latex, display), MetricTile (label, value, delta), Sparkline (values:[...], label), Badge (label, tone:"accent"|"ok"|"warn"|"danger"|"neutral").
- Use {"path":"/some/key"} to bind properties or input values to dataModel. Never output raw HTML or scripts.`;

  if (fenced) {
    return `${body}\nPut the JSON array of A2UI messages inside a single fenced \`\`\`a2ui block alongside any brief prose.`;
  }
  return body;
}

export const A2UI_ICON_PATHS = Object.freeze({
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  sparkles: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  star: '<polygon points="12 2 15 8.6 22 9.3 17 14 18.4 21 12 17.4 5.6 21 7 14 2 9.3 9 8.6 12 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z"/>',
  'arrow-right': '<path d="M5 12h14M13 5l7 7-7 7"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
});

export function a2uiSparklineGeometry(values, width = 180, height = 44) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return { points: '', area: '', min: nums[0] ?? 0, max: nums[0] ?? 0, latest: nums.at(-1) ?? 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 3;
  const w = Math.max(20, width - pad * 2);
  const h = Math.max(12, height - pad * 2);
  const pts = nums.map((v, i) => {
    const x = pad + (i / (nums.length - 1)) * w;
    const y = pad + h - ((v - min) / span) * h;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });
  const points = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${pad},${pad + h} ${points} ${pad + w},${pad + h}`;
  return { points, area, min, max, latest: nums.at(-1) };
}
