// Dedicated A2UI Interactive UI page: renders an A2UI v0.9.1 surface inside fairy-artifact://,
// lets the user interact, save updated dataModel versions via fairyBridge, and forward actions back to chat.
let surface = cleanSurface(JSON.parse(document.getElementById('fairy-data').textContent));
const initialData = JSON.stringify(surface.dataModel || {});
let editable = false, dirty = false, saving = false, saveNote = '', savedSnapshot = JSON.stringify(surface);
let activeModalClose = null, bindings = [];

const app = document.getElementById('app');
const toolbar = document.createElement('div');
toolbar.className = 'glass bar a2ui-page-bar';
const stage = document.createElement('main');
stage.className = 'a2ui-page-stage';
const surfaceHost = document.createElement('section');
surfaceHost.className = 'a2ui-page-surface';
stage.append(surfaceHost);
app.append(toolbar, stage);

const saveBtn = document.createElement('button');
saveBtn.type = 'button'; saveBtn.className = 'save'; saveBtn.textContent = 'Save state'; saveBtn.disabled = true;
const resetBtn = document.createElement('button');
resetBtn.type = 'button'; resetBtn.className = 'word'; resetBtn.textContent = 'Reset';
const statusNote = document.createElement('span');
statusNote.className = 'save-note';
const leftGroup = document.createElement('div');
leftGroup.className = 'group';
leftGroup.append(document.createTextNode(''));
const titleTag = document.createElement('span');
titleTag.className = 'a2ui-page-title';
titleTag.textContent = surface.title || 'Interactive UI';
leftGroup.append(titleTag);
const rightGroup = document.createElement('div');
rightGroup.className = 'group a2ui-page-actions';
rightGroup.append(resetBtn, saveBtn);
toolbar.append(leftGroup, rightGroup, statusNote);

function syncBar() {
  saveBtn.hidden = !editable;
  saveBtn.disabled = !dirty || saving;
  saveBtn.textContent = saving ? 'Saving…' : dirty ? 'Save state' : 'Saved';
  statusNote.textContent = saveNote;
}

const bridge = fairyBridge({
  onEdit() { editable = true; syncBar(); },
  onSaved() { saving = false; saveNote = ''; savedSnapshot = JSON.stringify(surface); dirty = false; syncBar(); },
  onFailed(message) { saving = false; saveNote = message; syncBar(); },
});

saveBtn.onclick = () => {
  if (!editable || saving) return;
  saving = true; saveNote = ''; syncBar();
  bridge.save(surface);
};

resetBtn.onclick = () => {
  try { surface = cleanSurface({ ...surface, dataModel: JSON.parse(initialData) }); } catch {}
  dirty = JSON.stringify(surface) !== savedSnapshot;
  saveNote = '';
  bridge.dirty(dirty);
  syncBar();
  refreshBindings();
};

const mk = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

function resolvedPtr(propPath, scopePath) {
  if (!propPath) return '';
  if (propPath.startsWith('/')) return propPath;
  if (scopePath) return scopePath.replace(/\/$/, '') + '/' + propPath;
  return '/' + propPath;
}

function refreshBindings() {
  for (const fn of bindings) { try { fn(); } catch {} }
}

function mutateData(propPath, value, scopePath) {
  const full = resolvedPtr(propPath, scopePath);
  if (!full) return;
  surface = cleanSurface({ ...surface, dataModel: pointerSet(surface.dataModel, full, value) });
  dirty = JSON.stringify(surface) !== savedSnapshot;
  saveNote = '';
  bridge.dirty(dirty);
  syncBar();
  refreshBindings();
}

