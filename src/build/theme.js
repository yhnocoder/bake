import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { BUILT_IN_THEMES } from '../config/rules.js';
import { errorAt, fileStart } from '../report.js';
import { compileProblem, outputOf, viteConfig } from './vite.js';

export const THEMES_DIR = 'themes';
export const PAGE_FILE = 'page.jsx';
export const CLIENT_FILE = 'client.jsx';
export const HOME_FILE = 'home.jsx';

const BUILT_IN_DIR = join(import.meta.dirname, '../themes');
const RENDER_ENTRY = 'bake:render';
const RESOLVED_RENDER_ENTRY = `\0${RENDER_ENTRY}`;

export async function compileTheme(root, name, { home }, errors) {
  const folders = themeFolders(root, name);
  const locate = fileLocator(folders);
  const count = errors.length;
  for (const file of [PAGE_FILE, CLIENT_FILE, ...(home ? [HOME_FILE] : [])]) {
    if (locate(file) === null) errors.push(errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" has no ${file}`));
  }
  if (errors.length > count) return null;
  try {
    const [server, client] = await Promise.all([build(serverConfig(folders, locate)), build(clientConfig(folders, locate, name))]);
    const module = await import(`data:text/javascript;base64,${Buffer.from(outputOf(server)[0].code).toString('base64')}`);
    const files = outputOf(client).map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source }));
    return {
      render: module.render,
      renderHome: module.renderHome,
      files,
      styles: files.filter((file) => file.path.endsWith('.css')).map((file) => file.path),
      scripts: files.filter((file) => file.path.endsWith('.js')).map((file) => file.path),
    };
  } catch (error) {
    errors.push(compileError(root, name, error));
    return null;
  }
}

function themeFolders(root, name) {
  const custom = join(root, THEMES_DIR, name);
  const builtIn = join(BUILT_IN_DIR, name);
  return [custom, ...(BUILT_IN_THEMES.includes(name) ? [builtIn] : [])].filter((folder) => existsSync(folder));
}

function fileLocator(folders) {
  return (path) => folders.map((folder) => join(folder, path)).find((file) => existsSync(file)) ?? null;
}

function themeFiles(folders, locate) {
  return {
    name: 'bake-theme-files',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === RENDER_ENTRY) return RESOLVED_RENDER_ENTRY;
      if (importer === undefined || !source.startsWith('.')) return null;
      const folder = folders.find((candidate) => importer.startsWith(`${candidate}${sep}`));
      if (folder === undefined) return null;
      const path = relative(folder, resolve(dirname(importer), source));
      return path.startsWith('..') ? null : locate(path);
    },
    load(id) {
      if (id !== RESOLVED_RENDER_ENTRY) return null;
      const home = locate(HOME_FILE);
      return [
        "import { createComponent, renderToString } from 'solid-js/web';",
        `import Page from ${JSON.stringify(locate(PAGE_FILE))};`,
        ...(home === null ? [] : [`import Home from ${JSON.stringify(home)};`]),
        'export function render(props) {',
        '  return renderToString(() => createComponent(Page, props));',
        '}',
        ...(home === null ? [] : ['export function renderHome(props) {', '  return renderToString(() => createComponent(Home, props));', '}']),
      ].join('\n');
    },
  };
}

function sharedConfig(folders, locate) {
  return viteConfig([themeFiles(folders, locate)]);
}

function serverConfig(folders, locate) {
  const shared = sharedConfig(folders, locate);
  return {
    ...shared,
    plugins: [...shared.plugins, solid({ ssr: true, solid: { hydratable: false } })],
    ssr: { noExternal: true },
    build: { ssr: true, write: false, rolldownOptions: { input: RENDER_ENTRY, output: { codeSplitting: false } } },
  };
}

function clientConfig(folders, locate, name) {
  const shared = sharedConfig(folders, locate);
  return {
    ...shared,
    base: './',
    plugins: [...shared.plugins, solid()],
    build: {
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      modulePreload: false,
      rolldownOptions: {
        input: locate(CLIENT_FILE),
        output: {
          format: 'iife',
          codeSplitting: false,
          entryFileNames: `assets/${name}-[hash].js`,
          assetFileNames: (asset) => (asset.names.some((file) => file.endsWith('.css')) ? `assets/${name}-[hash].css` : 'assets/[name]-[hash][extname]'),
        },
      },
    },
  };
}

function compileError(root, name, error) {
  const { message, file, position } = compileProblem(root, error);
  if (file === null) return errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" cannot be built: ${message}`);
  return errorAt(file, position, message);
}
