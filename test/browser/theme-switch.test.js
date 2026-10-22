import assert from 'node:assert/strict';
import { test } from './browser.js';

const notFading = () => !document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'));

// why: a fade lasts a fraction of a second, which a loaded machine can let pass before the test looks, so a watcher in every frame records it and can hold it
function watchFade(page, { hold = false } = {}) {
  return page.evaluate((hold) => {
    window.sawFade = false;
    const watch = () => {
      const fades = document.getAnimations().filter((animation) => String(animation.effect?.pseudoElement).startsWith('::view-transition'));
      if (fades.length === 0) return requestAnimationFrame(watch);
      window.sawFade = true;
      if (hold) for (const fade of fades) fade.pause();
    };
    requestAnimationFrame(watch);
  }, hold);
}

async function fades(page, change) {
  await watchFade(page);
  await change();
  await page.waitForFunction(() => window.sawFade);
  await page.waitForFunction(notFading);
}

test('a change of the system colour scheme fades without showing the new colours first, and a press during the fade ends it and keeps the settings open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/2026-10/syntax/');
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
  await watchFade(page, { hold: true });
  await option('浅').click();
  await page.waitForFunction(() => window.sawFade);
  await page.mouse.click(dark.x + dark.width / 2, dark.y + dark.height / 2);
  assert.equal(await page.evaluate(() => document.getAnimations().some((animation) => String(animation.effect?.pseudoElement).startsWith('::view-transition'))), false);
  assert.equal(await page.locator('.bk-settings-panel').isVisible(), true);
  assert.equal(await option('浅').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), light);
  await option('深').click();
  await page.waitForFunction((background) => getComputedStyle(document.body).backgroundColor === background, darkBackground);
  assert.equal(await option('深').getAttribute('aria-pressed'), 'true');
});

for (const [theme, path] of [['essay', '/2026-10/syntax/'], ['bento', '/2026-10/activations/']]) {
  test(`switching the theme and the text spacing fades into the new look in the ${theme} theme`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: '设置' }).click();
    await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);

    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await fades(page, () => page.locator('.bk-settings-options button', { hasText: /^\s*深\s*$/ }).click());
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), background);

    const lineHeight = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight);
    await fades(page, () => page.locator('.bk-settings-row[data-setting="spacing"] button[data-value="loose"]').click());
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight), lineHeight);
  });
}
