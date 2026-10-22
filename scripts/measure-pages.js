import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from '../src/dev/static-server.js';

export const screens = [
  { width: 1440, height: 900, mobile: false },
  { width: 375, height: 812, mobile: true },
];

export const scrollStep = { pixels: 100, intervalMs: 100 };

export const metrics = [
  { key: 'firstContentfulPaintMs', title: 'FCP', unit: 'ms' },
  { key: 'largestContentfulPaintMs', title: 'LCP', unit: 'ms' },
  { key: 'firstScreenComponents', title: 'first screen components', unit: 'count' },
  { key: 'componentsReadyMs', title: 'components ready', unit: 'ms' },
  { key: 'componentsBlankOnScroll', title: 'blank on scroll', unit: 'count' },
];

const usage = 'Usage: node scripts/measure-pages.js <dist folder> [--out report.json]';

if (import.meta.main) await main(process.argv.slice(2));

async function main(args) {
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? undefined : args[outIndex + 1];
  const positional = outIndex === -1 ? args : args.filter((_, index) => index !== outIndex && index !== outIndex + 1);
  if (positional.length !== 1 || (outIndex !== -1 && out === undefined)) {
    console.error(usage);
    process.exit(2);
  }
  const report = await measureSite(resolve(positional[0]));
  console.log(formatTable(report));
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}

export async function measureSite(dist) {
  const pages = listPages(dist);
  const server = await serveStatic(dist, { gzip: true, localhost: true });
  const { origin } = server;
  const browser = await chromium.launch();
  const measurements = [];
  try {
    for (const path of pages) {
      for (const screen of screens) {
        measurements.push({ page: path, width: screen.width, height: screen.height, ...(await measurePage(browser, origin, path, screen)) });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return { compression: 'gzip', scrollStep, metrics: metrics.map((metric) => metric.key), measurements };
}

export function listPages(dist) {
  return htmlFiles(dist)
    .map((file) => relative(dist, file).split(sep).join('/'))
    .filter((file) => file !== '404.html')
    .map((file) => `/${file.replace(/(^|\/)index\.html$/, '$1')}`)
    .sort();
}

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

async function measurePage(browser, origin, path, screen) {
  const context = await browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    isMobile: screen.mobile,
    hasTouch: screen.mobile,
  });
  try {
    await context.addInitScript(observePage);
    const page = await context.newPage();
    await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(firstScreenSettled, undefined, { timeout: 60000, polling: 100 });
    const firstScreen = await page.evaluate(readFirstScreen);
    const blank = new Set();
    for (;;) {
      const step = await page.evaluate(scrollOneStep, scrollStep.pixels);
      for (const index of step.blank) blank.add(index);
      if (step.atEnd) break;
      await page.waitForTimeout(scrollStep.intervalMs);
    }
    return { ...firstScreen, componentsBlankOnScroll: blank.size };
  } finally {
    await context.close();
  }
}

function observePage() {
  const perf = { firstContentfulPaint: null, largestContentfulPaint: null, settled: new Map(), firstScreen: null };
  window.__bakePerf = perf;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') perf.firstContentfulPaint = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    perf.largestContentfulPaint = list.getEntries().at(-1).startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new MutationObserver((records) => {
    for (const record of records) {
      const state = record.target.getAttribute('data-state');
      if ((state === 'ready' || state === 'failed') && !perf.settled.has(record.target)) perf.settled.set(record.target, performance.now());
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
}

function firstScreenSettled() {
  const perf = window.__bakePerf;
  if (perf.firstScreen === null) {
    perf.firstScreen = [...document.querySelectorAll('figure.component')].filter((frame) => {
      // why: a frame inside a closed fold keeps a layout box, but the reader cannot see it and it starts only when the fold opens
      if (!frame.checkVisibility()) return false;
      const box = frame.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight;
    });
  }
  return perf.firstContentfulPaint !== null && perf.firstScreen.every((frame) => perf.settled.has(frame));
}

function readFirstScreen() {
  const perf = window.__bakePerf;
  const times = perf.firstScreen.map((frame) => perf.settled.get(frame));
  return {
    firstContentfulPaintMs: Math.round(perf.firstContentfulPaint),
    largestContentfulPaintMs: perf.largestContentfulPaint === null ? null : Math.round(perf.largestContentfulPaint),
    firstScreenComponents: times.length,
    componentsReadyMs: times.length === 0 ? null : Math.round(Math.max(...times)),
  };
}

async function scrollOneStep(pixels) {
  window.scrollBy({ top: pixels, behavior: 'instant' });
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const frames = [...document.querySelectorAll('figure.component')];
  const blank = frames.flatMap((frame, index) => {
    const box = frame.getBoundingClientRect();
    const visible = frame.checkVisibility() && box.bottom > 0 && box.top < innerHeight;
    return visible && frame.getAttribute('data-state') !== 'ready' && frame.getAttribute('data-state') !== 'failed' ? [index] : [];
  });
  return { blank, atEnd: scrollY + innerHeight >= document.documentElement.scrollHeight - 1 };
}

export function formatValue(value, unit) {
  if (value === null || value === undefined) return '-';
  if (unit === 'ms') return `${value} ms`;
  return String(value);
}

export function formatTable(report) {
  const header = ['page', 'width', ...metrics.map((metric) => metric.title)];
  const rows = report.measurements.map((measurement) => [
    measurement.page,
    String(measurement.width),
    ...metrics.map((metric) => formatValue(measurement[metric.key], metric.unit)),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => cells.map((cell, column) => (column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [line(header), ...rows.map(line)].join('\n');
}
