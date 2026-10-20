import { For, createSignal, onCleanup, onMount } from 'solid-js'
import { Controls, Slider, Tex, formatNumber } from 'bake/kit'
import { MathText, SvgTex } from './lib/matrix/view.jsx'

export const params = {
  x0: { label: 'x₀', type: 'number', min: -2, max: 2, step: 0.01, default: 1.2 },
  y0: { label: 'y₀', type: 'number', min: -2, max: 2, step: 0.01, default: 0.8 },
}
export const layout = { width: 'body', height: 430, narrowHeight: 730, autoHeight: true }

const f = (x, y) => 3 * x * x * y
const fx = (x, y) => 6 * x * y
const fy = (x) => 3 * x * x
const XR = [-2, 2]
const FR = [-24, 24]
const ARROW_SCALE = 0.1
const TICKS = [-2, -1, 0, 1, 2]
const VALUE_TICKS = [-24, -12, 0, 12, 24]

const FW = 300
const VW = 348
const FL = 34
const FRIGHT = 10
const FT = 10
const FB = 26
const fieldX = (x) => FL + ((x - XR[0]) / (XR[1] - XR[0])) * (FW - FL - FRIGHT)
const fieldY = (y) => FT + ((XR[1] - y) / (XR[1] - XR[0])) * (FW - FT - FB)
const fromFieldX = (px) => XR[0] + ((px - FL) / (FW - FL - FRIGHT)) * (XR[1] - XR[0])
const fromFieldY = (py) => XR[1] - ((py - FT) / (FW - FT - FB)) * (XR[1] - XR[0])
const barY = (v) => FT + ((FR[1] - v) / (FR[1] - FR[0])) * (FW - FT - FB)
const CBX = FW + 4
const CBW = 10

const SW = 460
const SH = 140
const SL = 40
const SR = 12
const ST = 10
const SB = 22
const sliceX = (x) => SL + ((x - XR[0]) / (XR[1] - XR[0])) * (SW - SL - SR)
const sliceY = (v) => ST + ((FR[1] - v) / (FR[1] - FR[0])) * (SH - ST - SB)

const format = (v) => formatNumber(Math.abs(v) < 5e-4 ? 0 : v, 3)

function contour(c, side) {
  if (Math.abs(c) < 1e-6) return `M${FL},${fieldY(0)} L${FW - FRIGHT},${fieldY(0)}`
  const points = []
  for (let i = 0; i <= 200; i++) {
    const x = side * (0.05 + (1.95 * i) / 200)
    const y = c / (3 * x * x)
    if (Math.abs(y) <= 2.5) points.push(fieldX(x).toFixed(1) + ',' + fieldY(y).toFixed(1))
  }
  return points.length > 1 ? 'M' + points.join(' L') : ''
}

function heatmap(element) {
  const style = getComputedStyle(element)
  const rgb = (name) => {
    const match = style.getPropertyValue(name).trim().match(/^#([0-9a-f]{6})$/i)
    return match ? [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16)) : [128, 128, 128]
  }
  const low = rgb('--diverge-low')
  const mid = rgb('--diverge-mid')
  const high = rgb('--diverge-high')
  const N = 96
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = N
  const context = canvas.getContext('2d')
  const image = context.createImageData(N, N)
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = XR[0] + ((i + 0.5) / N) * (XR[1] - XR[0])
      const y = XR[1] - ((j + 0.5) / N) * (XR[1] - XR[0])
      const t = Math.max(-1, Math.min(1, f(x, y) / FR[1]))
      const end = t < 0 ? low : high
      const offset = (j * N + i) * 4
      for (let c = 0; c < 3; c++) image.data[offset + c] = Math.round(mid[c] + (end[c] - mid[c]) * Math.abs(t))
      image.data[offset + 3] = 255
    }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

let figureCount = 0

