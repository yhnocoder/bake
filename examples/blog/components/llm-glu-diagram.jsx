import { createResource, createUniqueId, Show } from 'solid-js'
import { createElementSize } from 'bake/kit'
import { SvgLabel } from './lib/llm/svg-label.jsx'
import { typesetAll } from './lib/llm/tex.js'
import './lib/llm/act.css'
import './lib/llm/diagram.css'

export const params = {}

export const layout = { width: 'body' }

const NAME = 'llm-glu-diagram'

const UNIT = 42
const ACT_HEIGHT = 27
const OP = 30
const ARROW = 34
const FN_WIDTH = 40
const NODE_RADIUS = 11
const CORNER = 8
const BRANCH_OFFSET = 34
const WRAP_GAP = 14
const NARROW_BELOW = 560

const STYLE = {
  act: { fill: 'var(--series-4)', 'fill-opacity': 0.2, stroke: 'var(--ink-2)' },
  param: { fill: 'var(--series-1)', 'fill-opacity': 0.28, stroke: 'var(--ink-2)' },
}

function canvas(markerId) {
  const items = []
  const sources = []
  const text = (t, x, y, options = {}) => {
    sources.push(t)
    items.push(() => <SvgLabel text={t} x={x} y={y} anchor="middle" size={10} fill="var(--ink-2)" halo={false} {...options} />)
  }
  const box = (x, cy, w, h, kind, name, shape) => {
    items.push(() => <rect x={x} y={cy - h / 2} width={w} height={h} rx="5" stroke-width="1.4" {...STYLE[kind]} />)
    text(name, x + w / 2, cy + 4, { size: 12, fill: 'var(--ink)' })
    text('$' + shape + '$', x + w / 2, cy + h / 2 + 15)
    return x + w
  }
  return {
    items,
    sources,
    text,
    box,
    act: (x, cy, w, name, shape) => box(x, cy, w, ACT_HEIGHT, 'act', name, shape),
    op: (x, t, cy) => {
      text(t, x + OP / 2, cy + 4, { size: 13 })
      return x + OP
    },
    path: (d) => items.push(() => <path d={d} fill="none" stroke="var(--ink-2)" stroke-width="1.4" marker-end={`url(#${markerId})`} />),
    fn: (x, cy, w, t) => {
      items.push(() => <rect x={x} y={cy - 12} width={w} height={24} rx="12" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.4" />)
      text(t, x + w / 2, cy + 4, { size: 10.5, fill: 'var(--ink)' })
      return x + w
    },
    node: (cx, cy) => {
      items.push(() => <circle cx={cx} cy={cy} r={NODE_RADIUS} fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.4" />)
      text('$\\odot$', cx, cy + 4, { size: 12, fill: 'var(--ink)' })
    },
  }
}

const wrapPath = (fromX, fromY, turnY, toX, toY, rightX) =>
  `M${fromX + 2},${fromY}H${rightX - CORNER}A${CORNER},${CORNER} 0 0 1 ${rightX},${fromY + CORNER}` +
  `V${turnY - CORNER}A${CORNER},${CORNER} 0 0 1 ${rightX - CORNER},${turnY}` +
  `H${toX - 14 + CORNER}A${CORNER},${CORNER} 0 0 0 ${toX - 14},${turnY + CORNER}` +
  `V${toY - CORNER}A${CORNER},${CORNER} 0 0 0 ${toX - 14 + CORNER},${toY}H${toX - 2}`

function ffn(markerId, narrow) {
  const c = canvas(markerId)
  const F = 4 * UNIT
  const rowOne = 2 * UNIT + F + OP + ARROW * 2 + FN_WIDTH
  const rowTwo = F + 2 * OP + 2 * UNIT
  const W = narrow ? 380 : 720
  const H = narrow ? 316 : 216
  const cy1 = narrow ? 36 : 92
  const cy2 = narrow ? 186 : 92
  let x = narrow ? (W - rowOne - 20) / 2 + 20 : (W - (2 * UNIT + F + 3 * OP + F + UNIT + ARROW * 2 + FN_WIDTH)) / 2
  x = c.act(x, cy1, UNIT, '$X$', 'T\\times d')
  x = c.op(x, '$@$', cy1)
  x = c.box(x, cy1, F, UNIT, 'param', '$W_1$', 'd\\times d_{ff}')
  c.path(`M${x + 2},${cy1}H${x + 32}`)
  c.text('$Z$', x + 17, cy1 - 6, { fill: 'var(--ink)' })
  x += ARROW
  x = c.fn(x, cy1, FN_WIDTH, '$\\phi$')
  if (narrow) {
    const start = (W - rowTwo) / 2 + 6
    c.path(wrapPath(x, cy1, cy1 + 44 + WRAP_GAP, start, cy2, x + 14))
    x = start
  } else {
    c.path(`M${x + 2},${cy1}H${x + 32}`)
    x += ARROW
  }
  x = c.act(x, cy2, F, '$H$', 'T\\times d_{ff}')
  x = c.op(x, '$@$', cy2)
  x = c.box(x, cy2, UNIT, F, 'param', '$W_2$', 'd_{ff}\\times d')
  x = c.op(x, '$=$', cy2)
  c.act(x, cy2, UNIT, '$Y$', 'T\\times d')
  c.text('参数合计 $2\\,d\\,d_{ff}$；$d_{ff}=4d$ 时为 $8d^2$', W / 2, H - 8, { size: 10.5 })
  return { W, H, items: c.items, sources: c.sources }
}

function glu(markerId, narrow) {
  const c = canvas(markerId)
  const F = (8 / 3) * UNIT
  const W = narrow ? 380 : 720
  const H = narrow ? 312 : 216
  const cy1 = narrow ? 62 : 92
  const cy2 = narrow ? 218 : 92
  const rowOne = 2 * UNIT + F + OP + ARROW * 2 + FN_WIDTH + 2 * NODE_RADIUS
  const rowTwo = F + 2 * OP + 2 * UNIT
  let x = narrow ? (W - rowOne - 20) / 2 : (W - (2 * UNIT + F + 3 * OP + F + ARROW * 2 + FN_WIDTH + 2 * NODE_RADIUS + 44 + UNIT)) / 2
  const yg = cy1 - BRANCH_OFFSET
  const yu = cy1 + BRANCH_OFFSET
  x = c.act(x, cy1, UNIT, '$X$', 'T\\times d')
  c.op(x, '$@$', yg)
  x = c.op(x, '$@$', yu)
  c.box(x, yg, F, UNIT, 'param', '$W_g$', 'd\\times d_{ff}')
  x = c.box(x, yu, F, UNIT, 'param', '$W_u$', 'd\\times d_{ff}')
  const xs = x + ARROW
  const xc = xs + FN_WIDTH + ARROW + NODE_RADIUS
  c.path(`M${x + 2},${yg}H${xs - 2}`)
  c.text('$G$', (x + xs) / 2, yg - 6, { fill: 'var(--ink)' })
  c.fn(xs, yg, FN_WIDTH, '$\\phi$')
  c.path(`M${xs + FN_WIDTH},${yg}H${xc - CORNER}A${CORNER},${CORNER} 0 0 1 ${xc},${yg + CORNER}V${cy1 - NODE_RADIUS - 2}`)
  c.path(`M${x + 2},${yu}H${xc - CORNER}A${CORNER},${CORNER} 0 0 0 ${xc},${yu - CORNER}V${cy1 + NODE_RADIUS + 2}`)
  c.text('$U$', (x + xs) / 2, yu - 6, { fill: 'var(--ink)' })
  c.node(xc, cy1)
  x = xc + NODE_RADIUS
  if (narrow) {
    const start = (W - rowTwo) / 2 + 6
    c.path(wrapPath(x, cy1, cy1 + 84 + WRAP_GAP, start, cy2, x + 14))
    x = start
  } else {
    c.path(`M${x + 2},${cy1}H${x + 40}`)
    x += 44
  }
  x = c.act(x, cy2, F, '$H$', 'T\\times d_{ff}')
  x = c.op(x, '$@$', cy2)
  x = c.box(x, cy2, UNIT, F, 'param', '$W_d$', 'd_{ff}\\times d')
  x = c.op(x, '$=$', cy2)
  c.act(x, cy2, UNIT, '$Y$', 'T\\times d')
  c.text('参数合计 $3\\,d\\,d_{ff}$；$d_{ff}=\\tfrac{8}{3}d$ 时为 $8d^2$', W / 2, H - 8, { size: 10.5 })
  return { W, H, items: c.items, sources: c.sources }
}

const TITLE_HEIGHT = 28
const PANEL_GAP = 14

const panels = [
  {
    title: '普通 FFN：$Y=\\phi(XW_1)\\,W_2$',
    label: '普通 FFN 的前向计算：X 乘 W1 得 Z，Z 经过激活函数得 H，H 乘 W2 得 Y。W1 与 W2 按真实比例绘制',
    draw: ffn,
  },
  {
    title: 'GLU：$Y=(\\phi(XW_g)\\odot XW_u)\\,W_d$',
    label: 'GLU 的前向计算：X 分别乘 Wg 与 Wu 得 G 与 U，G 经过激活函数后与 U 逐元素相乘得 H，H 乘 Wd 得 Y。三个参数矩阵按真实比例绘制',
    draw: glu,
  },
]

function Diagram(props) {
  const markerId = createUniqueId()
  const drawings = panels.map((panel) => ({ ...panel, ...panel.draw(markerId, props.narrow) }))
  const width = drawings[0].W
  let top = 0
  const groups = drawings.map((d, index) => {
    const y = top
    top += TITLE_HEIGHT + d.H + (index < drawings.length - 1 ? PANEL_GAP : 0)
    return (
      <g role="img" aria-label={d.label}>
        <SvgLabel text={d.title} x={0} y={y + 18} size={13} fill="var(--ink-2)" halo={false} />
        <g transform={`translate(0 ${y + TITLE_HEIGHT})`}>{d.items.map((item) => item())}</g>
      </g>
    )
  })
  return (
    <svg viewBox={`0 0 ${width} ${top}`} class="llm-diagram-svg">
      <defs>
        <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--ink-2)" />
        </marker>
      </defs>
      {groups}
    </svg>
  )
}

function aspectRatio(narrow) {
  const drawings = panels.map((panel) => panel.draw('', narrow))
  return `${drawings[0].W} / ${drawings.reduce((height, d) => height + TITLE_HEIGHT + d.H, PANEL_GAP * (drawings.length - 1))}`
}

const texSources = () => [...panels.map((panel) => panel.title), ...[false, true].flatMap((narrow) => panels.flatMap((panel) => panel.draw('', narrow).sources))]

export default function FfnGluDiagram() {
  let root
  const size = createElementSize(() => root)
  const [ready] = createResource(() => typesetAll(NAME, texSources()))
  return (
    <div ref={root} class="llm-diagram" style={{ 'aspect-ratio': aspectRatio(size().width < NARROW_BELOW) }}>
      <Show when={ready() && size().width > 0}>
        <Show when={size().width < NARROW_BELOW} fallback={<Diagram narrow={false} />}>
          <Diagram narrow />
        </Show>
      </Show>
    </div>
  )
}
