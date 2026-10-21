import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { CHAT_PREAMBLE_PATH, chatBundle } from '../chat/bundle.js';
import { readPet } from '../chat/pet-files.js';
import { petFolder } from '../config/pet.js';
import { bundleComponents } from '../components/bundle.js';
import { optionProblem } from '../components/declarations.js';
import { COMPONENTS_DIR, readComponents } from '../components/read.js';
import { CONFIG_FILE, configPosition, loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { BUILT_IN_THEMES, availableThemes } from '../config/rules.js';
import { readArticle } from '../markdown/article.js';
import { BUILT_IN_BLOCK_NAMES } from '../markdown/parse.js';
import { IMAGE_FORMATS, convertImage, readImage } from '../render/images.js';
import { mathStyles, typesetMath } from '../render/math.js';
import { errorAt, fileStart, sortErrors } from '../report.js';
import { findArticles } from './articles.js';
import { articleEntry, newestFirst } from './entries.js';
import { listFiles } from './files.js';
import { checkDuplicateUrls, indexPages } from './links.js';
import { CHAT_CATALOG_PATH, FEED_PATH, NOT_FOUND_PATH, SITEMAP_PATH, chatCatalogJson, feedXml, sitemapXml } from './site-files.js';
import { SHARE_IMAGE_DIR, shareImageOf } from './share-images.js';
import { THEMES_DIR, THEME_STYLES_PATH, builtInThemeFolders, compileTheme, themeLocation } from './theme.js';
import { THEME_OPTIONS_FILE, readThemeDeclarations } from './theme-options.js';
import { absoluteLink, articleUrl, encodePath, pageRoot, siteLink, sitePath } from '../urls.js';

const PUBLIC_DIR = 'public';

const convertedImages = new WeakMap();
const RESERVED_DIRS = [posix.dirname(THEME_STYLES_PATH), SHARE_IMAGE_DIR];
const QUERY = /\?.*$/;

export function createSite(root, { drafts = false, base, shareImages = false, prefetch = true } = {}) {
  // why: Vite reports module paths with symbolic links resolved, and they are compared with paths under the root
  return { root: realpathSync(root), drafts, base, shareImages, prefetch, settings: null, results: new Map(), articles: new Map(), themes: new Map(), unsaved: new Map() };
}

export async function updateSite(site, changedPaths = null) {
  const { root } = site;
  for (const cache of [site.results, site.articles, site.themes]) forgetChanged(cache, changedPaths);
  const found = findArticles(root);
  site.settings = await siteSettings(site, found);
  const { settings } = site;
  if (settings.errors.length > 0) return { errors: sortErrors(settings.errors), articles: [], pages: [], siteFiles: [], assetFiles: [], assetSources: new Map(), shareImages: [], publicFiles: [] };
  const { config } = settings;
  // why: a failure is reported when compileThemes asks for the theme again after the article loop
  themeOf(site, config.theme, true).catch(() => {});
  for (const file of site.articles.keys()) if (!found.some((article) => article.file === file)) site.articles.delete(file);
  const articles = [];
  for (const article of found) articles.push(await articleOf(site, article));
  const errors = [...settings.componentErrors, ...articles.flatMap((article) => article.errors)];
  checkDuplicateUrls(articles, errors);
  linkArticles(articles, errors);
  const published = articles.filter((article) => article.url !== null && (site.drafts || !article.draft));
  const [themes, bundle, chat] = await Promise.all([compileThemes(site, published, config, errors), compileComponents(site, published, errors), chatBundle()]);
  const assetFiles = assetOutputs(themes, bundle, chat);
  const assetSources = new Map(site.shareImages ? assetFiles.map((file) => [file.path, file.render()]) : []);
  const current = published.map((article) => ({ article, entry: articleEntry(article, config) }));
  const shareImages = site.shareImages && themes.get(config.theme) !== null ? shareImagesOf(root, current, config, assetSources, errors) : new Map();
  const pageSettings = { root, config, themes, bundle, chat, shareImages, mathStyles: await mathStyles() };
  const pages = current.map(({ article, entry }) => ({ article, entry, outputs: articleOutputs(root, article, entry, pageSettings, errors) }));
  const listing = [...pages].sort((a, b) => newestFirst(a.entry, b.entry));
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
  const failed = new Set(errors.map((error) => error.file));
  const drawable = [...shareImages.values()].filter((image) => !failed.has(image.owner));
  return { errors: sortErrors(errors), articles, pages, home, siteFiles, assetFiles, assetSources, shareImages: drawable, publicFiles };
}

// Each cached result keeps the paths of the blog files it read and is dropped when one of them, or a folder that holds one, changes.
function forgetChanged(cache, changedPaths) {
  for (const [name, { inputs }] of cache) {
    if (changedPaths === null || inputs.some((input) => changedPaths.some((path) => input === path || input.startsWith(`${path}/`) || path.startsWith(`${input}/`)))) cache.delete(name);
  }
}

// The entry holds the promise, so that the theme started before the article loop is not compiled a second time after it.
function cached(cache, name, key, compute) {
  const entry = cache.get(name);
  if (entry?.key === key) return entry.value;
  const next = { key, inputs: [] };
  next.value = compute().then(
    ({ value, inputs }) => {
      next.inputs = inputs;
      return value;
    },
    (error) => {
      cache.delete(name);
      throw error;
    },
  );
  cache.set(name, next);
  return next.value;
}

async function siteSettings(site, found) {
  const { root } = site;
  const themeNames = availableThemes(root);
  const settings = await cached(site.results, 'settings', themeNames.join('\n'), async () => {
    const value = await readSettings(root, themeNames);
    const pet = value.config === undefined ? null : petFolder(value.config.chat.pet);
    const options = themeNames.filter((name) => !BUILT_IN_THEMES.includes(name)).map((name) => posix.join(THEMES_DIR, name, THEME_OPTIONS_FILE));
    return { value, inputs: [CONFIG_FILE, PREAMBLE_FILE, ...BUILT_IN_THEMES.map((name) => posix.join(THEMES_DIR, name)), ...options, ...(pet === null ? [] : [pet])] };
  });
  if (settings.errors.length > 0) return settings;
  const articleDirs = found.map((article) => article.dir);
  const components = await cached(site.results, 'components', articleDirs.join('\n'), async () => {
    const errors = [];
    const value = { components: readComponents(root, { builtInBlocks: BUILT_IN_BLOCK_NAMES, articleDirs }, errors), errors };
    return { value, inputs: [COMPONENTS_DIR, ...articleDirs.map((dir) => posix.join(dir, COMPONENTS_DIR))] };
  });
  return { ...settings, components: components.components, componentErrors: components.errors };
}

async function readSettings(root, themeNames) {
  const errors = builtInThemeFolders(root);
  const { options: themeOptions, markdown } = await readThemeDeclarations(root, themeNames, errors);
  const config = await loadBakeConfig(root, themeOptions, optionProblem, errors);
  if (config === null || errors.length > 0) return { errors };
  const preamble = await readMathPreamble(root, errors);
  const pet = await readPet(root, config.chat.pet, (file, message) => errors.push(file === null ? errorAt(CONFIG_FILE, configPosition(root, ['chat', 'pet']), `chat.pet: ${message}`) : errorAt(file, fileStart, message)));
  const rules = { themes: themeNames, categories: config.categories.map((category) => category.id), theme: config.theme, options: themeOptions, optionProblem };
  return { errors, config, preamble, pet, rules, markdown };
}

function themeOf(site, name, siteTheme) {
  return cached(site.themes, name, siteTheme, async () => {
    const errors = [];
    const theme = await compileTheme(site.root, name, { siteTheme }, errors);
    const folder = BUILT_IN_THEMES.includes(name) ? [] : [posix.join(THEMES_DIR, name)];
    return { value: { theme, errors }, inputs: theme === null ? [THEMES_DIR] : [...folder, ...blogPaths(site.root, theme.sources)] };
  });
}

function blogPaths(root, files) {
  return [...files].map((file) => relative(root, file.replace(QUERY, ''))).filter((path) => path !== '' && !path.startsWith('..') && !isAbsolute(path)).map((path) => path.split(sep).join('/'));
}

async function compileThemes(site, published, config, errors) {
  const names = [...new Set([config.theme, ...published.filter((article) => article.content !== null).map((article) => articleTheme(article, config))])].sort();
  const compiled = await Promise.all(names.map((name) => themeOf(site, name, name === config.theme)));
  errors.push(...compiled.flatMap((result) => result.errors));
  return new Map(names.map((name, index) => [name, compiled[index].theme]));
}

function shareImagesOf(root, pages, config, sources, errors) {
  const failed = new Set(errors.map((error) => error.file));
  const listed = pages.filter(({ article, entry }) => !entry.draft && article.fields.page === undefined && !failed.has(article.file));
  return new Map(listed.map((page) => [page.article.file, shareImageOf(root, page, config, sources)]));
}

function siteProps(config) {
  return { title: config.title, url: config.url, language: config.language, description: config.description, link: siteLink(config.url) };
}

function homeOutput(entries, { root, config, themes, chat }, errors) {
  const html = renderSitePage(root, config, themes, 'the homepage', errors, (theme) =>
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

function notFoundOutput(entries, base, { root, config, themes }, errors) {
  const html = renderSitePage(root, config, themes, 'the 404 page', errors, (theme) =>
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

function renderSitePage(root, config, themes, label, errors, render) {
  const theme = themes.get(config.theme);
  if (theme === null) return '';
  return renderDocument(() => render(theme), themeLocation(root, config.theme), `the ${config.theme} theme cannot render ${label}`, errors);
}

function renderDocument(render, file, failure, errors) {
  try {
    return `<!doctype html>\n${render()}\n`;
  } catch (error) {
    errors.push(errorAt(file, fileStart, `${failure}: ${error instanceof Error ? error.message : String(error)}`));
    return '';
  }
}

function homeArticle({ title, summary, date, tags, category, draft, path, preview, image }) {
  return { title, summary, date, tags, category, draft, url: path, preview, image };
}

function articleTheme(article, config) {
  return article.fields.theme ?? config.theme;
}

async function compileComponents(site, published, errors) {
  const names = [...new Set(published.flatMap((article) => article.content?.components ?? []))].sort();
  if (names.length === 0) return null;
  const { root, settings } = site;
  const result = await cached(site.results, 'bundle', JSON.stringify([names, settings.preamble]), async () => {
    const bundleErrors = [];
    const components = names.map((name) => settings.components.get(name));
    const bundle = await bundleComponents(root, components, settings.preamble, bundleErrors, { prefetch: site.prefetch });
    // why: a bundle that failed has no modules, so it depends on every folder that a component of it can import from
    const folders = [COMPONENTS_DIR, ...components.flatMap((component) => (component.article === null ? [] : [posix.join(component.article, COMPONENTS_DIR)]))];
    return { value: { bundle, errors: bundleErrors }, inputs: bundle === null ? folders : blogPaths(root, bundle.modules) };
  });
  errors.push(...result.errors);
  return result.bundle;
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

function linkArticles(articles, errors) {
  const index = indexPages(articles.map(linkTarget));
  for (const article of articles) article.document?.link(index, errors);
  for (const article of articles) article.content = article.document?.structure() ?? null;
}

function linkTarget({ url, fields, draft, document }) {
  return { url, title: fields?.title ?? '', draft, article: document };
}

// An article also depends on the values of the settings it read, so a change of bake.config.js or of a component that leaves them as they were keeps it.
async function articleOf(site, found) {
  const { root, settings } = site;
  const key = (lookups) => JSON.stringify([found.files, settings.rules, [...settings.rules.options], [...settings.markdown], settings.preamble, lookups.map((name) => settings.components.get(name) ?? null)]);
  const entry = site.articles.get(found.file);
  if (entry !== undefined && entry.key === key(entry.lookups)) return entry.article;
  const lookups = new Set();
  const components = {
    get: (name) => {
      lookups.add(name);
      return settings.components.get(name);
    },
  };
  const source = site.unsaved.get(found.file) ?? readFileSync(join(root, found.file), 'utf8');
  const article = await loadArticle(root, found, source, { ...settings, components });
  site.articles.set(found.file, { article, lookups: [...lookups], key: key([...lookups]), inputs: [found.file, ...found.files.map((file) => posix.join(found.dir, file))] });
  return article;
}

async function loadArticle(root, article, source, { rules, preamble, components, markdown }) {
  const errors = [];
  const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
  const fields = frontMatter?.fields ?? null;
  const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
  const folder = { path: join(root, article.dir), files: article.files };
  const theme = markdown.get(fields?.theme ?? rules.theme);
  const document = fields?.page === undefined ? await readArticle(article.file, source, errors, { folder, preamble, url, components, theme }) : null;
  const positions = frontMatter?.positions ?? {};
  const options = frontMatter?.options ?? {};
  const cover = fields?.cover === undefined ? undefined : await readCover(join(folder.path, fields.cover), fields.cover, article.file, positions.cover, errors);
  return { ...article, source, fields, options, positions, url, draft: fields?.draft === true, document, content: null, cover, errors };
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
  const name = articleTheme(article, config);
  const theme = themes.get(name);
  if (theme === null) return '';
  const { content } = article;
  const root = pageRoot(entry.url);
  const props = {
    site: siteProps(config),
    options: { ...config.themes[name], ...article.options },
    article: {
      title: entry.title,
      summary: entry.summary,
      date: entry.date,
      tags: entry.tags,
      category: entry.category,
      draft: entry.draft,
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
  return renderDocument(() => theme.render(props), article.file, `the ${name} theme cannot render this article`, errors);
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
