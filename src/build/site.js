import { realpathSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CHAT_PREAMBLE_PATH, chatBundle } from '../chat/bundle.js';
import { readPet } from '../chat/pet-files.js';
import { bundleComponents } from '../components/bundle.js';
import { optionProblem } from '../components/declarations.js';
import { readComponents } from '../components/read.js';
import { CONFIG_FILE, configPosition, loadBakeConfig } from '../config/bake-config.js';
import { readFrontMatter } from '../config/front-matter.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { availableThemes } from '../config/rules.js';
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
import { createMemo } from './memo.js';
import { THEME_STYLES_PATH, builtInThemeFolders, compileTheme, themeLocation } from './theme.js';
import { readThemeDeclarations } from './theme-options.js';
import { absoluteLink, articleUrl, encodePath, pageRoot, siteLink, sitePath } from '../urls.js';

const PUBLIC_DIR = 'public';

const RESERVED_DIRS = [posix.dirname(THEME_STYLES_PATH), SHARE_IMAGE_DIR];

export function createSite(root, { drafts = false, base, shareImages = false, prefetch = true } = {}) {
  // why: Vite reports module paths with symbolic links resolved, and they are compared with paths under the root
  const real = realpathSync(root);
  return { root: real, drafts, base, shareImages, prefetch, settings: null, memo: createMemo(real) };
}

// changedPaths names the files and folders of the blog that changed since the last update, relative to the root; null rereads every input.
export async function updateSite(site, changedPaths = null) {
  const { root, memo } = site;
  memo.startUpdate(changedPaths);
  const found = findArticles(root);
  site.settings = await siteSettings(site, found);
  const { settings } = site;
  if (settings.errors.length > 0) return { errors: sortErrors(settings.errors), articles: [], pages: [], siteFiles: [], assetFiles: [], assetSources: new Map(), shareImages: [], publicFiles: [] };
  const { config } = settings;
  // why: a failure is reported when compileThemes asks for the theme again after the article loop
  themeOf(site, config.theme, true).catch(() => {});
  const articles = [];
  for (const article of found) articles.push(await articleOf(site, article));
  const errors = [...settings.componentErrors, ...articles.flatMap((article) => article.errors)];
  checkDuplicateUrls(articles, errors);
  await linkArticles(site, articles, errors);
  // why: bake build publishes no draft, so a draft that is half written does not keep the other articles from being published
  if (!site.drafts) dropDraftErrors(articles, errors);
  const published = articles.filter((article) => article.url !== null && (site.drafts || !article.draft));
  const [themes, bundle, chat] = await Promise.all([compileThemes(site, published, config, errors), compileComponents(site, published, errors), memo.get('chat', null, () => chatBundle())]);
  const assetFiles = assetOutputs(themes, bundle, chat);
  const assetSources = new Map(site.shareImages ? assetFiles.map((file) => [file.path, file.render()]) : []);
  const current = published.map((article) => ({ article, entry: articleEntry(article, config) }));
  const shareImages = site.shareImages && themes.get(config.theme) !== null ? shareImagesOf(root, current, config, assetSources, errors) : new Map();
  const pageSettings = { root, config, themes, bundle, chat, shareImages, mathStyles: await mathStyles() };
  const pages = [];
  for (const { article, entry } of current) pages.push({ article, entry, outputs: await pageOutputs(site, article, entry, pageSettings, errors) });
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
  memo.sweep();
  return { errors: sortErrors(errors), articles, pages, home, siteFiles, assetFiles, assetSources, shareImages: drawable, publicFiles };
}

function dropDraftErrors(articles, errors) {
  const folders = articles.filter((article) => article.draft).map((article) => `${article.dir}/`);
  const kept = errors.filter((error) => !folders.some((folder) => error.file.startsWith(folder)));
  errors.splice(0, errors.length, ...kept);
}

