import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { bake } from '../blog.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');

test('formulas in the syntax article render in Chromium without errors', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(join(dir, 'dist/2026-10/syntax/index.html')).href);
  const report = await page.evaluate(() => {
    const containers = [...document.querySelectorAll('mjx-container')];
    return {
      count: containers.length,
      errors: containers.filter((container) => container.querySelector('[data-mml-node="merror"], [data-mjx-error]')).map((container) => container.dataset.tex),
      empty: containers
        .filter((container) => {
          const box = container.querySelector('svg')?.getBoundingClientRect();
          return box === undefined || box.width === 0 || box.height === 0;
        })
        .map((container) => container.dataset.tex),
      missingGlyphs: [...document.querySelectorAll('mjx-container use')]
        .map((use) => use.getAttribute('href') ?? use.getAttribute('xlink:href'))
        .filter((href) => document.getElementById(href.slice(1)) === null),
    };
  });
  assert.ok(report.count > 20, `expected the syntax article to contain formulas, found ${report.count}`);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.empty, []);
  assert.deepEqual(report.missingGlyphs, []);
});
