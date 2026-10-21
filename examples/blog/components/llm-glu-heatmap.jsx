import { batch, createEffect, createResource, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { formatNumber } from 'bake/kit'
import { fn } from './lib/llm/functions.js'
import { richNodes, typesetAll } from './lib/llm/tex.js'
import { createPointerFrames, hideOnScroll, tipTransform } from './lib/llm/tip.js'
import './lib/llm/act.css'
import './lib/llm/heatmap.css'

export const params = {
  range: { label: '坐标范围 ±', type: 'number', min: 1, max: 10, step: 0.5, default: 4 },
  limit: { label: '色标范围 ±', type: 'number', min: 1, max: 50, step: 1, default: 8 },
}

export const layout = { width: 'body' }

const NAME = 'llm-glu-heatmap'
const CELLS = 160
const TIP_GAP = 12
const TIP_BELOW = 14
const FLIP_AT = 0.6
const G = '$g$'
const U = '$u$'
const OUTPUT = '$\\mathrm{SiLU}(g)\\cdot u$'
const U_TITLE = '线性分支 $u$'
const G_TITLE = '门控分支 $g$'

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
  const [ready] = createResource(() => typesetAll(NAME, [G, U, OUTPUT, U_TITLE, G_TITLE]))
  const [point, setPoint] = createSignal({ g: 0, u: 0, left: 0, top: 0, flip: false })
  const [tracking, setTracking] = createSignal(false)

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
        image.data[k] = c[0]
        image.data[k + 1] = c[1]
        image.data[k + 2] = c[2]
        image.data[k + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  }

  createEffect(draw)

  onMount(() => {
    document.addEventListener('bake:theme', draw)
    onCleanup(() => document.removeEventListener('bake:theme', draw))
  })

  function follow(event) {
    const rect = canvas.getBoundingClientRect()
    const r = props.range
    const left = event.clientX - rect.left
    const top = event.clientY - rect.top
    const next = {
      g: -r + (2 * r * left) / rect.width,
      u: r - (2 * r * top) / rect.height,
      left: event.clientX,
      top: event.clientY,
      flip: left > rect.width * FLIP_AT,
    }
    batch(() => {
      setPoint(next)
      setTracking(true)
    })
  }

  const pointerFrames = createPointerFrames(follow)
  const stopTracking = () => {
    pointerFrames.cancel()
    setTracking(false)
  }
  hideOnScroll(tracking, stopTracking)

  const tipPosition = () => {
    const { left, top, flip } = point()
    return tipTransform(left + (flip ? -TIP_GAP : TIP_GAP), top + TIP_BELOW, flip)
  }

  return (
    <div class="llm-heat-figure">
      <div class="llm-heat-title">SwiGLU 单个通道的输出 SiLU(g)·u</div>
      <div class="llm-heat">
        <div class="llm-heat-plot">
          <div class="llm-heat-axis-title">
            <Show when={ready()}>{richNodes(U_TITLE)}</Show>
          </div>
          <div class="llm-heat-image">
            <canvas
              ref={canvas}
              width={CELLS}
              height={CELLS}
              aria-label={`SwiGLU 通道输出热图，横轴 g 从 −${props.range} 到 ${props.range}，纵轴 u 从下到上为 −${props.range} 到 ${props.range}`}
              onPointerMove={pointerFrames.track}
              onPointerDown={pointerFrames.track}
              onPointerLeave={stopTracking}
              onPointerCancel={stopTracking}
            />
            <div class="llm-heat-y-ticks">
              <span>{props.range}</span>
              <span>0</span>
              <span>{minus(-props.range)}</span>
            </div>
            <Show when={ready()}>
              <Portal>
                <div class="llm-tip llm-fade" classList={{ 'llm-shown': tracking() }} style={{ transform: tipPosition() }} aria-hidden="true">
                  {richNodes(G)} {formatNumber(point().g, 2)} {richNodes(U)} {formatNumber(point().u, 2)}
                  <br />
                  {richNodes(OUTPUT)} {formatNumber(output(point().g, point().u), 3)}
                </div>
              </Portal>
            </Show>
          </div>
          <div class="llm-heat-x-ticks">
            <span>{minus(-props.range)}</span>
            <span>0</span>
            <span>{props.range}</span>
          </div>
          <div class="llm-heat-x-label">
            <Show when={ready()}>{richNodes(G_TITLE)}</Show>
          </div>
        </div>
        <div class="llm-heat-bar">
          <span class="llm-heat-bar-max">+{props.limit}</span>
          <div class="llm-heat-bar-scale" />
          <span class="llm-heat-bar-min">{minus(-props.limit)}</span>
          <span class="llm-heat-bar-title">
            <Show when={ready()}>{richNodes(OUTPUT)}</Show>
          </span>
        </div>
      </div>
    </div>
  )
}
