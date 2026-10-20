import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { exampleBuild } from '../blog.js';
import { serve } from './server.js';

const THROTTLE = 4;
const FADE_FRAME_LIMIT = 150;

test('switching the theme restyles the page once and fades on the compositor in the essay and bento themes', async (t) => {
  const dir = exampleBuild();
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  for (const [theme, path] of [['essay', '/2026-10/syntax/'], ['bento', '/2026-10/activations/']]) for (const width of [1440, 375]) {
    await t.test(`${theme} at ${width} pixels with ${THROTTLE}x CPU throttling`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${origin}${path}`);
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('button', { name: '设置' }).click();
      await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);
      const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const elements = await page.evaluate(() => document.querySelectorAll('*').length);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const events = [];
      cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
      const traced = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
      const frames = await page.evaluate(async () => {
        const times = [];
        let switched = -1;
        let running = true;
        const tick = (time) => {
          times.push(time);
          if (switched < 0 && document.documentElement.dataset.theme === 'dark') switched = times.length - 1;
          if (running) requestAnimationFrame(tick);
        };
        await new Promise((done) =>
          requestAnimationFrame((time) => {
            times.push(time);
            requestAnimationFrame(tick);
            done();
          }),
        );
        const start = performance.now();
        [...document.querySelectorAll('.bk-settings-options button')].find((button) => button.textContent.trim() === '深').click();
        while (document.documentElement.dataset.theme !== 'dark' || document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'))) {
          await new Promise((done) => setTimeout(done, 20));
        }
        const end = performance.now();
        await new Promise((done) => setTimeout(done, 100));
        running = false;
        const gaps = times.slice(1).map((time, index) => time - times[index]);
        return { wall: end - start, fade: gaps.slice(switched + 1) };
      });
      await cdp.send('Tracing.end');
      await traced;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      const restyles = events.filter((event) => event.name === 'UpdateLayoutTree' && event.args?.elementCount >= elements / 2);
      assert.equal(restyles.length, 1, `the switch restyled the whole page ${restyles.length} times`);
      const slowest = Math.max(...frames.fade);
      assert.ok(slowest < FADE_FRAME_LIMIT, `a frame of the fade took ${Math.round(slowest)} ms: ${frames.fade.map(Math.round).join(' ')}`);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), before);
      t.diagnostic(`${theme} ${width}: switch ${Math.round(frames.wall)} ms, fade frames ${frames.fade.map(Math.round).join(' ')}`);
      await page.close();
    });
  }
});

const fading = () => document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'));
const notFading = () => !document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'));

test('a change of the system colour scheme fades without showing the new colours first, and a press during the fade ends it and keeps the settings open', async (t) => {
  const dir = exampleBuild();
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await page.goto(`${origin}/2026-10/syntax/`);
  await page.evaluate(() => document.fonts.ready);
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.scheme), 'light');

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
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'system');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.scheme), 'dark');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), light);

  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);
  const option = (text) => page.locator('.bk-settings-options button', { hasText: new RegExp(`^\\s*${text}\\s*$`) });
  const dark = await option('深').boundingBox();
  await option('浅').click();
  await page.waitForFunction(fading);
  await page.mouse.click(dark.x + dark.width / 2, dark.y + dark.height / 2);
  assert.equal(await page.evaluate(fading), false);
  assert.equal(await page.evaluate(() => document.querySelector('.bk-settings').classList.contains('is-open')), true);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await option('深').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.scheme === 'dark');
});

test('changing the text spacing fades on the compositor in the essay and bento themes', async (t) => {
  const dir = exampleBuild();
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  for (const [theme, path] of [['essay', '/2026-10/syntax/'], ['bento', '/2026-10/activations/']]) for (const width of [1440, 375]) {
    await t.test(`${theme} at ${width} pixels with ${THROTTLE}x CPU throttling`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${origin}${path}`);
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('button', { name: '设置' }).click();
      await page.waitForFunction(() => document.querySelector('.bk-settings').getAnimations({ subtree: true }).length === 0);
      const before = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const frames = await page.evaluate(async () => {
        const times = [];
        let faded = -1;
        let running = true;
        const tick = (time) => {
          times.push(time);
          if (faded < 0 && document.getAnimations().some((animation) => String(animation.effect?.pseudoElement).startsWith('::view-transition'))) faded = times.length - 1;
          if (running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const start = performance.now();
        document.querySelector('.bk-settings-row[data-setting="spacing"] button[data-value="loose"]').click();
        while (document.documentElement.dataset.spacing !== 'loose' || document.getAnimations().some((animation) => animation.playState === 'running' && String(animation.effect?.pseudoElement).startsWith('::view-transition'))) {
          await new Promise((done) => setTimeout(done, 20));
        }
        const end = performance.now();
        await new Promise((done) => setTimeout(done, 100));
        running = false;
        const gaps = times.slice(1).map((time, index) => time - times[index]);
        return { wall: end - start, faded, fade: gaps.slice(faded + 1) };
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      assert.ok(frames.faded >= 0, 'the spacing change did not fade');
      const slowest = Math.max(...frames.fade);
      assert.ok(slowest < FADE_FRAME_LIMIT, `a frame of the fade took ${Math.round(slowest)} ms: ${frames.fade.map(Math.round).join(' ')}`);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-article p')).lineHeight), before);
      t.diagnostic(`${theme} ${width}: change ${Math.round(frames.wall)} ms, fade frames ${frames.fade.map(Math.round).join(' ')}`);
      await page.close();
    });
  }
});
