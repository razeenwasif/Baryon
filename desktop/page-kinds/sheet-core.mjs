// A sheet: named grids of cells, with formulas worked out by a small evaluator of Fairy's own (nothing is run with eval).
// This file runs in Node and, copied in, inside a sheet's page, so it imports nothing and only exports functions and constants.

export const SHEET_LIMITS = { sheets: 20, rows: 5000, cols: 200, cell: 5000, name: 40, filter: 100 };

export function colName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function colIndex(name) {
  let n = 0;
  for (const letter of String(name).toUpperCase()) n = n * 26 + letter.charCodeAt(0) - 64;
  return n - 1;
}
export const cellName = (row, col) => `${colName(col)}${row + 1}`;

// --- Cleaning what a model, a file or the page hands over -------------------------------------------------------------

function cleanCell(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') return cleanCell(value.formula ?? value.value ?? null);
  return String(value).replace(/\r\n?/g, '\n').slice(0, SHEET_LIMITS.cell);
}
// Names can't hold the characters references use, so 'Exam dates'!B2 always means one sheet.
export function cleanSheetName(value, fallback = 'Sheet1') {
  return String(value ?? '').replace(/[\u0000-\u001f!'"[\]:*?/\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, SHEET_LIMITS.name) || fallback;
}
function trimRows(rows) {
  const kept = rows.map(row => { const copy = [...row]; while (copy.length && copy.at(-1) === null) copy.pop(); return copy; });
  while (kept.length && !kept.at(-1).length) kept.pop();
  return kept;
}
// Accepts { sheets: [...] }, one sheet { rows }, or a bare grid, and keeps everything within the limits.
export function cleanBook(value) {
  const list = Array.isArray(value?.sheets) ? value.sheets : Array.isArray(value?.rows) ? [value] : Array.isArray(value) ? [{ rows: value }] : [];
  const sheets = [], names = new Set();
  for (const sheet of list) {
    if (sheets.length >= SHEET_LIMITS.sheets) break;
    let name = cleanSheetName(sheet?.name, `Sheet${sheets.length + 1}`);
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${cleanSheetName(sheet?.name, 'Sheet').slice(0, SHEET_LIMITS.name - 4)} ${n}`;
    names.add(name.toLowerCase());
    const rows = trimRows((Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, SHEET_LIMITS.rows).map(row => (Array.isArray(row) ? row : [row]).slice(0, SHEET_LIMITS.cols).map(cleanCell)));
    const clean = { name, rows };
    if (Array.isArray(sheet?.widths)) {
      const widths = sheet.widths.slice(0, SHEET_LIMITS.cols).map(width => (Number.isFinite(Number(width)) && Number(width) > 0 ? Math.min(600, Math.max(40, Math.round(Number(width)))) : null));
      if (widths.some(Boolean)) clean.widths = widths;
    }
    const sortCol = Number(sheet?.sort?.col);
    if (Number.isInteger(sortCol) && sortCol >= 0 && sortCol < SHEET_LIMITS.cols) clean.sort = { col: sortCol, desc: sheet.sort.desc === true };
    if (sheet?.filters && typeof sheet.filters === 'object') {
      const filters = {};
      for (const [key, words] of Object.entries(sheet.filters).slice(0, SHEET_LIMITS.cols)) {
        const col = Number(key), text = String(words ?? '').trim().slice(0, SHEET_LIMITS.filter);
        if (Number.isInteger(col) && col >= 0 && col < SHEET_LIMITS.cols && text) filters[col] = text;
      }
      if (Object.keys(filters).length) clean.filters = filters;
    }
    sheets.push(clean);
  }
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [] });
  return { sheets };
}
export const bookIsEmpty = book => book.sheets.every(sheet => !sheet.rows.length);
// One row to a line, so a model reading it back (or a person) can see the grid.
export function bookJSON(book) {
  const sheet = ({ rows, ...rest }) => `{${JSON.stringify(rest).slice(1, -1)},"rows":[${rows.length ? `\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ` : ''}]}`;
  return `{"sheets":[\n ${book.sheets.map(sheet).join(',\n ')}\n]}\n`;
}

// --- Formulas ---------------------------------------------------------------------------------------------------------

class SheetError { constructor(code) { this.code = code; } toString() { return this.code; } }
export const sheetError = code => new SheetError(code);
export const isSheetError = value => value instanceof SheetError;
const fail = code => { throw new SheetError(code); };
const ERRORS = ['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#ERROR!', '#CYCLE!'];

// A cell or column reference at i: $A$1, B2, or a whole column (C) when rows are optional.
function readCell(src, i, rowOptional) {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})?(?![A-Za-z0-9_(])/.exec(src.slice(i));
  if (!match || (!match[4] && (!rowOptional || match[3]))) return null;
  const cell = { col: colIndex(match[2]), colAbs: Boolean(match[1]), row: match[4] ? Number(match[4]) - 1 : null, rowAbs: Boolean(match[3]) };
  if (cell.row !== null && cell.row < 0) return null;
  return { cell, end: i + match[0].length };
}
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i], start = i;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let value = '';
      for (i++; ; i++) {
        if (i >= src.length) fail('#ERROR!');
        if (src[i] === '"') { if (src[i + 1] === '"') { value += '"'; i++; continue; } i++; break; }
        value += src[i];
      }
      tokens.push({ type: 'str', value, start, end: i });
      continue;
    }
    if (ch === '#') {
      const code = ERRORS.find(name => src.startsWith(name, i));
      if (!code) fail('#ERROR!');
      i += code.length; tokens.push({ type: 'err', code, start, end: i });
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (number && !/^[A-Za-z_]/.test(src.slice(i + number[0].length))) {
      i += number[0].length; tokens.push({ type: 'num', value: Number(number[0]), start, end: i });
      continue;
    }
    // A sheet name, quoted or plain, then !
    let sheet = null, j = i;
    if (ch === "'") {
      const close = src.indexOf("'!", i + 1);
      if (close < 0) fail('#ERROR!');
      sheet = src.slice(i + 1, close).replace(/''/g, "'"); j = close + 2;
    } else {
      const word = /^[A-Za-z_][A-Za-z0-9_.]*!/.exec(src.slice(i));
      if (word) { sheet = word[0].slice(0, -1); j = i + word[0].length; }
    }
    if (ch === '$' || /[A-Za-z]/.test(src[j] || '') || sheet !== null) {
      const first = readCell(src, j, true);
      if (first) {
        let a = first.cell, b = null, end = first.end;
        if (src[end] === ':') { const second = readCell(src, end + 1, a.row === null); if (second && (second.cell.row === null) === (a.row === null)) { b = second.cell; end = second.end; } }
        if (a.row === null && !b) first.cell = null;
        else { i = end; tokens.push({ type: 'ref', sheet, a, b, start, end, prefix: src.slice(start, j) }); continue; }
      }
      if (sheet !== null) fail('#REF!');
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      const upper = word[0].toUpperCase();
      if (/^\s*\(/.test(src.slice(i))) tokens.push({ type: 'fn', name: upper, start, end: i });
      else if (upper === 'TRUE' || upper === 'FALSE') tokens.push({ type: 'bool', value: upper === 'TRUE', start, end: i });
      else fail('#NAME?');
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { i += 2; tokens.push({ type: 'op', value: two, start, end: i }); continue; }
    if ('+-*/^&=<>%(),;'.includes(ch)) { i++; tokens.push({ type: ch === '(' || ch === ')' ? ch : ch === ',' || ch === ';' ? ',' : 'op', value: ch, start, end: i }); continue; }
    fail('#ERROR!');
  }
  return tokens;
}
// Precedence as in Excel: comparisons, then &, + -, * /, ^, a leading minus, then %.
function parse(src) {
  const tokens = tokenize(src);
  let at = 0;
  const peek = () => tokens[at], take = () => tokens[at++];
  const isOp = (...ops) => peek()?.type === 'op' && ops.includes(peek().value);
  const binary = (next, ops) => () => { let node = next(); while (isOp(...ops)) { const op = take().value; node = { t: 'bin', op, a: node, b: next() }; } return node; };
  const primary = () => {
    const token = take();
    if (!token) fail('#ERROR!');
    if (token.type === 'num' || token.type === 'str' || token.type === 'bool') return { t: 'val', v: token.value };
    if (token.type === 'err') return { t: 'val', v: sheetError(token.code) };
    if (token.type === 'ref') return { t: 'ref', sheet: token.sheet, a: token.a, b: token.b };
    if (token.type === '(') { const node = compare(); if (take()?.type !== ')') fail('#ERROR!'); return node; }
    if (token.type === 'fn') {
      take();
      const args = [];
      if (peek()?.type === ')') take();
      else for (;;) {
        args.push(peek()?.type === ',' || peek()?.type === ')' ? { t: 'val', v: null } : compare());
        const next = take();
        if (next?.type === ')') break;
        if (next?.type !== ',') fail('#ERROR!');
      }
      return { t: 'fn', name: token.name, args };
    }
    fail('#ERROR!');
  };
  const postfix = () => { let node = primary(); while (isOp('%')) { take(); node = { t: 'pct', a: node }; } return node; };
  const unary = () => { if (isOp('-', '+')) { const op = take().value; const a = unary(); return op === '-' ? { t: 'neg', a } : a; } return postfix(); };
  const power = binary(unary, ['^']), product = binary(power, ['*', '/']), sum = binary(product, ['+', '-']), join = binary(sum, ['&']), compare = binary(join, ['=', '<>', '<', '>', '<=', '>=']);
  const tree = compare();
  if (at < tokens.length) fail('#ERROR!');
  return tree;
}

// --- Values -----------------------------------------------------------------------------------------------------------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function toNumber(value) {
  if (value instanceof SheetError) throw value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === '') return 0;
  const text = String(value).trim().replace(/,/g, '');
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)) return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  return fail('#VALUE!');
}
function toText(value) {
  if (value instanceof SheetError) throw value;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}
function toBool(value) {
  if (value instanceof SheetError) throw value;
  if (typeof value === 'boolean') return value;
  if (value === null) return false;
  if (typeof value === 'number') return value !== 0;
  const upper = String(value).trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return fail('#VALUE!');
}
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '#NUM!';
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return String(Number(value.toPrecision(12)));
}
function dayNumber(value) {
  const match = DATE.exec(String(value ?? '').trim().slice(0, 10));
  if (!match) return fail('#VALUE!');
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}
const isoDay = days => new Date(days * 86400000).toISOString().slice(0, 10);
function localToday() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
// Numbers before text before TRUE/FALSE, as in Excel; text compares without case.
function compareValues(a, b) {
  const rank = value => (typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2);
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}
// "> 5", "<>done", "a*" and plain values, as COUNTIF and its kin take them.
function criterion(spec) {
  if (spec instanceof SheetError) throw spec;
  if (typeof spec !== 'string') return value => value !== null && compareValues(value, spec) === 0;
  const [, op = '=', rest] = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(spec);
  const numeric = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(rest) ? Number(rest) : null;
  const target = numeric ?? rest;
  if (typeof target === 'string' && (op === '=' || op === '<>')) {
    const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'is');
    const test = value => (value === null ? target === '' : typeof value === 'string' ? pattern.test(value) : pattern.test(toText(value)));
    return op === '=' ? test : value => !test(value);
  }
  return value => {
    if (value === null || value instanceof SheetError || (typeof target === 'number') !== (typeof value === 'number')) return op === '<>';
    const order = compareValues(value, target);
    return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[op];
  };
}
const isRange = value => value && typeof value === 'object' && Array.isArray(value.cells);
const cellsOf = value => (isRange(value) ? value.cells.flat() : [value]);
// Numbers from ranges skip text and blanks; numbers typed straight in must be numbers.
function numbers(args) {
  const out = [];
  for (const arg of args) {
    if (isRange(arg)) { for (const value of arg.cells.flat()) { if (value instanceof SheetError) throw value; if (typeof value === 'number') out.push(value); } }
    else if (arg !== null) out.push(toNumber(arg));
  }
  return out;
}
const scalar = value => (isRange(value) ? (value.cells.length === 1 && value.cells[0].length === 1 ? value.cells[0][0] : fail('#VALUE!')) : value);
const roundTo = (value, digits, how) => { const factor = 10 ** digits, scaled = value * factor; return how(Number(scaled.toPrecision(15))) / factor; };
const median = list => { const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const nonEmpty = list => (list.length ? list : fail('#DIV/0!'));
const pairsIf = (range, test, other) => { const cells = cellsOf(range), values = other ? cellsOf(other) : cells; return values.filter((_, index) => test(cells[index] ?? null)); };

const FUNCTIONS = {
  SUM: args => numbers(args).reduce((a, b) => a + b, 0),
  PRODUCT: args => numbers(args).reduce((a, b) => a * b, 1),
  AVERAGE: args => { const list = nonEmpty(numbers(args)); return list.reduce((a, b) => a + b, 0) / list.length; },
  MIN: args => { const list = numbers(args); return list.length ? Math.min(...list) : 0; },
  MAX: args => { const list = numbers(args); return list.length ? Math.max(...list) : 0; },
  MEDIAN: args => median(nonEmpty(numbers(args))),
  STDEV: args => { const list = numbers(args); if (list.length < 2) fail('#DIV/0!'); const mean = list.reduce((a, b) => a + b, 0) / list.length; return Math.sqrt(list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (list.length - 1)); },
  COUNT: args => args.flatMap(cellsOf).filter(value => typeof value === 'number').length,
  COUNTA: args => args.flatMap(cellsOf).filter(value => value !== null && value !== '').length,
  COUNTBLANK: args => args.flatMap(cellsOf).filter(value => value === null || value === '').length,
  COUNTIF: ([range, spec]) => pairsIf(range, criterion(scalar(spec))).length,
  SUMIF: ([range, spec, other]) => numbers([{ cells: [pairsIf(range, criterion(scalar(spec)), other)] }]).reduce((a, b) => a + b, 0),
  AVERAGEIF: ([range, spec, other]) => { const list = nonEmpty(numbers([{ cells: [pairsIf(range, criterion(scalar(spec)), other)] }])); return list.reduce((a, b) => a + b, 0) / list.length; },
  ROUND: ([value, digits]) => { const n = toNumber(scalar(value)); return roundTo(Math.abs(n), Math.trunc(toNumber(scalar(digits ?? 0))), Math.round) * Math.sign(n); },
  ROUNDUP: ([value, digits]) => { const n = toNumber(scalar(value)); return roundTo(Math.abs(n), Math.trunc(toNumber(scalar(digits ?? 0))), Math.ceil) * Math.sign(n); },
  ROUNDDOWN: ([value, digits]) => { const n = toNumber(scalar(value)); return roundTo(Math.abs(n), Math.trunc(toNumber(scalar(digits ?? 0))), Math.floor) * Math.sign(n); },
  INT: ([value]) => Math.floor(toNumber(scalar(value))),
  ABS: ([value]) => Math.abs(toNumber(scalar(value))),
  SQRT: ([value]) => { const n = toNumber(scalar(value)); return n < 0 ? fail('#NUM!') : Math.sqrt(n); },
  POWER: ([base, exponent]) => toNumber(scalar(base)) ** toNumber(scalar(exponent)),
  MOD: ([value, divisor]) => { const d = toNumber(scalar(divisor)); if (d === 0) fail('#DIV/0!'); const n = toNumber(scalar(value)); return n - d * Math.floor(n / d); },
  PI: () => Math.PI,
  AND: args => args.flatMap(cellsOf).filter(value => value !== null).every(toBool),
  OR: args => args.flatMap(cellsOf).filter(value => value !== null).some(toBool),
  NOT: ([value]) => !toBool(scalar(value)),
  LEN: ([value]) => toText(scalar(value)).length,
  UPPER: ([value]) => toText(scalar(value)).toUpperCase(),
  LOWER: ([value]) => toText(scalar(value)).toLowerCase(),
  TRIM: ([value]) => toText(scalar(value)).trim().replace(/\s+/g, ' '),
  CONCAT: args => args.flatMap(cellsOf).map(toText).join(''),
  LEFT: ([value, count]) => toText(scalar(value)).slice(0, Math.max(0, toNumber(scalar(count ?? 1)))),
  RIGHT: ([value, count]) => { const text = toText(scalar(value)), n = Math.max(0, toNumber(scalar(count ?? 1))); return n ? text.slice(-n) : ''; },
  MID: ([value, from, count]) => { const start = toNumber(scalar(from)); if (start < 1) fail('#VALUE!'); return toText(scalar(value)).slice(start - 1, start - 1 + Math.max(0, toNumber(scalar(count)))); },
  TODAY: (_, context) => context.today,
  DATE: ([year, month, day]) => isoDay(Math.round(Date.UTC(toNumber(scalar(year)), toNumber(scalar(month)) - 1, toNumber(scalar(day))) / 86400000)),
  DAYS: ([end, start]) => dayNumber(scalar(end)) - dayNumber(scalar(start)),
  YEAR: ([value]) => Number(isoDay(dayNumber(scalar(value))).slice(0, 4)),
  MONTH: ([value]) => Number(isoDay(dayNumber(scalar(value))).slice(5, 7)),
  DAY: ([value]) => Number(isoDay(dayNumber(scalar(value))).slice(8, 10)),
  ISBLANK: ([value]) => scalar(value) === null,
  ISNUMBER: ([value]) => typeof scalar(value) === 'number',
  ISTEXT: ([value]) => typeof scalar(value) === 'string',
  MATCH: ([value, range, kind]) => {
    const target = scalar(value), cells = cellsOf(range), exact = kind === undefined || kind === null ? false : toNumber(scalar(kind)) === 0;
    if (exact || typeof target === 'string') { const index = cells.findIndex(cell => cell !== null && compareValues(cell, target) === 0); return index < 0 ? fail('#N/A') : index + 1; }
    let found = -1;
    cells.forEach((cell, index) => { if (cell !== null && typeof cell === typeof target && compareValues(cell, target) <= 0) found = index; });
    return found < 0 ? fail('#N/A') : found + 1;
  },
  INDEX: ([range, row, col]) => {
    if (!isRange(range)) return range;
    const r = toNumber(scalar(row ?? 1)), c = toNumber(scalar(col ?? 1)), cells = range.cells;
    const rowIndex = cells.length === 1 && col === undefined ? 1 : r, colIndex = cells.length === 1 && col === undefined ? r : c;
    return cells[rowIndex - 1]?.[colIndex - 1] ?? (rowIndex >= 1 && rowIndex <= cells.length && colIndex >= 1 ? null : fail('#REF!'));
  },
  VLOOKUP: ([value, range, col, approximate]) => {
    if (!isRange(range)) fail('#N/A');
    const target = scalar(value), c = toNumber(scalar(col)), exact = approximate !== undefined && approximate !== null && !toBool(scalar(approximate));
    if (c < 1 || c > (range.cells[0]?.length ?? 0)) fail('#REF!');
    let row = exact || typeof target === 'string' ? range.cells.find(line => line[0] !== null && compareValues(line[0], target) === 0) : null;
    if (!exact && typeof target !== 'string') for (const line of range.cells) if (typeof line[0] === 'number' && line[0] <= target) row = line;
    return row ? row[c - 1] ?? null : fail('#N/A');
  },
};
const ALIASES = { AVG: 'AVERAGE', CONCATENATE: 'CONCAT', STDEV_S: 'STDEV', 'STDEV.S': 'STDEV' };
const LAZY = {
  IF: ([test, yes, no], run) => (toBool(scalar(run(test))) ? (yes ? run(yes) : true) : (no ? run(no) : false)),
  IFERROR: ([value, fallback], run) => { try { const result = scalar(run(value)); if (result instanceof SheetError) return run(fallback); return result; } catch (error) { if (error instanceof SheetError) return run(fallback); throw error; } },
};
export const SHEET_FUNCTIONS = [...Object.keys(FUNCTIONS), ...Object.keys(LAZY)].sort();

// Works out every cell of a book on demand, remembering each answer. A formula that leads back to itself is #CYCLE!.
export function evaluateBook(book, { today = localToday() } = {}) {
  const sheets = book.sheets, byName = new Map(sheets.map((sheet, index) => [sheet.name.toLowerCase(), index]));
  const results = sheets.map(() => new Map()), working = new Set(), trees = new Map();
  const context = { today };
  const sheetIndex = (name, own) => { if (name === null) return own; const index = byName.get(name.toLowerCase()); return index === undefined ? fail('#REF!') : index; };
  function literal(raw) {
    if (typeof raw === 'string' && raw.startsWith("'")) return raw.slice(1);
    return raw ?? null;
  }
  function value(si, row, col) {
    const key = row * 256 + col, done = results[si]?.get(key);
    if (done !== undefined) return done;
    const raw = sheets[si]?.rows[row]?.[col] ?? null;
    let out;
    if (typeof raw === 'string' && raw.length > 1 && raw.startsWith('=')) {
      const id = `${si}:${key}`;
      if (working.has(id)) return sheetError('#CYCLE!');
      working.add(id);
      try {
        let tree = trees.get(raw);
        if (!tree) { tree = parse(raw.slice(1)); trees.set(raw, tree); }
        out = scalar(run(tree, si));
        if (out === null) out = 0;
        if (typeof out === 'number' && !Number.isFinite(out)) out = sheetError('#NUM!');
      } catch (error) {
        out = error instanceof SheetError ? error : sheetError('#ERROR!');
      } finally { working.delete(id); }
    } else out = literal(raw);
    results[si]?.set(key, out);
    return out;
  }
  function range(si, a, b) {
    const sheet = sheets[si], last = Math.max(0, sheet.rows.length - 1);
    const r1 = a.row ?? 0, r2 = b ? b.row ?? last : r1, c1 = a.col, c2 = b ? b.col : c1;
    const [top, bottom, left, right] = [Math.min(r1, r2), Math.min(Math.max(r1, r2), SHEET_LIMITS.rows - 1), Math.min(c1, c2), Math.min(Math.max(c1, c2), SHEET_LIMITS.cols - 1)];
    if ((bottom - top + 1) * (right - left + 1) > 250000) fail('#VALUE!');
    const cells = [];
    for (let r = top; r <= bottom; r++) { const line = []; for (let c = left; c <= right; c++) line.push(value(si, r, c)); cells.push(line); }
    return { cells };
  }
  function run(node, si) {
    const again = child => run(child, si);
    switch (node.t) {
      case 'val': return node.v;
      case 'ref': { const target = sheetIndex(node.sheet, si); return node.b || node.a.row === null ? range(target, node.a, node.b) : value(target, node.a.row, node.a.col); }
      case 'neg': return -toNumber(scalar(again(node.a)));
      case 'pct': return toNumber(scalar(again(node.a))) / 100;
      case 'bin': {
        const a = scalar(again(node.a)), b = scalar(again(node.b));
        if (a instanceof SheetError) throw a;
        if (b instanceof SheetError) throw b;
        switch (node.op) {
          case '+': return toNumber(a) + toNumber(b);
          case '-': return toNumber(a) - toNumber(b);
          case '*': return toNumber(a) * toNumber(b);
          case '/': { const d = toNumber(b); return d === 0 ? fail('#DIV/0!') : toNumber(a) / d; }
          case '^': return toNumber(a) ** toNumber(b);
          case '&': return toText(a) + toText(b);
          default: { const order = compareValues(a, b); return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[node.op]; }
        }
      }
      case 'fn': {
        const name = ALIASES[node.name] || node.name;
        if (LAZY[name]) return LAZY[name](node.args, again);
        const fn = FUNCTIONS[name];
        if (!fn) fail('#NAME?');
        const args = node.args.map(arg => { const result = again(arg); if (result instanceof SheetError && !['ISBLANK', 'ISNUMBER', 'ISTEXT'].includes(name)) throw result; return result; });
        return fn(args, context);
      }
      default: return fail('#ERROR!');
    }
  }
  return { value, sheetIndex: name => byName.get(String(name).toLowerCase()) };
}
// What a cell shows.
export function displayValue(value) {
  if (value instanceof SheetError) return value.code;
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}
// What someone typed into a cell: a number, TRUE or FALSE, a formula, or text.
export function typedValue(text) {
  const value = String(text ?? '');
  if (!value.trim()) return null;
  if (value.startsWith('=')) return value.slice(0, SHEET_LIMITS.cell);
  const trimmed = value.trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toUpperCase() === 'TRUE';
  return value.slice(0, SHEET_LIMITS.cell);
}
// The text to edit for a stored cell.
export const editText = raw => (raw === null || raw === undefined ? '' : typeof raw === 'boolean' ? (raw ? 'TRUE' : 'FALSE') : typeof raw === 'number' ? formatNumber(raw) : String(raw));

// --- Sorting and filtering, which only change what's shown --------------------------------------------------------------

// "> 50", "<= 2026-12-01", "=done" or words a cell contains.
export function filterTest(spec) {
  const text = String(spec ?? '').trim();
  if (!text) return () => true;
  const match = /^(<=|>=|<>|<|>|=)\s*(.+)$/.exec(text);
  if (!match) { const words = text.toLowerCase(); return value => displayValue(value).toLowerCase().includes(words); }
  const [, op, operand] = match, number = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(operand.trim()) ? Number(operand) : null;
  return value => {
    let order;
    if (number !== null) { if (typeof value !== 'number') return op === '<>'; order = value - number; }
    else { const shown = displayValue(value).toLowerCase(), target = operand.trim().toLowerCase(); order = shown < target ? -1 : shown > target ? 1 : 0; }
    return { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[op];
  };
}
// The rows to show, in order: the first row stays as the headings, the rest are filtered then sorted. Blanks sort last.
export function visibleRows(sheet, valueAt, count = sheet.rows.length) {
  const rows = [];
  const tests = Object.entries(sheet.filters || {}).map(([col, spec]) => [Number(col), filterTest(spec)]);
  for (let row = 1; row < count; row++) if (tests.every(([col, test]) => test(valueAt(row, col)))) rows.push(row);
  if (sheet.sort) {
    const { col, desc } = sheet.sort;
    rows.sort((a, b) => {
      const x = valueAt(a, col), y = valueAt(b, col), blankX = x === null || x === '', blankY = y === null || y === '';
      if (blankX || blankY) return blankX === blankY ? a - b : blankX ? 1 : -1;
      return (desc ? -1 : 1) * compareValues(x instanceof SheetError ? x.code : x, y instanceof SheetError ? y.code : y) || a - b;
    });
  }
  return count > 0 ? [0, ...rows] : rows;
}

// --- Inserting and deleting rows and columns ----------------------------------------------------------------------------

function cellText(cell) { return `${cell.colAbs ? '$' : ''}${colName(cell.col)}${cell.row === null ? '' : `${cell.rowAbs ? '$' : ''}${cell.row + 1}`}`; }
// Rewrites the references in one formula. change(sheetName, token) returns new text for a reference, or undefined to keep it.
function rewrite(formula, change) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;
  let tokens;
  try { tokens = tokenize(formula.slice(1)); } catch { return formula; }
  let out = '=', at = 0;
  const src = formula.slice(1);
  for (const token of tokens) {
    if (token.type !== 'ref') continue;
    const next = change(token);
    if (next === undefined) continue;
    out += src.slice(at, token.start) + next; at = token.end;
  }
  return out + src.slice(at);
}
// Moves references when rows or columns are inserted (delta > 0) or deleted (delta < 0) at index `at` of one sheet.
function shiftIndex(index, at, delta) {
  if (delta > 0) return index >= at ? index + delta : index;
  const count = -delta;
  if (index >= at && index < at + count) return null;
  return index >= at + count ? index - count : index;
}
export function shiftFormula(formula, { ownSheet, target, axis, at, delta }) {
  const key = axis === 'row' ? 'row' : 'col';
  return rewrite(formula, token => {
    if ((token.sheet ?? ownSheet).toLowerCase() !== target.toLowerCase()) return undefined;
    if (token.a[key] === null) return undefined;
    const a = { ...token.a }, b = token.b ? { ...token.b } : null;
    if (!b) { const moved = shiftIndex(a[key], at, delta); if (moved === null) return '#REF!'; a[key] = moved; }
    else {
      let lo = Math.min(a[key], b[key]), hi = Math.max(a[key], b[key]);
      if (delta > 0) { if (lo >= at) lo += delta; if (hi >= at) hi += delta; }
      else {
        const count = -delta;
        if (lo >= at && hi < at + count) return '#REF!';
        lo = lo < at ? lo : lo >= at + count ? lo - count : at;
        hi = hi < at ? hi : hi >= at + count ? hi - count : at - 1;
      }
      const flip = a[key] > b[key];
      a[key] = flip ? hi : lo; b[key] = flip ? lo : hi;
    }
    return `${token.prefix}${cellText(a)}${b ? `:${cellText(b)}` : ''}`;
  });
}
export function sheetPrefix(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`; }
export function renameInFormula(formula, from, to) {
  return rewrite(formula, token => (token.sheet !== null && token.sheet.toLowerCase() === from.toLowerCase() ? `${sheetPrefix(to)}${cellText(token.a)}${token.b ? `:${cellText(token.b)}` : ''}` : undefined));
}
const eachFormula = (book, fn) => { for (const sheet of book.sheets) sheet.rows = sheet.rows.map(row => row.map(cell => fn(cell, sheet))); };
// Changes a book in place: inserts (count > 0) or deletes (count < 0) rows or columns, and keeps every formula pointing at the same cells.
export function shiftBook(book, sheetIndex, axis, at, delta) {
  const sheet = book.sheets[sheetIndex];
  if (!sheet || !delta) return book;
  if (axis === 'row') {
    if (delta > 0) sheet.rows.splice(Math.min(at, sheet.rows.length), 0, ...Array.from({ length: Math.max(0, Math.min(delta, SHEET_LIMITS.rows - sheet.rows.length)) }, () => []));
    else sheet.rows.splice(at, -delta);
  } else {
    sheet.rows = sheet.rows.map(row => {
      const copy = [...row];
      if (delta > 0) { if (at < copy.length) copy.splice(at, 0, ...Array(delta).fill(null)); }
      else copy.splice(at, -delta);
      return copy.slice(0, SHEET_LIMITS.cols);
    });
    if (sheet.widths) { const widths = [...sheet.widths]; if (delta > 0) { if (at < widths.length) widths.splice(at, 0, ...Array(delta).fill(null)); } else widths.splice(at, -delta); sheet.widths = widths; }
    if (sheet.sort) { const moved = shiftIndex(sheet.sort.col, at, delta); if (moved === null) delete sheet.sort; else sheet.sort.col = moved; }
    if (sheet.filters) { const filters = {}; for (const [col, spec] of Object.entries(sheet.filters)) { const moved = shiftIndex(Number(col), at, delta); if (moved !== null) filters[moved] = spec; } sheet.filters = filters; }
  }
  eachFormula(book, (cell, own) => shiftFormula(cell, { ownSheet: own.name, target: sheet.name, axis, at, delta }));
  return book;
}
export function renameSheet(book, sheetIndex, name) {
  const sheet = book.sheets[sheetIndex], clean = cleanSheetName(name, sheet.name);
  if (book.sheets.some((other, index) => index !== sheetIndex && other.name.toLowerCase() === clean.toLowerCase())) return false;
  const from = sheet.name;
  eachFormula(book, cell => renameInFormula(cell, from, clean));
  sheet.name = clean;
  return true;
}

// --- CSV ----------------------------------------------------------------------------------------------------------------

// Commas, semicolons or tabs, whichever the first line uses most (tabs win a tie); quotes as RFC 4180 has them.
export function parseCSV(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = ['\t', ';', ','].reduce((best, candidate) => (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best), '\t');
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') { if (source[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// A file's text becomes values, and anything that looks like a formula stays as text.
export function csvRows(text) {
  return parseCSV(text).slice(0, SHEET_LIMITS.rows).map(row => row.slice(0, SHEET_LIMITS.cols).map(field => {
    const value = typedValue(field);
    return typeof value === 'string' && /^[=']/.test(value) ? `'${value}` : value;
  }));
}
// The values a sheet shows, not its formulas. Text that a spreadsheet app would run as a formula gets a leading apostrophe.
export function toCSV(rows) {
  return rows.map(row => row.map(value => {
    let text = displayValue(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n') + '\r\n';
}
export function sheetCSV(book, name, options) {
  const index = Math.max(0, book.sheets.findIndex(sheet => sheet.name.toLowerCase() === String(name ?? '').toLowerCase()));
  const sheet = book.sheets[index], values = evaluateBook(book, options), width = Math.max(0, ...sheet.rows.map(row => row.length));
  return toCSV(sheet.rows.map((_, row) => Array.from({ length: width }, (_, col) => values.value(index, row, col))));
}
// A new sheet from a file, named after it and not clashing with the others.
export function addSheet(book, name, rows) {
  const base = cleanSheetName(name, 'Imported').slice(0, SHEET_LIMITS.name - 4);
  let clean = base;
  for (let n = 2; book.sheets.some(sheet => sheet.name.toLowerCase() === clean.toLowerCase()); n++) clean = `${base} ${n}`;
  if (book.sheets.length >= SHEET_LIMITS.sheets) throw new Error(`A sheet holds at most ${SHEET_LIMITS.sheets} tabs.`);
  const emptyFirst = book.sheets.length === 1 && !book.sheets[0].rows.length;
  const sheet = cleanBook({ sheets: [{ name: clean, rows }] }).sheets[0];
  book.sheets = emptyFirst ? [sheet] : [...book.sheets, sheet];
  return sheet.name;
}
