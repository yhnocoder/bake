import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { formatMessage } from '../../src/format/index.js';
import { serveExample } from '../example-server.js';

const [scenario, output] = process.argv.slice(2);
const widths = [1440, 1100, 600, 375];
const server = await serveExample();
const browser = await chromium.launch();
const problems = server.messages.map(formatMessage);

async function open(name, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${name} ${width}px console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${name} ${width}px pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`${name} ${width}px requestfailed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${name} ${width}px ${response.status()}: ${response.url()}`);
  });
  await page.goto(server.origin + server.pages[name], { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page;
}

async function screenshots() {
  mkdirSync(output, { recursive: true });
  for (const name of Object.keys(server.pages)) {
    for (const width of widths) {
      const page = await open(name, width);
      const path = join(output, `${name}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(path);
      await page.close();
    }
  }
}

async function hover() {
  mkdirSync(output, { recursive: true });
  const page = await open('features', 1440);
  const numbers = await page.$$eval('aside.sidenote:not(.unnumbered)', (notes) => notes.map((note) => note.id.slice(3)));
  for (const number of numbers) {
    await page.hover(`#sn-${number}`);
    const state = await page.evaluate((number) => {
      const note = document.getElementById(`sn-${number}`);
      const ref = document.getElementById(`sn-ref-${number}`);
      const [range] = CSS.highlights.get('sidenote') ?? [];
      const box = (rect) => ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      return {
        text: range?.toString() ?? '',
        note: box(note.getBoundingClientRect()),
        ref: box(ref.getBoundingClientRect()),
        range: range ? box(range.getBoundingClientRect()) : null,
        scrollY: window.scrollY,
      };
    }, number);
    const top = Math.min(state.note.top, state.range?.top ?? state.note.top) + state.scrollY - 24;
    const bottom = Math.max(state.note.bottom, state.range?.bottom ?? state.note.bottom) + state.scrollY + 24;
    const path = join(output, `features-hover-sn-${number}.png`);
    await page.screenshot({ path, fullPage: true, clip: { x: 0, y: top, width: 1440, height: bottom - top } });
    console.log(`${path}`);
    console.log(`  highlight: ${state.text}`);
    console.log(`  note top ${Math.round(state.note.top - state.ref.top)}px from reference mark top`);
    if (state.text === '') problems.push(`sn-${number}: no highlight`);
  }
  await page.close();
}

async function overflow() {
  for (const name of Object.keys(server.pages)) {
    const page = await open(name, 375);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`${name}: scrollWidth ${scrollWidth}, clientWidth ${clientWidth}`);
    if (scrollWidth > clientWidth) problems.push(`${name} scrolls horizontally at 375px`);
    await page.close();
  }
}

async function consoleErrors() {
  for (const name of Object.keys(server.pages)) {
    for (const width of widths) await (await open(name, width)).close();
  }
  console.log(`${Object.keys(server.pages).length * widths.length} page loads`);
}

try {
  await { screenshots, hover, overflow, console: consoleErrors }[scenario]();
} finally {
  await browser.close();
  server.close();
}
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
