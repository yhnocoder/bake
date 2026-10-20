import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { bake } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const THROTTLE = 4;
const FADE_FRAME_LIMIT = 150;

test('switching the theme restyles the page once and fades on the compositor', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-theme-switch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  for (const width of [1440, 375]) {
    await t.test(`at ${width} pixels with ${THROTTLE}x CPU throttling`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${origin}/2026-10/syntax/`);
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
      t.diagnostic(`${width}: switch ${Math.round(frames.wall)} ms, fade frames ${frames.fade.map(Math.round).join(' ')}`);
      await page.close();
    });
  }
});
