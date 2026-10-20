import { batch, createMemo, createSignal, createUniqueId, Index, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { formatNumber, linearScale, niceTicks, samplePath } from 'bake/kit'
import { SvgLabel } from './svg-label.jsx'
import { richNodes, plainText } from './tex.js'
import { createPointerFrames, hideOnScroll, tipTransform } from './tip.js'

const MIN_WIDTH = 360
const PIXELS_PER_SAMPLE = 2
const MIN_SAMPLES = 40
const TICK_COUNT = 5
const BAND_SAMPLES = 100
const MARGIN = { left: 40, right: 12, top: 10, bottom: 28 }
const TIP_GAP = 12
const TIP_TOP = 8
const LABEL_TIP_LEFT = 44
const FLIP_AT = 0.6
const ARROW_INSET = 0.06
const ARROW_RUN = 0.035
const NONE = []

const tickLabel = (value) => formatNumber(value, 6).replace(/\.?0+$/, '')

function Mark(props) {
  return (
    <g
      tabindex={props.shown ? 0 : -1}
      role="img"
      aria-label={plainText(props.label)}
      aria-hidden={props.shown ? undefined : 'true'}
      class="llm-mark llm-fade"
      classList={{ 'llm-shown': props.shown }}
      onPointerEnter={() => props.onShow(props.label)}
      onPointerLeave={props.onHide}
      onFocus={() => props.onShow(props.label)}
      onBlur={props.onHide}
    >
      <title>{plainText(props.label)}</title>
      {props.children}
    </g>
  )
}

export function FunctionPanel(props) {
  const clipId = createUniqueId()
  const [pointer, setPointer] = createSignal(0)
  const [pointerLeft, setPointerLeft] = createSignal(0)
  const [origin, setOrigin] = createSignal({ left: 0, top: 0 })
  const [tracking, setTracking] = createSignal(false)
  const [labelTip, setLabelTip] = createSignal('')
  const [labelShown, setLabelShown] = createSignal(false)
  let svgRef

  const W = () => Math.max(MIN_WIDTH, props.width)
  const H = () => (props.height * W()) / props.width
  const frame = createMemo(() => {
    const [x0, x1] = props.x
    const [y0, y1] = props.y
    const w = W()
    const h = H()
    const sx = linearScale([x0, x1], [MARGIN.left, w - MARGIN.right])
    const sy = linearScale([y0, y1], [h - MARGIN.bottom, MARGIN.top])
    return { x0, x1, y0, y1, w, h, sx, sy, bottom: h - MARGIN.bottom, right: w - MARGIN.right }
  })
  const samples = () => 2 * Math.max(MIN_SAMPLES / 2, Math.round((frame().right - MARGIN.left) / PIXELS_PER_SAMPLE / 2))
  const guides = () => props.guides
  const xTicks = createMemo(() => niceTicks(frame().x0, frame().x1, TICK_COUNT))
  const yTicks = createMemo(() => niceTicks(frame().y0, frame().y1, TICK_COUNT))
  const insideX = (x) => x >= frame().x0 && x <= frame().x1
  const insideY = (y) => y >= frame().y0 && y <= frame().y1
  const placeX = (x) => Math.min(Math.max(frame().sx(x), MARGIN.left), frame().right)
  const placeY = (y) => (Number.isFinite(y) ? Math.min(Math.max(frame().sy(y), MARGIN.top), frame().bottom) : frame().bottom)

  const pageOrigin = (rect) => ({ left: rect.left, top: rect.top })
  const showLabel = (label) => {
    setOrigin(pageOrigin(svgRef.getBoundingClientRect()))
    setLabelTip(label)
    setLabelShown(true)
  }
  const hideLabel = () => setLabelShown(false)
  const labelNodes = createMemo(() => richNodes(labelTip()))

  function curvePath(q) {
    const { x0, x1, y0, y1, sx, sy } = frame()
    const span = y1 - y0
    const clamped = (x) => {
      const y = q.fn(x)
      return Number.isFinite(y) ? Math.max(Math.min(y, y1 + span), y0 - span) : y
    }
    return samplePath(clamped, [x0, x1], sx, sy, samples(), q.breaks)
  }

  const clippedBand = (b) => ({ a: Math.max(frame().x0, b.a), z: Math.min(frame().x1, b.b) })

  function bandCurve(b, q) {
    const { a, z } = clippedBand(b)
    if (!q || a >= z) return ''
    const { sx, sy } = frame()
    let d = ''
    for (let j = 0; j <= BAND_SAMPLES; j++) {
      const x = a + ((z - a) * j) / BAND_SAMPLES
      d += (j ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(q.fn(x)).toFixed(1)
    }
    return d
  }

  const markedBands = () => (guides() ? guides().bands.filter((b) => !b.shadeOnly) : NONE)
  const seriesShown = (q) => q !== undefined && !q.hidden

  function arrow(q, side) {
    const { x0, x1, sx, sy, bottom } = frame()
    const x = side < 0 ? x0 + (x1 - x0) * ARROW_INSET : x1 - (x1 - x0) * ARROW_INSET
    const xx = x - side * (x1 - x0) * ARROW_RUN
    const px = sx(x)
    const py = Math.min(Math.max(sy(q.fn(x)), MARGIN.top), bottom)
    const shown = seriesShown(q) && !q.dash && !q.faint && py >= MARGIN.top + 6 && py <= bottom - 6
    if (!Number.isFinite(py)) return { shown: false, d: '' }
    const angle = Math.atan2(py - sy(q.fn(xx)), px - sx(xx))
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    return { shown, d: `M ${px - 7 * dx + 4 * dy} ${py - 7 * dy - 4 * dx} L ${px} ${py} L ${px - 7 * dx - 4 * dy} ${py - 7 * dy + 4 * dx}` }
  }

  function follow(event) {
    if (event.target.closest('.llm-mark')) return
    const rect = svgRef.getBoundingClientRect()
    const { w, sx } = frame()
    const px = ((event.clientX - rect.left) / rect.width) * w
    if (px < MARGIN.left || px > w - MARGIN.right) return setTracking(false)
    const origin = pageOrigin(rect)
    batch(() => {
      setPointer(sx.invert(px))
      setPointerLeft(event.clientX - rect.left)
      setOrigin(origin)
      setTracking(true)
    })
  }

  const pointerFrames = createPointerFrames(follow)
  const stopTracking = () => {
    pointerFrames.cancel()
    setTracking(false)
  }
  hideOnScroll(() => tracking() || labelShown(), () => {
    stopTracking()
    hideLabel()
  })

  const flipped = () => pointerLeft() > props.width * FLIP_AT
  const readoutTransform = () => tipTransform(origin().left + pointerLeft() + (flipped() ? -TIP_GAP : TIP_GAP), origin().top + TIP_TOP, flipped())

  return (
    <div class="llm-plotwrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W()} ${H()}`}
        role="img"
        aria-label={props.label}
        class="llm-svg"
        onPointerMove={pointerFrames.track}
        onPointerDown={pointerFrames.track}
        onPointerLeave={stopTracking}
        onPointerCancel={stopTracking}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={W() - MARGIN.left - MARGIN.right} height={H() - MARGIN.top - MARGIN.bottom} />
          </clipPath>
        </defs>
        <g>
          <Index each={yTicks()}>
            {(t) => (
              <>
                <line x1={MARGIN.left} x2={frame().right} y1={frame().sy(t().value)} y2={frame().sy(t().value)} stroke="var(--grid)" stroke-width="1" />
                <text x={MARGIN.left - 6} y={frame().sy(t().value) + 3.5} text-anchor="end" class="llm-tick">
                  {tickLabel(t().value)}
                </text>
              </>
            )}
          </Index>
          <Index each={xTicks()}>
            {(t) => (
              <>
                <line y1={MARGIN.top} y2={frame().bottom} x1={frame().sx(t().value)} x2={frame().sx(t().value)} stroke="var(--grid)" stroke-width="1" />
                <text x={frame().sx(t().value)} y={frame().bottom + 14} text-anchor="middle" class="llm-tick">
                  {tickLabel(t().value)}
                </text>
              </>
            )}
          </Index>
          <Show when={frame().y0 < 0 && frame().y1 > 0}>
            <line x1={MARGIN.left} x2={frame().right} y1={frame().sy(0)} y2={frame().sy(0)} stroke="var(--axis)" stroke-width="1" />
          </Show>
          <Show when={frame().x0 < 0 && frame().x1 > 0}>
            <line y1={MARGIN.top} y2={frame().bottom} x1={frame().sx(0)} x2={frame().sx(0)} stroke="var(--axis)" stroke-width="1" />
          </Show>
        </g>
        <g>
          <Index each={guides()?.bands ?? NONE}>
            {(b) => {
              const band = () => clippedBand(b())
              return (
                <rect
                  class="llm-band llm-fade"
                  classList={{ 'llm-shown': band().a < band().z }}
                  x={frame().sx(band().a)}
                  y={MARGIN.top}
                  width={Math.max(0, frame().sx(band().z) - frame().sx(band().a))}
                  height={frame().bottom - MARGIN.top}
                  fill={b().color ?? 'var(--accent)'}
                  pointer-events="none"
                />
              )
            }}
          </Index>
          <Index each={guides()?.references ?? NONE}>
            {(r) => (
              <>
                <line
                  x1={frame().sx(r().a)}
                  x2={frame().sx(r().b)}
                  y1={frame().sy(r().y)}
                  y2={frame().sy(r().endY ?? r().y)}
                  stroke={r().color ?? 'var(--ink-3)'}
                  stroke-width="1.6"
                  stroke-dasharray="1 5"
                  stroke-linecap="round"
                />
                <Show when={r().label}>
                  <SvgLabel
                    text={r().label}
                    x={frame().sx(r().labelX ?? (r().a + r().b) / 2)}
                    y={frame().sy(r().labelY ?? r().y) + (r().dy ?? -9)}
                    anchor="middle"
                    fill={r().color ?? 'var(--ink-3)'}
                  />
                </Show>
              </>
            )}
          </Index>
          <Index each={guides()?.verticals ?? NONE}>
            {(v) => (
              <g class="llm-fade" classList={{ 'llm-shown': insideX(v().x) }}>
                <line x1={frame().sx(v().x)} x2={frame().sx(v().x)} y1={MARGIN.top} y2={frame().bottom} stroke="var(--ink-3)" stroke-dasharray="4 4" />
                <Show when={v().label}>
                  <SvgLabel text={v().label} x={frame().sx(v().x) + 6} y={MARGIN.top + 13} fill="var(--ink-2)" />
                </Show>
              </g>
            )}
          </Index>
        </g>
        <g clip-path={`url(#${clipId})`}>
          <Index each={props.series}>
            {(q) => (
              <path
                class="llm-curve"
                d={curvePath(q())}
                fill="none"
                stroke={q().color}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-dasharray={q().dash ? '6 4' : undefined}
                style={{ opacity: q().hidden ? 0 : q().faint ? 0.55 : 1 }}
              />
            )}
          </Index>
        </g>
        <g>
          <Index each={markedBands()}>
            {(b) => {
              const q = () => props.series[b().index]
              const shown = () => seriesShown(q()) && clippedBand(b()).a < clippedBand(b()).z
              const edge = (x) => ({ x, y: q() ? q().fn(x) : NaN })
              const edges = () => [edge(b().a), edge(b().b)]
              return (
                <>
                  <Mark label={b().label} shown={shown()} onShow={showLabel} onHide={hideLabel}>
                    <path clip-path={`url(#${clipId})`} d={bandCurve(b(), q())} fill="none" stroke={q()?.color} stroke-width="4" stroke-linecap="round" />
                  </Mark>
                  <Index each={edges()}>
                    {(p) => (
                      <Mark
                        label={b().label + '；边界 $x=$' + formatNumber(p().x, 2)}
                        shown={seriesShown(q()) && insideX(p().x) && insideY(p().y)}
                        onShow={showLabel}
                        onHide={hideLabel}
                      >
                        <circle cx={placeX(p().x)} cy={placeY(p().y)} r="4" fill="var(--surface)" stroke={q()?.color} stroke-width="2" />
                      </Mark>
                    )}
                  </Index>
                </>
              )
            }}
          </Index>
          <Show when={guides()}>
            <Index each={props.series}>
              {(q) => (
                <Index each={[-1, 1]}>
                  {(side) => {
                    const shape = () => arrow(q(), side())
                    return (
                      <Mark label={q().name + ' · ' + (side() < 0 ? guides().left : guides().right)} shown={shape().shown} onShow={showLabel} onHide={hideLabel}>
                        <path d={shape().d} fill="none" stroke={q().color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                      </Mark>
                    )
                  }}
                </Index>
              )}
            </Index>
          </Show>
          <Index each={guides()?.points ?? NONE}>
            {(m) => {
              const color = () => m().color ?? 'var(--ink)'
              const shown = () => insideX(m().x) && insideY(m().y)
              return (
                <>
                  <Mark
                    label={m().label || '边界点 (' + formatNumber(m().x, 2) + ', ' + formatNumber(m().y, 2) + ')'}
                    shown={shown()}
                    onShow={showLabel}
                    onHide={hideLabel}
                  >
                    <circle
                      cx={placeX(m().x)}
                      cy={placeY(m().y)}
                      r="4"
                      fill={m().open ? 'var(--surface)' : color()}
                      stroke={m().open ? color() : 'var(--surface)'}
                      stroke-width="1.5"
                    />
                  </Mark>
                  <Show when={m().label}>
                    <g class="llm-fade" classList={{ 'llm-shown': shown() }}>
                      <SvgLabel text={m().label} x={placeX(m().x) + (m().dx ?? 8)} y={placeY(m().y) + (m().dy ?? -10)} fill={color()} interactive={false} />
                    </g>
                  </Show>
                </>
              )
            }}
          </Index>
        </g>
        <g class="llm-fade" classList={{ 'llm-shown': tracking() }} pointer-events="none">
          <line x1={frame().sx(pointer())} x2={frame().sx(pointer())} y1={MARGIN.top} y2={frame().bottom} stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3" />
          <Index each={props.series}>
            {(q) => {
              const y = () => q().fn(pointer())
              return (
                <circle
                  class="llm-fade"
                  classList={{ 'llm-shown': !q().hidden && Number.isFinite(y()) && insideY(y()) }}
                  cx={frame().sx(pointer())}
                  cy={Number.isFinite(y()) ? frame().sy(y()) : 0}
                  r="3.5"
                  fill={q().color}
                  stroke="var(--surface)"
                  stroke-width="1.5"
                />
              )
            }}
          </Index>
        </g>
      </svg>
      <Portal>
        <div class="llm-tip llm-fade" classList={{ 'llm-shown': tracking() }} style={{ transform: readoutTransform() }} aria-hidden="true">
          <div>
            {richNodes('$x$')} {formatNumber(pointer(), 2)}
          </div>
          <Index each={props.series}>
            {(q) => {
              const name = richNodes(q().name)
              const y = () => q().fn(pointer())
              return (
                <div style={{ display: q().hidden ? 'none' : undefined }}>
                  <span style={{ color: q().color }}>■</span> {name} {Number.isFinite(y()) ? formatNumber(y(), 3) : '不可导'}
                </div>
              )
            }}
          </Index>
        </div>
        <div
          class="llm-tip llm-fade"
          classList={{ 'llm-shown': labelShown() }}
          style={{ transform: tipTransform(origin().left + LABEL_TIP_LEFT, origin().top + TIP_TOP, false) }}
          aria-hidden="true"
        >
          {labelNodes()}
        </div>
      </Portal>
    </div>
  )
}
