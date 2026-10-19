import { createEffect, createResource, createSignal } from 'solid-js';

const ANCHORS = { start: 0, middle: 0.5, end: 1 };
const BASELINES = { top: 0, middle: 0.5, bottom: 1 };

async function typeset(tex) {
  const { texToSvg } = await import('bake/math');
  return texToSvg(tex);
}

export function Tex(props) {
  const [svg] = createResource(() => props.tex, typeset);
  return (
    <span class="bk-kit-tex" style={{ 'min-width': props.width }}>
      {svg()}
    </span>
  );
}

export function SvgTex(props) {
  const [svg] = createResource(() => props.tex, typeset);
  const [size, setSize] = createSignal(null);
  let group;
  createEffect(() => {
    const formula = svg();
    if (formula === undefined) return;
    const scale = group.getScreenCTM()?.a || 1;
    const rect = formula.getBoundingClientRect();
    setSize({ width: rect.width / scale, height: rect.height / scale });
  });
  const offset = () => {
    const { width, height } = size();
    return `translate(${props.x - width * ANCHORS[props.anchor ?? 'start']} ${props.y - height * BASELINES[props.baseline ?? 'middle']})`;
  };
  return (
    <g ref={group} class="bk-kit-svg-tex" visibility={size() === null ? 'hidden' : 'visible'} transform={size() === null ? undefined : offset()}>
      {svg()}
    </g>
  );
}
