// What Fairy is doing, at a glance: a tiny pixel animation beside her status for each kind of tool, in the same
// stepped, LED-pixel style as her screen ink. A magnifier sweeps while she searches, pages turn while she reads files
// or notes, an envelope opens for email, a page flips for the calendar, a prompt blinks for code, an eye scans the
// screen, bars bounce while she listens, a pencil draws while she makes something, and dots cycle while she thinks.

export type GlyphKind =
  | 'search'
  | 'screen'
  | 'mail'
  | 'calendar'
  | 'files'
  | 'code'
  | 'voice'
  | 'make'
  | 'think'
  | 'ask';

interface GlyphSpec {
  ms: number;
  frames: string[][];
}

// Each frame is rows of 10 pixels ('#' lit). Frames step in turn, like pixel art.
const F = (rows: string[]): string[] => rows.map(row => row.padEnd(10, '.'));
const GLYPHS: Record<GlyphKind, GlyphSpec> = {
  search: { ms: 700, frames: [
    F(['.###', '#...#', '#...#', '#...#', '.###', '....##', '.....##']),
    F(['..###', '.#...#', '.#...#', '.#...#', '..###', '.....##', '......##']),
    F(['...###', '..#...#', '..#...#', '..#...#', '...###', '......##', '.......##']),
  ] },
  screen: { ms: 900, frames: [
    F(['..######', '.#......#', '#.##.....#', '#.##.....#', '.#......#', '..######']),
    F(['..######', '.#......#', '#...##...#', '#...##...#', '.#......#', '..######']),
    F(['..######', '.#......#', '#.....##.#', '#.....##.#', '.#......#', '..######']),
    F(['..######', '.#......#', '#...##...#', '#...##...#', '.#......#', '..######']),
  ] },
  mail: { ms: 900, frames: [
    F(['', '##########', '##......##', '#.#....#.#', '#..#..#..#', '#...##...#', '#........#', '##########']),
    F(['....##', '...#..#', '..#....#', '##########', '#........#', '#........#', '#........#', '##########']),
  ] },
  calendar: { ms: 800, frames: [
    F(['.#....#', '##########', '#........#', '#.##.....#', '#.##.....#', '#........#', '##########']),
    F(['.#....#', '##########', '#........#', '#....##..#', '#....##..#', '#........#', '##########']),
  ] },
  files: { ms: 800, frames: [
    F(['.######', '.#....##', '.#.....#', '.#.###.#', '.#.....#', '.#.##..#', '.#######']),
    F(['..######', '..#....##', '..#.....#', '..#.##..#', '..#.....#', '..#.###.#', '..#######']),
  ] },
  code: { ms: 900, frames: [
    F(['', '#', '.#', '..#', '.#', '#...####']),
    F(['', '#', '.#', '..#', '.#', '#']),
  ] },
  voice: { ms: 600, frames: [
    F(['', '...#', '...#...#', '.#.#...#', '.#.#.#.#', '.#.#.#.#', '.#.#.#.#']),
    F(['', '.......#', '.#.....#', '.#.#...#', '.#.#.#.#', '.#.#.#.#', '.#.#.#.#']),
    F(['', '.#', '.#...#', '.#.#.#', '.#.#.#.#', '.#.#.#.#', '.#.#.#.#']),
  ] },
  make: { ms: 900, frames: [
    F(['.......##', '......###', '.....###', '....###', '...###', '..#', '', '#']),
    F(['.......##', '......###', '.....###', '....###', '...###', '..#', '', '###']),
    F(['.......##', '......###', '.....###', '....###', '...###', '..#', '', '#####']),
  ] },
  think: { ms: 900, frames: [
    F(['', '', '', '##', '##..##..##', '....##..##']),
    F(['', '', '', '....##', '##..##..##', '##......##']),
    F(['', '', '', '........##', '##..##..##', '##..##']),
  ] },
  ask: { ms: 800, frames: [
    F(['....##', '....##', '....##', '....##', '', '....##']),
    F(['']),
  ] },
};

