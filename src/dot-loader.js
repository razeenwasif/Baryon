// Fairy's four-by-four dot loader, after transitions.dev's matrix loader: every dot shares one pulse, and each state is
// just a table of delays. Scan (Fairy replying) runs across in columns, orbit (a work session running) circles a lit
// middle, pulse (waiting for your OK) beats from the centre out, and twinkle (up next) lights the dots at random.
export const DOT_CYCLE = 1200;
const CORNERS = [0, 3, 12, 15], RING = [1, 2, 7, 11, 14, 13, 8, 4], INNER = [5, 6, 9, 10];
const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

// For each of the 16 dots, row by row: its delay into the pulse, or 'gap' (not drawn) or 'hold' (lit, still).
export function dotPlan(kind) {
  return Array.from({ length: 16 }, (_, index) => {
    if (kind === 'twinkle') return { delay: TWINKLE[index] * DOT_CYCLE / 16 };
    if (kind === 'scan' || !['orbit', 'pulse'].includes(kind)) return { delay: (index % 4) * DOT_CYCLE / 10 };
    if (CORNERS.includes(index)) return { delay: 0, dot: 'gap' };
    if (kind === 'orbit') return RING.includes(index) ? { delay: RING.indexOf(index) * DOT_CYCLE / 8 } : { delay: 0, dot: 'hold' };
    return { delay: INNER.includes(index) ? 0 : DOT_CYCLE * 0.16 };
  });
}

// The loader's element. Its delays count from one clock shared by every loader, so a list that's drawn again doesn't
// restart them, and two loaders of a kind beat together.
export function dotLoader(kind = 'scan', now = performance.now()) {
  const box = document.createElement('span');
  box.className = `dot-loader ${kind}`;
  box.setAttribute('aria-hidden', 'true');
  const offset = now % DOT_CYCLE;
  for (const { delay, dot } of dotPlan(kind)) {
    const element = document.createElement('i');
    if (dot) element.className = dot;
    else element.style.setProperty('--d', `${Math.round(delay - offset)}ms`);
    box.append(element);
  }
  return box;
}
