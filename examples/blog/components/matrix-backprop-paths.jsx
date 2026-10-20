import { Sketch } from './lib/matrix/sketch.js'
import { SketchView } from './lib/matrix/view.jsx'

export const params = {
  paths: {
    label: '路径图',
    type: 'enum',
    options: ['chain', 'total', 'vector', 'head-input', 'head-weight'],
    default: 'chain',
  },
}
export const layout = {
  width: 'body',
  height: (params) => (params.paths === 'chain' ? 110 : 200),
  narrowHeight: (params) => ({ ratio: params.paths === 'chain' ? 5 : 2.6 }),
}

const descriptions = {
  chain: '反向传播的方向：从 y 经过 u 传回 x，只有一条路径',
  total: '反向传播的方向：从 y 经过 u_1 到 u_n 共 n 条路径传回 x',
  vector: '反向传播的方向：y 连到 u_1 到 u_n，每个 u_k 再连到 x_1 到 x_m 的每一个；高亮从 y 经过 n 条路径传回 x_1',
  'head-input':
    '反向传播的方向：Loss 连到 z_1 到 z_V，每个 z_j 再连到 x_1 到 x_d 的每一个；高亮从 Loss 经过 V 条路径传回 x_i，每条路径上 Loss 到 z_j 一段的偏导数是 p_j - y_j，z_j 到 x_i 一段是 W_ij',
  'head-weight':
    'x_1 到 x_d 与 z_1 到 z_V 两两相连，每条边是 W 的一个元素；高亮 x_i 到 z_j 的边 W_ij，Loss 只经过 z_j 一条路径传回 W_ij，这段的偏导数是 p_j - y_j',
}

const accent = 'var(--series-1)'
const plainEdge = { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.3 }
const accentEdge = { ...plainEdge, stroke: accent }
const faintEdge = { ...plainEdge, opacity: 0.35 }

function prepare() {
  const sketch = new Sketch()
  const arrows = { plain: sketch.marker('arr', 'var(--ink-2)'), accent: sketch.marker('arrb', accent) }
  const node = (x, y, width, height, tex) => {
    sketch.el('rect', { x, y, width, height, rx: 6, fill: 'var(--surface-2)', stroke: 'var(--line-2)' })
    sketch.label(tex, 13, x + width / 2, y + height / 2 + 5, 'middle')
  }
  const row = (x, cy, tex) => node(x, cy - 16, 60, 32, tex)
  return { sketch, arrows, node, row }
}

