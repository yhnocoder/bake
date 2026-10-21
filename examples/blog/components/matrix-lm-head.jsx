import { Sketch, ink } from './lib/matrix/sketch.js'
import { chainArrows, drawChain } from './lib/matrix/graph.js'
import { SketchView } from './lib/matrix/view.jsx'

const steps = ['x', 'head', 'z', 'softmax', 'p', 'ce', 'loss']

export const params = {
  from: { label: '高亮起点', type: 'enum', options: steps, default: 'z' },
  to: { label: '高亮终点', type: 'enum', options: steps, default: 'loss' },
  brace: { label: '标出 Loss 对 logits 的梯度', type: 'boolean', default: false },
}
export const layout = {
  width: 'body',
  height: 400,
  narrowHeight: 376,
}

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

const CX = 150
const BW = 230
const SIDE_LENGTH = 30
const SIDE_LABEL_WIDTH = 69.33
const BRACE_LABEL_WIDTH = 67.69

function draw(from, to, brace) {
  const sketch = new Sketch()
  const { y, marks } = drawChain(sketch, chainArrows(sketch), chain, { CX, BW, PW: 195, gap: 18, sideLen: SIDE_LENGTH })
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
    const end = x - 2 * w - 6
    sketch.label('$\\dfrac{\\partial \\ell}{\\partial \\mathbf{z}} = \\mathbf{p} - \\mathbf{y}$', 12.5, end, ym + 5, 'end')
    left = Math.min(left, end - BRACE_LABEL_WIDTH)
  }
  const right = CX + BW / 2 + SIDE_LENGTH + 8 + SIDE_LABEL_WIDTH
  const top = Math.min(2, marks[from].top - 6)
  const bottom = Math.max(y, marks[to].bot + 6)
  return sketch.drawing(`${left - 4} ${top - 4} ${right - left + 8} ${bottom - top + 8}`)
}

export default function LmHeadLocalView(props) {
  const label = () => `从 lm head 的输入到 Loss 的计算过程，高亮${names[props.from]}到${names[props.to]}`
  return (
    <div class="matrix-root">
      <SketchView
        drawing={draw(props.from, props.to, props.brace)}
        label={label()}
        style="max-width:360px;margin:0 auto"
      />
    </div>
  )
}
