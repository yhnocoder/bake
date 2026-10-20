import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { errorAt, fileStart } from '../report.js';
import { contentType } from '../content-types.js';
import { DIST_DIR } from './dist.js';
import { cardHtml } from './share-card.js';
import { THEME_STYLES_PATH } from './theme.js';
import { encodePath } from '../urls.js';

export const SHARE_IMAGE_DIR = 'og';
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
export const INSTALL_CHROMIUM = 'npx playwright install chromium';

const ORIGIN = 'http://share-image.invalid';
const ARTICLE_DIR = 'article';
const CARD_FILE = 'card.html';
const PAGE_COUNT = 4;
const DRAW_TIMEOUT = 10000;
const HASH_LENGTH = 12;
const CACHE_DIR = 'bake-share-images';
const DRAWING_CODE = ['share-card.js', 'share-images.js'].map((file) => readFileSync(join(import.meta.dirname, file)));
const PLAYWRIGHT_VERSION = createRequire(import.meta.url)('playwright/package.json').version;
const PNG = { extension: '.png', type: 'image/png' };
const PUBLISHED_COVERS = {
  png: PNG,
  jpeg: { extension: '.jpg', type: 'image/jpeg' },
  gif: { extension: '.gif', type: 'image/gif' },
  webp: { extension: '.webp', type: 'image/webp' },
};

export function shareImageOf(root, { article, entry }, config, assets) {
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

export async function shareImageOutputs(root, images, assets, errors) {
  const outputs = [];
  const pending = [];
  for (const image of images) {
    const published = join(root, DIST_DIR, image.path);
    if (image.from !== undefined) outputs.push({ path: image.path, from: image.from, owner: image.owner });
    else if (image.render !== undefined) outputs.push({ path: image.path, render: image.render, owner: image.owner });
    else if (existsSync(published)) outputs.push({ path: image.path, from: published, owner: image.owner });
    else {
      const png = cachedCard(image.key);
      if (png === null) pending.push(image);
      else outputs.push({ path: image.path, render: () => png, owner: image.owner });
    }
  }
  if (pending.length === 0) return outputs;
  return [...outputs, ...(await drawCards(pending, assets, errors))];
}

async function drawCards(images, assets, errors) {
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
    await context.route('**/*', (route) => answer(route, images, assets));
    const queue = images.entries();
    const outputs = [];
    const draw = async () => {
      let page = await context.newPage();
      for (const [index, image] of queue) {
        const result = await drawCard(page, index, image);
        if (result.problem === undefined) {
          storeCard(image.key, result.png);
          outputs.push({ path: image.path, render: () => result.png, owner: image.owner });
          continue;
        }
        errors.push(errorAt(image.owner, image.previewPosition ?? fileStart, `the preview cannot be drawn on the share image: ${result.problem}`));
        if (result.stuck) {
          await page.close();
          page = await context.newPage();
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
  if (file === CARD_FILE) return cardHtml(image.card, `/${THEME_STYLES_PATH}`);
  const prefix = `${ARTICLE_DIR}/`;
  if (!file.startsWith(prefix) || !image.folder.files.includes(file.slice(prefix.length))) return null;
  return readFileSync(join(image.folder.path, file.slice(prefix.length)));
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
