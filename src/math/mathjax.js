import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const glyphReference = /href="#(MJX-[^"]+)"/g;
const latexAttribute = / data-latex(?:-item)?="[^"]*"/g;

const formulaCache = new Map();
const glyphs = new Map();
let current = { macros: null, document: null, output: null };
let queue = Promise.resolve();

function documentFor(macros) {
  const key = JSON.stringify(macros);
  if (current.macros === key) return current;
  const input = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros'],
    macros,
    formatError: (_, error) => {
      throw error;
    },
  });
  const output = new SVG({ fontData: MathJaxNewcmFont, fontCache: 'global', useXlink: false, linebreaks: { inline: false } });
  formulaCache.clear();
  current = { macros: key, document: mathjax.document('', { InputJax: input, OutputJax: output }), output };
  return current;
}

async function convert(tex, display, macros) {
  const { document, output } = documentFor(macros);
  const container = await document.convertPromise(tex, { display });
  const svg = adaptor.outerHTML(adaptor.firstChild(container)).replace(latexAttribute, '');
  const glyphIds = [...new Set([...svg.matchAll(glyphReference)].map((match) => match[1]))];
  for (const id of glyphIds) glyphs.set(id, output.fontCache.cache.get(id));
  return { svg, glyphIds };
}

export function renderFormula(tex, display, macros = {}) {
  const result = queue.then(() => {
    documentFor(macros);
    const key = `${display ? 'display' : 'inline'}:${tex}`;
    const cached = formulaCache.get(key);
    if (cached) return cached;
    return convert(tex, display, macros).then((converted) => {
      formulaCache.set(key, converted);
      return converted;
    });
  });
  queue = result.catch(() => {});
  return result;
}

export function glyphPaths(glyphIds) {
  return Object.fromEntries(glyphIds.map((id) => [id, glyphs.get(id)]));
}

export function glyphDefinitions(glyphIds) {
  if (glyphIds.length === 0) return '';
  const paths = Object.entries(glyphPaths(glyphIds)).map(([id, d]) => `<path id="${id}" d="${d}"></path>`).join('');
  return `<svg id="math-defs" style="display:none"><defs>${paths}</defs></svg>`;
}
