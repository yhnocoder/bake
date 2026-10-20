import assert from 'node:assert/strict';
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
