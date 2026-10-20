import { Show, createMemo, createResource } from 'solid-js'
import { prefersReducedMotion } from 'bake/kit'
import { convert, mathHtml } from './tex.js'
import './view.css'

export function SketchLayer(props) {
  const [labels] = createResource(
    () => props.drawing.labels,
    (labels) => labels,
  )
  return (
    <>
      <g innerHTML={props.drawing.shapes} />
      <g class="matrix-tex" classList={{ 'matrix-tex-ready': labels() !== undefined }} innerHTML={labels() ?? ''} />
    </>
  )
}

export function SketchView(props) {
  const drawing = createMemo(() => props.drawing)
  return (
    <svg class={'matrix-sketch ' + (props.class || '')} viewBox={drawing().viewBox} role="img" aria-label={props.label} style={props.style}>
      <SketchLayer drawing={drawing()} />
    </svg>
  )
}

const easings = new WeakMap()

export function fadeIn(element) {
  if (!element || prefersReducedMotion()) return
  if (!easings.has(element)) easings.set(element, getComputedStyle(element).getPropertyValue('--ease').trim() || 'ease-out')
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: easings.get(element) })
}

export function MathText(props) {
  const [html] = createResource(() => props.text, mathHtml)
  return (
    <span
      ref={props.ref}
      class={'matrix-tex ' + (props.class || '')}
      classList={{ 'matrix-tex-ready': html() !== undefined }}
      style={props.style}
      innerHTML={html() ?? ''}
    />
  )
}

export function SvgTex(props) {
  const [shape] = createResource(() => props.tex, (tex) => convert(tex, false))
  const metrics = createMemo(() => {
    const math = shape()
    if (!math) return null
    const ex = (props.size || 13) * 0.45
    return { width: math.width * ex, height: math.height * ex, shift: math.shift * ex, viewBox: math.viewBox, body: math.body }
  })
  const left = () => {
    const width = metrics().width
    const align = props.align || 'middle'
    return align === 'middle' ? props.x - width / 2 : align === 'end' ? props.x - width : props.x
  }
  const top = () => props.y - metrics().height - metrics().shift
  return (
    <g class="matrix-tex" classList={{ 'matrix-tex-ready': !!metrics() }}>
      <Show when={metrics()}>
        {(math) => (
          <>
            <Show when={props.backdrop}>
              <rect x={left() - 4} y={top() - 2} width={math().width + 8} height={math().height + 4} rx="3" fill="var(--surface)" opacity="0.9" />
            </Show>
            <svg
              role="img"
              aria-label={props.tex}
              x={left()}
              y={top()}
              width={math().width}
              height={math().height}
              viewBox={math().viewBox}
              overflow="visible"
              fill="currentColor"
              style={{ color: props.color || 'var(--ink)' }}
              innerHTML={math().body}
            />
          </>
        )}
      </Show>
    </g>
  )
}
