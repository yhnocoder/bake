import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { BUILT_IN_THEMES } from '../config/rules.js';
import { errorAt, fileStart } from '../report.js';

export const THEMES_DIR = 'themes';
export const PAGE_FILE = 'page.jsx';
export const CLIENT_FILE = 'client.jsx';
export const HOME_FILE = 'home.jsx';
export const NOT_FOUND_FILE = 'not-found.jsx';
export const THEME_STYLES_FILE = 'theme.css';
export const THEME_STYLES_PATH = '_bake/theme.css';

const BUILT_IN_DIR = join(import.meta.dirname, '../themes');
const BAKE_ROOT = join(import.meta.dirname, '../..');
const RENDER_ENTRY = 'bake:render';
const RESOLVED_RENDER_ENTRY = `\0${RENDER_ENTRY}`;
const SHARED_PACKAGES = ['solid-js'];
const LOCATION_SUFFIX = / \(\d+:\d+\)$/;
const RELATIVE_IMPORT = /^(\.\.?\/.*)$/;
const ASSET_FILE_NAMES = 'assets/[name]-[hash][extname]';

export async function compileTheme(root, name, { siteTheme }, errors) {
  const folders = themeFolders(root, name);
  const locate = fileLocator(folders);
  const count = errors.length;
  for (const file of [PAGE_FILE, CLIENT_FILE, ...(siteTheme ? [HOME_FILE, NOT_FOUND_FILE, THEME_STYLES_FILE] : [])]) {
    if (locate(file) === null) errors.push(errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" has no ${file}`));
  }
  if (errors.length > count) return null;
  try {
    const [server, client, styles] = await Promise.all([
      build(serverConfig(folders, locate, siteTheme)),
      build(clientConfig(folders, locate, name)),
      siteTheme ? build(stylesConfig(folders, locate)) : null,
    ]);
    const module = await import(`data:text/javascript;base64,${Buffer.from(outputOf(server)[0].code).toString('base64')}`);
    const files = outputOf(client).map(outputFile);
    return {
      render: module.render,
      renderHome: module.renderHome,
      renderNotFound: module.renderNotFound,
      files: styles === null ? files : [...files, ...outputOf(styles).map(outputFile)],
      styles: files.filter((file) => file.path.endsWith('.css')).map((file) => file.path),
      scripts: files.filter((file) => file.path.endsWith('.js')).map((file) => file.path),
    };
  } catch (error) {
    errors.push(compileError(root, name, error));
    return null;
  }
}

function outputFile(output) {
  return { path: output.fileName, source: output.type === 'chunk' ? output.code : output.source };
}

function themeFolders(root, name) {
  const custom = join(root, THEMES_DIR, name);
  const builtIn = join(BUILT_IN_DIR, name);
  return [custom, ...(BUILT_IN_THEMES.includes(name) ? [builtIn] : [])].filter((folder) => existsSync(folder));
}

function fileLocator(folders) {
  return (path) => folders.map((folder) => join(folder, path)).find((file) => existsSync(file)) ?? null;
}

function themeFileResolver(folders, locate) {
  return (source, importer) => {
    if (importer === undefined) return null;
    const folder = folders.find((candidate) => importer.startsWith(`${candidate}${sep}`));
    if (folder === undefined) return null;
    const path = relative(folder, resolve(dirname(importer), source));
    return path.startsWith('..') ? null : locate(path);
  };
}

function renderEntry(locate, siteTheme) {
  const components = [
    ['Page', PAGE_FILE, 'render'],
    ...(siteTheme
      ? [
          ['Home', HOME_FILE, 'renderHome'],
          ['NotFound', NOT_FOUND_FILE, 'renderNotFound'],
        ]
      : []),
  ];
  return {
    name: 'bake-render-entry',
    resolveId(source) {
      return source === RENDER_ENTRY ? RESOLVED_RENDER_ENTRY : null;
    },
    load(id) {
      if (id !== RESOLVED_RENDER_ENTRY) return null;
      return [
        "import { createComponent, renderToString } from 'solid-js/web';",
        ...components.map(([component, file]) => `import ${component} from ${JSON.stringify(locate(file))};`),
        ...components.flatMap(([component, , exported]) => [
          `export function ${exported}(props) {`,
          `  return renderToString(() => createComponent(${component}, props));`,
          '}',
        ]),
      ].join('\n');
    },
  };
}

function sharedConfig(folders, locate) {
  return {
    configFile: false,
    envDir: false,
    root: BAKE_ROOT,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    resolve: {
      dedupe: SHARED_PACKAGES,
      alias: [{ find: RELATIVE_IMPORT, replacement: '$1', customResolver: themeFileResolver(folders, locate) }],
    },
  };
}

function serverConfig(folders, locate, siteTheme) {
  return {
    ...sharedConfig(folders, locate),
    plugins: [renderEntry(locate, siteTheme), solid({ ssr: true, solid: { hydratable: false } })],
    ssr: { noExternal: true },
    build: { ssr: true, write: false, rolldownOptions: { input: RENDER_ENTRY, output: { codeSplitting: false } } },
  };
}

function clientConfig(folders, locate, name) {
  return {
    ...sharedConfig(folders, locate),
    base: './',
    plugins: [solid()],
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
          assetFileNames: (asset) => (isStylesheet(asset) ? `assets/${name}-[hash].css` : ASSET_FILE_NAMES),
        },
      },
    },
  };
}

function stylesConfig(folders, locate) {
  return {
    ...sharedConfig(folders, locate),
    base: './',
    build: {
      write: false,
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: locate(THEME_STYLES_FILE),
        output: { assetFileNames: (asset) => (isStylesheet(asset) ? THEME_STYLES_PATH : ASSET_FILE_NAMES) },
      },
    },
  };
}

function isStylesheet(asset) {
  return asset.names.some((file) => file.endsWith('.css'));
}

function outputOf(result) {
  return (Array.isArray(result) ? result[0] : result).output;
}

function compileError(root, name, error) {
  const cause = error.errors?.[0] ?? error;
  const file = cause.loc?.file ?? cause.id;
  const message = String(cause.message ?? cause)
    .split('\n')[0]
    .replace(`${file}: `, '')
    .replace(LOCATION_SUFFIX, '');
  if (file === undefined || !resolve(file).startsWith(`${resolve(root)}${sep}`)) {
    return errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" cannot be built: ${message}`);
  }
  const position = cause.loc?.line === undefined ? fileStart : { line: cause.loc.line, column: cause.loc.column + 1 };
  return errorAt(relative(root, file).split(sep).join('/'), position, message);
}
