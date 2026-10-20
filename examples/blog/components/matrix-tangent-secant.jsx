import { For, Show, createMemo, createSignal } from 'solid-js'
import { Controls, Segmented, Slider, Tex, createElementSize, formatNumber } from 'bake/kit'
import { MathText, SvgTex, fadeIn } from './lib/matrix/view.jsx'

export const params = {
  fn: { label: '函数', type: 'enum', options: ['cube', 'sin', 'ln', 'swish'], default: 'cube' },
}
export const layout = { width: 'body', height: 636, narrowHeight: 620 }

const sigmoid = (x) => 1 / (1 + Math.exp(-x))
const functions = {
  cube: { label: 'x^3', f: (x) => x * x * x, d: (x) => 3 * x * x, xr: [-2, 2], yr: [-8, 8], dr: [-1, 12], x0: [-1.9, 1], init: 1 },
  sin: { label: '\\sin x', f: Math.sin, d: Math.cos, xr: [-6.5, 6.5], yr: [-1.6, 1.6], dr: [-1.5, 1.5], x0: [-6.3, 5.5], init: 1 },
  ln: { label: '\\ln x', f: Math.log, d: (x) => 1 / x, xr: [0, 6], yr: [-3, 2.2], dr: [-0.3, 5], x0: [0.15, 5], init: 1, lo: 0.01 },
  swish: {
    label: '\\mathrm{Swish}(x)',
    f: (x) => x * sigmoid(x),
    d: (x) => sigmoid(x) + x * sigmoid(x) * (1 - sigmoid(x)),
    xr: [-6, 6],
    yr: [-1.2, 6],
    dr: [-0.2, 1.2],
    x0: [-5.8, 5],
    init: 1,
  },
}
const LEFT = 44
const RIGHT = 16
const TOP = 12
const BOTTOM = 22
const SAMPLES = 240

function scale(width, xr, yr, height) {
  return {
    sx: (x) => LEFT + ((x - xr[0]) / (xr[1] - xr[0])) * (width - LEFT - RIGHT),
    sy: (y) => TOP + ((yr[1] - y) / (yr[1] - yr[0])) * (height - TOP - BOTTOM),
    ix: (px) => xr[0] + ((px - LEFT) / (width - LEFT - RIGHT)) * (xr[1] - xr[0]),
  }
}
const clampY = (py, height) => Math.max(-200, Math.min(height + 200, py))

function samples(spec, which, yr, width, height) {
  const s = scale(width, spec.xr, yr, height)
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const x = spec.xr[0] + ((spec.xr[1] - spec.xr[0]) * i) / SAMPLES
    let y = spec[which](spec.lo != null && x < spec.lo ? spec.lo : x)
    if (!isFinite(y)) y = spec.yr[1] * 10
    return [s.sx(x), clampY(s.sy(y), height)]
  })
}
const pathOf = (points) => points.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ')

function xTicks(xr) {
  const step = xr[1] - xr[0] > 10 ? 2 : 1
  const out = []
  for (let v = Math.ceil(xr[0] / step) * step; v <= xr[1] + 1e-9; v += step) out.push(v)
  return out
}
function yTicks(yr) {
  const span = yr[1] - yr[0]
  const step = span > 6 ? 2 : span > 2.5 ? 1 : 0.5
  const out = []
  for (let v = Math.ceil(yr[0] / step) * step; v <= yr[1] + 1e-9; v += step) out.push(+v.toFixed(2))
  return out
}

function Grid(props) {
  const s = () => scale(props.width, props.spec.xr, props.yr, props.height)
  return (
    <g>
      <For each={xTicks(props.spec.xr)}>
        {(v) => (
          <>
            <line x1={s().sx(v)} y1={TOP} x2={s().sx(v)} y2={props.height - BOTTOM} stroke="var(--grid)" />
            <text x={s().sx(v)} y={props.height - 6} text-anchor="middle">{v}</text>
          </>
        )}
      </For>
      <For each={yTicks(props.yr)}>
        {(v) => (
          <>
            <line x1={LEFT} y1={s().sy(v)} x2={props.width - RIGHT} y2={s().sy(v)} stroke="var(--grid)" />
            <text x={LEFT - 6} y={s().sy(v) + 4} text-anchor="end">{v}</text>
          </>
        )}
      </For>
      {props.yr[0] < 0 && props.yr[1] > 0 && (
        <line x1={LEFT} y1={s().sy(0)} x2={props.width - RIGHT} y2={s().sy(0)} stroke="var(--axis)" />
      )}
      {props.spec.xr[0] < 0 && props.spec.xr[1] > 0 ? (
        <line x1={s().sx(0)} y1={TOP} x2={s().sx(0)} y2={props.height - BOTTOM} stroke="var(--axis)" />
      ) : (
        <line x1={LEFT} y1={TOP} x2={LEFT} y2={props.height - BOTTOM} stroke="var(--axis)" />
      )}
    </g>
  )
}

