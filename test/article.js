import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { indexPages } from '../src/build/links.js';
import { readArticle } from '../src/markdown/article.js';
import { formatError, sortErrors } from '../src/report.js';
import * as bento from '../src/themes/bento/options.js';
import * as essay from '../src/themes/essay/options.js';

export const frontMatter = '---\ntitle: T\nslug: t\ndate: 2026-10-19\n---\n\n';
export const essayTheme = { name: 'essay', headings: essay.headings, blocks: {} };
export const bentoTheme = { name: 'bento', headings: bento.headings, blocks: bento.blocks };

export async function parseArticle(file, source, errors, options = {}) {
  const article = await readArticle(file, source, errors, { theme: essayTheme, ...options });
  article.link(indexPages([{ url: article.url, title: '', draft: false, article }]), errors);
  return withoutCopySource(article.structure());
}

export async function parse(body, options) {
  const errors = [];
  const article = await parseArticle('index.md', frontMatter + body, errors, options);
  return { article, errors: sortErrors(errors).map(formatError) };
}

export async function parsed(body, options) {
  const { article, errors } = await parse(body, options);
  assert.deepEqual(errors, []);
  return article;
}

export async function parseSite(pages, options = {}) {
  const errors = [];
  const entries = [];
  for (const { url, title = 'Title', draft = false, body, folder = null } of pages) {
    const article = await readArticle(`${url.split('/')[2]}.md`, frontMatter + body, errors, { theme: essayTheme, ...options, folder, url });
    entries.push({ url, title, draft, article });
  }
  const site = indexPages(entries);
  for (const { article } of entries) article.link(site, errors);
  const articles = Object.fromEntries(entries.map(({ url, article }) => [url, withoutCopySource(article.structure())]));
  return { articles, errors: sortErrors(errors).map(formatError) };
}

export async function html(body, options) {
  return outline((await parsed(body, options)).intro.map((block) => block.html).join('\n'));
}

export function outline(html) {
  return html
    .replace(/<mjx-container([^>]*)>[\s\S]*?<\/mjx-container>/g, (match, attributes) => {
      const delimiter = attributes.includes('display="true"') ? '$$' : '$';
      return `${delimiter}${/data-tex="([^"]*)"/.exec(attributes)[1]}${delimiter}`;
    })
    .replace(/<pre class="shiki bake"[^>]*?(?: data-language="([^"]*)")?><code>([\s\S]*?)<\/code><\/pre>/g, (match, language = '', code) => `\`\`\`${language}\n${code.replace(/<[^>]*>/g, '')}\n\`\`\``);
}

// why: the source offsets and the embedded source serve copying as Markdown, which the browser tests check; the HTML tests read the markup without them
export function withoutCopySource(value) {
  if (typeof value === 'string') return value.replace(/ data-(?:src="\d+ \d+"|markdown="[^"]*")/g, '');
  if (Array.isArray(value)) return value.map(withoutCopySource);
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([name, field]) => [name, withoutCopySource(field)]));
}

export function components(declarations) {
  return new Map(Object.entries(declarations).map(([name, { params = {}, layout = { height: 100 }, valid = true }]) => [name, { name, article: null, valid, params, layout }]));
}

export function folder(path) {
  return { files: readdirSync(path), read: (file) => readFileSync(join(path, file)) };
}
