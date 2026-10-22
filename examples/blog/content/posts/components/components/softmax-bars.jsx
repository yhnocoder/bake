import { createEffect, createMemo, createSignal, For } from 'solid-js'
import { Controls, Slider, formatNumber } from 'bake/kit'
import './softmax-bars.css'

export const params = {
  logits: { label: 'logits', type: 'numbers', min: -10, max: 10, default: [2, 1, 0.5, -1] },
  temperature: { label: '初始温度', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
}

export const layout = { placeholder: { narrow: 250, wide: 230 } }

function softmax(logits, temperature) {
  const scaled = logits.map((z) => z / temperature)
  const top = Math.max(...scaled)
  const weights = scaled.map((z) => Math.exp(z - top))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

export default function SoftmaxBars(props) {
  const [temperature, setTemperature] = createSignal(props.temperature)
  createEffect(() => setTemperature(props.temperature))
  const probabilities = createMemo(() => softmax(props.logits, temperature()))
  return (
    <div class="softmax-bars">
      <Controls>
        <Slider label="温度 T" min={0.1} max={5} step={0.1} value={temperature()} onInput={setTemperature} />
      </Controls>
      <div class="softmax-bars-plot">
        <For each={probabilities()}>
          {(p, index) => (
            <div class="softmax-bars-column">
              <span class="softmax-bars-value">{formatNumber(p, 2)}</span>
              <div class="softmax-bars-bar" style={{ height: `${p * 110}px`, background: `var(--series-${index() + 1})` }} />
              <span class="softmax-bars-label">z = {formatNumber(props.logits[index()], 1)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
