import { join } from 'node:path';
import { convertImage } from '../render/images.js';
import { mathStyles } from '../render/math.js';
import { errorAt, fileStart } from '../report.js';
import { absoluteLink, encodePath, pageRoot, siteLink } from '../urls.js';
import { articleTheme, themeLocation } from './theme.js';

const NOT_FOUND_PATH = '404.html';

export async function renderPages(site, entries, { themes, bundle, chat, shareImages }, errors) {
  const pageSettings = { config: site.settings.config, themes, bundle, chat, shareImages, mathStyles: await mathStyles() };
  const pages = [];
  for (const { article, entry } of entries) pages.push({ article, entry, outputs: await pageOutputs(site, article, entry, pageSettings, errors) });
  return pages;
}

export function homeOutput({ root, config, themes, chat, listing, errors }) {
  const html = renderSitePage(root, config, themes, 'the homepage', errors, (theme) =>
    theme.renderHome({
      site: siteProps(config),
      options: config.themes[config.theme],
      home: { groupBy: config.home.groupBy, columns: config.home.columns, categories: config.categories },
      articles: listing.map(({ entry }) => homeArticle(entry)),
      assets: { root: './', styles: assetLinks('', theme.styles), scripts: assetLinks('', [theme.script, chat.entry]) },
    }),
  );
  return { path: 'index.html', render: () => html, owner: 'the homepage' };
}

export function notFoundFiles({ root, base, config, themes, listed, errors }) {
  const html = renderSitePage(root, config, themes, 'the 404 page', errors, (theme) =>
    theme.renderNotFound({
      site: siteProps(config),
      options: config.themes[config.theme],
      articles: listed.map(({ entry }) => ({ title: entry.title, url: entry.path })),
      assets: { root: base, styles: assetLinks(base, theme.styles), scripts: assetLinks(base, [theme.script]) },
    }),
  );
  return [{ path: NOT_FOUND_PATH, render: () => html, owner: 'the 404 page' }];
}

// The page is rendered again only when a value that it shows changed.
async function pageOutputs(site, article, entry, pageSettings, errors) {
  const name = articleTheme(article, pageSettings.config);
  const page = await site.memo.get(`page ${article.file}`, { article, entry, pageSettings }, (files) => {
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
  errors.push(...page.errors);
  return page.outputs;
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

function siteProps(config) {
  return { title: config.title, url: config.url, language: config.language, description: config.description, link: siteLink(config.url) };
}

function homeArticle({ title, summary, date, tags, category, draft, path, preview, image, sections }) {
  return { title, summary, date, tags, category, draft, url: path, preview, image, sections };
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
