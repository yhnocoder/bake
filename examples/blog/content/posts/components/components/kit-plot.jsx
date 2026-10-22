import { createEffect, createSignal, Show } from 'solid-js'
import { Axes, Controls, Crosshair, Curve, Legend, Plot, Segmented, Toggle } from 'bake/kit'

const NAMES = ['tanh', 'sigmoid', 'softplus']

const FUNCTIONS = {
  tanh: { tex: '\\tanh x', f: Math.tanh, d: (x) => 1 - Math.tanh(x) ** 2 },
  sigmoid: { tex: '\\sigma(x)', f: (x) => 1 / (1 + Math.exp(-x)), d: (x) => Math.exp(-x) / (1 + Math.exp(-x)) ** 2 },
  softplus: { tex: '\\log(1 + e^x)', f: (x) => Math.log1p(Math.exp(x)), d: (x) => 1 / (1 + Math.exp(-x)) },
}

export const params = {
  fn: { label: '函数', type: 'enum', options: NAMES, default: 'tanh' },
  range: { label: '横轴范围 ±', type: 'number', min: 1, max: 10, step: 1, default: 4 },
}

export const layout = { placeholder: { narrow: 330, wide: 330 } }

export default function KitPlot(props) {
  const [chosen, setChosen] = createSignal(props.fn)
  createEffect(() => setChosen(props.fn))
  const [derivative, setDerivative] = createSignal(false)
  const fn = () => FUNCTIONS[chosen()]
  return (
    <div>
      <Controls>
        <Segmented label="函数" options={NAMES} value={chosen()} onChange={setChosen} />
        <Toggle label="导数" checked={derivative()} onChange={setDerivative} />
      </Controls>
      <Legend items={[{ color: 'var(--series-1)', tex: fn().tex }, ...(derivative() ? [{ color: 'var(--series-2)', dashed: true, label: '导数' }] : [])]} />
      <Plot x={[-props.range, props.range]} y={[-1.5, 2.5]} height={240} label={`${chosen()} 的曲线`}>
        <Axes />
        <Curve f={fn().f} color="var(--series-1)" label={`$${fn().tex}$`} />
        <Show when={derivative()}>
          <Curve f={fn().d} color="var(--series-2)" dashed label="导数" />
        </Show>
        <Crosshair />
      </Plot>
    </div>
  )
}
