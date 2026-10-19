import { createEffect, createResource, createSignal } from 'solid-js';
import './tex.css';

const ANCHORS = { start: 0, middle: 0.5, end: 1 };
const BASELINES = { top: 0, middle: 0.5, bottom: 1 };

function createFormula(tex, host) {
  const [formula] = createResource(tex, async (source) => {
    try {
      const { texToSvg } = await import('bake/math');
      const svg = await texToSvg(source);
      svg.setAttribute('aria-hidden', 'true');
      return svg;
    } catch (error) {
      console.error(`${host().closest('[data-component]').dataset.component}: the TeX label "${source}" cannot be typeset: ${error.message}`);
      return null;
    }
  });
  return formula;
}

export function Tex(props) {
  let span;
  const formula = createFormula(() => props.tex, () => span);
  return (
    <span ref={span} class="bk-kit-tex" role="img" aria-label={props.label ?? props.tex} style={{ 'min-width': props.width }}>
      {formula() === null ? props.tex : formula()}
    </span>
  );
}

export function SvgTex(props) {
  let group;
  const formula = createFormula(() => props.tex, () => group);
  const [size, setSize] = createSignal(null);
  createEffect(() => {
    const svg = formula();
    if (svg === undefined) return;
    if (svg === null) return setSize({ width: 0, height: 0 });
    const scale = group.getScreenCTM()?.a || 1;
    const rect = svg.getBoundingClientRect();
    setSize({ width: rect.width / scale, height: rect.height / scale });
  });
  const offset = () => {
    const { width, height } = size();
    return `translate(${props.x - width * ANCHORS[props.anchor ?? 'start']} ${props.y - height * BASELINES[props.baseline ?? 'middle']})`;
  };
  return (
    <g ref={group} class="bk-kit-svg-tex" role="img" aria-label={props.label ?? props.tex} visibility={size() === null ? 'hidden' : 'visible'} transform={size() === null ? undefined : offset()}>
      {formula() === null ? <text>{props.tex}</text> : formula()}
    </g>
  );
}
