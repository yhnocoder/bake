import assert from 'node:assert/strict';
import { article, filler, validConfig } from '../blog.js';
import { test } from './browser.js';


const body = [
  filler('the introduction', 6),
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
  filler('the derivation', 6),
  ':::',
  '',
  filler('folds', 6),
  '',
  '### Nested section {#nested}',
  '',
  filler('the nested section', 6),
  '',
  '## References {#references}',
  '',
  filler('references', 6),
  '',
  ':::references',
  '- [@shazeer] Shazeer. *GLU Variants Improve Transformer*. 2020.',
  ':::',
  '',
  filler('the end', 6),
  '',
].join('\n');

const keys = [
  'Keys [@a%zz] with a malformed and [@b%41] with a valid percent-encoding.',
  '',
  filler('the citations', 6),
  '',
  ':::references',
  '- [@a%zz] The malformed entry.',
  '- [@b%41] The encoded entry.',
  ':::',
  '',
  filler('the end', 6),
  '',
  filler('the appendix', 6),
  '',
].join('\n');

test.use({
blog: {
  example: false,
  files: {
    'bake.config.js': validConfig,
    'content/posts/links/index.md': article({ title: 'Links', slug: 'links', body }),
    'content/posts/keys/index.md': article({ title: 'Keys', slug: 'keys', body: keys }),
  },
},
});

const url = '/2026-10/links/';

test('an in-page link opens the fold around its target and scrolls the target near the top', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.click('a[href="#inside"]');
  await page.waitForFunction(() => Math.abs(document.getElementById('inside').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => [document.querySelector('details.fold').open, location.hash]), [true, '#inside']);
});

test('the heading link copies the address of the heading and shows a toast without scrolling', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url);
  await page.locator('#nested').scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY);
  await page.hover('#nested');
  await page.click('#nested .bk-heading-link');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-toast')).opacity !== '0');
  assert.deepEqual(await page.evaluate(async () => [await navigator.clipboard.readText(), location.hash, scrollY, document.querySelector('.bk-toast').textContent]), [
    `${baseURL}${url}#nested`,
    '#nested',
    scrolled,
    'Link copied',
  ]);
});

test('printing hides the preview card, the settings and the toast while they are shown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url);
  await page.hover('a.citation');
  await page.locator('.bk-preview').waitFor({ state: 'visible' });
  const rendered = () => page.evaluate(() => ['.bk-preview', '.bk-settings'].map((selector) => document.querySelector(selector).checkVisibility()));
  assert.deepEqual(await rendered(), [true, true]);
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await rendered(), [false, false]);
  // why: the toast shows for 1.4 seconds, which a loaded machine can let pass before the test looks, so the page records whether the toast is rendered when it appears
  const toastRenderedWhenShown = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const toast = document.querySelector('.bk-toast');
          new MutationObserver((records, observer) => {
            if (!toast.classList.contains('is-on')) return;
            observer.disconnect();
            resolve(toast.checkVisibility());
          }).observe(toast, { attributes: true, attributeFilter: ['class'] });
          document.querySelector('#nested .bk-heading-link').click();
        }),
    );
  assert.equal(await toastRenderedWhenShown(), false);
  await page.waitForFunction(() => !document.querySelector('.bk-toast').classList.contains('is-on'));
  await page.emulateMedia({ media: 'screen' });
  assert.equal(await toastRenderedWhenShown(), true);
});

test('a citation whose key holds a percent sign shows its entry in the preview card and jumps to it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/2026-10/keys/');
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
});
