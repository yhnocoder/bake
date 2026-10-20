import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { publicModules } from '../bundle/modules.js';
import { browserBuild, compileProblem, outputOf, viteConfig } from '../bundle/vite.js';
import { BUILT_IN_THEMES } from '../config/rules.js';
import { errorAt, fileStart } from '../report.js';

export const THEMES_DIR = 'themes';
const PAGE_FILE = 'page.jsx';
const CLIENT_FILE = 'client.jsx';
const HOME_FILE = 'home.jsx';
const NOT_FOUND_FILE = 'not-found.jsx';
const THEME_STYLES_FILE = 'theme.css';
export const THEME_STYLES_PATH = '_bake/theme.css';

const BUILT_IN_DIR = join(import.meta.dirname, '../themes');
const RENDER_ENTRY = 'bake:render';
const RESOLVED_RENDER_ENTRY = `\0${RENDER_ENTRY}`;
const RELATIVE_IMPORT = /^\.\.?[/]/;
const STYLESHEET = /\.css(?:\?.*)?$/;
const EVERY_IMPORT = /^/;

export async function compileTheme(root, name, { siteTheme }, errors) {
  const folders = themeFolders(root, name);
  const locate = fileLocator(folders);
  const count = errors.length;
  for (const file of [PAGE_FILE, CLIENT_FILE, ...(siteTheme ? [HOME_FILE, NOT_FOUND_FILE, THEME_STYLES_FILE] : [])]) {
    if (locate(file) === null) errors.push(errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" has no ${file}`));
  }
  if (errors.length > count) return null;
  const alias = [...publicModules('themes'), themeFileAlias(folders, locate)];
  try {
    const [server, client, styles] = await Promise.all([
      build(serverConfig(alias, locate, siteTheme)),
      browserBuild({ input: { [name]: locate(CLIENT_FILE) }, plugins: [solid()], alias }),
      siteTheme ? browserBuild({ input: locate(THEME_STYLES_FILE), alias, stylesheet: THEME_STYLES_PATH }) : null,
    ]);
    const module = await import(`data:text/javascript;base64,${Buffer.from(outputOf(server)[0].code).toString('base64')}`);
    return {
      render: module.render,
      renderHome: module.renderHome,
      renderNotFound: module.renderNotFound,
      files: styles === null ? client.files : [...client.files, ...styles.files],
      styles: client.stylesheets,
      script: client.entry,
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

function themeFileAlias(folders, locate) {
  return {
    find: EVERY_IMPORT,
    replacement: '',
    customResolver(source, importer) {
      if (importer === undefined || !(RELATIVE_IMPORT.test(source) || STYLESHEET.test(importer))) return null;
      const folder = folders.find((candidate) => importer.startsWith(`${candidate}${sep}`));
      if (folder === undefined) return null;
      const path = relative(folder, resolve(dirname(importer), source));
      return path.startsWith('..') ? null : locate(path);
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

function compileError(root, name, error) {
  const { message, file, position } = compileProblem(root, error);
  if (file === null) return errorAt(join(THEMES_DIR, name).split(sep).join('/'), fileStart, `theme "${name}" cannot be built: ${message}`);
  return errorAt(file, position, message);
}
