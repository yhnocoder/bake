import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CONFIG_FILE, loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { availableThemes } from '../config/rules.js';
import { readArticle } from '../markdown/article.js';
import { convertImage } from '../render/images.js';
import { mathStyles, typesetMath } from '../render/math.js';
import { errorAt, fileStart, sortErrors } from '../report.js';
import { findArticles } from './articles.js';
import { listFiles } from './files.js';
import { indexPages } from './links.js';
import { THEMES_DIR, compileTheme } from './theme.js';
import { articleUrl, checkDuplicateUrls, pageRoot } from './urls.js';

export const PUBLIC_DIR = 'public';

const convertedImages = new WeakMap();

export function createSite(root, { drafts = false } = {}) {
  return { root, drafts, settings: null, articles: new Map(), themes: new Map() };
}

export async function updateSite(site, changedPaths = null) {
  const { root } = site;
  const touches = (path) => changedPaths === null || changedPaths.some((changed) => changed === path || changed.startsWith(`${path}/`));
  if (touches(THEMES_DIR)) site.themes.clear();
  if (site.settings === null || touches(CONFIG_FILE) || touches(PREAMBLE_FILE) || touches(THEMES_DIR)) {
    site.settings = await readSettings(root);
    site.articles.clear();
  }
  const { settings } = site;
  if (settings.errors.length > 0) return { errors: sortErrors(settings.errors), articles: [], pages: [], themeFiles: [], publicFiles: [] };
  const articles = [];
  for (const found of findArticles(root)) {
    const cached = site.articles.get(found.file);
    const unchanged = cached !== undefined && !touches(found.dir) && cached.files.join('\n') === found.files.join('\n');
    articles.push(unchanged ? cached : await loadArticle(root, found, settings));
  }
  site.articles = new Map(articles.map((article) => [article.file, article]));
  const errors = articles.flatMap((article) => article.errors);
  checkDuplicateUrls(articles, errors);
  linkArticles(articles, errors);
  const published = articles.filter((article) => article.url !== null && (site.drafts || article.fields.draft !== true));
  const themes = await compileThemes(site, published, settings.config, errors);
  const pageSettings = { config: settings.config, themes, mathStyles: await mathStyles() };
  const pages = published.map((article) => ({ article, outputs: articleOutputs(root, article, pageSettings, errors) }));
  const home = homeOutput(published, pageSettings, errors);
  const themeFiles = themeOutputs(themes);
  const publicFiles = publicOutputs(root, [...pages.flatMap((page) => page.outputs), home], errors);
  return { errors: sortErrors(errors), articles, pages, home, themeFiles, publicFiles };
}

async function readSettings(root) {
  const errors = [];
  const themeNames = availableThemes(root);
  const config = await loadBakeConfig(root, themeNames, errors);
  if (config === null) return { errors };
  const preamble = await readMathPreamble(root, errors);
  return { errors, config, preamble, rules: { themes: themeNames, categories: config.categories.map((category) => category.id) } };
}

async function compileThemes(site, published, config, errors) {
  const names = new Set([config.theme, ...published.filter((article) => article.content !== null).map((article) => themeOf(article, config))]);
  const themes = new Map();
  for (const name of [...names].sort()) {
    const home = name === config.theme;
    if (site.themes.get(name)?.home !== home) {
      const themeErrors = [];
      site.themes.set(name, { theme: await compileTheme(site.root, name, { home }, themeErrors), home, errors: themeErrors });
    }
    const { theme, errors: themeErrors } = site.themes.get(name);
    errors.push(...themeErrors);
    themes.set(name, theme);
  }
  return themes;
}

function siteProps(config) {
  return { title: config.title, url: config.url, language: config.language, description: config.description };
}

function homeOutput(published, { config, themes }, errors) {
  const theme = themes.get(config.theme);
  const html = theme === null ? '' : renderHome(theme, published, config, errors);
  return { path: 'index.html', render: () => html, owner: 'the homepage' };
}

function renderHome(theme, published, config, errors) {
  const props = {
    site: siteProps(config),
    home: { groupBy: config.home.groupBy, columns: config.home.columns, categories: config.categories },
    articles: published.map((article) => homeEntry(article, config)).sort(newestFirst),
    assets: { root: './', styles: theme.styles, scripts: theme.scripts },
  };
  try {
    return `<!doctype html>\n${theme.renderHome(props)}\n`;
  } catch (error) {
    const folder = posix.join(THEMES_DIR, config.theme);
    errors.push(errorAt(folder, fileStart, `the ${config.theme} theme cannot render the homepage: ${error instanceof Error ? error.message : String(error)}`));
    return '';
  }
}

