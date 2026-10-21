import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog, decodeImage } from '../blog.js';
import { launchBrowser, serve, settle } from './browser.js';

const config = "export default { title: '测试博客', url: 'https://example.com', language: 'zh-CN' };\n";
const motionBox = `export const layout = { height: 80 };

export default class MotionBox extends HTMLElement {
  connectedCallback() {
    this.style.transition = 'opacity 0.25s';
    this.innerHTML = '<span style="transition: opacity 0.3s">动效</span>';
  }
}
`;
const body = ['正文第一段，说明**激活函数**的作用。', '', ':::motion-box', ':::', '', '## 门控单元', '', '门控单元把两路投影逐元素相乘。', '', '### 小节', '', '小节里的正文。', ''].join('\n');

const sharedShadowLayers = (light, dark) => {
  const layers = (shadow) => shadow.split(/,\s*(?![^(]*\))/);
  return layers(light).filter((layer) => layers(dark).includes(layer));
};

function readPage() {
  return {
    background: getComputedStyle(document.body).backgroundColor,
    bodyFont: getComputedStyle(document.querySelector('.bk-article p')).fontFamily,
    titleFont: getComputedStyle(document.querySelector('.bk-title')).fontFamily,
  };
}

function chosenOptions() {
  return [...document.querySelectorAll('.bk-settings-options button[aria-pressed="true"]')].map((button) => button.getAttribute('aria-label') ?? button.textContent.trim());
}

async function choose(page, name) {
  const option = page.locator('.bk-settings-panel').getByRole('button', { name, exact: true });
  await option.click();
  await page.waitForFunction((element) => element.getAttribute('aria-pressed') === 'true', await option.elementHandle());
  await settle(page);
}

