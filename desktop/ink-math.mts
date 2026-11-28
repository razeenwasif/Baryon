// A small, safe maths parser for Fairy's plots: numbers, x and y, + - * / ^, brackets, implicit products (2x, 3(x+1))
// and a fixed list of functions. Expressions are compiled to plain closures; nothing a model writes is ever run as code.
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const MAX_LENGTH = 200;

type OpTokenType = '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',';
type Token =
  | { type: 'num'; value: number }
  | { type: 'name'; value: string }
  | { type: OpTokenType };

type ExprNode = (vars: number[]) => number;

// Own keys only, so inherited names like constructor or toString are never functions or constants.
const isFunction = (name: string): boolean => Object.hasOwn(FUNCTIONS, name);
const isConstant = (name: string): boolean => Object.hasOwn(CONSTANTS, name);

function tokens(source: string): Token[] {
  const out: Token[] = [];
  const text = String(source).replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*\*/g, '^');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(i));
    if (number) { out.push({ type: 'num', value: Number(number[0]) }); i += number[0].length; continue; }
    const name = /^[a-z][a-z0-9]*/i.exec(text.slice(i));
    if (name) { out.push({ type: 'name', value: name[0].toLowerCase() }); i += name[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ type: c as OpTokenType }); i++; continue; }
    throw new Error(`Unexpected “${c}”.`);
  }
  return out;
}

// Splits names like "xy" or "2xy" that a model may write for products of variables.
function splitNames(list: Token[], vars: readonly string[]): Token[] {
  const out: Token[] = [];
  for (const token of list) {
    if (token.type === 'name' && !isFunction(token.value) && !isConstant(token.value) && !vars.includes(token.value) && [...token.value].every(ch => vars.includes(ch))) {
      [...token.value].forEach(ch => out.push({ type: 'name', value: ch }));
    } else out.push(token);
  }
  return out;
}

// compile('x^2 - 4x + 3', ['x']) -> (x) => number. Throws a plain message when the expression isn't valid.
export function compile(source: string, vars: string[] = ['x']): (...values: number[]) => number {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_LENGTH) throw new Error('Expressions are 1–200 characters.');
  const list = splitNames(tokens(source), vars);
  let at = 0;
  const peek = (): Token | undefined => list[at];
  const take = (type: Token['type']): Token => {
    if (list[at]?.type !== type) throw new Error(`Expected “${type}”.`);
    return list[at++];
  };
  const startsFactor = (token: Token | undefined): boolean => Boolean(token && (token.type === 'num' || token.type === 'name' || token.type === '('));
  // expression: term (+|- term)*; term: unary ((*|/|implicit) unary)*; unary: -unary | power; power: atom (^ unary)?
  function expression(): ExprNode {
    let node = term();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = list[at++].type, left = node, right = term();
      node = op === '+' ? v => left(v) + right(v) : v => left(v) - right(v);
    }
    return node;
  }
  function term(): ExprNode {
    let node = unary();
    for (;;) {
      const next = peek();
      if (next?.type === '*' || next?.type === '/') {
        at++;
        const left = node, right = unary();
        node = next.type === '*' ? v => left(v) * right(v) : v => left(v) / right(v);
      } else if (startsFactor(next)) {
        const left = node, right = power();
        node = v => left(v) * right(v);
      } else return node;
    }
  }
  function unary(): ExprNode {
    if (peek()?.type === '-') { at++; const inner = unary(); return v => -inner(v); }
    if (peek()?.type === '+') { at++; return unary(); }
    return power();
  }
  function power(): ExprNode {
    const base = atom();
    if (peek()?.type === '^') { at++; const exponent = unary(); return v => Math.pow(base(v), exponent(v)); }
    return base;
  }
  function atom(): ExprNode {
    const token = list[at++];
    if (!token) throw new Error('The expression ends too early.');
    if (token.type === 'num') { const value = token.value; return () => value; }
    if (token.type === '(') { const inner = expression(); take(')'); return inner; }
    if (token.type === 'name') {
      if (isFunction(token.value)) {
        const fn = FUNCTIONS[token.value]; take('(');
        const args: ExprNode[] = [expression()];
        while (peek()?.type === ',') { at++; args.push(expression()); }
        take(')');
        return v => fn(...args.map(arg => arg(v)));
      }
      if (isConstant(token.value)) { const value = CONSTANTS[token.value]; return () => value; }
      const index = vars.indexOf(token.value);
      if (index >= 0) return v => v[index];
      throw new Error(`Unknown name “${token.value}”.`);
    }
    throw new Error(`Unexpected “${token.type}”.`);
  }
  const root = expression();
  if (at !== list.length) throw new Error('Something is left over at the end.');
  return (...values: number[]) => { const value = root(values); return Number.isFinite(value) ? value : NaN; };
}

// "x + 2y <= 8" -> { test(x, y) -> bool, boundary(x, y) -> lhs - rhs }.
export function compileRule(source: string): {
  test: (x: number, y: number) => boolean;
  boundary: (x: number, y: number) => number;
  equality: boolean;
} {
  const match = /^(.*?)(<=|>=|≤|≥|<|>|=)(.*)$/.exec(String(source || ''));
  if (!match) throw new Error('A constraint needs <=, >= or =.');
  const left = compile(match[1], ['x', 'y']), right = compile(match[3], ['x', 'y']), op = match[2];
  const gap = (x: number, y: number): number => left(x, y) - right(x, y);
  const test = op === '<=' || op === '≤' || op === '<'
    ? (x: number, y: number) => gap(x, y) <= 1e-9
    : op === '>=' || op === '≥' || op === '>'
      ? (x: number, y: number) => gap(x, y) >= -1e-9
      : (x: number, y: number) => Math.abs(gap(x, y)) < 1e-9;
  return { test, boundary: gap, equality: op === '=' };
}
