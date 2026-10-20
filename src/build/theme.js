import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { publicModules } from '../bundle/modules.js';
import { blogPath, browserBuild, compileProblem, isInBlog, outputOf, viteConfig } from '../bundle/vite.js';
import { BUILT_IN_THEMES } from '../config/rules.js';
import { errorAt, fileStart } from '../report.js';

export const THEMES_DIR = 'themes';
const PAGE_FILE = 'page.jsx';
const CLIENT_FILE = 'client.jsx';
const HOME_FILE = 'home.jsx';
const NOT_FOUND_FILE = 'not-found.jsx';
const THEME_STYLES_FILE = 'theme.css';
const FONTS_FILE = 'fonts.css';
export const THEME_STYLES_PATH = '_bake/theme.css';

const BUILT_IN_DIR = join(import.meta.dirname, '../themes');
const SHARED_DIR = join(import.meta.dirname, '../theme');
const SHARED_MODULE = 'bake/theme';
const SHARED_INDEX = join(SHARED_DIR, 'index.jsx');
const RE_EXPORT = /export \{([^}]*)\} from '([^']+)'/g;
const MISSING_BINDING = /"([^"]+)" is not exported/;
const SHARED_EXPORTS = new Map([
  ['', 'index.jsx'],
  ['/client', 'client.js'],
  ...['fonts', 'tokens', 'base', 'page', 'blocks', 'settings', 'home', 'not-found', 'print'].map((name) => [`/styles/${name}.css`, `styles/${name}.css`]),
]);
const RENDER_ENTRY = 'bake:render';
const RESOLVED_RENDER_ENTRY = `\0${RENDER_ENTRY}`;
const RELATIVE_IMPORT = /^\.\.?[/]/;
const STYLESHEET = /\.css(?:\?.*)?$/;
const EVERY_IMPORT = /^/;

export async function compileTheme(root, name, { siteTheme }, errors) {
  const own = themeFolders(root, name);
  const folders = [...own, SHARED_DIR];
  const locate = fileLocator(folders);
  const locateShared = fileLocator(BUILT_IN_THEMES.includes(name) ? folders : [SHARED_DIR]);
  const count = errors.length;
  for (const file of [PAGE_FILE, CLIENT_FILE, ...(siteTheme ? [HOME_FILE, NOT_FOUND_FILE, THEME_STYLES_FILE] : [])]) {
    if (fileLocator(own)(file) === null) errors.push(errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" has no ${file}`));
  }
  if (errors.length > count) return null;
  const sources = new Set();
  const alias = [...publicModules('themes'), themeFileAlias(folders, locate, locateShared, sources)];
  try {
    const fontsFile = locate(FONTS_FILE);
    const [server, client, styles, fonts] = await Promise.all([
      build(serverConfig(alias, locate, siteTheme)),
      browserBuild({ input: { [name]: locate(CLIENT_FILE) }, plugins: [solid()], alias }),
      siteTheme ? browserBuild({ input: locate(THEME_STYLES_FILE), alias, stylesheet: THEME_STYLES_PATH }) : null,
      fontsFile === null ? null : browserBuild({ input: { [`${name}-fonts`]: fontsFile }, alias }),
    ]);
    const module = await import(`data:text/javascript;base64,${Buffer.from(outputOf(server)[0].code).toString('base64')}`);
    return {
      render: module.render,
      renderHome: module.renderHome,
      renderNotFound: module.renderNotFound,
      files: [client, styles, fonts].flatMap((output) => output?.files ?? []),
      styles: client.stylesheets,
      fonts: fonts?.files.filter((file) => STYLESHEET.test(file.path)).map((file) => file.path) ?? [],
      script: client.entry,
      sources: new Set([...sources, ...[client, styles, fonts].flatMap((output) => output?.modules ?? []), ...outputOf(server).flatMap((output) => output.moduleIds ?? [])]),
    };
  } catch (error) {
    errors.push(missingExport(root, error, locateShared) ?? compileError(root, name, error));
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

function themeFileAlias(folders, locate, locateShared, sources) {
  return {
    find: EVERY_IMPORT,
    replacement: '',
    customResolver(source, importer) {
      if (importer === undefined) return null;
      if (source.startsWith(SHARED_MODULE)) {
        const path = SHARED_EXPORTS.get(source.slice(SHARED_MODULE.length));
        return path === undefined ? null : locateShared(path);
      }
      if (!(RELATIVE_IMPORT.test(source) || STYLESHEET.test(importer))) return null;
      sources.add(resolve(dirname(importer), source.replace(/[?#].*/, '')));
      const folder = folders.find((candidate) => importer.startsWith(`${candidate}${sep}`));
      if (folder === undefined) return null;
      const path = relative(folder, resolve(dirname(importer), source));
      if (path.startsWith('..')) return null;
      return folder === SHARED_DIR ? locateShared(path) : locate(path);
    },
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

function serverConfig(alias, locate, siteTheme) {
  return {
    ...viteConfig({ plugins: [renderEntry(locate, siteTheme), solid({ ssr: true, solid: { hydratable: false } })], alias }),
    ssr: { noExternal: true },
    build: { ssr: true, write: false, rolldownOptions: { input: RENDER_ENTRY, output: { codeSplitting: false } } },
  };
}

function missingExport(root, error, locateShared) {
  const cause = error.errors?.[0] ?? error;
  if (cause.code !== 'MISSING_EXPORT') return null;
  const binding = MISSING_BINDING.exec(cause.message)?.[1];
  const exporter = cause.exporter === SHARED_INDEX ? reExportSource(binding, locateShared) : isShared(cause.id) ? cause.exporter : null;
  if (!isInBlog(root, exporter)) return null;
  return errorAt(blogPath(root, exporter), fileStart, `the theme imports "${binding}" from this file, which does not export it`);
}

function isShared(file) {
  return typeof file === 'string' && file.startsWith(`${SHARED_DIR}${sep}`);
}

function reExportSource(binding, locateShared) {
  for (const [, names, source] of readFileSync(SHARED_INDEX, 'utf8').matchAll(RE_EXPORT)) {
    if (names.split(',').some((entry) => entry.trim().split(/\s+as\s+/).at(-1) === binding)) return locateShared(relative(SHARED_DIR, resolve(SHARED_DIR, source)));
  }
  return null;
}

function compileError(root, name, error) {
  const { message, file, position } = compileProblem(root, error);
  if (file === null) return errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" cannot be built: ${message}`);
  return errorAt(file, position, message);
}
