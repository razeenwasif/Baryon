import { useCallback, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { sortedElements } from '../shared/document'
import { centerOn } from '../core/camera'
import { connectorPath, elementBounds, elementsBounds } from '../core/elements'
import { unionBox, type Box } from '../core/geometry'
import { canvasTheme, resolveInk } from '../core/theme'
import { useBoard } from '../state/store'

const WIDTH = 208
const HEIGHT = 138
const PADDING = 10

/**
 * A cheap schematic of the whole board: elements as filled blocks, plus a
 * rectangle showing where the viewport currently sits. Clicking recentres.
 */
export function Minimap(): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const show = useBoard((s) => s.ui.showMinimap)
  const elements = useBoard((s) => s.doc.elements)
  const camera = useBoard((s) => s.camera)
  const viewport = useBoard((s) => s.viewport)
  // Subscribed so a theme switch repaints the minimap.
  const themeMode = useBoard((s) => s.theme)
  const boundsRef = useRef<{ world: Box; scale: number } | null>(null)

  const worldBounds = useCallback((): Box => {
    const all = Object.values(elements)
    const view: Box = {
      x: camera.x,
      y: camera.y,
      width: viewport.width / camera.zoom,
      height: viewport.height / camera.zoom
    }
    const content = all.length > 0 ? elementsBounds(all, elements) : null
    const merged = content ? unionBox(content, view) : view
    const pad = Math.max(merged.width, merged.height) * 0.08
    return {
      x: merged.x - pad,
      y: merged.y - pad,
      width: merged.width + pad * 2,
      height: merged.height + pad * 2
    }
  }, [elements, camera, viewport])

  useEffect(() => {
    if (!show) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const theme = canvasTheme()
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = theme.minimapBackground
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    const world = worldBounds()
    const scale = Math.min(
      (WIDTH - PADDING * 2) / Math.max(world.width, 1),
      (HEIGHT - PADDING * 2) / Math.max(world.height, 1)
    )
    boundsRef.current = { world, scale }

    const offsetX = (WIDTH - world.width * scale) / 2
    const offsetY = (HEIGHT - world.height * scale) / 2
    const toMap = (x: number, y: number): [number, number] => [
      offsetX + (x - world.x) * scale,
      offsetY + (y - world.y) * scale
    ]

    for (const el of sortedElements(elements)) {
      if (el.type === 'connector') {
        const pts = connectorPath(el, elements)
        ctx.strokeStyle = theme.minimapConnector
        ctx.lineWidth = 1
        ctx.beginPath()
        pts.forEach((p, i) => {
          const [mx, my] = toMap(p.x, p.y)
          if (i === 0) ctx.moveTo(mx, my)
          else ctx.lineTo(mx, my)
        })
        ctx.stroke()
        continue
      }
      const b = elementBounds(el, elements)
      const [mx, my] = toMap(b.x, b.y)
      const mw = Math.max(1.5, b.width * scale)
      const mh = Math.max(1.5, b.height * scale)
      if (el.type === 'frame') {
        ctx.strokeStyle = theme.minimapFrame
        ctx.lineWidth = 1
        ctx.strokeRect(mx, my, mw, mh)
        continue
      }
      ctx.fillStyle =
        el.style.fill && el.style.fill !== 'transparent'
          ? el.style.fill
          : el.style.stroke !== 'transparent'
            ? resolveInk(el.style.stroke)
            : theme.placeholderText
      ctx.globalAlpha = 0.9
      ctx.fillRect(mx, my, mw, mh)
      ctx.globalAlpha = 1
    }

    // Viewport indicator.
    const [vx, vy] = toMap(camera.x, camera.y)
    const vw = (viewport.width / camera.zoom) * scale
    const vh = (viewport.height / camera.zoom) * scale
    ctx.strokeStyle = '#4262ff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(vx, vy, vw, vh)
    ctx.fillStyle = 'rgba(66, 98, 255, 0.08)'
    ctx.fillRect(vx, vy, vw, vh)
  }, [show, elements, camera, viewport, worldBounds, themeMode])

  if (!show) return null

  const jumpTo = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const info = boundsRef.current
    if (!info) return
    const rect = event.currentTarget.getBoundingClientRect()
    const mx = event.clientX - rect.left
    const my = event.clientY - rect.top
    const offsetX = (WIDTH - info.world.width * info.scale) / 2
    const offsetY = (HEIGHT - info.world.height * info.scale) / 2
    const board = {
      x: info.world.x + (mx - offsetX) / info.scale,
      y: info.world.y + (my - offsetY) / info.scale
    }
    const s = useBoard.getState()
    s.setCamera(centerOn(s.camera, board, s.viewport.width, s.viewport.height))
  }

  return (
    <div className="minimap" title="Minimap — click to jump">
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT }}
        onClick={jumpTo}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
