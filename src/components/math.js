import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import { fontFiles } from 'bake:math-font';
import { definitions } from 'bake:preamble';
import { TEX_PACKAGES } from '../render/tex.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
mathjax.asyncLoad = (name) => fontFiles[name.slice(name.lastIndexOf('/') + 1)]();

const tex = new TeX({
  packages: TEX_PACKAGES,
  formatError(jax, error) {
    throw new Error(`MathJax cannot typeset this formula: ${error.message}`);
  },
});
const svg = new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none', linebreaks: { inline: false } });
const mathDocument = mathjax.document('', { InputJax: tex, OutputJax: svg });
for (const definition of definitions) mathDocument.convert(definition, { end: STATE.COMPILED });

export async function texToSvg(formula, { display = false } = {}) {
  const container = await mathjax.handleRetriesFor(() => mathDocument.convert(formula, { display }));
  const template = document.createElement('template');
  template.innerHTML = adaptor.outerHTML(adaptor.firstChild(container));
  return template.content.firstElementChild;
}
