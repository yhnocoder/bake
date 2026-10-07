import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [scenario, origin, blog, output] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];

function edit(path, replace) {
  const file = join(blog, path);
  writeFileSync(file, replace(readFileSync(file, 'utf8')));
}

async function open(url, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.on('console', (message) => message.type() === 'error' && problems.push(`${url} console: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`${url} pageerror: ${error.message}`));
  page.on('response', (response) => response.status() >= 400 && problems.push(`${url} ${response.status()}: ${response.url()}`));
  await page.goto(origin + url);
  await page.waitForFunction(() => document.querySelector('.bake-status-problems')?.textContent);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (window.marker = 'kept'));
  return { context, page };
}

async function pages() {
  for (const url of ['/features/', '/paper/', '/bento/']) {
    const { context, page } = await open(url);
    const path = join(output, `${url.slice(1, -1)}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`${url} -> ${path}, status bar: ${await page.textContent('.bake-status-problems')}`);
    await context.close();
  }
}

async function markdown() {
  const { context, page } = await open('/features/', { recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.screenshot({ path: join(output, 'before.png') });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  edit('content/features.md', (source) => source.replace('计算量很小', '（在编辑器之外修改）计算量很小'));
  await page.waitForFunction(() => document.querySelector('article').textContent.includes('（在编辑器之外修改）'));
  await page.screenshot({ path: join(output, 'after.png') });
  const state = await page.evaluate(() => ({ marker: window.marker, scrollY: window.scrollY }));
  console.log(`marker after update: ${state.marker}`);
  console.log(`scrollY before: ${scrollBefore}, after: ${state.scrollY}`);
  const video = await page.video().path();
  await context.close();
  renameSync(video, join(output, 'update.webm'));
  console.log(`video: ${join(output, 'update.webm')}`);
  if (state.marker !== 'kept' || state.scrollY !== scrollBefore) problems.push('page was reloaded or scrolled');
}

async function component() {
  const { context, page } = await open('/features/');
  await page.waitForFunction(() => customElements.get('demo-plot'));
  const attributes = () => [...document.querySelectorAll('demo-plot')].map((element) => element.getAttributeNames().map((name) => `${name}=${element.getAttribute(name)}`).join(' '));
  const before = await page.evaluate(attributes);
  await page.locator('demo-plot').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'before.png') });
  edit('components/demo-plot.js', (source) => source.replace("'#2f6fb3'", "'#c0392b'"));
  await page.waitForFunction(() => document.querySelector('demo-plot polyline[stroke="#c0392b"]'));
  await page.screenshot({ path: join(output, 'after.png') });
  const after = await page.evaluate(attributes);
  const marker = await page.evaluate(() => window.marker);
  console.log(`attributes before: ${JSON.stringify(before)}`);
  console.log(`attributes after: ${JSON.stringify(after)}`);
  console.log(`marker after update: ${marker}`);
  await context.close();
  if (JSON.stringify(before) !== JSON.stringify(after) || marker !== 'kept') problems.push('component attributes changed or page was reloaded');
}

mkdirSync(output, { recursive: true });
await { pages, markdown, component }[scenario]();
await browser.close();
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
