import { access, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { renderDocument } from '../layouts/head.js';
import { render } from '../render/index.js';
import { loadError, loadExtensions } from './extensions.js';
import { findPages, pageUrl } from './pages.js';

const configPath = 'bake.config.js';
const articlePlaceholder = '<!--bake:article-->';

async function readConfig(root, loader, messages) {
  if (!(await access(join(root, configPath)).then(() => true, () => false))) {
    messages.push({ path: configPath, line: 1, column: 1, text: `${configPath} not found in ${root}` });
    return null;
  }
  try {
    return (await loader.import(configPath)).default;
  } catch (error) {
    messages.push(loadError(configPath, error));
    return null;
  }
}

async function loadConfig(root, loader, messages) {
  const config = await readConfig(root, loader, messages);
  for (const field of ['title', 'theme']) {
    if (config && config[field] === undefined) messages.push({ path: configPath, line: 1, column: 1, text: `Config is missing ${field}` });
  }
  return { base: '/', site: {}, ...config, math: { macros: {}, ...config?.math } };
}

export async function loadSite(root, { loader }) {
  const messages = [];
  const config = await loadConfig(root, loader, messages);
  const { pages, messages: pageMessages } = await findPages(root);
  messages.push(...pageMessages);
  const extensions = await loadExtensions(root, loader);
  const themeFound = Object.hasOwn(extensions.themes, config.theme) || extensions.messages.some((message) => message.path === `themes/${config.theme}.css`);
  if (config.theme !== undefined && !themeFound) {
    messages.push({ path: configPath, line: 1, column: 1, text: `Unknown theme ${config.theme}` });
  }
  messages.push(...extensions.messages);
  const { components, blocks, layouts, themes } = extensions;
  return { root, config, pages, components, blocks, layouts, themes, messages };
}

export function siteData(site) {
  const pages = site.pages
    .filter((page) => page.url !== null && page.frontmatter.draft !== true)
    .map(({ url, frontmatter }) => ({ url, ...frontmatter }));
  return { pages, config: site.config.site };
}

function topicOf(pagePath) {
  const segments = pagePath.split(sep).join('/').split('/');
  return segments.length > 2 ? segments[1] : null;
}

export function pageComponents(site, pagePath) {
  const topic = topicOf(pagePath);
  const components = {};
  const otherTopicComponents = {};
  for (const [name, component] of Object.entries(site.components)) {
    if (component.topic === null || component.topic === topic) components[name] = component.properties;
    else otherTopicComponents[name] = component.topic;
  }
  return { components, otherTopicComponents };
}

export function renderOptions(site, pagePath) {
  return {
    path: pagePath,
    config: site.config,
    blocks: site.blocks,
    ...pageComponents(site, pagePath),
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