async function siteSettings(site, found) {
  const { memo } = site;
  const settings = await memo.get('settings', null, readSettings);
  if (settings.errors.length > 0) return settings;
  const components = await memo.get('components', { articleDirs: found.map((article) => article.dir) }, (files) => {
    const errors = [];
    return { components: readComponents(files, { builtInBlocks: BUILT_IN_BLOCK_NAMES, articleDirs: files.value((context) => context.articleDirs) }, errors), errors };
  });
  return { ...settings, components: components.components, componentErrors: components.errors };
}

async function readSettings(files) {
  const themeNames = availableThemes(files);
  const errors = builtInThemeFolders(files);
  const { options: themeOptions, markdown } = await readThemeDeclarations(files, themeNames, errors);
  const config = await loadBakeConfig(files, themeOptions, optionProblem, errors);
  if (config === null || errors.length > 0) return { errors };
  const preamble = await readMathPreamble(files, errors);
  const pet = await readPet(files, config.chat.pet, (file, message) => errors.push(file === null ? errorAt(CONFIG_FILE, configPosition(files.root, ['chat', 'pet']), `chat.pet: ${message}`) : errorAt(file, fileStart, message)));
  const rules = { themes: themeNames, categories: config.categories.map((category) => category.id), theme: config.theme, options: themeOptions, optionProblem };
  return { errors, config, preamble, pet, rules, markdown };
}

