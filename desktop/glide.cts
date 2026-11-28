// Two Macs, step 5: her window leaving a screen at the edge the pointer left by, and coming in at the edge it came in by,
// so she seems to cross between the Macs with you. Pure geometry, and a small animation on any window that has
// getBounds, setPosition and setOpacity.
const STEPS = 12, EVERY_MS = 25;

type EdgeName = 'left' | 'right' | 'top' | 'bottom';

interface GlidePoint {
  x: number;
  y: number;
}

interface GlideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GlideSize {
  width: number;
  height: number;
}

interface GlideWindow {
  isDestroyed: () => boolean;
  getBounds: () => GlideRect;
  getOpacity: () => number;
  setPosition: (x: number, y: number) => void;
  setOpacity: (opacity: number) => void;
}

interface GlideScreen {
  getDisplayNearestPoint: (point: GlidePoint) => { bounds: GlideRect };
}

// The screen edge nearest a point, and how far along that edge it is (0 to 1).
function nearestEdge(point: GlidePoint, area: GlideRect): { edge: EdgeName; along: number } {
  const distances: Record<EdgeName, number> = {
    left: point.x - area.x,
    right: area.x + area.width - point.x,
    top: point.y - area.y,
    bottom: area.y + area.height - point.y,
  };
  const edge = (Object.keys(distances) as EdgeName[]).reduce((best, name) => (distances[name] < distances[best] ? name : best));
  const along = edge === 'left' || edge === 'right' ? (point.y - area.y) / area.height : (point.x - area.x) / area.width;
  return { edge, along: Math.min(1, Math.max(0, along)) };
}
// Where a window of this size sits at that edge, mostly off the screen, lined up with the point.
function edgePlace({ edge, along }: { edge: EdgeName; along: number }, area: GlideRect, size: GlideSize): GlidePoint {
  const clamp = (value: number, low: number, high: number) => Math.round(Math.min(Math.max(value, low), Math.max(low, high)));
  const midY = clamp(area.y + along * area.height - size.height / 2, area.y, area.y + area.height - size.height);
  const midX = clamp(area.x + along * area.width - size.width / 2, area.x, area.x + area.width - size.width);
  if (edge === 'left') return { x: Math.round(area.x - size.width * 0.6), y: midY };
  if (edge === 'right') return { x: Math.round(area.x + area.width - size.width * 0.4), y: midY };
  if (edge === 'top') return { x: midX, y: Math.round(area.y - size.height * 0.6) };
  return { x: midX, y: Math.round(area.y + area.height - size.height * 0.4) };
}
// Positions from one place to another, easing out, ending exactly at the second.
function glidePath(from: GlidePoint, to: GlidePoint, steps = STEPS): GlidePoint[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps, eased = 1 - (1 - t) ** 3;
    return { x: Math.round(from.x + (to.x - from.x) * eased), y: Math.round(from.y + (to.y - from.y) * eased) };
  });
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
// The window slides to the edge nearest `point` and fades out, then goes back to where it was, still invisible.
async function glideOut(
  win: GlideWindow | null | undefined,
  { screen, point }: { screen: GlideScreen; point?: GlidePoint | null },
): Promise<void> {
  if (!win || win.isDestroyed()) return;
  const start = win.getBounds(), opacity = win.getOpacity();
  if (point) {
    const area = screen.getDisplayNearestPoint(point).bounds, target = edgePlace(nearestEdge(point, area), area, start);
    const path = glidePath(start, target);
    for (const [i, place] of path.entries()) {
      if (win.isDestroyed()) return;
      win.setPosition(place.x, place.y); win.setOpacity(opacity * (1 - (i + 1) / path.length));
      await pause(EVERY_MS);
    }
  }
  if (win.isDestroyed()) return;
  win.setOpacity(0); win.setPosition(start.x, start.y);
}
// From the edge nearest `point` to where the window belongs, fading in to `opacity`.
async function glideIn(
  win: GlideWindow | null | undefined,
  { screen, point, opacity = 1 }: { screen: GlideScreen; point?: GlidePoint | null; opacity?: number },
): Promise<void> {
  if (!win || win.isDestroyed()) return;
  const home = win.getBounds();
  if (point) {
    const area = screen.getDisplayNearestPoint(point).bounds, start = edgePlace(nearestEdge(point, area), area, home);
    win.setOpacity(0); win.setPosition(start.x, start.y);
    const path = glidePath(start, home);
    for (const [i, place] of path.entries()) {
      if (win.isDestroyed()) return;
      win.setPosition(place.x, place.y); win.setOpacity(opacity * (i + 1) / path.length);
      await pause(EVERY_MS);
    }
  }
  if (win.isDestroyed()) return;
  win.setPosition(home.x, home.y); win.setOpacity(opacity);
}

module.exports = { nearestEdge, edgePlace, glidePath, glideOut, glideIn, STEPS, EVERY_MS };
