import { For, createSignal } from 'solid-js'
import { Button, Controls, Segmented, Slider, Tex, createTween } from 'bake/kit'
import { MathText, SvgTex } from './lib/matrix/view.jsx'

export const params = {
  t: { label: 'query 的位置 t', type: 'number', min: 0, max: 20, step: 1, default: 3 },
  s: { label: 'key 的位置 s', type: 'number', min: 0, max: 20, step: 1, default: 1 },
  pair: { label: '分量对', type: 'number', min: 1, max: 4, step: 1, default: 1 },
}
export const layout = { width: 'body', height: 410, narrowHeight: 640 }

const CENTER = 160
const UNIT = 120
const Q = [0.85, 0.25]
const K = [0.3, 0.7]
const THETAS = [1, 0.1, 0.01, 0.001]
const TAU = 2 * Math.PI
const wrap = (a) => ((a % TAU) + TAU) % TAU
const rotate = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
const toPixel = (v) => [CENTER + v[0] * UNIT, CENTER - v[1] * UNIT]

function arcPath(r, start, delta) {
  if (Math.abs(delta) < 1e-3) return ''
  const p0 = [CENTER + r * Math.cos(start), CENTER - r * Math.sin(start)]
  const p1 = [CENTER + r * Math.cos(start + delta), CENTER - r * Math.sin(start + delta)]
  return `M${p0[0]},${p0[1]} A${r},${r} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta > 0 ? 0 : 1} ${p1[0]},${p1[1]}`
}

const PAIRS = [0, 1, 2, 3].map((k) => ({ value: String(k), label: `第 ${k + 1} 对` }))

let figureCount = 0

