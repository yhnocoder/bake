import './tex.css';

const SKIPPED = 'svg, script, style, textarea, .bk-kit-tex';

let math;
const afterFrame = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done)));

// why: evaluating MathJax takes 20 to 30 ms, typesetting the first labels about 10 ms and the first render of a component at its size up to 25 ms, so MathJax is imported after the frame that draws the component that asks for it and the formulas are typeset a frame later, and no frame holds two of them
export function loadMath() {
  math ??= afterFrame()
    .then(() => import('bake/math'))
    .then((module) => afterFrame().then(() => module));
  return math;
}

// $$…$$ is a display formula, $…$ an inline formula, the rest is text; a $ without a closing $ is text, as in the Markdown of an article.
export function segments(text) {
  return split(text, '$$', (tex) => ({ tex: tex.trim(), display: true }))
    .flatMap((part) => (part.text === undefined ? [part] : split(part.text, '$', (tex) => ({ tex }))))
    .filter((part) => part.text !== '');
}

function split(text, delimiter, formula) {
  const parts = text.split(delimiter);
  if (parts.length % 2 === 0) parts.splice(-2, 2, `${parts.at(-2)}${delimiter}${parts.at(-1)}`);
  return parts.map((part, index) => (index % 2 === 1 ? formula(part) : { text: part }));
}

// Replaces each $…$ and $$…$$ in the text inside root with the typeset formula, the way MathText shows a line; resolves when every formula is typeset.
export function typeset(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue.includes('$') && !node.parentElement.closest(SKIPPED)) nodes.push(node);
  }
  const formulas = [];
  for (const node of nodes) {
    node.replaceWith(
      ...segments(node.nodeValue).map((part) => {
        if (part.tex === undefined) return part.text;
        const span = document.createElement('span');
        span.className = part.display ? 'bk-kit-tex bk-kit-tex-display' : 'bk-kit-tex bk-kit-tex-inline';
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', part.tex);
        span.textContent = part.tex;
        formulas.push(typesetFormula(span, part));
        return span;
      }),
    );
  }
  return Promise.all(formulas);
}

async function typesetFormula(span, { tex, display }) {
  try {
    const { texToSvg } = await loadMath();
    const svg = await texToSvg(tex, { display });
    svg.setAttribute('aria-hidden', 'true');
    span.replaceChildren(svg);
  } catch (error) {
    console.error(`${span.closest('[data-component]').dataset.component}: the formula "${tex}" cannot be typeset: ${error.message}`);
  }
}
