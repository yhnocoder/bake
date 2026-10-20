import { createMemo, createResource, createSignal, For, Show, untrack } from 'solid-js'
import { Controls, createElementSize, formatNumber, Slider, Swatch, Toggle } from 'bake/kit'
import { catalog, swish, SWISH_MIN_AT_BETA_1 } from './lib/llm/functions.js'
import { guideLabelSources, guidesFor, presetNames } from './lib/llm/guides.js'
import { FunctionPanel } from './lib/llm/function-panel.jsx'
import { richNodes, typesetAll, typesetLater } from './lib/llm/tex.js'
import './lib/llm/act.css'

const range = (label, value) => ({ label, type: 'number', min: -100, max: 100, step: 0.01, default: value })

export const params = {
  fns: { label: '函数（实线）', type: 'text', default: 'gelu' },
  dashed: { label: '函数（虚线）', type: 'text', default: '' },
  reference: { label: '参考函数（淡色虚线）', type: 'text', default: '' },
  colors: { label: '颜色编号', type: 'text', default: '' },
  off: { label: '初始不勾选', type: 'text', default: '' },
  xmin: range('横轴下限', -4),
  xmax: range('横轴上限', 4),
  ymin: range('f(x) 纵轴下限', -1),
  ymax: range('f(x) 纵轴上限', 4),
  dymin: range('导数纵轴下限', -0.3),
  dymax: range('导数纵轴上限', 1.3),
  guides: { label: '标注', type: 'enum', options: presetNames, default: 'auto' },
  toggle: { label: '勾选曲线', type: 'boolean', default: false },
  zoom: { label: '横轴缩放滑块', type: 'boolean', default: false },
  beta: { label: 'β 初始值', type: 'number', min: 0.1, max: 5, step: 0.05, default: 1 },
}

export const layout = {
  width: 'body',
  height: (params) => (params.toggle ? 365 : params.zoom ? 400 : keyList(params.fns).includes('swish') ? 430 : 360),
  narrowHeight: (params) => (params.toggle ? 572 : params.zoom ? 600 : keyList(params.fns).includes('swish') ? 566 : 500),
}

const NAME = 'llm-act-plot'
const ZOOM_MIN = 0.25
const TWO_COLUMN_MIN_WIDTH = 600
const PANEL_GAP = 14
const PANEL_TITLE_HEIGHT = 30
const MIN_PLOT_HEIGHT = 120
const FIT_SAMPLES = 200
const FIT_PAD = 0.12
const LN9 = Math.log(9)
const F_TITLE = '$f(x)$'
const D_TITLE = '$\\frac{df(x)}{dx}$'
const STATIC_TEX = [F_TITLE, D_TITLE, '$x$', '$x=$', '$x\\approx$', '$\\beta$']

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
    if (!entry) throw new Error(`${NAME}: unknown function "${key}"`)
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

const guideSources = (guides) =>
  guides === null
    ? []
    : [
        guides.left,
        guides.right,
        ...[...guides.bands, ...guides.references, ...guides.verticals, ...guides.points].map((item) => item.label ?? ''),
      ]

const twoDigits = (value) => formatNumber(value, 2)

