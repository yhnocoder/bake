import { mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const [dist, output] = process.argv.slice(2).map((path) => resolve(path));
const widths = [1440, 375];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.avif': 'image/avif',
};

const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = resolve(join(dist, path.endsWith('/') ? `${path}index.html` : path));
  const body = file.startsWith(dist + sep) ? await readFile(file).catch(() => undefined) : undefined;
  if (body === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const { pages } = JSON.parse(readFileSync(join(dist, 'site.json'), 'utf8'));
const browser = await chromium.launch();
const problems = [];
mkdirSync(output, { recursive: true });

try {
  for (const { url } of pages) {
    const name = url === '/' ? 'index' : url.slice(1, -1).replaceAll('/', '-');
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const label = `${url} ${width}px`;
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`${label} console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
      page.on('requestfailed', (request) => problems.push(`${label} requestfailed: ${request.url()}`));
      let requests = 0;
      page.on('response', (response) => {
        requests++;
        if (response.status() >= 400) problems.push(`${label} ${response.status()}: ${response.url()}`);
      });
      await page.goto(origin + url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => {}))));
      const path = join(output, `${name}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`${label}: ${requests} responses, ${path}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
