import assert from 'node:assert/strict';
import { settle, test } from './browser.js';

test('formulas render in an open preview card and in the sidenotes that a phone opens', async ({ page, browser }) => {
  await page.goto('/2026-10/syntax/');
  const link = page.locator(`.bk-article p a[href="../../2026-10/syntax-linked/#${encodeURIComponent('链式法则')}"]`).first();
  await link.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await settle(page);
  await link.hover();
  await page.waitForFunction(() => document.querySelector('.bk-preview').getAttribute('aria-hidden') === 'false');
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

  const notesWithMath = await page.evaluate(() => [...new Set([...document.querySelectorAll('.bk-sidenote')].filter((note) => note.querySelector('mjx-container') !== null).map((note) => note.dataset.sidenote))]);
  assert.ok(notesWithMath.length > 0, 'expected a sidenote with a formula in the syntax article');
  const phone = await browser.newPage({ baseURL: page.url(), viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
  await phone.goto('/2026-10/syntax/');
  const opened = [];
  for (const number of notesWithMath) {
    await phone.locator(`a[href="#sidenote-${number}"]`).first().tap();
    await phone.waitForFunction((value) => {
      const note = [...document.querySelectorAll(`.bk-sidenote[data-sidenote="${value}"]`)].find((element) => element.checkVisibility());
      return note !== undefined && note.getAnimations().length === 0;
    }, number);
    opened.push(
      await phone.evaluate((value) => {
        const note = [...document.querySelectorAll(`.bk-sidenote[data-sidenote="${value}"]`)].find((element) => element.checkVisibility());
        const boxes = [...note.querySelectorAll('mjx-container svg')].map((svg) => svg.getBoundingClientRect());
        return { number: value, formulas: boxes.length, empty: boxes.filter((box) => box.width === 0 || box.height === 0).length };
      }, number),
    );
  }
  assert.deepEqual(
    opened.map(({ number, empty }) => ({ number, empty })),
    notesWithMath.map((number) => ({ number, empty: 0 })),
  );
  assert.ok(opened.every(({ formulas }) => formulas > 0), `opened notes: ${JSON.stringify(opened)}`);
  await phone.close();
});
