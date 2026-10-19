import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { fn } from './lib/act/functions.js'
import { richNodes } from './lib/act/tex.js'
import './lib/act/act.css'
import './lib/act/heatmap.css'

export const params = {
  range: { label: '坐标范围 ±', type: 'number', min: 1, max: 10, step: 0.5, default: 4 },
  limit: { label: '色标范围 ±', type: 'number', min: 1, max: 50, step: 1, default: 8 },
}

export const layout = { width: 'body', height: 515, narrowHeight: { ratio: 0.99 } }

const CELLS = 160
const minus = (value) => String(value).replace('-', '−')

function rgb(context, color) {
  context.fillStyle = color
  const hex = context.fillStyle
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t))
const output = (g, u) => fn.silu.f(g) * u

export default function GluHeatmap(props) {
  let canvas
  const [tip, setTip] = createSignal(null)

  function draw() {
    const style = getComputedStyle(canvas)
    const context = canvas.getContext('2d')
    const low = rgb(context, style.getPropertyValue('--diverge-low').trim())
    const mid = rgb(context, style.getPropertyValue('--diverge-mid').trim())
    const high = rgb(context, style.getPropertyValue('--diverge-high').trim())
    const image = context.createImageData(CELLS, CELLS)
    const r = props.range
    for (let j = 0; j < CELLS; j++) {
      const u = r - (2 * r * j) / (CELLS - 1)
      for (let i = 0; i < CELLS; i++) {
        const g = -r + (2 * r * i) / (CELLS - 1)
        const v = Math.max(-1, Math.min(1, output(g, u) / props.limit))
        const c = v < 0 ? mix(mid, low, -v) : mix(mid, high, v)
        const k = (j * CELLS + i) * 4
        image.data.set([c[0], c[1], c[2], 255], k)
      }
    }
    context.putImageData(image, 0, 0)
  }

  createEffect(draw)

  onMount(() => {
    document.addEventListener('bake:theme', draw)
    onCleanup(() => document.removeEventListener('bake:theme', draw))
  })

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect()
    const r = props.range
    const g = -r + (2 * r * (event.clientX - rect.left)) / rect.width
    const u = r - (2 * r * (event.clientY - rect.top)) / rect.height
    const x = event.clientX - rect.left
    setTip({
      nodes: [
        ...richNodes('$g$ ' + g.toFixed(2) + ' $u$ ' + u.toFixed(2)),
        document.createElement('br'),
        ...richNodes('$\\mathrm{SiLU}(g)\\cdot u$ ' + output(g, u).toFixed(3)),
      ],
      top: event.clientY - rect.top + 14,
      left: x,
      flip: x > rect.width * 0.6,
    })
  }

  return (
    <div class="act-heat-figure">
      <div class="act-heat-title">SwiGLU 单个通道的输出 SiLU(g)·u</div>
      <div class="act-heat">
        <div class="act-heat-plot">
          <div class="act-heat-axis-title">{richNodes('线性分支 $u$')}</div>
          <div class="act-heat-image">
            <canvas
              ref={canvas}
              width={CELLS}
              height={CELLS}
              aria-label={`SwiGLU 通道输出热图，横轴 g 从 −${props.range} 到 ${props.range}，纵轴 u 从下到上为 −${props.range} 到 ${props.range}`}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setTip(null)}
            />
            <div class="act-heat-y-ticks">
              <span>{props.range}</span>
              <span>0</span>
              <span>{minus(-props.range)}</span>
            </div>
            <Show when={tip()}>
              {(t) => (
                <div
                  class="act-tip"
                  style={{
                    top: t().top + 'px',
                    left: (t().flip ? t().left - 12 : t().left + 12) + 'px',
                    transform: t().flip ? 'translateX(-100%)' : undefined,
                  }}
                >
                  {t().nodes}
                </div>
              )}
            </Show>
          </div>
          <div class="act-heat-x-ticks">
            <span>{minus(-props.range)}</span>
            <span>0</span>
            <span>{props.range}</span>
          </div>
          <div class="act-heat-x-label">{richNodes('门控分支 $g$')}</div>
        </div>
        <div class="act-heat-bar">
          <span class="act-heat-bar-max">+{props.limit}</span>
          <div class="act-heat-bar-scale" />
          <span class="act-heat-bar-min">{minus(-props.limit)}</span>
          <span class="act-heat-bar-title">{richNodes('$\\mathrm{SiLU}(g)\\cdot u$')}</span>
        </div>
      </div>
    </div>
  )
}