async function chooseWithFade(page, name) {
  await page.evaluate(() => {
    window.faded = false;
    const watch = () => {
      if (document.getAnimations().some((animation) => String(animation.effect?.pseudoElement).startsWith('::view-transition'))) window.faded = true;
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await choose(page, name);
  assert.equal(await page.evaluate(() => window.faded), true, `choosing ${name} does not fade`);
}

async function readSettledPage(page) {
  await settle(page);
  return page.evaluate(readPage);
}

const wenkaiFolder = dirname(createRequire(import.meta.url).resolve('lxgw-wenkai-webfont/lxgwwenkai-regular.css'));

function cjkFontWithThreeWeights() {
  return [
    ['light', 300],
    ['regular', 400],
    ['bold', 500],
  ]
    .map(([file, weight]) =>
      readFileSync(join(wenkaiFolder, `lxgwwenkai-${file}.css`), 'utf8')
        .replaceAll("font-family: 'LXGW WenKai'", "font-family: 'PingFang SC'")
        .replace(/font-weight: \d+/g, `font-weight: ${weight}`)
        .replaceAll("url('./files/", "url('/__cjk-font/"),
    )
    .join('\n');
}

async function darkPixels(png) {
  const image = await decodeImage(png);
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) if (image.data[index] + image.data[index + 1] + image.data[index + 2] < 384) count += 1;
  return count;
}

test('reader settings', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': config, 'content/posts/gate/index.md': article({ title: '门控激活函数', slug: 'gate', body }), 'components/motion-box.js': motionBox });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const url = `${await serve(t, join(dir, 'dist'))}/2026-10/gate/`;
  const browser = await launchBrowser();

  await t.test('the panel opens from the settings button and closes on Escape and on a click outside', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const panel = page.locator('.bk-settings-panel');
    assert.equal(await panel.isVisible(), false);
    await page.getByRole('button', { name: '设置' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).opacity === '1');
    assert.deepEqual(await panel.locator('.bk-settings-label').allTextContents(), ['目录样式', '主题', '字号', '字重', '间距', '字体', '按钮']);
    const styles = await panel.locator('[role="radiogroup"]').evaluate((group) => ({
      label: document.getElementById(group.getAttribute('aria-labelledby')).textContent,
      choices: [...group.querySelectorAll('[role="radio"]')].map((choice) => [choice.querySelector('svg').getBoundingClientRect().width, choice.querySelector('b').textContent, choice.querySelector('small').textContent, choice.getAttribute('aria-checked')]),
    }));
    assert.deepEqual(styles, {
      label: '目录样式',
      choices: [
        [28, '前文笔记', 'T1 · 默认', 'true'],
        [28, '书签索引', 'T2', 'false'],
        [28, '圆点胶囊', 'T3', 'false'],
        [28, '刻度线', 'T4', 'false'],
      ],
    });
    assert.deepEqual(await panel.locator('.bk-settings-row[data-setting="theme"] button').allTextContents(), ['跟随系统', '浅', '深']);
    const heights = await panel.evaluate((element) => {
      const height = (selector) => Math.round(element.querySelector(selector).getBoundingClientRect().height * 100) / 100;
      return { label: height('.bk-settings-label'), choice: height('.bk-settings-choice'), option: height('.bk-settings-options button') };
    });
    assert.deepEqual(heights, { label: 17.25, choice: 48.75, option: 26.75 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).visibility === 'hidden');
    await page.getByRole('button', { name: '设置' }).click();
    await page.mouse.click(700, 300);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).visibility === 'hidden');
    await page.close();
  });

  await t.test('the home link and the settings button stack in a round pill from 1000 pixels up and in a tab on the left edge of a phone, labelled without visible text', async () => {
    const page = await browser.newPage();
    const read = () =>
      page.evaluate(() => {
        const button = document.querySelector('.bk-settings-toggle');
        const box = button.getBoundingClientRect();
        const home = document.querySelector('.bk-settings-home').getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          box: [box.left, innerHeight - box.bottom, box.width, box.height],
          home: [home.left, innerHeight - home.bottom, home.width, home.height],
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
      assert.deepEqual(await read(), { box: [16, 16, 34, 34], home: [16, 50, 34, 34], radius: '17px', ...expected }, `at ${width} pixels`);
    }
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(url);
    assert.deepEqual(await read(), { box: [0, 24, 40, 38], home: [0, 62, 40, 38], radius: '0px 11px 11px 0px', ...expected });
    const color = () => page.locator('.bk-settings-toggle').evaluate((button) => getComputedStyle(button).color);
    assert.equal(await color(), 'rgb(22, 26, 29)');
    await page.hover('.bk-settings-toggle');
    assert.equal(await color(), 'rgb(22, 26, 29)');
    await page.close();
  });

  await t.test('theme and font change the page at once, survive a reload and are applied before the page script runs', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    const initial = await readSettledPage(page);
    assert.deepEqual((await page.evaluate(chosenOptions)).slice(0, 1), ['跟随系统']);
    assert.equal(initial.titleFont, initial.bodyFont);

    await page.getByRole('button', { name: '设置' }).click();
    await choose(page, '深');
    const font = page.locator('.bk-settings-font');
    await font.fill('LXGW "WenKai\\');
    await font.press('Enter');
    const chosen = await readSettledPage(page);
    assert.notEqual(chosen.background, initial.background);
    assert.match(chosen.bodyFont, /^"LXGW WenKai", "PingFang SC"/);
    assert.equal(chosen.titleFont, chosen.bodyFont);
    assert.equal(await font.inputValue(), 'LXGW WenKai');

    await page.reload();
    assert.deepEqual(await readSettledPage(page), chosen);
    assert.deepEqual((await page.evaluate(chosenOptions)).slice(0, 1), ['深']);
    assert.equal(await font.inputValue(), 'LXGW WenKai');

    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    assert.deepEqual(await page.evaluate(readPage), chosen);
    assert.equal(await page.locator('.bk-settings').count(), 0);
    await page.unroute('**/assets/*.js');

    await page.reload();
    await page.getByRole('button', { name: '设置' }).click();
    await choose(page, '跟随系统');
    await font.fill('');
    await font.press('Enter');
    assert.deepEqual(await readSettledPage(page), initial);
    await context.close();
  });


  await t.test('text size, weight and spacing change the article text with a fade, survive a reload and leave components alone', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
    const page = await context.newPage();
    await page.goto(url);
    const read = () =>
      page.evaluate(() => {
        const style = (selector) => getComputedStyle(document.querySelector(selector));
        const paragraph = style('.bk-article p');
        const strong = style('.bk-article strong');
        const box = style('.component-box');
        return {
          paragraph: [paragraph.fontSize, paragraph.fontWeight, paragraph.lineHeight, paragraph.marginBottom],
          heading: style('.bk-article h2').fontSize,
          strong: [strong.fontWeight, strong.color],
          ink: paragraph.color,
          component: [box.fontSize, box.fontWeight, box.lineHeight],
        };
      });
    const initial = await read();
    assert.deepEqual(initial.paragraph, ['16.5px', '400', '30.525px', '16px']);
    assert.equal(initial.strong[0], '700');

    await page.getByRole('button', { name: '设置' }).click();
    const panel = page.locator('.bk-settings-panel');
    assert.deepEqual(await panel.locator('.bk-settings-row[data-setting="size"] button').evaluateAll((buttons) => buttons.map((button) => [button.textContent, button.getAttribute('aria-label')])), [
      ['A', '小'],
      ['A', '标准'],
      ['A', '大'],
      ['A', '特大'],
    ]);
    assert.deepEqual(await panel.locator('.bk-settings-row[data-setting="weight"] button').allTextContents(), ['细', '常规', '粗']);
    assert.deepEqual(await panel.locator('.bk-settings-row[data-setting="spacing"] button').allTextContents(), ['紧凑', '标准', '宽松']);
    const box = await panel.boundingBox();
    assert.ok(box.y >= 0, `the settings panel starts ${box.y} pixels above the screen`);

    await chooseWithFade(page, '特大');
    await chooseWithFade(page, '粗');
    await chooseWithFade(page, '宽松');
    const chosen = await read();
    assert.equal(chosen.paragraph[0], '19.47px');
    assert.equal(chosen.paragraph[1], '500');
    assert.ok(parseFloat(chosen.paragraph[2]) / parseFloat(chosen.paragraph[0]) > 2, `line height ${chosen.paragraph[2]} at ${chosen.paragraph[0]}`);
    assert.ok(parseFloat(chosen.paragraph[3]) > parseFloat(initial.paragraph[3]));
    assert.ok(parseFloat(chosen.heading) > parseFloat(initial.heading));
    assert.equal(chosen.strong[0], '800');
    assert.notEqual(chosen.strong[1], chosen.ink);
    assert.deepEqual(chosen.component, initial.component);

    await page.reload();
    await settle(page);
    assert.deepEqual(await read(), chosen);

    await context.close();
  });

  await t.test('each weight step changes the ink of Chinese body text when the sans stack finds a CJK font with light, regular and medium faces', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
    await context.route('**/__cjk-font/*', (route) => route.fulfill({ path: join(wenkaiFolder, 'files', new URL(route.request().url()).pathname.split('/').pop()), contentType: 'font/woff2' }));
    const page = await context.newPage();
    const fontCss = cjkFontWithThreeWeights();
    const measure = async (weight) => {
      await page.getByRole('button', { name: '设置' }).click();
      await choose(page, weight);
      await page.keyboard.press('Escape');
      await settle(page);
      const paragraph = page.locator('.bk-article p', { hasText: '门控单元把两路投影逐元素相乘。' });
      const computed = await paragraph.evaluate(async (element) => {
        const style = getComputedStyle(element);
        await document.fonts.load(`${style.fontWeight} ${style.fontSize} "PingFang SC"`, element.textContent);
        await document.fonts.ready;
        return style.fontWeight;
      });
      await settle(page);
      return { computed, ink: await darkPixels(await paragraph.screenshot()) };
    };
    await page.goto(url);
    await page.addStyleTag({ content: fontCss });
    const light = await measure('细');
    const regular = await measure('常规');
    const bold = await measure('粗');
    assert.deepEqual([light.computed, regular.computed, bold.computed], ['300', '400', '500']);
    assert.ok(light.ink < regular.ink && regular.ink < bold.ink, `Chinese body text has ${light.ink}, ${regular.ink} and ${bold.ink} dark pixels at the light, regular and bold steps`);
    await context.close();
  });

  await t.test('the settings panel with every row stays inside a short phone screen', async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 450 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: '设置' }).click();
    const panel = page.locator('.bk-settings-panel');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).opacity === '1');
    const box = await panel.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 450, `the panel spans ${box.y} to ${box.y + box.height}`);
    await panel.locator('.bk-settings-row[data-setting="buttons"]').scrollIntoViewIfNeeded();
    const toggle = panel.getByRole('switch');
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await context.close();
  });

  await t.test('the shadows of the settings buttons, the chosen option and the switch follow dark mode', async () => {
    const shadows = {};
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ colorScheme });
      await page.goto(url);
      shadows[colorScheme] = await page.evaluate(() => [
        getComputedStyle(document.querySelector('.bk-settings-buttons')).boxShadow,
        getComputedStyle(document.querySelector('.bk-settings-options button[aria-pressed="true"]'), '::before').boxShadow,
        getComputedStyle(document.querySelector('.bk-settings-switch i'), '::after').boxShadow,
      ]);
      await page.close();
    }
    const shared = ['button', 'option', 'switch'].map((name, index) => [name, sharedShadowLayers(shadows.light[index], shadows.dark[index])]);
    assert.deepEqual(shared, [['button', []], ['option', []], ['switch', []]]);
  });

  await t.test('with reduced motion the settings panel and the toast only fade, and components keep their own transitions', async () => {
    const context = await browser.newContext({ reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('motion-box span').waitFor();
    const motion = (selector) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        const durations = style.transitionDuration.split(', ');
        const properties = style.transitionProperty.split(', ');
        return { opacity: durations[properties.indexOf('opacity')] ?? null, translate: style.translate, transformY: new DOMMatrix(style.transform).m42 };
      });
    const fade = (shown) => shown.opacity !== null && parseFloat(shown.opacity) > 0 && ['0px', 'none'].includes(shown.translate) && shown.transformY === 0;
    const panel = await motion('.bk-settings-panel');
    assert.ok(fade(panel), `the closed panel has ${JSON.stringify(panel)}`);
    await page.getByRole('button', { name: '设置' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).opacity === '1');
    const open = await motion('.bk-settings-panel');
    assert.ok(fade(open), `the open panel has ${JSON.stringify(open)}`);
    await page.keyboard.press('Escape');
    const toast = await motion('.bk-toast');
    assert.ok(fade(toast), `the toast has ${JSON.stringify(toast)}`);
    await page.hover('.bk-article h2');
    await page.click('.bk-article h2 .bk-heading-link');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-toast')).opacity !== '0');
    const shown = await motion('.bk-toast');
    assert.ok(fade(shown), `the shown toast has ${JSON.stringify(shown)}`);
    assert.deepEqual(
      await page.evaluate(() => [document.querySelector('motion-box'), document.querySelector('motion-box span')].map((element) => getComputedStyle(element).transitionDuration)),
      ['0.25s', '0.3s'],
    );
    await context.close();
  });

});
