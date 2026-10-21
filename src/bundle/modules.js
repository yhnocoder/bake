import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_THEMES } from '../config/rules.js';

const SRC_DIR = join(import.meta.dirname, '..');
const PREAMBLE_MODULE = 'bake:preamble';
const MATH_FONT_MODULE = 'bake:math-font';
export const MATHJAX_CHUNK = 'mathjax';
const FONT_DIR = join(dirname(fileURLToPath(import.meta.resolve('@mathjax/mathjax-newcm-font/js/svg.js'))), 'svg/dynamic');

export const PUBLIC_MODULES = Object.freeze([
  { name: 'bake/copy', file: join(SRC_DIR, 'copy/copy.js'), importers: ['themes'] },
  { name: 'bake/fragments', file: join(SRC_DIR, 'fragments.js'), importers: ['themes'] },
  { name: 'bake/keys', file: join(SRC_DIR, 'keys.js'), importers: ['themes'] },
  { name: 'bake/live', file: join(SRC_DIR, 'live.js'), importers: ['themes'] },
  { name: 'bake/regions', file: join(SRC_DIR, 'regions.js'), importers: ['themes'] },
  { name: 'bake/math', file: join(SRC_DIR, 'components/math.js'), importers: ['components', 'chat'] },
  { name: 'bake/kit', file: join(SRC_DIR, 'kit/index.js'), importers: ['components'] },
  { name: 'bake/theme', file: join(SRC_DIR, 'theme/index.jsx'), importers: ['themes'] },
  { name: 'bake/theme/client', file: join(SRC_DIR, 'theme/client.js'), importers: ['themes'] },
  ...BUILT_IN_THEMES.flatMap((theme) => [
    { name: `bake/themes/${theme}`, file: join(SRC_DIR, `themes/${theme}/index.jsx`), importers: ['themes'] },
    { name: `bake/themes/${theme}/client`, file: join(SRC_DIR, `themes/${theme}/client.jsx`), importers: ['themes'] },
    { name: `bake/themes/${theme}/options`, file: join(SRC_DIR, `themes/${theme}/options.js`), importers: ['themes'] },
  ]),
]);

const PUBLIC_STYLES = Object.freeze([{ name: 'bake/theme/styles/', folder: join(SRC_DIR, 'theme/styles/') }, ...BUILT_IN_THEMES.map((theme) => ({ name: `bake/themes/${theme}/styles/`, folder: join(SRC_DIR, `themes/${theme}/styles/`) }))]);

export function publicModules(importer) {
  const modules = PUBLIC_MODULES.filter((module) => module.importers.includes(importer)).map(({ name, file }) => ({ find: new RegExp(`^${name}$`), replacement: file }));
  return importer === 'themes' ? [...modules, ...PUBLIC_STYLES.map(({ name, folder }) => ({ find: new RegExp(`^${name}`), replacement: folder }))] : modules;
}

export function mathModules(preamble) {
  return virtualModules('bake-math-modules', {
    [PREAMBLE_MODULE]: () => preamble,
    [MATH_FONT_MODULE]: () => lazyImports('fontFiles', fontFiles()),
  });
}

export function isMathJaxModule(id) {
  return id.includes('/node_modules/@mathjax/') && !id.startsWith(FONT_DIR);
}

export function virtualModules(name, sources) {
  return {
    name,
    enforce: 'pre',
    resolveId(source) {
      return Object.hasOwn(sources, source) ? `\0${source}` : null;
    },
    load(id) {
      if (!id.startsWith('\0') || !Object.hasOwn(sources, id.slice(1))) return null;
      return sources[id.slice(1)]();
    },
  };
}

export function lazyImports(name, entries) {
  const lines = entries.map(([key, path]) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(path)}),`);
  return [`export const ${name} = {`, ...lines, '};', ''].join('\n');
}

function fontFiles() {
  return readdirSync(FONT_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => [file, join(FONT_DIR, file)]);
}