export default function ActFnPlot(props) {
  const specs = createMemo(() => seriesSpecs(props))
  const hasSwish = () => specs().some((s) => s.key === 'swish')
  const [beta, setBeta] = createSignal(props.beta)
  const [hidden, setHidden] = createSignal(new Set(keyList(props.off)))
  const [span, setSpan] = createSignal(props.xmax)
  const [center, setCenter] = createSignal(0)
  let panels
  const size = createElementSize(() => panels)

  const series = createMemo(() =>
    specs().map((s) => {
      const math = s.key === 'swish' ? swish(beta()) : s.math
      return { ...s, f: math.f, d: math.d, breaks: math.breaks ?? [], hidden: hidden().has(s.key) }
    }),
  )
  const panelSeries = (derivative) => createMemo(() => series().map((s) => ({ ...s, fn: derivative ? s.d : s.f, breaks: derivative ? s.breaks : [] })))
  const functionSeries = panelSeries(false)
  const derivativeSeries = panelSeries(true)

  const view = createMemo(() => {
    const zoomed = props.zoom && (span() < props.xmax || center() !== 0)
    if (!zoomed) return { x: [props.xmin, props.xmax], yf: [props.ymin, props.ymax], yd: [props.dymin, props.dymax] }
    const x = [center() - span(), center() + span()]
    return { x, yf: fitRange(series(), false, ...x), yd: fitRange(series(), true, ...x) }
  })

  const panelGuides = (derivative) =>
    createMemo(() => (props.toggle ? null : guidesFor(props.guides, derivative, { series: series(), beta: beta(), range: [props.xmin, props.xmax] })))
  const functionGuides = panelGuides(false)
  const derivativeGuides = panelGuides(true)

  const ownSources = () => [...STATIC_TEX, ...specs().map((s) => s.name), ...guideSources(functionGuides()), ...guideSources(derivativeGuides())]
  const pageSources = () => [...STATIC_TEX, ...Object.values(catalog).map((entry) => entry.name), ...guideLabelSources()]
  const [ready] = createResource(async () => {
    await typesetAll(NAME, untrack(ownSources))
    typesetLater(NAME, pageSources())
    return true
  })

  const width = () => size().width
  const twoColumns = () => width() >= TWO_COLUMN_MIN_WIDTH
  const panelWidth = () => (twoColumns() ? (width() - PANEL_GAP) / 2 : width())
  const plotHeight = () => {
    const perPanel = twoColumns() ? size().height : (size().height - PANEL_GAP) / 2
    return Math.max(MIN_PLOT_HEIGHT, Math.floor(perPanel - PANEL_TITLE_HEIGHT))
  }

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

  const hasControls = () => props.toggle || hasSwish() || props.zoom

  return (
    <div class="llm-plot">
      <Show when={ready()}>
        <Show when={!props.toggle}>
          <div class="llm-legend">
            <For each={specs()}>
              {(s) => (
                <span class="llm-legend-item" classList={{ 'llm-faint': s.faint }}>
                  <Swatch color={s.color} dashed={s.dash} />
                  <span>{richNodes(s.name)}</span>
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={hasControls()}>
          <div class="llm-controls">
            <Controls>
              <Show when={props.toggle}>
                <For each={specs()}>
                  {(s) => (
                    <span class="llm-series-toggle" style={{ '--accent': s.color }}>
                      <Toggle label={richNodes(s.name)} checked={!hidden().has(s.key)} onChange={(checked) => toggleSeries(s.key, checked)} />
                    </span>
                  )}
                </For>
              </Show>
              <Show when={hasSwish()}>
                <Slider label={richNodes('$\\beta$')} min={0.1} max={5} step={0.05} value={beta()} onInput={setBeta} />
              </Show>
              <Show when={props.zoom}>
                <Slider label="横轴范围 ±" min={ZOOM_MIN} max={props.xmax} step={0.25} value={span()} onInput={setSpan} format={twoDigits} />
                <Slider label="横轴中心" min={props.xmin} max={props.xmax} step={0.1} value={center()} onInput={setCenter} format={twoDigits} />
              </Show>
            </Controls>
          </div>
        </Show>
      </Show>
      <div ref={panels} class="llm-panels" classList={{ 'llm-single': !twoColumns() }}>
        <Show when={ready() && width() > 0 && size().height > 0}>
          <div class="llm-panel">
            <div class="llm-panel-title">{richNodes(F_TITLE)}</div>
            <FunctionPanel x={view().x} y={view().yf} width={panelWidth()} height={plotHeight()} series={functionSeries()} guides={functionGuides()} label="函数" />
          </div>
          <div class="llm-panel">
            <div class="llm-panel-title">{richNodes(D_TITLE)}</div>
            <FunctionPanel x={view().x} y={view().yd} width={panelWidth()} height={plotHeight()} series={derivativeSeries()} guides={derivativeGuides()} label="导数" />
          </div>
        </Show>
      </div>
      <Show when={ready() && status()}>
        <div class="llm-status" aria-live="polite">
          {richNodes(status())}
        </div>
      </Show>
    </div>
  )
}
