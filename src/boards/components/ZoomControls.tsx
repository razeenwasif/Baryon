import { minimapShortcut, shortcut } from '../core/platform'
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { cameraForBox, steppedZoom, zoomAt, ZOOM_STEPS } from '../core/camera'
import { elementsBounds } from '../core/elements'
import { useBoard } from '../state/store'
import { Icon } from './Icon'

export function ZoomControls(): JSX.Element {
  const camera = useBoard((s) => s.camera)
  const viewport = useBoard((s) => s.viewport)
  const setCamera = useBoard((s) => s.setCamera)
  const showMinimap = useBoard((s) => s.ui.showMinimap)
  const toggleUi = useBoard((s) => s.toggleUi)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const center = { x: viewport.width / 2, y: viewport.height / 2 }

  const zoomTo = (zoom: number): void => {
    setCamera(zoomAt(camera, center, zoom))
    setMenuOpen(false)
  }

  const zoomToFit = (): void => {
    const s = useBoard.getState()
    const all = Object.values(s.doc.elements)
    if (all.length === 0) {
      setCamera({ zoom: 1, x: -viewport.width / 2, y: -viewport.height / 2 })
      setMenuOpen(false)
      return
    }
    const bounds = elementsBounds(all, s.doc.elements)
    if (bounds) setCamera(cameraForBox(bounds, viewport.width, viewport.height))
    setMenuOpen(false)
  }

  return (
    <div className="zoom-controls" ref={rootRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        title={`Toggle minimap — ${minimapShortcut}`}
        aria-label="Toggle minimap"
        aria-pressed={showMinimap}
        onClick={() => toggleUi('showMinimap')}
      >
        <Icon name="minimap" size={17} />
      </button>
      <button
        className="icon-btn"
        title={shortcut('Zoom to fit — Ctrl+1')}
        aria-label="Zoom to fit"
        onClick={zoomToFit}
      >
        <Icon name="fit" size={17} />
      </button>
      <button
        className="icon-btn"
        title={shortcut('Zoom out — Ctrl+-')}
        aria-label="Zoom out"
        onClick={() => zoomTo(steppedZoom(camera.zoom, -1))}
      >
        <Icon name="minus" size={17} />
      </button>
      <button
        className="zoom-value"
        title="Zoom presets"
        aria-label="Zoom level"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {Math.round(camera.zoom * 100)}%
      </button>
      <button
        className="icon-btn"
        title={shortcut('Zoom in — Ctrl+=')}
        aria-label="Zoom in"
        onClick={() => zoomTo(steppedZoom(camera.zoom, 1))}
      >
        <Icon name="plus" size={17} />
      </button>

      {menuOpen && (
        <div className="popover" style={{ bottom: '100%', right: 0, marginBottom: 8, width: 150 }}>
          <button className="menu-item" onClick={zoomToFit}>
            Zoom to fit
            <span className="menu-item__shortcut">{shortcut('Ctrl 1')}</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              const s = useBoard.getState()
              const bounds = elementsBounds(s.selectedElements(), s.doc.elements)
              if (bounds) setCamera(cameraForBox(bounds, viewport.width, viewport.height))
              setMenuOpen(false)
            }}
          >
            Zoom to selection
            <span className="menu-item__shortcut">{shortcut('Ctrl 2')}</span>
          </button>
          <div className="menu-sep" />
          {ZOOM_STEPS.map((step) => (
            <button key={step} className="menu-item" onClick={() => zoomTo(step)}>
              {Math.round(step * 100)}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
