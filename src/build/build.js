import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { availableThemes } from '../config/rules.js';
import { parseArticle } from '../markdown/article.js';
import { convertImage } from '../render/images.js';
import { mathStyles, typesetMath } from '../render/math.js';
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
  const preamble = await readMathPreamble(root, errors);
  if (errors.length > 0) return { errors: sortErrors(errors) };
  const rules = { themes, categories: config.categories.map((category) => category.id) };
  const articles = [];
  for (const article of findArticles(root)) articles.push(await readArticle(root, article, { rules, preamble }, errors));
  checkDuplicateUrls(articles, errors);
  const published = articles.filter((article) => article.url !== null && article.fields.draft !== true);
  const pageSettings = { language: config.language, styles: await mathStyles() };
  const outputs = published.flatMap((article) => articleOutputs(root, article, pageSettings, errors));
  outputs.push(...publicOutputs(root, outputs, errors));
  if (errors.length > 0) return { errors: sortErrors(errors) };
  await writeDist(root, outputs);
  return { errors: [], pages: published.length };
}

async function readMathPreamble(root, errors) {
  const definitions = readPreamble(root, errors);
  if (definitions.length === 0) return definitions;
  const { definitionErrors } = await typesetMath(definitions, []);
  definitionErrors.forEach((error, index) => {
    if (error !== undefined) errors.push(errorAt(PREAMBLE_FILE, definitions[index].position, `MathJax cannot read this definition: ${error}`));
  });
  return definitions;
}

async function readArticle(root, article, { rules, preamble }, errors) {
  const source = readFileSync(join(root, article.file), 'utf8');
  const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
  const fields = frontMatter?.fields ?? null;
  const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
  const folder = { path: join(root, article.dir), files: article.files };
  const content = fields?.page === undefined ? await parseArticle(article.file, source, errors, { folder, preamble }) : null;
  return { ...article, fields, positions: frontMatter?.positions ?? {}, url, content };
}

function articleOutputs(root, article, pageSettings, errors) {
  const base = article.url.slice(1);
  const copy = (file, path) => ({ path: `${base}${path}`, from: join(root, article.dir, file), owner: article.file });
  const { page } = article.fields;
  if (page === undefined) {
    if (article.files.includes('index.html')) {
      errors.push(errorAt(article.file, fileStart, 'index.html in the article folder conflicts with the page generated from index.md'));
    }
    const render = () => renderPlaceholderPage({ ...pageSettings, title: article.fields.title, summary: article.fields.summary, content: article.content });
    const images = article.content.images.map((image) => ({
      path: `${base}${image.path}`,
      render: () => convertImage(join(root, article.dir, image.source), image),
      owner: article.file,
    }));
    const converted = new Set(article.content.images.map((image) => image.path));
    const copies = article.files.filter((file) => !converted.has(file)).map((file) => copy(file, file));
    return [{ path: `${base}index.html`, render, owner: article.file }, ...images, ...copies];
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
