import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { budgetProblems, defaultBudgets } from '../../scripts/check-budgets.js';
import { exampleBlog } from '../blog.js';
import { openWithSelectionModule } from './selection-module.js';
import { luminance, settle, test } from './browser.js';

const WIDTHS = [1440, 1340, 1339, 1000, 600, 375];
const budgets = JSON.parse(readFileSync(defaultBudgets, 'utf8'));

const articles = readdirSync(join(exampleBlog, 'content/posts')).map((name) => {
  const source = readFileSync(join(exampleBlog, 'content/posts', name, 'index.md'), 'utf8');
  const month = /^date: (\d{4}-\d{2})/m.exec(source)[1];
  const slug = /^slug: (.+)$/m.exec(source)?.[1] ?? name;
  return { name, source, path: `/${month}/${slug}/`, markdown: !/^page: /m.test(source) };
});

const pages = ['/', '/a-missing-page/', ...articles.map((article) => article.path)];

function recordRequests(cdp) {
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.startsWith('data:')) return;
    requests.set(event.requestId, { url: event.request.url, initiator: initiatorUrl(event.initiator) });
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (request !== undefined) request.type = event.type;
  });
  return () => [...requests.values()].filter((request) => request.type !== undefined);
}

function initiatorUrl(initiator) {
  if (initiator.url) return initiator.url;
  for (let stack = initiator.stack; stack !== undefined; stack = stack.parent) {
    const frame = stack.callFrames.find((callFrame) => callFrame.url);
    if (frame !== undefined) return frame.url;
  }
  return undefined;
}

// A script belongs to the script of the page that loaded it first: the theme, the component runtime, the chat module, or a preview card that loads the scripts of another page
function scriptKinds(requests, assets) {
  const byUrl = new Map(requests.map((request) => [request.url, request]));
  return (request) => {
    const chain = [];
    for (let current = request; current?.type === 'Script' && !chain.includes(current); current = byUrl.get(current.initiator)) chain.push(current);
    if (chain.some((script) => !script.url.startsWith(assets))) return 'preview';
    const root = chain.at(-1);
    if (byUrl.get(root.initiator)?.type !== 'Document') return 'other';
    const name = root.url.slice(assets.length);
    if (name.startsWith('components-')) return 'component';
    if (name.startsWith('chat-')) return 'chat';
    return 'theme';
  };
}

// why: the test server does not compress, and GitHub Pages sends text files with gzip, so the budgets count the gzip size of each file
function gzipBytes(dist, url) {
  const { pathname } = new URL(url);
  let file = join(dist, decodeURIComponent(pathname), pathname.endsWith('/') ? 'index.html' : '');
  if (!existsSync(file)) file = join(dist, '404.html');
  return gzipSync(readFileSync(file)).length;
}

function byteMetrics(requests, dist, origin) {
  const scriptKind = scriptKinds(requests, `${origin}/assets/`);
  const bytes = (include) => requests.filter(include).reduce((total, request) => total + gzipBytes(dist, request.url), 0);
  const scripts = (kind) => bytes((request) => request.type === 'Script' && scriptKind(request) === kind);
  return {
    htmlBytes: bytes((request) => request.type === 'Document'),
    cssBytes: bytes((request) => request.type === 'Stylesheet'),
    themeScriptBytes: scripts('theme'),
    componentScriptBytes: scripts('component'),
    chatScriptBytes: scripts('chat'),
    previewScriptBytes: scripts('preview'),
    otherScriptBytes: scripts('other'),
    requests: requests.length,
  };
}

