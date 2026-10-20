import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from './static-server.js';

export const cpuThrottlingRate = 4;

export const network = {
  name: 'Fast 4G of Chrome DevTools',
  downloadBytesPerSecond: (9 * 1000 * 1000 * 0.9) / 8,
  uploadBytesPerSecond: (1.5 * 1000 * 1000 * 0.9) / 8,
  latencyMs: 60 * 2.75,
};

export const screens = [
  { width: 1440, height: 900, mobile: false },
  { width: 375, height: 812, mobile: true },
];

export const scrollStep = { pixels: 100, intervalMs: 100 };

export const metrics = [
  { key: 'transferBytes', title: 'all', unit: 'bytes' },
  { key: 'firstScreenTransferBytes', title: 'first screen', unit: 'bytes' },
  { key: 'htmlBytes', title: 'html', unit: 'bytes' },
  { key: 'cssBytes', title: 'css', unit: 'bytes' },
  { key: 'themeScriptBytes', title: 'theme js', unit: 'bytes' },
  { key: 'componentScriptBytes', title: 'component js', unit: 'bytes' },
  { key: 'chatScriptBytes', title: 'chat js', unit: 'bytes' },
  { key: 'previewScriptBytes', title: 'preview js', unit: 'bytes' },
  { key: 'otherScriptBytes', title: 'other js', unit: 'bytes' },
  { key: 'fontBytes', title: 'fonts', unit: 'bytes' },
  { key: 'fontFiles', title: 'font files', unit: 'count' },
  { key: 'imageBytes', title: 'images', unit: 'bytes' },
  { key: 'firstContentfulPaintMs', title: 'FCP', unit: 'ms' },
  { key: 'largestContentfulPaintMs', title: 'LCP', unit: 'ms' },
  { key: 'firstScreenComponents', title: 'first screen components', unit: 'count' },
  { key: 'componentsReadyMs', title: 'components ready', unit: 'ms' },
  { key: 'componentsBlankOnScroll', title: 'blank on scroll', unit: 'count' },
  { key: 'failedComponents', title: 'failed components', unit: 'count' },
  { key: 'failedRequests', title: 'failed requests', unit: 'count' },
];

const usage = 'Usage: node scripts/measure-pages.js <dist folder> [--out report.json]';

if (import.meta.main) await main(process.argv.slice(2));

async function main(args) {
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? undefined : args[outIndex + 1];
  const positional = args.filter((_, index) => index !== outIndex && index !== outIndex + 1);
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
  return { cpuThrottlingRate, network, compression: 'gzip', scrollStep, measurements };
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
    const cdp = await context.newCDPSession(page);
    const requests = recordRequests(cdp);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: network.latencyMs,
      downloadThroughput: network.downloadBytesPerSecond,
      uploadThroughput: network.uploadBytesPerSecond,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate });
    await page.goto(origin + path, { waitUntil: 'load', timeout: 120000 });
    await requests.idle();
    await page.waitForFunction(firstScreenSettled, undefined, { timeout: 60000, polling: 100 });
    const firstScreen = await page.evaluate(readFirstScreen);
    const firstScreenTransferBytes = sum(requests.finished(), () => true);
    const blank = new Set();
    for (;;) {
      const step = await page.evaluate(scrollOneStep, scrollStep.pixels);
      for (const index of step.blank) blank.add(index);
      if (step.atEnd) break;
      await page.waitForTimeout(scrollStep.intervalMs);
    }
    await requests.idle();
    await page.waitForFunction(allComponentsSettled, undefined, { timeout: 60000, polling: 100 });
    const failedComponents = await page.evaluate(() => document.querySelectorAll('figure.component[data-state="failed"]').length);
    return {
      ...byteMetrics(requests.finished(), `${origin}/assets/`),
      firstScreenTransferBytes,
      ...firstScreen,
      componentsBlankOnScroll: blank.size,
      failedComponents,
      failedRequests: requests.failed().length,
      failedUrls: requests.failed().map((url) => url.replace(origin, '')),
      requests: requestList(requests.finished(), origin, `${origin}/assets/`),
    };
  } finally {
    await context.close();
  }
}

