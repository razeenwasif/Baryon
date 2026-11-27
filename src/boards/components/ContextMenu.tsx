import { shortcut } from '../core/platform'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Vec } from '../core/geometry'
import { useBoard } from '../state/store'
import { Icon, type IconName } from './Icon'

export interface ContextMenuProps {
  x: number
  y: number
  boardPoint: Vec
  onClose: () => void
}

interface Entry {
  kind: 'item'
  label: string
  icon?: IconName
  shortcut?: string
  disabled?: boolean
  run: () => void
}

type Row = Entry | { kind: 'sep' }

export function ContextMenu({ x, y, boardPoint, onClose }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const selection = useBoard((s) => s.selection)
  const hasSelection = selection.length > 0
  const clipboard = useBoard((s) => s.clipboard)

  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  // Flip the menu back inside the window when it would overflow.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8)
    })
  }, [x, y])

  const s = useBoard.getState()
  const act = (fn: () => void) => (): void => {
    fn()
    onClose()
  }

  const rows: Row[] = hasSelection
    ? [
        { kind: 'item', label: 'Cut', icon: 'copy', shortcut: 'Ctrl X', run: act(s.cutSelection) },
        { kind: 'item', label: 'Copy', icon: 'copy', shortcut: 'Ctrl C', run: act(s.copySelection) },
        {
          kind: 'item',
          label: 'Duplicate',
          icon: 'duplicate',
          shortcut: 'Ctrl D',
          run: act(s.duplicateSelection)
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Bring to front',
          icon: 'bring-front',
          shortcut: 'Ctrl ]',
          run: act(() => s.bringToFront())
        },
        {
          kind: 'item',
          label: 'Send to back',
          icon: 'send-back',
          shortcut: 'Ctrl [',
          run: act(() => s.sendToBack())
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Group',
          icon: 'group',
          shortcut: 'Ctrl G',
          disabled: selection.length < 2,
          run: act(s.group)
        },
        {
          kind: 'item',
          label: 'Ungroup',
          icon: 'ungroup',
          shortcut: 'Ctrl ⇧ G',
          run: act(s.ungroup)
        },
        {
          kind: 'item',
          label: 'Lock',
          icon: 'lock',
          shortcut: 'Ctrl L',
          run: act(() => s.lockSelection(true))
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Delete',
          icon: 'trash',
          shortcut: 'Del',
          run: act(s.deleteSelection)
        }
      ]
    : [
        {
          kind: 'item',
          label: 'Paste here',
          icon: 'duplicate',
          shortcut: 'Ctrl V',
          disabled: clipboard.length === 0,
          run: act(() => s.paste(boardPoint))
        },
        {
          kind: 'item',
          label: 'Select all',
          icon: 'select',
          shortcut: 'Ctrl A',
          run: act(s.selectAll)
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: s.ui.showGrid ? 'Hide grid' : 'Show grid',
          icon: 'grid',
          shortcut: "Ctrl '",
          run: act(() => s.toggleUi('showGrid'))
        },
        {
          kind: 'item',
          label: s.ui.snapToObjects ? 'Disable snapping' : 'Enable snapping',
          icon: 'flip',
          run: act(() => s.toggleUi('snapToObjects'))
        },
        {
          kind: 'item',
          label: s.ui.showLayers ? 'Hide objects panel' : 'Show objects panel',
          icon: 'panel',
          shortcut: 'Ctrl ⇧ L',
          run: act(() => s.toggleUi('showLayers'))
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Unlock all',
          icon: 'unlock',
          shortcut: 'Ctrl Alt L',
          run: act(s.unlockAll)
        }
      ]

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {rows.map((row, index) =>
        row.kind === 'sep' ? (
          <div className="menu-sep" key={`sep-${index}`} />
        ) : (
          <button
            key={row.label}
            className="menu-item"
            role="menuitem"
            disabled={row.disabled}
            onClick={row.run}
          >
            {row.icon && <Icon name={row.icon} size={15} />}
            {row.label}
            {row.shortcut && <span className="menu-item__shortcut">{shortcut(row.shortcut)}</span>}
          </button>
        )
      )}
    </div>
  )
}