function brokenParts() {
  const problems = [];
  if (document.documentElement.scrollWidth > innerWidth) problems.push(`the page is ${document.documentElement.scrollWidth}px wide`);
  for (const frame of document.querySelectorAll('figure.component')) {
    if (frame.dataset.state !== 'ready') problems.push(`component ${frame.dataset.component} is ${frame.dataset.state}`);
  }
  for (const formula of document.querySelectorAll('mjx-container')) {
    const box = formula.querySelector('svg')?.getBoundingClientRect();
    if (formula.querySelector('[data-mml-node="merror"], [data-mjx-error]') !== null) problems.push(`formula error in ${formula.dataset.tex}`);
    else if (formula.checkVisibility() && (box === undefined || box.width === 0 || box.height === 0)) problems.push(`formula ${formula.dataset.tex} is empty`);
  }
  for (const use of document.querySelectorAll('mjx-container use')) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
    if (document.getElementById(href.slice(1)) === null) problems.push(`formula glyph ${href} is missing`);
  }
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) problems.push(`id ${id} appears more than once`);
  return problems;
}

for (const path of pages) {
  test.describe(`the page ${path} of the example blog`, () => {
    for (const scheme of ['light', 'dark']) {
      test(`in the ${scheme} scheme loads without errors, starts every component, fits the screen at every breakpoint and follows the colour scheme of the system`, async ({ site, newPage }) => {
        const page = await newPage({ colorScheme: scheme, viewport: { width: WIDTHS[0], height: 900 } });
        const problems = [];
        page.on('console', (message) => {
          // why: the browser logs the status 404 of the 404 page as an error of the page itself
          if (message.type() === 'error' && message.location().url !== page.url()) problems.push(`console: ${message.text()}`);
        });
        page.on('pageerror', (error) => problems.push(error.message));
        page.on('requestfailed', (request) => {
          // why: a component or a font that is no longer needed when the width changes is cancelled
          if (request.failure().errorText !== 'net::ERR_ABORTED') problems.push(`${request.url()} failed: ${request.failure().errorText}`);
        });
        page.on('response', (response) => {
          if (response.status() >= 400 && !response.request().isNavigationRequest()) problems.push(`${response.url()} answered ${response.status()}`);
        });
        const cdp = await page.context().newCDPSession(page);
        const requests = recordRequests(cdp);
        await cdp.send('Network.enable');
        await page.goto(path, { waitUntil: 'networkidle' });
        if (scheme === 'light') {
          const values = byteMetrics(requests(), join(site.dir, 'dist'), site.origin);
          problems.push(...budgetProblems({ metrics: Object.keys(values), measurements: [{ page: path, width: WIDTHS[0], ...values }] }, budgets));
        }
        // why: a component starts when it comes near the screen, and the page starts all of them before it is printed
        await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
        await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => frame.dataset.state === 'ready' || frame.dataset.state === 'failed'));
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          problems.push(...(await page.evaluate(brokenParts)).map((problem) => `at ${width}px: ${problem}`));
        }
        if (scheme === 'dark') {
          const background = async () => luminance(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
          const dark = await background();
          await page.emulateMedia({ colorScheme: 'light' });
          await settle(page);
          if (dark >= (await background())) problems.push('the dark scheme is not darker than the light one');
        }
        assert.deepEqual(problems, []);
      });
    }
  });
}

for (const article of articles.filter((candidate) => candidate.markdown)) {
  test(`copying a whole block of ${article.path} gives its source lines`, async ({ page }) => {
    await openWithSelectionModule(page, article.path);
    const copies = await page.evaluate(() =>
      [...document.querySelectorAll('[data-line][data-end-line]')]
        .filter((element) => element.closest('[data-sidenote], .embed') === null)
        .map((element) => {
          const range = document.createRange();
          range.selectNode(element);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
          document.dispatchEvent(event);
          return { line: Number(element.dataset.line), endLine: Number(element.dataset.endLine), text: event.clipboardData.getData('text/plain') };
        }),
    );
    const lines = article.source.split('\n');
    const source = ({ line, endLine }) => lines.slice(line - 1, endLine).join('\n');
    assert.ok(copies.length > 0);
    assert.deepEqual(
      copies.filter((copy) => !copy.text.startsWith(source(copy))).map((copy) => ({ line: copy.line, expected: source(copy), copied: copy.text })),
      [],
    );
  });
}
