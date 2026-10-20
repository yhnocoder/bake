import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CHAT_PREAMBLE_PATH, chatBundle } from '../chat/bundle.js';
import { readPet } from '../chat/pet-files.js';
import { petFolder } from '../config/pet.js';
import { bundleComponents } from '../components/bundle.js';
import { COMPONENTS_DIR, readComponents } from '../components/read.js';
import { CONFIG_FILE, configPosition, loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { availableThemes } from '../config/rules.js';
import { BUILT_IN_BLOCK_NAMES, readArticle } from '../markdown/article.js';
import { IMAGE_FORMATS, convertImage, readImage } from '../render/images.js';
import { mathStyles, typesetMath } from '../render/math.js';
import { errorAt, fileStart, sortErrors } from '../report.js';
import { findArticles } from './articles.js';
import { articleEntry, newestFirst } from './entries.js';
import { listFiles } from './files.js';
import { indexPages } from './links.js';
import { CHAT_CATALOG_PATH, FEED_PATH, NOT_FOUND_PATH, SITEMAP_PATH, absoluteLink, chatCatalogJson, feedXml, siteLink, sitePath, sitemapXml } from './site-files.js';
import { SHARE_IMAGE_DIR, shareImageOf } from './share-images.js';
import { THEMES_DIR, THEME_STYLES_PATH, compileTheme } from './theme.js';
import { optionProblem, readThemeOptions } from './theme-options.js';
import { articleUrl, checkDuplicateUrls, encodePath, pageRoot } from '../urls.js';

const PUBLIC_DIR = 'public';

const convertedImages = new WeakMap();
const RESERVED_DIRS = [posix.dirname(THEME_STYLES_PATH), SHARE_IMAGE_DIR];

export function createSite(root, { drafts = false, base, shareImages = false, prefetch = true } = {}) {
  return { root, drafts, base, shareImages, prefetch, settings: null, articles: new Map(), lastGood: new Map(), themes: new Map(), bundle: null };
}

export async function updateSite(site, changedPaths = null) {
  const { root } = site;
  const touches = (path) => changedPaths === null || changedPaths.some((changed) => changed === path || changed.startsWith(`${path}/`));
  if (touches(THEMES_DIR)) site.themes.clear();
  const pet = site.settings?.config ? petFolder(site.settings.config.chat.pet) : null;
  if (site.settings === null || touches(CONFIG_FILE) || touches(PREAMBLE_FILE) || touches(THEMES_DIR) || touches(COMPONENTS_DIR) || (pet !== null && touches(pet))) {
    site.settings = await readSettings(root);
    site.articles.clear();
    site.bundle = null;
  }
  const { settings } = site;
  if (settings.errors.length > 0) return { errors: sortErrors(settings.errors), articleErrorsOnly: false, articles: [], pages: [], siteFiles: [], assetFiles: [], shareImages: [], publicFiles: [] };
  const articles = [];
  for (const found of findArticles(root)) {
    const cached = site.articles.get(found.file);
    const unchanged = cached !== undefined && !touches(found.dir) && cached.files.join('\n') === found.files.join('\n');
    articles.push(unchanged ? cached : await loadArticle(root, found, settings));
  }
  site.articles = new Map(articles.map((article) => [article.file, article]));
  const errors = [...settings.componentErrors, ...articles.flatMap((article) => article.errors)];
  checkDuplicateUrls(articles, errors);
  linkArticles(articles, site.lastGood, errors);
  const { config } = settings;
  const published = articles.filter((article) => article.url !== null && (site.drafts || !article.draft));
  const [themes, bundle, chat] = await Promise.all([compileThemes(site, published, config, errors), compileComponents(site, published, errors), chatBundle()]);
  const assetFiles = assetOutputs(themes, bundle, chat);
  const current = published.map((article) => ({ article, entry: articleEntry(article, config) }));
  const shareImages = site.shareImages && themes.get(config.theme) !== null ? shareImagesOf(root, current, config, assetFiles, errors) : new Map();
  const pageSettings = { config, themes, bundle, chat, shareImages, mathStyles: await mathStyles() };
  const pages = current.map(({ article, entry }) => ({ article, entry, outputs: articleOutputs(root, article, entry, pageSettings, errors) }));
  const shown = shownPages(articles, pages, site.lastGood, config, errors);
  const listing = [...shown.values()].sort((a, b) => newestFirst(a.entry, b.entry));
  const listed = listing.filter(({ entry }) => !entry.draft);
  const listedEntries = listed.map(({ entry }) => entry);
  const home = homeOutput(listing.map(({ entry }) => entry), pageSettings, errors);
  const siteFiles = [
    { path: FEED_PATH, render: () => feedXml(config, listedEntries), owner: 'the RSS feed' },
    { path: SITEMAP_PATH, render: () => sitemapXml(config, listedEntries), owner: 'the sitemap' },
    { path: CHAT_CATALOG_PATH, render: () => chatCatalogJson(config, listed), owner: 'the AI chat' },
    { path: CHAT_PREAMBLE_PATH, render: () => `${JSON.stringify(settings.preamble.map((definition) => definition.tex))}\n`, owner: 'the AI chat' },
    notFoundOutput(listedEntries, site.base ?? sitePath(config.url), pageSettings, errors),
    ...settings.pet.files.map((file) => ({ path: file.path, render: () => file.source, owner: 'the AI chat' })),
  ];
  const generated = [...pages.flatMap((page) => page.outputs), home, ...siteFiles, ...assetFiles, ...shareImages.values()];
  const publicFiles = publicOutputs(root, generated, errors);
  const articleFiles = new Set(articles.map((article) => article.file));
  const articleErrorsOnly = errors.every((error) => articleFiles.has(error.file));
  if (articleErrorsOnly) site.lastGood = shown;
  return { errors: sortErrors(errors), articleErrorsOnly, articles, pages: [...shown.values()], home, siteFiles, assetFiles, shareImages: [...shareImages.values()], publicFiles };
}

function shownPages(articles, pages, lastGood, config, errors) {
  const failed = new Set(errors.map((error) => error.file));
  const current = new Map(pages.map((page) => [page.article.file, page]));
  const shown = new Map();
  for (const { file } of articles) {
    const good = lastGood.get(file);
    if (!failed.has(file) && current.has(file)) shown.set(file, current.get(file));
    else if (failed.has(file) && good !== undefined) shown.set(file, { ...good, entry: articleEntry(good.article, config) });
  }
  return shown;
}

async function readSettings(root) {
  const errors = [];
  const themeNames = availableThemes(root);
  const themeOptions = await readThemeOptions(root, themeNames, errors);
  const config = await loadBakeConfig(root, themeOptions, optionProblem, errors);
  if (config === null || errors.length > 0) return { errors };
  const preamble = await readMathPreamble(root, errors);
  const pet = await readPet(root, config.chat.pet, (file, message) => errors.push(file === null ? errorAt(CONFIG_FILE, configPosition(root, ['chat', 'pet']), `chat.pet: ${message}`) : errorAt(file, fileStart, message)));
  const componentErrors = [];
  const components = errors.length > 0 ? new Map() : await readComponents(root, { builtInBlocks: BUILT_IN_BLOCK_NAMES }, componentErrors);
  return { errors, config, preamble, pet, components, componentErrors, rules: { themes: themeNames, categories: config.categories.map((category) => category.id) } };
}

async function compileThemes(site, published, config, errors) {
  const names = new Set([config.theme, ...published.filter((article) => article.content !== null).map((article) => themeOf(article, config))]);
  const sorted = [...names].sort();
  await Promise.all(sorted.map(async (name) => {
    const siteTheme = name === config.theme;
    if (site.themes.get(name)?.siteTheme === siteTheme) return;
    const themeErrors = [];
    site.themes.set(name, { theme: await compileTheme(site.root, name, { siteTheme }, themeErrors), siteTheme, errors: themeErrors });
  }));
  const themes = new Map();
  for (const name of sorted) {
    const { theme, errors: themeErrors } = site.themes.get(name);
    errors.push(...themeErrors);
    themes.set(name, theme);
  }
  return themes;
}

function shareImagesOf(root, pages, config, assetFiles, errors) {
  const sources = new Map(assetFiles.map((file) => [file.path, file.render()]));
  const failed = new Set(errors.map((error) => error.file));
  const listed = pages.filter(({ article, entry }) => !entry.draft && article.fields.page === undefined && !failed.has(article.file));
  return new Map(listed.map((page) => [page.article.file, shareImageOf(root, page, config, sources)]));
}

function siteProps(config) {
  return { title: config.title, url: config.url, language: config.language, description: config.description, link: siteLink(config.url) };
}

function homeOutput(entries, { config, themes, chat }, errors) {
  const html = renderSitePage(config, themes, 'the homepage', errors, (theme) =>
    theme.renderHome({
      site: siteProps(config),
      options: config.themes[config.theme],
      home: { groupBy: config.home.groupBy, columns: config.home.columns, categories: config.categories },
      articles: entries.map(homeArticle),
      assets: { root: './', styles: assetLinks('', theme.styles), scripts: assetLinks('', [theme.script, chat.entry]) },
    }),
  );
  return { path: 'index.html', render: () => html, owner: 'the homepage' };
}

function notFoundOutput(entries, base, { config, themes }, errors) {
  const html = renderSitePage(config, themes, 'the 404 page', errors, (theme) =>
    theme.renderNotFound({
      site: siteProps(config),
      options: config.themes[config.theme],
      articles: entries.map((entry) => ({ title: entry.title, url: entry.path })),
      assets: { root: base, styles: assetLinks(base, theme.styles), scripts: assetLinks(base, [theme.script]) },
    }),
  );
  return { path: NOT_FOUND_PATH, render: () => html, owner: 'the 404 page' };
}

function assetLinks(root, paths) {
  return paths.map((path) => `${root}${encodePath(path)}`);
}

function renderSitePage(config, themes, label, errors, render) {
  const theme = themes.get(config.theme);
  if (theme === null) return '';
  try {
    return `<!doctype html>\n${render(theme)}\n`;
  } catch (error) {
    const folder = posix.join(THEMES_DIR, config.theme);
    errors.push(errorAt(folder, fileStart, `the ${config.theme} theme cannot render ${label}: ${error instanceof Error ? error.message : String(error)}`));
    return '';
  }
}

function homeArticle({ title, summary, date, tags, category, draft, path, preview, image }) {
  return { title, summary, date, tags, category, draft, url: path, preview, image };
}

function themeOf(article, config) {
  return article.fields.theme ?? config.theme;
}

async function compileComponents(site, published, errors) {
  const names = [...new Set(published.flatMap((article) => article.content?.components ?? []))].sort();
  if (names.length === 0) return null;
  const key = names.join('\n');
  if (site.bundle?.key !== key) {
    const { root, settings } = site;
    const bundleErrors = [];
    const components = names.map((name) => settings.components.get(name));
    site.bundle = { key, bundle: await bundleComponents(root, components, settings.preamble, bundleErrors, { prefetch: site.prefetch }), errors: bundleErrors };
  }
  errors.push(...site.bundle.errors);
  return site.bundle.bundle;
}

function assetOutputs(themes, bundle, chat) {
  const outputs = new Map();
  const add = (files, owner) => {
    for (const file of files) {
      if (!outputs.has(file.path)) outputs.set(file.path, { path: file.path, render: () => file.source, owner });
    }
  };
  for (const [name, theme] of themes) add(theme?.files ?? [], `the ${name} theme`);
  add(bundle?.files ?? [], 'the components');
  add(chat.files, 'the AI chat');
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

function linkArticles(articles, lastGood, errors) {
  const failed = new Set(errors.map((error) => error.file));
  const changed = articles.filter((article) => lastGood.has(article.file) && lastGood.get(article.file).article !== article);
  const failing = new Set(changed.filter((article) => failed.has(article.file)));
  let linkErrors;
  let size;
  do {
    size = failing.size;
    linkErrors = linkWithLastGood(articles, failing, lastGood);
    const failedLinks = new Set(linkErrors.map((error) => error.file));
    for (const article of changed) if (failedLinks.has(article.file)) failing.add(article);
  } while (failing.size > size);
  for (const article of articles) article.content = article.document?.structure() ?? null;
  errors.push(...linkErrors);
}

function linkWithLastGood(articles, failing, lastGood) {
  const errors = [];
  const shown = articles.map((article) => (failing.has(article) ? lastGood.get(article.file).article : article));
  const index = indexPages(shown.map(linkTarget));
  for (const article of articles) {
    const own = failing.has(article) ? indexPages(articles.map((other, position) => linkTarget(other === article ? article : shown[position]))) : index;
    article.document?.link(own, errors);
  }
  return errors;
}

function linkTarget({ url, fields, draft, document }) {
  return { url, title: fields?.title ?? '', draft, article: document };
}

async function loadArticle(root, article, { rules, preamble, components }) {
  const errors = [];
  const source = readFileSync(join(root, article.file), 'utf8');
  const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
  const fields = frontMatter?.fields ?? null;
  const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
  const folder = { path: join(root, article.dir), files: article.files };
  const document = fields?.page === undefined ? await readArticle(article.file, source, errors, { folder, preamble, url, components }) : null;
  const positions = frontMatter?.positions ?? {};
  const cover = fields?.cover === undefined ? undefined : await readCover(join(folder.path, fields.cover), fields.cover, article.file, positions.cover, errors);
  return { ...article, source, fields, positions, url, draft: fields?.draft === true, document, content: null, cover, errors };
}

async function readCover(path, cover, file, position, errors) {
  const image = await readImage(path);
  if (image.width !== undefined) return { format: image.format, width: image.width, height: image.height };
  const problem = image.error === undefined ? `must be a ${IMAGE_FORMATS} image` : `cannot be read: ${image.error}`;
  errors.push(errorAt(file, position, `cover ${JSON.stringify(cover)} ${problem}`));
  return undefined;
}

function articleOutputs(root, article, entry, pageSettings, errors) {
  const copy = (file, path) => ({ path: `${entry.path}${path}`, from: join(root, article.dir, file), owner: article.file });
  const { page } = article.fields;
  if (page === undefined) {
    if (article.files.includes('index.html')) {
      errors.push(errorAt(article.file, fileStart, 'index.html in the article folder conflicts with the page generated from index.md'));
    }
    const html = renderArticle(article, entry, pageSettings, errors);
    const source = { path: `${entry.path}index.md`, render: () => article.content.source, owner: article.file };
    const images = article.content.images.map((image) => ({
      path: `${entry.path}${image.path}`,
      render: () => convertedImage(join(root, article.dir, image.source), image),
      owner: article.file,
    }));
    const converted = new Set(article.content.images.flatMap((image) => (image.keepSource ? [image.path] : [image.path, image.source])));
    const copies = article.files.filter((file) => !converted.has(file)).map((file) => copy(file, file));
    return [{ path: `${entry.path}index.html`, render: () => html, owner: article.file }, source, ...images, ...copies];
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

function renderArticle(article, entry, { config, themes, bundle, chat, shareImages, mathStyles }, errors) {
  const name = themeOf(article, config);
  const theme = themes.get(name);
  if (theme === null) return '';
  const { fields, content } = article;
  const root = pageRoot(entry.url);
  const props = {
    site: siteProps(config),
    options: config.themes[name],
    article: {
      title: entry.title,
      summary: entry.summary,
      date: entry.date,
      tags: entry.tags,
      category: entry.category,
      draft: entry.draft,
      toc: fields.toc ?? config.toc,
      url: entry.url,
      link: entry.link,
      shareImage: shareImageProps(config, shareImages.get(article.file)),
      words: content.words,
      content,
    },
    assets: {
      root,
      styles: assetLinks(root, theme.styles),
      scripts: assetLinks(root, [theme.script, ...(content.components.length === 0 || bundle === null ? [] : [bundle.runtime]), chat.entry]),
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

function shareImageProps(config, image) {
  if (image === undefined) return undefined;
  return { link: absoluteLink(config, image.path), type: image.type, width: image.width, height: image.height };
}

function publicOutputs(root, outputs, errors) {
  const owners = new Map(outputs.map((output) => [output.path, output.owner]));
  return listFiles(join(root, PUBLIC_DIR), (name) => name !== '.DS_Store').map((path) => {
    const message = publicConflict(path, owners);
    if (message) errors.push(errorAt(posix.join(PUBLIC_DIR, path), fileStart, message));
    return { path, from: join(root, PUBLIC_DIR, path) };
  });
}

function publicConflict(path, owners) {
  if (owners.has(path)) return `dist/${path} is also written by ${owners.get(path)}`;
  const reserved = RESERVED_DIRS.find((dir) => path.startsWith(`${dir}/`));
  if (reserved !== undefined) return `dist/${reserved}/ is reserved for the files Bake writes`;
  for (const [other, owner] of owners) {
    if (other.startsWith(`${path}/`) || path.startsWith(`${other}/`)) return `dist/${path} conflicts with dist/${other} written by ${owner}`;
  }
  return null;
}
