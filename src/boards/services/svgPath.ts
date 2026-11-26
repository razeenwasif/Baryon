import type { PathSink } from '../core/shapes'

/**
 * Records the same calls Path2D receives and emits an SVG `d` string. Arcs are
 * turned into real SVG arc commands rather than sampled polylines, so exported
 * shapes stay crisp at any scale.
 */
export class SvgPathSink implements PathSink {
  private parts: string[] = []
  private current: { x: number; y: number } | null = null
  private subpathStart: { x: number; y: number } | null = null

  get d(): string {
    return this.parts.join(' ')
  }

  moveTo(x: number, y: number): void {
    this.parts.push(`M ${n(x)} ${n(y)}`)
    this.current = { x, y }
    this.subpathStart = { x, y }
  }

  lineTo(x: number, y: number): void {
    if (!this.current) return this.moveTo(x, y)
    this.parts.push(`L ${n(x)} ${n(y)}`)
    this.current = { x, y }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.parts.push(
      `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`
    )
    this.current = { x, y }
    this.subpathStart = { x, y }
  }

  closePath(): void {
    this.parts.push('Z')
    if (this.subpathStart) this.current = { ...this.subpathStart }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const p0 = this.current
    if (!p0) return this.moveTo(x1, y1)
    if (radius <= 0) return this.lineTo(x1, y1)

    const v1 = norm({ x: p0.x - x1, y: p0.y - y1 })
    const v2 = norm({ x: x2 - x1, y: y2 - y1 })
    if (!v1 || !v2) return this.lineTo(x1, y1)

    const cross = v1.x * v2.y - v1.y * v2.x
    if (Math.abs(cross) < 1e-9) return this.lineTo(x1, y1)

    const angle = Math.acos(clamp(v1.x * v2.x + v1.y * v2.y, -1, 1))
    const tangent = radius / Math.tan(angle / 2)

    const t1 = { x: x1 + v1.x * tangent, y: y1 + v1.y * tangent }
    const t2 = { x: x1 + v2.x * tangent, y: y1 + v2.y * tangent }

    this.lineTo(t1.x, t1.y)
    // The corner arc is always the minor one, so large-arc is 0.
    const sweep = cross < 0 ? 1 : 0
    this.parts.push(`A ${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(t2.x)} ${n(t2.y)}`)
    this.current = t2
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    const pointAt = (angle: number): { x: number; y: number } => {
      const px = rx * Math.cos(angle)
      const py = ry * Math.sin(angle)
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos }
    }

    let delta = endAngle - startAngle
    if (counterclockwise) {
      while (delta > 0) delta -= Math.PI * 2
      if (delta < -Math.PI * 2) delta = -Math.PI * 2
    } else {
      while (delta < 0) delta += Math.PI * 2
      if (delta > Math.PI * 2) delta = Math.PI * 2
    }

    const start = pointAt(startAngle)
    if (this.current) this.lineTo(start.x, start.y)
    else this.moveTo(start.x, start.y)

    const sweep = counterclockwise ? 0 : 1
    const rotationDeg = (rotation * 180) / Math.PI
    // SVG arcs cannot span more than half a turn unambiguously, so step in
    // quarter turns and let each segment stay well inside that limit.
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
    for (let i = 1; i <= steps; i++) {
      const angle = startAngle + (delta * i) / steps
      const p = pointAt(angle)
      this.parts.push(
        `A ${n(rx)} ${n(ry)} ${n(rotationDeg)} 0 ${sweep} ${n(p.x)} ${n(p.y)}`
      )
      this.current = p
    }
  }
}

function n(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
}

function norm(v: { x: number; y: number }): { x: number; y: number } | null {
  const length = Math.hypot(v.x, v.y)
  if (length < 1e-9) return null
  return { x: v.x / length, y: v.y / length }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
