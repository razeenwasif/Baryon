export interface Swatch {
  name: string
  value: string
}

/** Sticky note colours, tuned to stay readable with dark text. */
export const STICKY_COLORS: Swatch[] = [
  { name: 'Yellow', value: '#FFF9B1' },
  { name: 'Canary', value: '#FCE94F' },
  { name: 'Orange', value: '#FFCEA6' },
  { name: 'Salmon', value: '#FFB3B3' },
  { name: 'Pink', value: '#FFCEE0' },
  { name: 'Violet', value: '#D9C7FF' },
  { name: 'Indigo', value: '#C5D0FF' },
  { name: 'Sky', value: '#B3E5FC' },
  { name: 'Teal', value: '#A9EDE4' },
  { name: 'Green', value: '#D3F261' },
  { name: 'Mint', value: '#C9F5D4' },
  { name: 'Grey', value: '#E6E6E6' }
]

export const FILL_COLORS: Swatch[] = [
  { name: 'None', value: 'transparent' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Light grey', value: '#F1F2F4' },
  { name: 'Grey', value: '#C9CDD3' },
  { name: 'Yellow', value: '#FFF9B1' },
  { name: 'Orange', value: '#FFCEA6' },
  { name: 'Red', value: '#FFB3B3' },
  { name: 'Pink', value: '#FFCEE0' },
  { name: 'Violet', value: '#D9C7FF' },
  { name: 'Blue', value: '#C5D0FF' },
  { name: 'Sky', value: '#B3E5FC' },
  { name: 'Green', value: '#D3F261' }
]

export const STROKE_COLORS: Swatch[] = [
  { name: 'None', value: 'transparent' },
  { name: 'Auto (follows theme)', value: 'auto' },
  { name: 'Black', value: '#1A1A1A' },
  { name: 'Grey', value: '#6B7280' },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Red', value: '#E03131' },
  { name: 'Orange', value: '#F76707' },
  { name: 'Yellow', value: '#F1C40F' },
  { name: 'Green', value: '#2F9E44' },
  { name: 'Teal', value: '#0CA678' },
  { name: 'Blue', value: '#4262FF' },
  { name: 'Indigo', value: '#4C6EF5' },
  { name: 'Violet', value: '#7048E8' }
]

export const TEXT_COLORS: Swatch[] = STROKE_COLORS.filter((c) => c.value !== 'transparent')

/** Rendered as a two-tone chip, since its real colour depends on the theme. */
export const AUTO_SWATCH_BACKGROUND =
  'linear-gradient(135deg, #1A1A1A 0 50%, #E9EBEF 50% 100%)'

export const FONT_STACKS: Record<string, string> = {
  sans: '"Segoe UI", "Inter", system-ui, -apple-system, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Mono", "Consolas", "SF Mono", monospace',
  handwritten: '"Segoe Script", "Comic Sans MS", "Bradley Hand", cursive'
}

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 96, 144]

/** Picks black or white text for legibility on an arbitrary background. */
export function contrastText(background: string): string {
  const rgb = parseColor(background)
  if (!rgb) return '#1A1A1A'
  const [r, g, b] = rgb
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1A1A1A' : '#FFFFFF'
}

export function parseColor(color: string): [number, number, number] | null {
  if (!color || color === 'transparent') return null
  const hex = color.trim()
  if (hex.startsWith('#')) {
    const body = hex.slice(1)
    if (body.length === 3) {
      return [
        parseInt(body[0] + body[0], 16),
        parseInt(body[1] + body[1], 16),
        parseInt(body[2] + body[2], 16)
      ]
    }
    if (body.length >= 6) {
      return [
        parseInt(body.slice(0, 2), 16),
        parseInt(body.slice(2, 4), 16),
        parseInt(body.slice(4, 6), 16)
      ]
    }
  }
  const match = hex.match(/rgba?\(([^)]+)\)/)
  if (match) {
    const parts = match[1].split(',').map((p) => parseFloat(p))
    return [parts[0], parts[1], parts[2]]
  }
  return null
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color)
  if (!rgb) return 'transparent'
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function shade(color: string, amount: number): string {
  const rgb = parseColor(color)
  if (!rgb) return color
  const adjust = (c: number): number =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
  return `rgb(${adjust(rgb[0])}, ${adjust(rgb[1])}, ${adjust(rgb[2])})`
}
