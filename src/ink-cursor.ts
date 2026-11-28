// Fairy's pen: a small pointer in the shape of your own Mac cursor (Bibata Modern Ice), in Fairy's blue with a dark edge,
// that Fairy turns into to draw. It flies from her to each part of a drawing and traces it, so the pixels light up under
// its tip, then flies back and she turns back into herself. It's drawn in the ink window and never moves your real
// pointer. The ink window's clock moves it (update), so it stays exactly in step with the pixels it lights.

export type InkPoint = readonly [number, number];

export interface InkFlyLeg {
  fly: readonly [InkPoint, InkPoint];
  t0: number;
  t1: number;
  trace?: undefined;
}

export interface InkTraceLeg {
  trace: readonly InkPoint[];
  t0: number;
  t1: number;
  fly?: undefined;
}

export type InkRouteLeg = InkFlyLeg | InkTraceLeg;

export interface InkCursorOptions {
  snap?: (v: number) => number;
}

export interface InkCursorLoadOptions {
  stay?: boolean;
}

// A route is a list of legs in time order: { fly: [from, to], t0, t1 } or { trace: points, t0, t1 }. Pure, for tests.
export function flyTime(from: InkPoint, to: InkPoint): number {
  return Math.round(Math.min(560, Math.max(160, Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.8)));
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function positionAt(route: readonly InkRouteLeg[], t: number): InkPoint | null {
  if (!route.length) return null;
  let last: InkPoint = route[0].fly ? route[0].fly[0] : route[0].trace[0];
  for (const leg of route) {
    if (t < leg.t0) return last;
    if (leg.fly) {
      const [[x0, y0], [x1, y1]] = leg.fly;
      if (t >= leg.t1) { last = leg.fly[1]; continue; }
      const k = ease((t - leg.t0) / Math.max(1, leg.t1 - leg.t0));
      const dist = Math.hypot(x1 - x0, y1 - y0);
      // A gentle arc, as a hand would move.
      const bump = Math.sin(Math.PI * k) * Math.min(40, dist * 0.15);
      const nx = dist ? -(y1 - y0) / dist : 0;
      const ny = dist ? (x1 - x0) / dist : 0;
      return [x0 + (x1 - x0) * k + nx * bump, y0 + (y1 - y0) * k + ny * bump];
    }
    const points = leg.trace;
    if (t >= leg.t1) { last = points.at(-1)!; continue; }
    return points[Math.min(points.length - 1, Math.floor((t - leg.t0) / Math.max(1, leg.t1 - leg.t0) * points.length))];
  }
  return last;
}

// Is the pen drawing (tracing) at time t, rather than flying or resting?
export const tracingAt = (route: readonly InkRouteLeg[], t: number): boolean =>
  route.some(leg => Boolean(leg.trace) && t >= leg.t0 && t < leg.t1);

// The Bibata Modern arrow, drawn on a 64-unit square with its tip near the top left, in Fairy's blue.
const SIZE = 22;
const TIP: readonly [number, number] = [12.4, 9.6];

export function cursorSVG(size = SIZE): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 10.5 Q12 6.5 16 8.6 L51.5 29.2 Q55.2 31.6 51 33.6 Q33 39.5 20.2 51 Q15 55 14.6 49.4 Z" fill="#6f8cff" stroke="#0c1140" stroke-width="3.6" stroke-linejoin="round"/></svg>`;
}

export class InkCursor {
  node: HTMLDivElement;
  snap: (v: number) => number;
  route: readonly InkRouteLeg[];
  end: number;
  at: InkPoint | null;
  home: boolean;
  offset: number[];
  done?: boolean;
  stay?: boolean;

  constructor(layer: HTMLElement, { snap = v => v }: InkCursorOptions = {}) {
    this.node = document.createElement('div');
    this.node.id = 'ink-cursor';
    this.node.innerHTML = cursorSVG();
    this.node.hidden = true;
    layer.append(this.node);
    this.snap = snap;
    this.route = [];
    this.end = 0;
    this.at = null;
    this.home = false;
    this.offset = TIP.map(v => (v / 64) * SIZE);
  }

  // A new route: the pen appears where it starts (Fairy, when she's on this screen) and the clock moves it.
  // stay: the pen stays where the route ends (pointing at a control in Show me how) instead of turning back into Fairy.
  load(route: readonly InkRouteLeg[], { stay = false }: InkCursorLoadOptions = {}): void {
    this.route = route;
    this.end = route.at(-1)?.t1 ?? 0;
    this.done = !route.length;
    this.stay = stay;
    if (!route.length) return;
    this.node.hidden = false;
    this.node.classList.remove('leaving');
    this.node.classList.add('arriving');
  }

  // t: ms since the drawing's first frame. Returns true once the route is finished.
  update(t: number): boolean {
    if (this.done) return true;
    const at = positionAt(this.route, t);
    if (at) {
      this.at = at;
      this.node.style.transform = `translate(${this.snap(at[0]) - this.offset[0]}px, ${this.snap(at[1]) - this.offset[1]}px)`;
    }
    this.node.classList.toggle('drawing', tracingAt(this.route, t));
    if (t >= this.end) {
      this.done = true;
      this.node.classList.remove('arriving');
      if (!this.stay) this.node.classList.add('leaving');
      return true;
    }
    return false;
  }

  stop(): void {
    this.node.hidden = true;
    this.route = [];
    this.done = true;
  }
}
