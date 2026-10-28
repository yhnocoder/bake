import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { errorAt, fileStart } from '../shared/report.js';
import { contentType } from '../shared/content-types.js';
import { DIST_DIR } from './dist.js';
import { componentPageHtml } from './component-pages.js';
import { cardHtml } from './share-card.js';
import { THEME_STYLES_PATH } from './theme.js';
import { encodePath } from '../shared/urls.js';

export const SHARE_IMAGE_DIR = 'og';
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
export const INSTALL_CHROMIUM = 'npx playwright install chromium';

const ORIGIN = 'http://share-image.invalid';
const ARTICLE_DIR = 'article';
const CARD_FILE = 'card.html';
// why: a share image is about twice as wide as a column of text, so the component is drawn at the width of a column and at twice the resolution
const COMPONENT_SCALE = 2;
const COMPONENT_TIMEOUT = 10000;
// why: a tall component scaled down to the height of the image would be too small to read, so the image shows its top part and fades out the rest
const COMPONENT_MAX_HEIGHT = 420;
const COMPONENT_FADE = 96;
const PAGE_COUNT = 4;
const DRAW_TIMEOUT = 10000;
const HASH_LENGTH = 12;
const CACHE_DIR = 'bake-share-images';
const DRAWING_CODE = ['share-card.js', 'share-images.js', 'component-pages.js'].map((file) => readFileSync(join(import.meta.dirname, file)));
const PLAYWRIGHT_VERSION = createRequire(import.meta.url)('playwright/package.json').version;
const PNG = { extension: '.png', type: 'image/png' };
const PUBLISHED_COVERS = {
  png: PNG,
  jpeg: { extension: '.jpg', type: 'image/jpeg' },
  gif: { extension: '.gif', type: 'image/gif' },
  webp: { extension: '.webp', type: 'image/webp' },
};

// The share images are known before the pages, which link to them, and are drawn after them, when the problems of every article are known.
export function shareImagesOf(site, entries, { themes, assetFiles, bundle }, errors) {
  const { config } = site.settings;
  if (!site.shareImages || themes.get(config.theme) === null) return new Map();
  const failed = new Set(errors.map((error) => error.file));
  const listed = entries.filter(({ article, entry }) => !entry.draft && article.fields.page === undefined && !failed.has(article.file));
  const sources = assetSources(assetFiles);
  const images = new Map();
  for (const page of listed) {
    images.set(page.article.file, shareImageOf(site.root, page, config, sources));
    if (bundle === null) continue;
    for (const component of page.article.content.componentPages) images.set(componentImageKey(page.article, component), componentImageOf(site.root, page, component, { config, runtime: bundle.runtime }, sources));
  }
  return images;
}

export function componentImageKey(article, component) {
  return `${article.file} ${component.name}`;
}

export function shareImageFiles({ root, shareImages, assetFiles, errors }) {
  const failed = new Set(errors.map((error) => error.file));
  return shareImageOutputs(root, [...shareImages.values()].filter((image) => !failed.has(image.owner)), assetSources(assetFiles), errors);
}

function assetSources(assetFiles) {
  return new Map(assetFiles.map((file) => [file.path, file.render()]));
}

function shareImageOf(root, { article, entry }, config, assets) {
  const { fields } = article;
  const name = `${SHARE_IMAGE_DIR}${entry.url.slice(0, -1)}`;
  if (fields.cover !== undefined) {
    const from = join(root, article.dir, fields.cover);
    const { format, width, height } = article.cover;
    const published = PUBLISHED_COVERS[format];
    const image = { path: `${name}-${hashOf(readFileSync(from))}${(published ?? PNG).extension}`, owner: article.file, type: (published ?? PNG).type, width, height };
    return published === undefined ? { ...image, render: () => sharp(from).png().toBuffer() } : { ...image, from };
  }
  const card = {
    language: config.language,
    site: config.title,
    category: entry.category?.name,
    color: entry.category?.color,
    title: entry.title,
    summary: entry.summary,
    preview: fields.preview,
  };
  const inputs = [...DRAWING_CODE, PLAYWRIGHT_VERSION, JSON.stringify(card), assets.get(THEME_STYLES_PATH)];
  if (fields.preview !== undefined) {
    for (const file of article.files) inputs.push(file, readFileSync(join(root, article.dir, file)));
  }
  const key = digest(inputs);
  return {
    path: `${name}-${key}.png`,
    key,
    owner: article.file,
    type: PNG.type,
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
    card,
    folder: { path: join(root, article.dir), files: article.files },
    previewPosition: article.positions.preview,
  };
}

