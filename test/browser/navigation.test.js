import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { serve } from './server.js';

const filler = (topic) => Array.from({ length: 6 }, (_, index) => `Paragraph ${index + 1} about ${topic}. ${'It fills the page so that the reader has to scroll. '.repeat(6)}`).join('\n\n');

const body = [
  filler('the introduction'),
  '',
  '## Folds {#folds}',
  '',
  ':::recap',
  'Folds hide derivations.',
  ':::',
  '',
  'A link to [the derivation](#inside) and a citation [@shazeer].',
  '',
  ':::fold{title="Derivation"}',
  'The derivation inside the fold. ^inside',
  '',
  filler('the derivation'),
  ':::',
  '',
  filler('folds'),
  '',
  '### Nested section {#nested}',
  '',
  filler('the nested section'),
  '',
  '## References {#references}',
  '',
  filler('references'),
  '',
  ':::references',
  '- [@shazeer] Shazeer. *GLU Variants Improve Transformer*. 2020.',
  ':::',
  '',
  filler('the end'),
  '',
].join('\n');

const longBody = Array.from({ length: 18 }, (_, index) => `## Chapter ${index + 1} {#chapter-${index + 1}}\n\n${'A paragraph of the chapter. '.repeat(30)}\n`).join('\n');

function coveredEntries() {
  const button = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
  const scroller = document.querySelector('.bk-toc .bk-toc-scroll').getBoundingClientRect();
  const top = Math.max(scroller.top, 0);
  const bottom = Math.min(scroller.bottom, innerHeight);
  return [...document.querySelectorAll('.bk-toc .bk-toc-entry')]
    .map((entry) => ({ target: entry.dataset.target, box: entry.getBoundingClientRect() }))
    .filter(({ box }) => Math.min(box.bottom, bottom) > Math.max(box.top, top))
    .filter(({ box }) => box.left < button.right && box.right > button.left && Math.min(box.bottom, bottom) > button.top && Math.max(box.top, top) < button.bottom)
    .map(({ target }) => target);
}

