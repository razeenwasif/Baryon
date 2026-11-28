// Lightweight terminal markdown, step, approval, and table formatters (zero external dependencies).
import { renderSpriteLines } from './sprite.mjs';

export interface FormatColorOptions {
  color?: boolean;
}

export interface StepRow {
  status?: string;
  tool?: string;
  summary?: string;
}

export interface ApprovalBoxOptions {
  title?: string;
  detail?: string;
  interactive?: boolean;
  color?: boolean;
}

export interface TableColumn<T = Record<string, unknown>> {
  label?: string;
  max?: number;
  get: (row: T) => unknown;
}

export interface FormatTableOptions {
  color?: boolean;
  empty?: string;
}

const ANSI = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  cyan: '\x1b[38;5;81m',
  violet: '\x1b[38;5;141m',
  mint: '\x1b[38;5;114m',
  gold: '\x1b[38;5;221m',
  coral: '\x1b[38;5;203m',
  codeBg: '\x1b[38;5;250m',
});

const style = (text: string, code: string, color: boolean): string => (color ? `${code}${text}${ANSI.reset}` : text);

function formatInline(line: string, color: boolean): string {
  if (!color) return line;
  let out = line;
  // Inline code first so asterisks inside code aren't treated as bold/italic.
  const codeSpans: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_: string, code: string) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`${ANSI.cyan}${code}${ANSI.reset}`);
    return token;
  });
  out = out.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_: string, label: string, url: string) => (
    `${ANSI.underline}${label}${ANSI.reset} ${ANSI.dim}(${url})${ANSI.reset}`
  ));
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_: string, inner: string) => `${ANSI.bold}${inner}${ANSI.reset}`);
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_: string, pre: string, inner: string) => `${pre}${ANSI.italic}${inner}${ANSI.reset}`);
  for (let i = 0; i < codeSpans.length; i++) {
    out = out.replace(`\u0000CODE${i}\u0000`, codeSpans[i]);
  }
  return out;
}

/** Formats Markdown text cleanly for terminal display, respecting `color`. */
export function formatMarkdown(text: unknown, { color = false }: FormatColorOptions = {}): string {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return '';
  const lines = raw.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      const lang = line.replace(/^\s*```/, '').trim();
      out.push(style(inFence ? `┌─ ${lang || 'code'}` : '└─', ANSI.dim, color));
      continue;
    }
    if (inFence) {
      out.push(`${style('│ ', ANSI.dim, color)}${style(line, ANSI.codeBg, color)}`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      out.push(style(heading[2].trim(), `${ANSI.bold}${ANSI.violet}`, color));
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      out.push(style('────────────────────────────────────────', ANSI.dim, color));
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      out.push(`${bullet[1]}${style('•', ANSI.cyan, color)} ${formatInline(bullet[2], color)}`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(`${style('▎', ANSI.violet, color)} ${formatInline(quote[1], color)}`);
      continue;
    }
    out.push(formatInline(line, color));
  }
  return out.join('\n');
}

/** Formats one tool step line (`[tool] summary (status)`). */
export function formatStep(row: StepRow | null | undefined, { color = false }: FormatColorOptions = {}): string {
  const status = String(row?.status || 'running');
  const glyph = status === 'done'
    ? style('✓', ANSI.mint, color)
    : status === 'error' || status === 'denied'
      ? style('✗', ANSI.coral, color)
      : style('◆', ANSI.cyan, color);
  const tool = style(`[${row?.tool || 'step'}]`, ANSI.violet, color);
  const summary = String(row?.summary || '').trim();
  const suffix = status && status !== 'running' && status !== 'done' ? style(` (${status})`, ANSI.dim, color) : '';
  return `${glyph} ${tool} ${summary}${suffix}`;
}

/** Renders an approval prompt box with the Fairy `approval` sprite. */
export function formatApprovalBox({
  title = 'Baryon needs your OK',
  detail = '',
  interactive = false,
  color = false,
}: ApprovalBoxOptions = {}): string {
  const sprite = renderSpriteLines({ mood: 'approval', color });
  const header = style(title, `${ANSI.bold}${ANSI.gold}`, color);
  const hint = interactive
    ? style('[y] allow once   [a] allow session   [n] deny', ANSI.cyan, color)
    : style('Approve or deny in Baryon (window, companion, or paired iPhone)', ANSI.dim, color);
  const detailLines = String(detail || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, 5)
    .map(l => style(l.slice(0, 96), ANSI.dim, color));
  const right = [header, ...detailLines, hint];
  const out: string[] = [];
  for (let i = 0; i < Math.max(sprite.length, right.length); i++) {
    out.push(`  ${sprite[i] || '                 '}   ${right[i] || ''}`);
  }
  return out.join('\n');
}

/** Formats uniform objects or rows into aligned terminal columns. */
export function formatTable<T = Record<string, unknown>>(
  columns: readonly TableColumn<T>[],
  rows: readonly T[] | null | undefined,
  { color = false, empty = '(none)' }: FormatTableOptions = {},
): string {
  if (!Array.isArray(rows) || !rows.length) return style(empty, ANSI.dim, color);
  const widths = columns.map(col => Math.min(col.max || 80, Math.max(
    String(col.label || '').length,
    ...rows.map(r => String(col.get(r) ?? '').replace(/\s+/g, ' ').length),
  )));
  const pad = (val: unknown, w: number): string => {
    const s = String(val ?? '').replace(/\s+/g, ' ');
    return s.length > w ? `${s.slice(0, Math.max(1, w - 1))}…` : s.padEnd(w, ' ');
  };
  const header = columns.map((c, i) => pad(c.label, widths[i])).join('  ');
  const sep = widths.map(w => '─'.repeat(w)).join('  ');
  const body = rows.map(row => columns.map((c, i) => pad(c.get(row), widths[i])).join('  '));
  return [
    style(header, `${ANSI.bold}${ANSI.cyan}`, color),
    style(sep, ANSI.dim, color),
    ...body,
  ].join('\n');
}

export function formatHeading(title: string, { color = false }: FormatColorOptions = {}): string {
  return style(title, `${ANSI.bold}${ANSI.violet}`, color);
}

export function formatSuccess(text: string, { color = false }: FormatColorOptions = {}): string {
  return `${style('✓', ANSI.mint, color)} ${text}`;
}

export function formatError(text: string, { color = false }: FormatColorOptions = {}): string {
  return `${style('✗', ANSI.coral, color)} ${text}`;
}

export function formatDim(text: string, { color = false }: FormatColorOptions = {}): string {
  return style(text, ANSI.dim, color);
}
