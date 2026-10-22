import { article, validConfig } from '../blog.js';
import { expect, test } from './browser.js';

const svg = (width, height) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#985b57"/></svg>`;

test.use({
  blog: {
    example: false,
    files: {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: '![](plot.svg){width=560px}\n\n![](plot.svg){width=70%}\n' }),
      'content/posts/rope/plot.svg': svg(320, 200),
      'content/posts/wide/index.md': article({ slug: 'wide', body: '![](wide.svg)\n\n![](wide.svg){width=1000px}\n' }),
      'content/posts/wide/wide.svg': svg(1600, 400),
    },
  },
});

function measure(page) {
  return page.evaluate(() => {
    const column = document.querySelector('.bk-article').getBoundingClientRect();
    return {
      column: column.width,
      screen: document.documentElement.clientWidth,
      figures: [...document.querySelectorAll('figure')].map((figure) => {
        const frame = figure.getBoundingClientRect();
        const image = figure.querySelector('img').getBoundingClientRect();
        return { width: frame.width, right: frame.right, offset: frame.left + frame.width / 2 - (column.left + column.width / 2), ratio: image.width / image.height };
      }),
    };
  });
}

for (const width of [1440, 1100, 375]) {
  test(`at ${width} pixels a figure with a pixel or percent width has that width within the screen, centred in the body column, and keeps the proportions of its image`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/2026-10/rope/');
    const { column, screen, figures } = await measure(page);
    const expected = [Math.min(560, column), column * 0.7];
    figures.forEach((figure, index) => {
      expect(figure.width).toBeCloseTo(expected[index], 0);
      expect(Math.abs(figure.offset)).toBeLessThan(1);
      expect(figure.right).toBeLessThanOrEqual(screen);
      expect(figure.ratio).toBeCloseTo(320 / 200, 1);
    });
  });
}

test('a figure without a size stays inside the body column however wide its image is, and only a written pixel width makes it wider', async ({ page }) => {
  await page.goto('/2026-10/wide/');
  const { column, figures } = await measure(page);
  expect(figures[0].width).toBeCloseTo(column, 0);
  expect(figures[1].width).toBeCloseTo(1000, 0);
});
