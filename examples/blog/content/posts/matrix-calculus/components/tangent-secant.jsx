import { createSignal } from 'solid-js'
import { Axes, Controls, Curve, MathText, Plot, Segmented, Slider, SvgTex, Tex, createElementSize, formatNumber, usePlot } from 'bake/kit'
import { fn } from '../../../../components/lib/activations.js'
import { fadeIn } from './lib/view.jsx'

export const params = {
  fn: { label: '函数', type: 'enum', options: ['cube', 'sin', 'ln', 'swish'], default: 'cube' },
}
export const layout = { width: 'body' }

const functions = {
  cube: { label: 'x^3', f: (x) => x * x * x, d: (x) => 3 * x * x, xr: [-2, 2], yr: [-8, 8], dr: [-1, 12], x0: [-1.9, 1], init: 1 },
  sin: { label: '\\sin x', f: Math.sin, d: Math.cos, xr: [-6.5, 6.5], yr: [-1.6, 1.6], dr: [-1.5, 1.5], x0: [-6.3, 5.5], init: 1 },
  ln: { label: '\\ln x', f: Math.log, d: (x) => 1 / x, xr: [0, 6], yr: [-3, 2.2], dr: [-0.3, 5], x0: [0.15, 5], init: 1 },
  swish: { label: '\\mathrm{Swish}(x)', f: fn.silu.f, d: fn.silu.d, xr: [-6, 6], yr: [-1.2, 6], dr: [-0.2, 1.2], x0: [-5.8, 5], init: 1 },
}
const NARROW_BELOW = 560
const MARGIN = { right: 14 }
const label = (color) => ({ 'font-size': '13px', color })

function Line(props) {
  const plot = usePlot()
  const ends = () => {
    const [a, b] = plot.xDomain()
    const y = (x) => props.y + (x - props.x) * props.slope
    return { x1: plot.x()(2 * a - b), y1: plot.y()(y(2 * a - b)), x2: plot.x()(2 * b - a), y2: plot.y()(y(2 * b - a)) }
  }
  return <line {...ends()} stroke={props.color} stroke-width="2" stroke-dasharray={props.dashed ? '6 4' : undefined} />
}

function Secant(props) {
  const plot = usePlot()
  const y0 = () => props.spec.f(props.x0)
  const x1 = () => props.x0 + props.dx
  const move = (event) => {
    const svg = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    const [low, high] = props.spec.x0
    props.onX(Math.max(low, Math.min(high, plot.x().invert(event.clientX - svg.left))))
  }
  return (
    <>
      <g clip-path={`url(#${plot.clipId})`}>
        <Line x={props.x0} y={y0()} slope={props.spec.d(props.x0)} color="var(--series-1)" />
        <Line x={props.x0} y={y0()} slope={(props.spec.f(x1()) - y0()) / props.dx} color="var(--series-2)" dashed />
        <line x1={plot.x()(props.x0)} y1={plot.area().top} x2={plot.x()(props.x0)} y2={plot.area().bottom} stroke="var(--ink-3)" stroke-dasharray="2 3" />
        <circle cx={plot.x()(x1())} cy={plot.y()(props.spec.f(x1()))} r="5" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" />
        <circle cx={plot.x()(props.x0)} cy={plot.y()(y0())} r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" />
      </g>
      <SvgTex tex="x_0" x={plot.x()(props.x0) + 7} y={plot.area().bottom - 8} baseline="baseline" style={label('var(--ink-2)')} />
      <SvgTex tex="y = f(x)" class="matrix-backdrop" x={plot.area().right - 6} y={plot.area().top + 16} anchor="end" baseline="baseline" style={label('var(--ink-2)')} />
      <rect
        x={plot.area().left}
        y={plot.area().top}
        width={plot.area().right - plot.area().left}
        height={plot.area().bottom - plot.area().top}
        fill="transparent"
        style="cursor:ew-resize;touch-action:none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event)
        }}
        onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && move(event)}
      />
    </>
  )
}

function Derivative(props) {
  const plot = usePlot()
  const point = () => [plot.x()(props.x0), plot.y()(props.spec.d(props.x0))]
  return (
    <>
      <g clip-path={`url(#${plot.clipId})`}>
        <line x1={point()[0]} y1={plot.area().top} x2={point()[0]} y2={plot.area().bottom} stroke="var(--ink-3)" stroke-dasharray="2 3" />
        <line x1={plot.area().left} y1={point()[1]} x2={point()[0]} y2={point()[1]} stroke="var(--ink-3)" stroke-dasharray="2 3" />
        <circle cx={point()[0]} cy={point()[1]} r="6" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" />
      </g>
      <SvgTex tex="\dfrac{dy}{dx}" class="matrix-backdrop" x={plot.area().right - 6} y={plot.area().top + 26} anchor="end" baseline="baseline" style={label('var(--ink-2)')} />
    </>
  )
}

export default function TangentSecantPlot(props) {
  let host
  let plots
  const size = createElementSize(() => host)
  const narrow = () => size().width < NARROW_BELOW
  const [name, setName] = createSignal(props.fn)
  const [x0, setX0] = createSignal(functions[props.fn].init)
  const [logDx, setLogDx] = createSignal(-3)
  const options = Object.keys(functions).map((key) => ({ value: key, label: <Tex tex={functions[key].label} /> }))

  const spec = () => functions[name()]
  const dx = () => Math.pow(10, logDx())
  const secant = () => (spec().f(x0() + dx()) - spec().f(x0())) / dx()

  function choose(next) {
    if (next === name()) return
    setName(next)
    setX0(functions[next].init)
    setLogDx(-3)
    fadeIn(plots)
  }

  return (
    <div ref={host} class="matrix-figure">
      <Controls>
        <Segmented label="选择函数" options={options} value={name()} onChange={choose} />
        <Slider label={<Tex tex="x_0" />} min={spec().x0[0]} max={spec().x0[1]} step={0.01} value={x0()} onInput={setX0} />
        <span class="matrix-dx-slider">
          <Slider label={<Tex tex="\Delta x" />} min={-3} max={0} step={0.01} value={logDx()} format={(value) => formatNumber(Math.pow(10, value), 3)} onInput={setLogDx} />
        </span>
      </Controls>
      <div ref={plots}>
        <Plot height={narrow() ? 240 : 300} margin={MARGIN} x={spec().xr} y={spec().yr} label="函数图像、过两点的割线和切线">
          <Axes />
          <Curve f={spec().f} color="var(--ink)" />
          <Secant spec={spec()} x0={x0()} dx={dx()} onX={setX0} />
        </Plot>
        <div class="matrix-readout" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:6px 0 4px">
          <div>
            <span style="color:var(--ink-2)">过两点的直线，斜率</span> <MathText text="$\dfrac{f(x_0+\Delta x)-f(x_0)}{\Delta x}$" /> ={' '}
            <b style="color:var(--series-2)">{formatNumber(secant(), 3)}</b>
          </div>
          <div>
            <span style="color:var(--ink-2)">
              切线的斜率，即 <MathText text="$x_0$" /> 处的
            </span>{' '}
            <MathText text="$\dfrac{dy}{dx}$" /> = <b style="color:var(--series-1)">{formatNumber(spec().d(x0()), 3)}</b>
          </div>
        </div>
        <Plot height={narrow() ? 140 : 170} margin={MARGIN} x={spec().xr} y={spec().dr} label="导数函数的图像">
          <Axes />
          <Curve f={spec().d} color="var(--series-1)" />
          <Derivative spec={spec()} x0={x0()} />
        </Plot>
      </div>
    </div>
  )
}
