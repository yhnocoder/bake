import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { bake } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');

test('formulas in the syntax article, in its embeds and in an open preview card render in Chromium without errors', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'));

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/2026-10/syntax/`);
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => {
    const containers = [...document.querySelectorAll('mjx-container')];
    const hiddenNotes = [...document.querySelectorAll('.bk-sidenote')].filter((note) => note.querySelector('mjx-container') !== null && !note.checkVisibility());
    return {
      count: containers.length,
      errors: containers.filter((container) => container.querySelector('[data-mml-node="merror"], [data-mjx-error]')).map((container) => container.dataset.tex),
      empty: containers
        .filter((container) => !hiddenNotes.includes(container.closest('.bk-sidenote')))
        .filter((container) => {
          const box = container.querySelector('svg')?.getBoundingClientRect();
          return box === undefined || box.width === 0 || box.height === 0;
        })
        .map((container) => container.dataset.tex),
      notesWithMath: hiddenNotes.map((note) => note.dataset.sidenote),
      notesWithoutCopy: hiddenNotes
        .filter((note) => {
          const copy = document.querySelector(`.bk-notes-layer .bk-sidenote[data-sidenote="${note.dataset.sidenote}"]`);
          return copy === null || !copy.checkVisibility() || copy.querySelectorAll('mjx-container').length !== note.querySelectorAll('mjx-container').length;
        })
        .map((note) => note.dataset.sidenote),
      missingGlyphs: [...document.querySelectorAll('mjx-container use')]
        .map((use) => use.getAttribute('href') ?? use.getAttribute('xlink:href'))
        .filter((href) => document.getElementById(href.slice(1)) === null),
      embedded: document.querySelectorAll('.embed mjx-container').length,
      duplicateIds: [...document.querySelectorAll('[id]')].map((element) => element.id).filter((id, index, ids) => ids.indexOf(id) !== index),
    };
  });
  assert.ok(report.count > 20, `expected the syntax article to contain formulas, found ${report.count}`);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.empty, []);
  assert.ok(report.notesWithMath.length > 0, 'expected a sidenote with a formula in the syntax article');
  assert.deepEqual(report.notesWithoutCopy, []);
  assert.deepEqual(report.missingGlyphs, []);
  assert.ok(report.embedded > 0, 'expected an embed with formulas in the syntax article');
  assert.deepEqual(report.duplicateIds, []);

  const link = page.locator('a.internal-link[data-target="/2026-10/syntax-linked/#chain-rule"]').first();
  await link.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  await link.hover();
  await page.waitForFunction(() => document.querySelector('.bk-preview').classList.contains('is-on'));
  const card = await page.evaluate(() => {
    const containers = [...document.querySelectorAll('.bk-preview mjx-container')];
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    return {
      count: containers.length,
      empty: containers.filter((container) => container.querySelector('svg').getBoundingClientRect().width === 0).map((container) => container.dataset.tex),
      missingGlyphs: containers.flatMap((container) => [...container.querySelectorAll('use')].map((use) => use.getAttribute('xlink:href')).filter((href) => document.getElementById(href.slice(1)) === null)),
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    };
  });
  assert.ok(card.count > 0, 'expected formulas in the preview card of the chain rule');
  assert.deepEqual(card.empty, []);
  assert.deepEqual(card.missingGlyphs, []);
  assert.deepEqual(card.duplicateIds, []);

  const phone = await browser.newPage({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
  await phone.goto(`${origin}/2026-10/syntax/`);
  const opened = [];
  for (const number of report.notesWithMath) {
    await phone.locator(`.sidenote-ref[data-sidenote="${number}"] a`).first().tap();
    await phone.waitForFunction((value) => {
      const note = document.querySelector(`.bk-article .bk-sidenote[data-sidenote="${value}"]:not(.bk-notes-layer *)`);
      return note.checkVisibility() && note.getAnimations().length === 0;
    }, number);
    opened.push(
      await phone.evaluate((value) => {
        const note = document.querySelector(`.bk-article .bk-sidenote[data-sidenote="${value}"]:not(.bk-notes-layer *)`);
        const boxes = [...note.querySelectorAll('mjx-container svg')].map((svg) => svg.getBoundingClientRect());
        return { number: value, formulas: boxes.length, empty: boxes.filter((box) => box.width === 0 || box.height === 0).length };
      }, number),
    );
  }
  assert.deepEqual(
    opened.map(({ number, empty }) => ({ number, empty })),
    report.notesWithMath.map((number) => ({ number, empty: 0 })),
  );
  assert.ok(opened.every(({ formulas }) => formulas > 0), `opened notes: ${JSON.stringify(opened)}`);
});
