import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const config = "export default { title: '测试博客', url: 'https://example.com', language: 'zh-CN' };\n";
const body = ['正文第一段，说明激活函数的作用。', '', '## 门控单元', '', '门控单元把两路投影逐元素相乘。', '', '### 小节', '', '小节里的正文。', ''].join('\n');

function readPage() {
  return {
    theme: document.documentElement.dataset.theme ?? null,
    font: document.documentElement.dataset.font ?? null,
    background: getComputedStyle(document.body).backgroundColor,
    bodyFont: getComputedStyle(document.querySelector('.bk-article p')).fontFamily,
    stored: [localStorage.getItem('bk-theme'), localStorage.getItem('bk-font')],
  };
}

async function readSettledPage(page) {
  await page.waitForFunction(() => document.body.getAnimations().length === 0);
  return page.evaluate(readPage);
}

function wenkaiFaces() {
  const family = (value) => value.replaceAll('"', '').trim();
  const covers = (range, code) =>
    range.split(',').some((part) => {
      const [start, end = start] = part.trim().replace(/^U\+/i, '').split('-');
      const low = parseInt(start.replaceAll('?', '0'), 16);
      const high = parseInt((start.includes('?') ? start.replaceAll('?', 'F') : end).replace(/^U\+/i, ''), 16);
      return code >= low && code <= high;
    });
  const shown = new Set();
  for (const element of document.body.querySelectorAll('*')) {
    if (!getComputedStyle(element).fontFamily.split(',').some((name) => family(name) === 'LXGW WenKai')) continue;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) for (const character of node.textContent.trim()) shown.add(character.codePointAt(0));
    }
  }
  const loaded = [...document.fonts].filter((face) => family(face.family) === 'LXGW WenKai' && face.status === 'loaded');
  return {
    shown: shown.size,
    loaded: loaded.length,
    unused: loaded.filter((face) => ![...shown].some((code) => covers(face.unicodeRange, code))).map((face) => face.unicodeRange.slice(0, 40)),
  };
}

test('reader settings', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': config, 'content/posts/gate/index.md': article({ title: '门控激活函数', slug: 'gate', body }) });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const url = `${await serve(t, join(dir, 'dist'))}/2026-10/gate/`;
  const browser = await chromium.launch();
  t.after(() => browser.close());

  await t.test('the panel opens from the settings button and closes on Escape and on a click outside', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const panel = page.locator('.bk-settings-panel');
    assert.equal(await panel.isVisible(), false);
    await page.getByRole('button', { name: '设置' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).opacity === '1');
    assert.deepEqual(await panel.locator('.bk-settings-label').allTextContents(), ['目录', '主题', '正文', '按钮']);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).visibility === 'hidden');
    await page.getByRole('button', { name: '设置' }).click();
    await page.mouse.click(700, 300);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).visibility === 'hidden');
    await page.close();
  });

  await t.test('the settings button is a round gear from 1000 pixels up and a tab on the left edge of a phone, labelled without visible text', async () => {
    const page = await browser.newPage();
    const read = () =>
      page.evaluate(() => {
        const button = document.querySelector('.bk-settings-toggle');
        const box = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          box: [box.left, innerHeight - box.bottom, box.width, box.height],
          radius: style.borderRadius,
          text: button.textContent.trim(),
          label: [button.getAttribute('aria-label'), button.title],
          icon: button.querySelector('svg').getBoundingClientRect().width,
        };
      });
    const expected = { text: '', label: ['设置', '设置'], icon: 17 };
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url);
      assert.deepEqual(await read(), { box: [16, 16, 34, 34], radius: '17px', ...expected }, `at ${width} pixels`);
    }
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(url);
    assert.deepEqual(await read(), { box: [0, 24, 40, 38], radius: '0px 11px 11px 0px', ...expected });
    const before = await page.locator('.bk-settings-toggle').evaluate((button) => getComputedStyle(button).color);
    await page.hover('.bk-settings-toggle');
    await page.waitForFunction((color) => getComputedStyle(document.querySelector('.bk-settings-toggle')).color !== color, before);
    await page.close();
  });

  await t.test('theme and body font change the page at once, survive a reload and are applied before the page script runs', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    const initial = await readSettledPage(page);
    assert.deepEqual([initial.theme, initial.font, initial.stored], ['system', 'sans', [null, null]]);
    assert.doesNotMatch(initial.bodyFont, /LXGW WenKai/);

    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '深' }).click();
    await page.getByRole('button', { name: '霞鹜文楷' }).click();
    const chosen = await readSettledPage(page);
    assert.deepEqual([chosen.theme, chosen.font, chosen.stored], ['dark', 'wenkai', ['dark', 'wenkai']]);
    assert.notEqual(chosen.background, initial.background);
    assert.match(chosen.bodyFont, /^"?LXGW WenKai/);
    assert.equal(await page.getByRole('button', { name: '深' }).getAttribute('aria-pressed'), 'true');

    await page.reload();
    const reloaded = await readSettledPage(page);
    assert.deepEqual(reloaded, chosen);

    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    assert.deepEqual(
      await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.font, document.querySelector('.bk-settings')]),
      ['dark', 'wenkai', null],
    );
    await page.unroute('**/assets/*.js');

    await page.reload();
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '跟随系统' }).click();
    await page.getByRole('button', { name: '黑体' }).click();
    const reset = await readSettledPage(page);
    assert.deepEqual([reset.theme, reset.font, reset.stored, reset.background], ['system', 'sans', ['system', 'sans'], initial.background]);
    await context.close();
  });

  await t.test('the WenKai body font is downloaded only after the reader chooses it', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const before = await page.evaluate(wenkaiFaces);
    assert.ok(before.shown > 0, 'no text on the page uses LXGW WenKai');
    assert.deepEqual(before.unused, []);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '霞鹜文楷' }).click();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await page.evaluate(() => document.fonts.ready);
    const after = await page.evaluate(wenkaiFaces);
    assert.ok(after.loaded > before.loaded, `choosing 霞鹜文楷 loaded ${after.loaded} faces, as many as before`);
    await page.close();
  });
});
