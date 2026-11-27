/**
 * The board document model.
 *
 * Design constraint: this is CRDT-ready. The document is a *flat* map of
 * id -> element with no nested arrays that two peers could reorder into
 * conflict. Stacking order lives on each element as a fractional `order`
 * number, so inserting between two elements never rewrites its neighbours.
 * Swapping the plain object for a Y.Map later is a mechanical change.
 */

export type ElementId = string

export const FILE_VERSION = 1

export type ShapeKind =
  | 'rectangle'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'arrowRight'
  | 'parallelogram'
  | 'cylinder'
  | 'cross'
  | 'speechBubble'
  | 'cloud'

export const SHAPE_KINDS: ShapeKind[] = [
  'rectangle',
  'roundRect',
  'ellipse',
  'triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star',
  'arrowRight',
  'parallelogram',
  'cylinder',
  'cross',
  'speechBubble',
  'cloud'
]

export type ElementType =
  | 'shape'
  | 'sticky'
  | 'text'
  | 'draw'
  | 'connector'
  | 'frame'
  | 'image'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type FontFamily = 'sans' | 'serif' | 'mono' | 'handwritten'
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond'
export type ConnectorShape = 'straight' | 'elbow' | 'curved'

export interface ElementStyle {
  fill: string
  stroke: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  textColor: string
  fontFamily: FontFamily
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  textAlign: TextAlign
  verticalAlign: VerticalAlign
}

/**
 * `'auto'` means "ink that reads on the current board" and is resolved at
 * paint time, so a board made in dark mode stays legible in light mode.
 */
export const AUTO_INK = 'auto'

export const DEFAULT_STYLE: ElementStyle = {
  fill: '#ffffff',
  stroke: AUTO_INK,
  strokeWidth: 2,
  strokeStyle: 'solid',
  textColor: AUTO_INK,
  fontFamily: 'sans',
  fontSize: 16,
  bold: false,
  italic: false,
  underline: false,
  textAlign: 'center',
  verticalAlign: 'middle'
}

interface BaseElement {
  id: ElementId
  type: ElementType
  /** Top-left of the unrotated bounding box, in board space. */
  x: number
  y: number
  width: number
  height: number
  /** Radians, about the box centre. */
  rotation: number
  /** Fractional stacking index. Higher paints later (on top). */
  order: number
  opacity: number
  locked: boolean
  /** Id of the containing frame, if any. */
  parentId: ElementId | null
  /** Ids of elements grouped with this one share a groupId. */
  groupId: ElementId | null
  style: ElementStyle
}

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: ShapeKind
  text: string
}

export interface StickyElement extends BaseElement {
  type: 'sticky'
  text: string
}

export interface TextElement extends BaseElement {
  type: 'text'
  text: string
  /** Text boxes grow with their content until the user resizes them. */
  autoHeight: boolean
}

export interface DrawElement extends BaseElement {
  type: 'draw'
  /** Flat [x, y, pressure, ...] triples, normalised 0..1 within the box. */
  points: number[]
  /** Freehand strokes keep their aspect when the box is scaled. */
  closed: boolean
}

/** Where a connector endpoint is pinned. */
export interface ConnectorEnd {
  /** When set, the endpoint tracks this element. */
  elementId: ElementId | null
  /** Normalised 0..1 position within the bound element's box. */
  nx: number
  ny: number
  /** Absolute board position, used when elementId is null. */
  x: number
  y: number
}

export interface ConnectorElement extends BaseElement {
  type: 'connector'
  start: ConnectorEnd
  end: ConnectorEnd
  shape: ConnectorShape
  startArrow: ArrowHead
  endArrow: ArrowHead
  text: string
}

export interface FrameElement extends BaseElement {
  type: 'frame'
  name: string
}

export interface ImageElement extends BaseElement {
  type: 'image'
  /** data: URI so a board is a single self-contained file. */
  src: string
  naturalWidth: number
  naturalHeight: number
}

export type BoardElement =
  | ShapeElement
  | StickyElement
  | TextElement
  | DrawElement
  | ConnectorElement
  | FrameElement
  | ImageElement

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface BoardDocument {
  version: number
  id: string
  name: string
  elements: Record<ElementId, BoardElement>
  /** Persisted so reopening a board restores the viewport. */
  camera: Camera
  background: BoardBackground
}

