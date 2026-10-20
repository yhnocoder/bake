import { For, createResource, createSignal } from 'solid-js'
import { Sketch } from './lib/matrix/sketch.js'
import { MathText, SvgTex } from './lib/matrix/view.jsx'
import './lib/matrix/steps.css'

export const params = {
  step: { label: '初始步骤', type: 'number', min: 1, max: 8, step: 1, default: 1 },
}
export const layout = { width: 'body', height: 514, narrowHeight: 512 }

const COLORS = { gate: 'var(--series-2)', up: 'var(--series-3)', down: 'var(--ink)' }
const SWISH = '\\mathrm{Swish}(\\mathbf{a})'
const FORWARD = [
  ['M29,136 L29,54 L98,54', 64, 46, 'W_{gate}'],
  ['M150,54 L288,54', 220, 46, '\\mathrm{Swish}'],
  ['M390,54 L466,54 L466,125', 428, 46, '\\otimes'],
  ['M29,184 L29,266 L188,266', 110, 282, 'W_{up}'],
  ['M250,266 L466,266 L466,195', 358, 282, '\\otimes'],
  ['M520,154 L578,154', 549, 146, 'W_{down}'],
]
const BACKWARD = [
  { key: 'down', kind: 'down', d: 'M580,168 L522,168', x: 551, y: 186, tex: 'W_{down}^{T}' },
  { key: 'g3', kind: 'gate', d: 'M454,127 L454,66 L392,66', x: 423, y: 86, tex: '\\mathrm{diag}(\\mathbf{b})' },
  { key: 'g2', kind: 'gate', d: 'M290,66 L152,66', x: 221, y: 86, tex: "\\mathrm{diag}\\big(\\mathrm{Swish}'(\\mathbf{a})\\big)" },
  { key: 'g1', kind: 'gate', d: 'M100,66 L41,66 L41,134', x: 72, y: 88, tex: 'W_{gate}^{T}' },
  { key: 'u2', kind: 'up', d: 'M454,193 L454,254 L252,254', x: 352, y: 244, tex: `\\mathrm{diag}\\big(${SWISH}\\big)` },
  { key: 'u1', kind: 'up', d: 'M190,254 L41,254 L41,186', x: 115, y: 244, tex: 'W_{up}^{T}' },
]
const NODES = {
  x: { x: 10, y: 136, w: 50, h: 48, lines: ['$\\mathbf{x}$', '$\\mathbb{R}^{d}$'] },
  a: { x: 100, y: 36, w: 50, h: 48, lines: ['$\\mathbf{a}$', '$\\mathbb{R}^{d_{ff}}$'], kind: 'gate' },
  S: { x: 290, y: 36, w: 100, h: 48, lines: [`$${SWISH}$`, '$\\mathbb{R}^{d_{ff}}$'], kind: 'gate' },
  b: { x: 190, y: 236, w: 60, h: 48, lines: ['$\\mathbf{b}$', '$\\mathbb{R}^{d_{ff}}$'], kind: 'up' },
  u: { x: 400, y: 127, w: 120, h: 66, lines: ['$\\mathbf{u}$', `$${SWISH} \\otimes \\mathbf{b}$`, '$\\mathbb{R}^{d_{ff}}$'] },
  h: { x: 580, y: 136, w: 48, h: 48, lines: ['$\\mathbf{h}$', '$\\mathbb{R}^{d}$'] },
}
const STEPS = [
  { path: [], node: 'h' },
  { path: ['down'], node: 'u' },
  { path: ['down', 'g3'], node: 'S' },
  { path: ['down', 'g3', 'g2'], node: 'a' },
  { path: ['down', 'g3', 'g2', 'g1'], node: 'x' },
  { path: ['down', 'u2'], node: 'b' },
  { path: ['down', 'u2', 'u1'], node: 'x' },
  { path: ['down', 'g3', 'g2', 'g1', 'u2', 'u1'], node: 'x', last: true },
]
const DOWN = '\\underbrace{W_{down}^{T}}_{d \\times d_{ff}}'
const DIAG_B = '\\underbrace{\\mathrm{diag}(\\mathbf{b})}_{d_{ff} \\times d_{ff}}'
const DIAG_SWISH_PRIME = "\\underbrace{\\mathrm{diag}\\big(\\mathrm{Swish}'(\\mathbf{a})\\big)}_{d_{ff} \\times d_{ff}}"
const DIAG_SWISH = '\\underbrace{\\mathrm{diag}\\big(\\mathrm{Swish}(\\mathbf{a})\\big)}_{d_{ff} \\times d_{ff}}'
const TEXTS = [
  '<p><span class="t">前向计算。</span>从 $\\mathbf{x}$ 出发，经过 gate 和 up 两条路径算出 $\\mathbf{u}$，再算出 $\\mathbf{h}$。点击「下一步」，从 $\\mathbf{h}$ 开始反向走回 $\\mathbf{x}$，依次求出 $\\mathbf{h}$ 对沿途各个向量的 Jacobian。</p>',
  `<p><span class="t">从 $\\mathbf{h}$ 回到 $\\mathbf{u}$。</span>第一个因子是 $\\mathbf{u} \\to \\mathbf{h}$ 这次矩阵乘法的 Jacobian：</p>$$\\frac{\\partial \\mathbf{h}}{\\partial \\mathbf{u}} = ${DOWN}$$`,
  `<p><span class="t">gate 路径：回到 $\\mathrm{Swish}(\\mathbf{a})$。</span>在右边乘上逐元素乘对 $\\mathrm{Swish}(\\mathbf{a})$ 的 Jacobian $\\mathrm{diag}(\\mathbf{b})$，结果 $\\frac{\\partial \\mathbf{h}}{\\partial\\,\\mathrm{Swish}(\\mathbf{a})} \\in \\mathbb{R}^{d \\times d_{ff}}$：</p>$$\\frac{\\partial \\mathbf{h}}{\\partial\\,\\mathrm{Swish}(\\mathbf{a})} = ${DOWN}\\,${DIAG_B}$$`,
  `<p><span class="t">gate 路径：回到 $\\mathbf{a}$。</span>在右边乘上 Swish 的 Jacobian，结果仍是 $d \\times d_{ff}$：</p>$$\\frac{\\partial \\mathbf{h}}{\\partial \\mathbf{a}} = ${DOWN}\\,${DIAG_B}\\,${DIAG_SWISH_PRIME}$$`,
  `<p><span class="t">gate 路径：回到 $\\mathbf{x}$。</span>在右边乘上 $W_{gate}^{T}$，得到经过 gate 路径的乘积，结果是 $d \\times d$：</p>$$${DOWN}\\,${DIAG_B}\\,${DIAG_SWISH_PRIME}\\,\\underbrace{W_{gate}^{T}}_{d_{ff} \\times d}$$`,
  `<p><span class="t">up 路径：回到 $\\mathbf{b}$。</span>up 路径从 $\\mathbf{h}$ 到 $\\mathbf{u}$ 的一段与 gate 路径相同，乘积同样从 $W_{down}^{T}$ 开始，再乘上逐元素乘对 $\\mathbf{b}$ 的 Jacobian，结果是 $d \\times d_{ff}$：</p>$$\\frac{\\partial \\mathbf{h}}{\\partial \\mathbf{b}} = ${DOWN}\\,${DIAG_SWISH}$$`,
  `<p><span class="t">up 路径：回到 $\\mathbf{x}$。</span>在右边乘上 $W_{up}^{T}$，得到经过 up 路径的乘积，结果是 $d \\times d$：</p>$$${DOWN}\\,${DIAG_SWISH}\\,\\underbrace{W_{up}^{T}}_{d_{ff} \\times d}$$`,
  '<p><span class="t">两条路径相加。</span>$\\mathbf{x}$ 同时经过两条路径影响 $\\mathbf{h}$，按全导数链式法则，把两条路径的乘积相加，得到整个 FFN 的 Jacobian：</p>$$\\frac{\\partial \\mathbf{h}}{\\partial \\mathbf{x}} = \\underbrace{W_{down}^{T}\\,\\mathrm{diag}(\\mathbf{b})\\,\\mathrm{diag}\\big(\\mathrm{Swish}\'(\\mathbf{a})\\big)\\,W_{gate}^{T}}_{\\text{gate}} + \\underbrace{W_{down}^{T}\\,\\mathrm{diag}\\big(\\mathrm{Swish}(\\mathbf{a})\\big)\\,W_{up}^{T}}_{\\text{up}}$$',
]

