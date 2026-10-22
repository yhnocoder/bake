import { article } from '../blog.js';
import { expect, test } from './browser.js';

const config = `export default {
  title: '测试博客',
  url: 'https://example.com',
  language: 'zh-CN',
};
`;

test.use({
  blog: {
    example: false,
    files: {
      'bake.config.js': config,
      'content/posts/rope/index.md': article({ title: '旋转位置编码', slug: 'rope', date: '2026-10-14' }),
      'content/posts/rope-notes/index.md': article({ title: '旋转笔记', slug: 'rope-notes', date: '2026-09-02' }),
      'content/posts/draft/index.md': article({ title: '草稿', slug: 'draft', date: '2026-10-01', extra: 'draft: true\n' }),
      'content/posts/demo/index.md': '---\ntitle: 演示\nslug: demo\ndate: 2026-08-01\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<!doctype html>\n<html lang="zh-CN">\n<head>\n<link rel="stylesheet" href="../../_bake/theme.css">\n</head>\n<body>\n<p>演示</p>\n</body>\n</html>\n',
    },
  },
});

const look = (page) =>
  page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily,
  }));

async function articleLook(browser, origin, colorScheme) {
  const page = await browser.newPage({ colorScheme });
  await page.goto(`${origin}/2026-10/rope/`);
  const result = await look(page);
  await page.close();
  return result;
}

function shownMatches(page) {
  return page.evaluate(() => ({
    path: document.querySelector('.bk-not-found-path').checkVisibility() ? document.querySelector('.bk-not-found-path').textContent : null,
    matches: [...document.querySelectorAll('.bk-not-found-matches li')].filter((item) => item.checkVisibility()).map((item) => item.querySelector('a').getAttribute('href')),
  }));
}

test('a missing address at any depth answers 404 with the look of the site and lists the article with the same slug from another month', async ({ page, browser, site }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/2026-01/rope/');
  expect(response.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('这个页面不存在');
  expect(await shownMatches(page)).toEqual({ path: '/2026-01/rope/', matches: ['/2026-10/rope/'] });
  expect(await look(page)).toEqual(await articleLook(browser, site.origin, 'light'));
  await page.getByRole('link', { name: '旋转位置编码' }).click();
  await expect(page.locator('h1.bk-title')).toHaveText('旋转位置编码');
  expect(errors).toEqual([]);
});

test('an address deeper in the site, one with an unknown slug and the address of a draft list no article', async ({ page }) => {
  for (const path of ['/2026-01/unknown/', '/a/b/c/missing.png', '/2026-10/draft/']) {
    await page.goto(path);
    expect(await shownMatches(page)).toEqual({ path, matches: [] });
    await expect(page.locator('.bk-not-found-matches')).toBeHidden();
  }
});

test('the settings panel of the 404 page offers the theme and the font', async ({ page }) => {
  await page.goto('/2026-01/rope/');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.bk-settings-label')).toHaveText(['主题', '字体']);
});

test('without scripts the 404 page shows the heading and the link home', async ({ browser, site }) => {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(`${site.origin}/2026-01/rope/`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link', { name: '回到首页 →' })).toBeVisible();
  await expect(page.locator('.bk-not-found-path')).toBeHidden();
  await expect(page.locator('.bk-not-found-matches')).toBeHidden();
  await page.close();
});

test('a plain HTML page that links the theme stylesheet gets the colours, the fonts and dark mode of the site', async ({ page, browser, site }) => {
  await page.goto('/2026-08/demo/');
  const light = await articleLook(browser, site.origin, 'light');
  const dark = await articleLook(browser, site.origin, 'dark');
  expect(await look(page)).toEqual(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await look(page)).toEqual(dark);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  expect(await look(page)).toEqual(light);
});
