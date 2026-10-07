import { mathjax } from '@mathjax/src/js/mathjax.js';
import macros from 'virtual:bake/math-config';
import fonts from 'virtual:bake/mathjax-fonts';
import { createRenderer } from './mathjax.js';

mathjax.asyncLoad = (name) => fonts[name]();

export function createMathRenderer({ fontCache }) {
  const renderer = createRenderer({ fontCache });
  return async (tex, { display }) => {
    const { svg, glyphIds } = await renderer.render(tex, display, macros);
    return { svg, glyphs: renderer.glyphPaths(glyphIds) };
  };
}