async function drawForward() {
  const sketch = new Sketch()
  const arrow = sketch.marker('forward', 'var(--ink-3)')
  for (const [d, x, y, tex] of FORWARD) {
    sketch.el('path', { d, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.2, 'marker-end': arrow })
    sketch.tex(tex, 12, x, y, 'middle', 'var(--ink-3)')
  }
  return sketch.markup()
}

async function drawNodes() {
  const sketch = new Sketch()
  const sizes = [14, 12, 11]
  const colors = [undefined, 'var(--ink-2)', 'var(--ink-3)']
  for (const node of Object.values(NODES)) {
    const kind = node.kind ? COLORS[node.kind] : null
    sketch.el('rect', {
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      rx: 8,
      fill: kind ? `color-mix(in srgb, ${kind} 12%, var(--surface))` : 'var(--surface-2)',
      stroke: kind || 'var(--line-2)',
    })
    const styles = node.lines.length === 2 ? [0, 2] : [0, 1, 2]
    node.lines.forEach((line, i) =>
      sketch.label(line, sizes[styles[i]], node.x + node.w / 2, node.y + 20 + 18 * i, 'middle', colors[styles[i]]),
    )
  }
  return sketch.markup()
}

let figureCount = 0

export default function SwigluJacobianSteps(props) {
  const id = `matrix-swiglu-${++figureCount}`
  const [index, setIndex] = createSignal(Math.min(Math.max(props.step, 1), STEPS.length) - 1)
  const [forward] = createResource(drawForward)
  const [nodes] = createResource(drawNodes)
  const seen = () => new Set(STEPS.slice(0, index() + 1).flatMap((step) => step.path))
  const path = () => STEPS[index()].path
  const current = () => (STEPS[index()].last ? null : path()[path().length - 1])
  const target = () => NODES[STEPS[index()].node]
  const opacity = (key) => (path().includes(key) ? 1 : seen().has(key) ? 0.3 : 0)

  return (
    <div class="matrix-figure matrix-steps">
      <div class="matrix-steps-nav">
        <button class="matrix-button" type="button" disabled={index() === 0} onClick={() => setIndex(index() - 1)}>
          上一步
        </button>
        <button
          class="matrix-button primary"
          type="button"
          disabled={index() === STEPS.length - 1}
          onClick={() => setIndex(index() + 1)}
        >
          下一步
        </button>
        <span class="matrix-steps-count">
          第 {index() + 1} / {STEPS.length} 步
        </span>
      </div>
      <div class="matrix-steps-scroll">
        <svg
          class="matrix-steps-graph"
          viewBox="0 0 640 300"
          role="img"
          aria-label="SwiGLU FFN 的计算图：灰色箭头是前向计算，x 经过 gate 路径 a、Swish(a) 和 up 路径 b 算出 u，再算出 h；彩色箭头是反向传播，从 h 逐步走回 x，每条箭头上标出对应的 Jacobian"
        >
          <defs>
            <For each={Object.entries(COLORS)}>
              {([kind, color]) => (
                <marker id={`${id}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill={color} />
                </marker>
              )}
            </For>
          </defs>
          <g innerHTML={forward() || ''} />
          <For each={BACKWARD}>
            {(arrow) => (
              <g style={{ opacity: opacity(arrow.key), transition: 'opacity .25s' }}>
                <path
                  d={arrow.d}
                  fill="none"
                  stroke={COLORS[arrow.kind]}
                  stroke-width={arrow.key === current() ? 2.6 : 1.8}
                  marker-end={`url(#${id}-${arrow.kind})`}
                />
                <SvgTex tex={arrow.tex} size={13} x={arrow.x} y={arrow.y} color={COLORS[arrow.kind]} />
              </g>
            )}
          </For>
          <rect
            x={target().x - 6}
            y={target().y - 6}
            width={target().w + 12}
            height={target().h + 12}
            rx="11"
            fill="var(--accent)"
            fill-opacity="0.12"
            stroke="var(--accent)"
            stroke-width="1.5"
          />
          <g innerHTML={nodes() || ''} />
        </svg>
      </div>
      <MathText class="matrix-steps-text" text={TEXTS[index()]} />
    </div>
  )
}
