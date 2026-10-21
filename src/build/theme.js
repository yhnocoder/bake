import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { buildCache, filesIn } from '../bundle/cache.js';
import { publicModules, virtualModules } from '../bundle/modules.js';
import { BAKE_ROOT, blogPath, browserBuild, compileProblem, outputOf, viteConfig } from '../bundle/vite.js';
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
const BUILD_FILES = [join(import.meta.dirname, '../theme'), BUILT_IN_DIR, join(import.meta.dirname, '../kit/controls.css'), join(import.meta.dirname, '../bundle'), import.meta.filename, join(import.meta.dirname, '../config/rules.js')];
const RENDER_ENTRY = 'bake:render';
const CLIENT_ENTRY = 'bake:client';
const MISSING_BINDING = /"([^"]+)" is not exported/;

export function builtInThemeFolders(root) {
  return BUILT_IN_THEMES.filter((name) => existsSync(join(root, THEMES_DIR, name))).map((name) =>
    errorAt(`${THEMES_DIR}/${name}`, fileStart, `a theme folder of the blog cannot have the name of the built-in theme "${name}"; to change ${name}, name the folder differently and import the parts it keeps from bake/themes/${name}`),
  );
}

export function themeFolder(root, name) {
  return BUILT_IN_THEMES.includes(name) ? join(BUILT_IN_DIR, name) : join(root, THEMES_DIR, name);
}

export function themeLocation(root, name) {
  return blogPath(root, themeFolder(root, name));
}

export async function compileTheme(root, name, { siteTheme }, errors) {
  const folder = themeFolder(root, name);
  const locate = (file) => (existsSync(join(folder, file)) ? join(folder, file) : null);
  const count = errors.length;
  for (const file of [PAGE_FILE, CLIENT_FILE, ...(siteTheme ? [HOME_FILE, NOT_FOUND_FILE, THEME_STYLES_FILE] : [])]) {
    if (locate(file) === null) errors.push(errorAt(themeLocation(root, name), fileStart, `theme "${name}" has no ${file}`));
  }
  if (errors.length > count) return null;
  const cache = buildCache('theme', `${BAKE_ROOT}\0${name}\0${siteTheme}`, resolve(root));
  const required = filesIn([folder, ...BUILD_FILES].map((path) => resolve(path)));
  const cached = cache.read(required);
  if (cached !== null) return loadTheme(cached.data, cached.files, new Set(cached.inputs));
  const started = Date.now();
  const alias = publicModules('themes');
  let data;
  let theme;
  try {
    const [server, client, styles] = await Promise.all([
      build(serverConfig(alias, locate, siteTheme)),
      browserBuild({ input: { [name]: CLIENT_ENTRY }, plugins: [clientEntry(locate(CLIENT_FILE)), solid()], alias }),
      siteTheme ? browserBuild({ input: locate(THEME_STYLES_FILE), alias, stylesheet: THEME_STYLES_PATH }) : null,
    ]);
    data = {
      server: outputOf(server)[0].code,
      styles: client.stylesheets,
      script: client.entry,
    };
    const files = [client, styles].flatMap((output) => output?.files ?? []);
    theme = await loadTheme(data, files, new Set([...[client, styles].flatMap((output) => output?.modules ?? []), ...outputOf(server).flatMap((output) => output.moduleIds ?? [])]));
  } catch (error) {
    errors.push(compileError(root, name, locate(CLIENT_FILE), error));
    return null;
  }
  cache.write(data, theme.files, [...required, ...theme.sources], started);
  return theme;
}

async function loadTheme({ server, ...data }, files, sources) {
  const module = await import(`data:text/javascript;base64,${Buffer.from(server).toString('base64')}`);
  return { render: module.render, renderHome: module.renderHome, renderNotFound: module.renderNotFound, files, ...data, sources };
}

function clientEntry(file) {
  return virtualModules('bake-client-entry', {
    [CLIENT_ENTRY]: () => [`import start from ${JSON.stringify(file)};`, "import { livePage } from 'bake/live';", '', 'livePage(start);', ''].join('\n'),
  });
}

function renderEntry(locate, siteTheme) {
  const components = [['Page', PAGE_FILE, 'render'], ...(siteTheme ? [['Home', HOME_FILE, 'renderHome'], ['NotFound', NOT_FOUND_FILE, 'renderNotFound']] : [])];
  return virtualModules('bake-render-entry', {
    [RENDER_ENTRY]: () =>
      [
        "import { createComponent, renderToString } from 'solid-js/web';",
        ...components.map(([component, file]) => `import ${component} from ${JSON.stringify(locate(file))};`),
        ...components.flatMap(([component, , exported]) => [`export function ${exported}(props) {`, `  return renderToString(() => createComponent(${component}, props));`, '}']),
      ].join('\n'),
  });
}

function serverConfig(alias, locate, siteTheme) {
  return {
    ...viteConfig({ plugins: [renderEntry(locate, siteTheme), solid({ ssr: true, solid: { hydratable: false } })], alias }),
    ssr: { noExternal: true },
    build: { ssr: true, write: false, rolldownOptions: { input: RENDER_ENTRY, output: { codeSplitting: false } } },
  };
}

function compileError(root, name, clientFile, error) {
  const cause = error.errors?.[0] ?? error;
  if (cause.code === 'MISSING_EXPORT' && cause.exporter === clientFile && MISSING_BINDING.exec(cause.message)?.[1] === 'default') {
    return errorAt(blogPath(root, clientFile), fileStart, `${CLIENT_FILE} has no default export; export the function start(document), which starts the page script and returns a function that stops it`);
  }
  const { message, file, position } = compileProblem(root, error);
  if (file === null) return errorAt(themeLocation(root, name), fileStart, `theme "${name}" cannot be built: ${message}`);
  return errorAt(file, position, message);
}
