import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * A board is someone's work in progress; a render fault must not leave them
 * staring at a blank window with no way to rescue it. The fallback keeps the
 * document in memory and offers to save it.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Board render failed:', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  private saveCopy = async (): Promise<void> => {
    const { useBoard } = await import('../state/store')
    const { boardBridge } = await import('../services/bridge')
    const s = useBoard.getState()
    const doc = { ...s.doc, camera: s.camera }
    await boardBridge.exportFile({
      data: JSON.stringify(doc, null, 2),
      encoding: 'utf8',
      extension: 'json',
      defaultName: doc.name || 'board-recovery'
    })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="dialog-backdrop">
        <div className="dialog" style={{ width: 'min(520px, 90vw)' }}>
          <div className="dialog__head">
            <span className="dialog__title">Something went wrong</span>
          </div>
          <div className="dialog__body">
            <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
              The editor hit an unexpected error. Your board is still in memory — save a
              copy before continuing.
            </p>
            <pre
              style={{
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 10,
                fontSize: 11.5,
                overflowX: 'auto',
                margin: '0 0 16px'
              }}
            >
              {error.message}
            </pre>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => void this.saveCopy()}>
                Save a copy…
              </button>
              <button className="btn btn--primary" onClick={this.reset}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
