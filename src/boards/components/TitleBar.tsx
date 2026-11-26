import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { isMac, shortcut } from '../core/platform'
import type { BoardMeta } from '../services/bridge'
import type { ExportKind } from '../services/fileService'
import { useBoard } from '../state/store'
import { Icon } from './Icon'

export interface TitleBarProps {
  boards: BoardMeta[]
  activeId: string | null
  activeMeta: BoardMeta | null
  saving: boolean
  onSelectBoard: (id: string) => void
  onNew: () => void
  onImportFile: () => void
  onDeleteBoard: (id: string) => void
  onSave: () => void
  onExport: (kind: ExportKind) => void
  onOpenPlanDoc?: (docId: string) => void
}

export function TitleBar({
  boards,
  activeId,
  activeMeta,
  saving,
  onSelectBoard,
  onNew,
  onImportFile,
  onDeleteBoard,
  onSave,
  onExport,
  onOpenPlanDoc
}: TitleBarProps): JSX.Element {
  const name = useBoard((s) => s.doc.name)
  const dirty = useBoard((s) => s.dirty)
  const showLayers = useBoard((s) => s.ui.showLayers)
  const renameBoard = useBoard((s) => s.renameBoard)
  const toggleUi = useBoard((s) => s.toggleUi)
  const theme = useBoard((s) => s.theme)
  const toggleTheme = useBoard((s) => s.toggleTheme)

  const [menuOpen, setMenuOpen] = useState<'boards' | 'export' | null>(null)
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (menuOpen && barRef.current && !barRef.current.contains(e.target as Node)) {
        setMenuOpen(null)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  return (
    <header ref={barRef} className={`boards-topbar${isMac ? ' boards-topbar--mac' : ''}`}>
      <div className="boards-switcher">
        <button
          type="button"
          className="boards-topbar__pill-btn"
          title="Switch or manage boards"
          aria-label="Boards menu"
          aria-expanded={menuOpen === 'boards'}
          onClick={() => setMenuOpen((prev) => (prev === 'boards' ? null : 'boards'))}
        >
          <Icon name="frame" size={14} />
          <span>Boards ({boards.length})</span>
          <Icon name="chevron-down" size={13} />
        </button>

        {menuOpen === 'boards' && (
          <div className="boards-popover" role="menu">
            <div className="boards-popover__head">
              <span>Your Boards</span>
              <button
                type="button"
                className="boards-topbar__pill-btn boards-topbar__pill-btn--accent"
                onClick={() => {
                  setMenuOpen(null)
                  onNew()
                }}
              >
                <Icon name="plus" size={12} /> New
              </button>
            </div>
            {boards.length === 0 ? (
              <div className="empty-hint">No saved boards yet.</div>
            ) : (
              boards.map((item) => (
                <div
                  key={item.id}
                  className={`boards-popover__row${item.id === activeId ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="boards-popover__row-main"
                    onClick={() => {
                      setMenuOpen(null)
                      onSelectBoard(item.id)
                    }}
                  >
                    <span className="boards-popover__row-title">{item.name || 'Untitled board'}</span>
                    <span className="boards-popover__row-meta">
                      {item.elementCount ?? 0} objects{item.docId ? ' · /plan' : ''}
                    </span>
                  </button>
                  {boards.length > 1 && (
                    <button
                      type="button"
                      className="boards-popover__del"
                      title="Delete board"
                      aria-label={`Delete ${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteBoard(item.id)
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
            <div className="boards-popover__divider" />
            <button
              type="button"
              className="boards-popover__row"
              onClick={() => {
                setMenuOpen(null)
                onImportFile()
              }}
            >
              <Icon name="folder" size={14} />
              <span>Import .miro / .json file…</span>
            </button>
          </div>
        )}
      </div>

      <input
        className="boards-topbar__name"
        value={name}
        aria-label="Board name"
        spellCheck={false}
        onChange={(e) => renameBoard(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {(dirty || saving) && (
        <span className="boards-topbar__dirty" title={saving ? 'Saving…' : 'Unsaved changes'}>
          {saving ? 'Saving…' : '•'}
        </span>
      )}

      {activeMeta?.docId && onOpenPlanDoc && (
        <button
          type="button"
          className="boards-topbar__pill-btn boards-topbar__pill-btn--accent"
          title="Open paired /plan documentation artifact"
          onClick={() => onOpenPlanDoc(activeMeta.docId!)}
        >
          <span>Open Plan Doc</span>
        </button>
      )}

      <div className="boards-topbar__spacer" />

      <div className="boards-topbar__actions">
        <button type="button" className="icon-btn" title="New board" aria-label="New board" onClick={onNew}>
          <Icon name="plus" size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Import .miro / .json file"
          aria-label="Open board file"
          onClick={onImportFile}
        >
          <Icon name="folder" size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={shortcut('Save now — Ctrl+S')}
          aria-label="Save board"
          onClick={onSave}
        >
          <Icon name="save" size={17} />
        </button>

        <div className="boards-switcher">
          <button
            type="button"
            className="icon-btn"
            title="Export PNG / SVG / JSON"
            aria-label="Export"
            aria-expanded={menuOpen === 'export'}
            onClick={() => setMenuOpen((prev) => (prev === 'export' ? null : 'export'))}
          >
            <Icon name="export" size={17} />
          </button>
          {menuOpen === 'export' && (
            <div className="boards-popover boards-popover--right" role="menu">
              <button
                type="button"
                className="boards-popover__row"
                onClick={() => {
                  setMenuOpen(null)
                  onExport('png')
                }}
              >
                <span>Export PNG (2×)</span>
              </button>
              <button
                type="button"
                className="boards-popover__row"
                onClick={() => {
                  setMenuOpen(null)
                  onExport('svg')
                }}
              >
                <span>Export SVG</span>
              </button>
              <button
                type="button"
                className="boards-popover__row"
                onClick={() => {
                  setMenuOpen(null)
                  onExport('json')
                }}
              >
                <span>Export JSON (.miro)</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`icon-btn${showLayers ? ' icon-btn--active' : ''}`}
          title={shortcut('Objects panel — Ctrl+Shift+L')}
          aria-label="Toggle objects panel"
          onClick={() => toggleUi('showLayers')}
        >
          <Icon name="panel" size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
          onClick={toggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={shortcut('Keyboard shortcuts — Ctrl+/')}
          aria-label="Keyboard shortcuts"
          onClick={() => toggleUi('showShortcuts', true)}
        >
          <Icon name="help" size={17} />
        </button>
      </div>
    </header>
  )
}
