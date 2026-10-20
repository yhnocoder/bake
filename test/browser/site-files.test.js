import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const config = `export default {
  title: '测试博客',
  url: 'https://example.com',
  language: 'zh-CN',
};
`;

const files = {
  'bake.config.js': config,
  'content/posts/rope/index.md': article({ title: '旋转位置编码', slug: 'rope', date: '2026-10-14' }),
  'content/posts/rope-notes/index.md': article({ title: '旋转笔记', slug: 'rope-notes', date: '2026-09-02' }),
  'content/posts/draft/index.md': article({ title: '草稿', slug: 'draft', date: '2026-10-01', extra: 'draft: true\n' }),
  'content/posts/demo/index.md': '---\ntitle: 演示\nslug: demo\ndate: 2026-08-01\npage: demo.html\n---\n',
  'content/posts/demo/demo.html': '<!doctype html>\n<html lang="zh-CN">\n<head>\n<link rel="stylesheet" href="../../_bake/theme.css">\n</head>\n<body>\n<p>演示</p>\n</body>\n</html>\n',
};

test('the 404 page and the theme stylesheet', async (t) => {
  const dir = createBlog(t, files);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const open = async (path, options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(`${origin}${path}`);
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors, response };
  };
  const visible = (page) =>
    page.evaluate(() => ({
      path: document.querySelector('.bk-not-found-path').hidden ? null : document.querySelector('.bk-not-found-path').textContent,
      matches: document.querySelector('.bk-not-found-matches').hidden
        ? []
        : [...document.querySelectorAll('.bk-not-found-matches li')].filter((item) => !item.hidden).map((item) => item.querySelector('a').getAttribute('href')),
    }));

  await t.test('a missing address at any depth loads the styles and lists the article with the same slug from another month', async () => {
    const { context, page, errors, response } = await open('/2026-01/rope/');
    assert.equal(response.status(), 404);
    assert.equal(await page.locator('h1').textContent(), '这个页面不存在');
    assert.deepEqual(await visible(page), { path: '/2026-01/rope/', matches: ['/2026-10/rope/'] });
    const look = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      heading: getComputedStyle(document.querySelector('h1')).fontFamily,
    }));
    assert.equal(look.background, 'rgb(245, 246, 244)');
    assert.match(look.heading, /LXGW WenKai/);
    await page.getByRole('link', { name: '旋转位置编码' }).click();
    await page.waitForURL(`${origin}/2026-10/rope/`);
    assert.equal(await page.locator('h1.bk-title').textContent(), '旋转位置编码');
    assert.deepEqual(errors, []);
    await context.close();
  });

  await t.test('the 404 page centres its content in a column in the middle of the screen at 1440 and 375 pixels in both schemes', async () => {
    for (const [width, height] of [
      [1440, 900],
      [375, 760],
    ]) {
      for (const colorScheme of ['light', 'dark']) {
        const { context, page } = await open('/2026-01/rope/', { viewport: { width, height }, colorScheme });
        const layout = await page.evaluate(() => {
          const box = (selector) => document.querySelector(selector).getBoundingClientRect();
          const title = box('.bk-not-found-title');
          const home = box('.bk-not-found-home');
          const column = box('.bk-not-found-matches');
          const style = getComputedStyle(document.querySelector('.bk-not-found'));
          return {
            top: title.top,
            bottom: home.bottom,
            gutters: [column.left, document.documentElement.clientWidth - column.right],
            scrollWidth: document.documentElement.scrollWidth,
            padding: parseFloat(style.paddingLeft),
          };
        });
        const at = `${colorScheme} at ${width}px`;
        assert.ok(layout.top >= height * 0.2, `${at}: the heading starts at ${layout.top}`);
        assert.ok(layout.bottom <= height * 0.8, `${at}: the link home ends at ${layout.bottom}`);
        assert.ok(Math.abs(layout.gutters[0] - layout.gutters[1]) <= 1, `${at}: the gutters are ${layout.gutters.join(' and ')}`);
        assert.ok(layout.gutters[0] >= 16, `${at}: the gutters are ${layout.gutters.join(' and ')}`);
        assert.equal(layout.scrollWidth, width);
        await context.close();
      }
    }
  });

  await t.test('an address deeper in the site and one with an unknown slug list no article', async () => {
    const { context, page } = await open('/2026-01/unknown/');
    assert.deepEqual(await visible(page), { path: '/2026-01/unknown/', matches: [] });
    assert.equal(await page.locator('.bk-not-found-matches').isVisible(), false);
    await page.goto(`${origin}/a/b/c/missing.png`);
    assert.deepEqual(await visible(page), { path: '/a/b/c/missing.png', matches: [] });
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily), /LXGW WenKai/);
    await page.goto(`${origin}/2026-10/draft/`);
    assert.deepEqual(await visible(page), { path: '/2026-10/draft/', matches: [] });
    await context.close();
  });

  await t.test('the 404 page applies the stored theme before its script runs and offers the theme and the body font in the settings panel', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('bk-theme', 'dark'));
    const page = await context.newPage();
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(`${origin}/2026-01/rope/`);
    assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]), ['dark', 'rgb(17, 20, 19)']);
    await page.unroute('**/assets/*.js');
    await page.reload();
    await page.click('.bk-settings-toggle');
    assert.deepEqual(await page.locator('.bk-settings-label').allTextContents(), ['主题', '正文']);
    await context.close();
  });

  await t.test('without scripts the 404 page shows the heading and the link home', async () => {
    const { context, page } = await open('/2026-01/rope/', { javaScriptEnabled: false });
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.getByRole('link', { name: '回到首页 →' }).isVisible(), true);
    assert.equal(await page.locator('.bk-not-found-path').isVisible(), false);
    assert.equal(await page.locator('.bk-not-found-matches').isVisible(), false);
    await context.close();
  });

  await t.test('a plain HTML page that links the theme stylesheet gets the colours, the fonts and dark mode', async () => {
    const { context, page } = await open('/2026-08/demo/');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 246, 244)');
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /PingFang SC/);
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 20, 19)');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 246, 244)');
    await context.close();
  });
});
