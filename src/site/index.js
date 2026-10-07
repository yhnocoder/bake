import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import renderBento, { fields as bentoFields } from '../layouts/bento.js';
import renderEssay, { fields as essayFields } from '../layouts/essay.js';
import { renderDocument } from '../layouts/head.js';
import renderPaper, { fields as paperFields } from '../layouts/paper.js';
import { render } from '../render/index.js';
import { findPages, pageUrl } from './pages.js';

const configPath = 'bake.config.js';
const articlePlaceholder = '<!--bake:article-->';
const layouts = {
  essay: { render: renderEssay, fields: essayFields },
  paper: { render: renderPaper, fields: paperFields },
  bento: { render: renderBento, fields: bentoFields },
};

async function entriesOf(root, directory) {
  try {
    return await readdir(join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listFiles(root, directory, extension) {
  const entries = await entriesOf(root, directory);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

async function importDefault(loader, path) {
  globalThis.HTMLElement ??= class {};
  const module = await loader.import(path);
  return module.default;
}

function loadError(path, error, text) {
  const { line = 1, column = 0 } = error.loc ?? {};
  return { path, line, column: column + 1, text: `${text}: ${error.message.split('\n')[0]}` };
}

async function readConfig(loader, messages) {
  try {
    return await importDefault(loader, configPath);
  } catch (error) {
    messages.push(loadError(configPath, error, `Cannot load ${configPath}`));
    return null;
  }
}

async function loadConfig(loader, messages) {
  const config = await readConfig(loader, messages);
  for (const field of ['title', 'theme']) {
    if (config && config[field] === undefined) messages.push({ path: configPath, line: 1, column: 1, text: `Config is missing ${field}` });
  }
  return { base: '/', site: {}, ...config, math: { macros: {}, ...config?.math } };
}

async function loadComponents(root, loader, messages) {
  const sources = (await listFiles(root, 'components', '.js')).map((path) => ({ path, topic: null }));
  const topics = (await entriesOf(root, 'content')).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const topic of topics.sort()) {
    for (const path of await listFiles(root, `content/${topic}/components`, '.js')) sources.push({ path, topic });
  }
  const components = {};
  for (const { path, topic } of sources) {
    try {
      const component = await importDefault(loader, path);
      components[basename(path, '.js')] = { path, topic, properties: component.properties ?? {} };
    } catch (error) {
      messages.push(loadError(path, error, `Cannot read static properties of component ${path}`));
    }
  }
  return components;
}

async function loadThemes(root) {
  const paths = await listFiles(root, 'themes', '.css');
  return Object.fromEntries(paths.map((path) => [basename(path, '.css'), path]));
}

export async function loadSite(root, { loader }) {
  const messages = [];
  const config = await loadConfig(loader, messages);
  const { pages, messages: pageMessages } = await findPages(root);
  messages.push(...pageMessages);
  const components = await loadComponents(root, loader, messages);
  const themes = await loadThemes(root);
  if (config.theme !== undefined && !Object.hasOwn(themes, config.theme)) {
    messages.push({ path: configPath, line: 1, column: 1, text: `Unknown theme ${config.theme}` });
  }
  return { root, config, pages, components, themes, layouts, messages };
}

export function siteData(site) {
  const pages = site.pages
    .filter((page) => page.url !== null && page.frontmatter.draft !== true)
    .map(({ url, frontmatter }) => ({ url, ...frontmatter }));
  return { pages, config: site.config.site };
}

export function renderOptions(site, pagePath) {
  return {
    path: pagePath,
    config: site.config,
    components: Object.fromEntries(Object.entries(site.components).map(([name, { properties }]) => [name, properties])),
    layouts: Object.fromEntries(Object.entries(site.layouts).map(([name, { fields }]) => [name, fields])),
    themes: Object.keys(site.themes),
  };
}

export function renderArticle(site, pagePath, source) {
  return render(source, renderOptions(site, pagePath));
}

function pageOf(rendered, pagePath) {
  return { ...rendered.page, url: pageUrl(rendered.page.slug), path: pagePath };
}

function holdsArticle(frame) {
  const starts = [...frame.matchAll(/<article[\s>]/g)];
  const parts = frame.split(articlePlaceholder);
  if (starts.length !== 1 || parts.length !== 2) return false;
  const placeholder = parts[0].length;
  return starts[0].index < placeholder && placeholder < frame.indexOf('</article>', starts[0].index);
}

export function layoutFrame(site, pagePath, rendered) {
  const name = rendered.page.layout;
  const layout = site.layouts[name];
  if (!layout) return { frame: null, messages: [] };
  const frame = layout.render({ page: pageOf(rendered, pagePath), html: articlePlaceholder, toc: rendered.toc, site: siteData(site) });
  if (holdsArticle(frame)) return { frame, messages: [] };
  const text = `Layout ${name} must output exactly one <article> that contains the page content`;
  return { frame: null, messages: [{ path: pagePath, line: 1, column: 1, text }] };
}

export function renderDocumentFor(site, pagePath, rendered, { frame, assets }) {
  const body = frame.replace(articlePlaceholder, () => rendered.html);
  return renderDocument({ page: pageOf(rendered, pagePath), config: site.config, body, mathDefs: rendered.mathDefs, assets });
}

export async function renderPage(site, pagePath, { assets }) {
  if (!site.pages.some((page) => page.path === pagePath)) throw new Error(`${pagePath} is not a page of this site`);
  const rendered = await renderArticle(site, pagePath, await readFile(join(site.root, pagePath), 'utf8'));
  const { frame, messages } = layoutFrame(site, pagePath, rendered);
  const html = frame === null ? null : renderDocumentFor(site, pagePath, rendered, { frame, assets });
  return { html, rendered, messages: [...rendered.messages, ...messages] };
}
