import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchBrowser, serveExample } from './browser.js';

const fading = () => document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'));
const notFading = () => !document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'));

test('a change of the system colour scheme fades without showing the new colours first, and a press during the fade ends it and keeps the settings open', async (t) => {
  const origin = await serveExample(t);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await page.goto(`${origin}/2026-10/syntax/`);
  await page.evaluate(() => document.fonts.ready);
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.evaluate(() => {
    window.framesBeforeFade = [];
    window.sawFade = false;
    const watch = () => {
      if (document.getAnimations().some((animation) => String(animation.effect?.pseudoElement).startsWith('::view-transition'))) window.sawFade = true;
      else {
        window.framesBeforeFade.push(getComputedStyle(document.body).backgroundColor);
        requestAnimationFrame(watch);
      }
    };
    requestAnimationFrame(watch);
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => window.sawFade);
  assert.deepEqual([...new Set(await page.evaluate(() => window.framesBeforeFade))], [light]);
  await page.waitForFunction(notFading);
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(darkBackground, light);

  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);
  const option = (text) => page.locator('.bk-settings-options button', { hasText: new RegExp(`^\\s*${text}\\s*$`) });
  assert.equal(await option('跟随系统').getAttribute('aria-pressed'), 'true');
  const dark = await option('深').boundingBox();
  await option('浅').click();
  await page.waitForFunction(fading);
  await page.mouse.click(dark.x + dark.width / 2, dark.y + dark.height / 2);
  assert.equal(await page.evaluate(fading), false);
  assert.equal(await page.locator('.bk-settings-panel').isVisible(), true);
  assert.equal(await option('浅').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), light);
  await option('深').click();
  await page.waitForFunction((background) => getComputedStyle(document.body).backgroundColor === background, darkBackground);
  assert.equal(await option('深').getAttribute('aria-pressed'), 'true');
});

test('switching the theme and the text spacing fades into the new look in the essay and bento themes', async (t) => {
  const origin = await serveExample(t);
  const browser = await launchBrowser();

  for (const [theme, path] of [['essay', '/2026-10/syntax/'], ['bento', '/2026-10/activations/']]) for (const width of [1440, 375]) {
    await t.test(`${theme} at ${width} pixels`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${origin}${path}`);
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('button', { name: '设置' }).click();
      await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);

      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.locator('.bk-settings-options button', { hasText: /^\s*深\s*$/ }).click();
      await page.waitForFunction(fading);
      await page.waitForFunction(notFading);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), background);

      const lineHeight = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight);
      await page.locator('.bk-settings-row[data-setting="spacing"] button[data-value="loose"]').click();
      await page.waitForFunction(fading);
      await page.waitForFunction(notFading);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight), lineHeight);
      await page.close();
    });
  }
});
