import type { BoardElement } from '../shared/document'

export interface Vec {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const TAU = Math.PI * 2

export function vec(x: number, y: number): Vec {
  return { x, y }
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k }
}

export function len(a: Vec): number {
  return Math.hypot(a.x, a.y)
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeAngle(angle: number): number {
  let a = angle % TAU
  if (a < 0) a += TAU
  return a
}

export function rotatePoint(point: Vec, origin: Vec, angle: number): Vec {
  if (angle === 0) return { x: point.x, y: point.y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos
  }
}

export function boxCenter(box: Box): Vec {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function elementBox(el: BoardElement): Box {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

/** The four corners of a box after rotation about its centre. */
export function boxCorners(box: Box, rotation = 0): [Vec, Vec, Vec, Vec] {
  const c = boxCenter(box)
  const pts: Vec[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height }
  ]
  return pts.map((p) => rotatePoint(p, c, rotation)) as [Vec, Vec, Vec, Vec]
}

/** Axis-aligned bounds that contain a rotated box. */
export function rotatedBounds(box: Box, rotation: number): Box {
  if (rotation === 0) return { ...box }
  const corners = boxCorners(box, rotation)
  return boundsOfPoints(corners)
}

export function boundsOfPoints(points: Vec[]): Box {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b }
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

export function pointInBox(p: Vec, box: Box): boolean {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height
}

/** Transforms a board point into an element's un-rotated local space. */
export function toLocal(point: Vec, el: { x: number; y: number; width: number; height: number; rotation: number }): Vec {
  const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
  return rotatePoint(point, center, -el.rotation)
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
  t = clamp(t, 0, 1)
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

export function distanceToPolyline(p: Vec, points: Vec[]): number {
  let min = Infinity
  for (let i = 1; i < points.length; i++) {
    const d = distanceToSegment(p, points[i - 1], points[i])
    if (d < min) min = d
  }
  return min
}

/** Where a ray from the box centre toward `target` leaves the box edge. */
export function boxEdgePoint(box: Box, target: Vec): Vec {
  const c = boxCenter(box)
  const dx = target.x - c.x
  const dy = target.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = box.width / 2
  const hh = box.height / 2
  const scaleX = hw / Math.abs(dx || Number.EPSILON)
  const scaleY = hh / Math.abs(dy || Number.EPSILON)
  const k = Math.min(scaleX, scaleY)
  return { x: c.x + dx * k, y: c.y + dy * k }
}

/** Chaikin-style smoothing used to render freehand strokes as a soft path. */
export function catmullRomToBezier(points: Vec[]): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

export function snapAngle(angle: number, stepDeg = 15): number {
  const step = (stepDeg * Math.PI) / 180
  return Math.round(angle / step) * step
}
