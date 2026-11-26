import type { JSX } from 'react'
import { sortedElements, type BoardElement } from '../shared/document'
import { SHAPE_LABELS } from '../core/shapes'
import { useBoard } from '../state/store'
import { Icon, type IconName } from './Icon'

export function LayersPanel(): JSX.Element | null {
  const show = useBoard((s) => s.ui.showLayers)
  const elements = useBoard((s) => s.doc.elements)
  const selection = useBoard((s) => s.selection)
  const toggleUi = useBoard((s) => s.toggleUi)
  const setSelection = useBoard((s) => s.setSelection)
  const patchElement = useBoard((s) => s.patchElement)
  const stylePanelVisible = useBoard(
    (s) => s.selection.length > 0 || s.tool === 'sticky' || s.tool === 'shape' || s.tool === 'text'
  )

  if (!show) return null

  // Top of the stack first, matching how designers read a layer list.
  const ordered = [...sortedElements(elements)].reverse()

  return (
    <div className={`layers-panel${stylePanelVisible ? ' layers-panel--offset' : ''}`}>
      <div className="layers-panel__head">
        <strong style={{ fontSize: 12.5 }}>Objects ({ordered.length})</strong>
        <button
          className="icon-btn"
          title="Close"
          aria-label="Close objects panel"
          onClick={() => toggleUi('showLayers', false)}
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="layers-panel__list">
        {ordered.length === 0 && (
          <p className="empty-hint">
            Nothing on the board yet.
            <br />
            Add a sticky note or shape to get started.
          </p>
        )}
        {ordered.map((el) => {
          const active = selection.includes(el.id)
          return (
            <button
              key={el.id}
              className={`layer-item${active ? ' layer-item--active' : ''}`}
              onClick={(e) =>
                setSelection(e.shiftKey ? [...selection, el.id] : [el.id])
              }
              onDoubleClick={() => {
                if (el.type !== 'frame') useBoard.getState().setEditing(el.id)
              }}
            >
              <span className="layer-item__icon">
                <Icon name={iconFor(el)} size={15} />
              </span>
              <span className="layer-item__label">{labelFor(el)}</span>
              <span
                className="layer-item__icon"
                role="button"
                tabIndex={-1}
                title={el.locked ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation()
                  patchElement(el.id, { locked: !el.locked })
                }}
              >
                <Icon name={el.locked ? 'lock' : 'unlock'} size={14} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function iconFor(el: BoardElement): IconName {
  switch (el.type) {
    case 'sticky':
      return 'sticky'
    case 'shape':
      return 'shapes'
    case 'text':
      return 'text'
    case 'draw':
      return 'pen'
    case 'connector':
      return 'connector'
    case 'frame':
      return 'frame'
    case 'image':
      return 'image'
  }
}

function labelFor(el: BoardElement): string {
  const firstLine = (text: string | undefined): string =>
    (text ?? '').trim().split('\n')[0]

  switch (el.type) {
    case 'sticky':
      return firstLine(el.text) || 'Sticky note'
    case 'shape':
      return firstLine(el.text) || SHAPE_LABELS[el.shape] || 'Shape'
    case 'text':
      return firstLine(el.text) || 'Text'
    case 'draw':
      return 'Drawing'
    case 'connector':
      return firstLine(el.text) || 'Connector'
    case 'frame':
      return el.name
    case 'image':
      return 'Image'
  }
}
