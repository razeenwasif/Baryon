import { shortcut } from '../core/platform'
import type { JSX } from 'react'
import type { ArrowHead, ConnectorElement, ElementStyle } from '../shared/document'
import {
  AUTO_SWATCH_BACKGROUND,
  FILL_COLORS,
  FONT_SIZES,
  STICKY_COLORS,
  STROKE_COLORS,
  TEXT_COLORS
} from '../core/palette'
import { useBoard } from '../state/store'
import { Icon, type IconName } from './Icon'

export function StylePanel(): JSX.Element | null {
  const selection = useBoard((s) => s.selection)
  const elements = useBoard((s) => s.doc.elements)
  const tool = useBoard((s) => s.tool)
  const defaultStyle = useBoard((s) => s.defaultStyle)
  const updateStyle = useBoard((s) => s.updateStyle)
  const patchElements = useBoard((s) => s.patchElements)

  const selected = selection.map((id) => elements[id]).filter(Boolean)
  const creating = tool === 'sticky' || tool === 'shape' || tool === 'text' || tool === 'draw'

  if (selected.length === 0 && !creating) return null

  // With nothing selected the panel edits the defaults used for the next element.
  const style: ElementStyle = selected[0]?.style ?? defaultStyle
  const types = new Set(selected.map((el) => el.type))
  const showFill =
    selected.length === 0
      ? tool === 'shape' || tool === 'sticky'
      : types.has('shape') || types.has('sticky') || types.has('text') || types.has('frame')
  const showStroke =
    selected.length === 0
      ? tool !== 'sticky'
      : types.has('shape') || types.has('draw') || types.has('connector') || types.has('image')
  const showText =
    selected.length === 0
      ? tool !== 'draw'
      : types.has('shape') || types.has('sticky') || types.has('text') || types.has('connector')
  const connectors = selected.filter((el) => el.type === 'connector')
  const fillSwatches = types.has('sticky') || tool === 'sticky' ? STICKY_COLORS : FILL_COLORS

  const opacity = selected.length > 0 ? selected[0].opacity : 1

  return (
    <div className="style-panel">
      {showFill && (
        <section className="panel-section">
          <span className="panel-label">Fill</span>
          <div className="color-grid">
            {fillSwatches.map((swatch) => (
              <button
                key={swatch.value}
                className={[
                  'swatch',
                  swatch.value === 'transparent' ? 'swatch--none' : '',
                  style.fill === swatch.value ? 'swatch--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={swatchStyle(swatch.value)}
                title={swatch.name}
                aria-label={`Fill ${swatch.name}`}
                onClick={() => updateStyle({ fill: swatch.value })}
              />
            ))}
          </div>
        </section>
      )}

      {showStroke && (
        <section className="panel-section">
          <span className="panel-label">Border</span>
          <div className="color-grid">
            {STROKE_COLORS.map((swatch) => (
              <button
                key={swatch.value}
                className={[
                  'swatch',
                  swatch.value === 'transparent' ? 'swatch--none' : '',
                  style.stroke === swatch.value ? 'swatch--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={swatchStyle(swatch.value)}
                title={swatch.name}
                aria-label={`Border ${swatch.name}`}
                onClick={() => updateStyle({ stroke: swatch.value })}
              />
            ))}
          </div>
          <div className="panel-row" style={{ marginTop: 10 }}>
            <input
              className="slider"
              type="range"
              min={0}
              max={24}
              step={1}
              value={style.strokeWidth}
              aria-label="Border width"
              onChange={(e) => updateStyle({ strokeWidth: Number(e.target.value) }, false)}
              onPointerUp={() => useBoard.getState().pushHistory('border width')}
            />
            <span className="value-badge">{style.strokeWidth}px</span>
          </div>
          <div className="panel-row">
            <div className="seg">
              {(['solid', 'dashed', 'dotted'] as const).map((kind) => (
                <button
                  key={kind}
                  className={`seg__btn${style.strokeStyle === kind ? ' seg__btn--active' : ''}`}
                  onClick={() => updateStyle({ strokeStyle: kind })}
                  title={kind}
                >
                  <DashPreview kind={kind} />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {connectors.length > 0 && (
        <section className="panel-section">
          <span className="panel-label">Connector</span>
          <div className="panel-row">
            <div className="seg">
              {(['straight', 'elbow', 'curved'] as const).map((shape) => (
                <button
                  key={shape}
                  className={`seg__btn${
                    connectors[0].type === 'connector' && connectors[0].shape === shape
                      ? ' seg__btn--active'
                      : ''
                  }`}
                  title={shape}
                  onClick={() =>
                    patchElements(
                      connectors.map((c) => c.id),
                      { shape } as Partial<ConnectorElement>
                    )
                  }
                >
                  {shape[0].toUpperCase() + shape.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-row">
            <ArrowSelect
              label="Start"
              value={connectors[0].type === 'connector' ? connectors[0].startArrow : 'none'}
              onChange={(startArrow) =>
                patchElements(
                  connectors.map((c) => c.id),
                  { startArrow } as Partial<ConnectorElement>
                )
              }
            />
            <ArrowSelect
              label="End"
              value={connectors[0].type === 'connector' ? connectors[0].endArrow : 'arrow'}
              onChange={(endArrow) =>
                patchElements(
                  connectors.map((c) => c.id),
                  { endArrow } as Partial<ConnectorElement>
                )
              }
            />
          </div>
        </section>
      )}

      {showText && (
        <section className="panel-section">
          <span className="panel-label">Text</span>
          <div className="panel-row">
            <select
              className="field"
              value={style.fontFamily}
              aria-label="Font"
              onChange={(e) =>
                updateStyle({ fontFamily: e.target.value as ElementStyle['fontFamily'] })
              }
            >
              <option value="sans">Sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Mono</option>
              <option value="handwritten">Handwritten</option>
            </select>
            <select
              className="field"
              style={{ width: 76 }}
              value={style.fontSize}
              aria-label="Font size"
              onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
            >
              {/* Include the current size so a value off the preset ladder
                  (e.g. one produced by shrink-to-fit) still displays. */}
              {[...new Set([...FONT_SIZES, style.fontSize])]
                .sort((a, b) => a - b)
                .map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
            </select>
          </div>

          <div className="panel-row">
            <div className="icon-row">
              <ToggleButton
                active={style.bold}
                label="Bold"
                onClick={() => updateStyle({ bold: !style.bold })}
              >
                <strong style={{ fontSize: 13 }}>B</strong>
              </ToggleButton>
              <ToggleButton
                active={style.italic}
                label="Italic"
                onClick={() => updateStyle({ italic: !style.italic })}
              >
                <Icon name="italic" size={16} />
              </ToggleButton>
              <ToggleButton
                active={style.underline}
                label="Underline"
                onClick={() => updateStyle({ underline: !style.underline })}
              >
                <Icon name="underline" size={16} />
              </ToggleButton>
              <span style={{ width: 6 }} />
              {(
                [
                  ['left', 'align-left'],
                  ['center', 'align-center'],
                  ['right', 'align-right']
                ] as const
              ).map(([align, icon]) => (
                <ToggleButton
                  key={align}
                  active={style.textAlign === align}
                  label={`Align ${align}`}
                  onClick={() => updateStyle({ textAlign: align })}
                >
                  <Icon name={icon as IconName} size={16} />
                </ToggleButton>
              ))}
            </div>
          </div>

          <div className="panel-row">
            <div className="icon-row">
              {(
                [
                  ['top', 'valign-top'],
                  ['middle', 'valign-middle'],
                  ['bottom', 'valign-bottom']
                ] as const
              ).map(([align, icon]) => (
                <ToggleButton
                  key={align}
                  active={style.verticalAlign === align}
                  label={`Vertical align ${align}`}
                  onClick={() => updateStyle({ verticalAlign: align })}
                >
                  <Icon name={icon as IconName} size={16} />
                </ToggleButton>
              ))}
            </div>
          </div>

          <div className="color-grid" style={{ marginTop: 10 }}>
            {TEXT_COLORS.map((swatch) => (
              <button
                key={swatch.value}
                className={`swatch${style.textColor === swatch.value ? ' swatch--active' : ''}`}
                style={swatchStyle(swatch.value)}
                title={`Text ${swatch.name}`}
                aria-label={`Text ${swatch.name}`}
                onClick={() => updateStyle({ textColor: swatch.value })}
              />
            ))}
          </div>
        </section>
      )}

      {selected.length > 0 && (
        <section className="panel-section">
          <span className="panel-label">Opacity</span>
          <div className="panel-row">
            <input
              className="slider"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              aria-label="Opacity"
              onChange={(e) =>
                patchElements(selection, { opacity: Number(e.target.value) }, false)
              }
              onPointerUp={() => useBoard.getState().pushHistory('opacity')}
            />
            <span className="value-badge">{Math.round(opacity * 100)}%</span>
          </div>
        </section>
      )}

      {selected.length > 0 && <ArrangeSection />}
    </div>
  )
}

function ArrangeSection(): JSX.Element {
  // Actions are stable, so only the selection size needs to drive re-renders.
  const count = useBoard((state) => state.selection.length)
  const s = useBoard.getState()
  const multi = count > 1

  return (
    <section className="panel-section">
      <span className="panel-label">Arrange</span>
      <div className="icon-row">
        {(
          [
            ['left', 'align-obj-left'],
            ['centerX', 'align-obj-center-x'],
            ['right', 'align-obj-right'],
            ['top', 'align-obj-top'],
            ['centerY', 'align-obj-center-y'],
            ['bottom', 'align-obj-bottom']
          ] as const
        ).map(([edge, icon]) => (
          <button
            key={edge}
            className="icon-btn"
            disabled={!multi}
            title={`Align ${edge}`}
            aria-label={`Align ${edge}`}
            onClick={() => s.alignSelection(edge)}
          >
            <Icon name={icon as IconName} size={17} />
          </button>
        ))}
        <button
          className="icon-btn"
          disabled={count < 3}
          title="Distribute horizontally"
          aria-label="Distribute horizontally"
          onClick={() => s.distributeSelection('x')}
        >
          <Icon name="distribute-x" size={17} />
        </button>
        <button
          className="icon-btn"
          disabled={count < 3}
          title="Distribute vertically"
          aria-label="Distribute vertically"
          onClick={() => s.distributeSelection('y')}
        >
          <Icon name="distribute-y" size={17} />
        </button>
      </div>

      <div className="icon-row" style={{ marginTop: 8 }}>
        <button
          className="icon-btn"
          title={shortcut('Bring to front — Ctrl+]')}
          aria-label="Bring to front"
          onClick={() => s.bringToFront()}
        >
          <Icon name="bring-front" size={17} />
        </button>
        <button
          className="icon-btn"
          title={shortcut('Send to back — Ctrl+[')}
          aria-label="Send to back"
          onClick={() => s.sendToBack()}
        >
          <Icon name="send-back" size={17} />
        </button>
        <button
          className="icon-btn"
          disabled={!multi}
          title={shortcut('Group — Ctrl+G')}
          aria-label="Group"
          onClick={() => s.group()}
        >
          <Icon name="group" size={17} />
        </button>
        <button
          className="icon-btn"
          title={shortcut('Ungroup — Ctrl+Shift+G')}
          aria-label="Ungroup"
          onClick={() => s.ungroup()}
        >
          <Icon name="ungroup" size={17} />
        </button>
        <button
          className="icon-btn"
          title={shortcut('Lock — Ctrl+L')}
          aria-label="Lock"
          onClick={() => s.lockSelection(true)}
        >
          <Icon name="lock" size={17} />
        </button>
        <button
          className="icon-btn"
          title="Delete — Del"
          aria-label="Delete"
          onClick={() => s.deleteSelection()}
        >
          <Icon name="trash" size={17} />
        </button>
      </div>
    </section>
  )
}

function ToggleButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      className={`icon-btn${active ? ' icon-btn--active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 'auto' has no single colour, so it gets a split light/dark chip. */
function swatchStyle(value: string): React.CSSProperties | undefined {
  if (value === 'transparent') return undefined
  if (value === 'auto') return { background: AUTO_SWATCH_BACKGROUND }
  return { background: value }
}

function DashPreview({ kind }: { kind: 'solid' | 'dashed' | 'dotted' }): JSX.Element {
  const dash = kind === 'dashed' ? '6 4' : kind === 'dotted' ? '1 4' : undefined
  return (
    <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
      <line
        x1="2"
        y1="5"
        x2="28"
        y2="5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dash}
      />
    </svg>
  )
}

function ArrowSelect({
  label,
  value,
  onChange
}: {
  label: string
  value: ArrowHead
  onChange: (value: ArrowHead) => void
}): JSX.Element {
  return (
    <label style={{ flex: 1 }}>
      <select
        className="field"
        value={value}
        aria-label={`${label} arrow`}
        onChange={(e) => onChange(e.target.value as ArrowHead)}
      >
        <option value="none">{label}: none</option>
        <option value="arrow">{label}: arrow</option>
        <option value="triangle">{label}: triangle</option>
        <option value="circle">{label}: circle</option>
        <option value="diamond">{label}: diamond</option>
      </select>
    </label>
  )
}