function homeEntry(article, config) {
  const base = article.url.slice(1);
  const { fields, content } = article;
  return {
    title: fields.title,
    summary: fields.summary,
    date: fields.date,
    tags: fields.tags ?? [],
    category: config.categories.find((category) => category.id === fields.category),
    draft: fields.draft === true,
    url: base,
    preview: fields.preview === undefined ? undefined : `${base}${fields.preview}`,
    image: content?.image === undefined ? undefined : `${base}${content.image}`,
  };
}

function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.title === b.title) return 0;
  return a.title < b.title ? -1 : 1;
}

function themeOf(article, config) {
  return article.fields.theme ?? config.theme;
}

function themeOutputs(themes) {
  const outputs = new Map();
  for (const [name, theme] of themes) {
    for (const file of theme?.files ?? []) {
      if (!outputs.has(file.path)) outputs.set(file.path, { path: file.path, render: () => file.source, owner: `the ${name} theme` });
    }
  }
  return [...outputs.values()];
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

function linkArticles(articles, errors) {
  const index = indexPages(
    articles.map(({ url, fields, document }) => ({ url, title: fields?.title ?? '', draft: fields?.draft === true, article: document })),
  );
  for (const article of articles) article.document?.link(index, errors);
  for (const article of articles) article.content = article.document?.structure() ?? null;
}

async function loadArticle(root, article, { rules, preamble }) {
  const errors = [];
  const source = readFileSync(join(root, article.file), 'utf8');
  const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
  const fields = frontMatter?.fields ?? null;
  const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
  const folder = { path: join(root, article.dir), files: article.files };
  const document = fields?.page === undefined ? await readArticle(article.file, source, errors, { folder, preamble, url }) : null;
  return { ...article, fields, positions: frontMatter?.positions ?? {}, url, document, content: null, errors };
}

function articleOutputs(root, article, pageSettings, errors) {
  const base = article.url.slice(1);
  const copy = (file, path) => ({ path: `${base}${path}`, from: join(root, article.dir, file), owner: article.file });
  const { page } = article.fields;
  if (page === undefined) {
    if (article.files.includes('index.html')) {
      errors.push(errorAt(article.file, fileStart, 'index.html in the article folder conflicts with the page generated from index.md'));
    }
    const html = renderArticle(article, pageSettings, errors);
    const images = article.content.images.map((image) => ({
      path: `${base}${image.path}`,
      render: () => convertedImage(join(root, article.dir, image.source), image),
      owner: article.file,
    }));
    const converted = new Set(article.content.images.flatMap((image) => (image.keepSource ? [image.path] : [image.path, image.source])));
    const copies = article.files.filter((file) => !converted.has(file)).map((file) => copy(file, file));
    return [{ path: `${base}index.html`, render: () => html, owner: article.file }, ...images, ...copies];
  }
  if (page !== 'index.html' && article.files.includes('index.html')) {
    errors.push(errorAt(article.file, article.positions.page, `page "${page}" is published as index.html, which conflicts with index.html in the article folder`));
  }
  return article.files.map((file) => copy(file, file === page ? 'index.html' : file));
}

function convertedImage(file, image) {
  if (!convertedImages.has(image)) convertedImages.set(image, convertImage(file, image));
  return convertedImages.get(image);
}

function renderArticle(article, { config, themes, mathStyles }, errors) {
  const name = themeOf(article, config);
  const theme = themes.get(name);
  if (theme === null) return '';
  const { fields, content } = article;
  const root = pageRoot(article.url);
  const props = {
    site: siteProps(config),
    article: {
      title: fields.title,
      summary: fields.summary,
      date: fields.date,
      tags: fields.tags ?? [],
      category: fields.category,
      draft: fields.draft === true,
      toc: fields.toc ?? config.toc,
      url: article.url,
      words: content.words,
      content,
    },
    assets: {
      root,
      styles: theme.styles.map((path) => `${root}${path}`),
      scripts: theme.scripts.map((path) => `${root}${path}`),
      mathStyles: content.glyphs === undefined ? undefined : mathStyles,
    },
  };
  try {
    return `<!doctype html>\n${theme.render(props)}\n`;
  } catch (error) {
    errors.push(errorAt(article.file, fileStart, `the ${name} theme cannot render this article: ${error instanceof Error ? error.message : String(error)}`));
    return '';
  }
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