function renderPageSurface() {
  bindings = [];
  surfaceHost.replaceChildren();
  const byId = new Map(surface.components.map(c => [c.id, c]));
  const readProp = (v, s) => resolveDynamic(v, surface.dataModel, s);

  function buildNode(id, scopeData = null, scopePath = '', depth = 0) {
    if (!id || depth > A2UI_LIMITS.depth) return null;
    const comp = byId.get(id);
    if (!comp) return null;
    const kind = comp.component;
    const wrap = fn => bindings.push(fn);

    if (kind === 'Column' || kind === 'Row') {
      const box = mk('div', 'a2ui-' + kind.toLowerCase());
      for (const cid of (Array.isArray(comp.children) ? comp.children : [])) {
        const child = buildNode(cid, scopeData, scopePath, depth + 1);
        if (child) box.append(child);
      }
      return box;
    }

    if (kind === 'Card') {
      const c = mk('div', 'a2ui-card');
      if (comp.child) { const inner = buildNode(comp.child, scopeData, scopePath, depth + 1); if (inner) c.append(inner); }
      else if (Array.isArray(comp.children)) for (const cid of comp.children) { const inner = buildNode(cid, scopeData, scopePath, depth + 1); if (inner) c.append(inner); }
      return c;
    }

    if (kind === 'List') {
      const listEl = mk('div', 'a2ui-list' + (comp.direction === 'horizontal' ? ' is-horizontal' : ''));
      if (Array.isArray(comp.children)) {
        for (const cid of comp.children) { const child = buildNode(cid, scopeData, scopePath, depth + 1); if (child) listEl.append(child); }
        return listEl;
      }
      if (comp.children && typeof comp.children === 'object' && comp.children.componentId) {
        const tplId = comp.children.componentId, listPtr = String(comp.children.path || '/items');
        let lastJson = '';
        const syncList = () => {
          const rawArr = pointerGet(surface.dataModel, listPtr, scopeData);
          const items = Array.isArray(rawArr) ? rawArr.slice(0, A2UI_LIMITS.listItems) : [];
          const sig = JSON.stringify(items);
          if (sig === lastJson) return;
          lastJson = sig;
          listEl.replaceChildren();
          if (!items.length) { listEl.append(mk('div', 'a2ui-empty', String(comp.emptyText || 'No items'))); return; }
          const basePtr = resolvedPtr(listPtr, scopePath);
          items.forEach((item, idx) => { const n = buildNode(tplId, item, basePtr + '/' + idx, depth + 1); if (n) listEl.append(n); });
        };
        syncList(); wrap(syncList);
      }
      return listEl;
    }

    if (kind === 'Tabs') {
      const items = Array.isArray(comp.tabItems) ? comp.tabItems : Array.isArray(comp.tabs) ? comp.tabs : [];
      const wrapEl = mk('div', 'a2ui-tabs'), strip = mk('div', 'a2ui-tabs-strip'), panel = mk('div', 'a2ui-tabs-panel');
      let activeIdx = Math.max(0, Math.min(items.length - 1, Number(comp.selectedIndex) || 0));
      const showTab = idx => {
        activeIdx = idx;
        [...strip.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === activeIdx)));
        panel.replaceChildren();
        const tid = items[activeIdx]?.child;
        if (tid) { const n = buildNode(tid, scopeData, scopePath, depth + 1); if (n) panel.append(n); }
      };
      items.forEach((t, idx) => {
        const btn = mk('button', 'a2ui-tab', String(readProp(t.title ?? t.label ?? ('Tab ' + (idx + 1)), scopeData) ?? ('Tab ' + (idx + 1))));
        btn.type = 'button'; btn.onclick = () => showTab(idx); strip.append(btn);
      });
      wrapEl.append(strip, panel);
      if (items.length) showTab(activeIdx);
      return wrapEl;
    }

    if (kind === 'Modal') {
      const box = mk('div', 'a2ui-modal-wrap');
      const trig = comp.entryPointChild ? buildNode(comp.entryPointChild, scopeData, scopePath, depth + 1) : mk('button', 'a2ui-btn is-secondary', 'Open');
      if (trig && comp.contentChild) {
        trig.addEventListener('click', () => {
          const overlay = mk('div', 'a2ui-modal-backdrop'), dialog = mk('div', 'a2ui-modal-dialog'), closeBtn = mk('button', 'a2ui-modal-close', '×');
          closeBtn.type = 'button';
          const close = () => { overlay.remove(); if (activeModalClose === close) activeModalClose = null; };
          closeBtn.onclick = close; overlay.onclick = e => { if (e.target === overlay) close(); };
          activeModalClose = close;
          const content = buildNode(comp.contentChild, scopeData, scopePath, depth + 1);
          dialog.append(closeBtn); if (content) dialog.append(content); overlay.append(dialog); document.body.append(overlay);
        });
      }
      if (trig) box.append(trig);
      return box;
    }

    if (kind === 'Divider') return mk('hr', 'a2ui-divider' + (comp.axis === 'vertical' ? ' is-vertical' : ''));

    if (kind === 'Text') {
      const node = mk('div', 'a2ui-text is-' + String(comp.variant || 'body').toLowerCase());
      const sync = () => { const v = readProp(comp.text ?? '', scopeData); node.textContent = v == null ? '' : String(v); };
      sync(); wrap(sync);
      return node;
    }

    if (kind === 'Image') {
      const img = document.createElement('img'); img.className = 'a2ui-image'; img.alt = String(comp.alt || '');
      const sync = () => { const u = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? '')); if (u) { img.src = u; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } };
      sync(); wrap(sync);
      return img;
    }

    if (kind === 'Icon') {
      const span = mk('span', 'a2ui-icon');
      const sync = () => {
        const key = String(readProp(comp.name || 'sparkles', scopeData) || 'sparkles').toLowerCase();
        const inner = A2UI_ICON_PATHS[key] || A2UI_ICON_PATHS.sparkles;
        const s = Number(comp.size) || 18;
        span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
      };
      sync(); wrap(sync);
      return span;
    }

    if (kind === 'Video') {
      const v = document.createElement('video'); v.className = 'a2ui-video'; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      const sync = () => { const u = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? '')); if (u) { v.src = u; v.hidden = false; } else { v.removeAttribute('src'); v.hidden = true; } };
      sync(); wrap(sync);
      return v;
    }

    if (kind === 'AudioPlayer') {
      const box = mk('div', 'a2ui-audio'), a = document.createElement('audio'); a.controls = true; a.preload = 'metadata';
      const sync = () => { const u = safeMediaUrl(String(readProp(comp.url ?? comp.src ?? '', scopeData) ?? '')); if (u) { a.src = u; box.hidden = false; } else { a.removeAttribute('src'); box.hidden = true; } };
      box.append(a); sync(); wrap(sync);
      return box;
    }

    if (kind === 'Button') {
      const variant = ['primary', 'secondary', 'quiet', 'danger'].includes(comp.variant) ? comp.variant : (comp.primary ? 'primary' : 'secondary');
      const btn = mk('button', 'a2ui-btn is-' + variant); btn.type = 'button';
      if (comp.child) { const inner = buildNode(comp.child, scopeData, scopePath, depth + 1); if (inner) btn.append(inner); }
      else { const s = () => { btn.textContent = String(readProp(comp.label ?? comp.text ?? 'Action', scopeData) ?? 'Action'); }; s(); wrap(s); }
      const d = () => { btn.disabled = Boolean(readProp(comp.disabled ?? false, scopeData)); }; d(); wrap(d);
      btn.onclick = () => {
        const action = resolveActionContext(comp, surface.dataModel, scopeData, surface.surfaceId);
        if (comp.closeModal && activeModalClose) activeModalClose();
        if (window.parent !== window) window.parent.postMessage({ type: 'fairy-a2ui-action', action }, '*');
      };
      return btn;
    }

    if (kind === 'TextField') {
      const field = mk('label', 'a2ui-field');
      const lbl = mk('span', 'a2ui-field-label', String(readProp(comp.label ?? '', scopeData) ?? ''));
      if (!lbl.textContent) lbl.hidden = true;
      const variant = String(comp.variant || 'shortText').toLowerCase();
      const input = document.createElement(variant === 'longtext' || variant === 'multiline' ? 'textarea' : 'input');
      input.className = 'a2ui-input';
      if (input.tagName !== 'TEXTAREA') input.type = variant === 'number' ? 'number' : variant === 'obscured' ? 'password' : 'text';
      if (comp.placeholder) input.placeholder = String(comp.placeholder);
      const path = bindingPath(comp.value ?? comp.text);
      const sync = () => { if (document.activeElement === input) return; const v = readProp(comp.value ?? comp.text ?? '', scopeData); input.value = v == null ? '' : String(v); };
      sync(); wrap(sync);
      input.addEventListener('input', () => {
        if (!path) return;
        const n = variant === 'number' && input.value !== '' ? Number(input.value) : input.value;
        mutateData(path, variant === 'number' && Number.isNaN(n) ? input.value : n, scopePath);
      });
      field.append(lbl, input);
      return field;
    }

    if (kind === 'CheckBox' || kind === 'Switch') {
      const row = mk('label', 'a2ui-' + (kind === 'Switch' ? 'switch' : 'checkbox'));
      const input = document.createElement('input'); input.type = 'checkbox';
      const txt = mk('span', 'a2ui-toggle-text');
      const path = bindingPath(comp.value ?? comp.checked);
      const sync = () => { input.checked = Boolean(readProp(comp.value ?? comp.checked ?? false, scopeData)); txt.textContent = String(readProp(comp.label ?? '', scopeData) ?? ''); };
      sync(); wrap(sync);
      input.addEventListener('change', () => { if (path) mutateData(path, input.checked, scopePath); });
      row.append(input); if (kind === 'Switch') row.append(mk('span', 'a2ui-switch-track')); row.append(txt);
      return row;
    }

    if (kind === 'Slider') {
      const wrapEl = mk('label', 'a2ui-field'), headRow = mk('div', 'a2ui-slider-head'), lbl = mk('span', 'a2ui-field-label', String(readProp(comp.label ?? '', scopeData) ?? '')), pill = mk('span', 'a2ui-slider-val');
      headRow.append(lbl, pill);
      const input = document.createElement('input'); input.type = 'range'; input.className = 'a2ui-slider';
      input.min = String(comp.min ?? 0); input.max = String(comp.max ?? 100); if (comp.step != null) input.step = String(comp.step);
      const path = bindingPath(comp.value);
      const sync = () => { const n = Number(readProp(comp.value ?? input.min, scopeData)); const v = Number.isFinite(n) ? n : Number(input.min); if (document.activeElement !== input) input.value = String(v); pill.textContent = String(v); };
      sync(); wrap(sync);
      input.addEventListener('input', () => { const v = Number(input.value); pill.textContent = String(v); if (path) mutateData(path, v, scopePath); });
      wrapEl.append(headRow, input);
      return wrapEl;
    }

    if (kind === 'ChoicePicker') {
      const options = (Array.isArray(comp.options) ? comp.options : []).map(o => typeof o === 'string' ? { label: o, value: o } : { label: String(o?.label ?? o?.value ?? ''), value: o?.value ?? o?.label ?? '' });
      const multi = comp.allowMultiple === true || (Number(comp.maxAllowedSelections) || 1) > 1;
      const variant = String(comp.variant || (multi ? 'chips' : options.length > 5 ? 'dropdown' : 'chips')).toLowerCase();
      const path = bindingPath(comp.value ?? comp.selections);
      const box = mk('div', 'a2ui-field');
      if (comp.label) box.append(mk('span', 'a2ui-field-label', String(readProp(comp.label, scopeData) ?? '')));
      if (variant === 'dropdown' && !multi) {
        const sel = document.createElement('select'); sel.className = 'a2ui-select';
        for (const opt of options) sel.append(new Option(opt.label, String(opt.value)));
        const sync = () => { const v = readProp(comp.value ?? comp.selections ?? '', scopeData); if (v != null && document.activeElement !== sel) sel.value = String(v); };
        sync(); wrap(sync);
        sel.addEventListener('change', () => { if (path) mutateData(path, sel.value, scopePath); });
        box.append(sel);
        return box;
      }
      const listEl = mk('div', 'a2ui-choices');
      const sync = () => {
        const cur = readProp(comp.value ?? comp.selections ?? (multi ? [] : ''), scopeData);
        const picked = multi ? new Set((Array.isArray(cur) ? cur : []).map(String)) : String(cur ?? '');
        [...listEl.children].forEach((b, i) => {
          const val = String(options[i]?.value ?? '');
          const on = multi ? picked.has(val) : picked === val;
          b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-selected', on);
        });
      };
      options.forEach(opt => {
        const chip = mk('button', 'a2ui-choice', opt.label); chip.type = 'button';
        chip.onclick = () => {
          if (!path) return;
          if (multi) {
            const prev = readProp(comp.value ?? comp.selections ?? [], scopeData);
            const arr = Array.isArray(prev) ? [...prev] : [];
            const idx = arr.findIndex(x => String(x) === String(opt.value));
            if (idx >= 0) arr.splice(idx, 1); else arr.push(opt.value);
            mutateData(path, arr, scopePath);
          } else mutateData(path, opt.value, scopePath);
        };
        listEl.append(chip);
      });
      sync(); wrap(sync); box.append(listEl);
      return box;
    }

    if (kind === 'DateTimeInput') {
      const field = mk('label', 'a2ui-field');
      if (comp.label) field.append(mk('span', 'a2ui-field-label', String(readProp(comp.label, scopeData) ?? '')));
      const input = document.createElement('input'); input.className = 'a2ui-input';
      const d = comp.enableDate !== false, t = comp.enableTime === true;
      input.type = d && t ? 'datetime-local' : t && !d ? 'time' : 'date';
      const path = bindingPath(comp.value);
      const sync = () => { if (document.activeElement === input) return; const v = readProp(comp.value ?? '', scopeData); input.value = v == null ? '' : String(v); };
      sync(); wrap(sync);
      input.addEventListener('input', () => { if (path) mutateData(path, input.value, scopePath); });
      field.append(input);
      return field;
    }

    if (kind === 'Markdown') {
      const box = mk('div', 'a2ui-text');
      const sync = () => { box.textContent = String(readProp(comp.text ?? '', scopeData) ?? ''); };
      box.style.whiteSpace = 'pre-wrap';
      sync(); wrap(sync);
      return box;
    }

    if (kind === 'CodeBlock') {
      const pre = mk('pre', 'a2ui-code-pre'), code = document.createElement('code'); pre.append(code);
      const sync = () => { code.textContent = String(readProp(comp.code ?? comp.text ?? '', scopeData) ?? ''); };
      sync(); wrap(sync);
      return pre;
    }

    if (kind === 'Math') {
      const box = mk('code', 'a2ui-math');
      const sync = () => { box.textContent = String(readProp(comp.latex ?? comp.text ?? '', scopeData) ?? ''); };
      sync(); wrap(sync);
      return box;
    }

    if (kind === 'MetricTile') {
      const tile = mk('div', 'a2ui-metric'), lbl = mk('span', 'a2ui-metric-label'), val = mk('strong', 'a2ui-metric-value'), d = mk('span', 'a2ui-metric-delta');
      const sync = () => {
        lbl.textContent = String(readProp(comp.label ?? '', scopeData) ?? '');
        const rv = readProp(comp.value ?? '—', scopeData); val.textContent = rv == null ? '—' : String(rv);
        const rd = readProp(comp.delta ?? '', scopeData); d.textContent = rd ? String(rd) : ''; d.hidden = !rd;
      };
      tile.append(lbl, val, d); sync(); wrap(sync);
      return tile;
    }

    if (kind === 'Sparkline') {
      const box = mk('div', 'a2ui-sparkline'), headRow = mk('div', 'a2ui-sparkline-head'), svgWrap = mk('div', 'a2ui-sparkline-svg');
      box.append(headRow, svgWrap);
      const sync = () => {
        const geom = a2uiSparklineGeometry(readProp(comp.values ?? [], scopeData), 200, 46);
        const title = readProp(comp.label ?? '', scopeData);
        headRow.replaceChildren(mk('span', '', title ? String(title) : ''), mk('strong', '', String(geom.latest ?? '')));
        svgWrap.innerHTML = geom.points ? '<svg viewBox="0 0 200 46" preserveAspectRatio="none"><polygon points="' + geom.area + '" fill="rgba(62,90,236,.16)"/><polyline points="' + geom.points + '" fill="none" stroke="#9fb2ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
      };
      sync(); wrap(sync);
      return box;
    }

    if (kind === 'Badge') {
      const pill = mk('span', 'a2ui-badge is-' + (['accent', 'ok', 'warn', 'danger', 'neutral'].includes(comp.tone) ? comp.tone : 'neutral'));
      const sync = () => { pill.textContent = String(readProp(comp.label ?? comp.text ?? '', scopeData) ?? ''); };
      sync(); wrap(sync);
      return pill;
    }

    return null;
  }

  const root = buildNode(surface.root);
  if (root) surfaceHost.append(root);
}

renderPageSurface();
syncBar();
