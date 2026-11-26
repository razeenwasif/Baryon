import type { ShapeKind } from '../shared/document'

/**
 * The subset of the Path2D surface the shape definitions use. Path2D satisfies
 * it structurally, and the SVG exporter implements it to emit a `d` string, so
 * canvas painting, hit-testing and vector export all share one definition.
 */
export interface PathSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): void
  closePath(): void
}

/** Builds a shape in local space, with the origin at the box's top-left. */
export function buildShape<T extends PathSink>(p: T, kind: ShapeKind, w: number, h: number): T {
  const cx = w / 2
  const cy = h / 2

  switch (kind) {
    case 'rectangle':
      p.rect(0, 0, w, h)
      break

    case 'roundRect': {
      const r = Math.min(w, h) * 0.18
      roundRectPath(p, 0, 0, w, h, r)
      break
    }

    case 'ellipse':
      p.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      break

    case 'triangle':
      polygonPath(p, [
        [cx, 0],
        [w, h],
        [0, h]
      ])
      break

    case 'diamond':
      polygonPath(p, [
        [cx, 0],
        [w, cy],
        [cx, h],
        [0, cy]
      ])
      break

    case 'pentagon':
      polygonPath(p, regularPolygon(5, w, h, -Math.PI / 2))
      break

    case 'hexagon':
      polygonPath(p, regularPolygon(6, w, h, 0))
      break

    case 'star':
      polygonPath(p, starPolygon(5, w, h, 0.42))
      break

    case 'arrowRight': {
      const tail = h * 0.28
      const headStart = w * 0.62
      polygonPath(p, [
        [0, cy - tail],
        [headStart, cy - tail],
        [headStart, 0],
        [w, cy],
        [headStart, h],
        [headStart, cy + tail],
        [0, cy + tail]
      ])
      break
    }

    case 'parallelogram': {
      const slant = w * 0.22
      polygonPath(p, [
        [slant, 0],
        [w, 0],
        [w - slant, h],
        [0, h]
      ])
      break
    }

    case 'cross': {
      const armX = w * 0.32
      const armY = h * 0.32
      polygonPath(p, [
        [armX, 0],
        [w - armX, 0],
        [w - armX, armY],
        [w, armY],
        [w, h - armY],
        [w - armX, h - armY],
        [w - armX, h],
        [armX, h],
        [armX, h - armY],
        [0, h - armY],
        [0, armY],
        [armX, armY]
      ])
      break
    }

    case 'cylinder': {
      const ry = Math.min(h * 0.16, w * 0.3)
      // Body: top arc, down the right side, bottom arc, back up the left.
      p.moveTo(0, ry)
      p.ellipse(cx, ry, cx, ry, 0, Math.PI, 0, true)
      p.lineTo(w, h - ry)
      p.ellipse(cx, h - ry, cx, ry, 0, 0, Math.PI, false)
      p.lineTo(0, ry)
      p.closePath()
      // The lid's near edge, which is what makes it read as a cylinder.
      p.moveTo(w, ry)
      p.ellipse(cx, ry, cx, ry, 0, 0, Math.PI, false)
      break
    }

    case 'speechBubble': {
      const bodyH = h * 0.78
      const r = Math.min(w, bodyH) * 0.2
      roundRectPath(p, 0, 0, w, bodyH, r)
      p.moveTo(w * 0.22, bodyH - 1)
      p.lineTo(w * 0.2, h)
      p.lineTo(w * 0.42, bodyH - 1)
      p.closePath()
      break
    }

    case 'cloud': {
      cloudPath(p, w, h)
      break
    }

    default:
      p.rect(0, 0, w, h)
  }

  return p
}

export function buildShapePath(kind: ShapeKind, w: number, h: number): Path2D {
  return buildShape(new Path2D(), kind, w, h)
}

function roundRectPath(
  p: PathSink,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  p.moveTo(x + radius, y)
  p.lineTo(x + w - radius, y)
  p.arcTo(x + w, y, x + w, y + radius, radius)
  p.lineTo(x + w, y + h - radius)
  p.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  p.lineTo(x + radius, y + h)
  p.arcTo(x, y + h, x, y + h - radius, radius)
  p.lineTo(x, y + radius)
  p.arcTo(x, y, x + radius, y, radius)
  p.closePath()
}

function polygonPath(p: PathSink, points: [number, number][]): void {
  points.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)))
  p.closePath()
}

function regularPolygon(
  sides: number,
  w: number,
  h: number,
  startAngle: number
): [number, number][] {
  const cx = w / 2
  const cy = h / 2
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i * Math.PI * 2) / sides
    pts.push([cx + Math.cos(a) * cx, cy + Math.sin(a) * cy])
  }
  return pts
}

function starPolygon(
  points: number,
  w: number,
  h: number,
  innerRatio: number
): [number, number][] {
  const cx = w / 2
  const cy = h / 2
  const pts: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const rx = i % 2 === 0 ? cx : cx * innerRatio
    const ry = i % 2 === 0 ? cy : cy * innerRatio
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}

function cloudPath(p: PathSink, w: number, h: number): void {
  const bumps: [number, number, number][] = [
    [0.22, 0.66, 0.22],
    [0.38, 0.42, 0.26],
    [0.62, 0.4, 0.24],
    [0.8, 0.62, 0.2]
  ]
  bumps.forEach(([fx, fy, fr], i) => {
    const cx = fx * w
    const cy = fy * h
    const r = fr * Math.min(w, h) * 1.2
    if (i === 0) p.moveTo(cx + r, cy)
    p.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2)
  })
  p.rect(w * 0.18, h * 0.55, w * 0.66, h * 0.3)
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  roundRect: 'Rounded rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  diamond: 'Diamond',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  star: 'Star',
  arrowRight: 'Arrow',
  parallelogram: 'Parallelogram',
  cylinder: 'Cylinder',
  cross: 'Cross',
  speechBubble: 'Speech bubble',
  cloud: 'Cloud'
}

/** Inset where text can safely sit inside a shape, as a fraction of the box. */
export const SHAPE_TEXT_INSET: Partial<Record<ShapeKind, { x: number; y: number }>> = {
  triangle: { x: 0.24, y: 0.34 },
  diamond: { x: 0.22, y: 0.22 },
  star: { x: 0.28, y: 0.3 },
  arrowRight: { x: 0.14, y: 0.28 },
  speechBubble: { x: 0.1, y: 0.14 },
  cylinder: { x: 0.1, y: 0.2 },
  cross: { x: 0.34, y: 0.34 },
  cloud: { x: 0.2, y: 0.32 }
}
