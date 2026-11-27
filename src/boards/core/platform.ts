export const isMac = typeof navigator !== 'undefined' ? /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) : true;

/** Keep visible shortcut hints aligned with Electron's CmdOrCtrl accelerators. */
export function shortcut(label: string): string {
  if (!isMac) return label
  return label.replace(/Ctrl/g, '⌘').replace(/Shift/g, '⇧').replace(/Alt/g, '⌥')
}

export const minimapShortcut = isMac ? '⌘+⇧+M' : 'Ctrl+M'