test('links, folds and the table of contents', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/links/index.md': article({ title: 'Links', slug: 'links', body }),
    'content/posts/long/index.md': article({ title: 'Long', slug: 'long', body: longBody }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const url = `${base}/2026-10/links/`;
  const browser = await chromium.launch();
  t.after(() => browser.close());

  await t.test('a fold opens with an animation and ends fully open, then closes', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    const fold = page.locator('details.fold');
    const closedHeight = (await fold.boundingBox()).height;
    await page.click('details.fold > summary');
    assert.ok(await fold.evaluate((element) => element.getAnimations().length > 0), 'opening the fold does not animate');
    await page.waitForFunction(() => document.querySelector('details.fold').getAnimations().length === 0);
    const opened = await fold.evaluate((element) => ({
      open: element.open,
      style: element.getAttribute('style') ?? '',
      opacity: [...element.children].map((child) => getComputedStyle(child).opacity),
      height: element.getBoundingClientRect().height,
    }));
    assert.equal(opened.open, true);
    assert.equal(opened.style, '');
    assert.ok(opened.opacity.every((value) => value === '1'), `opacities ${opened.opacity}`);
    assert.ok(opened.height > closedHeight + 200, `the open fold is ${opened.height}px high`);
    await page.click('details.fold > summary');
    await page.waitForFunction(() => document.querySelector('details.fold').getAnimations().length === 0);
    assert.equal(await fold.evaluate((element) => element.open), false);
    assert.ok(Math.abs((await fold.boundingBox()).height - closedHeight) < 1);
    await page.close();
  });

  await t.test('an in-page link opens the fold around its target and scrolls the target near the top', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(url);
    await page.click('a[href="#inside"]');
    await page.waitForFunction(() => Math.abs(document.getElementById('inside').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
    assert.deepEqual(await page.evaluate(() => [document.querySelector('details.fold').open, location.hash]), [true, '#inside']);
    await page.close();
  });

  await t.test('the heading link copies the address of the heading and shows a toast without scrolling', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#nested').scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => scrollY);
    await page.hover('#nested');
    await page.click('#nested .bk-heading-link');
    await page.waitForFunction(() => document.querySelector('.bk-toast')?.classList.contains('is-on'));
    assert.deepEqual(await page.evaluate(async () => [await navigator.clipboard.readText(), location.hash, scrollY, document.querySelector('.bk-toast').textContent]), [
      `${url}#nested`,
      '#nested',
      scrolled,
      'Link copied',
    ]);
    await context.close();
  });

  await t.test('hovering a citation shows its entry in a card that hides after the pointer leaves', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    const card = page.locator('.bk-preview');
    await page.hover('a.citation');
    assert.equal(await card.isVisible(), false);
    await page.waitForFunction(() => document.querySelector('.bk-preview').classList.contains('is-on'));
    assert.equal(await card.locator('.bk-preview-number').textContent(), '[1]');
    assert.match(await card.locator('.bk-preview-text').textContent(), /GLU Variants Improve Transformer/);
    const box = await card.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0 && box.y + box.height <= 900, `the card is outside the viewport: ${JSON.stringify(box)}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(300);
    assert.equal(await card.evaluate((element) => element.classList.contains('is-on')), true);
    await page.mouse.move(5, 450);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-preview')).visibility === 'hidden');
    await page.close();
  });

  await t.test('the table of contents follows the reading position and shows the recap of read chapters', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    const states = () =>
      page.evaluate(() => ({
        visible: document.querySelector('.bk-toc').checkVisibility(),
        entries: Object.fromEntries([...document.querySelectorAll('.bk-toc .bk-toc-entry')].map((entry) => [entry.dataset.target, entry.dataset.state])),
        recap: document.querySelector('.bk-toc [data-target="folds"] .bk-toc-recap').getBoundingClientRect().height,
      }));
    assert.deepEqual(await states(), { visible: true, entries: { folds: 'ahead', nested: 'ahead', references: 'ahead' }, recap: 0 });
    await page.evaluate(() => scrollTo(0, document.getElementById('references').getBoundingClientRect().top + scrollY - 100));
    await page.waitForFunction(() => document.querySelector('.bk-toc [data-target="references"]').dataset.state === 'current');
    await page.waitForTimeout(400);
    const read = await states();
    assert.deepEqual(read.entries, { folds: 'read', nested: 'read', references: 'current' });
    assert.ok(read.recap > 10, `the recap of a read chapter is ${read.recap}px high`);
    await page.close();
  });

  await t.test('the settings button covers no entry of a long table of contents before or after scrolling', async () => {
    for (const height of [900, 640]) {
      const page = await browser.newPage({ viewport: { width: 1440, height }, reducedMotion: 'reduce' });
      await page.goto(`${base}/2026-10/long/`);
      await page.waitForFunction(() => document.documentElement.classList.contains('bk-toc-ready'));
      assert.deepEqual(await page.evaluate(coveredEntries), [], `at the top of the page, ${height}px high`);
      await page.evaluate(() => scrollTo(0, document.getElementById('chapter-9').getBoundingClientRect().top + scrollY - 100));
      await page.waitForFunction(() => document.querySelector('.bk-toc [data-target="chapter-9"]').dataset.state === 'current');
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(coveredEntries), [], `in the middle of the page, ${height}px high`);
      await page.close();
    }
  });

  await t.test('below 1340 px a button above the settings button opens the contents in a drawer that a link closes', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
    await page.goto(url);
    const button = page.locator('.bk-toc-button');
    const toggle = page.locator('.bk-settings-toggle');
    assert.equal(await page.locator('.bk-toc').isVisible(), false);
    const [above, below] = [await button.boundingBox(), await toggle.boundingBox()];
    assert.ok(above.y + above.height <= below.y, `the contents button ends at ${above.y + above.height}, the settings button starts at ${below.y}`);
    await button.click();
    const drawer = page.locator('.bk-drawer');
    await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
    await drawer.getByRole('link', { name: /References/ }).click();
    await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().right <= 0);
    await page.waitForFunction(() => Math.abs(document.getElementById('references').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
    await button.click();
    await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().right <= 0);
    await page.close();
  });
});
