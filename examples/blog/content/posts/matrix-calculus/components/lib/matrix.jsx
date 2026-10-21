import { For } from 'solid-js'
import { MathText } from 'bake/kit'
import './matrix.css'

export function Matrix(props) {
  return (
    <div
      class={'matrix-matrix ' + (props.kind || '')}
      style={{ 'grid-template-columns': `repeat(${props.columns},auto)` }}
      onPointerLeave={() => props.onLeave?.()}
    >
      <For each={props.cells}>
        {(cell) => (
          <div class="matrix-cell" classList={{ on: props.lit.has(cell.key) }} onPointerEnter={() => props.onEnter?.(cell)}>
            <b>{typeof cell.value === 'function' ? cell.value() : cell.value}</b>
            {cell.label && (
              <small>
                <MathText text={cell.label} />
              </small>
            )}
          </div>
        )}
      </For>
    </div>
  )
}
