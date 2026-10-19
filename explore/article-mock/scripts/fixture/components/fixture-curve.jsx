import { createMemo, createSignal } from 'solid-js'

export const params = {
  fn: { label: '函数', type: 'enum', options: ['relu', 'tanh'], default: 'relu' },
  range: { label: '横轴范围', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  title: { label: '标题', type: 'text', default: '' },
  dashed: { label: '虚线', type: 'boolean', default: false },
}

export const layout = { width: 'wide', height: 300, narrowHeight: (params) => (params.fn === 'tanh' ? 240 : { ratio: 2 }) }

const functions = { relu: (x) => Math.max(0, x), tanh: Math.tanh }

export default function FixtureCurve(props) {
  const [scale, setScale] = createSignal(1)
  const path = createMemo(() => {
    const f = functions[props.fn]
    const points = []
    for (let i = 0; i <= 200; i++) {
      const x = -props.range + (2 * props.range * i) / 200
      const y = scale() * f(x)
      points.push(`${(i / 200) * 1000},${150 - (y / props.range) * 120}`)
    }
    return `M${points.join('L')}`
  })
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        gap: '8px',
        'font-family': 'var(--font-mono)',
        'font-size': '12px',
        color: 'var(--ink-2)',
      }}
    >
      <label style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
        缩放 <input type="range" min="0.2" max="2" step="0.1" value={scale()} onInput={(event) => setScale(Number(event.target.value))} /> {scale().toFixed(1)}
      </label>
      <svg viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ flex: 1, width: '100%' }}>
        <line x1="0" y1="150" x2="1000" y2="150" stroke="var(--axis)" />
        <line x1="500" y1="0" x2="500" y2="300" stroke="var(--axis)" />
        <path
          d={path()}
          fill="none"
          stroke="var(--series-1)"
          stroke-width="2.4"
          vector-effect="non-scaling-stroke"
          stroke-dasharray={props.dashed ? '6 4' : undefined}
        />
      </svg>
      {props.title && <div>{props.title}</div>}
    </div>
  )
}
