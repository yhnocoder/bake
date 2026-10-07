import { mathjax } from '@mathjax/src/js/mathjax.js';
import { createRenderer } from './mathjax.js';

mathjax.asyncLoad = (name) => import(name);

const renderer = createRenderer({ fontCache: 'global' });

export const renderFormula = renderer.render;

export function glyphDefinitions(glyphIds) {
  if (glyphIds.length === 0) return '';
  const paths = Object.entries(renderer.glyphPaths(glyphIds)).map(([id, d]) => `<path id="${id}" d="${d}"></path>`).join('');
  return `<svg id="math-defs" style="display:none"><defs>${paths}</defs></svg>`;
}