// The entry holds the promise, so that the theme started before the article loop is not compiled a second time after it.
function themeOf(site, name, siteTheme) {
  return site.memo.get(`theme ${name}`, { siteTheme }, async (files) => {
    const errors = [];
    const theme = await compileTheme(files, name, { siteTheme: files.value((context) => context.siteTheme) }, errors);
    return { theme, errors };
  });
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

function homeArticle({ title, summary, date, tags, category, draft, path, preview, image, sections }) {
  return { title, summary, date, tags, category, draft, url: path, preview, image, sections };
}

function articleTheme(article, config) {
  return article.fields.theme ?? config.theme;
}

async function compileComponents(site, published, errors) {
  const names = [...new Set(published.flatMap((article) => article.content?.components ?? []))].sort();
  if (names.length === 0) return null;
  const { settings } = site;
  const result = await site.memo.get('components bundle', { components: names.map((name) => settings.components.get(name)), preamble: settings.preamble }, async (files) => {
    const errors = [];
    const bundle = await bundleComponents(files, files.value((context) => context.components), files.value((context) => context.preamble), errors, { prefetch: site.prefetch });
    return { bundle, errors };
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

async function readMathPreamble(files, errors) {
  const definitions = readPreamble(files, errors);
  if (definitions.length === 0) return definitions;
  const { definitionErrors } = await typesetMath(definitions, []);
  definitionErrors.forEach((error, index) => {
    if (error !== undefined) errors.push(errorAt(PREAMBLE_FILE, definitions[index].position, `MathJax cannot read this definition: ${error}`));
  });
  return definitions;
}

// An article is linked again when it or a page at an address it looked up changed, and its structure is computed again when its links or the links of an article whose parts it shows changed.
async function linkArticles(site, articles, errors) {
  const index = indexPages(articles.map((article) => article.page));
  const links = new Map();
  for (const article of articles.filter((candidate) => candidate.document !== null)) {
    const linked = await site.memo.get(`links ${article.file}`, { article, index }, (files) => {
      const { document } = files.same((context) => context.article);
      const linkErrors = [];
      for (const path of document.link(index, linkErrors)) {
        if (files.same((context) => context.index.page(path)) === undefined) files.value((context) => context.index.moved(path));
      }
      return { errors: linkErrors };
    });
    links.set(article.document, linked);
  }
  for (const article of articles) {
    if (article.document === null) {
      article.content = null;
      continue;
    }
    const structure = await site.memo.get(`structure ${article.file}`, { article, links }, (files) => {
      const { document } = files.same((context) => context.article);
      files.same((context) => context.links.get(document));
      const structureErrors = [];
      const content = document.structure(structureErrors);
      for (const source of document.borrowed) files.same((context) => context.links.get(source));
      return { content, errors: structureErrors };
    });
    article.content = structure.content;
    errors.push(...links.get(article.document).errors, ...structure.errors);
  }
}

// An article depends on the values of the settings it reads, so a change of bake.config.js or of a component that leaves them as they were keeps it.
function articleOf(site, found) {
  return site.memo.get(`article ${found.file}`, { found, settings: site.settings }, async (files) => {
    const article = files.value((context) => context.found);
    const rules = files.value((context) => context.settings.rules);
    const errors = [];
    const source = files.read(join(files.root, article.file), 'utf8');
    const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
    const fields = frontMatter?.fields ?? null;
    const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
    const folder = { files: article.files, read: (file) => files.read(join(files.root, article.dir, file)) };
    const themeName = fields?.theme ?? rules.theme;
    const settings = {
      folder,
      url,
      get theme() {
        return files.value((context) => context.settings.markdown.get(themeName));
      },
      get preamble() {
        return files.value((context) => context.settings.preamble);
      },
      components: { get: (name) => files.value((context) => context.settings.components.get(name)) },
    };
    const document = fields?.page === undefined ? await readArticle(article.file, source, errors, settings) : null;
    const positions = frontMatter?.positions ?? {};
    const options = frontMatter?.options ?? {};
    const cover = fields?.cover === undefined ? undefined : await readCover(folder.read(fields.cover), fields.cover, article.file, positions.cover, errors);
    const draft = fields?.draft === true;
    const page = { url, title: fields?.title ?? '', draft, article: document };
    return { ...article, source, fields, options, positions, url, draft, document, page, content: null, cover, errors, conversions: new Map() };
  });
}

async function readCover(content, cover, file, position, errors) {
  const image = await readImage(content);
  if (image.width !== undefined) return { format: image.format, width: image.width, height: image.height };
  const problem = image.error === undefined ? `must be a ${IMAGE_FORMATS} image` : `cannot be read: ${image.error}`;
  errors.push(errorAt(file, position, `cover ${JSON.stringify(cover)} ${problem}`));
  return undefined;
}

// The page is rendered again only when a value that it shows changed.
function pageOutputs(site, article, entry, pageSettings, errors) {
  const name = articleTheme(article, pageSettings.config);
  const page = site.memo.get(`page ${article.file}`, { article, entry, pageSettings }, (files) => {
    const settings = {
      config: files.value((context) => context.pageSettings.config),
      theme: files.same((context) => context.pageSettings.themes.get(name)),
      runtime: files.value((context) => context.pageSettings.bundle?.runtime),
      chatEntry: files.value((context) => context.pageSettings.chat.entry),
      shareImage: files.value((context) => shareImageProps(context.pageSettings.config, context.pageSettings.shareImages.get(article.file))),
      mathStyles: files.value((context) => context.pageSettings.mathStyles),
    };
    files.same((context) => context.article.content);
    const pageErrors = [];
    const outputs = articleOutputs(site.root, files.same((context) => context.article), files.value((context) => context.entry), settings, pageErrors);
    return { outputs, errors: pageErrors };
  });
  return page.then((result) => {
    errors.push(...result.errors);
    return result.outputs;
  });
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
      render: () => convertedImage(article, join(root, article.dir, image.source), image),
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

function convertedImage(article, file, image) {
  if (!article.conversions.has(image)) article.conversions.set(image, convertImage(file, image));
  return article.conversions.get(image);
}

function renderArticle(article, entry, { config, theme, runtime, chatEntry, shareImage, mathStyles }, errors) {
  const name = articleTheme(article, config);
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
      shareImage,
      words: content.words,
      content,
    },
    assets: {
      root,
      styles: assetLinks(root, theme.styles),
      scripts: assetLinks(root, [theme.script, ...(content.components.length === 0 || runtime === undefined ? [] : [runtime]), chatEntry]),
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