function Slice(props) {
  const curve = () => {
    const out = []
    for (let i = 0; i <= 120; i++) {
      const v = XR[0] + ((XR[1] - XR[0]) * i) / 120
      out.push((i ? 'L' : 'M') + sliceX(v).toFixed(1) + ',' + sliceY(props.fn(v)).toFixed(1))
    }
    return out.join(' ')
  }
  const tangent = () => {
    const px = sliceX(props.at)
    const py = sliceY(props.fn(props.at))
    const m = (-props.slope * ((SH - ST - SB) / (FR[1] - FR[0]))) / ((SW - SL - SR) / (XR[1] - XR[0]))
    return { px, py, x1: px - 500, y1: py - 500 * m, x2: px + 500, y2: py + 500 * m }
  }
  return (
    <div class="matrix-plot">
      <svg viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={props.label}>
        <defs>
          <clipPath id={props.id}>
            <rect x={SL} y={ST} width={SW - SL - SR} height={SH - ST - SB} />
          </clipPath>
        </defs>
        <For each={TICKS}>
          {(v) => (
            <>
              <line x1={sliceX(v)} y1={ST} x2={sliceX(v)} y2={SH - SB} stroke="var(--grid)" />
              <text x={sliceX(v)} y={SH - 6} text-anchor="middle">{v}</text>
            </>
          )}
        </For>
        <For each={VALUE_TICKS}>
          {(v) => (
            <>
              <line x1={SL} y1={sliceY(v)} x2={SW - SR} y2={sliceY(v)} stroke="var(--grid)" />
              <text x={SL - 6} y={sliceY(v) + 4} text-anchor="end">{v}</text>
            </>
          )}
        </For>
        <line x1={SL} y1={sliceY(0)} x2={SW - SR} y2={sliceY(0)} stroke="var(--axis)" />
        <line x1={sliceX(0)} y1={ST} x2={sliceX(0)} y2={SH - SB} stroke="var(--axis)" />
        <path d={curve()} fill="none" stroke="var(--ink)" stroke-width="2" clip-path={`url(#${props.id})`} />
        <g clip-path={`url(#${props.id})`}>
          <line x1={tangent().x1} y1={tangent().y1} x2={tangent().x2} y2={tangent().y2} stroke={props.color} stroke-width="2" />
          <line x1={tangent().px} y1={ST} x2={tangent().px} y2={SH - SB} stroke="var(--ink-3)" stroke-dasharray="2 3" />
          <circle cx={tangent().px} cy={tangent().py} r="5" fill={props.color} stroke="var(--surface)" stroke-width="2" />
        </g>
        <SvgTex tex={props.title} size={12.5} x={SW - SR - 4} y={ST + 14} align="end" />
        <SvgTex tex={props.variable} size={12.5} x={SW - SR - 4} y={sliceY(0) + 15} align="end" color="var(--ink-2)" />
      </svg>
    </div>
  )
}

