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
  const items = entries.map((entry) => {
    const address = absoluteLink(config, entry.url);
    return [
      '<item>',
      element('title', entry.title),
      element('link', address),
      `<guid isPermaLink="true">${escapeXml(address)}</guid>`,
      element('pubDate', new Date(`${entry.date}T00:00:00Z`).toUTCString()),
      ...(entry.category === undefined ? [] : [element('category', entry.category.name)]),
      ...(entry.summary === undefined ? [] : [element('description', entry.summary)]),
      '</item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    element('title', config.title),
    element('link', link),
    element('description', config.description ?? config.title),
    element('language', config.language),
    `<atom:link href="${escapeXml(absoluteLink(config, FEED_PATH))}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function sitemapXml(config, entries) {
  const addresses = [siteLink(config.url), ...entries.map((entry) => absoluteLink(config, entry.url))];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...addresses.map((address) => `<url>${element('loc', address)}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

export function chatCatalogJson(config, articles) {
  const entries = articles.map(({ url, fields, content }) => ({
    url: url.slice(1),
    title: fields.title,
    date: fields.date,
    summary: fields.summary,
    tags: fields.tags ?? [],
    category: config.categories.find((category) => category.id === fields.category)?.name,
    source: fields.page === undefined ? `${url.slice(1)}index.md` : undefined,
    sections: (content?.toc ?? []).map((section) => ({
      id: section.id,
      number: section.number,
      title: section.title,
      subsections: section.children.map((child) => ({ id: child.id, title: child.title })),
    })),
  }));
  return `${JSON.stringify({ title: config.title, description: config.description, language: config.language, articles: entries })}\n`;
}

function element(name, text) {
  return `<${name}>${escapeXml(text)}</${name}>`;
}

function escapeXml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
