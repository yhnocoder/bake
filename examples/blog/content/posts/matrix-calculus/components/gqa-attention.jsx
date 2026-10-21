import { Sketch } from './lib/sketch.js'
import { chainArrows, drawGraph } from './lib/graph.js'
import { SketchView } from './lib/view.jsx'

export const params = {}
export const layout = { width: 'body' }

const linear = '$\\mathrm{Linear}$'
const norm = '$\\mathrm{RMSNorm}$'
const rope = '$\\mathrm{RoPE}$'
const nodes = {
  X: { t: 'act', x: 273, y: 8, l: '$X \\in \\mathbb{R}^{T \\times d}$' },
  lq: { t: 'op', x: 93, y: 70, l: linear, w: '$W_Q^{(i)}$：$d \\times d_h$' },
  lk: { t: 'op', x: 273, y: 70, l: linear, w: '$W_K^{(j)}$：$d \\times d_h$' },
  lv: { t: 'op', x: 453, y: 70, l: linear, w: '$W_V^{(j)}$：$d \\times d_h$' },
  q: { t: 'act', x: 93, y: 146, l: '$Q_i \\in \\mathbb{R}^{T \\times d_h}$' },
  k: { t: 'act', x: 273, y: 146, l: '$K_j \\in \\mathbb{R}^{T \\times d_h}$' },
  v: { t: 'act', x: 453, y: 146, l: '$V_j \\in \\mathbb{R}^{T \\times d_h}$' },
  nq: { t: 'op', x: 93, y: 206, l: norm, w: '$\\gamma_q$：$d_h$' },
  nk: { t: 'op', x: 273, y: 206, l: norm, w: '$\\gamma_k$：$d_h$' },
  rq: { t: 'op', x: 93, y: 282, l: rope },
  rk: { t: 'op', x: 273, y: 282, l: rope },
  tq: { t: 'act', x: 93, y: 358, l: '$\\tilde{Q}_i \\in \\mathbb{R}^{T \\times d_h}$' },
  tk: { t: 'act', x: 273, y: 358, l: '$\\tilde{K}_j \\in \\mathbb{R}^{T \\times d_h}$' },
  sc: { t: 'op', x: 183, y: 432, W: 220, l: '$\\tilde{Q}_i\\tilde{K}_j^{T} / \\sqrt{d_h} + M$' },
  S: { t: 'act', x: 183, y: 508, l: '$S_i \\in \\mathbb{R}^{T \\times T}$' },
  sm: { t: 'op', x: 183, y: 568, W: 200, l: '$\\mathrm{softmax}(\\mathrm{dim}=-1)$' },
  P: { t: 'act', x: 183, y: 644, l: '$P_i \\in \\mathbb{R}^{T \\times T}$' },
  pv: { t: 'op', x: 303, y: 718, l: '$P_iV_j$' },
  Ai: { t: 'act', x: 303, y: 794, l: '$A_i \\in \\mathbb{R}^{T \\times d_h}$' },
  cat: { t: 'op', x: 303, y: 854, W: 220, l: '$\\mathrm{Concat}$', w: '$[A_1 \\cdots A_{n_h}] \\in \\mathbb{R}^{T \\times n_h d_h}$' },
  lo: { t: 'op', x: 303, y: 930, l: linear, w: '$W_O$：$n_h d_h \\times d$' },
  A: { t: 'act', x: 303, y: 1006, l: '$A \\in \\mathbb{R}^{T \\times d}$' },
}
const edges = [
  ['X', 'lq'], ['X', 'lk'], ['X', 'lv'], ['lq', 'q'], ['lk', 'k'], ['lv', 'v'], ['q', 'nq'], ['k', 'nk'], ['nq', 'rq'], ['nk', 'rk'],
  ['rq', 'tq'], ['rk', 'tk'], ['tq', 'sc', -50], ['tk', 'sc', 50], ['sc', 'S'], ['S', 'sm'], ['sm', 'P'], ['P', 'pv', -50], ['v', 'pv', 50],
  ['pv', 'Ai'], ['Ai', 'cat'], ['cat', 'lo'], ['lo', 'A'],
]

function draw() {
  const sketch = new Sketch()
  const height = drawGraph(sketch, chainArrows(sketch), nodes, edges)
  return sketch.drawing(`0 0 546 ${height}`)
}

export default function GqaAttentionDiagram() {
  return (
    <div class="matrix-root">
      <SketchView
        drawing={draw()}
        label="GQA attention 一个 head 的内部计算：Q、K、V 三路 Linear，Q 和 K 经过 RMSNorm 和 RoPE，计算分数、softmax、乘 V，拼接后经过输出 Linear"
        style="max-width:590px;margin:0 auto"
      />
    </div>
  )
}
