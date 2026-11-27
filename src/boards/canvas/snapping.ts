import type { Box } from '../core/geometry'
import type { Guide } from './overlay'

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
}

const EMPTY: SnapResult = { dx: 0, dy: 0, guides: [] }

interface Candidate {
  /** Offset that would move the box onto this line. */
  delta: number
  /** Board coordinate of the guide line. */
  line: number
  /** Extent of the neighbour, so the guide can be drawn spanning both. */
  from: number
  to: number
}

/**
 * Object snapping: aligns the moving box's left/centre/right and
 * top/middle/bottom against the same edges on nearby elements, choosing the
 * closest match per axis and emitting a guide for each snap that fires.
 */
export function computeSnap(
  moving: Box,
  others: Box[],
  thresholdBoard: number
): SnapResult {
  if (others.length === 0) return EMPTY

  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width]
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height]

  let bestX: Candidate | null = null
  let bestY: Candidate | null = null

  for (const other of others) {
    const otherX = [other.x, other.x + other.width / 2, other.x + other.width]
    const otherY = [other.y, other.y + other.height / 2, other.y + other.height]

    for (const mx of movingX) {
      for (const ox of otherX) {
        const delta = ox - mx
        if (Math.abs(delta) > thresholdBoard) continue
        if (!bestX || Math.abs(delta) < Math.abs(bestX.delta)) {
          bestX = {
            delta,
            line: ox,
            from: Math.min(other.y, moving.y),
            to: Math.max(other.y + other.height, moving.y + moving.height)
          }
        }
      }
    }

    for (const my of movingY) {
      for (const oy of otherY) {
        const delta = oy - my
        if (Math.abs(delta) > thresholdBoard) continue
        if (!bestY || Math.abs(delta) < Math.abs(bestY.delta)) {
          bestY = {
            delta,
            line: oy,
            from: Math.min(other.x, moving.x),
            to: Math.max(other.x + other.width, moving.x + moving.width)
          }
        }
      }
    }
  }

  const guides: Guide[] = []
  const pad = 12

  if (bestX) {
    guides.push({
      kind: 'align',
      from: { x: bestX.line, y: bestX.from - pad },
      to: { x: bestX.line, y: bestX.to + pad }
    })
  }
  if (bestY) {
    guides.push({
      kind: 'align',
      from: { x: bestY.from - pad, y: bestY.line },
      to: { x: bestY.to + pad, y: bestY.line }
    })
  }

  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides }
}

export const GRID_SIZE = 20

export function snapToGrid(value: number, size = GRID_SIZE): number {
  return Math.round(value / size) * size
}

export function snapBoxToGrid(box: Box, size = GRID_SIZE): { dx: number; dy: number } {
  return {
    dx: snapToGrid(box.x, size) - box.x,
    dy: snapToGrid(box.y, size) - box.y
  }
}
