import { Show } from 'solid-js'
import { createElementSize } from 'bake/kit'
import { Sketch } from './lib/matrix/sketch.js'
import { chainArrows, drawChain } from './lib/matrix/graph.js'
import { SketchView } from './lib/matrix/view.jsx'

export const params = {}
export const layout = { width: 'body', height: 900, narrowHeight: { ratio: 0.234 } }

const norm = (name, mark) => ({ op: '$\\mathrm{RMSNorm}$', w: `$\\gamma_{${name}}$：$d$`, fp: true, mark })
const attention = {
  op: '$\\mathrm{Attention}_{\\mathrm{GQA}}$',
  w: '$W_Q$：$d \\times n_h d_h$　$W_K, W_V$：$d \\times n_{kv} d_h$　$W_O$：$n_h d_h \\times d$',
  bf: true,
}
const ffn = {
  op: '$\\mathrm{FFN}_{\\mathrm{SwiGLU}}$',
  w: '$W_{gate}, W_{up}$：$d \\times d_{ff}$　$W_{down}$：$d_{ff} \\times d$',
  bf: true,
}
const head = [
  norm('final', 'normF'),
  { act: '$\\hat{X}_N \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'XhN' },
  { op: '$\\mathrm{LMHead}$', w: '$W_{out}$：$d \\times V$', bf: true, mark: 'head' },
  { act: 'logits$\\;\\in \\mathbb{R}^{T \\times V}$', dt: 'BF16', mark: 'logits' },
  { op: '$\\mathrm{softmax}(\\mathrm{dim}=-1)$', fp: true, mark: 'softmax' },
  { act: '$P \\in \\mathbb{R}^{T \\times V}$', dt: 'FP32', mark: 'P' },
  {
    op: '$\\mathrm{CrossEntropy}$',
    w: '$L = -\\tfrac{1}{T}\\sum_t \\ln P[t,\\,y_t]$',
    side: 'target_ids$\\;y \\in \\mathbb{Z}^{T}$',
    fp: true,
    mark: 'ce',
  },
  { act: 'Loss$\\;L \\in \\mathbb{R}$', dt: 'FP32', mark: 'loss' },
]
const main = [
  { act: 'token_ids$\\;\\in \\mathbb{Z}^{T}$', dt: 'int', mark: 'tok' },
  { op: '$\\mathrm{Embedding}$', w: '$E$：$V \\times d$', bf: true, mark: 'emb' },
  { act: '$X_0 \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'X0' },
  { op: '$\\mathrm{Decoder}_i$', w: '$i = 1, \\ldots, N$，每层结构相同，权重各自独立', stack: true, mark: 'dec' },
  { act: '$X_N \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'XL' },
  ...head,
]
const detail = [
  { act: '$X_{i-1} \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'Xin' },
  { ...norm('attn', 'normA'), res: true },
  { act: '$\\hat{X} \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'Xh' },
  { ...attention, mark: 'attn' },
  { act: '$A \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'A' },
  { plus: true, mark: 'plus1' },
  { act: '$Y_i \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'Y' },
  { ...norm('ffn', 'normB'), res: true },
  { act: '$\\hat{Y} \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'Yh' },
  { ...ffn, mark: 'ffn' },
  { act: '$H \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'H' },
  { plus: true, mark: 'plus2' },
  { act: '$X_i \\in \\mathbb{R}^{T \\times d}$', dt: 'BF16', mark: 'Xout' },
]
const note = '$\\mathrm{Attention}_{\\mathrm{GQA}}\\;$和$\\;\\mathrm{FFN}_{\\mathrm{SwiGLU}}\\;$的内部计算见下方折叠块'
const panelTitle = '$\\mathrm{Decoder}_i$ 的内部'

const panel = (height) => ({ x: 395, y: 8, width: 357, height, rx: 10, fill: 'none', stroke: 'var(--line-2)', 'stroke-dasharray': '4 4' })

function sideBySide() {
  const sketch = new Sketch()
  const arrows = chainArrows(sketch)
  const left = drawChain(sketch, arrows, main, { CX: 180, BW: 250, PW: 210 })
  const right = drawChain(sketch, arrows, detail, { CX: 545, y0: 34, gap: 22 })
  const decoder = left.marks.dec
  const panelBottom = 8 + right.y + 2
  sketch.under('rect', panel(right.y + 2))
  sketch.label(panelTitle, 11, 404, 24, 'start', 'var(--ink-3)')
  const zoom = { fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '4 4' }
  sketch.el('path', { d: `M${180 + 125 + 8},${decoder.top} L395,8`, ...zoom })
  sketch.el('path', { d: `M${180 + 125 + 8},${decoder.bot} L395,${panelBottom}`, ...zoom })
  const height = Math.max(left.y, right.y)
  sketch.label(note, 11, 752, height + 6, 'end', 'var(--ink-3)')
  return sketch.drawing(`0 0 760 ${height + 12}`)
}

function mainChainAlone() {
  const sketch = new Sketch()
  const arrows = chainArrows(sketch)
  const chain = drawChain(sketch, arrows, main, { CX: 180, BW: 250, PW: 210, sideLen: 30 })
  return sketch.drawing(`44 0 400 ${chain.y + 8}`)
}

function decoderAlone() {
  const sketch = new Sketch()
  const arrows = chainArrows(sketch)
  const chain = drawChain(sketch, arrows, detail, { CX: 545, y0: 34, gap: 22 })
  sketch.under('rect', panel(chain.y + 2))
  sketch.label(panelTitle, 11, 404, 24, 'start', 'var(--ink-3)')
  sketch.label(note, 11, 752, chain.y + 28, 'end', 'var(--ink-3)')
  return sketch.drawing(`385 0 375 ${chain.y + 36}`)
}

export default function TransformerModelDiagram() {
  let host
  const size = createElementSize(() => host)
  const label = '主线把 N 层合并为一个 Decoder 方框，右侧展开一层内部'
  return (
    <div ref={host} class="matrix-root">
      <Show when={size().width > 0}>
        <Show
          when={size().width >= 600}
          fallback={
            <>
              <SketchView drawing={mainChainAlone()} label={label} />
              <SketchView drawing={decoderAlone()} label="Decoder 一层的内部" style="margin-top:12px" />
            </>
          }
        >
          <SketchView drawing={sideBySide()} label={label} />
        </Show>
      </Show>
    </div>
  )
}
