import { shortcut } from '../core/platform'
import type { JSX } from 'react'
import { useBoard } from '../state/store'
import { Icon } from './Icon'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['Select', 'V'],
      ['Hand / pan', 'H'],
      ['Sticky note', 'N'],
      ['Shape', 'S'],
      ['Text', 'T'],
      ['Connector', 'C'],
      ['Pen', 'P'],
      ['Eraser', 'E'],
      ['Frame', 'F'],
      ['Temporary pan', 'Hold Space']
    ]
  },
  {
    title: 'Edit',
    items: [
      ['Undo', 'Ctrl Z'],
      ['Redo', 'Ctrl Shift Z'],
      ['Cut', 'Ctrl X'],
      ['Copy', 'Ctrl C'],
      ['Paste', 'Ctrl V'],
      ['Duplicate', 'Ctrl D'],
      ['Delete', 'Delete'],
      ['Select all', 'Ctrl A'],
      ['Edit text', 'Enter or double-click'],
      ['Cancel / deselect', 'Esc']
    ]
  },
  {
    title: 'Arrange',
    items: [
      ['Group', 'Ctrl G'],
      ['Ungroup', 'Ctrl Shift G'],
      ['Bring to front', 'Ctrl ]'],
      ['Send to back', 'Ctrl ['],
      ['Lock', 'Ctrl L'],
      ['Unlock all', 'Ctrl Alt L'],
      ['Nudge 1px', 'Arrow keys'],
      ['Nudge 10px', 'Shift + arrows'],
      ['Constrain / lock axis', 'Hold Shift'],
      ['Duplicate on drag', 'Hold Alt']
    ]
  },
  {
    title: 'View & file',
    items: [
      ['Zoom in / out', 'Ctrl = / Ctrl -'],
      ['Zoom to 100%', 'Ctrl 0'],
      ['Zoom to fit', 'Ctrl 1'],
      ['Zoom to selection', 'Ctrl 2'],
      ['Pan', 'Scroll or middle-drag'],
      ['Zoom at pointer', 'Ctrl + scroll'],
      ['New board', 'Ctrl N'],
      ['Open / Save', 'Ctrl O / Ctrl S'],
      ['Export PNG', 'Ctrl Shift E'],
      ['This dialog', 'Ctrl /']
    ]
  }
]

export function ShortcutsDialog(): JSX.Element | null {
  const show = useBoard((s) => s.ui.showShortcuts)
  const toggleUi = useBoard((s) => s.toggleUi)
  if (!show) return null

  return (
    <div className="dialog-backdrop" onClick={() => toggleUi('showShortcuts', false)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="dialog__head">
          <span className="dialog__title">Keyboard shortcuts</span>
          <button
            className="icon-btn"
            onClick={() => toggleUi('showShortcuts', false)}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dialog__body">
          <div className="shortcut-columns">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="shortcut-group__title">{group.title}</div>
                {group.items.map(([label, keys]) => (
                  <div className="shortcut-row" key={label}>
                    <span>{label}</span>
                    <kbd>{shortcut(keys)}</kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
