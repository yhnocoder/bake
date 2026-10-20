import { createMemo } from 'solid-js'
import { segments, texBox } from './tex.js'

let measureContext
let uiFont

function textWidth(text, size) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  uiFont ??= getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif'
  measureContext.font = `500 ${size}px ${uiFont}`
  return measureContext.measureText(text).width
}

function layoutParts(source, size) {
  return segments(source).map((part) => {
    const box = part.math ? texBox(part.text, size * 1.1) : null
    if (box !== null) return { box }
    return { text: part.text, width: textWidth(part.text, size) }
  })
}

function labelContent(source, size, fill, halo) {
  const parts = layoutParts(source, size)
  let x = 0
  const nodes = parts.map((part) => {
    const left = x
    if (part.text) {
      x += part.width
      return (
        <text
          x={left}
          y={0}
          font-size={size}
          font-weight="500"
          fill={fill}
          class="llm-label-text"
          stroke={halo ? 'var(--surface)' : undefined}
          stroke-width={halo ? 3 : undefined}
          paint-order={halo ? 'stroke' : undefined}
        >
          {part.text}
        </text>
      )
    }
    const { svg, width, height, ascent } = part.box
    x += width
    svg.setAttribute('x', left)
    svg.setAttribute('y', -ascent)
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    svg.setAttribute('overflow', 'visible')
    svg.style.color = fill
    if (halo) svg.classList.add('llm-halo')
    return svg
  })
  return { nodes, width: x }
}

export function SvgLabel(props) {
  const content = createMemo(() => labelContent(props.text, props.size ?? 10.5, props.fill ?? 'var(--ink)', props.halo !== false))
  const shift = () => (props.anchor === 'middle' ? content().width / 2 : props.anchor === 'end' ? content().width : 0)
  return (
    <g transform={`translate(${props.x - shift()} ${props.y})`} pointer-events={props.interactive === false ? 'none' : undefined}>
      {content().nodes}
    </g>
  )
}
