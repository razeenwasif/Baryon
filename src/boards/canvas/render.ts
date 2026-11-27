import getStroke from 'perfect-freehand'
import type {
  BoardBackground,
  BoardElement,
  Camera,
  ConnectorElement,
  DrawElement,
  ElementStyle,
  FrameElement,
  ImageElement,
  ShapeElement,
  StickyElement,
  TextElement
} from '../shared/document'
import { sortedElements } from '../shared/document'
import { visibleBounds } from '../core/camera'
import {
  connectorPath,
  drawPoints,
  elementBounds,
  type ElementMap
} from '../core/elements'
import { boxesIntersect, catmullRomToBezier, type Box, type Vec } from '../core/geometry'
import { contrastText, shade, withAlpha } from '../core/palette'
import { buildShapePath, SHAPE_TEXT_INSET } from '../core/shapes'
import {
  fontString,
  horizontalAnchor,
  layoutText,
  layoutTextToFit,
  verticalOffset
} from '../core/text'
import { canvasTheme, resolveInk } from '../core/theme'
import { getImage } from './imageCache'

/** The board's paper colour under the current theme. */
export function boardBackground(): string {
  return canvasTheme().background
}

export interface RenderOptions {
  ctx: CanvasRenderingContext2D
  /** Viewport size in CSS pixels. */
  width: number
  height: number
  /**
   * Backing-store pixels per CSS pixel. The screen canvas passes
   * devicePixelRatio; the PNG exporter passes its export scale.
   */
  pixelRatio?: number
  camera: Camera
  elements: ElementMap
  background: BoardBackground
  showGrid: boolean
  /** Elements suppressed because a DOM editor is drawn over them instead. */
  hiddenIds?: Set<string>
  /** Element whose label is being edited in a DOM overlay, so canvas skips it. */
  hideTextFor?: string | null
  /** Skip the board background fill (used when exporting transparent PNGs). */
  transparent?: boolean
}

