import { segments, texBox, texFailed } from './tex.js'

let measureContext
let uiFont

function textWidth(text, size) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  uiFont ??= getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif'
  measureContext.font = `500 ${size}px ${uiFont}`
  return measureContext.measureText(text).width
}

export function SvgLabel(props) {
  const size = props.size ?? 10.5
  const fill = props.fill ?? 'var(--ink)'
  const halo = props.halo !== false
  const nodes = () => {
    const parts = segments(props.text).map((part) =>
      part.math && !texFailed(part.text)
        ? { box: texBox(part.text, size * 1.1) }
        : { text: part.text, width: textWidth(part.text, size) },
    )
    if (parts.some((part) => part.box === null)) return []
    const total = parts.reduce((sum, part) => sum + (part.box ? part.box.width : part.width), 0)
    let x = props.anchor === 'middle' ? props.x - total / 2 : props.anchor === 'end' ? props.x - total : props.x
    return parts.map((part) => {
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
  }
  return <g pointer-events={props.interactive === false ? 'none' : undefined}>{nodes()}</g>
}