// The share image of the page of a component shows the component as its page shows it in the light scheme.
function componentImageOf(root, { article, entry }, component, { config, runtime }, assets) {
  const page = `${entry.path}components/${component.name}/`;
  const html = componentPageHtml(component, entry, { config, runtime, path: page });
  const inputs = [...DRAWING_CODE, PLAYWRIGHT_VERSION, html, assets.get(THEME_STYLES_PATH), assets.get(runtime)];
  for (const file of component.files) inputs.push(file, readFileSync(join(root, article.dir, file)));
  const key = digest(inputs);
  return {
    path: `${SHARE_IMAGE_DIR}/${page.slice(0, -1)}-${key}.png`,
    key,
    owner: article.file,
    type: PNG.type,
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
    component: { page, html, article: entry.path },
    folder: { path: join(root, article.dir), files: article.files },
  };
}

async function shareImageOutputs(root, images, assets, errors) {
  const outputs = [];
  const pending = [];
  for (const image of images) {
    const published = join(root, DIST_DIR, image.path);
    if (image.from !== undefined) outputs.push({ path: image.path, from: image.from, owner: image.owner });
    else if (image.render !== undefined) outputs.push({ path: image.path, render: image.render, owner: image.owner });
    // why: the image of a component that could not be drawn holds the share image of its article, so only the cache, which holds drawn images, is reused
    else if (image.component === undefined && existsSync(published)) outputs.push({ path: image.path, from: published, owner: image.owner });
    else {
      const png = cachedCard(image.key);
      if (png === null) pending.push(image);
      else outputs.push({ path: image.path, render: () => png, owner: image.owner });
    }
  }
  if (pending.length === 0) return outputs;
  const undrawn = [];
  outputs.push(...(await drawCards(pending, assets, undrawn, errors)));
  for (const image of undrawn) {
    const article = outputs.find((output) => output.path === images.find((other) => other.owner === image.owner && other.component === undefined).path);
    if (article === undefined) continue;
    const source = async () => (article.from === undefined ? article.render() : readFileSync(article.from));
    outputs.push({ path: image.path, render: async () => sharp(await source()).resize(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, { fit: 'contain', background: '#ffffff' }).png().toBuffer(), owner: image.owner });
  }
  return outputs;
}

// A component that fails or does not start in time is listed in undrawn, and its page takes the share image of its article.
async function drawCards(images, assets, undrawn, errors) {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
    errors.push(errorAt(images[0].owner, fileStart, `the share image needs Chromium, which cannot be launched (${reason}); install it with ${INSTALL_CHROMIUM}`));
    return [];
  }
  try {
    const context = await browser.newContext({
      viewport: { width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const componentContext = await browser.newContext({
      viewport: { width: SHARE_IMAGE_WIDTH / COMPONENT_SCALE, height: SHARE_IMAGE_HEIGHT / COMPONENT_SCALE },
      deviceScaleFactor: COMPONENT_SCALE,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    for (const opened of [context, componentContext]) await opened.route('**/*', (route) => answer(route, images, assets));
    const queue = images.entries();
    const outputs = [];
    const draw = async () => {
      const pages = { card: await context.newPage(), component: await componentContext.newPage() };
      for (const [index, image] of queue) {
        const kind = image.component === undefined ? 'card' : 'component';
        const result = kind === 'card' ? await drawCard(pages.card, index, image) : await drawComponent(pages.component, index, image);
        if (result.problem === undefined) {
          storeCard(image.key, result.png);
          outputs.push({ path: image.path, render: () => result.png, owner: image.owner });
          continue;
        }
        if (kind === 'card') errors.push(errorAt(image.owner, image.previewPosition ?? fileStart, `the preview cannot be drawn on the share image: ${result.problem}`));
        else undrawn.push(image);
        if (result.stuck) {
          await pages[kind].close();
          pages[kind] = await (kind === 'card' ? context : componentContext).newPage();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_COUNT, images.length) }, draw));
    return outputs;
  } finally {
    await browser.close();
  }
}

async function drawCard(page, index, image) {
  await page.goto(`${ORIGIN}/${index}/${CARD_FILE}`);
  const preview = image.card.preview === undefined ? null : `${ORIGIN}/${index}/${ARTICLE_DIR}/${encodePath(image.card.preview)}`;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ problem: `it did not finish within ${DRAW_TIMEOUT / 1000} seconds`, stuck: true }), DRAW_TIMEOUT);
  });
  const drawn = page.evaluate(drawFirstFrame, preview).then(
    (problem) => (problem === null ? {} : { problem }),
    (error) => ({ problem: error.message, stuck: true }),
  );
  const result = await Promise.race([drawn, timeout]);
  clearTimeout(timer);
  if (result.problem !== undefined) return result;
  return { png: await page.screenshot({ type: 'png' }) };
}

