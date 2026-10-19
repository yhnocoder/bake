import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { parseArticle } from '../markdown/article.js';
import { availableThemes } from '../config/rules.js';
import { renderPlaceholderPage } from '../render/placeholder-page.js';
import { errorAt, fileStart, sortErrors } from '../report.js';
import { findArticles } from './articles.js';
import { writeDist } from './dist.js';
import { listFiles } from './files.js';
import { articleUrl, checkDuplicateUrls } from './urls.js';

const PUBLIC_DIR = 'public';

export async function build(root) {
  const errors = [];
  const themes = availableThemes(root);
  const config = await loadBakeConfig(root, themes, errors);
  if (config === null) return { errors: sortErrors(errors) };
  const rules = { themes, categories: config.categories.map((category) => category.id) };
  const articles = findArticles(root).map((article) => readArticle(root, article, rules, errors));
  checkDuplicateUrls(articles, errors);
  const published = articles.filter((article) => article.url !== null && article.fields.draft !== true);
  const outputs = published.flatMap((article) => articleOutputs(root, article, config, errors));
  outputs.push(...publicOutputs(root, outputs, errors));
  if (errors.length > 0) return { errors: sortErrors(errors) };
  writeDist(root, outputs);
  return { errors: [], pages: published.length };
}

function readArticle(root, article, rules, errors) {
  const source = readFileSync(join(root, article.file), 'utf8');
  const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
  const fields = frontMatter?.fields ?? null;
  const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
  const content = fields !== null && fields.page === undefined ? parseArticle(article.file, source, errors) : null;
  return { ...article, fields, positions: frontMatter?.positions ?? {}, url, content };
}

function articleOutputs(root, article, config, errors) {
  const base = article.url.slice(1);
  const copy = (file, path) => ({ path: `${base}${path}`, from: join(root, article.dir, file), owner: article.file });
  const { page } = article.fields;
  if (page === undefined) {
    if (article.files.includes('index.html')) {
      errors.push(errorAt(article.file, fileStart, 'index.html in the article folder conflicts with the page generated from index.md'));
    }
    const render = () => renderPlaceholderPage({ language: config.language, title: article.fields.title, summary: article.fields.summary, content: article.content });
    return [{ path: `${base}index.html`, render, owner: article.file }, ...article.files.map((file) => copy(file, file))];
  }
  if (page !== 'index.html' && article.files.includes('index.html')) {
    errors.push(errorAt(article.file, article.positions.page, `page "${page}" is published as index.html, which conflicts with index.html in the article folder`));
  }
  return article.files.map((file) => copy(file, file === page ? 'index.html' : file));
}

function publicOutputs(root, articleOutputs, errors) {
  const owners = new Map(articleOutputs.map((output) => [output.path, output.owner]));
  return listFiles(join(root, PUBLIC_DIR), (name) => name !== '.DS_Store').map((path) => {
    const message = publicConflict(path, owners);
    if (message) errors.push(errorAt(posix.join(PUBLIC_DIR, path), fileStart, message));
    return { path, from: join(root, PUBLIC_DIR, path) };
  });
}

function publicConflict(path, owners) {
  if (owners.has(path)) return `dist/${path} is also written by ${owners.get(path)}`;
  for (const [other, owner] of owners) {
    if (other.startsWith(`${path}/`) || path.startsWith(`${other}/`)) return `dist/${path} conflicts with dist/${other} written by ${owner}`;
  }
  return null;
}
