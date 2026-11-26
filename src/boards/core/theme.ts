/**
 * Canvas theming.
 *
 * The board *chrome* (background, grid, selection furniture, frame labels)
 * follows the app theme. Element colours are the user's content and are never
 * rewritten — a white sticky stays white in dark mode, exactly as it would in
 * any design tool.
 */
export type ThemeMode = 'light' | 'dark'

export interface CanvasTheme {
  background: string
  grid: string
  gridAlpha: number
  frameBorder: string
  frameLabel: string
  handleFill: string
  placeholderFill: string
  placeholderText: string
  minimapBackground: string
  minimapFrame: string
  minimapConnector: string
}

export const LIGHT_CANVAS: CanvasTheme = {
  background: '#F2F3F5',
  grid: '#D3D6DB',
  gridAlpha: 0.7,
  frameBorder: '#C4C8CE',
  frameLabel: '#5F6672',
  handleFill: '#FFFFFF',
  placeholderFill: '#E4E6EA',
  placeholderText: '#9AA1AC',
  minimapBackground: '#F7F8FA',
  minimapFrame: 'rgba(120, 128, 140, 0.65)',
  minimapConnector: 'rgba(90, 98, 112, 0.5)'
}

export const DARK_CANVAS: CanvasTheme = {
  background: '#08080a',
  grid: '#232630',
  gridAlpha: 0.72,
  frameBorder: '#272a36',
  frameLabel: '#8d93a6',
  handleFill: '#121319',
  placeholderFill: '#151720',
  placeholderText: '#6f7588',
  minimapBackground: '#0d0e13',
  minimapFrame: 'rgba(130, 140, 175, 0.35)',
  minimapConnector: 'rgba(140, 150, 185, 0.4)'
}

/**
 * The sentinel colour meaning "whatever ink reads on the current board".
 *
 * Storing it instead of a literal keeps boards portable: text drawn in dark
 * mode is still legible when the same file is opened in light mode. A colour
 * the user explicitly picks is stored literally and never re-interpreted.
 */
export { AUTO_INK } from '../shared/document'

export const INK: Record<ThemeMode, string> = {
  light: '#1A1A1A',
  dark: '#E9EBEF'
}

export function resolveInk(color: string): string {
  return color === 'auto' ? INK[currentMode] : color
}

let current: CanvasTheme = DARK_CANVAS
let currentMode: ThemeMode = 'dark'

export function canvasTheme(): CanvasTheme {
  return current
}

export function themeMode(): ThemeMode {
  return currentMode
}

/** Applies a theme to both the canvas palette and the CSS custom properties. */
export function applyTheme(mode: ThemeMode): void {
  currentMode = mode
  current = mode === 'dark' ? DARK_CANVAS : LIGHT_CANVAS
  const container = typeof document !== 'undefined' ? document.getElementById('boards-view') : null
  if (container) container.setAttribute('data-theme', mode)
}

const STORAGE_KEY = 'miroclone.theme'

export function loadThemePreference(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private mode or a locked-down profile: fall through to the default.
  }
  return 'dark'
}

export function saveThemePreference(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Persisting the preference is a nicety, never a hard requirement.
  }
}
