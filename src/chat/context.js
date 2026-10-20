import { escapeMarkup } from '../build/escape.js';
import { articleSource } from '../copy/copy.js';

export const CATALOG_PATH = '_bake/articles.json';
export const ARTICLE_REGION = '[data-region="article"]';
export const READ_ARTICLE = 'read_article';

const MAX_TOOL_TEXT = 120000;
const UI = '[data-ui]';

export const chatTools = [
  {
    type: 'function',
    function: {
      name: READ_ARTICLE,
      description: 'Read the full Markdown source of one article of this blog, or the text of one of its HTML pages.',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string', description: 'The address of the article as listed, such as /2026-10/rope/' } },
        required: ['address'],
      },
    },
  },
];

export function currentPage(root) {
  const source = articleSource();
  const article = document.querySelector(ARTICLE_REGION);
  return {
    address: `/${decodeURI(location.pathname).slice(new URL(root).pathname.length)}`,
    site: meta('og:site_name') ?? location.hostname,
    title: meta('og:title') ?? document.title,
    article: source === null ? null : { source, element: article, outline: article === null ? [] : outlineOf(article) },
  };
}

function meta(property) {
  return document.querySelector(`meta[property="${property}"]`)?.content ?? null;
}

export function outlineOf(article) {
  return [...article.querySelectorAll('h2[id], h3[id]')].map((heading) => {
    const copy = heading.cloneNode(true);
    for (const ui of copy.querySelectorAll(UI)) ui.remove();
    return { id: heading.id, depth: Number(heading.tagName[1]), title: copy.textContent.trim().replace(/\s+/g, ' ') };
  });
}

let catalogRequest = null;

export function loadCatalog(root, { fetch = globalThis.fetch } = {}) {
  catalogRequest ??= fetch(new URL(CATALOG_PATH, root)).then((response) => {
    if (!response.ok) throw new Error(`${CATALOG_PATH} answered ${response.status}`);
    return response.json();
  });
  catalogRequest.catch(() => {
    catalogRequest = null;
  });
  return catalogRequest;
}

export function scopeOptions(catalog, labels) {
  const articles = catalog.articles.map((entry) => ({ kind: 'article', id: `article:${entry.url}`, label: entry.title, meta: entry.date.slice(0, 7), search: `${entry.title} ${entry.url}`, urls: [entry.url] }));
  const months = groups(catalog.articles, (entry) => [entry.date.slice(0, 7)]).map(([month, entries]) => ({ kind: 'month', id: `month:${month}`, label: month, meta: labels.articleCount(entries.length), search: month, urls: entries.map((entry) => entry.url) }));
  const categories = groups(catalog.articles, (entry) => (entry.category === undefined ? [] : [entry.category])).map(([name, entries]) => ({ kind: 'topic', id: `category:${name}`, label: name, meta: labels.categoryCount(entries.length), search: name, urls: entries.map((entry) => entry.url) }));
  const tags = groups(catalog.articles, (entry) => entry.tags).map(([tag, entries]) => ({ kind: 'topic', id: `tag:${tag}`, label: `#${tag}`, meta: labels.tagCount(entries.length), search: tag, urls: entries.map((entry) => entry.url) }));
  return [...articles, ...months, ...categories, ...tags];
}

export function matchingScopes(options, query, picked) {
  const words = query.toLowerCase();
  return options.filter((option) => !picked.some((scope) => scope.id === option.id) && `${option.label} ${option.search}`.toLowerCase().includes(words));
}

function groups(entries, keysOf) {
  const map = new Map();
  for (const entry of entries) {
    for (const key of keysOf(entry)) map.set(key, [...(map.get(key) ?? []), entry]);
  }
  return [...map];
}

