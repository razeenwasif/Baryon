// A sheet: named grids of cells, with formulas worked out by a small evaluator of Fairy's own (nothing is run with eval).
// This file runs in Node and, copied in, inside a sheet's page, so it imports nothing and only exports functions and constants.

export type CellValue = number | string | boolean | null;
export interface SheetError {
  readonly code: string;
  toString(): string;
}
export type EvaluatedValue = CellValue | SheetError;
export interface SheetSort {
  col: number;
  desc: boolean;
}
export interface SheetData {
  name: string;
  rows: CellValue[][];
  widths?: (number | null)[];
  sort?: SheetSort;
  filters?: Record<number, string>;
}
export interface SheetBook {
  sheets: SheetData[];
}
export interface EvaluateOptions {
  today?: string;
}
export interface EvaluatedBook {
  value: (si: number, row: number, col: number) => EvaluatedValue;
  sheetIndex: (name: string) => number | undefined;
}
export interface SheetView {
  rows: readonly unknown[];
  sort?: SheetSort;
  filters?: Record<number, string>;
}
export interface ShiftFormulaOptions {
  ownSheet: string;
  target: string;
  axis: 'row' | 'col';
  at: number;
  delta: number;
}

export const SHEET_LIMITS = { sheets: 20, rows: 5000, cols: 200, cell: 5000, name: 40, filter: 100 } as const;

export function colName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function colIndex(name: string): number {
  let n = 0;
  for (const letter of String(name).toUpperCase()) n = n * 26 + letter.charCodeAt(0) - 64;
  return n - 1;
}
export const cellName = (row: number, col: number): string => `${colName(col)}${row + 1}`;

// --- Cleaning what a model, a file or the page hands over -------------------------------------------------------------

