import { create } from 'zustand'
import {
  DEFAULT_STYLE,
  createEmptyDocument,
  normalizeDocument,
  type BoardBackground,
  type BoardDocument,
  type BoardElement,
  type Camera,
  type ElementId,
  type ElementStyle,
  type ShapeKind
} from '../shared/document'
import {
  cloneElements,
  elementsBounds,
  expandGroups,
  needsReindex,
  newId,
  orderBetween,
  topOrder,
  type ElementMap
} from '../core/elements'
import type { Box, Vec } from '../core/geometry'
import {
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  type ThemeMode
} from '../core/theme'

export type ToolId =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'shape'
  | 'text'
  | 'draw'
  | 'eraser'
  | 'connector'
  | 'frame'
  | 'image'

export interface HistoryEntry {
  elements: ElementMap
  selection: ElementId[]
  label: string
}

const HISTORY_LIMIT = 200

export interface UiState {
  showMinimap: boolean
  showLayers: boolean
  showGrid: boolean
  snapToObjects: boolean
  showShortcuts: boolean
  showExportDialog: boolean
  showShapePicker: boolean
}

export interface BoardState {
  doc: BoardDocument
  camera: Camera
  filePath: string | null
  dirty: boolean

  tool: ToolId
  /** Tool to return to after a one-shot gesture (e.g. space-to-pan). */
  previousTool: ToolId
  shapeKind: ShapeKind
  /** Styling applied to the next element created. */
  defaultStyle: ElementStyle
  stickyColor: string

  selection: ElementId[]
  editingId: ElementId | null
  hoveredId: ElementId | null

  history: HistoryEntry[]
  future: HistoryEntry[]
  clipboard: BoardElement[]

  ui: UiState
  theme: ThemeMode
  viewport: { width: number; height: number }

  // --- document lifecycle -------------------------------------------------
  loadDocument: (rawDoc: BoardDocument, filePath: string | null) => void
  newDocument: () => void
  setFilePath: (filePath: string | null) => void
  markSaved: () => void
  renameBoard: (name: string) => void
  setBackground: (background: BoardBackground) => void

  // --- history ------------------------------------------------------------
  pushHistory: (label?: string) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // --- mutation -----------------------------------------------------------
  mutate: (fn: (els: ElementMap) => void, options?: { history?: boolean; label?: string }) => void
  addElements: (els: BoardElement[], options?: { select?: boolean; history?: boolean }) => void
  patchElement: (id: ElementId, changes: Partial<BoardElement>, history?: boolean) => void
  patchElements: (ids: ElementId[], changes: Partial<BoardElement>, history?: boolean) => void
  updateStyle: (changes: Partial<ElementStyle>, history?: boolean) => void
  removeElements: (ids: ElementId[]) => void
  deleteSelection: () => void

  // --- selection ----------------------------------------------------------
  setSelection: (ids: ElementId[]) => void
  addToSelection: (ids: ElementId[]) => void
  toggleSelection: (id: ElementId) => void
  clearSelection: () => void
  selectAll: () => void
  setEditing: (id: ElementId | null) => void
  setHovered: (id: ElementId | null) => void
  selectedElements: () => BoardElement[]
  selectionBounds: () => Box | null

  // --- arrangement --------------------------------------------------------
  bringToFront: (ids?: ElementId[]) => void
  sendToBack: (ids?: ElementId[]) => void
  bringForward: (ids?: ElementId[]) => void
  sendBackward: (ids?: ElementId[]) => void
  group: () => void
  ungroup: () => void
  lockSelection: (locked: boolean) => void
  unlockAll: () => void
  alignSelection: (
    edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
  ) => void
  distributeSelection: (axis: 'x' | 'y') => void

  // --- clipboard ----------------------------------------------------------
  copySelection: () => void
  cutSelection: () => void
  paste: (at?: Vec) => void
  duplicateSelection: () => void

