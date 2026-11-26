import type { BoardElement, ConnectorElement, ElementId, TextElement } from '../shared/document'
import { sortedElements } from '../shared/document'
import { zoomBy } from '../core/camera'
import {
  boundEnd,
  createConnector,
  createDraw,
  createFrame,
  createShape,
  createSticky,
  createText,
  elementBounds,
  expandGroups,
  freeEnd,
  hitTest,
  normalizeStroke,
  topOrder
} from '../core/elements'
import {
  boxContains,
  boxesIntersect,
  rotatePoint,
  snapAngle,
  type Box,
  type Vec
} from '../core/geometry'
import { contrastText } from '../core/palette'
import { useBoard, type BoardState } from '../state/store'
import {
  ANCHOR_POINTS,
  connectorEndHandles,
  cursorForHandle,
  hitHandle,
  selectionFrame,
  type Guide,
  type HandleId
} from './overlay'
import { computeSnap } from './snapping'

const MIN_SIZE = 8
const DRAG_THRESHOLD = 3
const SNAP_THRESHOLD_PX = 6

interface ElementSnapshot {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; startScreen: Vec; startCamera: { x: number; y: number } }
  | { kind: 'marquee'; start: Vec; current: Vec; additive: boolean }
  | {
      kind: 'translate'
      start: Vec
      last: Vec
      originals: ElementSnapshot[]
      moved: boolean
      /** Frame children that ride along with a frame being dragged. */
      passengers: ElementSnapshot[]
      /** Starting positions of unpinned connector endpoints being dragged. */
      connectorOrigins: Map<ElementId, { start: Vec; end: Vec }>
    }
  | {
      kind: 'resize'
      handle: HandleId
      frame0: Box
      rotation: number
      originals: ElementSnapshot[]
      keepAspect: boolean
    }
  | { kind: 'rotate'; center: Vec; startAngle: number; originals: ElementSnapshot[] }
  | { kind: 'draw'; samples: { x: number; y: number; pressure: number }[] }
  | {
      kind: 'create'
      start: Vec
      current: Vec
      elementId: ElementId | null
    }
  | {
      kind: 'connector'
      from: { elementId: ElementId | null; nx: number; ny: number; point: Vec }
      current: Vec
      targetId: ElementId | null
      targetAnchor: { nx: number; ny: number } | null
    }
  | {
      kind: 'connector-end'
      connectorId: ElementId
      which: 'start' | 'end'
      current: Vec
      targetId: ElementId | null
    }
  | { kind: 'erase'; erased: Set<ElementId> }

export interface PointerInfo {
  screen: Vec
  board: Vec
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
  button: number
  /** Bitmask of buttons still held; 0 means the gesture is over. */
  buttons: number
  pressure: number
}

/**
 * Owns everything that only matters while the mouse is down. Keeping this out
 * of the React store means a drag repaints the canvas without re-rendering the
 * whole UI tree on every pointer move.
 */
export class BoardController {
  private interaction: Interaction = { kind: 'none' }
  private spaceDown = false
  private requestRender: () => void
  private onCommit: () => void

  /** Read by the overlay renderer each frame. */
  guides: Guide[] = []
  marquee: Box | null = null
  connectorDraft: { points: Vec[]; targetId: string | null } | null = null
  anchorHost: BoardElement | null = null
  cursor = 'default'

  constructor(requestRender: () => void, onCommit: () => void = () => {}) {
    this.requestRender = requestRender
    this.onCommit = onCommit
  }

  get isInteracting(): boolean {
    return this.interaction.kind !== 'none'
  }

  get isPanning(): boolean {
    return this.interaction.kind === 'pan'
  }

  setSpace(down: boolean): void {
    if (this.spaceDown === down) return
    this.spaceDown = down
    this.updateCursor()
    this.requestRender()
  }

  private state(): BoardState {
    return useBoard.getState()
  }

  // -------------------------------------------------------------------------
  // Hit testing
  // -------------------------------------------------------------------------

