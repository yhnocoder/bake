import { MATH_CLASS } from './reply.js';

const typeset = new Map();

export function typesetMath(container) {
  for (const element of container.querySelectorAll(`.${MATH_CLASS}`)) {
    const display = element.dataset.display === 'true';
    const key = `${display ? 'display' : 'inline'} ${element.dataset.tex}`;
    const done = typeset.get(key);
    if (typeof done === 'string') {
      element.innerHTML = done;
      element.dataset.state = 'ready';
    } else if (done === null) {
      element.dataset.state = 'failed';
    } else if (done === undefined) {
      typeset.set(
        key,
        import('bake/math')
          .then(({ texToSvg }) => texToSvg(element.dataset.tex, { display }))
          .then(
            (svg) => typeset.set(key, svg.outerHTML),
            () => typeset.set(key, null),
          )
          .then(() => container.isConnected && typesetMath(container)),
      );
    }
  }
}
