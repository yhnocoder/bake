import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from '../blog.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#985b57"/></svg>';

test('figures with a pixel or percent width have that width, stay inside the screen and are centred in the column', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/rope/index.md': article({ body: '![](plot.svg){width=560px}\n\n![](plot.svg){width=70%}\n' }),
    'content/posts/rope/plot.svg': svg,
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const measured = {};
  for (const width of [1100, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(pathToFileURL(join(dir, 'dist/2026-10/rope/index.html')).href);
    measured[width] = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const box = document.body.getBoundingClientRect();
      const left = box.left + parseFloat(style.paddingLeft);
      const column = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return {
        column,
        figures: [...document.querySelectorAll('figure')].map((figure) => {
          const frame = figure.getBoundingClientRect();
          const image = figure.querySelector('img').getBoundingClientRect();
          return { width: frame.width, offset: frame.left - left + frame.width / 2 - column / 2, image: [image.width, image.height] };
        }),
      };
    });
    await page.close();
  }

  const expected = { 1100: [560, 0.7], 375: [null, 0.7] };
  for (const [viewport, [pixels, fraction]] of Object.entries(expected)) {
    const { column, figures } = measured[viewport];
    const widths = [pixels ?? column, column * fraction];
    figures.forEach((figure, index) => {
      const label = `${viewport}px viewport, figure ${index + 1}`;
      assert.ok(Math.abs(figure.width - widths[index]) < 1, `${label}: width ${figure.width}, expected ${widths[index]}`);
      assert.ok(Math.abs(figure.offset) < 1, `${label}: centre is ${figure.offset}px off the column centre`);
      assert.ok(Math.abs(figure.image[0] - figure.width) < 1, `${label}: image width ${figure.image[0]}`);
      assert.ok(Math.abs(figure.image[1] - (figure.width * 200) / 320) < 1, `${label}: image height ${figure.image[1]}`);
    });
  }
});
