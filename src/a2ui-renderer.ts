import katex from 'katex';
import {
  A2UI_ICON_PATHS,
  A2UI_LIMITS,
  a2uiSparklineGeometry,
  bindingPath,
  cleanSurface,
  pointerGet,
  pointerSet,
  resolveActionContext,
  resolveDynamic,
  safeMediaUrl,
} from '../desktop/page-kinds/a2ui-core.mjs';
import type {
  A2UIActionContext,
  A2UIComponentNode,
  A2UISurface,
} from '../desktop/page-kinds/a2ui-core.mjs';
import { highlightCode } from './reply-renderer.js';

export interface A2UIDataChangeEvent {
  surfaceId: string;
  path: string;
  value: unknown;
}

export interface A2UIRenderOptions {
  surface?: unknown;
  onAction?: ((payload: A2UIActionContext, surface: A2UISurface) => void) | null;
  onDataChange?: ((event: A2UIDataChangeEvent) => void) | null;
  onPromote?: ((surface: A2UISurface) => void) | null;
  onReset?: ((surface: A2UISurface) => void) | null;
  embedded?: boolean;
}

export type A2UIMountHandlers = Omit<A2UIRenderOptions, 'surface'>;

export interface A2UIRenderedSurface {
  element: HTMLElement;
  surface: () => A2UISurface;
  updateSurface: (next: unknown) => void;
}

interface ChoiceOption {
  label: string;
  value: unknown;
}

interface TabItem {
  title?: unknown;
  label?: unknown;
  child?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K];
function el(tag: string, cls?: string, text?: string): HTMLElement;
function el(tag: string, cls = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
}

const ICON_SVG = (name: unknown, size = 18): string => {
  const key = String(name || '').trim().toLowerCase();
  const inner = A2UI_ICON_PATHS[key] || A2UI_ICON_PATHS.sparkles;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
};

function resolvedPath(propPath: string, scopePath: string): string {
  if (!propPath) return '';
  if (propPath.startsWith('/')) return propPath;
  if (scopePath) return `${scopePath.replace(/\/$/, '')}/${propPath}`;
  return `/${propPath}`;
}

function renderSimpleMarkdown(target: HTMLElement, text: unknown): void {
  target.replaceChildren();
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const h = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (h) {
      const heading = el(`h${Math.min(5, h[1].length + 1)}`, 'a2ui-md-h');
      appendInlineFormatted(heading, h[2]);
      target.append(heading);
      continue;
    }
    const lines = trimmed.split('\n');
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
      const ul = el('ul', 'a2ui-md-list');
      for (const l of lines) {
        const li = document.createElement('li');
        appendInlineFormatted(li, l.replace(/^\s*[-*]\s+/, ''));
        ul.append(li);
      }
      target.append(ul);
      continue;
    }
    const p = el('p', 'a2ui-md-p');
    lines.forEach((l, i) => {
      if (i > 0) p.append(document.createElement('br'));
      appendInlineFormatted(p, l);
    });
    target.append(p);
  }
}

function appendInlineFormatted(target: HTMLElement, raw: unknown): void {
  target.replaceChildren();
  const s = String(raw ?? '');
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) target.append(document.createTextNode(s.slice(last, idx)));
    const tok = m[0];
    if (tok.startsWith('**')) target.append(el('strong', '', tok.slice(2, -2)));
    else if (tok.startsWith('`')) target.append(el('code', 'a2ui-inline-code', tok.slice(1, -1)));
    else target.append(el('em', '', tok.slice(1, -1)));
    last = idx + tok.length;
  }
  if (last < s.length) target.append(document.createTextNode(s.slice(last)));
}

