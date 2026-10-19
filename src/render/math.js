import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js';
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';

const PACKAGES = ['base', 'ams', 'boldsymbol', 'braket', 'cancel', 'cases', 'color', 'gensymb', 'mathtools', 'newcommand', 'tagformat', 'upgreek'];
const EM = 16;
const EX = 8;
const CONTAINER_WIDTH = 820;
const NUMBERED_ENVIRONMENT = /^\s*\\begin\{(equation|align|gather|multline|flalign|alignat|eqnarray)\*?\}/;
const LABEL = /\\label\s*\{/;
const REFERENCE = /\\(?:eq)?ref\s*\{([^{}]*)\}/g;
const LATEX_ATTRIBUTE = / data-latex(?:-item)?="[^"]*"/g;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
mathjax.asyncLoad = (name) => import(name);

let fontPromise = null;

function loadFont() {
  fontPromise ??= (async () => {
    const font = new MathJaxNewcmFont();
    await font.loadDynamicFiles();
    return font;
  })();
  return fontPromise;
}

export async function typesetMath(definitions, formulas) {
  const font = await loadFont();
  let current = null;
  const tex = new TeX({
    packages: PACKAGES,
    tags: 'ams',
    tagformat: { id: (label) => label },
    formatError(jax, error) {
      current.error ??= error.message;
      return jax.formatError(error);
    },
  });
  const svg = new SVG({ fontCache: 'local', fontData: font });
  const document = mathjax.document('', { InputJax: tex, OutputJax: svg });
  const compile = (entry) => {
    current = entry;
    entry.item.convert(document, STATE.COMPILED);
  };
  const entries = [...definitions.map((definition) => ({ tex: definition.tex, display: false })), ...formulas].map((formula) => {
    const source = formula.display && LABEL.test(formula.tex) && !NUMBERED_ENVIRONMENT.test(formula.tex) ? `\\begin{equation}${formula.tex}\\end{equation}` : formula.tex;
    const item = new document.options.MathItem(source, tex, formula.display);
    item.start.node = adaptor.body(document.document);
    item.setMetrics(EM, EX, CONTAINER_WIDTH, 1);
    return { item, error: undefined };
  });
  for (const entry of entries) compile(entry);
  for (const entry of entries) {
    const recompile = entry.item.inputData.recompile;
    if (recompile === undefined) continue;
    entry.item.state(recompile.state);
    entry.item.inputData.recompile = recompile;
    compile(entry);
  }
  const labels = new Map(Object.entries(tex.parseOptions.tags.allLabels).map(([label, { tag, id }]) => [label, { tag, id }]));
  const results = entries.slice(definitions.length).map((entry, index) => {
    entry.item.convert(document, STATE.LAST);
    const container = entry.item.typesetRoot;
    adaptor.setAttribute(container, 'data-tex', formulas[index].tex);
    const references = [...formulas[index].tex.matchAll(REFERENCE)].map(([text, label]) => ({ text, label }));
    return { html: adaptor.outerHTML(container).replace(LATEX_ATTRIBUTE, ''), error: entry.error, references };
  });
  return { definitionErrors: entries.slice(0, definitions.length).map((entry) => entry.error), results, labels };
}

export async function mathStyles() {
  const font = await loadFont();
  const svg = new SVG({ fontCache: 'local', fontData: font });
  const document = mathjax.document('', { InputJax: new TeX({ packages: PACKAGES }), OutputJax: svg });
  return adaptor.textContent(svg.styleSheet(document));
}

export function equationHref(id) {
  return `#${encodeURIComponent(id)}`;
}
