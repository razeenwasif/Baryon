import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { screenToBoard } from '../core/camera'
import { createImage, topOrder } from '../core/elements'
import type { Vec } from '../core/geometry'
import { useBoard } from '../state/store'
import { BoardController, type PointerInfo } from '../canvas/interaction'
import { renderScene } from '../canvas/render'
import { renderOverlay } from '../canvas/overlay'
import { setImageLoadListener, loadImage } from '../canvas/imageCache'
import { TextEditor } from './TextEditor'
import { ContextMenu } from './ContextMenu'

export interface BoardCanvasProps {
  onController: (controller: BoardController) => void
  onToast: (message: string, kind?: 'info' | 'error') => void
}

interface MenuState {
  x: number
  y: number
  board: Vec
}

export function BoardCanvas({ onController, onToast }: BoardCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(true)
  const frameRef = useRef(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [cursor, setCursor] = useState('default')

  const requestRender = useCallback(() => {
    dirtyRef.current = true
  }, [])

  const controller = useMemo(
    () => new BoardController(requestRender, () => requestRender()),
    [requestRender]
  )

  useEffect(() => {
    onController(controller)
  }, [controller, onController])

  // -- redraw scheduling ----------------------------------------------------

  useEffect(() => {
    const unsubscribe = useBoard.subscribe(() => requestRender())
    setImageLoadListener(requestRender)
    return () => {
      unsubscribe()
      setImageLoadListener(null)
    }
  }, [requestRender])

  useEffect(() => {
    const draw = (): void => {
      frameRef.current = requestAnimationFrame(draw)
      if (!dirtyRef.current) return
      dirtyRef.current = false

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const s = useBoard.getState()
      const { width, height } = s.viewport
      const pixelRatio = window.devicePixelRatio || 1

      renderScene({
        ctx,
        width,
        height,
        pixelRatio,
        camera: s.camera,
        elements: s.doc.elements,
        background: s.doc.background,
        showGrid: s.ui.showGrid,
        hideTextFor: s.editingId
      })

      renderOverlay({
        ctx,
        pixelRatio,
        camera: s.camera,
        elements: s.doc.elements,
        selected: s.selectedElements(),
        hovered: s.hoveredId ? (s.doc.elements[s.hoveredId] ?? null) : null,
        marquee: controller.marquee,
        guides: controller.guides,
        connectorDraft: controller.connectorDraft,
        anchorHost: controller.anchorHost,
        editingId: s.editingId,
        showHandles: !controller.isInteracting
      })

      if (controller.cursor !== cursor) setCursor(controller.cursor)
    }
    frameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frameRef.current)
  }, [controller, cursor])

  // -- sizing ---------------------------------------------------------------

  useLayoutEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resize = (): void => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      useBoard.getState().setViewport(rect.width, rect.height)
      requestRender()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [requestRender])

  // -- pointer plumbing -----------------------------------------------------

  const toInfo = useCallback(
    (event: React.PointerEvent | PointerEvent): PointerInfo => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      return {
        screen,
        board: screenToBoard(screen, useBoard.getState().camera),
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        button: event.button,
        buttons: event.buttons,
        pressure:
          event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5
      }
    },
    []
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button === 2) return
      setMenu(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      controller.pointerDown(toInfo(event))
    },
    [controller, toInfo]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      controller.pointerMove(toInfo(event))
    },
    [controller, toInfo]
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      controller.pointerUp(toInfo(event))
    },
    [controller, toInfo]
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      controller.doubleClick({
        screen,
        board: screenToBoard(screen, useBoard.getState().camera),
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        button: 0,
        buttons: 0,
        pressure: 0.5
      })
    },
    [controller]
  )

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const board = screenToBoard(screen, useBoard.getState().camera)

      // Right-clicking an unselected element selects it first.
      const hit = controller.elementAt(board)
      const s = useBoard.getState()
      if (hit && !s.selection.includes(hit.id)) s.setSelection([hit.id])
      if (!hit) s.clearSelection()

      setMenu({ x: event.clientX, y: event.clientY, board })
    },
    [controller]
  )

  // Wheel must be a native non-passive listener to allow preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      controller.wheel(event, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [controller])

  // -- image drop -----------------------------------------------------------

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      )
      if (files.length === 0) return

      const rect = event.currentTarget.getBoundingClientRect()
      const board = screenToBoard(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        useBoard.getState().camera
      )

      let offset = 0
      for (const file of files) {
        try {
          const dataUri = await readAsDataUri(file)
          const image = await loadImage(dataUri)
          const scale = Math.min(1, 520 / Math.max(image.width, image.height))
          const width = image.width * scale
          const height = image.height * scale
          const s = useBoard.getState()
          const el = createImage(
            board.x - width / 2 + offset,
            board.y - height / 2 + offset,
            width,
            height,
            dataUri,
            image.width,
            image.height,
            { order: topOrder(s.doc.elements), style: { ...s.defaultStyle, stroke: 'transparent' } }
          )
          s.addElements([el])
          offset += 24
        } catch {
          onToast('That image could not be read.', 'error')
        }
      }
    },
    [onToast]
  )

  return (
    <div
      ref={containerRef}
      className="canvas-layer"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="board-canvas"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />
      <TextEditor />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          boardPoint={menu.board}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
