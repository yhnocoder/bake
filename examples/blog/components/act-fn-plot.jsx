import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import { Axes, Controls, Crosshair, Curve, MathText, Plot, Slider, Swatch, SvgMathText, Tex, Toggle, createElementSize, formatNumber, usePlot } from 'bake/kit'
import { catalog, swish, SWISH_MIN_AT_BETA_1 } from './lib/activations.js'
import { guidesFor } from './lib/guides.js'
import './lib/act-fn-plot.css'

export const params = {
  fns: { label: '函数（实线）', type: 'text', default: 'gelu' },
  dashed: { label: '函数（虚线）', type: 'text', default: '' },
  reference: { label: '参考函数（淡色虚线）', type: 'text', default: '' },
  colors: { label: '颜色编号', type: 'text', default: '' },
  off: { label: '初始不勾选', type: 'text', default: '' },
  xmin: { label: '横轴下限', type: 'number', min: -100, max: 100, step: 0.01, default: -4 },
  xmax: { label: '横轴上限', type: 'number', min: -100, max: 100, step: 0.01, default: 4 },
  ymin: { label: 'f(x) 纵轴下限', type: 'number', min: -100, max: 100, step: 0.01, default: -1 },
  ymax: { label: 'f(x) 纵轴上限', type: 'number', min: -100, max: 100, step: 0.01, default: 4 },
  dymin: { label: '导数纵轴下限', type: 'number', min: -100, max: 100, step: 0.01, default: -0.3 },
  dymax: { label: '导数纵轴上限', type: 'number', min: -100, max: 100, step: 0.01, default: 1.3 },
  guides: { label: '标注', type: 'enum', options: ['auto', 'none', 'far-negative', 'zero', 'transition', 'far-positive', 'sigmoid-tanh', 'gelu-approx', 'gate-clamp'], default: 'auto' },
  toggle: { label: '勾选曲线', type: 'boolean', default: false },
  zoom: { label: '横轴缩放滑块', type: 'boolean', default: false },
  beta: { label: 'β 初始值', type: 'number', min: 0.1, max: 5, step: 0.05, default: 1 },
}

export const layout = { width: 'body', placeholder: { narrow: 582, wide: 338 } }

const ZOOM_MIN = 0.25
const TWO_COLUMN_MIN_WIDTH = 420
const PANEL_GAP = 14
const PANEL_TITLE_HEIGHT = 30
const MIN_PLOT_HEIGHT = 120
const PLOT_ASPECT = 1.4
const FIT_SAMPLES = 200
const FIT_PAD = 0.12
const LN9 = Math.log(9)
const ARROW_INSET = 0.06
const ARROW_RUN = 0.035
const NONE = []

const keyList = (text) =>
  text
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

function seriesSpecs(props) {
  const roles = [
    ...keyList(props.fns).map((key) => ({ key, role: 'main' })),
    ...keyList(props.dashed).map((key) => ({ key, role: 'approx' })),
    ...keyList(props.reference).map((key) => ({ key, role: 'reference' })),
  ]
  const colors = keyList(props.colors)
  return roles.map(({ key, role }, index) => {
    const entry = catalog[key]
    if (!entry) throw new Error(`act-fn-plot: unknown function "${key}"`)
    return {
      key,
      role,
      guide: entry.guide,
      name: role === 'reference' ? entry.name + '（参考）' : entry.name,
      math: entry.math,
      color: `var(--series-${colors[index] ?? index + 1})`,
      dash: role !== 'main',
      faint: role === 'reference',
    }
  })
}

function fitRange(series, derivative, a, b) {
  let lo = Infinity
  let hi = -Infinity
  for (const q of series) {
    if (q.hidden) continue
    for (let i = 0; i <= FIT_SAMPLES; i++) {
      const y = (derivative ? q.d : q.f)(a + ((b - a) * i) / FIT_SAMPLES)
      if (isFinite(y)) {
        lo = Math.min(lo, y)
        hi = Math.max(hi, y)
      }
    }
  }
  const pad = Math.max((hi - lo) * FIT_PAD, 1e-3)
  return [lo - pad, hi + pad]
}

const twoDigits = (value) => formatNumber(value, 2)

function Mark(props) {
  return (
    <g
      tabindex={props.shown ? 0 : -1}
      role="img"
      aria-label={props.label}
      aria-hidden={props.shown ? undefined : 'true'}
      class="act-fn-mark act-fn-fade"
      classList={{ 'act-fn-shown': props.shown }}
      onPointerEnter={() => props.onNote(props.label)}
      onPointerLeave={() => props.onNote(null)}
      onFocus={() => props.onNote(props.label)}
      onBlur={() => props.onNote(null)}
    >
      {props.children}
    </g>
  )
}

