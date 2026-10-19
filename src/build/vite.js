import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileStart } from '../report.js';

export const BAKE_ROOT = join(import.meta.dirname, '../..');

const SHARED_PACKAGES = ['solid-js'];
const LOCATION_SUFFIX = / \(\d+:\d+\)$/;

export function viteConfig(plugins) {
  return {
    configFile: false,
    envDir: false,
    root: BAKE_ROOT,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { dedupe: SHARED_PACKAGES },
    plugins,
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
