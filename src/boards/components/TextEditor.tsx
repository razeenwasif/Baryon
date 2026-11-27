import { useEffect, useLayoutEffect, useRef } from 'react'
import type { JSX } from 'react'
import { hasText, type BoardElement } from '../shared/document'
import { boardToScreen } from '../core/camera'
import { getScratchCtx } from '../core/elements'
import { cssFontFamily, LINE_HEIGHT_RATIO, layoutTextToFit } from '../core/text'
import { resolveInk } from '../core/theme'
import { stickyInk } from '../canvas/render'
import { useBoard } from '../state/store'

const STICKY_PADDING = 14

/**
 * The inline text editor. It mirrors the canvas text metrics exactly by
 * positioning an unscaled textarea at the element's board size and letting a
 * CSS transform apply the camera zoom, so characters never reflow when the
 * editor opens or closes.
 */
export function TextEditor(): JSX.Element | null {
  const editingId = useBoard((s) => s.editingId)
  const element = useBoard((s) => (s.editingId ? s.doc.elements[s.editingId] : undefined))
  const camera = useBoard((s) => s.camera)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /**
   * Keystrokes are written straight through to the element rather than held in
   * local state. That way ending an edit from anywhere — blur, Escape, the
   * menu, a tool change — can never strand a half-typed or empty element.
   */
  const value = element && hasText(element) ? element.text : ''
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!editingId) return
    dirtyRef.current = false
    // A fresh element starts empty; an existing one gets its text selected so
    // typing replaces it, which is what double-click-to-edit implies.
    const id = requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.select()
    })
    return () => cancelAnimationFrame(id)
  }, [editingId])

  useLayoutEffect(() => {
    autoGrow(textareaRef.current)
  }, [value])

  if (!editingId || !element || !hasText(element)) return null

  const change = (next: string): void => {
    const s = useBoard.getState()
    // One undo step per editing session, taken at the first keystroke.
    if (!dirtyRef.current) {
      dirtyRef.current = true
      s.pushHistory('text')
    }
    s.patchElement(editingId, { text: next } as Partial<BoardElement>, false)
    growAutoHeightElement(element, next)
  }

  const commit = (): void => {
    useBoard.getState().setEditing(null)
  }

  const metrics = editorMetrics(element)
  const origin = boardToScreen({ x: metrics.x, y: metrics.y }, camera)
  // Match exactly what the canvas would paint, so the text never shifts colour
  // as the editor opens and closes.
  const ink =
    element.type === 'sticky'
      ? stickyInk(element.style.textColor, element.style.fill)
      : resolveInk(element.style.textColor)

  return (
    <div
      style={{
        position: 'absolute',
        left: origin.x,
        top: origin.y,
        width: metrics.width,
        height: metrics.height,
        transform: `rotate(${element.rotation}rad) scale(${camera.zoom})`,
        transformOrigin: '0 0',
        display: 'flex',
        alignItems:
          element.style.verticalAlign === 'top'
            ? 'flex-start'
            : element.style.verticalAlign === 'bottom'
              ? 'flex-end'
              : 'center',
        zIndex: 15
      }}
    >
      <textarea
        ref={textareaRef}
        className="text-editor"
        value={value}
        spellCheck
        onChange={(e) => change(e.target.value)}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            commit()
          }
        }}
        style={{
          position: 'relative',
          width: '100%',
          padding: 0,
          border: 'none',
          boxShadow: 'none',
          background: 'transparent',
          color: ink,
          fontFamily: cssFontFamily(element.style.fontFamily),
          fontSize: `${metrics.fontSize}px`,
          fontWeight: element.style.bold ? 700 : 400,
          fontStyle: element.style.italic ? 'italic' : 'normal',
          textDecoration: element.style.underline ? 'underline' : 'none',
          lineHeight: LINE_HEIGHT_RATIO,
          textAlign: element.style.textAlign,
          caretColor: ink
        }}
      />
    </div>
  )
}

function autoGrow(node: HTMLTextAreaElement | null): void {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

/** The editable region inside an element, matching the canvas text insets. */
function editorMetrics(el: BoardElement): {
  x: number
  y: number
  width: number
  height: number
  fontSize: number
} {
  if (el.type === 'sticky') {
    const width = el.width - STICKY_PADDING * 2
    const height = el.height - STICKY_PADDING * 2
    // Match the shrink-to-fit size the canvas would have picked.
    const layout = layoutTextToFit(
      getScratchCtx(),
      'text' in el ? el.text || ' ' : ' ',
      el.style,
      width,
      height
    )
    return {
      x: el.x + STICKY_PADDING,
      y: el.y + STICKY_PADDING,
      width,
      height,
      fontSize: layout.fontSize
    }
  }

  if (el.type === 'shape') {
    const insetX = el.width * 0.08
    const insetY = el.height * 0.08
    return {
      x: el.x + insetX,
      y: el.y + insetY,
      width: el.width - insetX * 2,
      height: el.height - insetY * 2,
      fontSize: el.style.fontSize
    }
  }

  if (el.type === 'connector') {
    const width = 160
    return {
      x: el.x - width / 2,
      y: el.y - el.style.fontSize,
      width,
      height: el.style.fontSize * 2,
      fontSize: el.style.fontSize
    }
  }

  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    fontSize: el.style.fontSize
  }
}

/** Auto-height text boxes grow downward as you type. */
function growAutoHeightElement(el: BoardElement, text: string): void {
  if (el.type !== 'text' || !el.autoHeight) return
  const ctx = getScratchCtx()
  const layout = layoutTextToFit(ctx, text || ' ', el.style, el.width, Number.MAX_SAFE_INTEGER)
  const height = Math.max(el.style.fontSize * LINE_HEIGHT_RATIO, layout.height)
  if (Math.abs(height - el.height) > 0.5) {
    useBoard.getState().patchElement(el.id, { height }, false)
  }
}