export default function PartialGradientField(props) {
  let host
  let field
  const id = `matrix-gradient-${++figureCount}`
  const [x0, setX0] = createSignal(props.x0)
  const [y0, setY0] = createSignal(props.y0)
  const [image, setImage] = createSignal('')
  onMount(() => {
    const paint = () => setImage(heatmap(host))
    paint()
    document.addEventListener('bake:theme', paint)
    onCleanup(() => document.removeEventListener('bake:theme', paint))
  })
  const px = () => fx(x0(), y0())
  const py = () => fy(x0())
  const ends = () => ({ ex: x0() + ARROW_SCALE * px(), ey: y0() + ARROW_SCALE * py(), p0: `${fieldX(x0())},${fieldY(y0())}` })
  let bounds = null
  function pointer(event) {
    const vx = ((event.clientX - bounds.left) / bounds.width) * VW
    const vy = ((event.clientY - bounds.top) / bounds.height) * FW
    setX0(Math.max(XR[0], Math.min(XR[1], fromFieldX(vx))))
    setY0(Math.max(XR[0], Math.min(XR[1], fromFieldY(vy))))
  }
  const marker = (name, color) => (
    <marker id={`${id}-${name}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill={color} />
    </marker>
  )
  return (
    <div ref={host} class="matrix-figure matrix-gradient">
      <Controls>
        <Slider label={<Tex tex="x_0" />} min={-2} max={2} step={0.01} value={x0()} onInput={setX0} />
        <Slider label={<Tex tex="y_0" />} min={-2} max={2} step={0.01} value={y0()} onInput={setY0} />
      </Controls>
      <div class="matrix-gradient-stage">
        <div class="matrix-plot matrix-gradient-field">
          <svg
            ref={field}
            viewBox={`0 0 ${VW} ${FW}`}
            style="cursor:move"
            role="img"
            aria-label="f(x,y) 的取值和等值线、当前位置、两个偏导数和梯度"
            onPointerDown={(e) => {
              bounds = field.getBoundingClientRect()
              field.setPointerCapture(e.pointerId)
              pointer(e)
            }}
            onPointerMove={(e) => bounds && pointer(e)}
            onPointerUp={() => (bounds = null)}
            onPointerCancel={() => (bounds = null)}
          >
            <defs>
              {marker('gradient', 'var(--series-7)')}
              {marker('x', 'var(--series-3)')}
              {marker('y', 'var(--series-5)')}
              <clipPath id={`${id}-clip`}>
                <rect x={FL} y={FT} width={FW - FL - FRIGHT} height={FW - FT - FB} />
              </clipPath>
              <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style="stop-color:var(--diverge-high)" />
                <stop offset="0.5" style="stop-color:var(--diverge-mid)" />
                <stop offset="1" style="stop-color:var(--diverge-low)" />
              </linearGradient>
            </defs>
            <image x={FL} y={FT} width={FW - FL - FRIGHT} height={FW - FT - FB} preserveAspectRatio="none" style="opacity:.55" href={image()} />
            <For each={TICKS}>
              {(v) => (
                <>
                  <line x1={fieldX(v)} y1={FT} x2={fieldX(v)} y2={FW - FB} stroke="var(--grid)" />
                  <line x1={FL} y1={fieldY(v)} x2={FW - FRIGHT} y2={fieldY(v)} stroke="var(--grid)" />
                  <text x={fieldX(v)} y={FW - 8} text-anchor="middle">{v}</text>
                  <text x={FL - 6} y={fieldY(v) + 4} text-anchor="end">{v}</text>
                </>
              )}
            </For>
            <line x1={fieldX(0)} y1={FT} x2={fieldX(0)} y2={FW - FB} stroke="var(--axis)" />
            <line x1={FL} y1={fieldY(0)} x2={FW - FRIGHT} y2={fieldY(0)} stroke="var(--axis)" />
            <SvgTex tex="x" size={13} x={FW - FRIGHT - 5} y={fieldY(0) + 15} align="end" color="var(--ink-2)" />
            <SvgTex tex="y" size={13} x={fieldX(0) + 6} y={FT + 14} align="start" color="var(--ink-2)" />
            <rect x={CBX} y={FT} width={CBW} height={FW - FT - FB} fill={`url(#${id}-bar)`} style="opacity:.55" />
            <rect x={CBX} y={FT} width={CBW} height={FW - FT - FB} fill="none" stroke="var(--line-2)" />
            <For each={VALUE_TICKS}>
              {(v) => (
                <>
                  <line x1={CBX + CBW} y1={barY(v)} x2={CBX + CBW + 3} y2={barY(v)} stroke="var(--axis)" />
                  <text x={CBX + CBW + 6} y={barY(v) + 4} text-anchor="start">{v}</text>
                </>
              )}
            </For>
            <g clip-path={`url(#${id}-clip)`}>
              <line x1={FL} y1={fieldY(y0())} x2={FW - FRIGHT} y2={fieldY(y0())} stroke="var(--series-3)" stroke-width="1.5" stroke-dasharray="5 4" />
              <line x1={fieldX(x0())} y1={FT} x2={fieldX(x0())} y2={FW - FB} stroke="var(--series-5)" stroke-width="1.5" stroke-dasharray="5 4" />
              {Math.abs(x0()) > 0.05 && <path d={contour(f(x0(), y0()), Math.sign(x0()))} fill="none" stroke="var(--ink)" stroke-width="1.4" />}
              <path
                d={`M${fieldX(ends().ex)},${fieldY(y0())} L${fieldX(ends().ex)},${fieldY(ends().ey)} L${fieldX(x0())},${fieldY(ends().ey)}`}
                fill="none"
                stroke="var(--ink-3)"
                stroke-dasharray="3 3"
              />
              {Math.abs(px()) > 1e-3 && (
                <path d={`M${ends().p0} L${fieldX(ends().ex)},${fieldY(y0())}`} fill="none" stroke="var(--series-3)" stroke-width="2.2" marker-end={`url(#${id}-x)`} />
              )}
              {Math.abs(py()) > 1e-3 && (
                <path d={`M${ends().p0} L${fieldX(x0())},${fieldY(ends().ey)}`} fill="none" stroke="var(--series-5)" stroke-width="2.2" marker-end={`url(#${id}-y)`} />
              )}
              {Math.hypot(px(), py()) > 1e-3 && (
                <path
                  d={`M${ends().p0} L${fieldX(ends().ex)},${fieldY(ends().ey)}`}
                  fill="none"
                  stroke="var(--series-7)"
                  stroke-width="2.5"
                  marker-end={`url(#${id}-gradient)`}
                />
              )}
              <circle cx={fieldX(x0())} cy={fieldY(y0())} r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" />
            </g>
          </svg>
        </div>
        <div class="matrix-gradient-slices">
          <Slice id={`${id}-sx`} label="固定 y，只动 x 的剖面曲线和切线" fn={(x) => f(x, y0())} at={x0()} slope={px()} color="var(--series-3)" title="f(x,\,y_0)" variable="x" />
          <Slice id={`${id}-sy`} label="固定 x，只动 y 的剖面曲线和切线" fn={(y) => f(x0(), y)} at={y0()} slope={py()} color="var(--series-5)" title="f(x_0,\,y)" variable="y" />
        </div>
      </div>
      <div class="matrix-readout" style="grid-template-columns:repeat(auto-fit,minmax(170px,auto));justify-content:start;gap:8px 24px;margin:8px 0 4px">
        <div>
          <MathText text="$\dfrac{\partial f}{\partial x} = 6x_0y_0$" /> = <b style="color:var(--series-3)">{format(px())}</b>
        </div>
        <div>
          <MathText text="$\dfrac{\partial f}{\partial y} = 3x_0^2$" /> = <b style="color:var(--series-5)">{format(py())}</b>
        </div>
        <div>
          <MathText text="$\nabla f$" /> = [<b style="color:var(--series-7)">{format(px())}</b>&nbsp; <b style="color:var(--series-7)">{format(py())}</b>]
        </div>
      </div>
    </div>
  )
}