function recordRequests(cdp) {
  const requests = new Map();
  let pending = 0;
  let lastChange = Date.now();
  const settle = (request) => {
    if (request.done) return;
    request.done = true;
    pending -= 1;
    lastChange = Date.now();
  };
  cdp.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.startsWith('data:')) return;
    const previous = requests.get(event.requestId);
    if (previous !== undefined) settle(previous);
    requests.set(event.requestId, { url: event.request.url, initiator: initiatorUrl(event.initiator), done: false });
    pending += 1;
    lastChange = Date.now();
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined) return;
    request.type = event.type;
    request.status = event.response.status;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined) return;
    request.bytes = event.encodedDataLength;
    settle(request);
  });
  cdp.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined) return;
    request.failed = true;
    settle(request);
  });
  return {
    finished: () => [...requests.values()].filter((request) => request.bytes !== undefined),
    failed: () => [...requests.values()].filter((request) => request.failed || request.status >= 400).map((request) => request.url),
    idle: async () => {
      const deadline = Date.now() + 120000;
      while (pending > 0 || Date.now() - lastChange < 500) {
        if (Date.now() > deadline) throw new Error(`requests still pending: ${pending}`);
        await new Promise((done) => setTimeout(done, 50));
      }
    },
  };
}

function initiatorUrl(initiator) {
  if (initiator.url) return initiator.url;
  for (let stack = initiator.stack; stack !== undefined; stack = stack.parent) {
    const frame = stack.callFrames.find((callFrame) => callFrame.url);
    if (frame !== undefined) return frame.url;
  }
  return undefined;
}

function requestList(requests, origin, assets) {
  const kinds = scriptKinds(requests, assets);
  return requests.map((request) => ({
    path: request.url.replace(origin, ''),
    type: request.type,
    ...(request.type === 'Script' ? { script: kinds(request) } : {}),
    bytes: request.bytes,
  }));
}

function scriptKinds(requests, assets) {
  const byUrl = new Map(requests.map((request) => [request.url, request]));
  return (request) => {
    const chain = [];
    for (let current = request; current?.type === 'Script' && !chain.includes(current); current = byUrl.get(current.initiator)) chain.push(current);
    if (chain.some((script) => !script.url.startsWith(assets))) return 'preview';
    const root = chain.at(-1);
    const parent = byUrl.get(root.initiator);
    if (parent?.type !== 'Document') return 'other';
    const name = root.url.slice(assets.length);
    if (name.startsWith('components-')) return 'component';
    if (name.startsWith('chat-')) return 'chat';
    return 'theme';
  };
}

export function byteMetrics(requests, assets) {
  const scriptKind = scriptKinds(requests, assets);
  const scripts = (kind) => sum(requests, (request) => request.type === 'Script' && scriptKind(request) === kind);
  return {
    transferBytes: sum(requests, () => true),
    htmlBytes: sum(requests, (request) => request.type === 'Document'),
    cssBytes: sum(requests, (request) => request.type === 'Stylesheet'),
    themeScriptBytes: scripts('theme'),
    componentScriptBytes: scripts('component'),
    chatScriptBytes: scripts('chat'),
    previewScriptBytes: scripts('preview'),
    otherScriptBytes: scripts('other'),
    fontBytes: sum(requests, (request) => request.type === 'Font'),
    fontFiles: requests.filter((request) => request.type === 'Font').length,
    imageBytes: sum(requests, (request) => request.type === 'Image'),
  };
}

function sum(requests, include) {
  return requests.filter(include).reduce((total, request) => total + request.bytes, 0);
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
      const box = frame.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight && box.width > 0;
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
    const visible = box.bottom > 0 && box.top < innerHeight && box.width > 0;
    return visible && frame.getAttribute('data-state') !== 'ready' && frame.getAttribute('data-state') !== 'failed' ? [index] : [];
  });
  return { blank, atEnd: scrollY + innerHeight >= document.documentElement.scrollHeight - 1 };
}

function allComponentsSettled() {
  return [...document.querySelectorAll('figure.component')].every((frame) => window.__bakePerf.settled.has(frame));
}

export function formatValue(value, unit) {
  if (value === null || value === undefined) return '-';
  if (unit === 'bytes') return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${(value / 1024).toFixed(1)} kB`;
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
  const settings = `CPU throttled ${report.cpuThrottlingRate}x, network ${report.network.name} (${report.network.downloadBytesPerSecond} bytes/s down, ${report.network.uploadBytesPerSecond} bytes/s up, ${report.network.latencyMs} ms latency), text files sent with ${report.compression}`;
  return [settings, '', line(header), ...rows.map(line)].join('\n');
}
