import { mkdirSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from './static-server.js';
import { variants } from './screenshot-variants.js';

const [distArgument, outArgument] = process.argv.slice(2);
if (distArgument === undefined || outArgument === undefined) {
  console.error('Usage: node scripts/capture-pages.js <dist dir> <output dir>');
  process.exit(2);
}
const dist = resolve(distArgument);
const out = resolve(outArgument);

const pages = listPages(dist);
mkdirSync(out, { recursive: true });
const server = await serveStatic(dist);
const origin = `http://localhost:${new URL(server.origin).port}`;
const browser = await chromium.launch();
let count = 0;
try {
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width: variant.width, height: variant.height },
      colorScheme: variant.colorScheme,
      reducedMotion: 'reduce',
    });
    let page = await context.newPage();
    let chatShown = false;
    for (const { path, name } of pages) {
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(out, `${name}.${variant.name}.png`),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
      count += 1;
      if (!chatShown && (await hasArticleChat(page))) {
        chatShown = true;
        await page.locator('.bk-chat-launcher').click();
        await page.waitForLoadState('networkidle');
        await settleChat(page);
        await page.screenshot({ path: join(out, `${name}-chat.${variant.name}.png`), animations: 'disabled', caret: 'hide' });
        count += 1;
        await page.close();
        page = await context.newPage();
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${count} screenshots of ${pages.length} pages written to ${relative(process.cwd(), out)}`);

async function settleChat(page) {
  await page.evaluate(async () => {
    const images = [...document.querySelector('[data-bake-chat]').shadowRoot.querySelectorAll('img')];
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function hasArticleChat(page) {
  return page.evaluate(() => document.querySelector('script.bk-source') !== null && document.querySelector('[data-bake-chat]') !== null);
}

function listPages(root) {
  return htmlFiles(root)
    .map((file) => relative(root, file).split(sep).join('/'))
    .map((file) => {
      const path = `/${file.replace(/(^|\/)index\.html$/, '$1')}`;
      return { path, name: pageName(path) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

function pageName(path) {
  const name = path.replace(/\.html$/, '').replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return name === '' ? 'home' : name;
}
