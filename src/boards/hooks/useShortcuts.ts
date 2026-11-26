import { useEffect, useRef } from 'react'
import { cameraForBox, steppedZoom, zoomAt } from '../core/camera'
import { elementsBounds, expandGroups } from '../core/elements'
import { useBoard, type ToolId } from '../state/store'
import type { BoardController } from '../canvas/interaction'

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'hand',
  n: 'sticky',
  s: 'shape',
  r: 'shape',
  t: 'text',
  c: 'connector',
  l: 'connector',
  p: 'draw',
  d: 'draw',
  e: 'eraser',
  f: 'frame'
}

const NUDGE_HISTORY_GAP = 700

/** True when the keystroke belongs to a focused text field, not the board. */
function isEditingText(): boolean {
  const active = document.activeElement
  if (!active) return false
  const tag = active.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement).isContentEditable
}

export function useShortcuts(controller: BoardController | null, active = true): void {
  const lastNudgeRef = useRef(0)

  useEffect(() => {
    if (!active) {
      controller?.setSpace(false)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!active) return
      const s = useBoard.getState()
      const mod = event.ctrlKey || event.metaKey
      const typing = isEditingText()

      if (event.key === ' ' && !typing) {
        event.preventDefault()
        controller?.setSpace(true)
        return
      }

      if (typing) return

      // ---- modifier combos -------------------------------------------------
      if (mod) {
        const key = event.key.toLowerCase()
        switch (key) {
          case 'z':
            event.preventDefault()
            if (event.shiftKey) s.redo()
            else s.undo()
            return
          case 'y':
            event.preventDefault()
            s.redo()
            return
          case 'a':
            event.preventDefault()
            s.selectAll()
            return
          case 'c':
            event.preventDefault()
            s.copySelection()
            return
          case 'x':
            event.preventDefault()
            s.cutSelection()
            return
          case 'v':
            event.preventDefault()
            s.paste()
            return
          case 'd':
            event.preventDefault()
            s.duplicateSelection()
            return
          case 'g':
            event.preventDefault()
            if (event.shiftKey) s.ungroup()
            else s.group()
            return
          case 'l':
            event.preventDefault()
            if (event.altKey) s.unlockAll()
            else s.lockSelection(true)
            return
          case ']':
            event.preventDefault()
            s.bringToFront()
            return
          case '[':
            event.preventDefault()
            s.sendToBack()
            return
          default:
            break
        }
        return
      }

      if (event.altKey) return

      // ---- plain keys ------------------------------------------------------
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          if (controller?.isInteracting) controller.cancel()
          else if (s.editingId) s.setEditing(null)
          else if (s.tool !== 'select') s.setTool('select')
          else s.clearSelection()
          return

        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          s.deleteSelection()
          return

        case 'Enter':
          if (s.selection.length === 1 && !s.editingId) {
            event.preventDefault()
            s.setEditing(s.selection[0])
          }
          return

        case 'Tab': {
          // Cycle through elements in stacking order.
          event.preventDefault()
          const ordered = Object.values(s.doc.elements)
            .filter((el) => !el.locked)
            .sort((a, b) => a.order - b.order)
          if (ordered.length === 0) return
          const index = ordered.findIndex((el) => el.id === s.selection[0])
          const next = ordered[(index + (event.shiftKey ? -1 : 1) + ordered.length) % ordered.length]
          s.setSelection([next.id])
          return
        }

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (s.selection.length === 0) return
          event.preventDefault()
          const step = event.shiftKey ? 10 : 1
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0

          // Group consecutive nudges into one undo step.
          const now = Date.now()
          const fresh = now - lastNudgeRef.current > NUDGE_HISTORY_GAP
          lastNudgeRef.current = now

          const ids = expandGroups(s.selection, s.doc.elements).filter(
            (id) => !s.doc.elements[id]?.locked
          )
          s.mutate(
            (els) => {
              for (const id of ids) {
                const el = els[id]
                if (el) els[id] = { ...el, x: el.x + dx, y: el.y + dy }
              }
            },
            { history: fresh, label: 'nudge' }
          )
          return
        }

        default:
          break
      }

      // ---- zoom ------------------------------------------------------------
      const center = { x: s.viewport.width / 2, y: s.viewport.height / 2 }
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        s.setCamera(zoomAt(s.camera, center, steppedZoom(s.camera.zoom, 1)))
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        s.setCamera(zoomAt(s.camera, center, steppedZoom(s.camera.zoom, -1)))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        s.setCamera(zoomAt(s.camera, center, 1))
        return
      }
      if (event.key === '1') {
        event.preventDefault()
        zoomToFit()
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        s.toggleUi('showShortcuts', true)
        return
      }

      // ---- tools -----------------------------------------------------------
      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool && !event.repeat) {
        event.preventDefault()
        s.setTool(tool)
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (!active) return
      if (event.key === ' ') controller?.setSpace(false)
    }

    const onBlur = (): void => controller?.setSpace(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [controller, active])
}

export function zoomToFit(): void {
  const s = useBoard.getState()
  const all = Object.values(s.doc.elements)
  if (all.length === 0) {
    s.setCamera({
      zoom: 1,
      x: -s.viewport.width / 2,
      y: -s.viewport.height / 2
    })
    return
  }
  const bounds = elementsBounds(all, s.doc.elements)
  if (bounds) s.setCamera(cameraForBox(bounds, s.viewport.width, s.viewport.height))
}

export function zoomToSelection(): void {
  const s = useBoard.getState()
  const bounds = elementsBounds(s.selectedElements(), s.doc.elements)
  if (bounds) s.setCamera(cameraForBox(bounds, s.viewport.width, s.viewport.height))
}
