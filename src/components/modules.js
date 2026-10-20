import { join } from 'node:path';
import { lazyImports, mathModules, virtualModules } from '../bundle/modules.js';

export const RUNTIME_FILE = join(import.meta.dirname, 'runtime.js');
export const NODE_MATH_FILE = join(import.meta.dirname, 'node-math.js');

const KIT_DIR = join(import.meta.dirname, '../kit');
const KIT_SCRIPT = /\.jsx?$/;
const LOADERS_MODULE = 'bake:component-loaders';

export function browserModules({ preamble, components }) {
  const loaders = virtualModules('bake-component-loaders', {
    [LOADERS_MODULE]: () => lazyImports('loaders', components.map((component) => [component.name, component.path])),
  });
  return [mathModules(`export const definitions = ${JSON.stringify(preamble.map((definition) => definition.tex))};\n`), { ...loaders, transform: markKitModulesSideEffectFree }];
}

function markKitModulesSideEffectFree(code, id) {
  if (!id.startsWith(`${KIT_DIR}/`) || !KIT_SCRIPT.test(id)) return null;
  return { code, map: null, moduleSideEffects: false };
}
