// A sheet's page: shows the grid with its formulas worked out, sorts and filters it, and edits it by hand once the Pages
// panel says it may. It runs after sheet-core and page-bridge, with no network and nothing but its own data.
let book = cleanBook(JSON.parse(document.getElementById('fairy-data').textContent));
const app = document.getElementById('app');
const MAX_SHOWN = 2000, MAX_UNDO = 100, DEFAULT_WIDTH = 112;
let editable = false, current = 0, values = null, order = [], shownRows = 0, shownCols = 0, showFilters = false;
let anchor = { r: 1, c: 0 }, focus = { r: 1, c: 0 }, editing = null, undo = [], redo = [], dirty = false, saving = false, saveNote = '', saved = JSON.stringify(book);
const cells = new Map();
const bridge = fairyBridge({
  onEdit() { if (editable) return; editable = true; build(); },
  onSaved() { saving = false; saved = snapshot(); setDirty(false); },
  onFailed(message) { saving = false; saveNote = message; buildTools(); },
});

const toolsBar = el('div', { class: 'glass bar sheet-tools', role: 'toolbar', 'aria-label': 'Sheet tools' });
const address = el('span', { class: 'address', 'aria-live': 'polite' });
const formula = el('input', { class: 'formula-input', 'aria-label': 'Cell contents', spellcheck: 'false', autocomplete: 'off' });
const formulaBar = el('div', { class: 'formula' }, address, formula);
const grid = el('table', { class: 'grid', role: 'grid' });
const wrap = el('div', { class: 'grid-wrap', tabindex: '0', 'aria-label': 'Cells' }, grid);
const more = el('p', { class: 'more', hidden: true });
const tabs = el('nav', { class: 'tabs', 'aria-label': 'Sheets' });
app.append(toolsBar, formulaBar, wrap, more, tabs);

const sheet = () => book.sheets[current];
const raw = (r, c) => sheet().rows[r]?.[c] ?? null;
const valueAt = (r, c) => values.value(current, r, c);
const snapshot = () => JSON.stringify(book);
function remember(before) {
  if (before === snapshot()) return;
  undo.push(before); if (undo.length > MAX_UNDO) undo.shift();
  redo = []; setDirty(snapshot() !== saved);
}
function restore(from, to) {
  const state = from.pop();
  if (!state) return;
  to.push(snapshot()); book = JSON.parse(state); current = Math.min(current, book.sheets.length - 1);
  setDirty(snapshot() !== saved); build();
}
function setDirty(value) { dirty = value; if (value) saveNote = ''; bridge.dirty(value); buildTools(); }
function change(work) { const before = snapshot(); work(); remember(before); build(); }

// --- Drawing ---------------------------------------------------------------------------------------------------------------

