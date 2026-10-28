import { realpathSync } from 'node:fs';
import { chatFiles } from '../chat/site-files.js';
import { sortErrors } from '../shared/report.js';
import { sitePath } from '../shared/urls.js';
import { findArticles, publishedArticles, readArticles } from './articles.js';
import { assetOutputs, compileChat } from './assets.js';
import { compileComponents } from './components.js';
import { articleEntry, newestFirst } from './entries.js';
import { checkSiteLinks, linkArticles } from './links.js';
import { createMemo } from './memo.js';
import { homeOutput, notFoundFiles, renderPages } from './pages.js';
import { publicOutputs } from './public.js';
import { readSiteSettings } from './settings.js';
import { shareImageFiles, shareImagesOf } from './share-images.js';
import { feedFiles, robotsFiles, sitemapFiles } from './site-files.js';
import { compileThemes, startSiteTheme } from './theme.js';

// Each provider returns the files of one feature that are not pages; the share images come last, because they are drawn only for the articles without problems.
const SITE_FILES = [feedFiles, sitemapFiles, robotsFiles, notFoundFiles, chatFiles, shareImageFiles];

// url replaces the one of bake.config.js, and localUrl, the address of a site served on this computer, stands in when neither names one.
export function createSite(root, { drafts = false, base, url, localUrl, shareImages = false, prefetch = true } = {}) {
  // why: Vite reports module paths with symbolic links resolved, and they are compared with paths under the root
  const real = realpathSync(root);
  return { root: real, drafts, base, url, localUrl, shareImages, prefetch, settings: null, unsaved: new Map(), memo: createMemo(real) };
}

// changedPaths names the files and folders of the blog that changed since the last update, relative to the root; null rereads every input.
export async function updateSite(site, changedPaths = null) {
  const { root, memo } = site;
  memo.startUpdate(changedPaths);
  const found = findArticles(root);
  const settings = await readSiteSettings(site, found);
  site.settings = settings;
  if (settings.errors.length > 0) return { errors: sortErrors(settings.errors), articles: [], pages: [], siteFiles: [], assetFiles: [], publicFiles: [] };
  const { config } = settings;
  startSiteTheme(site);
  const errors = [...settings.componentErrors];
  const articles = await readArticles(site, found, errors);
  await linkArticles(site, articles, errors);
  const published = publishedArticles(site, articles, errors);
  const [themes, bundle, chat] = await Promise.all([compileThemes(site, published, errors), compileComponents(site, published, errors), compileChat(site)]);
  const assetFiles = assetOutputs(themes, bundle, chat);
  const entries = published.map((article) => ({ article, entry: articleEntry(article, config) }));
  const shareImages = shareImagesOf(site, entries, { themes, assetFiles, bundle }, errors);
  const pages = await renderPages(site, entries, { themes, bundle, chat, shareImages }, errors);
  const listing = [...pages].sort((a, b) => newestFirst(a.entry, b.entry));
  const model = { root, base: site.base ?? sitePath(config.url), config, settings, themes, chat, assetFiles, shareImages, listing, listed: listing.filter(({ entry }) => !entry.draft), errors };
  const home = homeOutput(model);
  const siteFiles = [];
  for (const provider of SITE_FILES) siteFiles.push(...(await provider(model)));
  const outputs = [...pages.flatMap((page) => page.outputs), home, ...siteFiles, ...assetFiles];
  const publicFiles = publicOutputs(root, outputs, errors);
  checkSiteLinks(published, [...outputs, ...publicFiles], errors);
  memo.sweep();
  return { errors: sortErrors(errors), articles, pages, home, siteFiles, assetFiles, publicFiles };
}
