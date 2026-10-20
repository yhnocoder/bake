import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { STATE } from '@mathjax/src/js/core/MathItem.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { Configuration } from '@mathjax/src/js/input/tex/Configuration.js';
import { CommandMap } from '@mathjax/src/js/input/tex/TokenMap.js';
import { AmsTags } from '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import BaseMethods from '@mathjax/src/js/input/tex/base/BaseMethods.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import { TEX_PACKAGES } from './tex.js';

const EM = 16;
const EX = 8;
const CONTAINER_WIDTH = 820;
const ID_ATTRIBUTE = / id="([^"]*)"/g;
const LATEX_ATTRIBUTE = / data-latex(?:-item)?="[^"]*"/g;
const GLYPH_PATH = /<path id="([^"]+)"[^>]*><\/path>/g;
const GLYPH_USE = /xlink:href="#([^"]+)"/g;
const IN_PAGE_HREF = / href="#/g;
const GLYPH_DEFS_END = '</defs>';

export const EQUATION_ID_PREFIX = 'eq-';

const BAKE_PACKAGE = 'bake';
const PACKAGE_BEFORE_BASE_AND_AMS = 4;

class BakeTags extends AmsTags {
  startEquation(math) {
    super.startEquation(math);
    this.recorded = { labels: [], references: [] };
  }

  finalize(node, env) {
    if (!env.display || this.currentTag.env || !this.label || this.history.some((tag) => tag.taggable)) return super.finalize(node, env);
    Object.assign(this.currentTag, { taggable: true, defaultTags: true });
    const tag = this.getTag();
    return tag === null ? node : this.enTag(node, tag);
  }

  formatId(id) {
    return this.label ? id : `${EQUATION_ID_PREFIX}${id}`;
  }
}

function peekArgument(parser, name) {
  const start = parser.i;
  const argument = parser.GetArgument(name);
  parser.i = start;
  return argument;
}

function recordLabel(parser, name) {
  parser.tags.recorded.labels.push({ name: peekArgument(parser, name), afterEnvironment: !parser.tags.currentTag.env && parser.tags.history.length > 0 });
  return BaseMethods.HandleLabel(parser, name);
}

function recordReference(parser, name, eqref) {
  const label = peekArgument(parser, name);
  parser.tags.recorded.references.push({ text: `${name}{${label}}`, label });
  return BaseMethods.HandleRef(parser, name, eqref);
}

new CommandMap('bake-equation-references', { label: recordLabel, ref: [recordReference, false], eqref: [recordReference, true] });
Configuration.create(BAKE_PACKAGE, {
  handler: { macro: ['bake-equation-references'] },
  tags: { [BAKE_PACKAGE]: BakeTags },
  priority: PACKAGE_BEFORE_BASE_AND_AMS,
});

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
let fontPromise = null;

function loadFont() {
  fontPromise ??= (async () => {
    // why: a component module that Bake reads in Node shares this MathJax and can replace asyncLoad with a loader of its closed Vite runner
    mathjax.asyncLoad = (name) => import(name);
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
    packages: [...TEX_PACKAGES, BAKE_PACKAGE],
    tags: BAKE_PACKAGE,
    formatError(jax, error) {
      current.error ??= error.message;
      return jax.formatError(error);
    },
  });
  const svg = new SVG({ fontCache: 'global', fontData: font });
  const document = mathjax.document('', { InputJax: tex, OutputJax: svg });
  svg.clearFontCache();
  const compile = (entry) => {
    current = entry;
    entry.item.convert(document, STATE.COMPILED);
    entry.recorded = tex.parseOptions.tags.recorded;
  };
  const entries = [...definitions.map((definition) => ({ tex: definition.tex, display: false })), ...formulas].map((formula) => {
    const item = new document.options.MathItem(formula.tex, tex, formula.display);
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
    const html = adaptor.outerHTML(container).replace(LATEX_ATTRIBUTE, '');
    return { html, error: entry.error, references: entry.recorded.references, labels: entry.recorded.labels, ids: [...html.matchAll(ID_ATTRIBUTE)].map(([, id]) => id) };
  });
  const glyphs = formulas.length === 0 ? undefined : adaptor.outerHTML(svg.pageElements(document));
  return { definitionErrors: entries.slice(0, definitions.length).map((entry) => entry.error), results, labels, glyphs };
}

export async function mathStyles() {
  const font = await loadFont();
  const svg = new SVG({ fontCache: 'global', fontData: font });
  const document = mathjax.document('', { InputJax: new TeX({ packages: TEX_PACKAGES }), OutputJax: svg });
  return adaptor.textContent(svg.styleSheet(document));
}

export function relocateMath(html, base) {
  return html.replace(ID_ATTRIBUTE, '').replace(IN_PAGE_HREF, () => ` href="${base}#`);
}

export function addGlyphs(own, borrowed, html) {
  const known = new Set(own === undefined ? [] : [...own.matchAll(GLYPH_PATH)].map(([, id]) => id));
  const used = new Set(html.flatMap((fragment) => [...fragment.matchAll(GLYPH_USE)].map(([, id]) => id)));
  const added = new Map();
  for (const fragment of borrowed) {
    for (const [path, id] of fragment?.matchAll(GLYPH_PATH) ?? []) {
      if (used.has(id) && !known.has(id)) added.set(id, path);
    }
  }
  if (added.size === 0) return own;
  const paths = [...added.values()].join('');
  if (own !== undefined) return own.replace(GLYPH_DEFS_END, () => `${paths}${GLYPH_DEFS_END}`);
  return `<svg style="display: none;" xmlns="http://www.w3.org/2000/svg" id="MJX-SVG-global-cache"><defs>${paths}${GLYPH_DEFS_END}</svg>`;
}
