import { For, createMemo } from 'solid-js'
import { SvgMathText, SvgTex, prefersReducedMotion } from 'bake/kit'
import './view.css'

export function SketchLayer(props) {
  return (
    <>
      <g innerHTML={props.drawing.shapes} />
      <For each={props.drawing.labels}>
        {(label) => {
          const style = { 'font-size': `${label.size}px`, fill: label.color || 'var(--ink)', color: label.color || 'var(--ink)' }
          return label.tex === undefined ? (
            <SvgMathText class="matrix-label" text={label.text} x={label.x} y={label.y} anchor={label.align} style={style} />
          ) : (
            <SvgTex class={label.backdrop ? 'matrix-label matrix-backdrop' : 'matrix-label'} tex={label.tex} x={label.x} y={label.y} anchor={label.align} baseline="baseline" style={style} />
          )
        }}
      </For>
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