  /** Topmost element under a board point, skipping locked ones by default. */
  elementAt(board: Vec, options?: { includeLocked?: boolean }): BoardElement | null {
    const { doc, camera } = this.state()
    const tolerance = 6 / camera.zoom
    const ordered = sortedElements(doc.elements)
    for (let i = ordered.length - 1; i >= 0; i--) {
      const el = ordered[i]
      if (el.locked && !options?.includeLocked) continue
      if (hitTest(board, el, doc.elements, tolerance)) return el
    }
    return null
  }

  /** A container frame under the point, used to adopt newly created elements. */
  private frameAt(board: Vec): BoardElement | null {
    const { doc } = this.state()
    const frames = sortedElements(doc.elements).filter((el) => el.type === 'frame')
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]
      if (
        board.x >= f.x &&
        board.y >= f.y &&
        board.x <= f.x + f.width &&
        board.y <= f.y + f.height
      ) {
        return f
      }
    }
    return null
  }

  /** The nearest edge anchor on an element, or its centre when far from an edge. */
  private nearestAnchor(el: BoardElement, board: Vec): { nx: number; ny: number } {
    let best = { nx: 0.5, ny: 0.5 }
    let bestDist = Infinity
    for (const anchor of ANCHOR_POINTS) {
      const p = { x: el.x + el.width * anchor.nx, y: el.y + el.height * anchor.ny }
      const d = Math.hypot(p.x - board.x, p.y - board.y)
      if (d < bestDist) {
        bestDist = d
        best = anchor
      }
    }
    const threshold = Math.min(el.width, el.height) * 0.34
    return bestDist <= threshold ? best : { nx: 0.5, ny: 0.5 }
  }

  // -------------------------------------------------------------------------
  // Pointer down
  // -------------------------------------------------------------------------

  pointerDown(info: PointerInfo): void {
    const s = this.state()

    // Middle mouse or space always pans, whatever tool is active.
    if (info.button === 1 || (this.spaceDown && info.button === 0) || s.tool === 'hand') {
      this.interaction = {
        kind: 'pan',
        startScreen: info.screen,
        startCamera: { x: s.camera.x, y: s.camera.y }
      }
      this.updateCursor()
      return
    }

    if (info.button === 2) return // handled by the context menu

    if (s.editingId) {
      s.setEditing(null)
    }

    switch (s.tool) {
      case 'select':
        this.beginSelectGesture(info)
        break
      case 'sticky':
      case 'shape':
      case 'frame':
      case 'text':
        this.beginCreateGesture(info)
        break
      case 'draw':
        this.interaction = {
          kind: 'draw',
          samples: [{ x: info.board.x, y: info.board.y, pressure: info.pressure }]
        }
        break
      case 'eraser':
        this.interaction = { kind: 'erase', erased: new Set() }
        s.pushHistory('erase')
        this.eraseAt(info.board)
        break
      case 'connector':
        this.beginConnectorGesture(info)
        break
      case 'image':
        break
    }
    this.requestRender()
  }

  private beginSelectGesture(info: PointerInfo): void {
    const s = this.state()
    const selected = s.selectedElements()

    // 1. Transform handles win over everything else.
    const frame = selectionFrame(selected, s.doc.elements)
    if (frame && selected.length > 0 && !selected.some((el) => el.locked)) {
      const handle = hitHandle(info.screen, frame, s.camera)
      if (handle) {
        const originals = this.snapshotOf(selected)
        if (handle === 'rotate') {
          const center = {
            x: frame.box.x + frame.box.width / 2,
            y: frame.box.y + frame.box.height / 2
          }
          this.interaction = {
            kind: 'rotate',
            center,
            startAngle: Math.atan2(info.board.y - center.y, info.board.x - center.x),
            originals
          }
        } else {
          this.interaction = {
            kind: 'resize',
            handle,
            frame0: { ...frame.box },
            rotation: frame.rotation,
            originals,
            keepAspect: info.shift
          }
        }
        s.pushHistory(handle === 'rotate' ? 'rotate' : 'resize')
        return
      }
    }

    // 2. A selected connector's endpoints can be re-pinned.
    if (selected.length === 1 && selected[0].type === 'connector') {
      const connector = selected[0]
      const ends = connectorEndHandles(connector, s.doc.elements, s.camera)
      for (const which of ['start', 'end'] as const) {
        const h = ends[which]
        if (Math.hypot(info.screen.x - h.x, info.screen.y - h.y) <= 9) {
          s.pushHistory('connector')
          this.interaction = {
            kind: 'connector-end',
            connectorId: connector.id,
            which,
            current: info.board,
            targetId: null
          }
          return
        }
      }
    }

    // 3. Pick the element under the cursor.
    const hit = this.elementAt(info.board)
    if (!hit) {
      if (!info.shift) s.clearSelection()
      this.interaction = {
        kind: 'marquee',
        start: info.board,
        current: info.board,
        additive: info.shift
      }
      return
    }

    const ids = expandGroups([hit.id], s.doc.elements)
    if (info.shift) {
      const already = ids.every((id) => s.selection.includes(id))
      s.setSelection(
        already
          ? s.selection.filter((id) => !ids.includes(id))
          : [...s.selection, ...ids]
      )
    } else if (!s.selection.includes(hit.id)) {
      s.setSelection(ids)
    }

    const moving = this.state().selectedElements()
    if (moving.length === 0 || moving.some((el) => el.locked)) {
      this.interaction = { kind: 'none' }
      return
    }

    // Alt-drag duplicates rather than moves, matching Miro.
    if (info.alt) {
      this.state().duplicateSelection()
    }

    const dragging = this.state().selectedElements()
    this.state().pushHistory('move')
    this.interaction = {
      kind: 'translate',
      start: info.board,
      last: info.board,
      originals: this.snapshotOf(dragging),
      passengers: this.snapshotOf(this.framePassengers(dragging)),
      connectorOrigins: connectorOriginsOf(dragging),
      moved: false
    }
  }

  /** Elements parented to any frame in the dragged set. */
  private framePassengers(dragging: BoardElement[]): BoardElement[] {
    const s = this.state()
    const frameIds = new Set(dragging.filter((el) => el.type === 'frame').map((el) => el.id))
    if (frameIds.size === 0) return []
    const draggingIds = new Set(dragging.map((el) => el.id))
    return Object.values(s.doc.elements).filter(
      (el) => el.parentId && frameIds.has(el.parentId) && !draggingIds.has(el.id)
    )
  }

  private snapshotOf(els: BoardElement[]): ElementSnapshot[] {
    return els.map((el) => ({
      id: el.id,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation
    }))
  }

  private beginCreateGesture(info: PointerInfo): void {
    this.interaction = { kind: 'create', start: info.board, current: info.board, elementId: null }
  }

  private beginConnectorGesture(info: PointerInfo): void {
    const hit = this.elementAt(info.board)
    const anchor = hit ? this.nearestAnchor(hit, info.board) : null
    this.interaction = {
      kind: 'connector',
      from: {
        elementId: hit?.id ?? null,
        nx: anchor?.nx ?? 0.5,
        ny: anchor?.ny ?? 0.5,
        point: info.board
      },
      current: info.board,
      targetId: null,
      targetAnchor: null
    }
  }

  // -------------------------------------------------------------------------
  // Pointer move
  // -------------------------------------------------------------------------

  pointerMove(info: PointerInfo): void {
    const s = this.state()

    if (this.interaction.kind === 'none') {
      this.updateHover(info)
      this.updateCursor(info)
      return
    }

    // If the button came up somewhere we never heard about (focus loss, the OS
    // stealing capture), finish the gesture instead of dragging on forever.
    if (info.buttons === 0) {
      this.pointerUp(info)
      return
    }

    switch (this.interaction.kind) {
      case 'pan': {
        const dx = info.screen.x - this.interaction.startScreen.x
        const dy = info.screen.y - this.interaction.startScreen.y
        s.setCamera({
          ...s.camera,
          x: this.interaction.startCamera.x - dx / s.camera.zoom,
          y: this.interaction.startCamera.y - dy / s.camera.zoom
        })
        break
      }

      case 'marquee': {
        this.interaction.current = info.board
        this.marquee = boxFrom(this.interaction.start, info.board)
        this.applyMarqueeSelection()
        break
      }

      case 'translate':
        this.applyTranslate(info)
        break

      case 'resize':
        this.applyResize(info)
        break

      case 'rotate':
        this.applyRotate(info)
        break

      case 'draw':
        this.interaction.samples.push({
          x: info.board.x,
          y: info.board.y,
          pressure: info.pressure
        })
        break

      case 'create':
        this.interaction.current = info.board
        this.marquee = boxFrom(this.interaction.start, info.board)
        break

      case 'connector': {
        this.interaction.current = info.board
        const hit = this.elementAt(info.board)
        const valid = hit && hit.id !== this.interaction.from.elementId ? hit : null
        this.interaction.targetId = valid?.id ?? null
        this.interaction.targetAnchor = valid ? this.nearestAnchor(valid, info.board) : null
        this.anchorHost = valid
        this.connectorDraft = {
          points: [this.connectorOrigin(), info.board],
          targetId: valid?.id ?? null
        }
        break
      }

      case 'connector-end': {
        this.interaction.current = info.board
        const hit = this.elementAt(info.board)
        this.interaction.targetId = hit?.id ?? null
        this.anchorHost = hit
        this.applyConnectorEndDrag(info)
        break
      }

      case 'erase':
        this.eraseAt(info.board)
        break
    }

    this.requestRender()
  }

  private connectorOrigin(): Vec {
    if (this.interaction.kind !== 'connector') return { x: 0, y: 0 }
    const { from } = this.interaction
    if (!from.elementId) return from.point
    const el = this.state().doc.elements[from.elementId]
    if (!el) return from.point
    return { x: el.x + el.width * from.nx, y: el.y + el.height * from.ny }
  }

  private updateHover(info: PointerInfo): void {
    const s = this.state()
    if (s.tool === 'connector') {
      const hit = this.elementAt(info.board)
      this.anchorHost = hit
      s.setHovered(hit?.id ?? null)
      this.requestRender()
      return
    }
    if (s.tool !== 'select') {
      if (this.anchorHost) {
        this.anchorHost = null
        this.requestRender()
      }
      s.setHovered(null)
      return
    }
    const hit = this.elementAt(info.board)
    if (s.hoveredId !== (hit?.id ?? null)) {
      s.setHovered(hit?.id ?? null)
      this.requestRender()
    }
  }

  private applyMarqueeSelection(): void {
    if (this.interaction.kind !== 'marquee') return
    const s = this.state()
    const box = boxFrom(this.interaction.start, this.interaction.current)
    const hits: ElementId[] = []
    for (const el of Object.values(s.doc.elements)) {
      if (el.locked) continue
      const bounds = elementBounds(el, s.doc.elements)
      // Frames need full containment so you can rubber-band over them.
      const inside = el.type === 'frame' ? boxContains(box, bounds) : boxesIntersect(box, bounds)
      if (inside) hits.push(el.id)
    }
    const expanded = expandGroups(hits, s.doc.elements)
    s.setSelection(this.interaction.additive ? [...s.selection, ...expanded] : expanded)
  }

  private applyTranslate(info: PointerInfo): void {
    if (this.interaction.kind !== 'translate') return
    const s = this.state()
    const it = this.interaction

    let dx = info.board.x - it.start.x
    let dy = info.board.y - it.start.y

    if (Math.hypot(dx, dy) > DRAG_THRESHOLD / s.camera.zoom) it.moved = true
    if (!it.moved) return

    // Shift locks the drag to one axis.
    if (info.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }

    this.guides = []
    if (s.ui.snapToObjects && !info.ctrl) {
      const movingIds = new Set(it.originals.map((o) => o.id))
      const movedBox = shiftBox(this.snapshotBounds(it.originals), dx, dy)
      const others: Box[] = []
      for (const el of Object.values(s.doc.elements)) {
        if (movingIds.has(el.id) || el.type === 'connector') continue
        others.push(elementBounds(el, s.doc.elements))
      }
      const snap = computeSnap(movedBox, others, SNAP_THRESHOLD_PX / s.camera.zoom)
      dx += snap.dx
      dy += snap.dy
      this.guides = snap.guides
    }

    const all = [...it.originals, ...it.passengers]
    s.mutate(
      (els) => {
        for (const o of all) {
          const el = els[o.id]
          if (!el) continue
          if (el.type === 'connector') {
            // A connector has no meaningful box; drag its unpinned ends instead.
            const c = el as ConnectorElement
            const origin = it.connectorOrigins.get(o.id)
            if (!origin) continue
            els[o.id] = {
              ...c,
              start: c.start.elementId
                ? c.start
                : { ...c.start, x: origin.start.x + dx, y: origin.start.y + dy },
              end: c.end.elementId
                ? c.end
                : { ...c.end, x: origin.end.x + dx, y: origin.end.y + dy }
            }
            continue
          }
          els[o.id] = { ...el, x: o.x + dx, y: o.y + dy }
        }
      },
      { history: false }
    )
    it.last = info.board
  }

  private snapshotBounds(snapshots: ElementSnapshot[]): Box {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of snapshots) {
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x + s.width)
      maxY = Math.max(maxY, s.y + s.height)
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  private applyResize(info: PointerInfo): void {
    if (this.interaction.kind !== 'resize') return
    const s = this.state()
    const it = this.interaction
    const { frame0, rotation, handle } = it

    const center0 = { x: frame0.x + frame0.width / 2, y: frame0.y + frame0.height / 2 }
    // Work in the frame's own axis-aligned space.
    const local = rotation ? rotatePoint(info.board, center0, -rotation) : info.board

    let left = frame0.x
    let top = frame0.y
    let right = frame0.x + frame0.width
    let bottom = frame0.y + frame0.height

    if (handle.includes('w')) left = local.x
    if (handle.includes('e')) right = local.x
    if (handle.includes('n')) top = local.y
    if (handle.includes('s')) bottom = local.y

    let width = Math.max(MIN_SIZE, Math.abs(right - left))
    let height = Math.max(MIN_SIZE, Math.abs(bottom - top))

    const keepAspect = info.shift || it.keepAspect
    if (keepAspect && frame0.width > 0 && frame0.height > 0) {
      const ratio = frame0.width / frame0.height
      const isCorner = handle.length === 2
      if (isCorner) {
        if (width / height > ratio) height = width / ratio
        else width = height * ratio
      } else if (handle === 'e' || handle === 'w') {
        height = width / ratio
      } else {
        width = height * ratio
      }
    }

    // Keep the handle opposite the one being dragged pinned in place.
    let x = handle.includes('w') ? right - width : left
    let y = handle.includes('n') ? bottom - height : top
    if (!handle.includes('w') && !handle.includes('e')) x = center0.x - width / 2
    if (!handle.includes('n') && !handle.includes('s')) y = center0.y - height / 2

    const newFrame: Box = { x, y, width, height }

    if (rotation) {
      // Rotating the new centre back keeps the dragged corner under the cursor.
      const newCenterLocal = { x: x + width / 2, y: y + height / 2 }
      const newCenter = rotatePoint(newCenterLocal, center0, rotation)
      newFrame.x = newCenter.x - width / 2
      newFrame.y = newCenter.y - height / 2
    }

    const sx = frame0.width === 0 ? 1 : newFrame.width / frame0.width
    const sy = frame0.height === 0 ? 1 : newFrame.height / frame0.height

    s.mutate(
      (els) => {
        for (const o of it.originals) {
          const el = els[o.id]
          if (!el) continue
          const nextWidth = Math.max(MIN_SIZE, o.width * sx)
          const nextHeight = Math.max(MIN_SIZE, o.height * sy)
          const next: BoardElement = {
            ...el,
            x: newFrame.x + (o.x - frame0.x) * sx,
            y: newFrame.y + (o.y - frame0.y) * sy,
            width: nextWidth,
            height: nextHeight
          }
          if (next.type === 'text') {
            // A manual resize turns off auto-height.
            ;(next as TextElement).autoHeight = false
          }
          els[o.id] = next
        }
      },
      { history: false }
    )
  }

  private applyRotate(info: PointerInfo): void {
    if (this.interaction.kind !== 'rotate') return
    const s = this.state()
    const it = this.interaction
    const angle = Math.atan2(info.board.y - it.center.y, info.board.x - it.center.x)
    let delta = angle - it.startAngle
    if (info.shift) {
      const first = it.originals[0]
      delta = snapAngle((first?.rotation ?? 0) + delta, 15) - (first?.rotation ?? 0)
    }

    s.mutate(
      (els) => {
        for (const o of it.originals) {
          const el = els[o.id]
          if (!el) continue
          const c = { x: o.x + o.width / 2, y: o.y + o.height / 2 }
          const rotated = rotatePoint(c, it.center, delta)
          els[o.id] = {
            ...el,
            rotation: o.rotation + delta,
            x: rotated.x - o.width / 2,
            y: rotated.y - o.height / 2
          }
        }
      },
      { history: false }
    )
  }

  private applyConnectorEndDrag(info: PointerInfo): void {
    if (this.interaction.kind !== 'connector-end') return
    const s = this.state()
    const it = this.interaction
    const target = it.targetId ? s.doc.elements[it.targetId] : null
    const anchor = target ? this.nearestAnchor(target, info.board) : null

    s.mutate(
      (els) => {
        const el = els[it.connectorId]
        if (el?.type !== 'connector') return
        const next = { ...el, start: { ...el.start }, end: { ...el.end } }
        const end = it.which === 'start' ? next.start : next.end
        if (target && anchor) {
          end.elementId = target.id
          end.nx = anchor.nx
          end.ny = anchor.ny
        } else {
          end.elementId = null
          end.x = info.board.x
          end.y = info.board.y
        }
        els[it.connectorId] = next
      },
      { history: false }
    )
  }

  private eraseAt(board: Vec): void {
    if (this.interaction.kind !== 'erase') return
    const s = this.state()
    const hit = this.elementAt(board)
    if (!hit || this.interaction.erased.has(hit.id)) return
    this.interaction.erased.add(hit.id)
    s.mutate(
      (els) => {
        delete els[hit.id]
      },
      { history: false }
    )
  }

  // -------------------------------------------------------------------------
  // Pointer up
  // -------------------------------------------------------------------------

  pointerUp(info: PointerInfo): void {
    const s = this.state()
    const it = this.interaction

    switch (it.kind) {
      case 'draw':
        this.commitStroke(it.samples)
        break

      case 'create':
        this.commitCreate(it, info)
        break

      case 'connector':
        this.commitConnector(it)
        break

      case 'translate':
        if (it.moved) this.reparentToFrames()
        else if (!it.moved) {
          // A click without movement collapses a multi-selection to one element.
          const hit = this.elementAt(info.board)
          if (hit && !info.shift && s.selection.length > 1 && !hit.groupId) {
            s.setSelection([hit.id])
          }
          // Nothing actually changed, so drop the snapshot we pushed.
          this.dropLastHistory()
        }
        break

      case 'resize':
      case 'rotate':
      case 'marquee':
      case 'pan':
      case 'erase':
      case 'connector-end':
      case 'none':
        break
    }

    this.interaction = { kind: 'none' }
    this.marquee = null
    this.guides = []
    this.connectorDraft = null
    this.updateCursor(info)
    this.requestRender()
    this.onCommit()
  }

  /** Undoes the pre-emptive history push made when a gesture turned out to be a no-op. */
  private dropLastHistory(): void {
    useBoard.setState((prev) => ({ history: prev.history.slice(0, -1) }))
  }

  private commitStroke(samples: { x: number; y: number; pressure: number }[]): void {
    if (samples.length < 2) return
    const s = this.state()
    const { points, bounds } = normalizeStroke(samples)
    const el = createDraw(points, bounds, {
      order: topOrder(s.doc.elements),
      style: { ...s.defaultStyle, fill: 'transparent' },
      parentId: this.frameAt(samples[0])?.id ?? null
    })
    s.addElements([el], { select: false })
  }

  private commitCreate(
    it: Extract<Interaction, { kind: 'create' }>,
    info: PointerInfo
  ): void {
    const s = this.state()
    const box = boxFrom(it.start, it.current)
    const dragged = box.width > MIN_SIZE && box.height > MIN_SIZE
    const order = topOrder(s.doc.elements)
    const parentId = this.frameAt(it.start)?.id ?? null
    let created: BoardElement | null = null

    switch (s.tool) {
      case 'sticky': {
        const size = dragged ? Math.max(box.width, box.height) : 180
        const x = dragged ? box.x : it.start.x - size / 2
        const y = dragged ? box.y : it.start.y - size / 2
        const sticky = createSticky(x, y, {
          order,
          parentId,
          style: {
            ...s.defaultStyle,
            fill: s.stickyColor,
            stroke: 'transparent',
            textColor: contrastText(s.stickyColor),
            fontSize: 20
          }
        })
        sticky.width = size
        sticky.height = size
        created = sticky
        break
      }
      case 'shape': {
        const width = dragged ? box.width : 160
        const height = dragged ? box.height : 120
        const x = dragged ? box.x : it.start.x - width / 2
        const y = dragged ? box.y : it.start.y - height / 2
        created = createShape(s.shapeKind, x, y, width, height, {
          order,
          parentId,
          style: s.defaultStyle
        })
        break
      }
      case 'frame': {
        const width = dragged ? box.width : 800
        const height = dragged ? box.height : 600
        const x = dragged ? box.x : it.start.x - width / 2
        const y = dragged ? box.y : it.start.y - height / 2
        const count =
          Object.values(s.doc.elements).filter((el) => el.type === 'frame').length + 1
        created = createFrame(
          x,
          y,
          width,
          height,
          { order: bottomFrameOrder(s), style: { ...s.defaultStyle, fill: '#FFFFFF' } },
          `Frame ${count}`
        )
        break
      }
      case 'text': {
        const width = dragged ? Math.max(60, box.width) : 220
        created = createText(it.start.x, it.start.y - 12, {
          order,
          parentId,
          style: { ...s.defaultStyle, fill: 'transparent', stroke: 'transparent', textAlign: 'left' }
        })
        created.width = width
        break
      }
      default:
        break
    }

    if (!created) return
    s.addElements([created])

    if (created.type === 'frame') {
      this.adoptIntoFrame(created.id)
    }
    // The tool switch has to happen first: changing tools closes any open
    // editor, which would immediately undo the edit mode we want here.
    if (!info.shift) s.setTool('select')
    // Text and sticky notes drop straight into edit mode.
    if (created.type === 'text' || created.type === 'sticky') {
      s.setSelection([created.id])
      s.setEditing(created.id)
    }
  }

  private commitConnector(it: Extract<Interaction, { kind: 'connector' }>): void {
    const s = this.state()
    const origin = this.connectorOrigin()
    const distance = Math.hypot(it.current.x - origin.x, it.current.y - origin.y)
    if (distance < 12 && !it.targetId) return

    const start = it.from.elementId
      ? boundEnd(it.from.elementId, it.from.nx, it.from.ny)
      : freeEnd(origin.x, origin.y)
    const end =
      it.targetId && it.targetAnchor
        ? boundEnd(it.targetId, it.targetAnchor.nx, it.targetAnchor.ny)
        : freeEnd(it.current.x, it.current.y)

    const connector = createConnector(start, end, {
      order: topOrder(s.doc.elements),
      style: { ...s.defaultStyle, fill: 'transparent' }
    })
    s.addElements([connector])
    s.setTool('select')
  }

  /** After a drag, elements dropped inside a frame become its children. */
  private reparentToFrames(): void {
    const s = this.state()
    const moved = s.selectedElements()
    if (moved.length === 0) return
    const frames = Object.values(s.doc.elements).filter((el) => el.type === 'frame')
    if (frames.length === 0) return

    s.mutate(
      (els) => {
        for (const el of moved) {
          if (el.type === 'frame') continue
          const bounds = elementBounds(el, els)
          const host = frames
            .filter((f) => f.id !== el.id)
            .sort((a, b) => b.order - a.order)
            .find((f) =>
              boxContains({ x: f.x, y: f.y, width: f.width, height: f.height }, bounds)
            )
          const parentId = host?.id ?? null
          if (els[el.id] && els[el.id].parentId !== parentId) {
            els[el.id] = { ...els[el.id], parentId }
          }
        }
      },
      { history: false }
    )
  }

  private adoptIntoFrame(frameId: ElementId): void {
    const s = this.state()
    const frame = s.doc.elements[frameId]
    if (!frame) return
    const box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
    s.mutate(
      (els) => {
        for (const el of Object.values(els)) {
          if (el.id === frameId || el.type === 'frame') continue
          if (boxContains(box, elementBounds(el, els))) {
            els[el.id] = { ...el, parentId: frameId }
          }
        }
      },
      { history: false }
    )
  }

  // -------------------------------------------------------------------------
  // Wheel & double click
  // -------------------------------------------------------------------------

  wheel(event: WheelEvent, screen: Vec): void {
    const s = this.state()
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0022)
      s.setCamera(zoomBy(s.camera, screen, factor))
      return
    }
    // Trackpads send deltaX; a plain wheel scrolls vertically, shift flips it.
    const scale = event.deltaMode === 1 ? 16 : 1
    let dx = event.deltaX * scale
    let dy = event.deltaY * scale
    if (event.shiftKey && dx === 0) {
      dx = dy
      dy = 0
    }
    s.setCamera({
      ...s.camera,
      x: s.camera.x + dx / s.camera.zoom,
      y: s.camera.y + dy / s.camera.zoom
    })
  }

  doubleClick(info: PointerInfo): void {
    const s = this.state()
    const hit = this.elementAt(info.board)

    if (!hit) {
      if (s.tool === 'select') {
        // Double-clicking empty canvas drops a text box, like Miro.
        const el = createText(info.board.x, info.board.y - 12, {
          order: topOrder(s.doc.elements),
          parentId: this.frameAt(info.board)?.id ?? null,
          style: {
            ...s.defaultStyle,
            fill: 'transparent',
            stroke: 'transparent',
            textAlign: 'left'
          }
        })
        s.addElements([el])
        s.setEditing(el.id)
      }
      return
    }

    if (hit.type === 'frame') {
      s.setSelection([hit.id])
      return
    }
    if (hit.groupId) {
      // Step inside the group to edit a single member.
      s.setSelection([hit.id])
    }
    if (
      hit.type === 'sticky' ||
      hit.type === 'text' ||
      hit.type === 'shape' ||
      hit.type === 'connector'
    ) {
      s.setSelection([hit.id])
      s.setEditing(hit.id)
    }
    this.requestRender()
  }

  // -------------------------------------------------------------------------
  // Cursor
  // -------------------------------------------------------------------------

  updateCursor(info?: PointerInfo): void {
    const s = this.state()
    let next = 'default'

    if (this.interaction.kind === 'pan') next = 'grabbing'
    else if (this.spaceDown || s.tool === 'hand') next = 'grab'
    else if (this.interaction.kind === 'rotate') next = 'grabbing'
    else if (s.tool === 'draw') next = 'crosshair'
    else if (s.tool === 'eraser') next = 'cell'
    else if (s.tool === 'text') next = 'text'
    else if (s.tool !== 'select') next = 'crosshair'
    else if (info) {
      const selected = s.selectedElements()
      const frame = selectionFrame(selected, s.doc.elements)
      if (frame && selected.length > 0) {
        const handle = hitHandle(info.screen, frame, s.camera)
        if (handle) next = cursorForHandle(handle, frame.rotation)
      }
      if (next === 'default' && s.hoveredId) next = 'move'
    }

    if (next !== this.cursor) {
      this.cursor = next
      this.requestRender()
    }
  }

  cancel(): void {
    if (this.interaction.kind === 'none') return
    const kind = this.interaction.kind
    this.interaction = { kind: 'none' }
    this.marquee = null
    this.guides = []
    this.connectorDraft = null
    if (kind === 'translate' || kind === 'resize' || kind === 'rotate') {
      this.state().undo()
    }
    this.requestRender()
  }
}

function connectorOriginsOf(
  els: BoardElement[]
): Map<ElementId, { start: Vec; end: Vec }> {
  const map = new Map<ElementId, { start: Vec; end: Vec }>()
  for (const el of els) {
    if (el.type !== 'connector') continue
    map.set(el.id, {
      start: { x: el.start.x, y: el.start.y },
      end: { x: el.end.x, y: el.end.y }
    })
  }
  return map
}

function boxFrom(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

function shiftBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: box.x + dx, y: box.y + dy }
}

/** New frames sit under everything else so they read as a backdrop. */
function bottomFrameOrder(s: BoardState): number {
  const orders = Object.values(s.doc.elements).map((el) => el.order)
  return orders.length === 0 ? 0 : Math.min(...orders) - 1
}
