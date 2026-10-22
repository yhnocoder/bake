import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { article, validConfig } from '../blog.js';
import { expect, test } from './browser.js';

const pages = ['index.html', '2026-10/syntax/index.html', '2026-10/jacobian/index.html', '2026-09/llm-act-fns/index.html', '2026-09/matrix-calculus/index.html', '2026-10/activations/index.html'];

test.describe('a small blog', () => {
  test.use({
    blog: {
      example: false,
      files: {
        'bake.config.js': validConfig,
        'components/demo-box.js': 'export const layout = { height: 120 };\n\nexport default class DemoBox extends HTMLElement {}\n',
        'content/posts/rope/index.md': article({ body: 'A paragraph with a note.[^a]\n\n:::demo-box\n:::\n\n[^a]: The note.\n' }),
      },
    },
  });

  test('a page opened from a file address looks like the served page without scripts', async ({ browser, site }) => {
    const look = async (url) => {
      const page = await browser.newPage({ javaScriptEnabled: !url.startsWith('http') });
      await page.goto(url);
      const result = await page.evaluate(() => {
        const paragraph = document.querySelector('.bk-article .bk-block[data-type="paragraph"]');
        const note = document.querySelector('.bk-article .bk-sidenote[data-sidenote="1"]');
        return {
          background: getComputedStyle(document.body).backgroundColor,
          columnWidth: paragraph.getBoundingClientRect().width,
          noteVisible: note.checkVisibility(),
          noteBelowParagraph: note.getBoundingClientRect().top >= paragraph.getBoundingClientRect().bottom,
          copyVisible: document.querySelector('.bk-copy').checkVisibility(),
          frameText: getComputedStyle(document.querySelector('.component-box'), '::before').content,
        };
      });
      await page.close();
      return result;
    };
    const opened = await look(pathToFileURL(join(site.dir, 'dist/2026-10/rope/index.html')).href);
    expect(opened).toEqual(await look(`${site.origin}/2026-10/rope/`));
    expect(opened).toMatchObject({ noteVisible: true, noteBelowParagraph: true, copyVisible: false, frameText: '"This interactive figure needs JavaScript"' });
  });

  test('the homepage opened from a file address hides the controls that need scripts', async ({ page, site }) => {
    await page.goto(pathToFileURL(join(site.dir, 'dist/index.html')).href);
    await expect(page.locator('.bk-home-controls')).toBeHidden();
  });
});

for (const width of [1440, 375]) {
  test(`the homepage and the articles of the example blog opened from file addresses at ${width} pixels load every stylesheet, font and image`, async ({ page, site }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      const failed = [];
      const listen = (request) => {
        if (request.resourceType() !== 'script') failed.push(`${request.resourceType()} ${request.url()} ${request.failure()?.errorText}`);
      };
      const console = (message) => {
        if (message.type() === 'error' && !/^Access to script at .* has been blocked by CORS policy|^Failed to load resource: net::ERR_FAILED$/.test(message.text())) failed.push(message.text());
      };
      page.on('requestfailed', listen);
      page.on('console', console);
      await page.goto(pathToFileURL(join(site.dir, 'dist', path)).href);
      const state = await page.evaluate(async () => {
        for (const image of document.images) image.loading = 'eager';
        await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
        await document.fonts.ready;
        return {
          brokenImages: [...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.src),
          visibleControls: [...document.querySelectorAll('button, input, select')].filter((control) => control.checkVisibility()).length,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      page.off('requestfailed', listen);
      page.off('console', console);
      expect({ ...state, failed }, path).toEqual({ brokenImages: [], visibleControls: 0, overflow: false, failed: [] });
    }
  });
}
