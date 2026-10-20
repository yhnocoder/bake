import { escapeMarkup } from './escape.js';
import { encodePath } from './urls.js';

export const FEED_PATH = 'feed.xml';
export const SITEMAP_PATH = 'sitemap.xml';
export const NOT_FOUND_PATH = '404.html';
export const CHAT_CATALOG_PATH = '_bake/articles.json';
export const CHAT_PREAMBLE_PATH = '_bake/preamble.json';

export function siteLink(url) {
  return `${new URL(url).origin}${sitePath(url)}`;
}

export function sitePath(url) {
  const { pathname } = new URL(url);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function absoluteLink(config, path) {
  return `${siteLink(config.url)}${encodePath(path)}`;
}

export function feedXml(config, entries) {
  const link = siteLink(config.url);
  const items = entries.map((entry) =>
    [
      '<item>',
      element('title', entry.title),
      element('link', entry.link),
      `<guid isPermaLink="true">${escapeMarkup(entry.link)}</guid>`,
      element('pubDate', new Date(`${entry.date}T00:00:00Z`).toUTCString()),
      ...(entry.category === undefined ? [] : [element('category', entry.category.name)]),
      ...(entry.summary === undefined ? [] : [element('description', entry.summary)]),
      '</item>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    element('title', config.title),
    element('link', link),
    element('description', config.description ?? config.title),
    element('language', config.language),
    `<atom:link href="${escapeMarkup(absoluteLink(config, FEED_PATH))}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function sitemapXml(config, entries) {
  const addresses = [siteLink(config.url), ...entries.map((entry) => entry.link)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...addresses.map((address) => `<url>${element('loc', address)}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

export function chatCatalogJson(config, pages) {
  const articles = pages.map(({ article, entry }) => ({
    url: entry.path,
    title: entry.title,
    date: entry.date,
    summary: entry.summary,
    tags: entry.tags,
    category: entry.category?.name,
    source: article.fields.page === undefined ? `${entry.path}index.md` : undefined,
    sections: (article.content?.toc ?? []).map((section) => ({
      id: section.id,
      number: section.number,
      title: section.title,
      subsections: section.children.map((child) => ({ id: child.id, title: child.title })),
    })),
  }));
  return `${JSON.stringify({ title: config.title, description: config.description, language: config.language, articles })}\n`;
}

function element(name, text) {
  return `<${name}>${escapeMarkup(text)}</${name}>`;
}
