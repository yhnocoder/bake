import { escapeMarkup } from '../shared/escape.js';
import { absoluteLink, siteLink } from '../shared/urls.js';

const FEED_PATH = 'feed.xml';
const SITEMAP_PATH = 'sitemap.xml';

export function feedFiles({ config, listed }) {
  return [{ path: FEED_PATH, render: () => feedXml(config, listed.map(({ entry }) => entry)), owner: 'the RSS feed' }];
}

export function sitemapFiles({ config, listed }) {
  return [{ path: SITEMAP_PATH, render: () => sitemapXml(config, listed.map(({ entry }) => entry)), owner: 'the sitemap' }];
}

function feedXml(config, entries) {
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

function sitemapXml(config, entries) {
  const addresses = [siteLink(config.url), ...entries.map((entry) => entry.link)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...addresses.map((address) => `<url>${element('loc', address)}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

function element(name, text) {
  return `<${name}>${escapeMarkup(text)}</${name}>`;
}
