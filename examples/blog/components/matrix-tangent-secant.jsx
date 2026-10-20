import { For, createMemo, createSignal, onCleanup } from 'solid-js'
import { MathText, SvgTex, useWidth } from './lib/matrix/view.jsx'

export const params = {
  fn: { label: '函数', type: 'enum', options: ['cube', 'sin', 'ln', 'swish'], default: 'cube' },
}
export const layout = { width: 'body', height: 580 }

const sigmoid = (x) => 1 / (1 + Math.exp(-x))
const functions = {
  cube: { label: '$x^3$', f: (x) => x * x * x, d: (x) => 3 * x * x, xr: [-2, 2], yr: [-8, 8], dr: [-1, 12], x0: [-1.9, 1], init: 1 },
  sin: { label: '$\\sin x$', f: Math.sin, d: Math.cos, xr: [-6.5, 6.5], yr: [-1.6, 1.6], dr: [-1.5, 1.5], x0: [-6.3, 5.5], init: 1 },
  ln: { label: '$\\ln x$', f: Math.log, d: (x) => 1 / x, xr: [0, 6], yr: [-3, 2.2], dr: [-0.3, 5], x0: [0.15, 5], init: 1, lo: 0.01 },
  swish: {
    label: '$\\mathrm{Swish}(x)$',
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
  const id = `matrix-tangent-${++clipCount}`
  const width = useWidth(() => host)
  const W = () => Math.max(300, Math.round(width() || 760))
  const HF = () => (W() < 560 ? 240 : 300)
  const HD = () => (W() < 560 ? 140 : 170)
  const [name, setName] = createSignal(props.fn)
  const [x0, setX0] = createSignal(functions[props.fn].init)
  const [logDx, setLogDx] = createSignal(-3)
  const [progress, setProgress] = createSignal(1)
  const [from, setFrom] = createSignal(null)
  let frame = null
  onCleanup(() => cancelAnimationFrame(frame))

  const spec = () => functions[name()]
  const dx = () => Math.pow(10, logDx())
  const targetF = createMemo(() => samples(spec(), 'f', spec().yr, W(), HF()))
  const targetD = createMemo(() => samples(spec(), 'd', spec().dr, W(), HD()))
  const blend = (to, previous) => {
    if (!previous || progress() >= 1) return to
    return previous.map(([x, y], i) => [x, y + (to[i][1] - y) * progress()])
  }
  const curveF = () => pathOf(blend(targetF(), from()?.f))
  const curveD = () => pathOf(blend(targetD(), from()?.d))

  function choose(next) {
    if (next === name()) return
    setFrom({ f: targetF(), d: targetD() })
    setName(next)
    setX0(functions[next].init)
    setLogDx(-3)
    cancelAnimationFrame(frame)
    const start = performance.now()
    setProgress(0)
    const step = (now) => {
      const t = Math.min(1, (now - start) / 320)
      setProgress(1 - Math.pow(1 - t, 3))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
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

  function pointer(event) {
    const rect = plot.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * W()
    const x = scale(W(), spec().xr, spec().yr, HF()).ix(px)
    setX0(Math.max(spec().x0[0], Math.min(spec().x0[1], x)))
  }
  let dragging = false

  const overlayOpacity = () => (progress() < 1 ? 0 : 1)

  return (
    <div ref={host} class="matrix-figure">
      <div class="matrix-controls">
        <span class="matrix-choices" role="group" aria-label="选择函数">
          <For each={Object.keys(functions)}>
            {(key) => (
              <button type="button" aria-pressed={String(name() === key)} onClick={() => choose(key)}>
                <MathText text={functions[key].label} />
              </button>
            )}
          </For>
        </span>
        <label>
          <MathText text="$x_0$" />
          <input
            type="range"
            min={spec().x0[0]}
            max={spec().x0[1]}
            step="0.01"
            value={x0()}
            onInput={(e) => setX0(+e.currentTarget.value)}
          />
          <span class="matrix-value">{x0().toFixed(2)}</span>
        </label>
        <label>
          <MathText text="$\Delta x$" />
          <input
            type="range"
            min="-3"
            max="0"
            step="0.01"
            value={logDx()}
            style="accent-color:var(--series-2)"
            onInput={(e) => setLogDx(+e.currentTarget.value)}
          />
          <span class="matrix-value">{dx().toFixed(3)}</span>
        </label>
      </div>
      <div class="matrix-plot">
        <svg
          ref={plot}
          viewBox={`0 0 ${W()} ${HF()}`}
          style="cursor:ew-resize"
          role="img"
          aria-label="函数图像、过两点的割线和切线"
          onPointerDown={(e) => {
            dragging = true
            plot.setPointerCapture(e.pointerId)
            pointer(e)
          }}
          onPointerMove={(e) => dragging && pointer(e)}
          onPointerUp={() => (dragging = false)}
          onPointerCancel={() => (dragging = false)}
        >
          <defs>
            <clipPath id={`${id}-f`}>
              <rect x={LEFT} y={TOP} width={W() - LEFT - RIGHT} height={HF() - TOP - BOTTOM} />
            </clipPath>
          </defs>
          <Grid spec={spec()} yr={spec().yr} width={W()} height={HF()} />
          <path d={curveF()} fill="none" stroke="var(--ink)" stroke-width="2" clip-path={`url(#${id}-f)`} />
          <g clip-path={`url(#${id}-f)`} style={{ opacity: overlayOpacity(), transition: 'opacity .25s' }}>
            <line {...geometry().tangentLine} stroke="var(--series-1)" stroke-width="2" />
            <line {...geometry().secantLine} stroke="var(--series-2)" stroke-width="2" stroke-dasharray="6 4" />
            <line x1={geometry().px0} y1={TOP} x2={geometry().px0} y2={HF() - BOTTOM} stroke="var(--ink-3)" stroke-dasharray="2 3" />
            <circle cx={geometry().p1[0]} cy={geometry().p1[1]} r="5" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" />
            <circle cx={geometry().px0} cy={geometry().py0} r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" />
          </g>
          <g style={{ opacity: overlayOpacity() }}>
            <SvgTex tex="x_0" size={13} x={geometry().px0 + 7} y={HF() - BOTTOM - 8} align="start" color="var(--ink-2)" />
          </g>
          <SvgTex tex="y = f(x)" size={13} x={W() - RIGHT - 6} y={TOP + 16} align="end" color="var(--ink-2)" backdrop />
        </svg>
      </div>
      <div class="matrix-readout" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:6px 0 4px">
        <div>
          <span style="color:var(--ink-2)">过两点的直线，斜率</span>{' '}
          <MathText text="$\dfrac{f(x_0+\Delta x)-f(x_0)}{\Delta x}$" /> = <b style="color:var(--series-2)">{geometry().secant.toFixed(3)}</b>
        </div>
        <div>
          <span style="color:var(--ink-2)">
            切线的斜率，即 <MathText text="$x_0$" /> 处的
          </span>{' '}
          <MathText text="$\dfrac{dy}{dx}$" /> = <b style="color:var(--series-1)">{geometry().tangent.toFixed(3)}</b>
        </div>
      </div>
      <div class="matrix-plot">
        <svg viewBox={`0 0 ${W()} ${HD()}`} role="img" aria-label="导数函数的图像">
          <defs>
            <clipPath id={`${id}-d`}>
              <rect x={LEFT} y={TOP} width={W() - LEFT - RIGHT} height={HD() - TOP - BOTTOM} />
            </clipPath>
          </defs>
          <Grid spec={spec()} yr={spec().dr} width={W()} height={HD()} />
          <path d={curveD()} fill="none" stroke="var(--series-1)" stroke-width="2" clip-path={`url(#${id}-d)`} />
          <g clip-path={`url(#${id}-d)`} style={{ opacity: overlayOpacity(), transition: 'opacity .25s' }}>
            <line x1={geometry().pd[0]} y1={TOP} x2={geometry().pd[0]} y2={HD() - BOTTOM} stroke="var(--ink-3)" stroke-dasharray="2 3" />
            <line x1={LEFT} y1={geometry().pd[1]} x2={geometry().pd[0]} y2={geometry().pd[1]} stroke="var(--ink-3)" stroke-dasharray="2 3" />
            <circle cx={geometry().pd[0]} cy={geometry().pd[1]} r="6" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" />
          </g>
          <SvgTex tex="\dfrac{dy}{dx}" size={13} x={W() - RIGHT - 6} y={TOP + 26} align="end" color="var(--ink-2)" backdrop />
        </svg>
      </div>
    </div>
  )
}
