import type { BoardDocument } from '../shared/document'
import { createImage, topOrder } from '../core/elements'
import { loadImage } from '../canvas/imageCache'
import { useBoard } from '../state/store'
import { boardBridge, type BoardMeta } from './bridge'
import { exportArea, exportPng, exportSvg } from './exporters'

export type Toast = (message: string, kind?: 'info' | 'error') => void

/** The document with the live camera folded in, ready to be written to disk. */
export function currentDocument(): BoardDocument {
  const s = useBoard.getState()
  return { ...s.doc, camera: s.camera }
}

export async function saveBoard(toast: Toast, boardId: string): Promise<BoardMeta | null> {
  if (!boardId) return null
  try {
    const doc = currentDocument()
    const saved = await boardBridge.save(boardId, doc)
    useBoard.setState({ filePath: saved.meta.id, dirty: false })
    toast('Board saved')
    return saved.meta
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not save board.', 'error')
    return null
  }
}

export async function openBoardById(
  id: string,
  toast: Toast,
  currentId?: string
): Promise<BoardMeta | null> {
  const s = useBoard.getState()
  if (s.dirty && currentId) {
    await saveBoard(() => {}, currentId)
  }
  try {
    const loaded = await boardBridge.get(id)
    useBoard.getState().loadDocument(loaded.document, loaded.meta.id)
    useBoard.setState({ filePath: loaded.meta.id, dirty: false })
    return loaded.meta
  } catch (error) {
    toast(error instanceof Error ? error.message : 'That board could not be opened.', 'error')
    return null
  }
}

export async function importBoardFile(
  toast: Toast,
  currentId?: string
): Promise<BoardMeta | null> {
  const s = useBoard.getState()
  if (s.dirty && currentId) {
    await saveBoard(() => {}, currentId)
  }
  const result = await boardBridge.openFile()
  if (result.canceled) return null
  if (result.error || !result.document || !result.meta) {
    toast(result.error ?? 'That board could not be opened.', 'error')
    return null
  }
  useBoard.getState().loadDocument(result.document, result.meta.id)
  useBoard.setState({ filePath: result.meta.id, dirty: false })
  toast(`Imported “${result.document.name}”`)
  return result.meta
}

export async function createNewBoard(toast: Toast, name = 'Untitled board', currentId?: string): Promise<BoardMeta | null> {
  const s = useBoard.getState()
  if (s.dirty && currentId) {
    await saveBoard(() => {}, currentId)
  }
  try {
    useBoard.getState().newDocument()
    const fresh = currentDocument()
    const created = await boardBridge.create({ name, doc: { ...fresh, name } })
    useBoard.getState().loadDocument(created.document, created.meta.id)
    useBoard.setState({ filePath: created.meta.id, dirty: false })
    toast(`Created “${created.meta.name}”`)
    return created.meta
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not create board.', 'error')
    return null
  }
}

export type ExportKind = 'png' | 'svg' | 'json'

export async function exportBoard(kind: ExportKind, toast: Toast): Promise<void> {
  const s = useBoard.getState()
  const doc = currentDocument()
  const name = (doc.name || 'board').replace(/[\\/:*?"<>|]/g, '-')

  const area = exportArea(doc, s.selection.length > 0 ? s.selection : undefined)
  if (!area && kind !== 'json') {
    toast('There is nothing on the board to export.', 'error')
    return
  }

  try {
    if (kind === 'json') {
      const result = await boardBridge.exportFile({
        data: JSON.stringify(doc, null, 2),
        encoding: 'utf8',
        extension: 'json',
        defaultName: name
      })
      if (!result.canceled && !result.error) toast('Exported JSON')
      if (result.error) toast(result.error, 'error')
      return
    }

    if (kind === 'svg') {
      const result = await boardBridge.exportFile({
        data: exportSvg(doc, area!),
        encoding: 'utf8',
        extension: 'svg',
        defaultName: name
      })
      if (!result.canceled && !result.error) toast('Exported SVG')
      if (result.error) toast(result.error, 'error')
      return
    }

    const base64 = await exportPng(doc, area!, { scale: 2 })
    const result = await boardBridge.exportFile({
      data: base64,
      encoding: 'base64',
      extension: 'png',
      defaultName: name
    })
    if (!result.canceled && !result.error) toast('Exported PNG')
    if (result.error) toast(result.error, 'error')
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export failed.', 'error')
  }
}

/** Adds images picked from the native file dialog to the middle of the view. */
export async function importImages(toast: Toast): Promise<void> {
  const result = await boardBridge.importImage()
  if (result.canceled || !result.images) return

  const s = useBoard.getState()
  const center = {
    x: s.camera.x + s.viewport.width / 2 / s.camera.zoom,
    y: s.camera.y + s.viewport.height / 2 / s.camera.zoom
  }

  let offset = 0
  for (const src of result.images) {
    try {
      const image = await loadImage(src)
      const scale = Math.min(1, 520 / Math.max(image.width, image.height))
      const width = image.width * scale
      const height = image.height * scale
      const state = useBoard.getState()
      const el = createImage(
        center.x - width / 2 + offset,
        center.y - height / 2 + offset,
        width,
        height,
        src,
        image.width,
        image.height,
        { order: topOrder(state.doc.elements), style: { ...state.defaultStyle, stroke: 'transparent' } }
      )
      state.addElements([el])
      offset += 24
    } catch {
      toast('One image could not be decoded.', 'error')
    }
  }
}
