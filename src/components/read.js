import { readdirSync, statSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import { publicModules } from '../bundle/modules.js';
import { blogPath, compileProblem, isInBlog, viteConfig } from '../bundle/vite.js';
import { errorAt, fileStart } from '../report.js';
import { checkDeclarations } from './declarations.js';
import { NODE_MATH_FILE } from './modules.js';

export const COMPONENTS_DIR = 'components';
export const BROWSER_GLOBALS = Object.freeze([
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'customElements',
  'matchMedia',
  'getComputedStyle',
  'requestAnimationFrame',
  'ResizeObserver',
  'IntersectionObserver',
]);

const COMPONENT_EXTENSIONS = ['.js', '.jsx'];
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const RESERVED_NAMES = ['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'];
const UNDEFINED_NAME = /^(\S+) is not defined$/;
// why: modules that ssrLoadModule cached from an earlier component extend the HTMLElement of that load, so every load uses the same class
const NODE_HTML_ELEMENT = class HTMLElement {};
const STACK_LOCATION = /\(?((?:file:\/\/)?[^\s()]+):(\d+):(\d+)\)?$/;

export async function readComponents(root, { builtInBlocks }, errors) {
  const files = componentFiles(root, builtInBlocks, errors);
  const components = new Map();
  if (files.size === 0) return components;
  // why: the Vite dev server sets NODE_ENV to development, and later builds in this process would then bundle Solid's development build
  const environment = process.env.NODE_ENV;
  const server = await createServer({
    ...viteConfig({ plugins: [solid({ ssr: true })], alias: publicModules('components', { 'bake/math': NODE_MATH_FILE }) }),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  });
  try {
    for (const [name, file] of files) {
      const path = join(root, file);
      const module = await loadModule(server, path);
      if (module.error !== undefined) {
        errors.push(loadError(server, root, name, file, module.error));
        components.set(name, { name, file, path, valid: false });
        continue;
      }
      const { params, layout, problems } = checkDeclarations(module.exports);
      for (const problem of problems) errors.push(errorAt(file, fileStart, `${name}: ${problem}`));
      components.set(name, { name, file, path, params, layout, solid: !module.customElement, valid: problems.length === 0 });
    }
  } finally {
    await server.close();
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
  return components;
}

function componentFiles(root, builtInBlocks, errors) {
  const dir = join(root, COMPONENTS_DIR);
  const entries = statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).sort() : [];
  const files = new Map();
  for (const entry of entries) {
    const extension = COMPONENT_EXTENSIONS.find((candidate) => entry.endsWith(candidate));
    if (extension === undefined || !statSync(join(dir, entry)).isFile()) continue;
    const file = posix.join(COMPONENTS_DIR, entry);
    const name = entry.slice(0, -extension.length);
    if (!COMPONENT_NAME.test(name)) {
      errors.push(errorAt(file, fileStart, `the file name of a component is its custom element name and its block name; use lowercase letters and digits with at least one "-", such as act-fn-plot, got "${name}"`));
    } else if (RESERVED_NAMES.includes(name)) {
      errors.push(errorAt(file, fileStart, `${name}: the HTML standard reserves "${name}" and does not allow it as a custom element name; give the component another name`));
    } else if (builtInBlocks.includes(name)) {
      errors.push(errorAt(file, fileStart, `${name}: :::${name} is a built-in block; give the component another name`));
    } else if (files.has(name)) {
      errors.push(errorAt(file, fileStart, `${name}: ${files.get(name)} and ${file} both define the component; keep one of them`));
    } else {
      files.set(name, file);
    }
  }
  return files;
}

async function loadModule(server, path) {
  const hidden = BROWSER_GLOBALS.filter((name) => Object.hasOwn(globalThis, name)).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const stubbed = !Object.hasOwn(globalThis, 'HTMLElement');
  for (const [name] of hidden) delete globalThis[name];
  if (stubbed) globalThis.HTMLElement = NODE_HTML_ELEMENT;
  try {
    const exports = await server.ssrLoadModule(path);
    return { exports, customElement: exports.default?.prototype instanceof HTMLElement };
  } catch (error) {
    return { error };
  } finally {
    if (stubbed) delete globalThis.HTMLElement;
    for (const [name, descriptor] of hidden) Object.defineProperty(globalThis, name, descriptor);
  }
}

function loadError(server, root, name, file, error) {
  if (error.loc !== undefined || error.errors !== undefined) {
    const problem = compileProblem(root, error);
    return errorAt(problem.file ?? file, problem.position, `${name}: ${problem.message}`);
  }
  if (error instanceof Error) server.ssrFixStacktrace(error);
  const location = stackLocation(root, error);
  const global = error instanceof ReferenceError ? UNDEFINED_NAME.exec(error.message)?.[1] : undefined;
  const where = location === null ? errorAt(file, fileStart, '') : location;
  if (BROWSER_GLOBALS.includes(global)) {
    return { ...where, message: `${name}: ${file} uses the browser API ${global} at the top level; the build reads params and layout in Node, so use it inside the component code` };
  }
  const message = (error instanceof Error ? error.message : String(error)).replaceAll(`${resolve(root)}${sep}`, '');
  return { ...where, message: `${name}: ${file} cannot be read in Node: ${message}` };
}

function stackLocation(root, error) {
  const lines = typeof error?.stack === 'string' ? error.stack.split('\n').slice(1) : [];
  for (const line of lines) {
    const match = STACK_LOCATION.exec(line.trim());
    if (match === null) continue;
    const path = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1];
    if (isInBlog(root, path)) return errorAt(blogPath(root, path), { line: Number(match[2]), column: Number(match[3]) }, '');
  }
  return null;
}
