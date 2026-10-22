import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import { fileStart } from '../shared/report.js';
import { MATHJAX_CHUNK, isMathJaxModule } from './modules.js';

export const BAKE_ROOT = join(import.meta.dirname, '../..');

const SHARED_PACKAGES = ['solid-js'];
const LOCATION_SUFFIX = / \(\d+:\d+\)$/;
const SCRIPT_FILE_NAME = 'assets/[name]-[hash].js';
const ASSET_FILE_NAME = 'assets/[name]-[hash][extname]';

export function viteConfig({ plugins = [], alias = [] }) {
  return {
    configFile: false,
    envDir: false,
    root: BAKE_ROOT,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { dedupe: SHARED_PACKAGES, alias },
    plugins,
  };
}

// The modules are those of the whole module graph: a chunk leaves out a module whose exports were inlined, and its output still depends on it.
export async function viteBuild(config) {
  const modules = [];
  const graph = {
    name: 'bake-module-graph',
    buildEnd() {
      modules.push(...this.getModuleIds());
    },
  };
  const result = await build({ ...config, plugins: [...config.plugins, graph] });
  return { outputs: (Array.isArray(result) ? result[0] : result).output, modules };
}

export async function browserBuild({ input, plugins = [], alias = [], stylesheet }) {
  const { outputs, modules } = await viteBuild({
    ...viteConfig({ plugins, alias }),
    base: './',
    build: {
      write: false,
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input,
        output: {
          format: 'es',
          entryFileNames: SCRIPT_FILE_NAME,
          chunkFileNames: SCRIPT_FILE_NAME,
          assetFileNames: (asset) => (stylesheet !== undefined && isStylesheet(asset) ? stylesheet : ASSET_FILE_NAME),
          codeSplitting: { groups: [{ name: MATHJAX_CHUNK, test: isMathJaxModule }] },
        },
      },
    },
  });
  const chunks = new Map(outputs.filter((output) => output.type === 'chunk').map((chunk) => [chunk.fileName, chunk]));
  const entry = [...chunks.values()].find((chunk) => chunk.isEntry);
  const stylesheets = entry === undefined ? [] : staticStylesheets(entry, chunks);
  return {
    entry: entry?.fileName,
    stylesheets,
    files: outputs.map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source })),
    modules,
  };
}

export function blogPath(root, file) {
  return relative(root, file).split(sep).join('/');
}

function isInBlog(root, file) {
  return typeof file === 'string' && isAbsolute(file) && resolve(file).startsWith(`${resolve(root)}${sep}`);
}

export function compileProblem(root, error) {
  const cause = error.errors?.[0] ?? error;
  const file = cause.loc?.file ?? cause.id;
  const message = String(cause.message ?? cause)
    .split('\n')[0]
    .replace(`${file}: `, '')
    .replace(LOCATION_SUFFIX, '')
    // why: Rolldown names the modules in a message relative to the working directory, which is the blog root only when bake runs there
    .replaceAll(/"([^"]+)"/g, (quoted, path) => (isInBlog(root, resolve(path)) ? `"${blogPath(root, resolve(path))}"` : quoted));
  if (!isInBlog(root, file)) return { message, file: null, position: fileStart };
  const position = cause.loc?.line === undefined ? fileStart : { line: cause.loc.line, column: cause.loc.column + 1 };
  return { message, file: blogPath(root, file), position };
}

function staticStylesheets(chunk, chunks, visited = new Set()) {
  if (visited.has(chunk.fileName)) return [];
  visited.add(chunk.fileName);
  const imported = chunk.imports.flatMap((file) => staticStylesheets(chunks.get(file), chunks, visited));
  return [...new Set([...imported, ...chunk.viteMetadata.importedCss])];
}

function isStylesheet(asset) {
  return asset.names.some((file) => file.endsWith('.css'));
}
