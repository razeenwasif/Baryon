import type { BoardElement, Camera, ConnectorElement } from '../shared/document'
import { isResizable, isRotatable } from '../shared/document'
import { boardToScreen } from '../core/camera'
import { connectorPath, elementBounds, elementsBounds, type ElementMap } from '../core/elements'
import { rotatePoint, type Box, type Vec } from '../core/geometry'
import { canvasTheme } from '../core/theme'

export const ACCENT = '#4262FF'
const HOVER_STROKE = 'rgba(66, 98, 255, 0.55)'
const HANDLE_SIZE = 8
const ROTATE_OFFSET = 22

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

export const CORNER_HANDLES: HandleId[] = ['nw', 'ne', 'se', 'sw']
export const EDGE_HANDLES: HandleId[] = ['n', 'e', 's', 'w']

export interface SelectionFrame {
  box: Box
  rotation: number
}

/**
 * A single selected element keeps its own rotation so the handles hug it;
 * a multi-selection falls back to an axis-aligned union box.
 */
export function selectionFrame(
  selected: BoardElement[],
  elements: ElementMap
): SelectionFrame | null {
  if (selected.length === 0) return null
  if (selected.length === 1) {
    const el = selected[0]
    if (el.type === 'connector') {
      return { box: elementBounds(el, elements), rotation: 0 }
    }
    return {
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
      rotation: el.rotation
    }
  }
  const box = elementsBounds(selected, elements)
  return box ? { box, rotation: 0 } : null
}

