import getStroke from 'perfect-freehand'
import type { BoardDocument, BoardElement, ConnectorElement, ElementStyle } from '../shared/document'
import { sortedElements } from '../shared/document'
import { connectorPath, elementsBounds, getScratchCtx, type ElementMap } from '../core/elements'
import type { Box, Vec } from '../core/geometry'
import { buildShape, SHAPE_TEXT_INSET } from '../core/shapes'
import { FONT_STACKS } from '../core/palette'
import { layoutText, layoutTextToFit, verticalOffset } from '../core/text'
import { renderScene, polylineMidpoint, boardBackground, stickyInk } from '../canvas/render'
import { canvasTheme, resolveInk } from '../core/theme'
import { preloadAll } from '../canvas/imageCache'
import { SvgPathSink } from './svgPath'

export interface ExportArea {
  bounds: Box
  elements: ElementMap
}

const PADDING = 40

/** Bounds of the whole board, or of a subset when exporting a selection. */
export function exportArea(doc: BoardDocument, onlyIds?: string[]): ExportArea | null {
  const source =
    onlyIds && onlyIds.length > 0
      ? Object.fromEntries(
          Object.entries(doc.elements).filter(([id]) => onlyIds.includes(id))
        )
      : doc.elements

  const all = Object.values(source)
  if (all.length === 0) return null
  const bounds = elementsBounds(all, doc.elements)
  if (!bounds) return null

  return {
    elements: source,
    bounds: {
      x: bounds.x - PADDING,
      y: bounds.y - PADDING,
      width: bounds.width + PADDING * 2,
      height: bounds.height + PADDING * 2
    }
  }
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

export interface PngOptions {
  scale?: number
  transparent?: boolean
  /** Max pixels along either edge, to stay inside canvas size limits. */
  maxDimension?: number
}

export async function exportPng(
  doc: BoardDocument,
  area: ExportArea,
  options: PngOptions = {}
): Promise<string> {
  const { transparent = false, maxDimension = 8192 } = options
  let scale = options.scale ?? 2

  const longest = Math.max(area.bounds.width, area.bounds.height) * scale
  if (longest > maxDimension) scale *= maxDimension / longest

  const width = Math.max(1, Math.round(area.bounds.width * scale))
  const height = Math.max(1, Math.round(area.bounds.height * scale))

  // Images decode asynchronously; the export must wait for all of them.
  await preloadAll(
    Object.values(area.elements)
      .filter((el): el is Extract<BoardElement, { type: 'image' }> => el.type === 'image')
      .map((el) => el.src)
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create an export canvas.')

  renderScene({
    ctx,
    width: area.bounds.width,
    height: area.bounds.height,
    pixelRatio: scale,
    camera: { x: area.bounds.x, y: area.bounds.y, zoom: 1 },
    elements: area.elements,
    background: doc.background,
    showGrid: false,
    transparent
  })

  return canvas.toDataURL('image/png').split(',')[1]
}

// ---------------------------------------------------------------------------
// Vector
// ---------------------------------------------------------------------------

export function exportSvg(doc: BoardDocument, area: ExportArea): string {
  const { bounds, elements } = area
  const body: string[] = []

  for (const el of sortedElements(elements)) {
    body.push(elementToSvg(el, elements))
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(bounds.width)}" height="${round(
      bounds.height
    )}" viewBox="${round(bounds.x)} ${round(bounds.y)} ${round(bounds.width)} ${round(
      bounds.height
    )}">`,
    `<rect x="${round(bounds.x)}" y="${round(bounds.y)}" width="${round(
      bounds.width
    )}" height="${round(bounds.height)}" fill="${boardBackground()}"/>`,
    ...body.filter(Boolean),
    `</svg>`
  ].join('\n')
}

function elementToSvg(el: BoardElement, elements: ElementMap): string {
  if (el.type === 'connector') return connectorToSvg(el, elements)

  const transform = el.rotation
    ? ` transform="rotate(${round((el.rotation * 180) / Math.PI)} ${round(
        el.x + el.width / 2
      )} ${round(el.y + el.height / 2)})"`
    : ''
  const opacity = el.opacity < 1 ? ` opacity="${round(el.opacity)}"` : ''
  const inner: string[] = []

  switch (el.type) {
    case 'frame':
      inner.push(
        `<rect x="${round(el.x)}" y="${round(el.y)}" width="${round(el.width)}" height="${round(
          el.height
        )}" fill="${
          el.style.fill === 'transparent' ? canvasTheme().background : el.style.fill
        }" stroke="${canvasTheme().frameBorder}"/>`,
        `<text x="${round(el.x)}" y="${round(el.y - 6)}" font-family="${escapeAttr(
          FONT_STACKS.sans
        )}" font-size="13" font-weight="600" fill="${canvasTheme().frameLabel}">${escapeText(
          el.name
        )}</text>`
      )
      break

    case 'shape': {
      const sink = new SvgPathSink()
      buildShape(sink, el.shape, el.width, el.height)
      inner.push(
        `<path d="${sink.d}" transform="translate(${round(el.x)} ${round(el.y)})" ${fillAttr(
          el.style
        )} ${strokeAttrs(el.style)}/>`
      )
      const inset = SHAPE_TEXT_INSET[el.shape] ?? { x: 0.08, y: 0.08 }
      inner.push(
        textToSvg(el.text, el.style, {
          x: el.x + el.width * inset.x,
          y: el.y + el.height * inset.y,
          width: el.width * (1 - inset.x * 2),
          height: el.height * (1 - inset.y * 2)
        })
      )
      break
    }

    case 'sticky': {
      inner.push(
        `<rect x="${round(el.x)}" y="${round(el.y)}" width="${round(el.width)}" height="${round(
          el.height
        )}" fill="${el.style.fill}" ${strokeAttrs(el.style)}/>`
      )
      inner.push(
        textToSvg(
          el.text,
          el.style,
          {
            x: el.x + 14,
            y: el.y + 14,
            width: el.width - 28,
            height: el.height - 28
          },
          true,
          stickyInk(el.style.textColor, el.style.fill)
        )
      )
      break
    }

    case 'text':
      if (el.style.fill !== 'transparent') {
        inner.push(
          `<rect x="${round(el.x)}" y="${round(el.y)}" width="${round(
            el.width
          )}" height="${round(el.height)}" fill="${el.style.fill}"/>`
        )
      }
      inner.push(
        textToSvg(el.text, el.style, {
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height
        })
      )
      break

    case 'draw': {
      const inputs: [number, number, number][] = []
      for (let i = 0; i < el.points.length; i += 3) {
        inputs.push([
          el.x + el.points[i] * el.width,
          el.y + el.points[i + 1] * el.height,
          el.points[i + 2]
        ])
      }
      const outline = getStroke(inputs, {
        size: el.style.strokeWidth * 2.2,
        thinning: 0.55,
        smoothing: 0.6,
        streamline: 0.45,
        simulatePressure: false,
        last: true
      })
      if (outline.length > 2) {
        const d =
          outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`).join(' ') +
          ' Z'
        inner.push(
          `<path d="${d}" fill="${
            el.style.stroke === 'transparent'
              ? resolveInk('auto')
              : resolveInk(el.style.stroke)
          }"/>`
        )
      }
      break
    }

    case 'image':
      inner.push(
        `<image x="${round(el.x)}" y="${round(el.y)}" width="${round(
          el.width
        )}" height="${round(el.height)}" href="${escapeAttr(
          el.src
        )}" preserveAspectRatio="none"/>`
      )
      break
  }

  return `<g${transform}${opacity}>${inner.filter(Boolean).join('')}</g>`
}

