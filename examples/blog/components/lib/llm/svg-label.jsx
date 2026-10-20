import { segments, texBox } from './tex.js'

let measureContext
let uiFont

function textWidth(text, size) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  uiFont ??= getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif'
  measureContext.font = `500 ${size}px ${uiFont}`
  return measureContext.measureText(text).width
}

export function labelWidth(source, size = 10.5) {
  return segments(source).reduce((sum, part) => sum + (part.math ? texBox(part.text, size * 1.1).width : textWidth(part.text, size)), 0)
}

export function SvgLabel(props) {
  const size = props.size ?? 10.5
  const fill = props.fill ?? 'var(--ink)'
  const halo = props.halo !== false
  const parts = segments(props.text).map((part) =>
    part.math ? { box: texBox(part.text, size * 1.1) } : { text: part.text, width: textWidth(part.text, size) },
  )
  const total = parts.reduce((sum, part) => sum + (part.box ? part.box.width : part.width), 0)
  let x = props.anchor === 'middle' ? props.x - total / 2 : props.anchor === 'end' ? props.x - total : props.x
  const nodes = parts.map((part) => {
    const left = x
    if (part.text) {
      x += part.width
      return (
        <text
          x={left}
          y={props.y}
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
    svg.setAttribute('y', props.y - ascent)
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    svg.setAttribute('overflow', 'visible')
    svg.style.color = fill
    if (halo) svg.classList.add('llm-halo')
    return svg
  })
  return <g pointer-events={props.interactive === false ? 'none' : undefined}>{nodes}</g>
}
