import { Sketch, ink } from './lib/mc/sketch.js'
import { chainArrows, drawChain } from './lib/mc/graph.js'
import { SketchView } from './lib/mc/view.jsx'

const steps = ['x', 'head', 'z', 'softmax', 'p', 'ce', 'loss']

export const params = {
  from: { label: '高亮起点', type: 'enum', options: steps, default: 'z' },
  to: { label: '高亮终点', type: 'enum', options: steps, default: 'loss' },
  brace: { label: '标出 Loss 对 logits 的梯度', type: 'boolean', default: false },
}
export const layout = { width: 'body', height: 400 }

const chain = [
  { act: '$\\mathbf{x} \\in \\mathbb{R}^{d}$', mark: 'x' },
  { op: '$\\mathrm{LMHead}$', w: '$W_{out}$：$d \\times V$', mark: 'head' },
  { act: 'logits$\\;\\mathbf{z} \\in \\mathbb{R}^{V}$', mark: 'z' },
  { op: '$\\mathrm{softmax}$', mark: 'softmax' },
  { act: '$\\mathbf{p} \\in \\mathbb{R}^{V}$', mark: 'p' },
  { op: '$\\mathrm{CrossEntropy}$', w: '$\\ell = -\\ln p_y$', side: '目标 token$\\;y$', mark: 'ce' },
  { act: 'Loss$\\;\\ell \\in \\mathbb{R}$', mark: 'loss' },
]
const names = {
  x: 'lm head 的输入',
  head: 'lm head',
  z: 'logits',
  softmax: 'softmax',
  p: '概率',
  ce: 'cross-entropy',
  loss: 'Loss',
}

async function draw(from, to, brace) {
  const sketch = new Sketch()
  const { y, marks, sideLabel } = drawChain(sketch, chainArrows(sketch), chain, { CX: 150, BW: 230, PW: 195, gap: 18, sideLen: 30 })
  const lit = steps.slice(steps.indexOf(from), steps.indexOf(to) + 1).map((key) => marks[key])
  const x0 = Math.min(...lit.map((m) => m.x))
  const x1 = Math.max(...lit.map((m) => m.x + m.w))
  sketch.el('rect', { x: x0 - 6, y: marks[from].top - 6, width: x1 - x0 + 12, height: marks[to].bot - marks[from].top + 12, rx: 9, ...ink.highlight, fill: 'none' })
  let left = Math.min(...Object.values(marks).map((m) => m.x)) - 6
  if (brace) {
    const y1 = marks.softmax.top
    const y2 = marks.loss.bot
    const ym = (y1 + y2) / 2
    const w = 7
    const x = Math.min(...Object.values(marks).map((m) => m.x)) - 8
    sketch.el('path', {
      d: `M${x},${y1} q${-w},0 ${-w},${w} L${x - w},${ym - w} q0,${w} ${-w},${w} q${w},0 ${w},${w} L${x - w},${y2 - w} q0,${w} ${w},${w}`,
      ...ink.edge,
    })
    const label = await sketch.label('$\\dfrac{\\partial \\ell}{\\partial \\mathbf{z}} = \\mathbf{p} - \\mathbf{y}$', 12.5, x - 2 * w - 6, ym + 5, 'end')
    left = Math.min(left, label.left)
  }
  const side = await sideLabel
  const right = side.left + side.width
  const top = Math.min(2, marks[from].top - 6)
  const bottom = Math.max(y, marks[to].bot + 6)
  return { viewBox: `${left - 4} ${top - 4} ${right - left + 8} ${bottom - top + 8}`, markup: await sketch.markup() }
}

export default function LmHeadLocalView(props) {
  const label = () => `从 lm head 的输入到 Loss 的计算过程，高亮${names[props.from]}到${names[props.to]}`
  return (
    <SketchView
      source={() => draw(props.from, props.to, props.brace)}
      label={label()}
      style="max-width:360px;margin:0 auto"
    />
  )
}
