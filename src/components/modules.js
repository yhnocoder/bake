import { join, posix } from 'node:path';
import { MATHJAX_CHUNK, lazyImports, mathModules, virtualModules } from '../bundle/modules.js';

export const RUNTIME_FILE = join(import.meta.dirname, 'runtime.js');
export const NODE_MATH_FILE = join(import.meta.dirname, 'node-math.js');
const SOLID_ELEMENT_FILE = join(import.meta.dirname, 'solid-element.js');

const KIT_DIR = join(import.meta.dirname, '../kit');
const KIT_SCRIPT = /\.jsx?$/;
const LOADERS_MODULE = 'bake:component-loaders';
const FILES_MARKER = 'bake:component-files';

export function browserModules({ preamble, components, prefetch }) {
  const loaders = virtualModules('bake-component-loaders', {
    [LOADERS_MODULE]: () =>
      [lazyImports('loaders', components.map((component) => [component.name, component.path])), `export const files = JSON.parse(${JSON.stringify(FILES_MARKER)});`, ''].join('\n'),
  });
  return [
    mathModules(`export const definitions = ${JSON.stringify(preamble.map((definition) => definition.tex))};\n`),
    { ...loaders, transform: markKitModulesSideEffectFree, generateBundle: (options, bundle) => writeComponentFiles(bundle, prefetch ? components : []) },
  ];
}

function writeComponentFiles(bundle, components) {
  const chunks = new Map(Object.values(bundle).filter((output) => output.type === 'chunk').map((chunk) => [chunk.fileName, chunk]));
  const byModule = new Map([...chunks.values()].map((chunk) => [chunk.facadeModuleId, chunk]));
  const runtime = [...chunks.values()].find((chunk) => chunk.isEntry);
  const solidElement = byModule.get(SOLID_ELEMENT_FILE);
  const files = {};
  for (const component of components) {
    const chunk = byModule.get(component.path);
    if (chunk === undefined) continue;
    const own = chunkFiles(chunk, chunks, runtime);
    const all = component.solid && solidElement !== undefined ? [...new Set([...own, ...chunkFiles(solidElement, chunks, runtime)])] : own;
    files[component.name] = all.map((file) => posix.relative(posix.dirname(runtime.fileName), file));
  }
  runtime.code = runtime.code.replace(new RegExp(`(["'\`])${FILES_MARKER}\\1`), () => JSON.stringify(JSON.stringify(files)));
}

function chunkFiles(chunk, chunks, runtime) {
  const files = new Set();
  const visit = (current) => {
    if (current === runtime || current.name === MATHJAX_CHUNK || files.has(current.fileName)) return;
    files.add(current.fileName);
    for (const css of current.viteMetadata?.importedCss ?? []) files.add(css);
    for (const file of current.imports) visit(chunks.get(file));
  };
  visit(chunk);
  return [...files];
}

function markKitModulesSideEffectFree(code, id) {
  if (!id.startsWith(`${KIT_DIR}/`) || !KIT_SCRIPT.test(id)) return null;
  return { code, map: null, moduleSideEffects: false };
}