const drawings = {
  chain() {
    const { sketch, arrows, node } = prepare()
    const box = (x, tex) => node(x, 30, 70, 40, tex)
    box(20, '$x$')
    box(225, '$u$')
    box(430, '$y$')
    sketch.el('path', { d: 'M225,50 L92,50', ...plainEdge, 'marker-end': arrows.plain })
    sketch.el('path', { d: 'M430,50 L297,50', ...plainEdge, 'marker-end': arrows.plain })
    sketch.label('$\\dfrac{du}{dx}$', 12, 157, 24, 'middle', 'var(--ink-2)')
    sketch.label('$\\dfrac{dy}{du}$', 12, 362, 24, 'middle', 'var(--ink-2)')
    sketch.label('反向传播：从 $y$ 出发，先乘 $dy/du$，再乘 $du/dx$，得到 $dy/dx$', 12, 260, 98, 'middle', accent)
    return { sketch, viewBox: '0 0 520 104' }
  },
  total() {
    const { sketch, arrows, node } = prepare()
    node(20, 70, 60, 40, '$x$')
    node(440, 70, 60, 40, '$y$')
    for (const [cy, tex, lit] of [[24, 'u_1', true], [72, 'u_2', false], [152, 'u_n', false]]) {
      const edge = lit ? { ...accentEdge, 'marker-end': arrows.accent } : { ...plainEdge, 'marker-end': arrows.plain }
      sketch.el('path', { d: `M230,${cy} C160,${cy} 150,90 82,90`, ...edge })
      sketch.el('path', { d: `M440,90 C370,90 360,${cy} 292,${cy}`, ...edge })
      node(230, cy - 16, 60, 32, `$${tex}$`)
    }
    sketch.label('$\\vdots$', 13, 260, 118, 'middle')
    sketch.label('$\\dfrac{du_1}{dx}$', 12, 140, 45, 'middle', accent)
    sketch.label('$\\dfrac{\\partial y}{\\partial u_1}$', 12, 380, 45, 'middle', accent)
    sketch.label('反向传播：从 $y$ 出发，经过 $n$ 条路径传回 $x$，各条路径的贡献相加', 12, 260, 194, 'middle', accent)
    return { sketch, viewBox: '0 0 520 200' }
  },
  vector() {
    const { sketch, arrows, row } = prepare()
    const rows = [24, 72, 152]
    for (const lit of [false, true])
      rows.forEach((a, i) =>
        rows.forEach((b) => {
          if ((i === 0) !== lit) return
          sketch.el('path', {
            d: `M230,${b} L102,${a}`,
            ...(lit ? { ...accentEdge, 'marker-end': arrows.accent } : { ...faintEdge, 'marker-end': arrows.plain }),
          })
        }),
      )
    rows.forEach((b) => sketch.el('path', { d: `M440,88 C370,88 360,${b} 292,${b}`, ...accentEdge, 'marker-end': arrows.accent }))
    ;['x_1', 'x_2', 'x_m'].forEach((tex, i) => row(40, rows[i], `$${tex}$`))
    ;['u_1', 'u_2', 'u_n'].forEach((tex, i) => row(230, rows[i], `$${tex}$`))
    row(440, 88, '$y$')
    sketch.label('$\\vdots$', 13, 70, 118, 'middle')
    sketch.label('$\\vdots$', 13, 260, 118, 'middle')
    sketch.label('反向传播：从 $y$ 出发，经过 $n$ 条路径传回 $x_1$', 12, 260, 192, 'middle', accent)
    return { sketch, viewBox: '0 0 520 200' }
  },
  'head-input'() {
    const { sketch, arrows, row } = prepare()
    const xs = [[24, 'x_1'], [88, 'x_i'], [152, 'x_d']]
    const zs = [[24, '1'], [72, '2'], [152, 'V']]
    for (const [a] of xs) if (a !== 88) for (const [b] of zs) sketch.el('path', { d: `M230,${b} L102,${a}`, ...faintEdge, 'marker-end': arrows.plain })
    for (const [b] of zs) {
      sketch.el('path', { d: `M230,${b} L102,88`, ...accentEdge, 'marker-end': arrows.accent })
      sketch.el('path', { d: `M440,88 C370,88 360,${b} 292,${b}`, ...accentEdge, 'marker-end': arrows.accent })
    }
    for (const [b, j] of zs) {
      sketch.texOnBackground(`W_{i${j}}`, 12, 170, 88 + 0.55 * (b - 88) + 4, 'middle', 'var(--ink-2)')
      sketch.texOnBackground(`p_${j} - y_${j}`, 12, 337, b + (88 - b) * 0.22 + 4, 'middle', 'var(--ink-2)')
    }
    xs.forEach(([a, tex]) => row(40, a, `$${tex}$`))
    zs.forEach(([b, j]) => row(230, b, `$z_${j}$`))
    row(440, 88, '$\\ell$')
    sketch.label('$\\vdots$', 13, 70, 62, 'middle')
    sketch.label('$\\vdots$', 13, 70, 126, 'middle')
    sketch.label('$\\vdots$', 13, 260, 118, 'middle')
    sketch.label('反向传播：每条路径贡献 $(p_j - y_j)\\,W_{ij}$', 12, 260, 194, 'middle', accent)
    return { sketch, viewBox: '0 0 520 200' }
  },
  'head-weight'() {
    const { sketch, arrows, row } = prepare()
    const xs = [[24, 'x_1'], [88, 'x_i'], [152, 'x_d']]
    const zs = [[24, '1'], [88, 'j'], [152, 'V']]
    for (const [a] of xs) for (const [b] of zs) if (a !== 88 || b !== 88) sketch.el('path', { d: `M230,${b} L102,${a}`, ...faintEdge })
    sketch.el('path', { d: 'M230,88 L102,88', ...accentEdge, 'stroke-width': 2.6 })
    sketch.texOnBackground('W_{ij}', 12, 166, 92, 'middle', accent)
    for (const [b, j] of zs) {
      const lit = b === 88
      sketch.el('path', {
        d: `M440,88 C370,88 360,${b} 292,${b}`,
        ...(lit ? { ...accentEdge, 'marker-end': arrows.accent } : { ...faintEdge, 'marker-end': arrows.plain }),
      })
      if (lit) sketch.texOnBackground(`p_${j} - y_${j}`, 12, 366, 92, 'middle', accent)
    }
    xs.forEach(([a, tex]) => row(40, a, `$${tex}$`))
    zs.forEach(([b, j]) => row(230, b, `$z_${j}$`))
    row(440, 88, '$\\ell$')
    for (const [x, y] of [[70, 62], [70, 126], [260, 62], [260, 126]]) sketch.label('$\\vdots$', 13, x, y, 'middle')
    sketch.label('反向传播：$W_{ij}$ 只在 $z_j$ 这一条路径上，贡献 $(p_j - y_j)\\,x_i$', 12, 260, 194, 'middle', accent)
    return { sketch, viewBox: '0 0 520 200' }
  },
}

function draw(paths) {
  const { sketch, viewBox } = drawings[paths]()
  return sketch.drawing(viewBox)
}

export default function BackpropPathDiagram(props) {
  return (
    <div class="matrix-root">
      <SketchView
        drawing={draw(props.paths)}
        label={descriptions[props.paths]}
        style="max-width:520px;margin:0 auto"
      />
    </div>
  )
}
