import { createResource } from 'solid-js';
import './tex.css';

const ANCHORS = { start: 0, middle: 0.5, end: 1 };
const BASELINES = { top: 0, middle: 0.5, bottom: 1 };
const TEXT_ANCHORS = { start: 'start', middle: 'middle', end: 'end' };

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
  const placed = () => {
    const svg = formula();
    if (svg === undefined || svg === null) return svg;
    const width = parseFloat(svg.getAttribute('width'));
    const height = parseFloat(svg.getAttribute('height'));
    const depth = -Number(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg.getAttribute('style') ?? '')?.[1] ?? 0);
    const top = props.baseline === 'baseline' ? height - depth : height * BASELINES[props.baseline ?? 'middle'];
    svg.setAttribute('x', `${-width * ANCHORS[props.anchor ?? 'start']}ex`);
    svg.setAttribute('y', `${-top}ex`);
    svg.setAttribute('overflow', 'visible');
    svg.removeAttribute('style');
    return svg;
  };
  return (
    <g ref={group} class="bk-kit-svg-tex" role="img" aria-label={props.label ?? props.tex} transform={`translate(${props.x} ${props.y})`}>
      {placed() === null ? <text text-anchor={TEXT_ANCHORS[props.anchor ?? 'start']}>{props.tex}</text> : placed()}
    </g>
  );
}
