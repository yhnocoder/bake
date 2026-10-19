import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_FILE = join(import.meta.dirname, 'runtime.js');

const MATH_MODULE = 'bake/math';
const MATH_FILE = join(import.meta.dirname, 'math.js');
const PREAMBLE_MODULE = 'bake:preamble';
const MATH_FONT_MODULE = 'bake:math-font';
const LOADERS_MODULE = 'bake:component-loaders';
const FONT_DIR = join(dirname(fileURLToPath(import.meta.resolve('@mathjax/mathjax-newcm-font/js/svg.js'))), 'svg/dynamic');
const NODE_MATH_MODULE = ["export async function texToSvg() {", "  throw new Error('texToSvg typesets formulas in the browser, inside the component code');", '}', ''].join('\n');

export function isMathJaxModule(id) {
  return id.includes('/node_modules/@mathjax/') && !id.startsWith(FONT_DIR);
}

export function nodeModules() {
  return virtualModules('bake-node-modules', { [MATH_MODULE]: () => NODE_MATH_MODULE });
}

export function browserModules({ preamble, components }) {
  return virtualModules(
    'bake-browser-modules',
    {
      [PREAMBLE_MODULE]: () => `export const definitions = ${JSON.stringify(preamble.map((definition) => definition.tex))};\n`,
      [MATH_FONT_MODULE]: () => lazyImports('fontFiles', fontFiles()),
      [LOADERS_MODULE]: () => lazyImports('loaders', components.map((component) => [component.name, component.path])),
    },
    { [MATH_MODULE]: MATH_FILE },
  );
}

function virtualModules(name, sources, files = {}) {
  return {
    name,
    enforce: 'pre',
    resolveId(source) {
      if (Object.hasOwn(files, source)) return files[source];
      return Object.hasOwn(sources, source) ? `\0${source}` : null;
    },
    load(id) {
      if (!id.startsWith('\0') || !Object.hasOwn(sources, id.slice(1))) return null;
      return sources[id.slice(1)]();
    },
  };
}

function fontFiles() {
  return readdirSync(FONT_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => [file, join(FONT_DIR, file)]);
}

function lazyImports(name, entries) {
  const lines = entries.map(([key, path]) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(path)}),`);
  return [`export const ${name} = {`, ...lines, '};', ''].join('\n');
}
