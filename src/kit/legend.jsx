import { For } from 'solid-js';
import { Tex } from './tex.jsx';

export function Swatch(props) {
  return <i class="bk-kit-swatch" classList={{ 'bk-kit-dashed': props.dashed }} style={{ '--bk-kit-color': props.color }} />;
}

export function Legend(props) {
  return (
    <div class="bk-kit-legend">
      <For each={props.items}>
        {(item) => (
          <span class="bk-kit-legend-item">
            <Swatch color={item.color} dashed={item.dashed} />
            {item.tex === undefined ? item.label : <Tex tex={item.tex} width={item.texWidth} />}
          </span>
        )}
      </For>
    </div>
  );
}
