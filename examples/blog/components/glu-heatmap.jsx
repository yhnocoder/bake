import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { MathText, Tex, divergingColors, formatNumber } from 'bake/kit'
import { fn } from './lib/activations.js'
import './lib/glu-heatmap.css'

export const params = {
  range: { label: '坐标范围 ±', type: 'number', min: 1, max: 10, step: 0.5, default: 4 },
  limit: { label: '色标范围 ±', type: 'number', min: 1, max: 50, step: 1, default: 8 },
}

export const layout = { width: 'body', placeholder: { narrow: 299, wide: 513 } }

const CELLS = 160
const READOUT_GAP = 12

const minus = (value) => String(value).replace('-', '−')
const output = (g, u) => fn.silu.f(g) * u

export default function GluHeatmap(props) {
  let canvas
  let readout
  const [point, setPoint] = createSignal(null)

  function draw() {
    const color = divergingColors(canvas)
    const context = canvas.getContext('2d')
    const image = context.createImageData(CELLS, CELLS)
    const r = props.range
    for (let j = 0; j < CELLS; j++) {
      const u = r - (2 * r * j) / (CELLS - 1)
      for (let i = 0; i < CELLS; i++) {
        const g = -r + (2 * r * i) / (CELLS - 1)
        const k = (j * CELLS + i) * 4
        image.data.set([...color(output(g, u) / props.limit), 255], k)
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
    const left = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const top = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    setPoint({ g: -r + (2 * r * left) / rect.width, u: r - (2 * r * top) / rect.height, left, top, width: rect.width, height: rect.height })
  }

  const readoutPosition = () => {
    const { left, top, width, height } = point()
    const box = { width: readout?.offsetWidth ?? 0, height: readout?.offsetHeight ?? 0 }
    const x = left + READOUT_GAP + box.width > width ? left - READOUT_GAP - box.width : left + READOUT_GAP
    const y = top + READOUT_GAP + box.height > height ? top - READOUT_GAP - box.height : top + READOUT_GAP
    return { left: `${Math.max(0, x)}px`, top: `${Math.max(0, y)}px` }
  }

  return (
    <div class="glu-heat-figure">
      <div class="glu-heat-title">SwiGLU 单个通道的输出 SiLU(g)·u</div>
      <div class="glu-heat">
        <div class="glu-heat-plot">
          <div class="glu-heat-axis-title">
            <MathText text="线性分支 $u$" />
          </div>
          <div class="glu-heat-image">
            <canvas
              ref={canvas}
              width={CELLS}
              height={CELLS}
              role="img"
              aria-label={`SwiGLU 通道输出热图，横轴 g 从 −${props.range} 到 ${props.range}，纵轴 u 从下到上为 −${props.range} 到 ${props.range}`}
              onPointerMove={follow}
              onPointerDown={follow}
              onPointerLeave={() => setPoint(null)}
              onPointerCancel={() => setPoint(null)}
            />
            <div class="glu-heat-y-ticks">
              <span>{props.range}</span>
              <span>0</span>
              <span>{minus(-props.range)}</span>
            </div>
            <div ref={readout} class="glu-heat-readout" classList={{ 'glu-heat-shown': point() !== null }} style={point() === null ? undefined : readoutPosition()} aria-hidden="true">
              <i>g</i> {formatNumber(point()?.g ?? 0, 2)} <i>u</i> {formatNumber(point()?.u ?? 0, 2)}
              <br />
              SiLU(<i>g</i>)·<i>u</i> {formatNumber(point() === null ? 0 : output(point().g, point().u), 3)}
            </div>
          </div>
          <div class="glu-heat-x-ticks">
            <span>{minus(-props.range)}</span>
            <span>0</span>
            <span>{props.range}</span>
          </div>
          <div class="glu-heat-x-label">
            <MathText text="门控分支 $g$" />
          </div>
        </div>
        <div class="glu-heat-bar">
          <span class="glu-heat-bar-max">+{props.limit}</span>
          <div class="glu-heat-bar-scale" />
          <span class="glu-heat-bar-min">{minus(-props.limit)}</span>
          <span class="glu-heat-bar-title">
            <Tex tex="\mathrm{SiLU}(g)\cdot u" />
          </span>
        </div>
      </div>
    </div>
  )
}
