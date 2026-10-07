import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const [dist, output] = process.argv.slice(2).map((path) => resolve(path));
const widths = [1440, 900];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
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
const browser = await chromium.launch();
const problems = [];
mkdirSync(output, { recursive: true });

function structure() {
  const notes = [...document.querySelectorAll('article .sidenote')];
  const wellFormed = notes.filter((note) => {
    const [first, second, ...rest] = note.children;
    const body = note.classList.contains('unnumbered') ? first : second;
    const number = note.classList.contains('unnumbered') ? null : first;
    const extra = note.classList.contains('unnumbered') ? [second, ...rest].filter(Boolean) : rest;
    return body?.matches('div.sidenote-body') && (number === null || number.matches('span.sidenote-number')) && extra.length === 0;
  });
  const container = document.getElementById('math-defs');
  const references = [...document.querySelectorAll('article use')].map((use) => use.getAttribute('href').slice(1));
  return {
    notes: notes.length,
    wellFormed: wellFormed.length,
    containerFirst: document.body.firstElementChild === container,
    glyphs: container?.querySelectorAll('defs > path').length ?? 0,
    missingGlyphs: references.filter((id) => !document.getElementById(id)).length,
  };
}

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const label = `/features/ ${width}px`;
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`${label} console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`${label} ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${origin}/features/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(structure);
    console.log(`${label}: ${JSON.stringify(result)}`);
    if (result.notes === 0 || result.wellFormed !== result.notes) problems.push(`${label} sidenote structure`);
    if (!result.containerFirst || result.glyphs === 0 || result.missingGlyphs > 0) problems.push(`${label} math-defs`);
    const path = join(output, `features-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`${label}: ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
