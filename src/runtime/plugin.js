import { fileURLToPath } from 'node:url';

const runtimeModule = 'bake/runtime';
const browserRuntime = fileURLToPath(new URL('./index.js', import.meta.url));
const nodeRuntime = fileURLToPath(new URL('./node.js', import.meta.url));

export function bakeRuntime() {
  return {
    name: 'bake-runtime',
    resolveId(id, importer, options) {
      if (id !== runtimeModule) return undefined;
      // why(#25): index.js only re-exports, so a component that does not import site must not run site.js and request site.json
      return options?.ssr ? nodeRuntime : { id: browserRuntime, moduleSideEffects: false };
    },
  };
}
