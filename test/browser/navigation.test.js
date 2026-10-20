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


test('links, folds and citation previews', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/links/index.md': article({ title: 'Links', slug: 'links', body }),
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

  await t.test('printing hides the preview card, the settings and the toast while they are shown', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    await page.hover('a.citation');
    await page.waitForFunction(() => document.querySelector('.bk-preview').classList.contains('is-on'));
    await page.evaluate(() => document.querySelector('.bk-toast').classList.add('is-on'));
    const shown = ['.bk-preview', '.bk-settings', '.bk-toast'];
    const displays = () => page.evaluate((selectors) => selectors.map((selector) => getComputedStyle(document.querySelector(selector)).display), shown);
    assert.ok((await displays()).every((display) => display !== 'none'));
    await page.emulateMedia({ media: 'print' });
    assert.deepEqual(await displays(), ['none', 'none', 'none']);
    await page.close();
  });
});

test('a citation whose key holds a percent sign shows its entry in the preview card and jumps to it', async (t) => {
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
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/keys/index.md': article({ title: 'Keys', slug: 'keys', body: keys }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
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
    await page.waitForFunction(() => document.querySelector('.bk-preview').classList.contains('is-on'), null, { timeout: 3000 });
    assert.equal(await card.locator('.bk-preview-text').textContent(), text);
    await page.mouse.move(5, 450);
    await page.waitForFunction(() => !document.querySelector('.bk-preview').classList.contains('is-on'));
  }
  await page.locator('a.citation').first().click();
  await page.waitForFunction(() => Math.abs(document.getElementById('reference-a%zz').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
  assert.deepEqual(errors, []);
});
