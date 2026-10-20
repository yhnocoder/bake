import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import { fileStart } from '../report.js';
import { isMathJaxModule } from './modules.js';

export const BAKE_ROOT = join(import.meta.dirname, '../..');

const SHARED_PACKAGES = ['solid-js'];
const LOCATION_SUFFIX = / \(\d+:\d+\)$/;
const SCRIPT_FILE_NAME = assetFileName('[name]', '.js');
const ASSET_FILE_NAME = assetFileName('[name]', '[extname]');

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

export function assetFileName(name, extension) {
  return `assets/${name}-[hash]${extension}`;
}

export async function browserBuild({ input, plugins = [], alias = [], format, names = {} }) {
  const single = format === 'iife';
  const result = await build({
    ...viteConfig({ plugins, alias }),
    base: './',
    build: {
      write: false,
      cssCodeSplit: !single,
      assetsInlineLimit: 0,
      modulePreload: single ? false : { polyfill: false },
      rolldownOptions: {
        input,
        output: {
          format,
          entryFileNames: names.entry ?? SCRIPT_FILE_NAME,
          chunkFileNames: SCRIPT_FILE_NAME,
          assetFileNames: (asset) => (names.stylesheet !== undefined && isStylesheet(asset) ? names.stylesheet : ASSET_FILE_NAME),
          codeSplitting: single ? false : { groups: [{ name: 'mathjax', test: isMathJaxModule }] },
        },
      },
    },
  });
  const outputs = outputOf(result);
  return {
    entry: outputs.find((output) => output.type === 'chunk' && output.isEntry)?.fileName,
    files: outputs.map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source })),
    modules: outputs.flatMap((output) => (output.type === 'chunk' ? output.moduleIds : [])),
  };
}

export function outputOf(result) {
  return (Array.isArray(result) ? result[0] : result).output;
}

export function blogPath(root, file) {
  return relative(root, file).split(sep).join('/');
}

export function isInBlog(root, file) {
  return typeof file === 'string' && isAbsolute(file) && resolve(file).startsWith(`${resolve(root)}${sep}`);
}

export function compileProblem(root, error) {
  const cause = error.errors?.[0] ?? error;
  const file = cause.loc?.file ?? cause.id;
  const message = String(cause.message ?? cause)
    .split('\n')[0]
    .replace(`${file}: `, '')
    .replace(LOCATION_SUFFIX, '');
  if (!isInBlog(root, file)) return { message, file: null, position: fileStart };
  const position = cause.loc?.line === undefined ? fileStart : { line: cause.loc.line, column: cause.loc.column + 1 };
  return { message, file: blogPath(root, file), position };
}

function isStylesheet(asset) {
  return asset.names.some((file) => file.endsWith('.css'));
}