export function renderScene(options: RenderOptions): void {
  const { ctx, width, height, camera, elements, showGrid, background, transparent } = options
  const pr = options.pixelRatio ?? 1

  ctx.save()
  ctx.setTransform(pr, 0, 0, pr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!transparent) {
    ctx.fillStyle = canvasTheme().background
    ctx.fillRect(0, 0, width, height)
    if (showGrid && background !== 'plain') {
      drawBackground(ctx, camera, width, height, background)
    }
  }

  ctx.setTransform(
    pr * camera.zoom,
    0,
    0,
    pr * camera.zoom,
    -camera.x * camera.zoom * pr,
    -camera.y * camera.zoom * pr
  )

  const view = visibleBounds(camera, width, height)
  const margin = 200 / camera.zoom
  const cullBox: Box = {
    x: view.x - margin,
    y: view.y - margin,
    width: view.width + margin * 2,
    height: view.height + margin * 2
  }

  const hidden = options.hiddenIds
  for (const el of sortedElements(elements)) {
    if (hidden?.has(el.id)) continue
    if (!boxesIntersect(elementBounds(el, elements), cullBox)) continue
    // The inline editor draws the live text, so the canvas leaves it blank.
    const paint =
      options.hideTextFor === el.id && 'text' in el ? { ...el, text: '' } : el
    drawElement(ctx, paint as BoardElement, elements, camera.zoom)
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function drawBackground(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  background: BoardBackground
): void {
  // Pick a spacing that stays visually constant as you zoom.
  let spacing = 40
  while (spacing * camera.zoom < 18) spacing *= 2
  while (spacing * camera.zoom > 90) spacing /= 2

  const step = spacing * camera.zoom
  const offsetX = -((camera.x * camera.zoom) % step)
  const offsetY = -((camera.y * camera.zoom) % step)

  const theme = canvasTheme()

  if (background === 'dots') {
    const radius = Math.min(1.6, Math.max(0.7, camera.zoom))
    ctx.fillStyle = theme.grid
    for (let x = offsetX; x < width + step; x += step) {
      for (let y = offsetY; y < height + step; y += step) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    return
  }

  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.globalAlpha = theme.gridAlpha
  ctx.beginPath()
  for (let y = offsetY; y < height + step; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(width, Math.round(y) + 0.5)
  }
  if (background === 'grid') {
    for (let x = offsetX; x < width + step; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, height)
    }
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  elements: ElementMap,
  zoom: number
): void {
  ctx.save()
  ctx.globalAlpha = el.opacity

  if (el.type === 'connector') {
    drawConnector(ctx, el, elements, zoom)
    ctx.restore()
    return
  }

  ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
  if (el.rotation) ctx.rotate(el.rotation)
  ctx.translate(-el.width / 2, -el.height / 2)

  switch (el.type) {
    case 'frame':
      drawFrame(ctx, el, zoom)
      break
    case 'shape':
      drawShape(ctx, el)
      break
    case 'sticky':
      drawSticky(ctx, el)
      break
    case 'text':
      drawTextElement(ctx, el)
      break
    case 'draw':
      drawFreehand(ctx, el)
      break
    case 'image':
      drawImageElement(ctx, el)
      break
  }

  ctx.restore()
}

function applyStroke(ctx: CanvasRenderingContext2D, style: ElementStyle): boolean {
  if (style.stroke === 'transparent' || style.strokeWidth <= 0) return false
  ctx.strokeStyle = resolveInk(style.stroke)
  ctx.lineWidth = style.strokeWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const w = style.strokeWidth
  if (style.strokeStyle === 'dashed') ctx.setLineDash([w * 3, w * 2.2])
  else if (style.strokeStyle === 'dotted') ctx.setLineDash([0.1, w * 2.2])
  else ctx.setLineDash([])
  return true
}

function drawFrame(ctx: CanvasRenderingContext2D, el: FrameElement, zoom: number): void {
  const theme = canvasTheme()
  ctx.fillStyle = el.style.fill === 'transparent' ? theme.background : el.style.fill
  ctx.fillRect(0, 0, el.width, el.height)

  ctx.setLineDash([])
  ctx.strokeStyle = theme.frameBorder
  ctx.lineWidth = 1 / zoom
  ctx.strokeRect(0, 0, el.width, el.height)

  // The label sits just above the frame and keeps a constant screen size.
  const fontSize = Math.min(20, 13 / zoom)
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = theme.frameLabel
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(el.name, 0, -6 / zoom)
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement): void {
  const path = buildShapePath(el.shape, el.width, el.height)

  if (el.style.fill !== 'transparent') {
    ctx.fillStyle = el.style.fill
    ctx.fill(path)
  }
  if (applyStroke(ctx, el.style)) {
    ctx.stroke(path)
    ctx.setLineDash([])
  }

  if (el.text) {
    const inset = SHAPE_TEXT_INSET[el.shape] ?? { x: 0.08, y: 0.08 }
    drawBoxText(ctx, el.text, el.style, {
      x: el.width * inset.x,
      y: el.height * inset.y,
      width: el.width * (1 - inset.x * 2),
      height: el.height * (1 - inset.y * 2)
    })
  }
}

const STICKY_PADDING = 14

function drawSticky(ctx: CanvasRenderingContext2D, el: StickyElement): void {
  // Hand-rolled drop shadow: canvas shadows scale with the camera transform,
  // which makes notes look blurry when zoomed in.
  ctx.fillStyle = 'rgba(15, 23, 42, 0.10)'
  ctx.fillRect(2, 4, el.width, el.height)

  ctx.fillStyle = el.style.fill === 'transparent' ? '#FFF9B1' : el.style.fill
  ctx.fillRect(0, 0, el.width, el.height)

  ctx.fillStyle = withAlpha(shade(el.style.fill, -0.12), 0.55)
  ctx.fillRect(0, el.height - 2, el.width, 2)

  if (applyStroke(ctx, { ...el.style, stroke: el.style.stroke })) {
    ctx.strokeRect(0, 0, el.width, el.height)
    ctx.setLineDash([])
  }

  if (el.text) {
    const style: ElementStyle = {
      ...el.style,
      // A note's text must contrast with the note, not with the board.
      textColor: stickyInk(el.style.textColor, el.style.fill)
    }
    drawBoxText(ctx, el.text, style, {
      x: STICKY_PADDING,
      y: STICKY_PADDING,
      width: el.width - STICKY_PADDING * 2,
      height: el.height - STICKY_PADDING * 2
    }, true)
  }
}

/** Sticky text falls back to whatever contrasts with the note's own colour. */
export function stickyInk(textColor: string, fill: string): string {
  return !textColor || textColor === 'auto' ? contrastText(fill) : textColor
}

function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement): void {
  if (el.style.fill !== 'transparent') {
    ctx.fillStyle = el.style.fill
    ctx.fillRect(0, 0, el.width, el.height)
  }
  if (!el.text) return
  drawBoxText(ctx, el.text, el.style, {
    x: 0,
    y: 0,
    width: el.width,
    height: el.height
  })
}

function drawBoxText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: ElementStyle,
  box: Box,
  shrinkToFit = false
): void {
  if (box.width <= 0) return
  const layout = shrinkToFit
    ? layoutTextToFit(ctx, text, style, box.width, box.height)
    : layoutText(ctx, text, style, box.width)

  const ink = resolveInk(style.textColor)
  ctx.font = fontString(style, layout.fontSize)
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'

  const anchor = horizontalAnchor(style.textAlign, box.width)
  ctx.textAlign = anchor.textAlign

  const top = box.y + verticalOffset(style.verticalAlign, layout.height, box.height)
  const x = box.x + anchor.x

  layout.lines.forEach((line, i) => {
    const y = top + i * layout.lineHeight + layout.lineHeight / 2
    ctx.fillText(line, x, y)
    if (style.underline && line) {
      const metrics = ctx.measureText(line)
      const lineWidth = metrics.width
      const startX =
        anchor.textAlign === 'center'
          ? x - lineWidth / 2
          : anchor.textAlign === 'right'
            ? x - lineWidth
            : x
      ctx.save()
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(1, layout.fontSize * 0.06)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(startX, y + layout.fontSize * 0.42)
      ctx.lineTo(startX + lineWidth, y + layout.fontSize * 0.42)
      ctx.stroke()
      ctx.restore()
    }
  })
}

function drawFreehand(ctx: CanvasRenderingContext2D, el: DrawElement): void {
  if (el.points.length < 3) return

  const inputs: [number, number, number][] = []
  for (let i = 0; i < el.points.length; i += 3) {
    inputs.push([el.points[i] * el.width, el.points[i + 1] * el.height, el.points[i + 2]])
  }

  const outline = getStroke(inputs, {
    size: el.style.strokeWidth * 2.2,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: false,
    last: true
  })

  if (outline.length < 3) return
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]
    const [x1, y1] = outline[i]
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  ctx.closePath()
  ctx.fillStyle =
    el.style.stroke === 'transparent' ? resolveInk('auto') : resolveInk(el.style.stroke)
  ctx.fill()
}