export function renderA2UISurface({
  surface: initialSurface,
  onAction = null,
  onDataChange = null,
  onPromote = null,
  onReset = null,
  embedded = false,
}: A2UIRenderOptions = {}): A2UIRenderedSurface {
  let surface: A2UISurface = cleanSurface(initialSurface);
  const baseDataSnapshot = JSON.stringify(surface.dataModel || {});
  let bindings: Array<() => void> = [];
  let activeModalClose: (() => void) | null = null;

  const card = el('section', `a2ui-surface${embedded ? ' is-embedded' : ''}`);
  card.dataset.surfaceId = surface.surfaceId;

  const head = el('header', 'a2ui-head');
  const titleWrap = el('div', 'a2ui-head-left');
  const titleEl = el('span', 'a2ui-title', surface.title || 'Interactive UI');
  const tagEl = el('span', 'a2ui-badge is-neutral a2ui-kind-tag', 'A2UI');
  titleWrap.append(titleEl, tagEl);

  const actionsWrap = el('div', 'a2ui-head-actions');
  if (onPromote && !embedded) {
    const promoteBtn = el('button', 'a2ui-head-btn', 'Open as Page');
    promoteBtn.type = 'button';
    promoteBtn.title = 'Save this interactive UI as a standalone Page';
    promoteBtn.onclick = () => onPromote(surface);
    actionsWrap.append(promoteBtn);
  }
  const resetBtn = el('button', 'a2ui-head-btn', 'Reset');
  resetBtn.type = 'button';
  resetBtn.title = 'Reset inputs to initial values';
  resetBtn.onclick = () => {
    try { surface = cleanSurface({ ...surface, dataModel: JSON.parse(baseDataSnapshot) }); } catch {}
    refreshBindings();
    onReset?.(surface);
    onDataChange?.({ surfaceId: surface.surfaceId, path: '/', value: surface.dataModel });
  };
  actionsWrap.append(resetBtn);
  head.append(titleWrap, actionsWrap);

  const body = el('div', 'a2ui-body');
  card.append(head, body);

  function refreshBindings(): void {
    for (const fn of bindings) {
      try { fn(); } catch {}
    }
  }

  function mutateData(propPath: string, value: unknown, scopePath: string): void {
    const full = resolvedPath(propPath, scopePath);
    if (!full) return;
    surface = cleanSurface({ ...surface, dataModel: pointerSet(surface.dataModel, full, value) });
    refreshBindings();
    onDataChange?.({ surfaceId: surface.surfaceId, path: full, value });
  }

  function readProp(val: unknown, scopeData: unknown): unknown {
    return resolveDynamic(val, surface.dataModel, scopeData);
  }

  function buildTree(): void {
    bindings = [];
    body.replaceChildren();
    const byId = new Map<string, A2UIComponentNode>(surface.components.map(c => [c.id, c]));

    function buildNode(
      id: string | null | undefined,
      scopeData: unknown = null,
      scopePath = '',
      depth = 0,
    ): HTMLElement | null {
      if (!id || depth > A2UI_LIMITS.depth) return null;
      const comp = byId.get(id);
      if (!comp) return null;
      const kind = comp.component;
      const wrap = (fn: () => void): number => bindings.push(fn);

      if (kind === 'Column' || kind === 'Row') {
        const box = el('div', `a2ui-${kind.toLowerCase()}`);
        if (comp.alignment) box.dataset.align = String(comp.alignment);
        if (comp.distribution) box.dataset.justify = String(comp.distribution);
        const kids = Array.isArray(comp.children) ? comp.children : [];
        for (const cid of kids) {
          const child = buildNode(cid, scopeData, scopePath, depth + 1);
          if (child) box.append(child);
        }
        return box;
      }

      if (kind === 'Card') {
        const c = el('div', 'a2ui-card');
        if (comp.child) {
          const inner = buildNode(comp.child, scopeData, scopePath, depth + 1);
          if (inner) c.append(inner);
        } else if (Array.isArray(comp.children)) {
          for (const cid of comp.children) {
            const inner = buildNode(cid, scopeData, scopePath, depth + 1);
            if (inner) c.append(inner);
          }
        }
        return c;
      }

      if (kind === 'List') {
        const listEl = el('div', `a2ui-list${comp.direction === 'horizontal' ? ' is-horizontal' : ''}`);
        if (Array.isArray(comp.children)) {
          for (const cid of comp.children) {
            const child = buildNode(cid, scopeData, scopePath, depth + 1);
            if (child) listEl.append(child);
          }
          return listEl;
        }
        if (comp.children && typeof comp.children === 'object' && comp.children.componentId) {
          const tplId = comp.children.componentId;
          const listPtr = String(comp.children.path || '/items');
          let lastJson = '';
          const syncList = () => {
            const rawArr = pointerGet(surface.dataModel, listPtr, scopeData);
            const items = Array.isArray(rawArr) ? rawArr.slice(0, A2UI_LIMITS.listItems) : [];
            const sig = JSON.stringify(items);
            if (sig === lastJson) return;
            lastJson = sig;
            listEl.replaceChildren();
            if (!items.length) {
              listEl.append(el('div', 'a2ui-empty', String(comp.emptyText || 'No items')));
              return;
            }
            const basePtr = resolvedPath(listPtr, scopePath);
            items.forEach((item, idx) => {
              const rowNode = buildNode(tplId, item, `${basePtr}/${idx}`, depth + 1);
              if (rowNode) listEl.append(rowNode);
            });
          };
          syncList();
          wrap(syncList);
        }
        return listEl;
      }

      if (kind === 'Tabs') {
        const items: TabItem[] = Array.isArray(comp.tabItems)
          ? comp.tabItems
          : Array.isArray(comp.tabs)
            ? comp.tabs
            : [];
        const wrapEl = el('div', 'a2ui-tabs');
        const strip = el('div', 'a2ui-tabs-strip');
        strip.setAttribute('role', 'tablist');
        const panel = el('div', 'a2ui-tabs-panel');
        let activeIdx = Math.max(0, Math.min(items.length - 1, Number(comp.selectedIndex) || 0));

        const showTab = (idx: number) => {
          activeIdx = idx;
          [...strip.children].forEach((btn, i) => btn.setAttribute('aria-selected', String(i === activeIdx)));
          panel.replaceChildren();
          const targetId = items[activeIdx]?.child;
          if (targetId) {
            const node = buildNode(targetId, scopeData, scopePath, depth + 1);
            if (node) panel.append(node);
          }
        };
        items.forEach((t, idx) => {
          const label = String(readProp(t.title ?? t.label ?? `Tab ${idx + 1}`, scopeData) ?? `Tab ${idx + 1}`);
          const btn = el('button', 'a2ui-tab', label);
          btn.type = 'button';
          btn.setAttribute('role', 'tab');
          btn.onclick = () => showTab(idx);
          strip.append(btn);
        });
        wrapEl.append(strip, panel);
        if (items.length) showTab(activeIdx);
        return wrapEl;
      }

      if (kind === 'Modal') {
        const container = el('div', 'a2ui-modal-wrap');
        const trigger = comp.entryPointChild
          ? buildNode(comp.entryPointChild, scopeData, scopePath, depth + 1)
          : el('button', 'a2ui-btn is-secondary', 'Open');
        if (trigger && comp.contentChild) {
          trigger.addEventListener('click', () => {
            const overlay = el('div', 'a2ui-modal-backdrop');
            const dialog = el('div', 'a2ui-modal-dialog');
            dialog.setAttribute('role', 'dialog');
            const closeBtn = el('button', 'a2ui-modal-close', '×');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Close');
            const content = buildNode(comp.contentChild, scopeData, scopePath, depth + 1);
            const close = () => { overlay.remove(); if (activeModalClose === close) activeModalClose = null; };
            closeBtn.onclick = close;
            overlay.onclick = (e: MouseEvent) => { if (e.target === overlay) close(); };
            activeModalClose = close;
            dialog.append(closeBtn);
            if (content) dialog.append(content);
            overlay.append(dialog);
            card.append(overlay);
          });
        }
        if (trigger) container.append(trigger);
        return container;
      }

      if (kind === 'Divider') {
        return el('hr', `a2ui-divider${comp.axis === 'vertical' ? ' is-vertical' : ''}`);
      }

      if (kind === 'Text') {
        const variant = String(comp.variant || comp.usageHint || 'body').toLowerCase();
        const node = el('div', `a2ui-text is-${variant}`);
        const update = () => {
          const val = readProp(comp.text ?? '', scopeData);
          appendInlineFormatted(node, val == null ? '' : String(val));
        };
        update();
        wrap(update);
        return node;
      }

      if (kind === 'Image') {
        const img = document.createElement('img');
        img.className = 'a2ui-image';
        img.alt = String(comp.alt || '');
        if (comp.fit) img.style.objectFit = String(comp.fit);
        const update = () => {
          const safe = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? ''));
          if (safe) { img.src = safe; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
        };
        update();
        wrap(update);
        return img;
      }

      if (kind === 'Icon') {
        const box = el('span', 'a2ui-icon');
        const update = () => {
          const iconName = readProp(comp.name || 'sparkles', scopeData);
          box.innerHTML = ICON_SVG(iconName, Number(comp.size) || 18);
        };
        update();
        wrap(update);
        return box;
      }

      if (kind === 'Video') {
        const video = document.createElement('video');
        video.className = 'a2ui-video';
        video.controls = true; video.playsInline = true; video.preload = 'metadata';
        const safePoster = safeMediaUrl(String(comp.poster || ''));
        if (safePoster) video.poster = safePoster;
        const update = () => {
          const safe = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? ''));
          if (safe) { video.src = safe; video.hidden = false; } else { video.removeAttribute('src'); video.hidden = true; }
        };
        update();
        wrap(update);
        return video;
      }

      if (kind === 'AudioPlayer') {
        const box = el('div', 'a2ui-audio');
        const label = el('span', 'a2ui-audio-label');
        const audio = document.createElement('audio');
        audio.controls = true; audio.preload = 'metadata';
        const update = () => {
          const desc = readProp(comp.description ?? comp.label ?? '', scopeData);
          label.textContent = desc ? String(desc) : '';
          label.hidden = !desc;
          const safe = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? ''));
          if (safe) { audio.src = safe; box.hidden = false; } else { audio.removeAttribute('src'); box.hidden = true; }
        };
        box.append(label, audio);
        update();
        wrap(update);
        return box;
      }

      if (kind === 'Button') {
        const variant = ['primary', 'secondary', 'quiet', 'danger'].includes(comp.variant)
          ? comp.variant
          : (comp.primary ? 'primary' : 'secondary');
        const btn = el('button', `a2ui-btn is-${variant}`);
        btn.type = 'button';
        if (comp.child) {
          const inner = buildNode(comp.child, scopeData, scopePath, depth + 1);
          if (inner) btn.append(inner);
        } else {
          const updateLabel = () => { btn.textContent = String(readProp(comp.label ?? comp.text ?? 'Action', scopeData) ?? 'Action'); };
          updateLabel();
          wrap(updateLabel);
        }
        const updateDisabled = () => { btn.disabled = Boolean(readProp(comp.disabled ?? false, scopeData)); };
        updateDisabled();
        wrap(updateDisabled);
        btn.onclick = () => {
          const payload = resolveActionContext(comp, surface.dataModel, scopeData, surface.surfaceId);
          if (comp.closeModal && activeModalClose) activeModalClose();
          onAction?.(payload, surface);
        };
        return btn;
      }

      if (kind === 'TextField') {
        const field = el('label', 'a2ui-field');
        const title = el('span', 'a2ui-field-label', String(readProp(comp.label ?? '', scopeData) ?? ''));
        if (!title.textContent) title.hidden = true;
        const variant = String(comp.variant || comp.textFieldType || 'shortText').toLowerCase();
        const input = variant === 'longtext' || variant === 'multiline'
          ? document.createElement('textarea')
          : document.createElement('input');
        input.className = 'a2ui-input';
        if (input instanceof HTMLTextAreaElement) input.rows = 3;
        else input.type = variant === 'number' ? 'number' : variant === 'obscured' || variant === 'password' ? 'password' : 'text';
        if (comp.placeholder) input.placeholder = String(comp.placeholder);
        const path = bindingPath(comp.value ?? comp.text);
        const sync = () => {
          if (document.activeElement === input) return;
          const v = readProp(comp.value ?? comp.text ?? '', scopeData);
          input.value = v == null ? '' : String(v);
        };
        sync();
        wrap(sync);
        input.addEventListener('input', () => {
          if (!path) return;
          const next = variant === 'number' && input.value !== '' ? Number(input.value) : input.value;
          mutateData(path, variant === 'number' && Number.isNaN(next) ? input.value : next, scopePath);
        });
        field.append(title, input);
        if (comp.helperText) field.append(el('span', 'a2ui-field-help', String(comp.helperText)));
        return field;
      }

      if (kind === 'CheckBox' || kind === 'Switch') {
        const row = el('label', `a2ui-${kind === 'Switch' ? 'switch' : 'checkbox'}`);
        const input = document.createElement('input');
        input.type = 'checkbox';
        const span = el('span', 'a2ui-toggle-text');
        const path = bindingPath(comp.value ?? comp.checked);
        const sync = () => {
          input.checked = Boolean(readProp(comp.value ?? comp.checked ?? false, scopeData));
          span.textContent = String(readProp(comp.label ?? '', scopeData) ?? '');
        };
        sync();
        wrap(sync);
        input.addEventListener('change', () => {
          if (path) mutateData(path, input.checked, scopePath);
        });
        row.append(input);
        if (kind === 'Switch') row.append(el('span', 'a2ui-switch-track'));
        row.append(span);
        return row;
      }

      if (kind === 'Slider') {
        const wrapEl = el('label', 'a2ui-field');
        const headRow = el('div', 'a2ui-slider-head');
        const title = el('span', 'a2ui-field-label', String(readProp(comp.label ?? '', scopeData) ?? ''));
        const valPill = el('span', 'a2ui-slider-val');
        headRow.append(title, valPill);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'a2ui-slider';
        input.min = String(comp.min ?? comp.minValue ?? 0);
        input.max = String(comp.max ?? comp.maxValue ?? 100);
        if (comp.step != null) input.step = String(comp.step);
        const path = bindingPath(comp.value);
        const sync = () => {
          const cur = Number(readProp(comp.value ?? input.min, scopeData));
          const num = Number.isFinite(cur) ? cur : Number(input.min);
          if (document.activeElement !== input) input.value = String(num);
          valPill.textContent = String(num);
        };
        sync();
        wrap(sync);
        input.addEventListener('input', () => {
          const num = Number(input.value);
          valPill.textContent = String(num);
          if (path) mutateData(path, num, scopePath);
        });
        wrapEl.append(headRow, input);
        return wrapEl;
      }

      if (kind === 'ChoicePicker') {
        const options: ChoiceOption[] = (Array.isArray(comp.options) ? comp.options : []).map(
          (o: unknown): ChoiceOption => {
            if (typeof o === 'string') return { label: o, value: o };
            const obj = o && typeof o === 'object' ? (o as { label?: unknown; value?: unknown }) : null;
            return {
              label: String(obj?.label ?? obj?.value ?? ''),
              value: obj?.value ?? obj?.label ?? '',
            };
          },
        );
        const multi = comp.allowMultiple === true || (Number(comp.maxAllowedSelections) || 1) > 1 || comp.selectionMode === 'multiple';
        const variant = String(comp.variant || (multi ? 'chips' : options.length > 5 ? 'dropdown' : 'chips')).toLowerCase();
        const path = bindingPath(comp.value ?? comp.selections);
        const box = el('div', 'a2ui-field');
        if (comp.label) box.append(el('span', 'a2ui-field-label', String(readProp(comp.label, scopeData) ?? '')));

        if (variant === 'dropdown' && !multi) {
          const sel = document.createElement('select');
          sel.className = 'a2ui-select';
          for (const opt of options) sel.append(new Option(opt.label, String(opt.value)));
          const sync = () => {
            const v = readProp(comp.value ?? comp.selections ?? '', scopeData);
            if (v != null && document.activeElement !== sel) sel.value = String(v);
          };
          sync();
          wrap(sync);
          sel.addEventListener('change', () => { if (path) mutateData(path, sel.value, scopePath); });
          box.append(sel);
          return box;
        }

        const listEl = el('div', `a2ui-choices is-${variant === 'radio' ? 'radio' : 'chips'}`);
        const sync = () => {
          const cur = readProp(comp.value ?? comp.selections ?? (multi ? [] : ''), scopeData);
          const pickedSet = multi ? new Set((Array.isArray(cur) ? cur : []).map(String)) : null;
          const pickedStr = multi ? '' : String(cur ?? '');
          [...listEl.children].forEach((btn, i) => {
            const valStr = String(options[i]?.value ?? '');
            const active = pickedSet ? pickedSet.has(valStr) : pickedStr === valStr;
            btn.setAttribute('aria-pressed', String(active));
            btn.classList.toggle('is-selected', active);
          });
        };
        options.forEach(opt => {
          const chip = el('button', 'a2ui-choice', opt.label);
          chip.type = 'button';
          chip.onclick = () => {
            if (!path) return;
            if (multi) {
              const prev = readProp(comp.value ?? comp.selections ?? [], scopeData);
              const arr = Array.isArray(prev) ? [...prev] : [];
              const idx = arr.findIndex(x => String(x) === String(opt.value));
              if (idx >= 0) arr.splice(idx, 1);
              else arr.push(opt.value);
              mutateData(path, arr, scopePath);
            } else {
              mutateData(path, opt.value, scopePath);
            }
          };
          listEl.append(chip);
        });
        sync();
        wrap(sync);
        box.append(listEl);
        return box;
      }

      if (kind === 'DateTimeInput') {
        const field = el('label', 'a2ui-field');
        if (comp.label) field.append(el('span', 'a2ui-field-label', String(readProp(comp.label, scopeData) ?? '')));
        const input = document.createElement('input');
        input.className = 'a2ui-input';
        const d = comp.enableDate !== false, t = comp.enableTime === true;
        input.type = d && t ? 'datetime-local' : t && !d ? 'time' : 'date';
        const path = bindingPath(comp.value);
        const sync = () => {
          if (document.activeElement === input) return;
          const v = readProp(comp.value ?? '', scopeData);
          input.value = v == null ? '' : String(v);
        };
        sync();
        wrap(sync);
        input.addEventListener('input', () => { if (path) mutateData(path, input.value, scopePath); });
        field.append(input);
        return field;
      }

      // Fairy extension components (`fairy:v1`)
      if (kind === 'Markdown') {
        const box = el('div', 'a2ui-markdown');
        const sync = () => renderSimpleMarkdown(box, readProp(comp.text ?? '', scopeData) ?? '');
        sync();
        wrap(sync);
        return box;
      }

      if (kind === 'CodeBlock') {
        const wrapEl = el('div', 'a2ui-codeblock');
        const bar = el('div', 'a2ui-codeblock-head');
        bar.append(el('span', '', String(comp.language || 'code')));
        const copyBtn = el('button', 'a2ui-head-btn', 'Copy');
        copyBtn.type = 'button';
        const pre = el('pre', 'a2ui-code-pre');
        const codeEl = document.createElement('code');
        pre.append(codeEl);
        const sync = () => {
          const source = String(readProp(comp.code ?? comp.text ?? '', scopeData) ?? '');
          const { html, highlighted } = highlightCode(source, comp.language || '');
          if (highlighted) codeEl.innerHTML = html;
          else codeEl.textContent = source;
        };
        copyBtn.onclick = async () => {
          const source = String(readProp(comp.code ?? comp.text ?? '', scopeData) ?? '');
          try { await navigator.clipboard.writeText(source); copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200); } catch {}
        };
        bar.append(copyBtn);
        wrapEl.append(bar, pre);
        sync();
        wrap(sync);
        return wrapEl;
      }

      if (kind === 'Math') {
        const box = el('div', `a2ui-math${comp.display === false ? ' is-inline' : ''}`);
        const sync = () => {
          const tex = String(readProp(comp.latex ?? comp.text ?? '', scopeData) ?? '');
          try {
            box.innerHTML = katex.renderToString(tex, { displayMode: comp.display !== false, throwOnError: false });
          } catch {
            box.textContent = tex;
          }
        };
        sync();
        wrap(sync);
        return box;
      }

      if (kind === 'MetricTile') {
        const tile = el('div', 'a2ui-metric');
        const lbl = el('span', 'a2ui-metric-label');
        const val = el('strong', 'a2ui-metric-value');
        const delta = el('span', 'a2ui-metric-delta');
        const sync = () => {
          lbl.textContent = String(readProp(comp.label ?? '', scopeData) ?? '');
          const v = readProp(comp.value ?? '—', scopeData);
          val.textContent = v == null ? '—' : String(v);
          const d = readProp(comp.delta ?? '', scopeData);
          delta.textContent = d ? String(d) : '';
          delta.hidden = !d;
          delta.dataset.tone = comp.tone || (String(d).trim().startsWith('-') ? 'danger' : String(d).trim().startsWith('+') ? 'ok' : 'neutral');
        };
        tile.append(lbl, val, delta);
        sync();
        wrap(sync);
        return tile;
      }

      if (kind === 'Sparkline') {
        const box = el('div', 'a2ui-sparkline');
        const lbl = el('div', 'a2ui-sparkline-head');
        const svgWrap = el('div', 'a2ui-sparkline-svg');
        box.append(lbl, svgWrap);
        const sync = () => {
          const vals = readProp(comp.values ?? [], scopeData);
          const geom = a2uiSparklineGeometry(vals, 200, 46);
          const title = readProp(comp.label ?? '', scopeData);
          lbl.replaceChildren(el('span', '', title ? String(title) : ''), el('strong', '', String(geom.latest ?? '')));
          if (!geom.points) { svgWrap.replaceChildren(); return; }
          svgWrap.innerHTML = `<svg viewBox="0 0 200 46" preserveAspectRatio="none" aria-hidden="true"><polygon points="${geom.area}" fill="rgba(62,90,236,.16)"/><polyline points="${geom.points}" fill="none" stroke="#9fb2ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        };
        sync();
        wrap(sync);
        return box;
      }

      if (kind === 'Badge') {
        const tone = ['accent', 'ok', 'warn', 'danger', 'neutral'].includes(comp.tone) ? comp.tone : 'neutral';
        const pill = el('span', `a2ui-badge is-${tone}`);
        const sync = () => { pill.textContent = String(readProp(comp.label ?? comp.text ?? '', scopeData) ?? ''); };
        sync();
        wrap(sync);
        return pill;
      }

      return null;
    }

    const rootNode = buildNode(surface.root);
    if (rootNode) body.append(rootNode);
  }

  buildTree();

  return {
    element: card,
    surface: () => surface,
    updateSurface(next: unknown) {
      const cleaned = cleanSurface(next);
      titleEl.textContent = cleaned.title || 'Interactive UI';
      const structSame = JSON.stringify(cleaned.components) === JSON.stringify(surface.components) && cleaned.root === surface.root;
      surface = cleaned;
      if (structSame) refreshBindings();
      else buildTree();
    },
  };
}

export function mountA2UISurfaces(
  container: Element | null | undefined,
  surfaces: unknown,
  handlers: A2UIMountHandlers = {},
): void {
  if (!container) return;
  container.querySelector('.a2ui-stack')?.remove();
  if (!Array.isArray(surfaces) || !surfaces.length) return;
  const stack = el('div', 'a2ui-stack');
  for (const surf of surfaces.slice(0, A2UI_LIMITS.surfaces)) {
    const rendered = renderA2UISurface({ surface: surf, ...handlers });
    stack.append(rendered.element);
  }
  container.append(stack);
}
