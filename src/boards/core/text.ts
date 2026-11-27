import type { ElementStyle } from '../shared/document'
import { FONT_STACKS } from './palette'

export const LINE_HEIGHT_RATIO = 1.32

export function fontString(style: ElementStyle, fontSize = style.fontSize): string {
  const weight = style.bold ? '700' : '400'
  const italic = style.italic ? 'italic ' : ''
  return `${italic}${weight} ${fontSize}px ${FONT_STACKS[style.fontFamily] ?? FONT_STACKS.sans}`
}

export function cssFontFamily(family: ElementStyle['fontFamily']): string {
  return FONT_STACKS[family] ?? FONT_STACKS.sans
}

/**
 * Greedy word wrap that also breaks words longer than the line, matching how
 * the DOM textarea overlay wraps so editing never shifts the text.
 */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = []
  const paragraphs = text.split('\n')

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w !== '')
    let current = ''

    for (const word of words) {
      const candidate = current + word
      if (measure(candidate) <= maxWidth || current === '') {
        // A single word that overflows an empty line must be hard-broken.
        if (current === '' && measure(word) > maxWidth && word.trim() !== '') {
          let chunk = ''
          for (const char of word) {
            if (measure(chunk + char) > maxWidth && chunk !== '') {
              lines.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          current = chunk
          continue
        }
        current = candidate
      } else {
        lines.push(current.trimEnd())
        current = word.trimStart()
      }
    }
    lines.push(current.trimEnd())
  }

  return lines
}

export interface TextLayout {
  lines: string[]
  fontSize: number
  lineHeight: number
  height: number
}

export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: ElementStyle,
  maxWidth: number,
  fontSize = style.fontSize
): TextLayout {
  ctx.font = fontString(style, fontSize)
  const measure = (t: string): number => ctx.measureText(t).width
  const lines = wrapText(measure, text, Math.max(1, maxWidth))
  const lineHeight = fontSize * LINE_HEIGHT_RATIO
  return { lines, fontSize, lineHeight, height: lines.length * lineHeight }
}

/**
 * Shrinks the font until the wrapped text fits the box. Sticky notes use this
 * so a note never spills over its edges.
 */
export function layoutTextToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: ElementStyle,
  maxWidth: number,
  maxHeight: number,
  minFontSize = 8
): TextLayout {
  let size = style.fontSize
  let layout = layoutText(ctx, text, style, maxWidth, size)
  while (layout.height > maxHeight && size > minFontSize) {
    size = Math.max(minFontSize, size - Math.max(1, Math.round(size * 0.08)))
    layout = layoutText(ctx, text, style, maxWidth, size)
  }
  return layout
}

export function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: ElementStyle
): number {
  ctx.font = fontString(style)
  let widest = 0
  for (const line of text.split('\n')) {
    widest = Math.max(widest, ctx.measureText(line).width)
  }
  return widest
}

export function verticalOffset(
  align: ElementStyle['verticalAlign'],
  contentHeight: number,
  boxHeight: number
): number {
  if (align === 'top') return 0
  if (align === 'bottom') return boxHeight - contentHeight
  return (boxHeight - contentHeight) / 2
}

export function horizontalAnchor(
  align: ElementStyle['textAlign'],
  boxWidth: number
): { x: number; textAlign: CanvasTextAlign } {
  if (align === 'left') return { x: 0, textAlign: 'left' }
  if (align === 'right') return { x: boxWidth, textAlign: 'right' }
  return { x: boxWidth / 2, textAlign: 'center' }
}