export default function RopeRotationPlot(props) {
  const id = `matrix-rope-${++figureCount}`
  const [t, setT] = createSignal(props.t)
  const [s, setS] = createSignal(props.s)
  const [pair, setPair] = createSignal(props.pair - 1)
  const theta = () => THETAS[pair()]
  const queryAngle = createTween(() => t() * theta(), { duration: 150 })
  const keyAngle = createTween(() => s() * theta(), { duration: 150 })
  const qr = () => rotate(Q, queryAngle())
  const kr = () => rotate(K, keyAngle())
  const moved = (a) => {
    const n = wrap(a)
    return n > 0.35 && n < TAU - 0.35
  }
  const labelAt = (v) => {
    const r = Math.hypot(v[0], v[1])
    return toPixel([v[0] * (1 + 0.2 / r), v[1] * (1 + 0.2 / r)])
  }
  const angleBetween = () => {
    const a1 = Math.atan2(kr()[1], kr()[0])
    const a2 = Math.atan2(qr()[1], qr()[0])
    return arcPath(26, a1, Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
  }
  const vector = (v, color, rotated) => {
    const [x, y] = toPixel(v)
    return (
      <line
        x1={CENTER}
        y1={CENTER}
        x2={x}
        y2={y}
        stroke={`var(--${color})`}
        stroke-width={rotated ? 2.2 : 1.5}
        stroke-dasharray={rotated ? undefined : '4 3'}
        opacity={rotated ? 1 : 0.6}
        marker-end={rotated ? `url(#${id}-${color})` : undefined}
      />
    )
  }
  const reset = () => {
    setT(3)
    setS(1)
    setPair(0)
  }
  return (
    <div class="matrix-figure">
      <Controls>
        <Segmented label="选择分量对" options={PAIRS} value={String(pair())} onChange={(value) => setPair(Number(value))} />
      </Controls>
      <Controls>
        <Slider label={<Tex tex="t" />} min={0} max={20} value={t()} onInput={setT} />
        <Slider label={<Tex tex="s" />} min={0} max={20} value={s()} onInput={setS} />
        <span class="matrix-actions">
          <Button disabled={t() >= 20 || s() >= 20} onClick={() => (setT(t() + 1), setS(s() + 1))}>
            <MathText text="$t$ 和 $s$ 同时加 1" />
          </Button>
          <Button disabled={t() <= 0 || s() <= 0} onClick={() => (setT(t() - 1), setS(s() - 1))}>
            同时减 1
          </Button>
          <Button onClick={reset}>重置</Button>
        </span>
      </Controls>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:10px 22px;align-items:center">
        <div class="matrix-plot" style="max-width:320px;width:100%;justify-self:center">
          <svg viewBox="0 0 320 320" role="img" aria-label="一对分量的 query 和 key 向量，旋转前后的位置">
            <defs>
              <For each={['series-1', 'series-2']}>
                {(color) => (
                  <marker id={`${id}-${color}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L10,5 L0,10 z" fill={`var(--${color})`} />
                  </marker>
                )}
              </For>
            </defs>
            <circle cx={CENTER} cy={CENTER} r={UNIT} fill="none" stroke="var(--grid)" />
            <line x1={CENTER - UNIT - 14} y1={CENTER} x2={CENTER + UNIT + 14} y2={CENTER} stroke="var(--axis)" />
            <line x1={CENTER} y1={CENTER - UNIT - 14} x2={CENTER} y2={CENTER + UNIT + 14} stroke="var(--axis)" />
            <path d={arcPath(Math.hypot(...Q) * UNIT, Math.atan2(Q[1], Q[0]), wrap(queryAngle()))} fill="none" stroke="var(--series-1)" stroke-width="1.2" stroke-dasharray="2 3" />
            <path d={arcPath(Math.hypot(...K) * UNIT, Math.atan2(K[1], K[0]), wrap(keyAngle()))} fill="none" stroke="var(--series-2)" stroke-width="1.2" stroke-dasharray="2 3" />
            {vector(Q, 'series-1', false)}
            {vector(K, 'series-2', false)}
            <path d={angleBetween()} fill="none" stroke="var(--ink-3)" stroke-width="1.2" />
            {vector(qr(), 'series-1', true)}
            {vector(kr(), 'series-2', true)}
            <g class="matrix-fade" style={{ opacity: moved(t() * theta()) ? 1 : 0 }}>
              <SvgTex tex="\mathbf{q}" size={15} x={labelAt(Q)[0]} y={labelAt(Q)[1] + 5} color="var(--series-1)" />
            </g>
            <g class="matrix-fade" style={{ opacity: moved(s() * theta()) ? 1 : 0 }}>
              <SvgTex tex="\mathbf{k}" size={15} x={labelAt(K)[0]} y={labelAt(K)[1] + 5} color="var(--series-2)" />
            </g>
            <SvgTex tex="\mathbf{q}R_t" size={15} x={labelAt(qr())[0]} y={labelAt(qr())[1] + 5} color="var(--series-1)" />
            <SvgTex tex="\mathbf{k}R_s" size={15} x={labelAt(kr())[0]} y={labelAt(kr())[1] + 5} color="var(--series-2)" />
          </svg>
        </div>
        <div class="matrix-readout" style="grid-template-columns:auto auto;gap:6px 16px;justify-content:start">
          <span>这一对的 <MathText text="$\theta_k$" /></span>
          <b>{theta()}</b>
          <span style="color:var(--series-1)">query 转过的角度 <MathText text="$t\theta_k$" /></span>
          <b style="color:var(--series-1)">{(t() * theta()).toFixed(3)}</b>
          <span style="color:var(--series-2)">key 转过的角度 <MathText text="$s\theta_k$" /></span>
          <b style="color:var(--series-2)">{(s() * theta()).toFixed(3)}</b>
          <span>位置差 <MathText text="$t - s$" /></span>
          <b>{t() - s()}</b>
          <span>旋转前的点积 <MathText text="$\mathbf{q}\mathbf{k}^{T}$" /></span>
          <b>{(Q[0] * K[0] + Q[1] * K[1]).toFixed(3)}</b>
          <span>旋转后的点积 <MathText text="$(\mathbf{q}R_t)(\mathbf{k}R_s)^{T}$" /></span>
          <b>{(qr()[0] * kr()[0] + qr()[1] * kr()[1]).toFixed(3)}</b>
        </div>
      </div>
    </div>
  )
}