// The kind of thing a status says she's doing, or null for none (Ready, Stopped).
export function toolKind(text: unknown): GlyphKind | null {
  const words = String(text || '').toLowerCase();
  if (!words || /^(ready|stopped|new chat|new work session|playback)/.test(words)) return null;
  if (/needs your ok|approve/.test(words)) return 'ask';
  if (/live sources|search|news|web|look(ing)? up/.test(words)) return 'search';
  if (/gmail|email|inbox|mail/.test(words)) return 'mail';
  if (/calendar|event|schedule/.test(words)) return 'calendar';
  if (/listening|transcrib|voice|hearing/.test(words)) return 'voice';
  if (/screen|snapshot|observ|looking at|the app you/.test(words)) return 'screen';
  if (/^reading/.test(words)) return 'files';
  if (/making|writing|drawing|edit|creat/.test(words)) return 'make';
  if (/github|neutrino|ntr|graviton|command|terminal|project|desktop step|running|test|build|agents\.md|code/.test(words)) return 'code';
  if (/notes|books|files?\b|folder|drive|reading/.test(words)) return 'files';
  if (/think|thought|working|preparing|loading|choosing/.test(words)) return 'think';
  return null;
}

// A work session's step: its tool's name says which.
export function toolOfStep(tool: unknown = ''): GlyphKind {
  const name = String(tool).toLowerCase();
  if (/search|web|fetch|url/.test(name)) return 'search';
  if (/gmail|mail/.test(name)) return 'mail';
  if (/calendar/.test(name)) return 'calendar';
  if (/screen|computer|browser|simulator|click/.test(name)) return 'screen';
  if (/write|edit|patch|create|make|page/.test(name)) return 'make';
  if (/command|shell|run|exec|test|git|neutrino/.test(name)) return 'code';
  if (/read|list|grep|glob|find|file|open/.test(name)) return 'files';
  return 'think';
}

const SVG = 'http://www.w3.org/2000/svg';
export function glyph(kind: GlyphKind | string): SVGSVGElement | null {
  const spec = Object.hasOwn(GLYPHS, kind) ? GLYPHS[kind as GlyphKind] : undefined;
  if (!spec) return null;
  const svg = document.createElementNS(SVG, 'svg'), n = spec.frames.length;
  svg.setAttribute('class', 'tool-glyph');
  svg.setAttribute('viewBox', '0 0 10 8');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '12');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.kind = kind;
  svg.dataset.n = String(n);
  spec.frames.forEach((rows, index) => {
    const frame = document.createElementNS(SVG, 'g');
    frame.style.animationDuration = `${spec.ms}ms`;
    frame.style.animationDelay = `${Math.round((index * spec.ms) / n)}ms`;
    frame.style.animationName = `tool-glyph-${n}`;
    rows.forEach((row, y) =>
      [...row].forEach((pixel, x) => {
        if (pixel !== '#') return;
        const dot = document.createElementNS(SVG, 'rect');
        dot.setAttribute('x', String(x));
        dot.setAttribute('y', String(y));
        dot.setAttribute('width', '1');
        dot.setAttribute('height', '1');
        frame.append(dot);
      }),
    );
    svg.append(frame);
  });
  return svg;
}

// Writes a status with its animation in front, leaving the words as they were for screen readers.
// kind: when the caller knows it (a work session's step), else read from the words.
export function paintStatus(
  element: HTMLElement | null | undefined,
  text: string,
  kind: GlyphKind | null = toolKind(text),
): void {
  if (!element) return;
  element.textContent = text;
  if (kind) {
    const g = glyph(kind);
    if (g) element.prepend(g);
    element.dataset.tool = kind;
  } else {
    delete element.dataset.tool;
  }
}

export const GLYPH_KINDS = Object.keys(GLYPHS) as GlyphKind[];
export const glyphFrames = (kind: GlyphKind | string): string[][] | undefined =>
  Object.hasOwn(GLYPHS, kind) ? GLYPHS[kind as GlyphKind].frames : undefined;
