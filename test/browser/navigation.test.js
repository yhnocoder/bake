import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { launchBrowser, serve, settle } from './browser.js';

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


const keys = [
  'Keys [@a%zz] with a malformed and [@b%41] with a valid percent-encoding.',
  '',
  filler('the citations'),
  '',
  ':::references',
  '- [@a%zz] The malformed entry.',
  '- [@b%41] The encoded entry.',
  ':::',
  '',
  filler('the end'),
  '',
  filler('the appendix'),
  '',
].join('\n');

test('links, folds and citation previews', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/links/index.md': article({ title: 'Links', slug: 'links', body }),
    'content/posts/keys/index.md': article({ title: 'Keys', slug: 'keys', body: keys }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const url = `${base}/2026-10/links/`;
  const browser = await launchBrowser();

  await t.test('a fold fades its content in and out without animating its height, and ends fully open, then closed', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    const fold = page.locator('details.fold');
    const closedHeight = (await fold.boundingBox()).height;
    const content = () => fold.evaluate((element) => {
      const style = getComputedStyle(element, '::details-content');
      return { open: element.open, opacity: Number(style.opacity), transform: style.transform, height: element.getBoundingClientRect().height };
    });
    await page.click('details.fold > summary');
    const opening = await content();
    await settle(page);
    const opened = await content();
    assert.equal(opening.open, true);
    assert.ok(opening.opacity < 1, `the content starts at opacity ${opening.opacity}`);
    assert.ok(Math.abs(opening.height - opened.height) < 1, `the fold is ${opening.height}px high while it opens and ${opened.height}px when open`);
    assert.deepEqual([opened.open, opened.opacity, opened.transform], [true, 1, 'none']);
    assert.ok(opened.height > closedHeight + 200, `the open fold is ${opened.height}px high`);
    await page.click('details.fold > summary');
    const closing = await content();
    assert.ok(closing.open && Math.abs(closing.height - opened.height) < 1, `the fold is ${closing.height}px high while it closes`);
    await page.waitForFunction(() => !document.querySelector('details.fold').open);
    assert.ok(Math.abs((await fold.boundingBox()).height - closedHeight) < 1);
    await page.click('details.fold > summary');
    await page.click('details.fold > summary');
    await page.click('details.fold > summary');
    await settle(page);
    assert.deepEqual(await content().then(({ open, opacity }) => [open, opacity]), [true, 1]);
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
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-toast')).opacity !== '0');
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
    await card.waitFor({ state: 'visible' });
    assert.equal(await card.locator('.bk-preview-number').textContent(), '[1]');
    assert.match(await card.locator('.bk-preview-text').textContent(), /GLU Variants Improve Transformer/);
    const box = await card.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0 && box.y + box.height <= 900, `the card is outside the viewport: ${JSON.stringify(box)}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(300);
    assert.equal(await card.isVisible(), true);
    await page.mouse.move(5, 450);
    await card.waitFor({ state: 'hidden' });
    await page.close();
  });

  await t.test('printing hides the preview card, the settings and the toast while they are shown', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(url);
    await page.hover('#nested');
    await page.click('#nested .bk-heading-link');
    await page.hover('a.citation');
    await page.locator('.bk-preview').waitFor({ state: 'visible' });
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-toast')).opacity), '0');
    const shown = ['.bk-preview', '.bk-settings', '.bk-toast'];
    const displays = () => page.evaluate((selectors) => selectors.map((selector) => getComputedStyle(document.querySelector(selector)).display), shown);
    assert.ok((await displays()).every((display) => display !== 'none'));
    await page.emulateMedia({ media: 'print' });
    assert.deepEqual(await displays(), ['none', 'none', 'none']);
    await context.close();
  });

  await t.test('a citation whose key holds a percent sign shows its entry in the preview card and jumps to it', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/2026-10/keys/`);
    const card = page.locator('.bk-preview');
    for (const [index, text] of [
      [0, 'The malformed entry.'],
      [1, 'The encoded entry.'],
    ]) {
      await page.locator('a.citation').nth(index).hover();
      await card.waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await card.locator('.bk-preview-text').textContent(), text);
      await page.mouse.move(5, 450);
      await card.waitFor({ state: 'hidden' });
    }
    await page.locator('a.citation').first().click();
    await page.waitForFunction(() => Math.abs(document.getElementById('reference-a%zz').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
    assert.deepEqual(errors, []);
    await page.close();
  });
});


