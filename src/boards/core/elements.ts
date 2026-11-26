import { nanoid } from 'nanoid'
import {
  DEFAULT_STYLE,
  type BoardElement,
  type ConnectorElement,
  type ConnectorEnd,
  type DrawElement,
  type ElementId,
  type ElementStyle,
  type FrameElement,
  type ImageElement,
  type ShapeElement,
  type ShapeKind,
  type StickyElement,
  type TextElement
} from '../shared/document'
import {
  boundsOfPoints,
  boxCenter,
  boxEdgePoint,
  distanceToPolyline,
  rotatedBounds,
  toLocal,
  unionBox,
  type Box,
  type Vec
} from './geometry'
import { buildShapePath } from './shapes'

export function newId(): ElementId {
  return nanoid(12)
}

export const DEFAULT_SIZES = {
  sticky: { width: 180, height: 180 },
  shape: { width: 160, height: 120 },
  text: { width: 220, height: 40 },
  frame: { width: 800, height: 600 }
} as const

interface BaseInit {
  order: number
  style?: Partial<ElementStyle>
  parentId?: ElementId | null
}

function base(
  type: BoardElement['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  init: BaseInit
): Omit<BoardElement, 'type'> & { type: BoardElement['type'] } {
  return {
    id: newId(),
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    order: init.order,
    opacity: 1,
    locked: false,
    parentId: init.parentId ?? null,
    groupId: null,
    style: { ...DEFAULT_STYLE, ...init.style }
  } as Omit<BoardElement, 'type'> & { type: BoardElement['type'] }
}

export function createSticky(x: number, y: number, init: BaseInit, text = ''): StickyElement {
  const { width, height } = DEFAULT_SIZES.sticky
  return {
    ...base('sticky', x, y, width, height, init),
    type: 'sticky',
    text
  } as StickyElement
}

export function createShape(
  shape: ShapeKind,
  x: number,
  y: number,
  width: number,
  height: number,
  init: BaseInit
): ShapeElement {
  return {
    ...base('shape', x, y, width, height, init),
    type: 'shape',
    shape,
    text: ''
  } as ShapeElement
}

export function createText(x: number, y: number, init: BaseInit, text = ''): TextElement {
  const { width, height } = DEFAULT_SIZES.text
  return {
    ...base('text', x, y, width, height, init),
    type: 'text',
    text,
    autoHeight: true
  } as TextElement
}

export function createDraw(points: number[], bounds: Box, init: BaseInit): DrawElement {
  return {
    ...base('draw', bounds.x, bounds.y, bounds.width, bounds.height, init),
    type: 'draw',
    points,
    closed: false
  } as DrawElement
}

export function createFrame(
  x: number,
  y: number,
  width: number,
  height: number,
  init: BaseInit,
  name = 'Frame'
): FrameElement {
  return {
    ...base('frame', x, y, width, height, init),
    type: 'frame',
    name
  } as FrameElement
}

export function createImage(
  x: number,
  y: number,
  width: number,
  height: number,
  src: string,
  naturalWidth: number,
  naturalHeight: number,
  init: BaseInit
): ImageElement {
  return {
    ...base('image', x, y, width, height, init),
    type: 'image',
    src,
    naturalWidth,
    naturalHeight
  } as ImageElement
}

export function createConnector(
  start: ConnectorEnd,
  end: ConnectorEnd,
  init: BaseInit
): ConnectorElement {
  const el = {
    ...base('connector', 0, 0, 0, 0, init),
    type: 'connector',
    start,
    end,
    shape: 'elbow',
    startArrow: 'none',
    endArrow: 'arrow',
    text: ''
  } as ConnectorElement
  el.style = { ...el.style, fill: 'transparent' }
  return el
}

export function freeEnd(x: number, y: number): ConnectorEnd {
  return { elementId: null, nx: 0.5, ny: 0.5, x, y }
}

export function boundEnd(elementId: ElementId, nx = 0.5, ny = 0.5): ConnectorEnd {
  return { elementId, nx, ny, x: 0, y: 0 }
}

// ---------------------------------------------------------------------------
// Connector geometry
// ---------------------------------------------------------------------------

export type ElementMap = Record<ElementId, BoardElement>

function anchorPoint(end: ConnectorEnd, elements: ElementMap): Vec {
  if (!end.elementId) return { x: end.x, y: end.y }
  const target = elements[end.elementId]
  if (!target) return { x: end.x, y: end.y }
  return {
    x: target.x + target.width * end.nx,
    y: target.y + target.height * end.ny
  }
}

/**
 * Resolved endpoints. An end bound to an element with the default centre
 * anchor slides to the element's edge so the arrow stops at the border rather
 * than burying its head in the middle of the shape.
 */
export function connectorPoints(
  connector: ConnectorElement,
  elements: ElementMap
): { start: Vec; end: Vec } {
  let start = anchorPoint(connector.start, elements)
  let end = anchorPoint(connector.end, elements)

  const startEl = connector.start.elementId ? elements[connector.start.elementId] : null
  const endEl = connector.end.elementId ? elements[connector.end.elementId] : null

  if (startEl && isCentreAnchor(connector.start)) {
    start = boxEdgePoint(
      { x: startEl.x, y: startEl.y, width: startEl.width, height: startEl.height },
      end
    )
  }
  if (endEl && isCentreAnchor(connector.end)) {
    end = boxEdgePoint(
      { x: endEl.x, y: endEl.y, width: endEl.width, height: endEl.height },
      start
    )
  }
  return { start, end }
}

function isCentreAnchor(end: ConnectorEnd): boolean {
  return Math.abs(end.nx - 0.5) < 1e-6 && Math.abs(end.ny - 0.5) < 1e-6
}

/** The full polyline a connector draws, including elbow bends. */
export function connectorPath(connector: ConnectorElement, elements: ElementMap): Vec[] {
  const { start, end } = connectorPoints(connector, elements)

  if (connector.shape === 'straight' || connector.shape === 'curved') {
    return [start, end]
  }

  // Elbow: route with a single mid bend along the dominant axis.
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [start, end]

  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = start.x + dx / 2
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
  }
  const midY = start.y + dy / 2
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Axis-aligned board-space bounds, accounting for rotation and connectors. */
export function elementBounds(el: BoardElement, elements: ElementMap): Box {
  if (el.type === 'connector') {
    const pts = connectorPath(el, elements)
    const box = boundsOfPoints(pts)
    // Guarantee a non-degenerate box for straight horizontal/vertical runs.
    return {
      x: box.x - 1,
      y: box.y - 1,
      width: Math.max(box.width, 2) + 1,
      height: Math.max(box.height, 2) + 1
    }
  }
  return rotatedBounds({ x: el.x, y: el.y, width: el.width, height: el.height }, el.rotation)
}

export function elementsBounds(els: BoardElement[], elements: ElementMap): Box | null {
  let box: Box | null = null
  for (const el of els) box = unionBox(box, elementBounds(el, elements))
  return box
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** Scratch context used purely for isPointInPath / text measurement. */
let scratchCtx: CanvasRenderingContext2D | null = null
export function getScratchCtx(): CanvasRenderingContext2D {
  if (!scratchCtx) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    scratchCtx = canvas.getContext('2d')!
  }
  return scratchCtx
}

export function hitTest(
  point: Vec,
  el: BoardElement,
  elements: ElementMap,
  tolerance: number
): boolean {
  if (el.type === 'connector') {
    const pts = connectorPath(el, elements)
    const threshold = Math.max(tolerance, el.style.strokeWidth / 2 + 4)
    return distanceToPolyline(point, pts) <= threshold
  }

  const local = toLocal(point, el)
  const lx = local.x - el.x
  const ly = local.y - el.y

  if (el.type === 'draw') {
    const pts = drawPoints(el)
    const threshold = Math.max(tolerance, el.style.strokeWidth / 2 + 4)
    return distanceToPolyline({ x: lx, y: ly }, pts) <= threshold
  }

  if (el.type === 'frame') {
    // Frames are only grabbable by their border and title bar, so you can
    // still select the things sitting on top of them.
    const edge = Math.max(tolerance, 6)
    const onBorder =
      lx >= -edge &&
      ly >= -edge &&
      lx <= el.width + edge &&
      ly <= el.height + edge &&
      (lx <= edge || ly <= edge || lx >= el.width - edge || ly >= el.height - edge)
    const onTitle = ly >= -28 && ly <= 0 && lx >= 0 && lx <= el.width
    return onBorder || onTitle
  }

  if (el.type === 'shape') {
    const ctx = getScratchCtx()
    const path = buildShapePath(el.shape, el.width, el.height)
    if (ctx.isPointInPath(path, lx, ly)) return true
    // Unfilled shapes should still be grabbable by their outline.
    if (el.style.fill === 'transparent') {
      ctx.lineWidth = Math.max(el.style.strokeWidth, tolerance * 2)
      return ctx.isPointInStroke(path, lx, ly)
    }
    return false
  }

  // sticky, text, image: plain rectangle in local space
  return lx >= 0 && ly >= 0 && lx <= el.width && ly <= el.height
}

/** Absolute local-space points of a freehand stroke, scaled into its box. */
export function drawPoints(el: DrawElement): Vec[] {
  const pts: Vec[] = []
  for (let i = 0; i < el.points.length; i += 3) {
    pts.push({ x: el.points[i] * el.width, y: el.points[i + 1] * el.height })
  }
  return pts
}

export function drawPressures(el: DrawElement): number[] {
  const out: number[] = []
  for (let i = 2; i < el.points.length; i += 3) out.push(el.points[i])
  return out
}

/** Packs absolute stroke samples into a normalised element. */
export function normalizeStroke(
  samples: { x: number; y: number; pressure: number }[]
): { points: number[]; bounds: Box } {
  const box = boundsOfPoints(samples)
  const width = Math.max(box.width, 1)
  const height = Math.max(box.height, 1)
  const points: number[] = []
  for (const s of samples) {
    points.push((s.x - box.x) / width, (s.y - box.y) / height, s.pressure)
  }
  return {
    points,
    bounds: { x: box.x, y: box.y, width, height }
  }
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export const ORDER_GAP = 1

export function topOrder(elements: ElementMap): number {
  let max = 0
  for (const el of Object.values(elements)) if (el.order > max) max = el.order
  return max + ORDER_GAP
}

export function bottomOrder(elements: ElementMap): number {
  let min = 0
  for (const el of Object.values(elements)) if (el.order < min) min = el.order
  return min - ORDER_GAP
}

/**
 * A fractional index strictly between two orders. Falls back to renumbering
 * upstream when doubles run out of precision.
 */
export function orderBetween(below: number | null, above: number | null): number {
  if (below === null && above === null) return 0
  if (below === null) return (above as number) - ORDER_GAP
  if (above === null) return below + ORDER_GAP
  return (below + above) / 2
}

export function needsReindex(elements: ElementMap): boolean {
  const sorted = Object.values(elements).sort((a, b) => a.order - b.order)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].order - sorted[i - 1].order < 1e-9) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

/** Deep-copies elements with fresh ids, rewiring group, frame and connector links. */
export function cloneElements(
  source: BoardElement[],
  offset: Vec = { x: 0, y: 0 }
): BoardElement[] {
  const idMap = new Map<ElementId, ElementId>()
  for (const el of source) idMap.set(el.id, newId())

  return source.map((el) => {
    const copy: BoardElement = JSON.parse(JSON.stringify(el))
    copy.id = idMap.get(el.id)!
    copy.x += offset.x
    copy.y += offset.y
    copy.groupId = el.groupId ? (idMap.get(el.groupId) ?? el.groupId) : null
    copy.parentId = el.parentId ? (idMap.get(el.parentId) ?? null) : null

    if (copy.type === 'connector') {
      for (const end of [copy.start, copy.end]) {
        if (end.elementId && idMap.has(end.elementId)) {
          end.elementId = idMap.get(end.elementId)!
        } else if (end.elementId) {
          // The bound element wasn't copied, so pin the endpoint in place.
          end.elementId = null
        }
        end.x += offset.x
        end.y += offset.y
      }
    }
    return copy
  })
}

/** Group members travel together; expands a selection to whole groups. */
export function expandGroups(ids: ElementId[], elements: ElementMap): ElementId[] {
  const groupIds = new Set<ElementId>()
  for (const id of ids) {
    const el = elements[id]
    if (el?.groupId) groupIds.add(el.groupId)
  }
  if (groupIds.size === 0) return [...new Set(ids)]
  const result = new Set(ids)
  for (const el of Object.values(elements)) {
    if (el.groupId && groupIds.has(el.groupId)) result.add(el.id)
  }
  return [...result]
}

export function elementCenter(el: BoardElement, elements: ElementMap): Vec {
  return boxCenter(elementBounds(el, elements))
}
