import { Sketch } from './lib/mc/sketch.js'
import { chainArrows, drawGraph } from './lib/mc/graph.js'
import { SketchView } from './lib/mc/view.jsx'

export const params = {}
export const layout = { width: 'body', height: 540 }

const linear = '$\\mathrm{Linear}$'
const nodes = {
  x: { t: 'act', x: 198, y: 8, W: 130, l: '$\\mathbf{x} \\in \\mathbb{R}^{d}$' },
  lg: { t: 'op', x: 93, y: 70, l: linear, w: '$W_{gate}$：$d \\times d_{ff}$' },
  lu: { t: 'op', x: 303, y: 70, l: linear, w: '$W_{up}$：$d \\times d_{ff}$' },
  a: { t: 'act', x: 93, y: 146, l: '$\\mathbf{a} \\in \\mathbb{R}^{d_{ff}}$' },
  b: { t: 'act', x: 303, y: 146, l: '$\\mathbf{b} \\in \\mathbb{R}^{d_{ff}}$' },
  sw: { t: 'op', x: 93, y: 206, l: '$\\mathrm{Swish}$' },
  mul: { t: 'mul', x: 198, y: 276 },
  u: { t: 'act', x: 198, y: 324, l: '$\\mathbf{u} \\in \\mathbb{R}^{d_{ff}}$' },
  ld: { t: 'op', x: 198, y: 380, l: linear, w: '$W_{down}$：$d_{ff} \\times d$' },
  h: { t: 'act', x: 198, y: 452, W: 130, l: '$\\mathbf{h} \\in \\mathbb{R}^{d}$' },
}
const edges = [['x', 'lg'], ['x', 'lu'], ['lg', 'a'], ['lu', 'b'], ['a', 'sw'], ['sw', 'mul'], ['b', 'mul'], ['mul', 'u'], ['u', 'ld'], ['ld', 'h']]

async function draw() {
  const sketch = new Sketch()
  const height = drawGraph(sketch, chainArrows(sketch), nodes, edges)
  return { viewBox: `0 0 396 ${height}`, markup: await sketch.markup() }
}

export default function SwigluFfnDiagram() {
  return (
    <SketchView
      source={draw}
      label="SwiGLU FFN 的内部计算：两路 Linear，一路经过 Swish，逐元素相乘后再经过一次 Linear"
      style="max-width:430px;margin:0 auto"
    />
  )
}
