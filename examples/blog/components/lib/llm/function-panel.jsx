import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'
import { SvgLabel } from './svg-label.jsx'
import { richNodes, plainText } from './tex.js'

const HEIGHT_RATIO = 250 / 440
const MIN_WIDTH = 360
const SAMPLES = 400
const MARGIN = { left: 40, right: 12, top: 10, bottom: 28 }

export function niceTicks(a, b) {
  const raw = (b - a) / 5
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / power
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * power
  const ticks = []
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) ticks.push(+v.toFixed(6))
  return ticks
}

function curvePath(q, x0, x1, y0, y1, sx, sy) {
  let d = ''
  let pen = false
  const span = y1 - y0
  const stepX = (x1 - x0) / SAMPLES
  for (let i = 0; i <= SAMPLES; i++) {
    const x = x0 + stepX * i
    const y = q.fn(x)
    if (!isFinite(y)) {
      pen = false
      continue
    }
    if (q.breaks.some((v) => x - stepX <= v && x >= v)) pen = false
    const clamped = Math.max(Math.min(y, y1 + span), y0 - span)
    d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(clamped).toFixed(1)
    pen = true
  }
  return d
}

export function FunctionPanel(props) {
  const clipId = createUniqueId()
  const [hoverX, setHoverX] = createSignal(null)
  const [tip, setTip] = createSignal(null)
  let svgRef

  const W = () => Math.max(MIN_WIDTH, props.width)
  const H = () => props.height ?? Math.round(W() * HEIGHT_RATIO)
  const frame = createMemo(() => {
    const [x0, x1] = props.x
    const [y0, y1] = props.y
    const w = W()
    const h = H()
    const sx = (v) => MARGIN.left + ((v - x0) / (x1 - x0)) * (w - MARGIN.left - MARGIN.right)
    const sy = (v) => MARGIN.top + ((y1 - v) / (y1 - y0)) * (h - MARGIN.top - MARGIN.bottom)
    return { x0, x1, y0, y1, w, h, sx, sy, bottom: h - MARGIN.bottom, right: w - MARGIN.right }
  })
  const visible = () => props.series.filter((q) => !q.hidden)

  const showLabelTip = (label) => setTip({ nodes: richNodes(label), left: 44, top: 8 })
  const hideTip = () => setTip(null)

  function Mark(markProps) {
    const label = markProps.label
    return (
      <g
        tabindex="0"
        role="img"
        aria-label={plainText(label)}
        class="llm-mark"
        onPointerEnter={() => showLabelTip(label)}
        onPointerLeave={hideTip}
        onFocus={() => showLabelTip(label)}
        onBlur={hideTip}
      >
        <title>{plainText(label)}</title>
        {markProps.children}
      </g>
    )
  }

  const backdrop = createMemo(() => {
    const g = props.guides
    if (!g) return []
    const { x0, x1, sx, sy, bottom } = frame()
    const items = []
    for (const b of g.bands) {
      const a = Math.max(x0, b.a)
      const z = Math.min(x1, b.b)
      if (a >= z) continue
      items.push(
        <rect x={sx(a)} y={MARGIN.top} width={sx(z) - sx(a)} height={bottom - MARGIN.top} fill={b.color ?? 'var(--accent)'} opacity="0.09" pointer-events="none" />,
      )
    }
    for (const r of g.references) {
      const color = r.color ?? 'var(--ink-3)'
      items.push(
        <line x1={sx(r.a)} x2={sx(r.b)} y1={sy(r.y)} y2={sy(r.endY ?? r.y)} stroke={color} stroke-width="1.6" stroke-dasharray="1 5" stroke-linecap="round" />,
      )
      if (r.label)
        items.push(<SvgLabel text={r.label} x={sx(r.labelX ?? (r.a + r.b) / 2)} y={sy(r.labelY ?? r.y) + (r.dy ?? -9)} anchor="middle" fill={color} />)
    }
    for (const v of g.verticals) {
      if (v.x < x0 || v.x > x1) continue
      items.push(<line x1={sx(v.x)} x2={sx(v.x)} y1={MARGIN.top} y2={bottom} stroke="var(--ink-3)" stroke-dasharray="4 4" />)
      if (v.label) items.push(<SvgLabel text={v.label} x={sx(v.x) + 6} y={MARGIN.top + 13} fill="var(--ink-2)" />)
    }
    return items
  })

  const marks = createMemo(() => {
    const g = props.guides
    if (!g) return []
    const { x0, x1, y0, y1, sx, sy, bottom } = frame()
    const items = []
    g.bands.forEach((b) => {
      if (b.shadeOnly) return
      const q = props.series[b.index]
      if (!q || q.hidden) return
      const a = Math.max(x0, b.a)
      const z = Math.min(x1, b.b)
      if (a >= z) return
      let d = ''
      for (let j = 0; j <= 100; j++) {
        const x = a + ((z - a) * j) / 100
        d += (j ? 'L' : 'M') + sx(x) + ' ' + sy(q.fn(x))
      }
      items.push(
        <Mark label={b.label}>
          <path clip-path={`url(#${clipId})`} d={d} fill="none" stroke={q.color} stroke-width="4" stroke-linecap="round" />
        </Mark>,
      )
      for (const x of [b.a, b.b].filter((x) => x >= x0 && x <= x1 && q.fn(x) >= y0 && q.fn(x) <= y1))
        items.push(
          <Mark label={b.label + '；边界 $x=' + x.toFixed(2) + '$'}>
            <circle cx={sx(x)} cy={sy(q.fn(x))} r="4" fill="var(--surface)" stroke={q.color} stroke-width="2" />
          </Mark>,
        )
    })
    for (const q of visible().filter((q) => !q.dash && !q.faint)) {
      for (const side of [-1, 1]) {
        const x = side < 0 ? x0 + (x1 - x0) * 0.06 : x1 - (x1 - x0) * 0.06
        const xx = x - side * (x1 - x0) * 0.035
        const px = sx(x)
        const py = sy(q.fn(x))
        if (py < MARGIN.top + 6 || py > bottom - 6) continue
        const angle = Math.atan2(py - sy(q.fn(xx)), px - sx(xx))
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        const d = `M ${px - 7 * dx + 4 * dy} ${py - 7 * dy - 4 * dx} L ${px} ${py} L ${px - 7 * dx - 4 * dy} ${py - 7 * dy + 4 * dx}`
        items.push(
          <Mark label={q.name + ' · ' + (side < 0 ? g.left : g.right)}>
            <path d={d} fill="none" stroke={q.color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </Mark>,
        )
      }
    }
    for (const m of g.points) {
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue
      const color = m.color ?? 'var(--ink)'
      items.push(
        <Mark label={m.label || '边界点 $(' + m.x.toFixed(2) + ',\\ ' + m.y.toFixed(2) + ')$'}>
          <circle
            cx={sx(m.x)}
            cy={sy(m.y)}
            r="4"
            fill={m.open ? 'var(--surface)' : color}
            stroke={m.open ? color : 'var(--surface)'}
            stroke-width="1.5"
          />
        </Mark>,
      )
      if (m.label)
        items.push(<SvgLabel text={m.label} x={sx(m.x) + (m.dx ?? 8)} y={sy(m.y) + (m.dy ?? -10)} fill={color} interactive={false} />)
    }
    return items
  })

  const readout = createMemo(() => {
    const x = hoverX()
    if (x === null) return null
    const { y0, y1 } = frame()
    return visible().map((q) => {
      const y = q.fn(x)
      return { q, y, inside: y >= y0 && y <= y1 }
    })
  })

  function onPointerMove(event) {
    if (event.target.closest('.llm-mark')) return
    const rect = svgRef.getBoundingClientRect()
    const { w, x0, x1 } = frame()
    const px = ((event.clientX - rect.left) / rect.width) * w
    if (px < MARGIN.left || px > w - MARGIN.right) return onPointerLeave()
    const x = x0 + ((px - MARGIN.left) / (w - MARGIN.left - MARGIN.right)) * (x1 - x0)
    setHoverX(x)
    const nodes = [...richNodes('$x$'), document.createTextNode(' ' + x.toFixed(2))]
    for (const { q, y } of readout()) {
      const swatch = document.createElement('span')
      swatch.style.color = q.color
      swatch.textContent = '■'
      nodes.push(document.createElement('br'), swatch, document.createTextNode(' '), ...richNodes(q.name), document.createTextNode(' ' + (isFinite(y) ? y.toFixed(3) : '不可导')))
    }
    const left = event.clientX - rect.left
    setTip({ nodes, top: 8, pointerLeft: left, flip: left > rect.width * 0.6 })
  }

  function onPointerLeave() {
    setHoverX(null)
    setTip(null)
  }

  const tipStyle = (t) => {
    if (t.pointerLeft === undefined) return { left: t.left + 'px', top: t.top + 'px' }
    if (t.flip) return { left: t.pointerLeft - 12 + 'px', top: t.top + 'px', transform: 'translateX(-100%)' }
    return { left: t.pointerLeft + 12 + 'px', top: t.top + 'px' }
  }

  return (
    <div class="llm-plotwrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W()} ${H()}`}
        role="img"
        aria-label={props.label}
        class="llm-svg"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={W() - MARGIN.left - MARGIN.right} height={H() - MARGIN.top - MARGIN.bottom} />
          </clipPath>
        </defs>
        <g>
          <For each={niceTicks(frame().y0, frame().y1)}>
            {(t) => (
              <>
                <line x1={MARGIN.left} x2={frame().right} y1={frame().sy(t)} y2={frame().sy(t)} stroke="var(--grid)" stroke-width="1" />
                <text x={MARGIN.left - 6} y={frame().sy(t) + 3.5} text-anchor="end" class="llm-tick">
                  {t}
                </text>
              </>
            )}
          </For>
          <For each={niceTicks(frame().x0, frame().x1)}>
            {(t) => (
              <>
                <line y1={MARGIN.top} y2={frame().bottom} x1={frame().sx(t)} x2={frame().sx(t)} stroke="var(--grid)" stroke-width="1" />
                <text x={frame().sx(t)} y={frame().bottom + 14} text-anchor="middle" class="llm-tick">
                  {t}
                </text>
              </>
            )}
          </For>
          <Show when={frame().y0 < 0 && frame().y1 > 0}>
            <line x1={MARGIN.left} x2={frame().right} y1={frame().sy(0)} y2={frame().sy(0)} stroke="var(--axis)" stroke-width="1" />
          </Show>
          <Show when={frame().x0 < 0 && frame().x1 > 0}>
            <line y1={MARGIN.top} y2={frame().bottom} x1={frame().sx(0)} x2={frame().sx(0)} stroke="var(--axis)" stroke-width="1" />
          </Show>
        </g>
        <g>{backdrop()}</g>
        <g clip-path={`url(#${clipId})`}>
          <For each={visible()}>
            {(q) => (
              <path
                d={curvePath(q, frame().x0, frame().x1, frame().y0, frame().y1, frame().sx, frame().sy)}
                fill="none"
                stroke={q.color}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-dasharray={q.dash ? '6 4' : undefined}
                opacity={q.faint ? 0.55 : undefined}
              />
            )}
          </For>
        </g>
        <g>{marks()}</g>
        <Show when={hoverX() !== null}>
          <line
            x1={frame().sx(hoverX())}
            x2={frame().sx(hoverX())}
            y1={MARGIN.top}
            y2={frame().bottom}
            stroke="var(--ink-3)"
            stroke-width="1"
            stroke-dasharray="3 3"
          />
          <For each={readout().filter((r) => r.inside)}>
            {(r) => <circle cx={frame().sx(hoverX())} cy={frame().sy(r.y)} r="3.5" fill={r.q.color} stroke="var(--surface)" stroke-width="1.5" />}
          </For>
        </Show>
      </svg>
      <Show when={tip()}>
        {(t) => (
          <div class="llm-tip" style={tipStyle(t())}>
            {t().nodes}
          </div>
        )}
      </Show>
    </div>
  )
}
