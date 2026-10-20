import { ink } from './sketch.js'

const tagColors = {
  bf: { box: { fill: 'var(--mark)' }, text: 'var(--accent)' },
  fp: { box: { fill: 'color-mix(in srgb, var(--series-3) 14%, var(--surface))' }, text: 'var(--series-3)' },
  int: { box: { fill: 'var(--surface-2)', stroke: 'var(--line-2)' }, text: 'var(--ink-2)' },
}

export function chainArrows(sketch) {
  return { plain: sketch.marker('arr', 'var(--ink-2)'), accent: sketch.marker('arrb', 'var(--series-1)') }
}

export function drawChain(sketch, arrows, items, options) {
  const CX = options.CX
  const BW = options.BW || 270
  const BH = 46
  const PW = options.PW || 230
  const PH = 30
  const RX = CX + 160
  const GAP = options.gap || 30
  let y = options.y0 || 8
  let residualFrom = null
  let lastPill = null
  const late = []
  const marks = {}
  let sideLabel = null

  function tag(x, top, text, kind) {
    const width = text.length > 4 ? 42 : 36
    sketch.el('rect', { x: x - width, y: top, width, height: 14, rx: 3, ...tagColors[kind].box })
    sketch.text(x - width / 2, top + 10.5, text, `font-family:var(--font-mono);font-size:9.5px;fill:${tagColors[kind].text}`)
  }

  function arrow(y1, y2) {
    sketch.el('path', { d: `M${CX},${y1} L${CX},${y2 - 2}`, ...ink.edge, 'marker-end': arrows.plain })
  }

  items.forEach((item, index) => {
    const top = index ? y + GAP : y
    if (index) arrow(y, item.plus ? y + GAP : top)
    if (item.plus) {
      const cy = y + GAP + 10
      sketch.el('circle', { cx: CX, cy, r: 10, fill: 'var(--surface)', stroke: 'var(--series-1)', 'stroke-width': 1.3 })
      sketch.text(CX, cy + 5, '+', 'font-size:14px;font-weight:600;fill:var(--series-1)')
      const from = residualFrom
      late.push(() =>
        sketch.el('path', {
          d: `M${from.x},${from.y} L${RX},${from.y} L${RX},${cy} L${CX + 13},${cy}`,
          fill: 'none',
          stroke: 'var(--series-1)',
          'stroke-width': 1.3,
          'marker-end': arrows.accent,
        }),
      )
      if (item.mark) marks[item.mark] = { top: cy - 10, bot: cy + 10, x: CX - 10, w: 20 }
      y = cy + 10
      return
    }
    if (item.act) {
      sketch.el('rect', { x: CX - PW / 2, y: top, width: PW, height: PH, ...ink.pill })
      sketch.label(item.act, 12.5, CX - (item.dt ? 16 : 0), top + PH / 2 + 4.5, 'middle')
      if (item.dt) tag(CX + PW / 2 - 6, top + 8, item.dt, item.dt === 'BF16' ? 'bf' : item.dt === 'FP32' ? 'fp' : 'int')
      lastPill = { x: CX + PW / 2, y: top + PH / 2 }
      if (item.mark) marks[item.mark] = { top, bot: top + PH, x: CX - PW / 2, w: PW }
      y = top + PH
      return
    }
    if (item.res) residualFrom = lastPill
    if (item.stack) {
      sketch.el('rect', { x: CX - BW / 2 + 8, y: top + 8, width: BW, height: BH, ...ink.box })
      sketch.el('rect', { x: CX - BW / 2 + 4, y: top + 4, width: BW, height: BH, ...ink.box })
    }
    sketch.el('rect', { x: CX - BW / 2, y: top, width: BW, height: BH, ...ink.box })
    if (item.w) {
      sketch.label(item.op, 12.5, CX, top + 18, 'middle')
      sketch.label(item.w, 10.5, CX, top + 37, 'middle', 'var(--ink-2)')
    } else sketch.label(item.op, 12.5, CX, top + BH / 2 + 4.5, 'middle')
    if (item.bf) tag(CX + BW / 2 - 6, top + 5, 'BF16', 'bf')
    if (item.fp) tag(CX + BW / 2 - 6, top + 5, 'FP32', 'fp')
    if (item.side) {
      const cy = top + BH / 2
      const length = options.sideLen || 160
      sketch.el('path', { d: `M${CX + BW / 2 + length},${cy} L${CX + BW / 2 + 2},${cy}`, ...ink.edge, 'marker-end': arrows.plain })
      sideLabel = sketch.label(item.side, 11.5, CX + BW / 2 + length + 8, cy + 4, 'start', 'var(--ink-2)')
    }
    if (item.mark) marks[item.mark] = { top, bot: top + BH + (item.stack ? 8 : 0), x: CX - BW / 2, w: BW + (item.stack ? 8 : 0) }
    y = top + BH + (item.stack ? 8 : 0)
  })
  late.forEach((draw) => draw())
  return { y, marks, sideLabel }
}

export function drawGraph(sketch, arrows, nodes, edges) {
  const BH = 46
  const PH = 30
  const R = 11
  const bottom = (node) => node.y + (node.t === 'op' ? BH : node.t === 'act' ? PH : 2 * R)
  for (const [from, to, dx = 0] of edges) {
    const p = nodes[from]
    const q = nodes[to]
    const x = q.x + dx
    let d
    if (q.t === 'mul' && p.x !== q.x) {
      const cy = q.y + R
      d = `M${p.x},${bottom(p)} L${p.x},${cy} L${q.x + (p.x < q.x ? -R - 2 : R + 2)},${cy}`
    } else if (p.x === x) d = `M${p.x},${bottom(p)} L${x},${q.y - 2}`
    else {
      const my = q.y - 14
      d = `M${p.x},${bottom(p)} L${p.x},${my} L${x},${my} L${x},${q.y - 2}`
    }
    sketch.el('path', { d, ...ink.edge, 'marker-end': arrows.plain })
  }
  let height = 0
  for (const node of Object.values(nodes)) {
    if (node.t === 'mul') {
      sketch.el('circle', { cx: node.x, cy: node.y + R, r: R, fill: 'var(--surface-2)', stroke: 'var(--line-2)', 'stroke-width': 1.3 })
      sketch.label('$\\otimes$', 13, node.x, node.y + R + 4.5, 'middle')
    } else if (node.t === 'act') {
      const width = node.W || 150
      sketch.el('rect', { x: node.x - width / 2, y: node.y, width, height: PH, ...ink.pill })
      sketch.label(node.l, 12.5, node.x, node.y + PH / 2 + 4.5, 'middle')
    } else {
      const width = node.W || 170
      sketch.el('rect', { x: node.x - width / 2, y: node.y, width, height: BH, ...ink.box })
      if (node.w) {
        sketch.label(node.l, 12.5, node.x, node.y + 18, 'middle')
        sketch.label(node.w, 10.5, node.x, node.y + 37, 'middle', 'var(--ink-2)')
      } else sketch.label(node.l, 12.5, node.x, node.y + BH / 2 + 4.5, 'middle')
    }
    height = Math.max(height, bottom(node))
  }
  return height + 8
}
