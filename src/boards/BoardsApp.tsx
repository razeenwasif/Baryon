import './styles/global.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { BoardAssistant } from './components/BoardAssistant'
import { BoardCanvas } from './components/BoardCanvas'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Icon } from './components/Icon'
import { LayersPanel } from './components/LayersPanel'
import { Minimap } from './components/Minimap'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { StylePanel } from './components/StylePanel'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { ZoomControls } from './components/ZoomControls'
import type { BoardController } from './canvas/interaction'
import { shortcut } from './core/platform'
import { applyTheme } from './core/theme'
import { useShortcuts } from './hooks/useShortcuts'
import { boardBridge, type BoardMeta } from './services/bridge'
import {
  createNewBoard,
  currentDocument,
  exportBoard,
  importBoardFile,
  importImages,
  openBoardById,
  saveBoard,
  type Toast
} from './services/fileService'
import { useBoard } from './state/store'

interface ToastItem {
  id: number
  message: string
  kind: 'info' | 'error'
}

export interface BoardsAppProps {
  active: boolean
  requestedBoardId?: string | null
  requestNonce?: number
  onOpenPlanDoc?: (docId: string) => void
}

function BoardsWorkspace({
  active,
  requestedBoardId = null,
  requestNonce = 0,
  onOpenPlanDoc
}: BoardsAppProps): JSX.Element {
  const [controller, setController] = useState<BoardController | null>(null)
  const [boards, setBoards] = useState<BoardMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const appRef = useRef<HTMLDivElement>(null)
  const dirty = useBoard((s) => s.dirty)
  const docSnapshot = useBoard((s) => s.doc)
  const initializedRef = useRef(false)

  useShortcuts(controller, active)

  const toast: Toast = useCallback((message, kind = 'info') => {
    const id = ++toastIdRef.current
    setToasts((list) => [...list, { id, message, kind }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id))
    }, 2800)
  }, [])

  // Apply initial theme to #boards-view once mounted and load initial board list.
  useEffect(() => {
    applyTheme(useBoard.getState().theme)
    let cancelled = false

    const init = async (): Promise<void> => {
      try {
        const list = await boardBridge.list()
        if (cancelled) return
        setBoards(list)
        const targetId = requestedBoardId || list[0]?.id
        if (targetId) {
          const meta = await openBoardById(targetId, toast)
          if (!cancelled && meta) {
            setActiveId(meta.id)
            initializedRef.current = true
            return
          }
        }
        const created = await boardBridge.create({
          name: 'Untitled board',
          doc: currentDocument()
        })
        if (!cancelled) {
          useBoard.getState().loadDocument(created.document, created.meta.id)
          useBoard.setState({ filePath: created.meta.id, dirty: false })
          setBoards((prev) => [created.meta, ...prev.filter((b) => b.id !== created.meta.id)])
          setActiveId(created.meta.id)
          initializedRef.current = true
        }
      } catch (err) {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Could not load boards.', 'error')
      }
    }

    void init()
    const offChanged = boardBridge.onChanged((next) => {
      setBoards(next)
    })

    return () => {
      cancelled = true
      offChanged()
    }
  }, [])

  // Handle imperative navigation to a specific board from chat/work /plan cards.
  useEffect(() => {
    if (!initializedRef.current || !requestedBoardId) return
    void openBoardById(requestedBoardId, toast, activeId ?? undefined).then((meta) => {
      if (meta) setActiveId(meta.id)
    })
  }, [requestedBoardId, requestNonce])

  // Debounced auto-save to <dataDir>/boards/<id>.json while editing.
  useEffect(() => {
    if (!dirty || !activeId) return
    const timer = window.setTimeout(() => {
      setSaving(true)
      void boardBridge
        .save(activeId, currentDocument())
        .then(() => {
          useBoard.setState({ dirty: false })
        })
        .catch(() => {})
        .finally(() => {
          setSaving(false)
        })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [dirty, activeId, docSnapshot])

  // Active-only Ctrl/Cmd shortcuts for Save, Export PNG, Layers toggle.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        if (activeId) {
          setSaving(true)
          void saveBoard(toast, activeId).finally(() => setSaving(false))
        }
      } else if (event.shiftKey && key === 'e') {
        event.preventDefault()
        void exportBoard('png', toast)
      } else if (event.shiftKey && key === 'l') {
        event.preventDefault()
        useBoard.getState().toggleUi('showLayers')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, activeId, toast])

  // Keep file drops inside the canvas area instead of navigating.
  useEffect(() => {
    const node = appRef.current
    if (!node) return
    const stop = (event: Event): void => event.preventDefault()
    node.addEventListener('dragover', stop)
    node.addEventListener('drop', stop)
    return () => {
      node.removeEventListener('dragover', stop)
      node.removeEventListener('drop', stop)
    }
  }, [])

  const handleSelectBoard = useCallback(
    async (id: string) => {
      if (id === activeId) return
      const meta = await openBoardById(id, toast, activeId ?? undefined)
      if (meta) setActiveId(meta.id)
    },
    [activeId, toast]
  )

  const handleNewBoard = useCallback(async () => {
    const meta = await createNewBoard(toast, 'Untitled board', activeId ?? undefined)
    if (meta) setActiveId(meta.id)
  }, [activeId, toast])

  const handleImportFile = useCallback(async () => {
    const meta = await importBoardFile(toast, activeId ?? undefined)
    if (meta) setActiveId(meta.id)
  }, [activeId, toast])

  const handleDeleteBoard = useCallback(
    async (id: string) => {
      await boardBridge.remove(id)
      const nextList = await boardBridge.list()
      setBoards(nextList)
      if (activeId === id && nextList[0]) {
        const meta = await openBoardById(nextList[0].id, toast)
        if (meta) setActiveId(meta.id)
      }
    },
    [activeId, toast]
  )

  const activeMeta = boards.find((b) => b.id === activeId) ?? null

  return (
    <div ref={appRef} className="boards-app">
      <TitleBar
        boards={boards}
        activeId={activeId}
        activeMeta={activeMeta}
        saving={saving}
        onSelectBoard={(id) => void handleSelectBoard(id)}
        onNew={() => void handleNewBoard()}
        onImportFile={() => void handleImportFile()}
        onDeleteBoard={(id) => void handleDeleteBoard(id)}
        onSave={() => {
          if (activeId) {
            setSaving(true)
            void saveBoard(toast, activeId).finally(() => setSaving(false))
          }
        }}
        onExport={(kind) => void exportBoard(kind, toast)}
        onOpenPlanDoc={onOpenPlanDoc}
      />

      <div className="workspace">
        <BoardCanvas onController={setController} onToast={toast} />

        <Toolbar onAddImage={() => void importImages(toast)} />
        <StylePanel />
        <LayersPanel />
        <HistoryControls />
        <BoardAssistant activeId={activeId} onToast={toast} />

        <div className="bottom-bar">
          <Minimap />
          <ZoomControls />
        </div>
      </div>

      <ShortcutsDialog />

      <div className="toast-stack">
        {toasts.map((item) => (
          <div key={item.id} className={`toast${item.kind === 'error' ? ' toast--error' : ''}`}>
            {item.message}
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardsApp(props: BoardsAppProps): JSX.Element {
  return (
    <ErrorBoundary>
      <BoardsWorkspace {...props} />
    </ErrorBoundary>
  )
}

function HistoryControls(): JSX.Element {
  const historyLength = useBoard((s) => s.history.length)
  const futureLength = useBoard((s) => s.future.length)
  const undo = useBoard((s) => s.undo)
  const redo = useBoard((s) => s.redo)

  return (
    <div className="history-controls">
      <button
        className="icon-btn"
        disabled={historyLength === 0}
        title={shortcut('Undo — Ctrl+Z')}
        aria-label="Undo"
        onClick={undo}
      >
        <Icon name="undo" size={17} />
      </button>
      <button
        className="icon-btn"
        disabled={futureLength === 0}
        title={shortcut('Redo — Ctrl+Shift+Z')}
        aria-label="Redo"
        onClick={redo}
      >
        <Icon name="redo" size={17} />
      </button>
    </div>
  )
}
