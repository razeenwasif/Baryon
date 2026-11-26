// The aurora drawn in characters: the Aurora wallpaper's sweeping arcs as light on a grid, grey by brightness with blue
// on the brightest crest. Velvet's aurora grid (aurora-grid.js) draws it on the GPU from these same arcs; this file is
// its shape, in plain JavaScript, for the Appearance card's picture and for the tests.

export const ASCII_AURORA = {
  ramp: ' ..:-~=+*#%', // faint to dense
  grey: '176, 182, 198',
  blue: ['63, 99, 255', '143, 168, 255'], // the accent, and its bright crest
  bg: '#04050a',
};

// The arcs: each a curve rising from the lower left to the upper right, as the wallpaper's do, at u in [0, 1] across.
// base: where it crosses the middle; lift: how far it climbs; bow: how much it bends; width and strength of its glow.
export const ARCS = [
  { base: 0.7, lift: 0.5, bow: 0.18, width: 0.05, strength: 1, sway: 0.03, speed: 0.11, accent: true },
  { base: 0.86, lift: 0.44, bow: 0.26, width: 0.035, strength: 0.7, sway: 0.025, speed: 0.08, accent: false },
  { base: 0.56, lift: 0.58, bow: 0.12, width: 0.03, strength: 0.5, sway: 0.035, speed: 0.13, accent: false },
  { base: 1.02, lift: 0.36, bow: 0.3, width: 0.07, strength: 0.32, sway: 0.02, speed: 0.06, accent: false },
];

// A cheap, steady hash for glints: the same cell twinkles at the same moments.
const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };

// How bright the aurora is at (u, v), both 0..1 from the top left, at time t in seconds; and how near the brightest
// arc's crest it is (1 on it).
export function auroraAt(u, v, t) {
  let light = 0, crest = 0;
  for (const arc of ARCS) {
    // The arc's height across the window, swaying, with a slow ripple travelling along it.
    const y = arc.base - arc.lift * u + arc.bow * (u - 0.5) * (u - 0.5) + arc.sway * Math.sin(u * 4.3 + t * arc.speed * 6) + 0.008 * Math.sin(u * 17 - t * 0.9);
    const d = (v - y) / arc.width;
    // Brightest on the arc, trailing off longer above it than below, like curtains of light rising off it.
    const glow = Math.exp(-(d > 0 ? d * d * 1.6 : d * d * 0.22));
    // Soft curtains: broad streaks that drift sideways.
    const curtain = 0.86 + 0.14 * Math.sin(u * 19 + 2 * Math.sin(u * 5 + t * 0.35) - t * 0.6);
    light += arc.strength * glow * curtain;
    if (arc.accent) crest = Math.max(crest, glow * curtain);
  }
  // A slow breath over the whole sky.
  light *= 0.88 + 0.12 * Math.sin(t * 0.35);
  return { light: Math.min(1, light), crest };
}

// The character and shade for a cell: { ch, shade } where shade is 0..3 for grey, 4 for blue, 5 for the bright crest.
export function cellAt(col, row, cols, rows, t) {
  const { light, crest } = auroraAt(col / Math.max(1, cols - 1), row / Math.max(1, rows - 1), t);
  return cellOf(col, row, Math.min(1, light), crest, t);
}
export function cellOf(col, row, light, crest, t) {
  const ramp = ASCII_AURORA.ramp, index = Math.min(ramp.length - 1, Math.floor(light * ramp.length));
  if (index <= 0) return { ch: ' ', shade: 0 };
  const ch = ramp[index];
  if (crest > 0.95) return { ch, shade: 5 };
  if (crest > 0.86) return { ch, shade: 4 };
  // A few glints: blue for a moment, where there's some light.
  if (light > 0.2 && hash(col, row) > 0.992 && Math.sin(t * 2.3 + hash(row, col) * 40) > 0.7) return { ch: '+', shade: 5 };
  return { ch, shade: Math.min(3, Math.floor(light * 4)) };
}

// The Appearance card's picture of Velvet: near-black, the grid's faint dots, and the aurora's characters through them.
export function gridThumbnail() {
  const cols = 40, rows = 26, gap = 20, parts = [];
  const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = 10 + col * gap, y = 10 + row * gap, { ch, shade } = cellAt(col, row, cols, rows, 7);
    if (ch === ' ') parts.push(`<circle cx="${x}" cy="${y}" r="1.4" fill="rgb(201,208,236)" fill-opacity=".16"/>`);
    else parts.push(`<text x="${x}" y="${y + 6}" fill="${shade >= 4 ? 'rgb(143,168,255)' : `rgb(${ASCII_AURORA.grey})`}" fill-opacity="${shade >= 4 ? 0.85 : 0.3 + shade * 0.15}">${esc(ch)}</text>`);
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520"><rect width="800" height="520" fill="#030304"/><g font-family="Menlo, monospace" font-size="17" text-anchor="middle">${parts.join('')}</g></svg>`)}`;
}
