import { Sketch } from './lib/matrix/sketch.js'
import { SketchView } from './lib/matrix/view.jsx'

export const params = {}
export const layout = { width: 'body', height: 210 }

async function draw() {
  const sketch = new Sketch()
  const QY = 34
  const KY = 118
  const H = 34
  const BW = 60
  const column = (x0, i) => x0 + 36 + 72 * i
  const groupColor = { '': 'var(--line-2)', g1: 'var(--series-1)', g2: 'var(--series-2)' }
  const edgeColor = { '': 'var(--ink-3)', g1: 'var(--series-1)', g2: 'var(--series-2)' }
  const text = (x, y, content, anchor = 'middle') => sketch.text(x, y, content, 'font-size:13px;fill:var(--ink-2)', anchor)
  const box = (x, y, width, tex, group) => {
    sketch.el('rect', { x: x - width / 2, y, width, height: H, rx: 6, fill: 'var(--surface-2)', stroke: groupColor[group] })
    sketch.tex(tex, 14, x, y + H / 2 + 5, 'middle')
  }
  text(82, QY + H / 2 + 5, 'query head', 'end')
  text(82, KY + H / 2 + 5, 'K/V', 'end')
  for (const [x0, title, groups] of [[90, 'MHA', 4], [410, 'GQA', 2]]) {
    text(x0 + 144, 18, title)
    const perGroup = 4 / groups
    for (let j = 0; j < groups; j++) {
      const group = groups < 4 ? 'g' + (j + 1) : ''
      const left = column(x0, j * perGroup)
      const right = column(x0, j * perGroup + perGroup - 1)
      const kx = (left + right) / 2
      for (let i = j * perGroup; i < (j + 1) * perGroup; i++) {
        sketch.el('path', { d: `M${column(x0, i)},${QY + H} L${kx},${KY}`, fill: 'none', stroke: edgeColor[group], 'stroke-width': 1.3 })
        box(column(x0, i), QY, BW - 8, `Q_${i + 1}`, group)
      }
      box(kx, KY, right - left + BW, `K_${j + 1},\\,V_${j + 1}`, group)
    }
  }
  text(410 + 144, KY + H + 22, '每组 K/V 被 2 个 query head 共用')
  return { viewBox: '0 0 700 180', markup: await sketch.markup() }
}

export default function MhaGqaComparison() {
  return (
    <div style="overflow-x:auto">
      <SketchView
        source={draw}
        label="MHA 中每个 query head 有自己的 K 和 V；GQA 中每两个 query head 共用一组 K 和 V"
        style="min-width:560px"
      />
    </div>
  )
}
