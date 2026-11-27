import type { JSX } from 'react'

export type IconName =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'shapes'
  | 'text'
  | 'pen'
  | 'eraser'
  | 'connector'
  | 'frame'
  | 'image'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'minus'
  | 'minimap'
  | 'layers'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'copy'
  | 'duplicate'
  | 'group'
  | 'ungroup'
  | 'bring-front'
  | 'send-back'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'valign-top'
  | 'valign-middle'
  | 'valign-bottom'
  | 'align-obj-left'
  | 'align-obj-center-x'
  | 'align-obj-right'
  | 'align-obj-top'
  | 'align-obj-center-y'
  | 'align-obj-bottom'
  | 'distribute-x'
  | 'distribute-y'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'chevron-down'
  | 'chevron-right'
  | 'fit'
  | 'save'
  | 'folder'
  | 'export'
  | 'help'
  | 'grid'
  | 'eye'
  | 'eye-off'
  | 'panel'
  | 'arrow-line'
  | 'flip'
  | 'sun'
  | 'moon'

const STROKE: Partial<Record<IconName, JSX.Element>> = {
  select: (
    <path d="M5 3.5 18.5 11 12.4 12.6 9.6 18.6z" />
  ),
  hand: (
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.2-2.3L5.4 14a1.6 1.6 0 0 1 2.6-1.8L9 13.5V7a1.5 1.5 0 0 1 3 0" />
  ),
  sticky: (
    <path d="M4.5 4.5h15v9.5l-5.5 5.5h-9.5zM19.5 14H14v5.5" />
  ),
  shapes: (
    <>
      <rect x="3.5" y="12.5" width="8" height="8" rx="1.2" />
      <circle cx="16.5" cy="16.5" r="4" />
      <path d="M8 3.5 12 10H4z" />
    </>
  ),
  text: <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />,
  pen: (
    <path d="M4 20l1.2-4.2L15.6 5.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8 4 20zM14.5 6.5l3 3" />
  ),
  eraser: (
    <>
      <path d="M8.5 20 4 15.5a1.5 1.5 0 0 1 0-2.1l8-8a1.5 1.5 0 0 1 2.1 0l5.4 5.4a1.5 1.5 0 0 1 0 2.1L14 20z" />
      <path d="M8.5 20H20M9.5 9.5l5.5 5.5" />
    </>
  ),
  connector: (
    <>
      <circle cx="5.5" cy="18.5" r="2.2" />
      <circle cx="18.5" cy="5.5" r="2.2" />
      <path d="M7.4 16.8c2-2 2.4-6 4.6-7.6 1.4-1 3-1.4 4.6-1.6" />
    </>
  ),
  frame: <path d="M7.5 3v18M16.5 3v18M3 7.5h18M3 16.5h18" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l4.8-4.8a1.6 1.6 0 0 1 2.3 0L15 16m0 0 2-2a1.6 1.6 0 0 1 2.3 0l1.2 1.2" />
    </>
  ),
  undo: <path d="M4 9h10.5a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4" />,
  redo: <path d="M20 9H9.5a5 5 0 0 0 0 10H16M20 9l-4-4M20 9l-4 4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  minimap: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.6" />
      <rect x="7" y="8.5" width="7" height="6" rx="1" />
    </>
  ),
  layers: <path d="M12 3.5 21 8l-9 4.5L3 8zM3 12.5l9 4.5 9-4.5M3 17l9 4.5 9-4.5" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  trash: <path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5 7.5 20h9l1-13.5M10 10v6.5M14 10v6.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9" />
    </>
  ),
  duplicate: (
    <>
      <rect x="4.5" y="4.5" width="11" height="11" rx="2" />
      <path d="M8.5 19.5h9a2 2 0 0 0 2-2v-9" />
    </>
  ),
  group: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1" />
      <path d="M3.5 6.5v-3h3M17.5 3.5h3v3M20.5 17.5v3h-3M6.5 20.5h-3v-3" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3.5" y="3.5" width="8" height="8" rx="1" />
      <rect x="12.5" y="12.5" width="8" height="8" rx="1" />
    </>
  ),
  'bring-front': (
    <>
      <rect x="8.5" y="8.5" width="10" height="10" rx="1.6" />
      <path d="M5.5 15.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </>
  ),
  'send-back': (
    <>
      <rect x="3.5" y="3.5" width="10" height="10" rx="1.6" />
      <path d="M18.5 8.5h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-1" />
    </>
  ),
  italic: <path d="M15.5 4.5h-6M14.5 19.5h-6M13.5 4.5 10.5 19.5" />,
  underline: <path d="M6.5 3.5v7a5.5 5.5 0 0 0 11 0v-7M5 20.5h14" />,
  'align-left': <path d="M4 6h16M4 12h10M4 18h13" />,
  'align-center': <path d="M4 6h16M7 12h10M5.5 18h13" />,
  'align-right': <path d="M4 6h16M10 12h10M7 18h13" />,
  'valign-top': <path d="M4 4h16M9 8v12M15 8v7" />,
  'valign-middle': <path d="M4 12h16M9 5v4M9 15v4M15 6.5v5.5M15 12v5.5" />,
  'valign-bottom': <path d="M4 20h16M9 4v12M15 9v7" />,
  'align-obj-left': (
    <>
      <path d="M3.5 3.5v17" />
      <rect x="6.5" y="5.5" width="12" height="4.5" rx="1" />
      <rect x="6.5" y="14" width="7" height="4.5" rx="1" />
    </>
  ),
  'align-obj-center-x': (
    <>
      <path d="M12 3.5v17" />
      <rect x="5" y="5.5" width="14" height="4.5" rx="1" />
      <rect x="8" y="14" width="8" height="4.5" rx="1" />
    </>
  ),
  'align-obj-right': (
    <>
      <path d="M20.5 3.5v17" />
      <rect x="5.5" y="5.5" width="12" height="4.5" rx="1" />
      <rect x="10.5" y="14" width="7" height="4.5" rx="1" />
    </>
  ),
  'align-obj-top': (
    <>
      <path d="M3.5 3.5h17" />
      <rect x="5.5" y="6.5" width="4.5" height="12" rx="1" />
      <rect x="14" y="6.5" width="4.5" height="7" rx="1" />
    </>
  ),
  'align-obj-center-y': (
    <>
      <path d="M3.5 12h17" />
      <rect x="5.5" y="5" width="4.5" height="14" rx="1" />
      <rect x="14" y="8" width="4.5" height="8" rx="1" />
    </>
  ),
  'align-obj-bottom': (
    <>
      <path d="M3.5 20.5h17" />
      <rect x="5.5" y="5.5" width="4.5" height="12" rx="1" />
      <rect x="14" y="10.5" width="4.5" height="7" rx="1" />
    </>
  ),
  'distribute-x': (
    <>
      <path d="M3.5 3.5v17M20.5 3.5v17" />
      <rect x="9.5" y="7" width="5" height="10" rx="1" />
    </>
  ),
  'distribute-y': (
    <>
      <path d="M3.5 3.5h17M3.5 20.5h17" />
      <rect x="7" y="9.5" width="10" height="5" rx="1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />,
  restore: (
    <>
      <rect x="4.5" y="7.5" width="11" height="11" rx="1.5" />
      <path d="M8 5.5h9a2 2 0 0 1 2 2v9" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  fit: <path d="M4 9V5.5a1.5 1.5 0 0 1 1.5-1.5H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  save: (
    <>
      <path d="M5.5 4.5h10L19.5 8.5v11h-14z" />
      <path d="M8.5 4.5v5h7v-5M8.5 19.5v-6h7v6" />
    </>
  ),
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  export: <path d="M12 15V3.5M12 3.5 8 7.5M12 3.5l4 4M4.5 14v4.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V14" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.5" />
      <path d="M12 16.8v.2" />
    </>
  ),
  grid: <path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17M14.5 3.5v17" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.5M6.4 7.6A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.8" />
      <path d="M4 4l16 16" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  'arrow-line': <path d="M4 12h16M20 12l-5-4M20 12l-5 4" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" />,
  flip: <path d="M12 3v18M8.5 7.5 4 12l4.5 4.5zM15.5 7.5 20 12l-4.5 4.5z" />
}

const FILLED: Partial<Record<IconName, JSX.Element>> = {
  bold: (
    <text x="12" y="17" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">
      B
    </text>
  )
}

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.6, className }: IconProps): JSX.Element {
  const filled = FILLED[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {filled ?? STROKE[name] ?? null}
    </svg>
  )
}