/** Handle centres in board space. */
export function handlePoints(frame: SelectionFrame): Record<HandleId, Vec> {
  const { box, rotation } = frame
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const raw: Record<HandleId, Vec> = {
    nw: { x: box.x, y: box.y },
    n: { x: center.x, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    e: { x: box.x + box.width, y: center.y },
    se: { x: box.x + box.width, y: box.y + box.height },
    s: { x: center.x, y: box.y + box.height },
    sw: { x: box.x, y: box.y + box.height },
    w: { x: box.x, y: center.y },
    rotate: { x: center.x, y: box.y }
  }
  const out = {} as Record<HandleId, Vec>
  for (const key of Object.keys(raw) as HandleId[]) {
    out[key] = rotation ? rotatePoint(raw[key], center, rotation) : raw[key]
  }
  return out
}

/** Handle centres in screen space, with the rotate grip pushed clear of the box. */
export function screenHandles(
  frame: SelectionFrame,
  camera: Camera
): Record<HandleId, Vec> {
  const board = handlePoints(frame)
  const out = {} as Record<HandleId, Vec>
  for (const key of Object.keys(board) as HandleId[]) {
    out[key] = boardToScreen(board[key], camera)
  }
  // Push the rotate grip outward along the box's local "up" direction.
  const up = { x: Math.sin(frame.rotation), y: -Math.cos(frame.rotation) }
  out.rotate = {
    x: out.n.x + up.x * ROTATE_OFFSET,
    y: out.n.y + up.y * ROTATE_OFFSET
  }
  return out
}

export interface OverlayOptions {
  ctx: CanvasRenderingContext2D
  /** Backing-store pixels per CSS pixel; the overlay is drawn in CSS pixels. */
  pixelRatio?: number
  camera: Camera
  elements: ElementMap
  selected: BoardElement[]
  hovered: BoardElement | null
  marquee: Box | null
  guides: Guide[]
  /** Live connector being dragged out, in board space. */
  connectorDraft: { points: Vec[]; targetId: string | null } | null
  /** Anchor dots shown on the element under the cursor while wiring. */
  anchorHost: BoardElement | null
  editingId: string | null
  showHandles: boolean
}

export interface Guide {
  /** Board-space line. */
  from: Vec
  to: Vec
  kind: 'align' | 'spacing'
  label?: string
}

export function renderOverlay(options: OverlayOptions): void {
  const { ctx, camera, elements, selected, hovered, marquee, guides } = options

  const pr = options.pixelRatio ?? 1
  ctx.save()
  ctx.setTransform(pr, 0, 0, pr, 0, 0)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (hovered && !selected.some((el) => el.id === hovered.id)) {
    strokeElementOutline(ctx, hovered, elements, camera, HOVER_STROKE, 1.5)
  }

  for (const guide of guides) {
    const a = boardToScreen(guide.from, camera)
    const b = boardToScreen(guide.to, camera)
    ctx.strokeStyle = guide.kind === 'align' ? '#FF3D71' : '#12B886'
    ctx.lineWidth = 1
    ctx.setLineDash(guide.kind === 'align' ? [] : [4, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (options.anchorHost) {
    drawAnchorDots(ctx, options.anchorHost, camera)
  }

  if (options.connectorDraft) {
    const pts = options.connectorDraft.points.map((p) => boardToScreen(p, camera))
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Per-element outlines when several things are selected.
  if (selected.length > 1) {
    for (const el of selected) {
      strokeElementOutline(ctx, el, elements, camera, 'rgba(66, 98, 255, 0.7)', 1)
    }
  }

  const frame = selectionFrame(selected, elements)
  if (frame && options.editingId === null) {
    drawSelectionFrame(ctx, frame, camera, selected, elements, options.showHandles)
  }

  if (marquee) {
    const a = boardToScreen({ x: marquee.x, y: marquee.y }, camera)
    const b = boardToScreen(
      { x: marquee.x + marquee.width, y: marquee.y + marquee.height },
      camera
    )
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    ctx.fillStyle = 'rgba(66, 98, 255, 0.10)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  }

  ctx.restore()
}

function strokeElementOutline(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  elements: ElementMap,
  camera: Camera,
  color: string,
  width: number
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash([])

  if (el.type === 'connector') {
    const pts = connectorPath(el, elements).map((p) => boardToScreen(p, camera))
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    return
  }

  const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
  const corners = [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height }
  ].map((p) => boardToScreen(rotatePoint(p, center, el.rotation), camera))

  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()
}

function drawSelectionFrame(
  ctx: CanvasRenderingContext2D,
  frame: SelectionFrame,
  camera: Camera,
  selected: BoardElement[],
  elements: ElementMap,
  showHandles: boolean
): void {
  const handles = screenHandles(frame, camera)
  const outline = [handles.nw, handles.ne, handles.se, handles.sw]

  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(outline[0].x, outline[0].y)
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y)
  ctx.closePath()
  ctx.stroke()

  if (!showHandles) return

  const single = selected.length === 1 ? selected[0] : null
  const locked = selected.some((el) => el.locked)
  if (locked) return

  if (single?.type === 'connector') {
    drawConnectorHandles(ctx, single, elements, camera)
    return
  }

  const canResize = selected.every(isResizable)
  const canRotate = selected.every(isRotatable)

  if (canRotate) {
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(handles.n.x, handles.n.y)
    ctx.lineTo(handles.rotate.x, handles.rotate.y)
    ctx.stroke()
    drawHandleCircle(ctx, handles.rotate, 5)
  }

  if (!canResize) return

  const size = frameScreenSize(handles)
  const showEdges = size.width > 44 && size.height > 44
  for (const id of CORNER_HANDLES) drawHandleSquare(ctx, handles[id])
  if (showEdges) for (const id of EDGE_HANDLES) drawHandleSquare(ctx, handles[id])
}

function frameScreenSize(handles: Record<HandleId, Vec>): { width: number; height: number } {
  return {
    width: Math.hypot(handles.ne.x - handles.nw.x, handles.ne.y - handles.nw.y),
    height: Math.hypot(handles.sw.x - handles.nw.x, handles.sw.y - handles.nw.y)
  }
}

function drawHandleSquare(ctx: CanvasRenderingContext2D, p: Vec): void {
  const half = HANDLE_SIZE / 2
  ctx.fillStyle = canvasTheme().handleFill
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.rect(p.x - half, p.y - half, HANDLE_SIZE, HANDLE_SIZE)
  ctx.fill()
  ctx.stroke()
}

function drawHandleCircle(ctx: CanvasRenderingContext2D, p: Vec, radius: number): void {
  ctx.fillStyle = canvasTheme().handleFill
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawConnectorHandles(
  ctx: CanvasRenderingContext2D,
  connector: ConnectorElement,
  elements: ElementMap,
  camera: Camera
): void {
  const pts = connectorPath(connector, elements)
  const ends = [pts[0], pts[pts.length - 1]]
  for (const end of ends) {
    drawHandleCircle(ctx, boardToScreen(end, camera), 5.5)
  }
}

/** Screen-space positions of a connector's draggable endpoints. */
export function connectorEndHandles(
  connector: ConnectorElement,
  elements: ElementMap,
  camera: Camera
): { start: Vec; end: Vec } {
  const pts = connectorPath(connector, elements)
  return {
    start: boardToScreen(pts[0], camera),
    end: boardToScreen(pts[pts.length - 1], camera)
  }
}

/** The four edge midpoints plus centre where a connector can latch on. */
export const ANCHOR_POINTS: { nx: number; ny: number }[] = [
  { nx: 0.5, ny: 0 },
  { nx: 1, ny: 0.5 },
  { nx: 0.5, ny: 1 },
  { nx: 0, ny: 0.5 }
]

function drawAnchorDots(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  camera: Camera
): void {
  for (const anchor of ANCHOR_POINTS) {
    const p = boardToScreen(
      { x: el.x + el.width * anchor.nx, y: el.y + el.height * anchor.ny },
      camera
    )
    ctx.fillStyle = ACCENT
    ctx.strokeStyle = canvasTheme().handleFill
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

export const CURSOR_FOR_HANDLE: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  rotate: 'grab'
}

/** Rotation-aware cursor so the handle under a rotated box still reads right. */
export function cursorForHandle(handle: HandleId, rotation: number): string {
  if (handle === 'rotate') return 'grab'
  const order: HandleId[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
  const index = order.indexOf(handle)
  if (index === -1) return 'default'
  const steps = Math.round(rotation / (Math.PI / 4))
  const rotated = order[(index + steps + order.length * 4) % order.length]
  return CURSOR_FOR_HANDLE[rotated]
}

export function hitHandle(
  point: Vec,
  frame: SelectionFrame,
  camera: Camera,
  includeEdges = true
): HandleId | null {
  const handles = screenHandles(frame, camera)
  const size = frameScreenSize(handles)
  const showEdges = includeEdges && size.width > 44 && size.height > 44
  const candidates: HandleId[] = [
    'rotate',
    ...CORNER_HANDLES,
    ...(showEdges ? EDGE_HANDLES : [])
  ]
  const tolerance = HANDLE_SIZE
  for (const id of candidates) {
    const h = handles[id]
    if (Math.abs(point.x - h.x) <= tolerance && Math.abs(point.y - h.y) <= tolerance) {
      return id
    }
  }
  return null
}

export { HANDLE_SIZE }
