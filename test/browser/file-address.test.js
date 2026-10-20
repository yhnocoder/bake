import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from '../blog.js';

test('a page opened from a file address is the styled page without scripts', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'components/demo-box.js': 'export const layout = { height: 120 };\n\nexport default class DemoBox extends HTMLElement {}\n',
    'content/posts/rope/index.md': article({ body: 'A paragraph with a note.[^a]\n\n:::demo-box\n:::\n\n[^a]: The note.\n' }),
  });
  assert.equal(bake(dir, 'build').stderr, '');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(pathToFileURL(join(dir, 'dist/2026-10/rope/index.html')).href);
  const articlePage = await page.evaluate(() => {
    const paragraph = document.querySelector('.bk-article .bk-block[data-type="paragraph"]');
    const note = document.querySelector('.bk-article .bk-sidenote[data-sidenote="1"]');
    return {
      script: document.documentElement.dataset.script ?? null,
      background: getComputedStyle(document.body).backgroundColor,
      columnWidth: paragraph.getBoundingClientRect().width,
      noteVisible: note.checkVisibility(),
      noteBelowParagraph: note.getBoundingClientRect().top >= paragraph.getBoundingClientRect().bottom,
      copyVisible: document.querySelector('.bk-copy').checkVisibility(),
      frameText: getComputedStyle(document.querySelector('.component-box'), '::before').content,
    };
  });
  assert.deepEqual(articlePage, {
    script: null,
    background: 'rgb(245, 246, 244)',
    columnWidth: 820,
    noteVisible: true,
    noteBelowParagraph: true,
    copyVisible: false,
    frameText: '"This interactive figure needs JavaScript"',
  });

  await page.goto(pathToFileURL(join(dir, 'dist/index.html')).href);
  const homepage = await page.evaluate(() => ({
    script: document.documentElement.dataset.script ?? null,
    background: getComputedStyle(document.body).backgroundColor,
    controlsVisible: document.querySelector('.bk-home-controls').checkVisibility(),
  }));
  assert.deepEqual(homepage, { script: null, background: 'rgb(245, 246, 244)', controlsVisible: false });
});

test('the homepage and the articles of the example blog opened from file addresses load every stylesheet, font and image', async (t) => {
  const exampleBlog = join(import.meta.dirname, '../../examples/blog');
  const dir = mkdtempSync(join(tmpdir(), 'bake-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  assert.equal(bake(dir, 'build').stderr, '');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1440, 375]) {
    for (const path of ['index.html', '2026-10/syntax/index.html', '2026-10/jacobian/index.html', '2026-09/llm-act-fns/index.html', '2026-09/matrix-calculus/index.html', '2026-10/activations/index.html']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const failed = [];
      page.on('requestfailed', (request) => {
        if (request.resourceType() !== 'script') failed.push(`${request.resourceType()} ${request.url()} ${request.failure()?.errorText}`);
      });
      page.on('console', (message) => {
        if (message.type() === 'error' && !/^Access to script at .* has been blocked by CORS policy|^Failed to load resource: net::ERR_FAILED$/.test(message.text())) failed.push(message.text());
      });
      await page.goto(pathToFileURL(join(dir, 'dist', path)).href);
      const state = await page.evaluate(async () => {
        for (const image of document.images) image.loading = 'eager';
        await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
        await document.fonts.ready;
        return {
          script: document.documentElement.dataset.script ?? null,
          brokenImages: [...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.src),
          visibleControls: [...document.querySelectorAll('button, input, select')].filter((control) => control.checkVisibility()).length,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.deepEqual({ ...state, failed }, { script: null, brokenImages: [], visibleControls: 0, overflow: false, failed: [] }, `${path} at ${width} pixels`);
      await page.close();
    }
  }
});