let clipCount = 0

export default function TangentSecantPlot(props) {
  let host
  let plot
  let overlay
  let derivativeOverlay
  const id = `matrix-tangent-${++clipCount}`
  const size = createElementSize(() => host)
  const W = () => Math.max(300, size().width || 760)
  const HF = () => (W() < 560 ? 240 : 300)
  const HD = () => (W() < 560 ? 140 : 170)
  const [name, setName] = createSignal(props.fn)
  const [x0, setX0] = createSignal(functions[props.fn].init)
  const [logDx, setLogDx] = createSignal(-3)
  const options = Object.keys(functions).map((key) => ({ value: key, label: <Tex tex={functions[key].label} /> }))

  const spec = () => functions[name()]
  const dx = () => Math.pow(10, logDx())
  const curves = createMemo(() =>
    Object.fromEntries(
      Object.entries(functions).map(([key, fn]) => [
        key,
        { f: pathOf(samples(fn, 'f', fn.yr, W(), HF())), d: pathOf(samples(fn, 'd', fn.dr, W(), HD())) },
      ]),
    ),
  )

  function choose(next) {
    if (next === name()) return
    setName(next)
    setX0(functions[next].init)
    setLogDx(-3)
    fadeIn(overlay)
    fadeIn(derivativeOverlay)
  }

  const geometry = () => {
    const s = scale(W(), spec().xr, spec().yr, HF())
    const d = scale(W(), spec().xr, spec().dr, HD())
    const y0 = spec().f(x0())
    const x1 = x0() + dx()
    const y1 = spec().f(x1)
    const secant = (y1 - y0) / dx()
    const tangent = spec().d(x0())
    const kx = (W() - LEFT - RIGHT) / (spec().xr[1] - spec().xr[0])
    const ky = (HF() - TOP - BOTTOM) / (spec().yr[1] - spec().yr[0])
    const px0 = s.sx(x0())
    const py0 = s.sy(y0)
    const line = (k) => {
      const slope = (-k * ky) / kx
      const xa = LEFT - 40
      const xb = W() - RIGHT + 40
      return { x1: xa, y1: py0 + (xa - px0) * slope, x2: xb, y2: py0 + (xb - px0) * slope }
    }
    return {
      px0,
      py0,
      p1: [s.sx(x1), clampY(s.sy(y1), HF())],
      tangentLine: line(tangent),
      secantLine: line(secant),
      secant,
      tangent,
      pd: [d.sx(x0()), clampY(d.sy(tangent), HD())],
    }
  }
  const shape = createMemo(geometry)

  let bounds = null
  function pointer(event) {
    const px = ((event.clientX - bounds.left) / bounds.width) * W()
    const x = scale(W(), spec().xr, spec().yr, HF()).ix(px)
    setX0(Math.max(spec().x0[0], Math.min(spec().x0[1], x)))
  }
  const layers = (draw) => (
    <For each={Object.keys(functions)}>
      {(key) => (
        <g class="matrix-fade" style={{ opacity: name() === key ? 1 : 0 }}>
          {draw(key, functions[key])}
        </g>
      )}
    </For>
  )

  return (
    <div ref={host} class="matrix-figure">
      <Controls>
        <Segmented label="选择函数" options={options} value={name()} onChange={choose} />
        <Slider label={<Tex tex="x_0" />} min={spec().x0[0]} max={spec().x0[1]} step={0.01} value={x0()} onInput={setX0} />
        <span class="matrix-dx-slider">
          <Slider
            label={<Tex tex="\Delta x" />}
            min={-3}
            max={0}
            step={0.01}
            value={logDx()}
            format={(value) => formatNumber(Math.pow(10, value), 3)}
            onInput={setLogDx}
          />
        </span>
      </Controls>
      <Show when={size().width > 0}>
        <div class="matrix-plot">
          <svg
            ref={plot}
            viewBox={`0 0 ${W()} ${HF()}`}
            style="cursor:ew-resize"
            role="img"
            aria-label="函数图像、过两点的割线和切线"
            onPointerDown={(e) => {
              bounds = plot.getBoundingClientRect()
              plot.setPointerCapture(e.pointerId)
              pointer(e)
            }}
            onPointerMove={(e) => bounds && pointer(e)}
            onPointerUp={() => (bounds = null)}
            onPointerCancel={() => (bounds = null)}
          >
            <defs>
              <clipPath id={`${id}-f`}>
                <rect x={LEFT} y={TOP} width={W() - LEFT - RIGHT} height={HF() - TOP - BOTTOM} />
              </clipPath>
            </defs>
            {layers((key, fn) => (
              <>
                <Grid spec={fn} yr={fn.yr} width={W()} height={HF()} />
                <path d={curves()[key].f} fill="none" stroke="var(--ink)" stroke-width="2" clip-path={`url(#${id}-f)`} />
              </>
            ))}
            <g ref={overlay}>
              <g clip-path={`url(#${id}-f)`}>
                <line {...shape().tangentLine} stroke="var(--series-1)" stroke-width="2" />
                <line {...shape().secantLine} stroke="var(--series-2)" stroke-width="2" stroke-dasharray="6 4" />
                <line x1={shape().px0} y1={TOP} x2={shape().px0} y2={HF() - BOTTOM} stroke="var(--ink-3)" stroke-dasharray="2 3" />
                <circle cx={shape().p1[0]} cy={shape().p1[1]} r="5" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" />
                <circle cx={shape().px0} cy={shape().py0} r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" />
              </g>
              <SvgTex tex="x_0" size={13} x={shape().px0 + 7} y={HF() - BOTTOM - 8} align="start" color="var(--ink-2)" />
            </g>
            <SvgTex tex="y = f(x)" size={13} x={W() - RIGHT - 6} y={TOP + 16} align="end" color="var(--ink-2)" backdrop />
          </svg>
        </div>
        <div class="matrix-readout" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:6px 0 4px">
          <div>
            <span style="color:var(--ink-2)">过两点的直线，斜率</span>{' '}
            <MathText text="$\dfrac{f(x_0+\Delta x)-f(x_0)}{\Delta x}$" /> = <b style="color:var(--series-2)">{formatNumber(shape().secant, 3)}</b>
          </div>
          <div>
            <span style="color:var(--ink-2)">
              切线的斜率，即 <MathText text="$x_0$" /> 处的
            </span>{' '}
            <MathText text="$\dfrac{dy}{dx}$" /> = <b style="color:var(--series-1)">{formatNumber(shape().tangent, 3)}</b>
          </div>
        </div>
        <div class="matrix-plot">
          <svg viewBox={`0 0 ${W()} ${HD()}`} role="img" aria-label="导数函数的图像">
            <defs>
              <clipPath id={`${id}-d`}>
                <rect x={LEFT} y={TOP} width={W() - LEFT - RIGHT} height={HD() - TOP - BOTTOM} />
              </clipPath>
            </defs>
            {layers((key, fn) => (
              <>
                <Grid spec={fn} yr={fn.dr} width={W()} height={HD()} />
                <path d={curves()[key].d} fill="none" stroke="var(--series-1)" stroke-width="2" clip-path={`url(#${id}-d)`} />
              </>
            ))}
            <g ref={derivativeOverlay} clip-path={`url(#${id}-d)`}>
              <line x1={shape().pd[0]} y1={TOP} x2={shape().pd[0]} y2={HD() - BOTTOM} stroke="var(--ink-3)" stroke-dasharray="2 3" />
              <line x1={LEFT} y1={shape().pd[1]} x2={shape().pd[0]} y2={shape().pd[1]} stroke="var(--ink-3)" stroke-dasharray="2 3" />
              <circle cx={shape().pd[0]} cy={shape().pd[1]} r="6" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" />
            </g>
            <SvgTex tex="\dfrac{dy}{dx}" size={13} x={W() - RIGHT - 6} y={TOP + 26} align="end" color="var(--ink-2)" backdrop />
          </svg>
        </div>
      </Show>
    </div>
  )
}
