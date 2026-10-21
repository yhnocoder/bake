import { For, createMemo, createResource, createSignal, onMount } from 'solid-js';
import './tex.css';

const ANCHORS = { start: 0, middle: 0.5, end: 1 };
const BASELINES = { top: 0, middle: 0.5, bottom: 1 };
const TEXT_ANCHORS = { start: 'start', middle: 'middle', end: 'end' };

function createFormula(tex, display, host) {
  const [formula] = createResource(
    () => [tex(), display()],
    async ([source, display]) => {
      try {
        const { texToSvg } = await import('bake/math');
        const svg = await texToSvg(source, { display });
        svg.setAttribute('aria-hidden', 'true');
        return svg;
      } catch (error) {
        console.error(`${host().closest('[data-component]').dataset.component}: the TeX label "${source}" cannot be typeset: ${error.message}`);
        return null;
      }
    },
  );
  return formula;
}

export function Tex(props) {
  let span;
  const formula = createFormula(() => props.tex, () => props.display === true, () => span);
  return (
    <span ref={span} class="bk-kit-tex" classList={{ 'bk-kit-tex-display': props.display }} role="img" aria-label={props.label ?? props.tex} style={{ 'min-width': props.width }}>
      {formula() === null ? props.tex : formula()}
    </span>
  );
}

export function SvgTex(props) {
  let group;
  const formula = createFormula(() => props.tex, () => false, () => group);
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
    <g ref={group} class={`bk-kit-svg-tex ${props.class ?? ''}`} style={props.style} role="img" aria-label={props.label ?? props.tex} transform={`translate(${props.x} ${props.y})`}>
      {placed() === null ? <text text-anchor={TEXT_ANCHORS[props.anchor ?? 'start']}>{props.tex}</text> : placed()}
    </g>
  );
}

// $$…$$ is a display formula, $…$ an inline formula, the rest is text.
function segments(text) {
  return text
    .split('$$')
    .flatMap((block, index) => (index % 2 === 1 ? [{ tex: block.trim(), display: true }] : block.split('$').map((part, inner) => (inner % 2 === 1 ? { tex: part } : { text: part }))))
    .filter((part) => part.text !== '');
}

export function MathText(props) {
  return (
    <span ref={props.ref} class={`bk-kit-math-text ${props.class ?? ''}`} style={props.style}>
      <For each={segments(props.text)}>{(part) => (part.tex === undefined ? part.text : <Tex tex={part.tex} display={part.display} />)}</For>
    </span>
  );
}

let measure;

// why: SVG text cannot hold a formula, so each part of the line is placed by the width the font gives its text
export function SvgMathText(props) {
  let group;
  const [font, setFont] = createSignal(null);
  onMount(() => {
    const style = getComputedStyle(group);
    measure ??= document.createElement('canvas').getContext('2d');
    measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    setFont({ css: measure.font, ex: measure.measureText('x').actualBoundingBoxAscent });
  });
  const [formulas] = createResource(
    () => segments(props.text).filter((part) => part.tex !== undefined),
    async (parts) => {
      const { texToSvg } = await import('bake/math');
      return Promise.all(
        parts.map((part) =>
          texToSvg(part.tex).catch((error) => {
            console.error(`${group.closest('[data-component]').dataset.component}: the TeX label "${part.tex}" cannot be typeset: ${error.message}`);
            return null;
          }),
        ),
      );
    },
  );
  const line = createMemo(() => {
    const typeset = formulas();
    if (font() === null || typeset === undefined) return null;
    measure.font = font().css;
    const { ex } = font();
    let left = 0;
    let index = 0;
    const nodes = segments(props.text).map((part) => {
      const at = left;
      const svg = part.tex === undefined ? null : typeset[index++];
      if (svg === null) {
        const text = part.text ?? part.tex;
        left += measure.measureText(text).width;
        return <text x={at}>{text}</text>;
      }
      const placed = svg.cloneNode(true);
      const [width, height] = ['width', 'height'].map((name) => parseFloat(placed.getAttribute(name)) * ex);
      const depth = -Number(/vertical-align:\s*(-?[\d.]+)ex/.exec(placed.getAttribute('style') ?? '')?.[1] ?? 0) * ex;
      left += width;
      placed.setAttribute('x', at);
      placed.setAttribute('y', depth - height);
      placed.setAttribute('width', width);
      placed.setAttribute('height', height);
      placed.setAttribute('overflow', 'visible');
      placed.setAttribute('aria-hidden', 'true');
      placed.removeAttribute('style');
      return placed;
    });
    return { nodes, width: left };
  });
  const left = () => {
    const width = line()?.width ?? 0;
    const x = props.x - width * ANCHORS[props.anchor ?? 'start'];
    return props.within === undefined ? x : Math.max(props.within[0], Math.min(props.within[1] - width, x));
  };
  return (
    <g
      ref={group}
      class={`bk-kit-svg-math-text ${props.class ?? ''}`}
      style={props.style}
      role="img"
      aria-label={props.label ?? props.text}
      transform={`translate(${left()} ${props.y})`}
    >
      {line()?.nodes}
    </g>
  );
}