function connectorToSvg(el: ConnectorElement, elements: ElementMap): string {
  const points = connectorPath(el, elements)
  if (points.length < 2) return ''
  const stroke =
    el.style.stroke === 'transparent' ? resolveInk('auto') : resolveInk(el.style.stroke)

  let d: string
  if (el.shape === 'curved' && points.length === 2) {
    const [a, b] = points
    const nx = -(b.y - a.y)
    const ny = b.x - a.x
    const length = Math.hypot(nx, ny) || 1
    const bow = Math.min(80, length * 0.22)
    const cxp = (a.x + b.x) / 2 + (nx / length) * bow
    const cyp = (a.y + b.y) / 2 + (ny / length) * bow
    d = `M ${round(a.x)} ${round(a.y)} Q ${round(cxp)} ${round(cyp)} ${round(b.x)} ${round(b.y)}`
  } else {
    d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ')
  }

  const parts = [
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${el.style.strokeWidth}" ${dashAttr(
      el.style
    )} stroke-linecap="round" stroke-linejoin="round"/>`
  ]

  const size = Math.max(9, el.style.strokeWidth * 4)
  if (el.endArrow !== 'none') {
    parts.push(arrowSvg(points[points.length - 2], points[points.length - 1], el.endArrow, size, stroke))
  }
  if (el.startArrow !== 'none') {
    parts.push(arrowSvg(points[1], points[0], el.startArrow, size, stroke))
  }

  if (el.text) {
    const mid = polylineMidpoint(points)
    parts.push(
      `<text x="${round(mid.x)}" y="${round(mid.y)}" text-anchor="middle" dominant-baseline="middle" ${fontAttrs(
        el.style
      )} fill="${resolveInk(el.style.textColor)}">${escapeText(el.text)}</text>`
    )
  }

  const opacity = el.opacity < 1 ? ` opacity="${round(el.opacity)}"` : ''
  return `<g${opacity}>${parts.join('')}</g>`
}

function arrowSvg(
  from: Vec,
  to: Vec,
  kind: ConnectorElement['endArrow'],
  size: number,
  color: string
): string {
  const angleDeg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  const transform = `translate(${round(to.x)} ${round(to.y)}) rotate(${round(angleDeg)})`

  switch (kind) {
    case 'arrow':
      return `<path d="M ${round(-size)} ${round(-size * 0.55)} L 0 0 L ${round(-size)} ${round(
        size * 0.55
      )}" fill="none" stroke="${color}" stroke-width="${round(
        Math.max(1.5, size * 0.18)
      )}" stroke-linecap="round" stroke-linejoin="round" transform="${transform}"/>`
    case 'triangle':
      return `<path d="M 0 0 L ${round(-size)} ${round(-size * 0.55)} L ${round(-size)} ${round(
        size * 0.55
      )} Z" fill="${color}" transform="${transform}"/>`
    case 'circle':
      return `<circle cx="${round(-size * 0.4)}" cy="0" r="${round(
        size * 0.42
      )}" fill="${color}" transform="${transform}"/>`
    case 'diamond':
      return `<path d="M 0 0 L ${round(-size * 0.5)} ${round(-size * 0.42)} L ${round(
        -size
      )} 0 L ${round(-size * 0.5)} ${round(size * 0.42)} Z" fill="${color}" transform="${transform}"/>`
    default:
      return ''
  }
}