  // --- tools & view -------------------------------------------------------
  setTool: (tool: ToolId) => void
  setShapeKind: (kind: ShapeKind) => void
  setDefaultStyle: (changes: Partial<ElementStyle>) => void
  setStickyColor: (color: string) => void
  setCamera: (camera: Camera) => void
  setViewport: (width: number, height: number) => void
  toggleUi: (key: keyof UiState, value?: boolean) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

function snapshot(state: BoardState, label: string): HistoryEntry {
  return { elements: { ...state.doc.elements }, selection: [...state.selection], label }
}

/** Renumbers stacking order when fractional indices lose precision. */
function reindex(els: ElementMap): void {
  const sorted = Object.values(els).sort((a, b) => a.order - b.order)
  sorted.forEach((el, i) => {
    els[el.id] = { ...el, order: i }
  })
}

// Dark is the default; a stored preference wins. Applied before the first
// render so the app never flashes the wrong theme.
const initialTheme: ThemeMode = loadThemePreference()
applyTheme(initialTheme)


export const useBoard = create<BoardState>((set, get) => ({
  doc: createEmptyDocument(newId()),
  camera: { x: -600, y: -400, zoom: 1 },
  filePath: null,
  dirty: false,

  tool: 'select',
  previousTool: 'select',
  shapeKind: 'rectangle',
  defaultStyle: { ...DEFAULT_STYLE },
  stickyColor: '#FFF9B1',

  selection: [],
  editingId: null,
  hoveredId: null,

  history: [],
  future: [],
  clipboard: [],

  ui: {
    showMinimap: true,
    showLayers: false,
    showGrid: true,
    snapToObjects: true,
    showShortcuts: false,
    showExportDialog: false,
    showShapePicker: false
  },
  theme: initialTheme,
  viewport: { width: 1200, height: 800 },

  // -- document ------------------------------------------------------------

  loadDocument: (rawDoc, filePath) => {
    const doc = normalizeDocument(rawDoc)
    set({
      doc,
      camera: doc.camera ?? { x: -600, y: -400, zoom: 1 },
      filePath,
      dirty: false,
      selection: [],
      editingId: null,
      history: [],
      future: []
    })
  },

  newDocument: () =>
    set({
      doc: createEmptyDocument(newId()),
      camera: { x: -600, y: -400, zoom: 1 },
      filePath: null,
      dirty: false,
      selection: [],
      editingId: null,
      history: [],
      future: []
    }),

  setFilePath: (filePath) => set({ filePath }),
  markSaved: () => set({ dirty: false }),

  renameBoard: (name) =>
    set((s) => ({ doc: { ...s.doc, name }, dirty: true })),

  setBackground: (background) =>
    set((s) => ({ doc: { ...s.doc, background }, dirty: true })),

  // -- history -------------------------------------------------------------

  pushHistory: (label = 'change') =>
    set((s) => ({
      history: [...s.history, snapshot(s, label)].slice(-HISTORY_LIMIT),
      future: []
    })),

  undo: () => {
    const s = get()
    const previous = s.history[s.history.length - 1]
    if (!previous) return
    set({
      history: s.history.slice(0, -1),
      future: [...s.future, snapshot(s, previous.label)].slice(-HISTORY_LIMIT),
      doc: { ...s.doc, elements: previous.elements },
      selection: previous.selection.filter((id) => previous.elements[id]),
      editingId: null,
      dirty: true
    })
  },

  redo: () => {
    const s = get()
    const next = s.future[s.future.length - 1]
    if (!next) return
    set({
      future: s.future.slice(0, -1),
      history: [...s.history, snapshot(s, next.label)].slice(-HISTORY_LIMIT),
      doc: { ...s.doc, elements: next.elements },
      selection: next.selection.filter((id) => next.elements[id]),
      editingId: null,
      dirty: true
    })
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  // -- mutation ------------------------------------------------------------

  mutate: (fn, options) => {
    const { history = true, label = 'change' } = options ?? {}
    if (history) get().pushHistory(label)
    set((s) => {
      const els: ElementMap = { ...s.doc.elements }
      fn(els)
      if (needsReindex(els)) reindex(els)
      return { doc: { ...s.doc, elements: els }, dirty: true }
    })
  },

  addElements: (newEls, options) => {
    const { select = true, history = true } = options ?? {}
    if (newEls.length === 0) return
    get().mutate(
      (els) => {
        for (const el of newEls) els[el.id] = el
      },
      { history, label: 'add' }
    )
    if (select) set({ selection: newEls.map((e) => e.id) })
  },

  patchElement: (id, changes, history = true) => {
    get().mutate(
      (els) => {
        const el = els[id]
        if (el) els[id] = { ...el, ...changes } as BoardElement
      },
      { history, label: 'edit' }
    )
  },

  patchElements: (ids, changes, history = true) => {
    get().mutate(
      (els) => {
        for (const id of ids) {
          const el = els[id]
          if (el) els[id] = { ...el, ...changes } as BoardElement
        }
      },
      { history, label: 'edit' }
    )
  },

  updateStyle: (changes, history = true) => {
    const s = get()
    set({ defaultStyle: { ...s.defaultStyle, ...changes } })
    const ids = expandGroups(s.selection, s.doc.elements)
    if (ids.length === 0) return
    s.mutate(
      (els) => {
        for (const id of ids) {
          const el = els[id]
          if (!el || el.locked) continue
          els[id] = { ...el, style: { ...el.style, ...changes } }
        }
      },
      { history, label: 'style' }
    )
  },

  removeElements: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    get().mutate(
      (els) => {
        for (const id of ids) delete els[id]
        // Unpin connectors that pointed at deleted elements, and drop
        // connectors that would lose both ends.
        for (const el of Object.values(els)) {
          if (el.type !== 'connector') continue
          const startGone = el.start.elementId && idSet.has(el.start.elementId)
          const endGone = el.end.elementId && idSet.has(el.end.elementId)
          if (!startGone && !endGone) continue
          if (startGone && endGone) {
            delete els[el.id]
            continue
          }
          const next = { ...el, start: { ...el.start }, end: { ...el.end } }
          if (startGone) next.start.elementId = null
          if (endGone) next.end.elementId = null
          els[el.id] = next
        }
        // Orphaned frame children become top-level.
        for (const el of Object.values(els)) {
          if (el.parentId && idSet.has(el.parentId)) {
            els[el.id] = { ...el, parentId: null }
          }
        }
      },
      { label: 'delete' }
    )
    set((s) => ({ selection: s.selection.filter((id) => !idSet.has(id)), editingId: null }))
  },

  deleteSelection: () => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements).filter(
      (id) => !s.doc.elements[id]?.locked
    )
    s.removeElements(ids)
  },

  // -- selection -----------------------------------------------------------

  setSelection: (ids) => set({ selection: [...new Set(ids)] }),
  addToSelection: (ids) => set((s) => ({ selection: [...new Set([...s.selection, ...ids])] })),
  toggleSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id]
    })),
  clearSelection: () => set({ selection: [], editingId: null }),
  selectAll: () =>
    set((s) => ({
      selection: Object.values(s.doc.elements)
        .filter((el) => !el.locked)
        .map((el) => el.id)
    })),
  setEditing: (id) => {
    const previous = get().editingId
    set({ editingId: id })
    if (previous && previous !== id) {
      // A text box abandoned without any content is just noise on the board.
      const el = get().doc.elements[previous]
      if (el?.type === 'text' && el.text.trim() === '') {
        get().mutate(
          (els) => {
            delete els[previous]
          },
          { history: false }
        )
        set((s) => ({ selection: s.selection.filter((sel) => sel !== previous) }))
      }
    }
  },
  setHovered: (id) => set((s) => (s.hoveredId === id ? s : { hoveredId: id })),

  selectedElements: () => {
    const s = get()
    return s.selection.map((id) => s.doc.elements[id]).filter(Boolean)
  },

  selectionBounds: () => {
    const s = get()
    return elementsBounds(s.selectedElements(), s.doc.elements)
  },

  // -- arrangement ---------------------------------------------------------

  bringToFront: (ids) => {
    const s = get()
    const target = expandGroups(ids ?? s.selection, s.doc.elements)
    if (target.length === 0) return
    s.mutate(
      (els) => {
        let order = topOrder(els)
        for (const id of target) {
          const el = els[id]
          if (el) els[id] = { ...el, order: order++ }
        }
      },
      { label: 'bring to front' }
    )
  },

  sendToBack: (ids) => {
    const s = get()
    const target = expandGroups(ids ?? s.selection, s.doc.elements)
    if (target.length === 0) return
    s.mutate(
      (els) => {
        const sorted = Object.values(els).sort((a, b) => a.order - b.order)
        let order = (sorted[0]?.order ?? 0) - target.length
        for (const id of target) {
          const el = els[id]
          if (el) els[id] = { ...el, order: order++ }
        }
      },
      { label: 'send to back' }
    )
  },

  bringForward: (ids) => {
    const s = get()
    const target = new Set(expandGroups(ids ?? s.selection, s.doc.elements))
    if (target.size === 0) return
    s.mutate(
      (els) => {
        const sorted = Object.values(els).sort((a, b) => a.order - b.order)
        for (let i = sorted.length - 2; i >= 0; i--) {
          const el = sorted[i]
          const above = sorted[i + 1]
          if (target.has(el.id) && !target.has(above.id)) {
            els[el.id] = { ...el, order: above.order }
            els[above.id] = { ...above, order: el.order }
            const tmp = sorted[i]
            sorted[i] = sorted[i + 1]
            sorted[i + 1] = tmp
          }
        }
      },
      { label: 'bring forward' }
    )
  },

  sendBackward: (ids) => {
    const s = get()
    const target = new Set(expandGroups(ids ?? s.selection, s.doc.elements))
    if (target.size === 0) return
    s.mutate(
      (els) => {
        const sorted = Object.values(els).sort((a, b) => a.order - b.order)
        for (let i = 1; i < sorted.length; i++) {
          const el = sorted[i]
          const below = sorted[i - 1]
          if (target.has(el.id) && !target.has(below.id)) {
            els[el.id] = { ...el, order: below.order }
            els[below.id] = { ...below, order: el.order }
            const tmp = sorted[i]
            sorted[i] = sorted[i - 1]
            sorted[i - 1] = tmp
          }
        }
      },
      { label: 'send backward' }
    )
  },

  group: () => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    if (ids.length < 2) return
    const groupId = newId()
    s.mutate(
      (els) => {
        for (const id of ids) {
          const el = els[id]
          if (el) els[id] = { ...el, groupId }
        }
      },
      { label: 'group' }
    )
  },

  ungroup: () => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    if (ids.length === 0) return
    s.mutate(
      (els) => {
        for (const id of ids) {
          const el = els[id]
          if (el) els[id] = { ...el, groupId: null }
        }
      },
      { label: 'ungroup' }
    )
  },

  lockSelection: (locked) => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    if (ids.length === 0) return
    s.patchElements(ids, { locked })
    if (locked) set({ selection: [] })
  },

  unlockAll: () => {
    const s = get()
    const locked = Object.values(s.doc.elements).filter((el) => el.locked)
    if (locked.length === 0) return
    s.mutate(
      (els) => {
        for (const el of locked) els[el.id] = { ...els[el.id], locked: false }
      },
      { label: 'unlock all' }
    )
  },

  alignSelection: (edge) => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    if (ids.length < 2) return
    const els = ids.map((id) => s.doc.elements[id]).filter(Boolean)
    const bounds = elementsBounds(els, s.doc.elements)
    if (!bounds) return

    s.mutate(
      (draft) => {
        for (const el of els) {
          if (el.locked) continue
          const current = draft[el.id]
          let { x, y } = current
          switch (edge) {
            case 'left':
              x = bounds.x
              break
            case 'right':
              x = bounds.x + bounds.width - current.width
              break
            case 'centerX':
              x = bounds.x + (bounds.width - current.width) / 2
              break
            case 'top':
              y = bounds.y
              break
            case 'bottom':
              y = bounds.y + bounds.height - current.height
              break
            case 'centerY':
              y = bounds.y + (bounds.height - current.height) / 2
              break
          }
          draft[el.id] = { ...current, x, y }
        }
      },
      { label: 'align' }
    )
  },

  distributeSelection: (axis) => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    const els = ids.map((id) => s.doc.elements[id]).filter(Boolean)
    if (els.length < 3) return

    const key = axis === 'x' ? 'x' : 'y'
    const sizeKey = axis === 'x' ? 'width' : 'height'
    const sorted = [...els].sort((a, b) => a[key] - b[key])
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const span = last[key] + last[sizeKey] - first[key]
    const totalSize = sorted.reduce((sum, el) => sum + el[sizeKey], 0)
    const gap = (span - totalSize) / (sorted.length - 1)

    s.mutate(
      (draft) => {
        let cursor = first[key]
        for (const el of sorted) {
          const current = draft[el.id]
          draft[el.id] = { ...current, [key]: cursor } as BoardElement
          cursor += current[sizeKey] + gap
        }
      },
      { label: 'distribute' }
    )
  },

  // -- clipboard -----------------------------------------------------------

  copySelection: () => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    const els = ids.map((id) => s.doc.elements[id]).filter(Boolean)
    if (els.length > 0) set({ clipboard: JSON.parse(JSON.stringify(els)) })
  },

  cutSelection: () => {
    const s = get()
    s.copySelection()
    s.deleteSelection()
  },

  paste: (at) => {
    const s = get()
    if (s.clipboard.length === 0) return
    const bounds = elementsBounds(s.clipboard, s.doc.elements)
    const offset: Vec = at && bounds
      ? { x: at.x - bounds.x - bounds.width / 2, y: at.y - bounds.y - bounds.height / 2 }
      : { x: 24, y: 24 }
    const copies = cloneElements(s.clipboard, offset)
    let order = topOrder(s.doc.elements)
    for (const copy of copies) copy.order = order++
    s.addElements(copies)
  },

  duplicateSelection: () => {
    const s = get()
    const ids = expandGroups(s.selection, s.doc.elements)
    const els = ids.map((id) => s.doc.elements[id]).filter(Boolean)
    if (els.length === 0) return
    const copies = cloneElements(els, { x: 20, y: 20 })
    let order = topOrder(s.doc.elements)
    for (const copy of copies) copy.order = order++
    s.addElements(copies)
  },

  // -- tools & view --------------------------------------------------------

  setTool: (tool) => {
    // Route through setEditing so an in-flight edit is closed and tidied up
    // rather than silently dropped.
    get().setEditing(null)
    set((s) => ({
      tool,
      previousTool: s.tool,
      selection: tool === 'select' || tool === 'hand' ? s.selection : [],
      ui: { ...s.ui, showShapePicker: tool === 'shape' ? s.ui.showShapePicker : false }
    }))
  },

  setShapeKind: (kind) => set({ shapeKind: kind, tool: 'shape' }),

  setDefaultStyle: (changes) =>
    set((s) => ({ defaultStyle: { ...s.defaultStyle, ...changes } })),

  setStickyColor: (color) => set({ stickyColor: color }),

  setCamera: (camera) => set({ camera }),

  setViewport: (width, height) => set({ viewport: { width, height } }),

  toggleUi: (key, value) =>
    set((s) => ({ ui: { ...s.ui, [key]: value ?? !s.ui[key] } })),

  setTheme: (theme) => {
    applyTheme(theme)
    saveThemePreference(theme)
    set({ theme })
  },

  toggleTheme: () => {
    const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  }
}))

/** Order value that puts a new element on top of the current stack. */
export function nextOrder(): number {
  return topOrder(useBoard.getState().doc.elements)
}

export { orderBetween }