function compute() {
  values = evaluateBook(book);
  // Top to bottom first, so a long chain of running totals is worked out one step at a time.
  for (let si = 0; si < book.sheets.length; si++) book.sheets[si].rows.forEach((row, r) => row.forEach((_, c) => values.value(si, r, c)));
}
function build() {
  compute(); buildTools(); buildTabs(); buildGrid(); select(anchor, focus, false);
}
function buildTools() {
  const group = (...children) => el('div', { class: 'group' }, ...children);
  const s = sheet(), col = Math.min(anchor.c, focus.c), sorted = s.sort?.col === col ? (s.sort.desc ? 'desc' : 'asc') : '';
  const sortUp = tool('sortUp', 'Sort A to Z by this column', () => sortBy(false)), sortDown = tool('sortDown', 'Sort Z to A by this column', () => sortBy(true));
  sortUp.setAttribute('aria-pressed', String(sorted === 'asc')); sortDown.setAttribute('aria-pressed', String(sorted === 'desc'));
  const filter = tool('filter', 'Filter rows', () => { showFilters = !showFilters; buildGrid(); select(anchor, focus, false); buildTools(); });
  filter.setAttribute('aria-pressed', String(showFilters || Boolean(Object.keys(s.filters || {}).length)));
  const parts = [group(sortUp, sortDown, filter)];
  if (editable) {
    const back = tool('undo', 'Undo', () => restore(undo, redo), { shortcut: isMac ? '⌘Z' : 'Ctrl+Z' }), again = tool('redo', 'Redo', () => restore(redo, undo), { shortcut: isMac ? '⇧⌘Z' : 'Ctrl+Y' });
    back.disabled = !undo.length; again.disabled = !redo.length;
    parts.unshift(group(back, again));
    parts.push(group(
      tool('', 'Insert a row below', () => insert('row'), { word: '+ Row' }), tool('', 'Insert a column to the right', () => insert('col'), { word: '+ Column' }),
      tool('', 'Delete the selected rows', () => remove('row'), { word: '− Row' }), tool('', 'Delete the selected columns', () => remove('col'), { word: '− Column' })));
    const save = el('button', { type: 'button', class: 'save', onclick: saveSheet, title: `Save as a new version (${isMac ? '⌘S' : 'Ctrl+S'})`, text: saving ? 'Saving…' : dirty ? 'Save' : 'Saved' });
    save.disabled = !dirty || saving;
    parts.push(group(saveNote ? el('span', { class: 'save-note', role: 'status', text: saveNote }) : null, save));
  }
  toolsBar.replaceChildren(...parts);
  formulaBar.hidden = !editable;
}
function buildTabs() {
  const list = book.sheets.map((entry, index) => {
    const tab = el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(index === current), text: entry.name, title: editable ? 'Double-click to rename' : entry.name,
      onclick: () => { if (index !== current) { finishEdit(true); current = index; anchor = focus = { r: 1, c: 0 }; build(); bridge.view({ sheet: sheet().name }); } },
      ondblclick: () => { if (editable) renameTab(tab, index); } });
    return tab;
  });
  if (editable) {
    if (book.sheets.length > 1) list.push(el('button', { type: 'button', class: 'tab-tool', 'aria-label': `Delete ${sheet().name}`, title: `Delete ${sheet().name}`, text: '×', onclick: removeSheet }));
    if (book.sheets.length < SHEET_LIMITS.sheets) list.push(el('button', { type: 'button', class: 'tab-tool', 'aria-label': 'Add a sheet', title: 'Add a sheet', text: '+', onclick: addTab }));
  }
  tabs.replaceChildren(el('div', { role: 'tablist', class: 'tablist' }, ...list));
  tabs.hidden = book.sheets.length < 2 && !editable;
}
function renameTab(tab, index) {
  const input = el('input', { class: 'tab-name', value: book.sheets[index].name, 'aria-label': 'Sheet name', maxlength: String(SHEET_LIMITS.name) });
  let done = false;
  const finish = keep => {
    if (done) return; done = true;
    if (keep && input.value.trim() && input.value.trim() !== book.sheets[index].name) {
      const before = snapshot();
      if (!renameSheet(book, index, input.value)) { saveNote = 'Another sheet has that name.'; buildTools(); }
      remember(before);
    }
    build();
  };
  input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  tab.replaceWith(input); input.focus(); input.select();
}
function addTab() {
  change(() => { let n = book.sheets.length + 1; while (book.sheets.some(entry => entry.name.toLowerCase() === `sheet${n}`)) n++; book.sheets.push({ name: `Sheet${n}`, rows: [] }); current = book.sheets.length - 1; anchor = focus = { r: 1, c: 0 }; });
}
function removeSheet() {
  if (!confirm(`Delete “${sheet().name}”? Formulas that use it will show #REF!.`)) return;
  change(() => { book.sheets.splice(current, 1); current = Math.max(0, current - 1); anchor = focus = { r: 1, c: 0 }; });
}
const width = c => sheet().widths?.[c] || (c === 0 ? 150 : DEFAULT_WIDTH);
function buildGrid() {
  const s = sheet(), dataRows = s.rows.length, dataCols = Math.max(0, ...s.rows.map(row => row.length));
  shownCols = Math.min(SHEET_LIMITS.cols, editable ? Math.max(dataCols + 3, 8) : Math.max(dataCols, 1));
  const count = Math.min(SHEET_LIMITS.rows, editable ? Math.max(dataRows + 25, 40) : Math.max(dataRows, 1));
  order = visibleRows(s, valueAt, count);
  shownRows = order.length;
  const filtersOn = showFilters || Object.keys(s.filters || {}).length > 0;
  const colgroup = el('colgroup', {}, el('col', { style: 'width:46px' }), ...Array.from({ length: shownCols }, (_, c) => el('col', { style: `width:${width(c)}px` })));
  const letters = el('tr', { class: 'letters' }, el('th', { class: 'corner', 'aria-label': 'Select everything', onclick: () => select({ r: 0, c: 0 }, { r: Math.max(0, dataRows - 1), c: Math.max(0, dataCols - 1) }) }),
    ...Array.from({ length: shownCols }, (_, c) => {
      const head = el('th', { scope: 'col', 'data-c': String(c), onclick: event => { if (event.target.classList.contains('sizer')) return; select(event.shiftKey ? anchor : { r: 0, c }, { r: Math.max(0, shownRows ? order.at(-1) : 0), c }); } }, `${colName(c)}${s.sort?.col === c ? (s.sort.desc ? ' ↓' : ' ↑') : ''}`);
      if (editable) head.append(el('span', { class: 'sizer', 'aria-hidden': 'true', onpointerdown: event => resizeColumn(event, c) }));
      return head;
    }));
  const head = el('thead', {}, letters);
  if (filtersOn) head.append(el('tr', { class: 'filters' }, el('th', { class: 'corner' }), ...Array.from({ length: shownCols }, (_, c) => {
    const input = el('input', { type: 'search', class: 'filter-input', placeholder: c === 0 ? 'Filter' : '', 'aria-label': `Filter column ${colName(c)}`, value: s.filters?.[c] || '', title: 'Words to look for, or a comparison such as > 50 or <= 2026-12-01' });
    input.addEventListener('input', () => {
      const before = snapshot();
      s.filters ||= {};
      if (input.value.trim()) s.filters[c] = input.value.slice(0, SHEET_LIMITS.filter); else delete s.filters[c];
      if (!Object.keys(s.filters).length) delete s.filters;
      if (editable) remember(before);
      drawBody();
    });
    input.addEventListener('keydown', event => event.stopPropagation());
    return el('th', {}, input);
  })));
  const body = el('tbody');
  grid.replaceChildren(colgroup, head, body);
  drawBody();
}
function drawBody() {
  const s = sheet(), body = grid.tBodies[0], rows = document.createDocumentFragment(), dataRows = s.rows.length;
  order = visibleRows(s, valueAt, Math.min(SHEET_LIMITS.rows, editable ? Math.max(dataRows + 25, 40) : Math.max(dataRows, 1)));
  shownRows = order.length;
  cells.clear();
  for (const r of order.slice(0, MAX_SHOWN)) {
    const line = el('tr', { class: r === 0 ? 'headings' : '' }, el('th', { scope: 'row', onclick: event => select(event.shiftKey ? anchor : { r, c: 0 }, { r, c: shownCols - 1 }) }, String(r + 1)));
    for (let c = 0; c < shownCols; c++) {
      const value = r < dataRows ? valueAt(r, c) : null, cell = el('td', { 'data-r': String(r), 'data-c': String(c) });
      const text = displayValue(value);
      cell.textContent = text;
      if (typeof value === 'number') cell.className = 'num';
      else if (isSheetError(value)) { cell.className = 'err'; cell.title = { '#REF!': 'A cell or sheet this uses is gone', '#DIV/0!': 'Divides by zero', '#VALUE!': 'Text where a number was needed', '#NAME?': 'Not a function this knows', '#N/A': 'Not found', '#CYCLE!': 'Uses itself, through other cells', '#ERROR!': 'Can’t read this formula', '#NUM!': 'Not a number that can be shown' }[value.code] || value.code; }
      else if (typeof value === 'boolean') cell.className = 'bool';
      if (typeof raw(r, c) === 'string' && raw(r, c).startsWith('=')) cell.classList.add('formula-cell');
      cells.set(`${r},${c}`, cell); line.append(cell);
    }
    rows.append(line);
  }
  body.replaceChildren(rows);
  more.hidden = shownRows <= MAX_SHOWN;
  more.textContent = `Showing the first ${MAX_SHOWN} of ${shownRows} rows. Filter to find the rest.`;
  select(anchor, focus, false);
}
function resizeColumn(event, c) {
  event.preventDefault(); event.stopPropagation();
  const start = event.clientX, from = width(c), col = grid.querySelectorAll('col')[c + 1], before = snapshot();
  const move = next => { col.style.width = `${Math.max(40, Math.min(600, from + next.clientX - start))}px`; };
  const up = next => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    const s = sheet(), widths = s.widths ? [...s.widths] : [];
    while (widths.length <= c) widths.push(null);
    widths[c] = Math.round(Math.max(40, Math.min(600, from + next.clientX - start))); s.widths = widths;
    remember(before);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

// --- Selecting ----------------------------------------------------------------------------------------------------------------

const range = () => ({ top: Math.min(anchor.r, focus.r), bottom: Math.max(anchor.r, focus.r), left: Math.min(anchor.c, focus.c), right: Math.max(anchor.c, focus.c) });
function select(from, to = from, scroll = true) {
  anchor = { r: Math.max(0, from.r), c: Math.max(0, Math.min(shownCols - 1, from.c)) }; focus = { r: Math.max(0, to.r), c: Math.max(0, Math.min(shownCols - 1, to.c)) };
  grid.querySelectorAll('.picked,.focus').forEach(cell => cell.classList.remove('picked', 'focus'));
  const { top, bottom, left, right } = range(), rows = new Set(order.filter(r => r >= top && r <= bottom));
  if ((bottom - top + 1) * (right - left + 1) <= 20000) for (const r of rows) for (let c = left; c <= right; c++) cells.get(`${r},${c}`)?.classList.add('picked');
  const cell = cells.get(`${focus.r},${focus.c}`);
  cell?.classList.add('focus');
  if (scroll) cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  address.textContent = top === bottom && left === right ? cellName(focus.r, focus.c) : `${cellName(top, left)}:${cellName(bottom, right)}`;
  if (document.activeElement !== formula) formula.value = editText(raw(focus.r, focus.c));
  if (editable) buildToolsSoon();
}
let toolsTimer = 0;
const buildToolsSoon = () => { cancelAnimationFrame(toolsTimer); toolsTimer = requestAnimationFrame(buildTools); };
// Moves within the rows as shown, so arrows follow a sorted or filtered sheet.
function step(dr, dc, extend) {
  const at = order.indexOf(focus.r), next = order[Math.max(0, Math.min(order.length - 1, (at < 0 ? 0 : at) + dr))] ?? focus.r;
  const target = { r: next, c: Math.max(0, Math.min(shownCols - 1, focus.c + dc)) };
  select(extend ? anchor : target, target);
}
wrap.addEventListener('pointerdown', event => {
  const cell = event.target.closest('td');
  if (!cell || event.target.closest('input')) return;
  finishEdit(true);
  const at = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  select(event.shiftKey ? anchor : at, at, false);
  wrap.focus({ preventScroll: true });
  const extend = next => { const over = document.elementFromPoint(next.clientX, next.clientY)?.closest?.('td'); if (over) select(anchor, { r: Number(over.dataset.r), c: Number(over.dataset.c) }, false); };
  const stop = () => { removeEventListener('pointermove', extend); removeEventListener('pointerup', stop); };
  addEventListener('pointermove', extend); addEventListener('pointerup', stop);
});
wrap.addEventListener('dblclick', event => { const cell = event.target.closest('td'); if (cell && editable) startEdit(); });

// --- Editing ----------------------------------------------------------------------------------------------------------------

function setCells(entries) {
  const s = sheet();
  for (const [r, c, value] of entries) {
    if (r >= SHEET_LIMITS.rows || c >= SHEET_LIMITS.cols) continue;
    while (s.rows.length <= r) { if (value === null) break; s.rows.push([]); }
    if (!s.rows[r]) continue;
    const row = s.rows[r];
    while (row.length <= c && value !== null) row.push(null);
    if (c < row.length) row[c] = value;
  }
}
function startEdit(initial) {
  if (!editable || editing) return;
  const cell = cells.get(`${focus.r},${focus.c}`);
  if (!cell) return;
  const input = el('input', { class: 'cell-input', 'aria-label': `Edit ${cellName(focus.r, focus.c)}`, spellcheck: 'false', autocomplete: 'off' });
  input.value = initial ?? editText(raw(focus.r, focus.c));
  editing = { r: focus.r, c: focus.c, input, cell };
  cell.classList.add('editing'); cell.replaceChildren(input); input.focus();
  if (initial === undefined) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('input', () => { formula.value = input.value; });
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); finishEdit(true); step(event.shiftKey ? -1 : 1, 0, false); wrap.focus({ preventScroll: true }); }
    else if (event.key === 'Tab') { event.preventDefault(); finishEdit(true); step(0, event.shiftKey ? -1 : 1, false); wrap.focus({ preventScroll: true }); }
    else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); wrap.focus({ preventScroll: true }); }
  });
  input.addEventListener('blur', () => setTimeout(() => finishEdit(true)));
}
function finishEdit(keep) {
  if (!editing) return;
  const { r, c, input } = editing;
  editing = null;
  if (keep && input.value !== editText(raw(r, c))) change(() => setCells([[r, c, typedValue(input.value)]]));
  else drawBody();
}
formula.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Enter') { event.preventDefault(); if (formula.value !== editText(raw(focus.r, focus.c))) change(() => setCells([[focus.r, focus.c, typedValue(formula.value)]])); step(1, 0, false); wrap.focus({ preventScroll: true }); }
  if (event.key === 'Escape') { formula.value = editText(raw(focus.r, focus.c)); wrap.focus({ preventScroll: true }); }
});
formula.addEventListener('focus', () => { if (!editable) formula.blur(); });
function clearRange() {
  const { top, bottom, left, right } = range(), entries = [];
  for (let r = top; r <= Math.min(bottom, sheet().rows.length - 1); r++) for (let c = left; c <= right; c++) entries.push([r, c, null]);
  change(() => setCells(entries));
}
function insert(axis) {
  const { bottom, right } = range();
  change(() => shiftBook(book, current, axis, axis === 'row' ? bottom + 1 : right + 1, 1));
  step(axis === 'row' ? 1 : 0, axis === 'col' ? 1 : 0, false);
}
function remove(axis) {
  const { top, bottom, left, right } = range();
  if (axis === 'row' && top === 0 && !confirm('Delete the headings row?')) return;
  change(() => shiftBook(book, current, axis, axis === 'row' ? top : left, -(axis === 'row' ? bottom - top + 1 : right - left + 1)));
}
function sortBy(desc) {
  const s = sheet(), col = Math.min(anchor.c, focus.c), before = snapshot();
  if (s.sort?.col === col && s.sort.desc === desc) delete s.sort; else s.sort = { col, desc };
  if (editable) remember(before);
  buildGrid(); buildTools(); select(anchor, focus, false);
}
function saveSheet() {
  if (!dirty || saving) return;
  finishEdit(true); saving = true; saveNote = ''; buildTools();
  bridge.save(JSON.parse(snapshot()));
}

