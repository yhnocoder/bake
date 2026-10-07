import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const [scenario, ...args] = process.argv.slice(2);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png',
};
const problems = [];

async function serve(directory) {
  const dist = resolve(directory);
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
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function open(browser, url, { label, ...options }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  const requests = [];
  page.on('console', (message) => message.type() === 'error' && problems.push(`${label} console: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`${label} requestfailed: ${request.url()}`));
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('response', (response) => response.status() >= 400 && problems.push(`${label} ${response.status()}: ${response.url()}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, requests };
}

async function waitForExtending(page) {
  await page.waitForFunction(() => document.querySelector('wave-figure .wave-formula svg') && document.querySelector('wave-figure .wave-note tspan'));
}

function waveOffset(page) {
  return page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('wave-figure path.wave')).transform).e);
}

async function pages(dist, output) {
  const server = await serve(dist);
  const browser = await chromium.launch();
  mkdirSync(output, { recursive: true });
  const requestsByPage = {};
  try {
    for (const [url, name] of [['/', 'index'], ['/extending/', 'extending']]) {
      for (const width of [1440, 375]) {
        const label = `${url} ${width}px`;
        const { context, page, requests } = await open(browser, server.origin + url, { label, viewport: { width, height: 900 } });
        if (name === 'index') await page.waitForFunction(() => document.querySelector('page-list li'));
        else await waitForExtending(page);
        await page.waitForTimeout(2500);
        const path = join(output, `${name}-${width}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(`${label}: ${path}`);
        if (name === 'index') console.log(`page-list: ${JSON.stringify(await page.$$eval('page-list li a', (links) => links.map((link) => `${link.textContent} -> ${link.getAttribute('href')}`)))}`);
        else console.log(`wave offset after the animation: ${await waveOffset(page)}px`);
        requestsByPage[url] ??= requests;
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(output, 'requests.json'), JSON.stringify(requestsByPage, null, 2));
}

async function motion(dist, output) {
  const server = await serve(dist);
  const browser = await chromium.launch();
  mkdirSync(output, { recursive: true });
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const label = `/extending/ ${reducedMotion}`;
      const { context, page } = await open(browser, `${server.origin}/extending/`, { label, reducedMotion });
      await waitForExtending(page);
      const offset = await waveOffset(page);
      await page.locator('wave-figure').scrollIntoViewIfNeeded();
      const path = join(output, `extending-${reducedMotion}.png`);
      await page.screenshot({ path });
      console.log(`${label}: wave offset right after the figure is drawn is ${offset}px, ${path}`);
      if (reducedMotion === 'reduce' && offset !== -40) problems.push(`wave is not at the end position with reduced motion: ${offset}px`);
      if (reducedMotion === 'no-preference' && offset === -40) problems.push('wave is already at the end position without reduced motion');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

function requests(file) {
  const byPage = JSON.parse(readFileSync(file, 'utf8'));
  const mathjax = (paths) => paths.filter((path) => /\/assets\/chunks\/(browser|.*double-struck|.*calligraphic)\./.test(path));
  for (const [url, paths] of Object.entries(byPage)) {
    const siteJson = paths.filter((path) => path.endsWith('/site.json'));
    console.log(`${url}: ${paths.length} requests, site.json ${siteJson.length} times, MathJax files: ${JSON.stringify(mathjax(paths))}`);
    console.log(paths.map((path) => `  ${path}`).join('\n'));
  }
  if (byPage['/'].filter((path) => path.endsWith('/site.json')).length !== 1) problems.push('home page must request site.json once');
  if (byPage['/extending/'].some((path) => path.endsWith('/site.json'))) problems.push('extending page must not request site.json');
  if (mathjax(byPage['/']).length > 0) problems.push('home page must not request MathJax files');
  if (mathjax(byPage['/extending/']).length === 0) problems.push('extending page must request MathJax files');
}

async function dev(origin, blog, output) {
  const browser = await chromium.launch();
  mkdirSync(output, { recursive: true });
  try {
    const { context, page } = await open(browser, `${origin}/`, { label: 'bake dev /' });
    await page.waitForFunction(() => document.querySelector('page-list li'));
    await page.evaluate(() => (window.marker = 'kept'));
    await page.screenshot({ path: join(output, 'before.png') });
    const file = join(blog, 'content/features.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('title: bake 的全部写法', 'title: bake 的全部写法（已修改）'));
    await page.waitForFunction(() => document.querySelector('page-list').textContent.includes('bake 的全部写法（已修改）'));
    await page.screenshot({ path: join(output, 'after.png') });
    console.log(`page-list after the edit: ${JSON.stringify(await page.$$eval('page-list li a', (links) => links.map((link) => link.textContent)))}`);
    const marker = await page.evaluate(() => window.marker);
    console.log(`marker after the update: ${marker}`);
    if (marker !== 'kept') problems.push('page was reloaded');
    await context.close();
  } finally {
    await browser.close();
  }
}

async function packed(origin, output) {
  const browser = await chromium.launch();
  mkdirSync(output, { recursive: true });
  try {
    for (const [label, url] of [['bake build', `${origin.build}/`], ['bake dev', `${origin.dev}/`]]) {
      const { context, page } = await open(browser, url, { label });
      await page.waitForFunction(() => document.querySelector('runtime-check')?.textContent.includes('pages'));
      const text = await page.textContent('runtime-check');
      const path = join(output, `${label.replace(' ', '-')}.png`);
      await page.screenshot({ path });
      console.log(`${label}: runtime-check shows "${text}", ${path}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (scenario === 'pages') await pages(...args);
else if (scenario === 'motion') await motion(...args);
else if (scenario === 'requests') requests(...args);
else if (scenario === 'dev') await dev(...args);
else if (scenario === 'packed') {
  const [dist, devOrigin, output] = args;
  const server = await serve(dist);
  try {
    await packed({ build: server.origin, dev: devOrigin }, output);
  } finally {
    server.close();
  }
}
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