function Guides(props) {
  const plot = usePlot()
  const area = () => plot.area()
  const insideX = (x) => x >= plot.xDomain()[0] && x <= plot.xDomain()[1]
  const clipped = (b) => ({ a: Math.max(plot.xDomain()[0], b.a), z: Math.min(plot.xDomain()[1], b.b) })
  return (
    <g>
      <Index each={props.guides?.bands ?? NONE}>
        {(b) => (
          <rect
            class="act-fn-band act-fn-fade"
            classList={{ 'act-fn-shown': clipped(b()).a < clipped(b()).z }}
            x={plot.x()(clipped(b()).a)}
            y={area().top}
            width={Math.max(0, plot.x()(clipped(b()).z) - plot.x()(clipped(b()).a))}
            height={area().bottom - area().top}
            fill={b().color ?? 'var(--accent)'}
          />
        )}
      </Index>
      <Index each={props.guides?.references ?? NONE}>
        {(r) => (
          <>
            <line
              x1={plot.x()(r().a)}
              x2={plot.x()(r().b)}
              y1={plot.y()(r().y)}
              y2={plot.y()(r().endY ?? r().y)}
              stroke={r().color ?? 'var(--ink-3)'}
              stroke-width="1.6"
              stroke-dasharray="1 5"
              stroke-linecap="round"
            />
            <Show when={r().label}>
              <SvgMathText
                class="act-fn-label"
                text={r().label}
                x={plot.x()(r().labelX ?? (r().a + r().b) / 2)}
                y={plot.y()(r().labelY ?? r().y) + (r().dy ?? -9)}
                anchor="middle"
                within={[0, plot.width()]}
                style={{ fill: r().color ?? 'var(--ink-3)', color: r().color ?? 'var(--ink-3)' }}
              />
            </Show>
          </>
        )}
      </Index>
      <Index each={props.guides?.verticals ?? NONE}>
        {(v) => (
          <g class="act-fn-fade" classList={{ 'act-fn-shown': insideX(v().x) }}>
            <line x1={plot.x()(v().x)} x2={plot.x()(v().x)} y1={area().top} y2={area().bottom} stroke="var(--ink-3)" stroke-dasharray="4 4" />
            <Show when={v().label}>
              <SvgMathText class="act-fn-label" text={v().label} x={plot.x()(v().x) + 6} y={area().top + 13} within={[0, plot.width()]} style={{ fill: 'var(--ink-2)', color: 'var(--ink-2)' }} />
            </Show>
          </g>
        )}
      </Index>
    </g>
  )
}