async function drawComponent(page, index, image) {
  try {
    await page.goto(`${ORIGIN}/${index}/${image.component.page}index.html`);
    await page.waitForFunction(componentStarted, null, { timeout: COMPONENT_TIMEOUT, polling: 100 });
    if ((await page.evaluate(() => document.querySelector('figure.component').dataset.state)) !== 'ready') return { problem: 'it did not start' };
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const { clip, background } = await page.evaluate(fadeTallComponent, { maxHeight: COMPONENT_MAX_HEIGHT, fade: COMPONENT_FADE });
    const shot = await page.screenshot({ type: 'png', clip, fullPage: true });
    const png = await sharp(shot).resize(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, { fit: 'contain', background }).png().toBuffer();
    return { png };
  } catch (error) {
    return { problem: String(error instanceof Error ? error.message : error), stuck: true };
  }
}

function fadeTallComponent({ maxHeight, fade }) {
  const figure = document.querySelector('figure.component');
  const background = getComputedStyle(document.body).backgroundColor;
  const box = figure.getBoundingClientRect();
  const height = Math.min(box.height, maxHeight);
  if (box.height > maxHeight) {
    const mask = document.createElement('div');
    mask.style.cssText = `position: absolute; left: ${box.left + scrollX}px; top: ${box.top + scrollY + height - fade}px; width: ${box.width}px; height: ${fade}px; background: linear-gradient(transparent, ${background}); pointer-events: none`;
    document.body.append(mask);
  }
  return { clip: { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height }, background };
}

// why: a component typesets its formulas after it starts, and the screenshot waits for them
function componentStarted() {
  const figure = document.querySelector('figure.component');
  if (figure.dataset.state === 'failed') return true;
  if (figure.dataset.state !== 'ready') return false;
  const formulas = [...figure.querySelectorAll('.bk-kit-tex, .bk-kit-svg-tex, .bk-kit-svg-math-text')];
  return formulas.every((formula) => formula.querySelector('svg') !== null || (formula.matches('.bk-kit-svg-math-text') && formula.childElementCount > 0));
}

async function drawFirstFrame(preview) {
  try {
    if (preview !== null) {
      const module = await import(preview);
      const result = module.default(document.querySelector('.preview'));
      if (typeof result?.start !== 'function' || typeof result?.stop !== 'function') {
        throw new TypeError('the default export must return an object with start and stop functions');
      }
    }
    document.body.getBoundingClientRect();
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function answer(route, images, assets) {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort();
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return route.fulfill({ status: 404 });
  }
  const body = requestedFile(path, images, assets);
  if (body === null) return route.fulfill({ status: 404 });
  return route.fulfill({ status: 200, contentType: contentType(path), body });
}

function requestedFile(path, images, assets) {
  if (assets.has(path)) return assets.get(path);
  const [index, ...rest] = path.split('/');
  const image = images[Number(index)];
  if (image === undefined || String(Number(index)) !== index) return null;
  const file = rest.join('/');
  if (image.component !== undefined) return componentFile(file, image, assets);
  if (file === CARD_FILE) return cardHtml(image.card, `/${THEME_STYLES_PATH}`);
  const prefix = `${ARTICLE_DIR}/`;
  if (!file.startsWith(prefix) || !image.folder.files.includes(file.slice(prefix.length))) return null;
  return readFileSync(join(image.folder.path, file.slice(prefix.length)));
}

// The page of a component is served at its address in the site, so that its relative addresses reach the assets and the files of the article.
function componentFile(file, image, assets) {
  const { page, html, article } = image.component;
  if (file === `${page}index.html`) return html;
  if (assets.has(file)) return assets.get(file);
  const name = file.startsWith(article) ? file.slice(article.length) : null;
  return name !== null && image.folder.files.includes(name) ? readFileSync(join(image.folder.path, name)) : null;
}

function cachedCard(key) {
  try {
    return readFileSync(join(tmpdir(), CACHE_DIR, `${key}.png`));
  } catch {
    return null;
  }
}

function storeCard(key, png) {
  const dir = join(tmpdir(), CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  const staging = join(dir, `${key}.${randomUUID()}`);
  writeFileSync(staging, png);
  renameSync(staging, join(dir, `${key}.png`));
}

function digest(inputs) {
  const hash = createHash('sha256');
  for (const input of inputs) {
    const data = typeof input === 'string' ? Buffer.from(input) : input;
    hash.update(`${data.length}:`);
    hash.update(data);
  }
  return hash.digest('hex').slice(0, HASH_LENGTH);
}

function hashOf(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, HASH_LENGTH);
}
