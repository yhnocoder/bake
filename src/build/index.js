import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMessage } from '../format/index.js';
import { brokenLinks } from '../site/links.js';
import { loadSite, renderArticle, renderDocumentFor, renderOptions, siteData } from '../site/index.js';
import { bundle } from './bundle.js';
import { rewriteHtml } from './html.js';
import { isLocalImage, processImage } from './images.js';
import { pageSections } from './sections.js';

const bakeRoot = fileURLToPath(new URL('../../', import.meta.url));
const renderSources = ['src/render', 'src/format', 'src/blocks'];
const cacheDirectory = 'node_modules/.cache/bake';

async function renderCodeHash() {
  const hash = createHash('sha256');
  for (const directory of renderSources) {
    const entries = await readdir(join(bakeRoot, directory), { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
    for (const file of files.sort()) hash.update(relative(bakeRoot, file)).update(await readFile(file));
  }
  hash.update(await readFile(join(bakeRoot, 'package-lock.json')).catch(() => ''));
  return hash.digest('hex');
}

const renderCode = await renderCodeHash();

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

async function cachedRender(site, path, source, used) {
  const key = createHash('sha256').update(JSON.stringify([source, renderOptions(site, path), renderCode])).digest('hex');
  const file = join(site.root, cacheDirectory, `${key}.json`);
  used.add(`${key}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const rendered = await renderArticle(site, path, source);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(rendered));
  } catch {}
  return rendered;
}

async function pruneCache(root, used) {
  const directory = join(root, cacheDirectory);
  const names = await readdir(directory).catch(() => []);
  for (const name of names) {
    if (!used.has(name)) await rm(join(directory, name), { force: true }).catch(() => {});
  }
}

function checkLinks(pages, messages) {
  const targets = new Map(pages.map(({ entry, rendered }) => [entry.url, rendered.ids]));
  for (const { entry, rendered } of pages) messages.push(...brokenLinks(entry, rendered.links, targets));
}

async function findImages(root, pages, messages) {
  const images = [];
  for (const { entry, rendered } of pages) {
    for (const { src, line, column } of rendered.images) {
      if (!isLocalImage(src)) continue;
      const file = resolve(root, dirname(entry.path), decode(src.split(/[?#]/)[0]));
      const found = await stat(file).then((info) => info.isFile(), () => false);
      if (found) images.push({ entry, src, file });
      else messages.push({ path: entry.path, line, column, text: `Image not found ${src}` });
    }
  }
  return images;
}

async function writeImages(site, images, outDir) {
  const processed = new Map();
  const pageImages = new Map();
  for (const { entry, src, file } of images) {
    if (!processed.has(file)) processed.set(file, await processImage(file));
    const image = processed.get(file);
    const directory = entry.url === '/' ? 'assets' : `assets${entry.url.slice(0, -1)}`;
    const path = `${directory}/${basename(file, extname(file))}.${image.hash}${image.extension}`;
    await mkdir(join(outDir, directory), { recursive: true });
    await writeFile(join(outDir, path), image.data);
    if (!pageImages.has(entry)) pageImages.set(entry, new Map());
    pageImages.get(entry).set(src, { url: site.config.base + path, width: image.width, height: image.height });
  }
  return pageImages;
}

async function writeOutput(site, pages, images, outDir) {
  const components = [...new Set(pages.flatMap(({ rendered }) => rendered.components))];
  const themeOf = ({ rendered }) => rendered.page.theme ?? site.config.theme;
  const themes = [...new Set(pages.map(themeOf))];
  const bundled = await bundle(site, { outDir, components, themes });
  if (bundled.errors) return bundled.errors;
  const pageImages = await writeImages(site, images, outDir);
  for (const page of pages) {
    const { entry, rendered } = page;
    const html = rewriteHtml(rendered.html, { base: site.config.base, images: pageImages.get(entry) ?? new Map() });
    const assets = {
      styles: [bundled.files.bake, bundled.files[`themes/${themeOf(page)}`]],
      scripts: [bundled.client, ...rendered.components.map((name) => bundled.files[`components/${name}`])],
    };
    const directory = join(outDir, entry.url);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), renderDocumentFor(site, entry.path, { ...rendered, html }, { assets }));
    await writeFile(join(directory, 'sections.json'), JSON.stringify(pageSections({ title: rendered.page.title, html })));
  }
  await writeFile(join(outDir, 'site.json'), JSON.stringify(siteData(site)));
  return [];
}

export async function build(root, { out }) {
  const site = await loadSite(root);
  const messages = [...site.messages];
  const pages = [];
  const usedCache = new Set();
  for (const entry of site.pages.filter((page) => page.frontmatter.draft !== true)) {
    const rendered = await cachedRender(site, entry.path, await readFile(join(root, entry.path), 'utf8'), usedCache);
    messages.push(...rendered.messages);
    pages.push({ entry, rendered });
  }
  checkLinks(pages, messages);
  const images = await findImages(root, pages, messages);
  if (messages.length > 0) return { errors: messages.map(formatMessage) };
  const outDir = resolve(root, out);
  await mkdir(dirname(outDir), { recursive: true });
  const temporary = await mkdtemp(`${outDir}.tmp-`);
  try {
    const errors = await writeOutput(site, pages, images, temporary);
    if (errors.length > 0) {
      await rm(temporary, { recursive: true, force: true });
      return { errors };
    }
    await rm(outDir, { recursive: true, force: true });
    await rename(temporary, outDir);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  await pruneCache(root, usedCache);
  return { errors: [], pageCount: pages.length };
}