// --- Keys and the clipboard --------------------------------------------------------------------------------------------------

addEventListener('keydown', event => {
  if (editing || event.target.matches?.('input')) return;
  const key = event.key;
  if (modKey(event)) {
    const lower = key.toLowerCase();
    if (!editable) return;
    if (lower === 'z') { event.preventDefault(); if (event.shiftKey) restore(redo, undo); else restore(undo, redo); }
    else if (lower === 'y') { event.preventDefault(); restore(redo, undo); }
    else if (lower === 's') { event.preventDefault(); saveSheet(); }
    return;
  }
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (moves[key]) { event.preventDefault(); step(...moves[key], event.shiftKey); return; }
  if (key === 'Tab') { event.preventDefault(); step(0, event.shiftKey ? -1 : 1, false); return; }
  if (!editable) return;
  if (key === 'Enter' || key === 'F2') { event.preventDefault(); startEdit(); return; }
  if (key === 'Backspace' || key === 'Delete') { event.preventDefault(); clearRange(); return; }
  if (key.length === 1 && !event.altKey && !event.ctrlKey) { event.preventDefault(); startEdit(key); }
});
function selectedText() {
  const { top, bottom, left, right } = range();
  return order.filter(r => r >= top && r <= bottom).map(r => Array.from({ length: right - left + 1 }, (_, i) => displayValue(r < sheet().rows.length ? valueAt(r, left + i) : null)).join('\t')).join('\n');
}
addEventListener('copy', event => { if (editing || event.target.matches?.('input')) return; event.clipboardData.setData('text/plain', selectedText()); event.preventDefault(); });
addEventListener('cut', event => { if (editing || event.target.matches?.('input') || !editable) return; event.clipboardData.setData('text/plain', selectedText()); event.preventDefault(); clearRange(); });
addEventListener('paste', event => {
  if (editing || event.target.matches?.('input') || !editable) return;
  const text = event.clipboardData.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  const rows = parseCSV(text.includes('\t') || !text.includes(',') ? text.replace(/\t/g, '\u0000').replace(/,/g, '\u0001').replace(/\u0000/g, '\t') : text).map(row => row.map(field => field.replace(/\u0001/g, ',')));
  const entries = [];
  rows.forEach((row, i) => row.forEach((field, j) => entries.push([focus.r + i, focus.c + j, typedValue(field)])));
  change(() => setCells(entries));
});
addEventListener('beforeunload', event => { if (dirty && !saving && window.parent === window) event.preventDefault(); });

build();
bridge.view({ sheet: sheet().name });
