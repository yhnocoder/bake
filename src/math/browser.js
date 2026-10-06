import { mathjax } from '@mathjax/src/js/mathjax.js';
import macros from 'virtual:bake/math-config';
import fonts from 'virtual:bake/mathjax-fonts';
import { glyphPaths, renderFormula } from './mathjax.js';

mathjax.asyncLoad = (name) => fonts[name]();

export async function renderTex(tex, display) {
  const { svg, glyphIds } = await renderFormula(tex, display, macros);
  return { svg, glyphs: glyphPaths(glyphIds) };
}