function drawImageElement(ctx: CanvasRenderingContext2D, el: ImageElement): void {
  const image = getImage(el.src)
  if (!image) {
    ctx.fillStyle = canvasTheme().placeholderFill
    ctx.fillRect(0, 0, el.width, el.height)
    ctx.fillStyle = canvasTheme().placeholderText
    ctx.font = '13px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Loading image…', el.width / 2, el.height / 2)
    return
  }
  ctx.drawImage(image, 0, 0, el.width, el.height)
  if (applyStroke(ctx, el.style)) {
    ctx.strokeRect(0, 0, el.width, el.height)
    ctx.setLineDash([])
  }
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

function drawConnector(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  elements: ElementMap,
  zoom: number
): void {
  const points = connectorPath(el, elements)
  if (points.length < 2) return

  const stroke =
    el.style.stroke === 'transparent' ? resolveInk('auto') : resolveInk(el.style.stroke)
  ctx.strokeStyle = stroke
  ctx.fillStyle = stroke
  ctx.lineWidth = el.style.strokeWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const w = el.style.strokeWidth
  if (el.style.strokeStyle === 'dashed') ctx.setLineDash([w * 3, w * 2.2])
  else if (el.style.strokeStyle === 'dotted') ctx.setLineDash([0.1, w * 2.2])
  else ctx.setLineDash([])

  ctx.beginPath()
  if (el.shape === 'curved' && points.length === 2) {
    const [a, b] = points
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // Bow the curve perpendicular to the run, Miro-style.
    const nx = -(b.y - a.y)
    const ny = b.x - a.x
    const length = Math.hypot(nx, ny) || 1
    const bow = Math.min(80, length * 0.22)
    ctx.moveTo(a.x, a.y)
    ctx.quadraticCurveTo(mx + (nx / length) * bow, my + (ny / length) * bow, b.x, b.y)
  } else if (el.shape === 'elbow' && points.length > 2) {
    const radius = 10
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length - 1; i++) {
      ctx.arcTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, radius)
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
  } else {
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  const size = Math.max(9, el.style.strokeWidth * 4)
  if (el.endArrow !== 'none') {
    drawArrowHead(ctx, points[points.length - 2], points[points.length - 1], el.endArrow, size)
  }
  if (el.startArrow !== 'none') {
    drawArrowHead(ctx, points[1], points[0], el.startArrow, size)
  }

  if (el.text) {
    drawConnectorLabel(ctx, el, points, zoom)
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: Vec,
  to: Vec,
  kind: ConnectorElement['endArrow'],
  size: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)

  ctx.save()
  ctx.translate(to.x, to.y)
  ctx.rotate(angle)
  ctx.setLineDash([])
  ctx.beginPath()

  switch (kind) {
    case 'arrow':
      ctx.moveTo(-size, -size * 0.55)
      ctx.lineTo(0, 0)
      ctx.lineTo(-size, size * 0.55)
      ctx.lineWidth = Math.max(1.5, size * 0.18)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      break
    case 'triangle':
      ctx.moveTo(0, 0)
      ctx.lineTo(-size, -size * 0.55)
      ctx.lineTo(-size, size * 0.55)
      ctx.closePath()
      ctx.fill()
      break
    case 'circle':
      ctx.arc(-size * 0.4, 0, size * 0.42, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'diamond':
      ctx.moveTo(0, 0)
      ctx.lineTo(-size * 0.5, -size * 0.42)
      ctx.lineTo(-size, 0)
      ctx.lineTo(-size * 0.5, size * 0.42)
      ctx.closePath()
      ctx.fill()
      break
  }
  ctx.restore()
}

/** Midpoint of a polyline, used to anchor a connector's label. */
export function polylineMidpoint(points: Vec[]): Vec {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  let travelled = 0
  const half = total / 2
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (travelled + seg >= half) {
      const t = seg === 0 ? 0 : (half - travelled) / seg
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t
      }
    }
    travelled += seg
  }
  return points[points.length - 1]
}

function drawConnectorLabel(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  points: Vec[],
  _zoom: number
): void {
  const mid = polylineMidpoint(points)
  ctx.font = fontString(el.style)
  const metrics = ctx.measureText(el.text)
  const padX = 6
  const padY = 4
  const height = el.style.fontSize * 1.2

  // The label knocks a hole in the line so the text stays readable.
  ctx.fillStyle = canvasTheme().background
  ctx.fillRect(
    mid.x - metrics.width / 2 - padX,
    mid.y - height / 2 - padY,
    metrics.width + padX * 2,
    height + padY * 2
  )
  ctx.fillStyle = resolveInk(el.style.textColor)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(el.text, mid.x, mid.y)
}

/** Exposed for the SVG exporter, which needs the same smoothing. */
export { catmullRomToBezier, drawPoints }
