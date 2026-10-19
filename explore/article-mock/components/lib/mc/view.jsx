import { createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { convert, mathHtml } from './tex.js'
import './mc.css'

export function SketchView(props) {
  const [drawing] = createResource(() => props.source(), (source) => source)
  return (
    <svg
      class={'mc-sketch ' + (props.class || '')}
      viewBox={drawing()?.viewBox || props.viewBox}
      role="img"
      aria-label={props.label}
      style={props.style}
      innerHTML={drawing()?.markup || ''}
    />
  )
}

export function useWidth(element) {
  const [width, setWidth] = createSignal(0)
  onMount(() => {
    const target = element()
    setWidth(target.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(target)
    onCleanup(() => observer.disconnect())
  })
  return width
}

export function MathText(props) {
  const [html] = createResource(() => props.text, mathHtml)
  return <span class={props.class} style={props.style} innerHTML={html() ?? ''} />
}

export function SvgTex(props) {
  const [shape] = createResource(() => props.tex, (tex) => convert(tex, false))
  const size = () => props.size || 13
  const box = () => {
    const math = shape()
    if (!math) return null
    const ex = size() * 0.45
    const width = math.width * ex
    const height = math.height * ex
    const align = props.align || 'middle'
    const left = align === 'middle' ? props.x - width / 2 : align === 'end' ? props.x - width : props.x
    return { left, top: props.y - height - math.shift * ex, width, height, math }
  }
  return (
    <>
      {box() && props.backdrop && (
        <rect
          x={box().left - 4}
          y={box().top - 2}
          width={box().width + 8}
          height={box().height + 4}
          rx="3"
          fill="var(--surface)"
          opacity="0.9"
        />
      )}
      {box() && (
        <svg
          x={box().left}
          y={box().top}
          width={box().width}
          height={box().height}
          viewBox={box().math.viewBox}
          overflow="visible"
          fill="currentColor"
          style={{ color: props.color || 'var(--ink)', opacity: props.opacity ?? 1 }}
          innerHTML={box().math.body}
        />
      )}
    </>
  )
}
