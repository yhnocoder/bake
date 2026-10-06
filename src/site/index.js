import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import renderBento, { fields as bentoFields } from '../layouts/bento.js';
import renderEssay, { fields as essayFields } from '../layouts/essay.js';
import { renderDocument } from '../layouts/head.js';
import renderPaper, { fields as paperFields } from '../layouts/paper.js';
import { render } from '../render/index.js';
import { findPages, pageUrl } from './pages.js';

const configPath = 'bake.config.js';
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

async function importDefault(root, path) {
  globalThis.HTMLElement ??= class {};
  const module = await import(pathToFileURL(join(root, path)).href);
  return module.default;
}

async function loadConfig(root, messages) {
  const config = await importDefault(root, configPath);
  for (const field of ['title', 'theme']) {
    if (config[field] === undefined) messages.push({ path: configPath, line: 1, column: 1, text: `Config is missing ${field}` });
  }
  return { base: '/', site: {}, ...config, math: { macros: {}, ...config.math } };
}

async function loadComponents(root, messages) {
  const sources = (await listFiles(root, 'components', '.js')).map((path) => ({ path, topic: null }));
  const topics = (await entriesOf(root, 'content')).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const topic of topics.sort()) {
    for (const path of await listFiles(root, `content/${topic}/components`, '.js')) sources.push({ path, topic });
  }
  const components = {};
  for (const { path, topic } of sources) {
    try {
      const component = await importDefault(root, path);
      components[basename(path, '.js')] = { path, topic, properties: component.properties ?? {} };
    } catch (error) {
      messages.push({ path, line: 1, column: 1, text: `Cannot read static properties of component ${path}: ${error.message}` });
    }
  }
  return components;
}

async function loadThemes(root) {
  const paths = await listFiles(root, 'themes', '.css');
  return Object.fromEntries(paths.map((path) => [basename(path, '.css'), path]));
}

export async function loadSite(root) {
  const messages = [];
  const config = await loadConfig(root, messages);
  const { pages, messages: pageMessages } = await findPages(root);
  messages.push(...pageMessages);
  const components = await loadComponents(root, messages);
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

export function renderDocumentFor(site, pagePath, rendered, { assets }) {
  const layout = site.layouts[rendered.page.layout];
  if (!layout) return null;
  const page = { ...rendered.page, url: pageUrl(rendered.page.slug), path: pagePath };
  const body = layout.render({ page, html: rendered.html, toc: rendered.toc, site: siteData(site) });
  return renderDocument({ page, config: site.config, body, mathDefs: rendered.mathDefs, assets });
}

export async function renderPage(site, pagePath, { assets }) {
  if (!site.pages.some((page) => page.path === pagePath)) throw new Error(`${pagePath} is not a page of this site`);
  const rendered = await renderArticle(site, pagePath, await readFile(join(site.root, pagePath), 'utf8'));
  return { html: renderDocumentFor(site, pagePath, rendered, { assets }), rendered, messages: rendered.messages };
}