export function systemPrompt({ page, catalog, scopes = [], sources = [] }) {
  const where = page.article === null ? `on the page ${page.address}` : `reading the article "${page.title}" at ${page.address}`;
  const intro = [`You are the reading assistant of the blog "${catalog.title}"${catalog.description === undefined ? '' : ` (${catalog.description})`}. The reader is ${where}.`, ...commonRules];
  const links = 'Link articles and sections with their addresses and section ids, such as [the article](/2026-10/rope/) or [the section](/2026-10/rope/#id).';
  if (scopes.length > 0) {
    const listed = new Set(scopes.filter((scope) => scope.kind !== 'article').flatMap((scope) => scope.urls));
    return [
      ...intro,
      `The reader limited the question to ${scopes.map((scope) => scope.label).join(', ')}. Answer from these articles. Say so when they do not cover something, and mark what you add from elsewhere.`,
      links,
      ...sources.map((source) => [`<article address="${escapeMarkup(`/${source.url}`)}" title="${escapeMarkup(source.title)}">`, source.content, '</article>'].join('\n')),
      ...(listed.size === 0 ? [] : [`Read these articles with ${READ_ARTICLE} before you answer; read every one that may be relevant. They are listed one JSON object per line:`, ...catalogLines(catalog.articles.filter((entry) => listed.has(entry.url)))]),
    ].join('\n');
  }
  const blog = [`The blog's articles are listed below, one JSON object per line. Before you answer a question about the content of other articles, call ${READ_ARTICLE} with their addresses and read them; read several when the question spans articles. Do not describe content you have not read.`, links, ...catalogLines(catalog.articles)];
  if (page.article === null) return [...intro, ...blog].join('\n');
  const outline = page.article.outline.map((heading) => `${heading.depth === 3 ? '  ' : ''}- #${heading.id} ${heading.title}`);
  return [
    ...intro,
    `Questions are about this article unless the reader asks about others. Its Markdown source is between the <article> tags below. Base your answers on the article. Say so when it does not cover something, and mark what you add from outside the blog.`,
    'When you refer to a part of this article, link it with its id, such as [the heading](#id). The headings and their ids are:',
    ...(outline.length === 0 ? ['(the article has no headings)'] : outline),
    '<article>',
    page.article.source,
    '</article>',
    ...blog,
  ].join('\n');
}

function catalogLines(entries) {
  return entries.map((entry) =>
    JSON.stringify({
      address: `/${entry.url}`,
      title: entry.title,
      date: entry.date,
      summary: entry.summary,
      tags: entry.tags.length === 0 ? undefined : entry.tags,
      category: entry.category,
      sections: entry.sections.length === 0 ? undefined : entry.sections.map(sectionLine),
    }),
  );
}

const commonRules = [
  'Answer in the language the reader writes in. Write Markdown. Write formulas in TeX, between $ and $ inline and between $$ and $$ on their own lines.',
];

function sectionLine(section) {
  const children = section.subsections.map((subsection) => `#${subsection.id} ${subsection.title}`);
  return [`#${section.id} ${section.number} ${section.title}`, ...children].join(' | ');
}

export async function readArticle(root, catalog, address, { fetch = globalThis.fetch } = {}) {
  const entry = findEntry(root, catalog, String(address ?? ''));
  if (entry === null) return { content: `There is no article at ${JSON.stringify(address)}. Use an address from the list.`, label: String(address ?? ''), failed: true };
  try {
    const response = await fetch(new URL(entry.source ?? entry.url, root));
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const text = await response.text();
    const content = entry.source === undefined ? new DOMParser().parseFromString(text, 'text/html').body.textContent.replace(/\n\s*\n+/g, '\n\n').trim() : text;
    return { content: content.slice(0, MAX_TOOL_TEXT), label: entry.title };
  } catch (error) {
    return { content: `The article could not be read: ${error.message}`, label: entry.title, failed: true };
  }
}

function findEntry(root, catalog, address) {
  let path;
  try {
    const url = new URL(address.replace(/^\/+/, ''), root);
    path = decodeURI(url.pathname).slice(new URL(root).pathname.length);
  } catch {
    return null;
  }
  const normal = path.replace(/index\.(?:html|md)$/, '').replace(/\/?$/, '/');
  return catalog.articles.find((entry) => entry.url === normal) ?? null;
}
