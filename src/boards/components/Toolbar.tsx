import { shortcut } from '../core/platform'
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { SHAPE_KINDS, type ShapeKind } from '../shared/document'
import { buildShapePath, SHAPE_LABELS } from '../core/shapes'
import { STICKY_COLORS } from '../core/palette'
import { useBoard, type ToolId } from '../state/store'
import { Icon, type IconName } from './Icon'

interface ToolDef {
  id: ToolId
  icon: IconName
  label: string
  shortcut: string
  flyout?: 'sticky' | 'shape'
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'select', label: 'Select', shortcut: 'V' },
  { id: 'hand', icon: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'sticky', icon: 'sticky', label: 'Sticky note', shortcut: 'N', flyout: 'sticky' },
  { id: 'shape', icon: 'shapes', label: 'Shape', shortcut: 'S', flyout: 'shape' },
  { id: 'text', icon: 'text', label: 'Text', shortcut: 'T' },
  { id: 'connector', icon: 'connector', label: 'Connector', shortcut: 'C' },
  { id: 'draw', icon: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'frame', icon: 'frame', label: 'Frame', shortcut: 'F' }
]

export interface ToolbarProps {
  onAddImage: () => void
}

export function Toolbar({ onAddImage }: ToolbarProps): JSX.Element {
  const tool = useBoard((s) => s.tool)
  const setTool = useBoard((s) => s.setTool)
  const [flyout, setFlyout] = useState<'sticky' | 'shape' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!flyout) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setFlyout(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [flyout])

  return (
    <div className="toolbar" ref={rootRef}>
      {TOOLS.map((def) => (
        <button
          key={def.id}
          className={`tool-btn${tool === def.id ? ' tool-btn--active' : ''}`}
          title={`${def.label} — ${def.shortcut}`}
          aria-label={def.label}
          aria-pressed={tool === def.id}
          onClick={() => {
            setTool(def.id)
            setFlyout(def.flyout && tool === def.id ? (flyout ? null : def.flyout) : def.flyout ?? null)
          }}
        >
          <Icon name={def.icon} />
          {def.flyout && <span className="tool-btn__caret" />}
        </button>
      ))}

      <div className="toolbar__divider" />

      <button
        className="tool-btn"
        title={shortcut('Add image — Ctrl+Shift+I')}
        aria-label="Add image"
        onClick={onAddImage}
      >
        <Icon name="image" />
      </button>

      {flyout === 'sticky' && <StickyFlyout onPick={() => setFlyout(null)} />}
      {flyout === 'shape' && <ShapeFlyout onPick={() => setFlyout(null)} />}
    </div>
  )
}

function StickyFlyout({ onPick }: { onPick: () => void }): JSX.Element {
  const stickyColor = useBoard((s) => s.stickyColor)
  const setStickyColor = useBoard((s) => s.setStickyColor)

  return (
    <div className="popover" style={{ left: '100%', marginLeft: 10, top: 96, width: 208 }}>
      <div className="popover__title">Sticky colour</div>
      <div className="color-grid">
        {STICKY_COLORS.map((swatch) => (
          <button
            key={swatch.value}
            className={`swatch${stickyColor === swatch.value ? ' swatch--active' : ''}`}
            style={{ background: swatch.value }}
            title={swatch.name}
            aria-label={swatch.name}
            onClick={() => {
              setStickyColor(swatch.value)
              onPick()
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ShapeFlyout({ onPick }: { onPick: () => void }): JSX.Element {
  const shapeKind = useBoard((s) => s.shapeKind)
  const setShapeKind = useBoard((s) => s.setShapeKind)

  return (
    <div className="popover" style={{ left: '100%', marginLeft: 10, top: 130, width: 226 }}>
      <div className="popover__title">Shapes</div>
      <div className="shape-grid">
        {SHAPE_KINDS.map((kind) => (
          <button
            key={kind}
            className={`shape-btn${shapeKind === kind ? ' shape-btn--active' : ''}`}
            title={SHAPE_LABELS[kind]}
            aria-label={SHAPE_LABELS[kind]}
            onClick={() => {
              setShapeKind(kind)
              onPick()
            }}
          >
            <ShapeGlyph kind={kind} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Renders a shape preview by reusing the same Path2D the canvas draws. */
export function ShapeGlyph({ kind, size = 22 }: { kind: ShapeKind; size?: number }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const inset = 2
    const path = buildShapePath(kind, size - inset * 2, size - inset * 2)
    ctx.save()
    ctx.translate(inset, inset)
    ctx.strokeStyle = 'currentColor'
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    // currentColor is not resolvable on canvas, so read the computed colour.
    ctx.strokeStyle = getComputedStyle(canvas).color
    ctx.stroke(path)
    ctx.restore()
  }, [kind, size])

  return <canvas ref={canvasRef} style={{ width: size, height: size }} />
}