export type BoardBackground = 'dots' | 'grid' | 'lines' | 'plain'

export function createEmptyDocument(id: string, name = 'Untitled board'): BoardDocument {
  return {
    version: FILE_VERSION,
    id,
    name,
    elements: {},
    camera: { x: 0, y: 0, zoom: 1 },
    background: 'dots'
  }
}

/**
 * Fills in anything a board file is missing. Files can come from an older
 * version, another tool, or a hand edit, and a single absent field must never
 * be able to take the editor down.
 */
export function normalizeDocument(input: BoardDocument): BoardDocument {
  const elements: Record<ElementId, BoardElement> = {}

  for (const [id, raw] of Object.entries(input.elements ?? {})) {
    if (!raw || typeof raw !== 'object') continue
    const el = raw as BoardElement
    const common = {
      id: el.id ?? id,
      x: num(el.x),
      y: num(el.y),
      width: num(el.width),
      height: num(el.height),
      rotation: num(el.rotation),
      order: num(el.order),
      opacity: typeof el.opacity === 'number' ? el.opacity : 1,
      locked: Boolean(el.locked),
      parentId: el.parentId ?? null,
      groupId: el.groupId ?? null,
      style: { ...DEFAULT_STYLE, ...(el.style ?? {}) }
    }

    switch (el.type) {
      case 'sticky':
      case 'text':
      case 'shape':
        elements[common.id] = {
          ...el,
          ...common,
          text: typeof el.text === 'string' ? el.text : '',
          ...(el.type === 'shape' ? { shape: el.shape ?? 'rectangle' } : {}),
          ...(el.type === 'text' ? { autoHeight: el.autoHeight ?? true } : {})
        } as BoardElement
        break

      case 'connector':
        elements[common.id] = {
          ...el,
          ...common,
          text: typeof el.text === 'string' ? el.text : '',
          shape: el.shape ?? 'elbow',
          startArrow: el.startArrow ?? 'none',
          endArrow: el.endArrow ?? 'arrow',
          start: normalizeEnd(el.start),
          end: normalizeEnd(el.end)
        } as BoardElement
        break

      case 'draw':
        elements[common.id] = {
          ...el,
          ...common,
          points: Array.isArray(el.points) ? el.points : [],
          closed: Boolean(el.closed)
        } as BoardElement
        break

      case 'frame':
        elements[common.id] = { ...el, ...common, name: el.name ?? 'Frame' } as BoardElement
        break

      case 'image':
        if (!el.src) continue
        elements[common.id] = {
          ...el,
          ...common,
          naturalWidth: num(el.naturalWidth) || common.width,
          naturalHeight: num(el.naturalHeight) || common.height
        } as BoardElement
        break

      default:
        // Unknown element type from a newer file: drop it rather than crash.
        break
    }
  }

  return {
    version: input.version ?? FILE_VERSION,
    id: input.id ?? 'board',
    name: input.name ?? 'Untitled board',
    elements,
    camera: input.camera ?? { x: 0, y: 0, zoom: 1 },
    background: input.background ?? 'dots'
  }
}

function normalizeEnd(end: ConnectorEnd | undefined): ConnectorEnd {
  return {
    elementId: end?.elementId ?? null,
    nx: typeof end?.nx === 'number' ? end.nx : 0.5,
    ny: typeof end?.ny === 'number' ? end.ny : 0.5,
    x: num(end?.x),
    y: num(end?.y)
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Elements sorted bottom-to-top for painting and top-to-bottom for hit-testing. */
export function sortedElements(elements: Record<ElementId, BoardElement>): BoardElement[] {
  return Object.values(elements).sort((a, b) => a.order - b.order)
}

export function hasText(
  el: BoardElement
): el is ShapeElement | StickyElement | TextElement | ConnectorElement {
  return (
    el.type === 'shape' ||
    el.type === 'sticky' ||
    el.type === 'text' ||
    el.type === 'connector'
  )
}

export function isResizable(el: BoardElement): boolean {
  return el.type !== 'connector'
}

export function isRotatable(el: BoardElement): boolean {
  return el.type !== 'connector' && el.type !== 'frame'
}