function textToSvg(
  text: string,
  style: ElementStyle,
  box: Box,
  shrinkToFit = false,
  ink: string = resolveInk(style.textColor)
): string {
  if (!text) return ''
  const ctx = getScratchCtx()
  const layout = shrinkToFit
    ? layoutTextToFit(ctx, text, style, box.width, box.height)
    : layoutText(ctx, text, style, box.width)

  const anchor =
    style.textAlign === 'left' ? 'start' : style.textAlign === 'right' ? 'end' : 'middle'
  const x =
    style.textAlign === 'left'
      ? box.x
      : style.textAlign === 'right'
        ? box.x + box.width
        : box.x + box.width / 2
  const top = box.y + verticalOffset(style.verticalAlign, layout.height, box.height)

  return layout.lines
    .map((line, i) => {
      if (!line) return ''
      const y = top + i * layout.lineHeight + layout.lineHeight / 2
      return `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" dominant-baseline="middle" ${fontAttrs(
        style,
        layout.fontSize
      )} fill="${ink}"${
        style.underline ? ' text-decoration="underline"' : ''
      }>${escapeText(line)}</text>`
    })
    .join('')
}

function fontAttrs(style: ElementStyle, fontSize = style.fontSize): string {
  return [
    `font-family="${escapeAttr(FONT_STACKS[style.fontFamily] ?? FONT_STACKS.sans)}"`,
    `font-size="${round(fontSize)}"`,
    style.bold ? 'font-weight="700"' : '',
    style.italic ? 'font-style="italic"' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function fillAttr(style: ElementStyle): string {
  return `fill="${style.fill === 'transparent' ? 'none' : style.fill}"`
}

function strokeAttrs(style: ElementStyle): string {
  if (style.stroke === 'transparent' || style.strokeWidth <= 0) return 'stroke="none"'
  return `stroke="${resolveInk(style.stroke)}" stroke-width="${style.strokeWidth}" ${dashAttr(
    style
  )} stroke-linejoin="round" stroke-linecap="round"`
}

function dashAttr(style: ElementStyle): string {
  const w = style.strokeWidth
  if (style.strokeStyle === 'dashed') return `stroke-dasharray="${w * 3} ${w * 2.2}"`
  if (style.strokeStyle === 'dotted') return `stroke-dasharray="0.1 ${w * 2.2}"`
  return ''
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
