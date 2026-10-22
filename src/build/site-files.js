import { statSync } from 'node:fs';
import { join } from 'node:path';
import { escapeMarkup } from '../shared/escape.js';
import { absoluteLink, siteLink } from '../shared/urls.js';
import { PUBLIC_DIR } from './public.js';

const FEED_PATH = 'feed.xml';
const SITEMAP_PATH = 'sitemap.xml';
const ROBOTS_PATH = 'robots.txt';
const FEED_ADDRESS = /(<(?:a|img)\s[^>]*?\b(?:href|src)=")([^"]*)"/g;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// The data attributes serve the scripts of the page, which a feed reader does not run.
const DATA_ATTRIBUTE = /\sdata-[\w-]+="[^"]*"/g;

export function feedFiles({ config, listed }) {
  return [{ path: FEED_PATH, render: () => feedXml(config, listed), owner: 'the RSS feed' }];
}

// A robots.txt in public/ replaces the one that names the sitemap.
export function robotsFiles({ root, config }) {
  if (statSync(join(root, PUBLIC_DIR, ROBOTS_PATH), { throwIfNoEntry: false })?.isFile()) return [];
  return [{ path: ROBOTS_PATH, render: () => `User-agent: *\nAllow: /\n\nSitemap: ${absoluteLink(config, SITEMAP_PATH)}\n`, owner: 'robots.txt' }];
}

export function sitemapFiles({ config, listed }) {
  return [{ path: SITEMAP_PATH, render: () => sitemapXml(config, listed.map(({ entry }) => entry)), owner: 'the sitemap' }];
}

function feedXml(config, listed) {
  const link = siteLink(config.url);
  const items = listed.map(({ article, entry }) =>
    [
      '<item>',
      element('title', entry.title),
      element('link', entry.link),
      `<guid isPermaLink="true">${escapeMarkup(entry.link)}</guid>`,
      element('pubDate', new Date(`${entry.date}T00:00:00Z`).toUTCString()),
      ...(entry.category === undefined ? [] : [element('category', entry.category.name)]),
      ...(entry.summary === undefined ? [] : [element('description', entry.summary)]),
      ...(article.content === null ? [] : [element('content:encoded', feedContent(article.content, entry.link))]),
      '</item>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
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

// The whole article for feed readers: its text with the sidenotes and references at the end, and every link and image address made absolute, since a reader shows it away from the site.
function feedContent(content, link) {
  const html = [
    content.glyphs ?? '',
    ...content.intro.map((block) => block.html),
    ...content.sections.flatMap((section) => [`<h2>${section.title}</h2>`, ...section.blocks.map((block) => block.html)]),
    ...(content.sidenotes.length === 0 ? [] : [`<ol>${content.sidenotes.map((sidenote) => `<li id="${sidenote.id}">${sidenote.html}</li>`).join('')}</ol>`]),
  ].join('\n');
  return html.replace(DATA_ATTRIBUTE, '').replace(FEED_ADDRESS, (match, before, address) => `${before}${URL_SCHEME.test(address) ? address : new URL(address, link).href}"`);
}

function sitemapXml(config, entries) {
  const urls = [element('loc', siteLink(config.url)), ...entries.map((entry) => `${element('loc', entry.link)}${element('lastmod', entry.updated ?? entry.date)}`)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `<url>${url}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

function element(name, text) {
  return `<${name}>${escapeMarkup(text)}</${name}>`;
}
