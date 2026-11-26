import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { zoomToFit } from '../hooks/useShortcuts'
import { boardBridge } from '../services/bridge'
import { normalizeDocument } from '../shared/document'
import { useBoard } from '../state/store'

interface BoardAssistantMessage {
  role: 'user' | 'assistant'
  content: string
  summary?: string
  opsApplied?: number
  model?: string
}

interface BoardAssistantProps {
  activeId: string | null
  onToast: (message: string, kind?: 'info' | 'error') => void
}

const QUICK_PROMPTS = [
  'Map system architecture',
  'Add brainstorming stickies',
  'Connect & organize items',
  'Summarize this board'
]

export function BoardAssistant({ activeId, onToast }: BoardAssistantProps): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<BoardAssistantMessage[]>([])
  const selectionCount = useBoard((s) => s.selection.length)
  const canUndo = useBoard((s) => s.history.length > 0)
  const undo = useBoard((s) => s.undo)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMessages([])
    setOpen(false)
    setPrompt('')
  }, [activeId])

  useEffect(() => {
    if (open && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [open, messages.length, busy])

  const submitPrompt = async (text: string): Promise<void> => {
    const clean = text.trim()
    if (!clean || busy) return
    setPrompt('')
    setOpen(true)

    const userMsg: BoardAssistantMessage = { role: 'user', content: clean }
    const historySnapshot = [...messages, userMsg]
    setMessages(historySnapshot)
    setBusy(true)

    try {
      const state = useBoard.getState()
      const wasEmpty = Object.keys(state.doc.elements).length === 0
      const res = await boardBridge.ask({
        boardId: activeId,
        prompt: clean,
        doc: state.doc,
        selectedIds: state.selection,
        history: messages.map((m) => ({ role: m.role, content: m.content }))
      })

      if (res.changed && res.document) {
        const current = useBoard.getState()
        current.pushHistory(res.summary || 'Fairy edit')
        const normalized = normalizeDocument(res.document)
        useBoard.setState((prev) => ({
          doc: {
            ...prev.doc,
            name: normalized.name || prev.doc.name,
            elements: normalized.elements,
            background: normalized.background || prev.doc.background
          },
          selection: [],
          editingId: null,
          dirty: true
        }))
        if (wasEmpty) {
          zoomToFit()
        }
        onToast(res.summary || `Updated board (${res.opsApplied} changes)`)
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.reply || (res.changed ? 'Board updated.' : 'Done.'),
          summary: res.changed ? res.summary : undefined,
          opsApplied: res.changed ? res.opsApplied : 0,
          model: res.model
        }
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fairy could not complete that board task.'
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${msg}` }
      ])
      onToast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    void submitPrompt(prompt)
  }

  return (
    <div
      className={`board-assistant${open ? ' is-open' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {open && (
        <div className="board-assistant__drawer" role="dialog" aria-label="Fairy board assistant">
          <div className="board-assistant__head">
            <span className="board-assistant__badge">
              <SparkleGlyph /> Fairy Board Assistant
            </span>
            <div className="board-assistant__head-actions">
              {canUndo && (
                <button
                  type="button"
                  className="board-assistant__mini-btn"
                  title="Undo last board edit"
                  onClick={undo}
                >
                  Undo
                </button>
              )}
              {messages.length > 0 && (
                <button
                  type="button"
                  className="board-assistant__mini-btn"
                  onClick={() => setMessages([])}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="board-assistant__mini-btn"
                aria-label="Minimize Fairy assistant"
                onClick={() => setOpen(false)}
              >
                Hide
              </button>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="board-assistant__empty">
              <p className="board-assistant__hint">
                Ask Fairy to brainstorm sticky notes, diagram architecture, connect flows, or reorganize this board.
              </p>
              <div className="board-assistant__chips">
                {QUICK_PROMPTS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="board-assistant__chip"
                    onClick={() => void submitPrompt(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={threadRef} className="board-assistant__thread">
              {messages.map((msg, idx) => (
                <div key={idx} className={`board-assistant__msg is-${msg.role}`}>
                  <div className="board-assistant__msg-role">
                    <span>{msg.role === 'user' ? 'You' : `Fairy${msg.model ? ` · ${msg.model}` : ''}`}</span>
                    {msg.summary && (
                      <span className="board-assistant__applied">{msg.summary}</span>
                    )}
                  </div>
                  <div className="board-assistant__msg-body">{msg.content}</div>
                </div>
              ))}
              {busy && (
                <div className="board-assistant__msg is-assistant">
                  <div className="board-assistant__msg-body is-busy">Thinking & updating board…</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <form className="board-assistant__bar" onSubmit={onSubmit}>
        <button
          type="button"
          className={`board-assistant__spark${open ? ' is-active' : ''}`}
          title={open ? 'Hide board chat' : 'Show Fairy board assistant'}
          aria-label={open ? 'Hide board chat' : 'Open Fairy board assistant'}
          aria-expanded={open}
          onClick={() => {
            setOpen((prev) => !prev)
            window.setTimeout(() => inputRef.current?.focus(), 0)
          }}
        >
          <SparkleGlyph />
        </button>

        {selectionCount > 0 && (
          <span className="board-assistant__sel" title="Selected elements are passed as context to Fairy">
            {selectionCount} selected
          </span>
        )}

        <input
          ref={inputRef}
          type="text"
          className="board-assistant__input"
          value={prompt}
          maxLength={2000}
          placeholder="Ask Fairy to build, edit, or organize this board…"
          aria-label="Ask Fairy to work on this board"
          onFocus={() => {
            if (messages.length > 0) setOpen(true)
          }}
          onChange={(e) => setPrompt(e.target.value)}
        />

        {messages.length > 0 && !open && (
          <button
            type="button"
            className="board-assistant__mini-btn"
            onClick={() => setOpen(true)}
          >
            Chat ({messages.length})
          </button>
        )}

        <button
          type="submit"
          className="board-assistant__send"
          disabled={busy || !prompt.trim()}
          aria-label="Send board instruction"
          title="Ask Fairy"
        >
          {busy ? '…' : '↑'}
        </button>
      </form>
    </div>
  )
}

function SparkleGlyph(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  )
}
