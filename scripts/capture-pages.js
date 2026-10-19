import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { variants } from './screenshot-variants.js';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const [distArgument, outArgument] = process.argv.slice(2);
if (distArgument === undefined || outArgument === undefined) {
  console.error('Usage: node scripts/capture-pages.js <dist dir> <output dir>');
  process.exit(2);
}
const dist = resolve(distArgument);
const out = resolve(outArgument);

const pages = listPages(dist);
mkdirSync(out, { recursive: true });
const server = await serve(dist);
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
let count = 0;
try {
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width: variant.width, height: variant.height },
      colorScheme: variant.colorScheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
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
        await page.locator('.bk-chat-panel.is-open .bk-chat-view').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(out, `${name}-chat.${variant.name}.png`), animations: 'disabled', caret: 'hide' });
        count += 1;
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${count} screenshots of ${pages.length} pages written to ${relative(process.cwd(), out)}`);

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

function serve(root) {
  const server = createServer((request, response) => {
    const file = resolveFile(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

function resolveFile(root, pathname) {
  const path = join(root, pathname);
  if (path !== root && !path.startsWith(root + sep)) return undefined;
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}
