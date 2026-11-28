const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export interface ViewerSizeInput {
  cols?: unknown;
  rows?: unknown;
}

export interface ViewerSize {
  cols: number;
  rows: number;
}

export interface WasmTerminal {
  write?: (text: string) => void;
  resize?: (cols: number, rows: number) => void;
  snapshot?: () => string;
  dispose?: () => void;
}

export type TerminalBackend = 'xterm-fallback' | 'ghostty-wasm';

export interface GhosttyAdapterOptions {
  cols?: number;
  rows?: number;
  maxBytes?: number;
  hasWasm?: boolean;
  createWasm?: ((opts: ViewerSize) => WasmTerminal | null | undefined) | null;
}

export interface GhosttySnapshot {
  backend: TerminalBackend;
  cols: number;
  rows: number;
  scrollback: string;
}

export interface GhosttyAdapter {
  readonly backend: TerminalBackend;
  readonly cols: number;
  readonly rows: number;
  write(chunk: string): void;
  resize(nextCols: number, nextRows: number): void;
  snapshot(): GhosttySnapshot;
  dispose(): void;
}

/**
 * Truncates terminal scrollback to at most `maxBytes` UTF-8 bytes without splitting
 * multi-byte UTF-8 code points or mid-CSI / mid-OSC ANSI escape sequences.
 */
export function truncateAnsiScrollback(text: string, maxBytes = 256 * 1024): string {
  const src = String(text ?? '');
  if (!src || maxBytes <= 0) return '';
  const totalBytes = Buffer.byteLength(src, 'utf8');
  if (totalBytes <= maxBytes) return src;

  // Approximate character cut offset conservatively, then step to exact byte limit.
  const buf = Buffer.from(src, 'utf8');
  let byteStart = Math.max(0, buf.length - maxBytes);
  // Skip UTF-8 continuation bytes (10xxxxxx) so we never start mid-codepoint.
  while (byteStart < buf.length && (buf[byteStart] & 0xc0) === 0x80) byteStart += 1;

  // Decode the kept prefix BEFORE the slice to know exact char index where cut falls.
  const cutCharIdx = buf.subarray(0, byteStart).toString('utf8').length;
  let safeCharIdx = cutCharIdx;

  // Check if any CSI or OSC sequence spans across `cutCharIdx`; if so, advance past its end.
  for (const re of [CSI_RE, OSC_RE]) {
    re.lastIndex = Math.max(0, cutCharIdx - 512);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (start < safeCharIdx && end > safeCharIdx) {
        safeCharIdx = end;
        break;
      }
      if (start >= safeCharIdx) break;
    }
  }

  // Also avoid leaving an incomplete orphan ESC at the very start (e.g. partial ESC[ or ESC]).
  if (src[safeCharIdx] === '\x1b' && !/^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/.test(src.slice(safeCharIdx, safeCharIdx + 256))) {
    safeCharIdx += 1;
  }

  return src.slice(safeCharIdx);
}

/**
 * Computes the smallest cols × rows bounding dimensions across active terminal viewers.
 */
export function computeSmallestViewerSize(
  viewers: Map<unknown, ViewerSizeInput | null | undefined> | Iterable<ViewerSizeInput | null | undefined> | null | undefined,
  { fallbackCols = 80, fallbackRows = 24 }: { fallbackCols?: number; fallbackRows?: number } = {},
): ViewerSize {
  const list = viewers instanceof Map ? [...viewers.values()] : Array.isArray(viewers) ? viewers : [...(viewers || [])];
  let minCols = Infinity;
  let minRows = Infinity;
  let count = 0;

  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const cols = Math.floor(Number(v.cols));
    const rows = Math.floor(Number(v.rows));
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) continue;
    minCols = Math.min(minCols, Math.max(20, Math.min(500, cols)));
    minRows = Math.min(minRows, Math.max(4, Math.min(200, rows)));
    count += 1;
  }

  if (count === 0) return { cols: fallbackCols, rows: fallbackRows };
  return { cols: minCols, rows: minRows };
}

/**
 * Terminal VT adapter supporting optional `libghostty-vt` WASM instances with clean ANSI-buffer fallback.
 */
export function createGhosttyAdapter({
  cols = 80,
  rows = 24,
  maxBytes = 256 * 1024,
  hasWasm = false,
  createWasm = null,
}: GhosttyAdapterOptions = {}): GhosttyAdapter {
  let wasmTerm: WasmTerminal | null = null;
  let backend: TerminalBackend = 'xterm-fallback';
  if (hasWasm && typeof createWasm === 'function') {
    try {
      wasmTerm = createWasm({ cols, rows }) ?? null;
      if (wasmTerm) backend = 'ghostty-wasm';
    } catch {
      wasmTerm = null;
    }
  }

  let curCols = cols;
  let curRows = rows;
  let buffer = '';

  return {
    backend,
    get cols(): number { return curCols; },
    get rows(): number { return curRows; },
    write(chunk: string): void {
      const text = String(chunk ?? '');
      if (wasmTerm?.write) wasmTerm.write(text);
      buffer = truncateAnsiScrollback(buffer + text, maxBytes);
    },
    resize(nextCols: number, nextRows: number): void {
      curCols = Math.max(20, Math.min(500, Math.floor(Number(nextCols) || curCols)));
      curRows = Math.max(4, Math.min(200, Math.floor(Number(nextRows) || curRows)));
      wasmTerm?.resize?.(curCols, curRows);
    },
    snapshot(): GhosttySnapshot {
      return {
        backend,
        cols: curCols,
        rows: curRows,
        scrollback: wasmTerm?.snapshot ? wasmTerm.snapshot() : buffer,
      };
    },
    dispose(): void {
      wasmTerm?.dispose?.();
      buffer = '';
    },
  };
}