function Marks(props) {
  const plot = usePlot()
  const area = () => plot.area()
  const [x0, x1] = [() => plot.xDomain()[0], () => plot.xDomain()[1]]
  const insideX = (x) => x >= x0() && x <= x1()
  const insideY = (y) => y >= plot.yDomain()[0] && y <= plot.yDomain()[1]
  const placeX = (x) => Math.min(Math.max(plot.x()(x), area().left), area().right)
  const placeY = (y) => (Number.isFinite(y) ? Math.min(Math.max(plot.y()(y), area().top), area().bottom) : area().bottom)
  const clipped = (b) => ({ a: Math.max(x0(), b.a), z: Math.min(x1(), b.b) })
  const shownSeries = (q) => q !== undefined && !q.hidden
  const bandCurve = (b, q) => {
    const { a, z } = clipped(b)
    if (!q || a >= z) return ''
    let d = ''
    for (let j = 0; j <= 100; j++) {
      const x = a + ((z - a) * j) / 100
      d += (j ? 'L' : 'M') + plot.x()(x).toFixed(1) + ' ' + plot.y()(q.fn(x)).toFixed(1)
    }
    return d
  }
  const arrow = (q, side) => {
    const x = side < 0 ? x0() + (x1() - x0()) * ARROW_INSET : x1() - (x1() - x0()) * ARROW_INSET
    const xx = x - side * (x1() - x0()) * ARROW_RUN
    const px = plot.x()(x)
    const py = Math.min(Math.max(plot.y()(q.fn(x)), area().top), area().bottom)
    if (!Number.isFinite(py)) return { shown: false, d: '' }
    const shown = shownSeries(q) && !q.dash && !q.faint && py >= area().top + 6 && py <= area().bottom - 6
    const angle = Math.atan2(py - plot.y()(q.fn(xx)), px - plot.x()(xx))
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    return { shown, d: `M ${px - 7 * dx + 4 * dy} ${py - 7 * dy - 4 * dx} L ${px} ${py} L ${px - 7 * dx - 4 * dy} ${py - 7 * dy + 4 * dx}` }
  }
  const marked = () => props.guides?.bands.filter((b) => !b.shadeOnly) ?? NONE
  return (
    <g>
      <Index each={marked()}>
        {(b) => {
          const q = () => props.series[b().index]
          const edges = () => [b().a, b().b].map((x) => ({ x, y: q() ? q().fn(x) : NaN }))
          return (
            <>
              <Mark label={b().label} shown={shownSeries(q()) && clipped(b()).a < clipped(b()).z} onNote={props.onNote}>
                <path clip-path={`url(#${plot.clipId})`} d={bandCurve(b(), q())} fill="none" stroke={q()?.color} stroke-width="4" stroke-linecap="round" />
              </Mark>
              <Index each={edges()}>
                {(p) => (
                  <Mark label={b().label + '；边界 $x=$' + twoDigits(p().x)} shown={shownSeries(q()) && insideX(p().x) && insideY(p().y)} onNote={props.onNote}>
                    <circle cx={placeX(p().x)} cy={placeY(p().y)} r="4" fill="var(--surface)" stroke={q()?.color} stroke-width="2" />
                  </Mark>
                )}
              </Index>
            </>
          )
        }}
      </Index>
      <Show when={props.guides}>
        <Index each={props.series}>
          {(q) => (
            <Index each={[-1, 1]}>
              {(side) => (
                <Mark label={q().name + ' · ' + (side() < 0 ? props.guides.left : props.guides.right)} shown={arrow(q(), side()).shown} onNote={props.onNote}>
                  <path d={arrow(q(), side()).d} fill="none" stroke={q().color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                </Mark>
              )}
            </Index>
          )}
        </Index>
      </Show>
      <Index each={props.guides?.points ?? NONE}>
        {(m) => {
          const color = () => m().color ?? 'var(--ink)'
          const shown = () => insideX(m().x) && insideY(m().y)
          return (
            <>
              <Mark label={m().label || '边界点 (' + twoDigits(m().x) + ', ' + twoDigits(m().y) + ')'} shown={shown()} onNote={props.onNote}>
                <circle cx={placeX(m().x)} cy={placeY(m().y)} r="4" fill={m().open ? 'var(--surface)' : color()} stroke={m().open ? color() : 'var(--surface)'} stroke-width="1.5" />
              </Mark>
              <Show when={m().label}>
                <g class="act-fn-fade" classList={{ 'act-fn-shown': shown() }} pointer-events="none">
                  <SvgMathText class="act-fn-label" text={m().label} x={placeX(m().x) + (m().dx ?? 8)} y={placeY(m().y) + (m().dy ?? -10)} within={[0, plot.width()]} style={{ fill: color(), color: color() }} />
                </g>
              </Show>
            </>
          )
        }}
      </Index>
    </g>
  )
}

function Note(props) {
  const plot = usePlot()
  const shown = createMemo((last) => props.text ?? last, '')
  return (
    <foreignObject class="act-fn-note-layer" x={plot.area().left + 4} y={plot.area().top + 4} width={plot.area().right - plot.area().left - 8} height="1" aria-hidden="true">
      <div class="act-fn-note" classList={{ 'act-fn-shown': props.text !== null }}>
        <MathText text={shown()} />
      </div>
    </foreignObject>
  )
}

function Panel(props) {
  const [note, setNote] = createSignal(null)
  return (
    <div class="act-fn-panel">
      <div class="act-fn-panel-title">
        <Tex tex={props.title} />
      </div>
      <Plot width={props.width} height={props.height} x={props.x} y={props.y} label={props.label} pointer={props.pointer} onPointer={props.onPointer}>
        <Axes />
        <Guides guides={props.guides} />
        <Index each={props.series}>
          {(s) => (
            <Show when={!s().hidden}>
              <g opacity={s().faint ? 0.55 : undefined}>
                <Curve f={s().fn} breaks={s().breaks} color={s().color} dashed={s().dash} label={s().name} />
              </g>
            </Show>
          )}
        </Index>
        <Marks guides={props.guides} series={props.series} onNote={setNote} />
        <Crosshair />
        <Note text={note()} />
      </Plot>
    </div>
  )
}

export default function ActFnPlot(props) {
  const specs = createMemo(() => seriesSpecs(props))
  const hasSwish = () => specs().some((s) => s.key === 'swish')
  const [beta, setBeta] = createSignal(props.beta)
  const [hidden, setHidden] = createSignal(new Set(keyList(props.off)))
  const [span, setSpan] = createSignal(props.xmax)
  const [center, setCenter] = createSignal(0)
  const [pointer, setPointer] = createSignal(null)
  let panels
  const size = createElementSize(() => panels)

  const series = createMemo(() =>
    specs().map((s) => {
      const math = s.key === 'swish' ? swish(beta()) : s.math
      return { ...s, f: math.f, d: math.d, breaks: math.breaks ?? [], hidden: hidden().has(s.key) }
    }),
  )
  const functionSeries = createMemo(() => series().map((s) => ({ ...s, fn: s.f, breaks: [] })))
  const derivativeSeries = createMemo(() => series().map((s) => ({ ...s, fn: s.d })))

  const view = createMemo(() => {
    const zoomed = props.zoom && (span() < props.xmax || center() !== 0)
    if (!zoomed) return { x: [props.xmin, props.xmax], yf: [props.ymin, props.ymax], yd: [props.dymin, props.dymax] }
    const x = [center() - span(), center() + span()]
    return { x, yf: fitRange(series(), false, ...x), yd: fitRange(series(), true, ...x) }
  })

  const guides = (derivative) => () => (props.toggle ? null : guidesFor(props.guides, derivative, { series: series(), beta: beta(), range: [props.xmin, props.xmax] }))
  const functionGuides = createMemo(guides(false))
  const derivativeGuides = createMemo(guides(true))

  const width = () => size().width
  const twoColumns = () => width() >= TWO_COLUMN_MIN_WIDTH
  const panelWidth = () => Math.floor(twoColumns() ? (width() - PANEL_GAP) / 2 : width())
  const plotHeight = () => Math.max(MIN_PLOT_HEIGHT, Math.floor(panelWidth() / PLOT_ASPECT))
  const panelsHeight = () => (twoColumns() ? plotHeight() + PANEL_TITLE_HEIGHT : 2 * (plotHeight() + PANEL_TITLE_HEIGHT) + PANEL_GAP)

  const status = createMemo(() => {
    if (!hasSwish()) return null
    const w = LN9 / beta()
    const xmin = SWISH_MIN_AT_BETA_1 / beta()
    return (
      'gate 过渡区：[' + twoDigits(-w) + ', ' + twoDigits(w) + ']；宽 ' + twoDigits(2 * w) +
      (w > props.xmax ? '（色带超出当前视野）' : '') +
      (xmin < props.xmin ? '；最低点位于视野左侧，$x\\approx$ ' + twoDigits(xmin) : '')
    )
  })

  const toggleSeries = (key, checked) =>
    setHidden((previous) => {
      const next = new Set(previous)
      if (checked) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div class="act-fn-plot">
      <Show when={!props.toggle}>
        <div class="act-fn-legend">
          <For each={specs()}>
            {(s) => (
              <span class="act-fn-legend-item" classList={{ 'act-fn-faint': s.faint }}>
                <Swatch color={s.color} dashed={s.dash} />
                <MathText text={s.name} />
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.toggle || hasSwish() || props.zoom}>
        <Controls>
          <Show when={props.toggle}>
            <For each={specs()}>
              {(s) => (
                <span class="act-fn-series-toggle" style={{ '--accent': s.color }}>
                  <Toggle label={<MathText text={s.name} />} checked={!hidden().has(s.key)} onChange={(checked) => toggleSeries(s.key, checked)} />
                </span>
              )}
            </For>
          </Show>
          <Show when={hasSwish()}>
            <Slider label="β" min={0.1} max={5} step={0.05} value={beta()} onInput={setBeta} />
          </Show>
          <Show when={props.zoom}>
            <Slider label="横轴范围 ±" min={ZOOM_MIN} max={props.xmax} step={0.25} value={span()} onInput={setSpan} format={twoDigits} />
            <Slider label="横轴中心" min={props.xmin} max={props.xmax} step={0.1} value={center()} onInput={setCenter} format={twoDigits} />
          </Show>
        </Controls>
      </Show>
      <div ref={panels} class="act-fn-panels" classList={{ 'act-fn-single': !twoColumns() }} style={{ 'min-height': width() > 0 ? `${panelsHeight()}px` : undefined }}>
        <Show when={width() > 0}>
          <Panel title="f(x)" label="函数" x={view().x} y={view().yf} width={panelWidth()} height={plotHeight()} series={functionSeries()} guides={functionGuides()} pointer={pointer()} onPointer={setPointer} />
          <Panel title="\frac{df(x)}{dx}" label="导数" x={view().x} y={view().yd} width={panelWidth()} height={plotHeight()} series={derivativeSeries()} guides={derivativeGuides()} pointer={pointer()} onPointer={setPointer} />
        </Show>
      </div>
      <Show when={status()}>
        <div class="act-fn-status" aria-live="polite">
          <MathText text={status()} />
        </div>
      </Show>
    </div>
  )
}