function cleanCell(value: unknown): CellValue {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const obj = value as { formula?: unknown; value?: unknown };
    return cleanCell(obj.formula ?? obj.value ?? null);
  }
  return String(value).replace(/\r\n?/g, '\n').slice(0, SHEET_LIMITS.cell);
}
// Names can't hold the characters references use, so 'Exam dates'!B2 always means one sheet.
export function cleanSheetName(value: unknown, fallback = 'Sheet1'): string {
  return String(value ?? '').replace(/[\u0000-\u001f!'"[\]:*?/\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, SHEET_LIMITS.name) || fallback;
}
function trimRows(rows: CellValue[][]): CellValue[][] {
  const kept = rows.map(row => { const copy = [...row]; while (copy.length && copy.at(-1) === null) copy.pop(); return copy; });
  while (kept.length && !kept.at(-1)?.length) kept.pop();
  return kept;
}
// Accepts { sheets: [...] }, one sheet { rows }, or a bare grid, and keeps everything within the limits.
export function cleanBook(value: unknown): SheetBook {
  const input = value as { sheets?: unknown; rows?: unknown } | null | undefined;
  const list: unknown[] = Array.isArray(input?.sheets) ? input.sheets : Array.isArray(input?.rows) ? [input] : Array.isArray(value) ? [{ rows: value }] : [];
  const sheets: SheetData[] = [], names = new Set<string>();
  for (const rawSheet of list) {
    if (sheets.length >= SHEET_LIMITS.sheets) break;
    const sheet = (rawSheet && typeof rawSheet === 'object' ? rawSheet : {}) as {
      name?: unknown;
      rows?: unknown;
      widths?: unknown;
      sort?: { col?: unknown; desc?: unknown } | null;
      filters?: unknown;
    };
    let name = cleanSheetName(sheet?.name, `Sheet${sheets.length + 1}`);
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${cleanSheetName(sheet?.name, 'Sheet').slice(0, SHEET_LIMITS.name - 4)} ${n}`;
    names.add(name.toLowerCase());
    const rows = trimRows((Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, SHEET_LIMITS.rows).map(row => (Array.isArray(row) ? row : [row]).slice(0, SHEET_LIMITS.cols).map(cleanCell)));
    const clean: SheetData = { name, rows };
    if (Array.isArray(sheet?.widths)) {
      const widths = sheet.widths.slice(0, SHEET_LIMITS.cols).map(width => (Number.isFinite(Number(width)) && Number(width) > 0 ? Math.min(600, Math.max(40, Math.round(Number(width)))) : null));
      if (widths.some(Boolean)) clean.widths = widths;
    }
    const sortCol = Number(sheet?.sort?.col);
    if (Number.isInteger(sortCol) && sortCol >= 0 && sortCol < SHEET_LIMITS.cols) clean.sort = { col: sortCol, desc: sheet.sort?.desc === true };
    if (sheet?.filters && typeof sheet.filters === 'object') {
      const filters: Record<number, string> = {};
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
export const bookIsEmpty = (book: SheetBook): boolean => book.sheets.every(sheet => !sheet.rows.length);
// One row to a line, so a model reading it back (or a person) can see the grid.
export function bookJSON(book: SheetBook): string {
  const sheet = ({ rows, ...rest }: SheetData): string => `{${JSON.stringify(rest).slice(1, -1)},"rows":[${rows.length ? `\n${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n ` : ''}]}`;
  return `{"sheets":[\n ${book.sheets.map(sheet).join(',\n ')}\n]}\n`;
}

// --- Formulas ---------------------------------------------------------------------------------------------------------

interface CellRef {
  col: number;
  colAbs: boolean;
  row: number | null;
  rowAbs: boolean;
}
type Token =
  | { type: 'str'; value: string; start: number; end: number }
  | { type: 'err'; code: string; start: number; end: number }
  | { type: 'num'; value: number; start: number; end: number }
  | { type: 'ref'; sheet: string | null; a: CellRef; b: CellRef | null; start: number; end: number; prefix: string }
  | { type: 'fn'; name: string; start: number; end: number }
  | { type: 'bool'; value: boolean; start: number; end: number }
  | { type: 'op'; value: string; start: number; end: number }
  | { type: '(' | ')' | ','; value: string; start: number; end: number };
type RefToken = Extract<Token, { type: 'ref' }>;
type AstNode =
  | { t: 'val'; v: EvaluatedValue }
  | { t: 'ref'; sheet: string | null; a: CellRef; b: CellRef | null }
  | { t: 'pct'; a: AstNode }
  | { t: 'neg'; a: AstNode }
  | { t: 'bin'; op: string; a: AstNode; b: AstNode }
  | { t: 'fn'; name: string; args: AstNode[] };

class SheetErrorImpl implements SheetError {
  readonly code: string;
  constructor(code: string) { this.code = code; }
  toString(): string { return this.code; }
}
export const sheetError = (code: string): SheetError => new SheetErrorImpl(code);
export const isSheetError = (value: unknown): value is SheetError => value instanceof SheetErrorImpl;
function fail(code: string): never { throw new SheetErrorImpl(code); }
const ERRORS = ['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#ERROR!', '#CYCLE!'] as const;

// A cell or column reference at i: $A$1, B2, or a whole column (C) when rows are optional.
function readCell(src: string, i: number, rowOptional: boolean): { cell: CellRef; end: number } | null {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})?(?![A-Za-z0-9_(])/.exec(src.slice(i));
  if (!match || (!match[4] && (!rowOptional || match[3]))) return null;
  const cell: CellRef = { col: colIndex(match[2]), colAbs: Boolean(match[1]), row: match[4] ? Number(match[4]) - 1 : null, rowAbs: Boolean(match[3]) };
  if (cell.row !== null && cell.row < 0) return null;
  return { cell, end: i + match[0].length };
}
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
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
    let sheet: string | null = null, j = i;
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
        const a = first.cell;
        let b: CellRef | null = null, end = first.end;
        if (src[end] === ':') { const second = readCell(src, end + 1, a.row === null); if (second && (second.cell.row === null) === (a.row === null)) { b = second.cell; end = second.end; } }
        if (a.row !== null || b) { i = end; tokens.push({ type: 'ref', sheet, a, b, start, end, prefix: src.slice(start, j) }); continue; }
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
function parse(src: string): AstNode {
  const tokens = tokenize(src);
  let at = 0;
  const peek = (): Token | undefined => tokens[at], take = (): Token | undefined => tokens[at++];
  const isOp = (...ops: string[]): boolean => { const t = peek(); return t?.type === 'op' && ops.includes(t.value); };
  const binary = (next: () => AstNode, ops: string[]): (() => AstNode) => () => {
    let node = next();
    while (isOp(...ops)) {
      const op = (take() as Extract<Token, { type: 'op' }>).value;
      node = { t: 'bin', op, a: node, b: next() };
    }
    return node;
  };
  const primary = (): AstNode => {
    const token = take();
    if (!token) fail('#ERROR!');
    if (token.type === 'num' || token.type === 'str' || token.type === 'bool') return { t: 'val', v: token.value };
    if (token.type === 'err') return { t: 'val', v: sheetError(token.code) };
    if (token.type === 'ref') return { t: 'ref', sheet: token.sheet, a: token.a, b: token.b };
    if (token.type === '(') { const node = compare(); if (take()?.type !== ')') fail('#ERROR!'); return node; }
    if (token.type === 'fn') {
      take();
      const args: AstNode[] = [];
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
  const postfix = (): AstNode => { let node = primary(); while (isOp('%')) { take(); node = { t: 'pct', a: node }; } return node; };
  const unary = (): AstNode => { if (isOp('-', '+')) { const op = (take() as Extract<Token, { type: 'op' }>).value; const a = unary(); return op === '-' ? { t: 'neg', a } : a; } return postfix(); };
  const power = binary(unary, ['^']), product = binary(power, ['*', '/']), sum = binary(product, ['+', '-']), join = binary(sum, ['&']), compare: () => AstNode = binary(join, ['=', '<>', '<', '>', '<=', '>=']);
  const tree = compare();
  if (at < tokens.length) fail('#ERROR!');
  return tree;
}

// --- Values -----------------------------------------------------------------------------------------------------------

interface CellRange {
  cells: EvaluatedValue[][];
}
type FormulaValue = EvaluatedValue | CellRange;
interface EvalContext {
  today: string;
}
type SheetFn = (args: FormulaValue[], context: EvalContext) => FormulaValue;
type LazyFn = (args: AstNode[], run: (node: AstNode) => FormulaValue) => FormulaValue;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function toNumber(value: EvaluatedValue): number {
  if (value instanceof SheetErrorImpl) throw value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === '') return 0;
  const text = String(value).trim().replace(/,/g, '');
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)) return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  return fail('#VALUE!');
}
function toText(value: EvaluatedValue): string {
  if (value instanceof SheetErrorImpl) throw value;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}
function toBool(value: EvaluatedValue): boolean {
  if (value instanceof SheetErrorImpl) throw value;
  if (typeof value === 'boolean') return value;
  if (value === null) return false;
  if (typeof value === 'number') return value !== 0;
  const upper = String(value).trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return fail('#VALUE!');
}
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '#NUM!';
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return String(Number(value.toPrecision(12)));
}
function dayNumber(value: EvaluatedValue): number {
  const match = DATE.exec(String(value ?? '').trim().slice(0, 10));
  if (!match) return fail('#VALUE!');
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}
const isoDay = (days: number): string => new Date(days * 86400000).toISOString().slice(0, 10);
function localToday(): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
// Numbers before text before TRUE/FALSE, as in Excel; text compares without case.
function compareValues(a: EvaluatedValue, b: EvaluatedValue): number {
  const rank = (value: EvaluatedValue): number => (typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2);
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') { const x = a.toLowerCase(), y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'number') return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
  return (a as boolean) < (b as boolean) ? -1 : (a as boolean) > (b as boolean) ? 1 : 0;
}
// "> 5", "<>done", "a*" and plain values, as COUNTIF and its kin take them.
function criterion(spec: EvaluatedValue): (value: EvaluatedValue) => boolean {
  if (spec instanceof SheetErrorImpl) throw spec;
  if (typeof spec !== 'string') return value => value !== null && compareValues(value, spec) === 0;
  const [, op = '=', rest] = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(spec)!;
  const numeric = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(rest) ? Number(rest) : null;
  const target: number | string = numeric ?? rest;
  if (typeof target === 'string' && (op === '=' || op === '<>')) {
    const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'is');
    const test = (value: EvaluatedValue): boolean => (value === null ? target === '' : typeof value === 'string' ? pattern.test(value) : pattern.test(toText(value)));
    return op === '=' ? test : value => !test(value);
  }
  return value => {
    if (value === null || value instanceof SheetErrorImpl || (typeof target === 'number') !== (typeof value === 'number')) return op === '<>';
    const order = compareValues(value, target);
    const cmp: Record<string, boolean> = { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 };
    return cmp[op] ?? false;
  };
}
const isRange = (value: FormulaValue): value is CellRange => Boolean(value && typeof value === 'object' && 'cells' in value && Array.isArray(value.cells));
const cellsOf = (value: FormulaValue): EvaluatedValue[] => (isRange(value) ? value.cells.flat() : [value]);
// Numbers from ranges skip text and blanks; numbers typed straight in must be numbers.
function numbers(args: FormulaValue[]): number[] {
  const out: number[] = [];
  for (const arg of args) {
    if (isRange(arg)) { for (const value of arg.cells.flat()) { if (value instanceof SheetErrorImpl) throw value; if (typeof value === 'number') out.push(value); } }
    else if (arg !== null) out.push(toNumber(arg));
  }
  return out;
}
const scalar = (value: FormulaValue): EvaluatedValue => (isRange(value) ? (value.cells.length === 1 && value.cells[0].length === 1 ? value.cells[0][0] : fail('#VALUE!')) : value);
const roundTo = (value: number, digits: number, how: (n: number) => number): number => { const factor = 10 ** digits, scaled = value * factor; return how(Number(scaled.toPrecision(15))) / factor; };
const median = (list: number[]): number => { const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const nonEmpty = (list: number[]): number[] => (list.length ? list : fail('#DIV/0!'));
const pairsIf = (range: FormulaValue, test: (value: EvaluatedValue) => boolean, other?: FormulaValue): EvaluatedValue[] => { const cells = cellsOf(range), values = other ? cellsOf(other) : cells; return values.filter((_, index) => test(cells[index] ?? null)); };

const FUNCTIONS: Record<string, SheetFn> = {
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
  MATCH: ([value, range, kind]: (FormulaValue | undefined)[]) => {
    const target = scalar(value ?? null), cells = cellsOf(range ?? null), exact = kind === undefined || kind === null ? false : toNumber(scalar(kind)) === 0;
    if (exact || typeof target === 'string') { const index = cells.findIndex(cell => cell !== null && compareValues(cell, target) === 0); return index < 0 ? fail('#N/A') : index + 1; }
    let found = -1;
    cells.forEach((cell, index) => { if (cell !== null && typeof cell === typeof target && compareValues(cell, target) <= 0) found = index; });
    return found < 0 ? fail('#N/A') : found + 1;
  },
  INDEX: ([range, row, col]: (FormulaValue | undefined)[]) => {
    if (!range || !isRange(range)) return range ?? null;
    const r = toNumber(scalar(row ?? 1)), c = toNumber(scalar(col ?? 1)), cells = range.cells;
    const rowIndex = cells.length === 1 && col === undefined ? 1 : r, colIndex = cells.length === 1 && col === undefined ? r : c;
    return cells[rowIndex - 1]?.[colIndex - 1] ?? (rowIndex >= 1 && rowIndex <= cells.length && colIndex >= 1 ? null : fail('#REF!'));
  },
  VLOOKUP: ([value, range, col, approximate]: (FormulaValue | undefined)[]) => {
    if (!range || !isRange(range)) fail('#N/A');
    const target = scalar(value ?? null), c = toNumber(scalar(col ?? null)), exact = approximate !== undefined && approximate !== null && !toBool(scalar(approximate));
    if (c < 1 || c > (range.cells[0]?.length ?? 0)) fail('#REF!');
    let row = exact || typeof target === 'string' ? range.cells.find(line => line[0] !== null && compareValues(line[0], target) === 0) : null;
    if (!exact && typeof target !== 'string') for (const line of range.cells) if (typeof line[0] === 'number' && line[0] <= (target as number)) row = line;
    return row ? row[c - 1] ?? null : fail('#N/A');
  },
};
const ALIASES: Record<string, string> = { AVG: 'AVERAGE', CONCATENATE: 'CONCAT', STDEV_S: 'STDEV', 'STDEV.S': 'STDEV' };
const LAZY: Record<string, LazyFn> = {
  IF: ([test, yes, no]: (AstNode | undefined)[], run) => (test && toBool(scalar(run(test))) ? (yes ? run(yes) : true) : (no ? run(no) : false)),
  IFERROR: ([value, fallback]: (AstNode | undefined)[], run) => { try { const result = value ? scalar(run(value)) : fail('#ERROR!'); if (result instanceof SheetErrorImpl) return fallback ? run(fallback) : fail('#ERROR!'); return result; } catch (error) { if (error instanceof SheetErrorImpl) return fallback ? run(fallback) : fail('#ERROR!'); throw error; } },
};
export const SHEET_FUNCTIONS = [...Object.keys(FUNCTIONS), ...Object.keys(LAZY)].sort();

// Works out every cell of a book on demand, remembering each answer. A formula that leads back to itself is #CYCLE!.
export function evaluateBook(book: SheetBook, { today = localToday() }: EvaluateOptions = {}): EvaluatedBook {
  const sheets = book.sheets, byName = new Map(sheets.map((sheet, index) => [sheet.name.toLowerCase(), index]));
  const results: Map<number, EvaluatedValue>[] = sheets.map(() => new Map()), working = new Set<string>(), trees = new Map<string, AstNode>();
  const context: EvalContext = { today };
  const sheetIndex = (name: string | null, own: number): number => { if (name === null) return own; const index = byName.get(name.toLowerCase()); return index === undefined ? fail('#REF!') : index; };
  function literal(raw: CellValue): CellValue {
    if (typeof raw === 'string' && raw.startsWith("'")) return raw.slice(1);
    return raw ?? null;
  }
  function value(si: number, row: number, col: number): EvaluatedValue {
    const key = row * 256 + col, done = results[si]?.get(key);
    if (done !== undefined) return done;
    const raw = sheets[si]?.rows[row]?.[col] ?? null;
    let out: EvaluatedValue;
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
        out = error instanceof SheetErrorImpl ? error : sheetError('#ERROR!');
      } finally { working.delete(id); }
    } else out = literal(raw);
    results[si]?.set(key, out);
    return out;
  }
  function range(si: number, a: CellRef, b: CellRef | null): CellRange {
    const sheet = sheets[si], last = Math.max(0, (sheet?.rows.length ?? 0) - 1);
    const r1 = a.row ?? 0, r2 = b ? b.row ?? last : r1, c1 = a.col, c2 = b ? b.col : c1;
    const [top, bottom, left, right] = [Math.min(r1, r2), Math.min(Math.max(r1, r2), SHEET_LIMITS.rows - 1), Math.min(c1, c2), Math.min(Math.max(c1, c2), SHEET_LIMITS.cols - 1)];
    if ((bottom - top + 1) * (right - left + 1) > 250000) fail('#VALUE!');
    const cells: EvaluatedValue[][] = [];
    for (let r = top; r <= bottom; r++) { const line: EvaluatedValue[] = []; for (let c = left; c <= right; c++) line.push(value(si, r, c)); cells.push(line); }
    return { cells };
  }
  function run(node: AstNode, si: number): FormulaValue {
    const again = (child: AstNode): FormulaValue => run(child, si);
    switch (node.t) {
      case 'val': return node.v;
      case 'ref': { const target = sheetIndex(node.sheet, si); return node.b || node.a.row === null ? range(target, node.a, node.b) : value(target, node.a.row, node.a.col); }
      case 'neg': return -toNumber(scalar(again(node.a)));
      case 'pct': return toNumber(scalar(again(node.a))) / 100;
      case 'bin': {
        const a = scalar(again(node.a)), b = scalar(again(node.b));
        if (a instanceof SheetErrorImpl) throw a;
        if (b instanceof SheetErrorImpl) throw b;
        switch (node.op) {
          case '+': return toNumber(a) + toNumber(b);
          case '-': return toNumber(a) - toNumber(b);
          case '*': return toNumber(a) * toNumber(b);
          case '/': { const d = toNumber(b); return d === 0 ? fail('#DIV/0!') : toNumber(a) / d; }
          case '^': return toNumber(a) ** toNumber(b);
          case '&': return toText(a) + toText(b);
          default: { const order = compareValues(a, b); const cmp: Record<string, boolean> = { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }; return cmp[node.op] ?? false; }
        }
      }
      case 'fn': {
        const name = ALIASES[node.name] || node.name;
        const lazy = LAZY[name];
        if (lazy) return lazy(node.args, again);
        const fn = FUNCTIONS[name];
        if (!fn) fail('#NAME?');
        const args = node.args.map(arg => { const result = again(arg); if (result instanceof SheetErrorImpl && !['ISBLANK', 'ISNUMBER', 'ISTEXT'].includes(name)) throw result; return result; });
        return fn(args, context);
      }
      default: return fail('#ERROR!');
    }
  }
  return { value, sheetIndex: (name: string) => byName.get(String(name).toLowerCase()) };
}
// What a cell shows.
export function displayValue(value: EvaluatedValue | undefined): string {
  if (value instanceof SheetErrorImpl) return value.code;
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}
// What someone typed into a cell: a number, TRUE or FALSE, a formula, or text.
export function typedValue(text: unknown): CellValue {
  const value = String(text ?? '');
  if (!value.trim()) return null;
  if (value.startsWith('=')) return value.slice(0, SHEET_LIMITS.cell);
  const trimmed = value.trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toUpperCase() === 'TRUE';
  return value.slice(0, SHEET_LIMITS.cell);
}
// The text to edit for a stored cell.
export const editText = (raw: CellValue | undefined): string => (raw === null || raw === undefined ? '' : typeof raw === 'boolean' ? (raw ? 'TRUE' : 'FALSE') : typeof raw === 'number' ? formatNumber(raw) : String(raw));

// --- Sorting and filtering, which only change what's shown --------------------------------------------------------------

// "> 50", "<= 2026-12-01", "=done" or words a cell contains.
export function filterTest(spec: unknown): (value: EvaluatedValue) => boolean {
  const text = String(spec ?? '').trim();
  if (!text) return () => true;
  const match = /^(<=|>=|<>|<|>|=)\s*(.+)$/.exec(text);
  if (!match) { const words = text.toLowerCase(); return value => displayValue(value).toLowerCase().includes(words); }
  const [, op, operand] = match, number = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(operand.trim()) ? Number(operand) : null;
  return value => {
    let order: number;
    if (number !== null) { if (typeof value !== 'number') return op === '<>'; order = value - number; }
    else { const shown = displayValue(value).toLowerCase(), target = operand.trim().toLowerCase(); order = shown < target ? -1 : shown > target ? 1 : 0; }
    const cmp: Record<string, boolean> = { '=': order === 0, '<>': order !== 0, '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 };
    return cmp[op] ?? false;
  };
}
// The rows to show, in order: the first row stays as the headings, the rest are filtered then sorted. Blanks sort last.
export function visibleRows(sheet: SheetView, valueAt: (row: number, col: number) => EvaluatedValue, count = sheet.rows.length): number[] {
  const rows: number[] = [];
  const tests: [number, (value: EvaluatedValue) => boolean][] = Object.entries(sheet.filters || {}).map(([col, spec]) => [Number(col), filterTest(spec)]);
  for (let row = 1; row < count; row++) if (tests.every(([col, test]) => test(valueAt(row, col)))) rows.push(row);
  if (sheet.sort) {
    const { col, desc } = sheet.sort;
    rows.sort((a, b) => {
      const x = valueAt(a, col), y = valueAt(b, col), blankX = x === null || x === '', blankY = y === null || y === '';
      if (blankX || blankY) return blankX === blankY ? a - b : blankX ? 1 : -1;
      return (desc ? -1 : 1) * compareValues(x instanceof SheetErrorImpl ? x.code : x, y instanceof SheetErrorImpl ? y.code : y) || a - b;
    });
  }
  return count > 0 ? [0, ...rows] : rows;
}

// --- Inserting and deleting rows and columns ----------------------------------------------------------------------------

function cellText(cell: CellRef): string { return `${cell.colAbs ? '$' : ''}${colName(cell.col)}${cell.row === null ? '' : `${cell.rowAbs ? '$' : ''}${cell.row + 1}`}`; }
// Rewrites the references in one formula. change(sheetName, token) returns new text for a reference, or undefined to keep it.
function rewrite(formula: CellValue, change: (token: RefToken) => string | undefined): CellValue {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;
  let tokens: Token[];
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
function shiftIndex(index: number, at: number, delta: number): number | null {
  if (delta > 0) return index >= at ? index + delta : index;
  const count = -delta;
  if (index >= at && index < at + count) return null;
  return index >= at + count ? index - count : index;
}
export function shiftFormula(formula: string, options: ShiftFormulaOptions): string;
export function shiftFormula(formula: CellValue, options: ShiftFormulaOptions): CellValue;
export function shiftFormula(formula: CellValue, { ownSheet, target, axis, at, delta }: ShiftFormulaOptions): CellValue {
  const key = axis === 'row' ? 'row' : 'col';
  return rewrite(formula, token => {
    if ((token.sheet ?? ownSheet).toLowerCase() !== target.toLowerCase()) return undefined;
    if (token.a[key] === null) return undefined;
    const a: CellRef = { ...token.a }, b: CellRef | null = token.b ? { ...token.b } : null;
    const aVal = a[key];
    if (aVal === null) return undefined;
    if (!b) { const moved = shiftIndex(aVal, at, delta); if (moved === null) return '#REF!'; a[key] = moved; }
    else {
      const bVal = b[key];
      if (bVal === null) return undefined;
      let lo = Math.min(aVal, bVal), hi = Math.max(aVal, bVal);
      if (delta > 0) { if (lo >= at) lo += delta; if (hi >= at) hi += delta; }
      else {
        const count = -delta;
        if (lo >= at && hi < at + count) return '#REF!';
        lo = lo < at ? lo : lo >= at + count ? lo - count : at;
        hi = hi < at ? hi : hi >= at + count ? hi - count : at - 1;
      }
      const flip = aVal > bVal;
      a[key] = flip ? hi : lo; b[key] = flip ? lo : hi;
    }
    return `${token.prefix}${cellText(a)}${b ? `:${cellText(b)}` : ''}`;
  });
}
export function sheetPrefix(name: string): string { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`; }
export function renameInFormula(formula: string, from: string, to: string): string;
export function renameInFormula(formula: CellValue, from: string, to: string): CellValue;
export function renameInFormula(formula: CellValue, from: string, to: string): CellValue {
  return rewrite(formula, token => (token.sheet !== null && token.sheet.toLowerCase() === from.toLowerCase() ? `${sheetPrefix(to)}${cellText(token.a)}${token.b ? `:${cellText(token.b)}` : ''}` : undefined));
}
const eachFormula = (book: SheetBook, fn: (cell: CellValue, sheet: SheetData) => CellValue): void => { for (const sheet of book.sheets) sheet.rows = sheet.rows.map(row => row.map(cell => fn(cell, sheet))); };
// Changes a book in place: inserts (count > 0) or deletes (count < 0) rows or columns, and keeps every formula pointing at the same cells.
export function shiftBook(book: SheetBook, sheetIndex: number, axis: 'row' | 'col', at: number, delta: number): SheetBook {
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
    if (sheet.filters) { const filters: Record<number, string> = {}; for (const [col, spec] of Object.entries(sheet.filters)) { const moved = shiftIndex(Number(col), at, delta); if (moved !== null) filters[moved] = spec; } sheet.filters = filters; }
  }
  eachFormula(book, (cell, own) => shiftFormula(cell, { ownSheet: own.name, target: sheet.name, axis, at, delta }));
  return book;
}
export function renameSheet(book: SheetBook, sheetIndex: number, name: string): boolean {
  const sheet = book.sheets[sheetIndex], clean = cleanSheetName(name, sheet.name);
  if (book.sheets.some((other, index) => index !== sheetIndex && other.name.toLowerCase() === clean.toLowerCase())) return false;
  const from = sheet.name;
  eachFormula(book, cell => renameInFormula(cell, from, clean));
  sheet.name = clean;
  return true;
}

// --- CSV ----------------------------------------------------------------------------------------------------------------

// Commas, semicolons or tabs, whichever the first line uses most (tabs win a tie); quotes as RFC 4180 has them.
export function parseCSV(text: unknown): string[][] {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = ['\t', ';', ','].reduce((best, candidate) => (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best), '\t');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, i = 0;
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
export function csvRows(text: unknown): CellValue[][] {
  return parseCSV(text).slice(0, SHEET_LIMITS.rows).map(row => row.slice(0, SHEET_LIMITS.cols).map(field => {
    const value = typedValue(field);
    return typeof value === 'string' && /^[=']/.test(value) ? `'${value}` : value;
  }));
}
// The values a sheet shows, not its formulas. Text that a spreadsheet app would run as a formula gets a leading apostrophe.
export function toCSV(rows: readonly (readonly EvaluatedValue[])[]): string {
  return rows.map(row => row.map(value => {
    let text = displayValue(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n') + '\r\n';
}
export function sheetCSV(book: SheetBook, name?: string, options?: EvaluateOptions): string {
  const index = Math.max(0, book.sheets.findIndex(sheet => sheet.name.toLowerCase() === String(name ?? '').toLowerCase()));
  const sheet = book.sheets[index], values = evaluateBook(book, options), width = Math.max(0, ...sheet.rows.map(row => row.length));
  return toCSV(sheet.rows.map((_, row) => Array.from({ length: width }, (_, col) => values.value(index, row, col))));
}
// A new sheet from a file, named after it and not clashing with the others.
export function addSheet(book: SheetBook, name: unknown, rows: CellValue[][]): string {
  const base = cleanSheetName(name, 'Imported').slice(0, SHEET_LIMITS.name - 4);
  let clean = base;
  for (let n = 2; book.sheets.some(sheet => sheet.name.toLowerCase() === clean.toLowerCase()); n++) clean = `${base} ${n}`;
  if (book.sheets.length >= SHEET_LIMITS.sheets) throw new Error(`A sheet holds at most ${SHEET_LIMITS.sheets} tabs.`);
  const emptyFirst = book.sheets.length === 1 && !book.sheets[0].rows.length;
  const sheet = cleanBook({ sheets: [{ name: clean, rows }] }).sheets[0];
  book.sheets = emptyFirst ? [sheet] : [...book.sheets, sheet];
  return sheet.name;
}
