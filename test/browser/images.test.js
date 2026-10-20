import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { launchBrowser, serve } from './browser.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#985b57"/></svg>';

test('figure widths', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/rope/index.md': article({ body: '![](plot.svg){width=560px}\n\n![](plot.svg){width=70%}\n' }),
    'content/posts/rope/plot.svg': svg,
    'content/posts/wide/index.md': article({ slug: 'wide', body: '![](wide.svg)\n\n![](wide.svg){width=1000px}\n' }),
    'content/posts/wide/wide.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#985b57"/></svg>',
  });
  assert.equal(bake(dir, 'build').stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await launchBrowser();

  await t.test('figures with a pixel or percent width have that width, stay inside the screen and are centred in the body column, and the image fills the frame', async () => {
    const measured = {};
    for (const width of [1440, 1100, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`${origin}/2026-10/rope/`);
      measured[width] = await page.evaluate(() => {
        const { left, width: column } = document.querySelector('.bk-article').getBoundingClientRect();
        return {
          column,
          viewport: document.documentElement.clientWidth,
          figures: [...document.querySelectorAll('figure')].map((figure) => {
            const frame = figure.getBoundingClientRect();
            const style = getComputedStyle(figure);
            const inner = frame.width - ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, name) => sum + parseFloat(style[name]), 0);
            const image = figure.querySelector('img').getBoundingClientRect();
            return { width: frame.width, inner, right: frame.right, offset: frame.left - left + frame.width / 2 - column / 2, image: [image.width, image.height] };
          }),
        };
      });
      await page.close();
    }

    const expected = { 1440: [560, 0.7], 1100: [560, 0.7], 375: [null, 0.7] };
    for (const [viewport, [pixels, fraction]] of Object.entries(expected)) {
      const { column, viewport: screen, figures } = measured[viewport];
      const widths = [pixels ?? column, column * fraction];
      figures.forEach((figure, index) => {
        const label = `${viewport}px viewport, figure ${index + 1}`;
        assert.ok(Math.abs(figure.width - widths[index]) < 1, `${label}: width ${figure.width}, expected ${widths[index]}`);
        assert.ok(Math.abs(figure.offset) < 1, `${label}: centre is ${figure.offset}px off the column centre`);
        assert.ok(figure.right <= screen, `${label}: the frame ends at ${figure.right}px on a ${screen}px screen`);
        assert.ok(Math.abs(figure.image[0] - figure.inner) < 1, `${label}: image width ${figure.image[0]}, frame content width ${figure.inner}`);
        assert.ok(Math.abs(figure.image[1] - (figure.inner * 200) / 320) < 1, `${label}: image height ${figure.image[1]}`);
      });
    }
  });

  await t.test('a figure without a size stays inside the body column however wide its image is, and only a written pixel width makes it wider', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    await page.goto(`${origin}/2026-10/wide/`);
    const { column, figures } = await page.evaluate(() => ({
      column: document.querySelector('.bk-article').getBoundingClientRect().width,
      figures: [...document.querySelectorAll('figure')].map((figure) => Math.round(figure.getBoundingClientRect().width)),
    }));
    assert.equal(Math.round(column), 820);
    assert.deepEqual(figures, [820, 1000]);
    await page.close();
  });
});
