import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const config = "export default { title: '目录测试', url: 'https://example.com', language: 'zh-CN' };\n";
const STYLES = ['notes', 'tabs', 'dots', 'ticks'];
const filler = (topic, count = 5) => Array.from({ length: count }, (_, index) => `${topic}的第 ${index + 1} 段。${'这一段只是为了让页面足够长，读者需要滚动才能读完。'.repeat(8)}`).join('\n\n');

const body = [
  filler('引言', 2),
  '',
  '## 第一章 {#one}',
  '',
  ':::recap',
  '第一章的要点。',
  ':::',
  '',
  `第一章的第一句话。第一章的第二句话。`,
  '',
  filler('第一章'),
  '',
  '### 一之一 {#one-a}',
  '',
  ':::recap',
  '一之一的要点，含有 ==重点== 标记。',
  ':::',
  '',
  filler('一之一'),
  '',
  '### 一之二 {#one-b}',
  '',
  '一之二的第一句话有 ==重点== 标记和[链接](#one)。一之二的第二句话。',
  '',
  filler('一之二'),
  '',
  ...[2, 3, 4, 5, 6].flatMap((number) => [
    `## 第${number}章 {#chapter-${number}}`,
    '',
    `第${number}章的第一句话。第${number}章的第二句话。`,
    '',
    filler(`第${number}章`),
    '',
    `### 第${number}章的小节 {#chapter-${number}-a}`,
    '',
    filler(`第${number}章的小节`),
    '',
  ]),
].join('\n');

const longBody = Array.from(
  { length: 18 },
  (_, index) => `## Chapter ${index + 1} {#chapter-${index + 1}}\n\n${'A paragraph of the chapter. '.repeat(30)}\n\n:::page-box{width=page}\n:::\n\n### Part ${index + 1}.1\n\n${'A paragraph of the part. '.repeat(20)}\n\n### Part ${index + 1}.2\n\n${'A paragraph of the part. '.repeat(20)}\n`,
).join('\n');

const pageBox = `export const layout = { width: 'page', height: 160 };

export default class PageBox extends HTMLElement {
  connectedCallback() {
    this.textContent = 'A component as wide as the page.';
  }
}
`;

const VISIBLE_ENTRIES = {
  notes: '.bk-toc .bk-toc-chapter-title, .bk-toc .bk-toc-section-title',
  tabs: '.bk-tab, .bk-tab-title.is-on',
  dots: '.bk-dot-item',
  ticks: '.bk-tick',
};

function current(style) {
  const selector = {
    notes: '.bk-toc :is(.bk-toc-chapter[data-here] > .bk-toc-chapter-title, .bk-toc-section[data-state="current"] > .bk-toc-section-title)',
    rail: '.bk-ticks.is-rail .bk-tick.is-current',
    tabs: '.bk-tab.is-current',
    dots: '.bk-dot-item.is-current',
    ticks: '.bk-tick.is-current',
  }[style];
  const element = document.querySelector(selector);
  return element === null ? null : decodeURIComponent(element.getAttribute('href').slice(1));
}

function coveredEntries(selector) {
  const button = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
  return [...document.querySelectorAll(selector)]
    .filter((entry) => entry.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map((entry) => {
      const box = entry.getBoundingClientRect();
      const clip = entry.closest('.bk-toc-list')?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
      return { entry, box: { left: box.left, right: box.right, top: Math.max(box.top, clip.top, 0), bottom: Math.min(box.bottom, clip.bottom, innerHeight) } };
    })
    .filter(({ box }) => box.bottom > box.top)
    .filter(({ box }) => box.left < button.right && box.right > button.left && box.top < button.bottom && box.bottom > button.top)
    .map(({ entry }) => entry.getAttribute('href') ?? entry.className);
}

function cardReport(selector) {
  const card = document.querySelector(selector);
  const box = card.getBoundingClientRect();
  const button = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
  return {
    inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    clearOfSettings: box.bottom <= button.top || box.right <= button.left || box.left >= button.right,
    marks: card.querySelectorAll('mark').length,
    head: card.querySelector('.bk-toc-card-number').textContent,
    summary: card.querySelector('.bk-toc-card-chapter-recap, .bk-toc-card-chapter-lead')?.textContent ?? null,
    sections: [...card.querySelectorAll('.bk-toc-card-section')].map((row) => [row.querySelector('.bk-toc-card-section-title').textContent, row.querySelector('.bk-toc-card-recap, .bk-toc-card-lead')?.textContent ?? null]),
    readLabel: card.textContent.includes('读过'),
  };
}

const sharedShadowLayers = (light, dark) => {
  const layers = (shadow) => shadow.split(/,\s*(?![^(]*\))/);
  return layers(light).filter((layer) => layers(dark).includes(layer));
};

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let frame = 0; frame < 3; frame += 1) await new Promise((done) => requestAnimationFrame(done));
  });
}

async function pointAt(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
}

async function scrollToHeading(page, id) {
  await page.evaluate((target) => scrollTo(0, document.getElementById(target).getBoundingClientRect().top + scrollY - 60), id);
  await settle(page);
}

test('the table of contents', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config,
    'content/posts/toc/index.md': article({ title: '目录', slug: 'toc', body }),
    'content/posts/dots/index.md': article({ title: '圆点', slug: 'dots', extra: 'toc: dots\n', body }),
    'content/posts/long/index.md': article({ title: 'Long', slug: 'long', body: longBody }),
    'components/page-box.js': pageBox,
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const url = `${base}/2026-10/toc/`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const open = async ({ style, path = 'toc', viewport = { width: 1440, height: 900 }, ...options } = {}) => {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', ...options });
    if (style !== undefined) await context.addInitScript((value) => localStorage.setItem('bk-toc', value), style);
    const page = await context.newPage();
    await page.goto(`${base}/2026-10/${path}/`);
    await settle(page);
    return { page, context };
  };

  await t.test('the current entry follows the reading position in every style', async () => {
    for (const [style, width] of [...STYLES.map((name) => [name, 1440]), ['rail', 1100]]) {
      const { page, context } = await open({ style: style === 'rail' ? 'notes' : style, viewport: { width, height: 900 } });
      const readCurrent = () => page.evaluate(current, style);
      const chapterLevel = style === 'tabs' || style === 'dots';
      assert.equal(await readCurrent(), chapterLevel ? 'one' : null, `${style} before the first chapter`);
      await scrollToHeading(page, 'one-b');
      assert.equal(await readCurrent(), chapterLevel ? 'one' : 'one-b', `${style} in the second section of the first chapter`);
      await scrollToHeading(page, 'chapter-3');
      assert.equal(await readCurrent(), 'chapter-3', `${style} at the third chapter`);
      await scrollToHeading(page, 'chapter-4-a');
      assert.equal(await readCurrent(), chapterLevel ? 'chapter-4' : 'chapter-4-a', `${style} in the section of the fourth chapter`);
      await context.close();
    }
  });

  await t.test('the notes style shows the recap of read sections and fades the chapters ahead', async () => {
    const { page, context } = await open();
    await scrollToHeading(page, 'chapter-2');
    const state = await page.evaluate(() => ({
      recaps: [...document.querySelectorAll('.bk-toc .bk-toc-recap')].map((recap) => [recap.textContent, recap.getBoundingClientRect().height > 10]),
      ahead: getComputedStyle(document.querySelector('.bk-toc [data-target="chapter-5"] .bk-toc-chapter-title')).color,
      read: getComputedStyle(document.querySelector('.bk-toc [data-target="one"] .bk-toc-chapter-title')).color,
      marker: document.querySelector('.bk-toc .bk-toc-marker').getBoundingClientRect().top - document.querySelector('.bk-toc [data-target="chapter-2"] .bk-toc-chapter-title').getBoundingClientRect().top,
    }));
    assert.deepEqual(state.recaps, [
      ['第一章的要点。', true],
      ['一之一的要点，含有 重点 标记。', true],
    ]);
    assert.notEqual(state.ahead, state.read);
    assert.ok(state.marker > 0 && state.marker < 30, `the marker starts ${state.marker}px below the current chapter title`);
    await context.close();
  });

  await t.test('a section counts as read once 85 percent of it is above the middle of the viewport', async () => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1440, height: 600 },
    ]) {
      const { page, context } = await open({ style: 'notes', viewport });
      const readAt = async (share) => {
        await page.evaluate((part) => {
          const top = document.getElementById('one-a').getBoundingClientRect().top + scrollY;
          const end = document.getElementById('one-b').getBoundingClientRect().top + scrollY;
          scrollTo(0, top - innerHeight / 2 + part * (end - top));
        }, share);
        await settle(page);
        return page.evaluate(() => [document.querySelector('.bk-toc [data-target="one-a"]').dataset.state, document.querySelector('.bk-toc [data-target="one-a"]').classList.contains('is-read')]);
      };
      assert.deepEqual(await readAt(0.84), ['current', false], `just under the threshold at ${viewport.width}×${viewport.height}`);
      assert.deepEqual(await readAt(0.86), ['current', true], `just over the threshold at ${viewport.width}×${viewport.height}`);
      await context.close();
    }
  });

  await t.test('hover cards stay inside the viewport and show the recap, else the first sentence, without highlights', async () => {
    const triggers = { tabs: '.bk-tab', dots: '.bk-dot-item', ticks: '.bk-tick.is-chapter' };
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 600 },
    ]) {
      for (const style of ['tabs', 'dots', 'ticks']) {
        const { page, context } = await open({ style, viewport });
        await scrollToHeading(page, 'one-a');
        const selector = style === 'tabs' ? '.bk-index-body' : '.bk-popover';
        await pointAt(page, page.locator(triggers[style]).first());
        await page.waitForFunction((name) => document.querySelector(name === '.bk-index-body' ? '.bk-index' : '.bk-popover').classList.contains('is-on'), selector);
        const first = await page.evaluate(cardReport, selector);
        assert.deepEqual(
          first,
          {
            inside: true,
            clearOfSettings: true,
            marks: 0,
            head: '01 · 正在读',
            summary: '第一章的要点。',
            sections: [
              ['一之一', '一之一的要点，含有 重点 标记。'],
              ['一之二', '一之二的第一句话有 重点 标记和链接。'],
            ],
            readLabel: false,
          },
          `${style} at ${viewport.width}×${viewport.height}`,
        );
        await pointAt(page, page.locator(triggers[style]).nth(5));
        await page.waitForFunction((name) => document.querySelector(name).textContent.includes('第6章'), selector);
        const last = await page.evaluate(cardReport, selector);
        assert.deepEqual([last.inside, last.clearOfSettings, last.head, last.summary, last.sections], [true, true, '06', '第6章的第一句话。', [['第6章的小节', '第6章的小节的第 1 段。']]], `${style} on the last chapter`);
        await context.close();
      }
    }
  });

  await t.test('the tab and the index card form one shape that follows the hovered tab', async () => {
    const { page, context } = await open({ style: 'tabs' });
    await page.hover('.bk-tab:nth-of-type(2)');
    await page.waitForFunction(() => document.querySelector('.bk-index').classList.contains('is-on'));
    await page.waitForTimeout(300);
    const shape = await page.evaluate(() => {
      const tab = document.querySelector('.bk-tab.is-hover').getBoundingClientRect();
      const white = document.querySelector('.bk-index-tab').getBoundingClientRect();
      const card = document.querySelector('.bk-index-body').getBoundingClientRect();
      return { top: Math.abs(white.top - tab.top), height: Math.abs(white.height - tab.height), left: white.left, joins: white.right - card.left };
    });
    assert.ok(shape.top < 0.5 && shape.height < 0.5 && shape.left === 0, `the white tab is not over the tab: ${JSON.stringify(shape)}`);
    assert.ok(shape.joins >= 0 && shape.joins <= 1.5, `the white tab and the card do not join: ${JSON.stringify(shape)}`);
    await context.close();
  });

  await t.test('the cards of the table of contents keep their own look on article pages, and the homepage cards keep theirs', async () => {
    for (const style of ['tabs', 'dots', 'ticks']) {
      const { page, context } = await open({ style });
      const trigger = { tabs: '.bk-tab', dots: '.bk-dot-item', ticks: '.bk-tick.is-chapter' }[style];
      const box = style === 'tabs' ? '.bk-index-body' : '.bk-popover';
      await pointAt(page, page.locator(trigger).nth(1));
      await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('第2章'), box);
      const look = await page.evaluate((selector) => {
        const frame = document.querySelector(selector);
        const card = frame.querySelector('.bk-toc-card');
        const frameStyle = getComputedStyle(frame);
        const cardStyle = getComputedStyle(card);
        const titleStyle = getComputedStyle(card.querySelector('.bk-toc-card-title'));
        return {
          border: cardStyle.borderTopWidth,
          radius: cardStyle.borderTopLeftRadius,
          shadow: cardStyle.boxShadow,
          background: cardStyle.backgroundColor,
          width: Math.round(card.getBoundingClientRect().width) === Math.round(frame.clientWidth - parseFloat(frameStyle.paddingLeft) - parseFloat(frameStyle.paddingRight)),
          titleSize: titleStyle.fontSize,
          titleWrap: titleStyle.textWrapStyle,
          frameRadius: frameStyle.borderTopLeftRadius,
          frameShadow: frameStyle.boxShadow !== 'none',
        };
      }, box);
      assert.deepEqual(
        look,
        { border: '0px', radius: '0px', shadow: 'none', background: 'rgba(0, 0, 0, 0)', width: true, titleSize: '17px', titleWrap: 'balance', frameRadius: '12px', frameShadow: style !== 'tabs' },
        `the ${style} card`,
      );
      await context.close();
    }
    const { page, context } = await open();
    await page.goto(`${base}/`);
    const home = await page.evaluate(() => {
      const card = document.querySelector('.bk-home .bk-card');
      const cardStyle = getComputedStyle(card);
      const titleStyle = getComputedStyle(card.querySelector('.bk-card-title'));
      return { border: cardStyle.borderTopWidth, radius: cardStyle.borderTopLeftRadius, shadow: cardStyle.boxShadow !== 'none', titleWeight: titleStyle.fontWeight, titleWrap: titleStyle.textWrapStyle, titleMargin: titleStyle.marginTop };
    });
    assert.deepEqual(home, { border: '1px', radius: '14px', shadow: true, titleWeight: '700', titleWrap: 'pretty', titleMargin: '0px' });
    await context.close();
  });

  await t.test('the tabs of chapters ahead, the drawer tabs, the drawer close button and the settings button use the ink colour', async () => {
    for (const [colorScheme, ink] of [
      ['light', 'rgb(22, 26, 29)'],
      ['dark', 'rgb(233, 236, 231)'],
    ]) {
      const desk = await open({ style: 'tabs', colorScheme });
      await scrollToHeading(desk.page, 'chapter-2');
      const tabs = await desk.page.evaluate(() => ({
        ahead: getComputedStyle(document.querySelectorAll('.bk-tab')[4]).color,
        settings: getComputedStyle(document.querySelector('.bk-settings-toggle')).color,
      }));
      assert.deepEqual(tabs, { ahead: ink, settings: ink }, colorScheme);
      await desk.context.close();
      const phone = await open({ style: 'tabs', colorScheme, viewport: { width: 375, height: 760 } });
      await phone.page.evaluate(() => localStorage.setItem('bk-buttons', 'always'));
      await phone.page.reload();
      await scrollToHeading(phone.page, 'chapter-2');
      await phone.page.click('.bk-toc-handle');
      await phone.page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
      const drawer = await phone.page.evaluate(() => ({
        ahead: getComputedStyle(document.querySelectorAll('.bk-drawer-tab')[4]).color,
        close: getComputedStyle(document.querySelector('.bk-drawer-close')).color,
        settings: getComputedStyle(document.querySelector('.bk-settings-toggle')).color,
      }));
      assert.deepEqual(drawer, { ahead: ink, close: ink, settings: ink }, `${colorScheme} on a phone`);
      await phone.context.close();
    }
  });

  await t.test('the shadows of the current tab and of the phone handle follow dark mode', async () => {
    const shadows = {};
    for (const colorScheme of ['light', 'dark']) {
      const desk = await open({ style: 'tabs', colorScheme });
      await scrollToHeading(desk.page, 'chapter-2');
      const tab = await desk.page.evaluate(() => getComputedStyle(document.querySelector('.bk-tab.is-current')).boxShadow);
      await desk.context.close();
      const phone = await open({ style: 'tabs', colorScheme, viewport: { width: 375, height: 760 } });
      const handle = await phone.page.evaluate(() => getComputedStyle(document.querySelector('.bk-toc-handle.is-tab')).boxShadow);
      await phone.context.close();
      shadows[colorScheme] = { tab, handle };
    }
    assert.deepEqual(sharedShadowLayers(shadows.light.tab, shadows.dark.tab), [], 'the current tab');
    assert.deepEqual(sharedShadowLayers(shadows.light.handle, shadows.dark.handle), [], 'the handle');
  });

  await t.test('the notes style keeps the top padding of the first chapter', async () => {
    const { page, context } = await open({ style: 'notes' });
    const padding = await page.evaluate(() => [...document.querySelectorAll('.bk-toc .bk-toc-chapter-title')].slice(0, 2).map((title) => getComputedStyle(title).paddingTop));
    assert.deepEqual(padding, ['20px', '20px']);
    await context.close();
  });

  await t.test('the dots and ticks cards may reach 12 pixels above the bottom of the screen, and the tabs card stops above the settings button', async () => {
    for (const style of ['tabs', 'dots', 'ticks']) {
      const { page, context } = await open({ style, path: 'long', viewport: { width: 1440, height: 600 } });
      const trigger = { tabs: '.bk-tab', dots: '.bk-dot-item', ticks: '.bk-tick.is-chapter' }[style];
      const box = style === 'tabs' ? '.bk-index-body' : '.bk-popover';
      await pointAt(page, page.locator(trigger).last());
      await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('Chapter 18'), box);
      const limit = await page.evaluate((selector) => {
        const frame = document.querySelector(selector);
        const toggle = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
        return { maxHeight: parseFloat(getComputedStyle(frame).maxHeight), screen: innerHeight - 24, settings: toggle.top - 20 };
      }, box);
      assert.equal(limit.maxHeight, style === 'tabs' ? limit.settings : limit.screen, `${style}: ${JSON.stringify(limit)}`);
      await context.close();
    }
  });

  await t.test('the keyboard reaches the tabs, dots and ticks first, and moves from the entries of each chapter into the links of its card and on to the next chapter, and the notes panel closes when the focus leaves it', async () => {
    for (const style of ['tabs', 'dots', 'ticks']) {
      const { page, context } = await open({ style });
      const entry = { tabs: 'bk-tab', dots: 'bk-dot-item', ticks: 'bk-tick' }[style];
      const focused = () =>
        page.evaluate(() => {
          const element = document.activeElement;
          return `${element.closest('.bk-index, .bk-popover') === null ? element.classList[0] : 'card'} ${decodeURIComponent(element.getAttribute('href') ?? '')}`;
        });
      const chapters = [
        ['one', 'one-a', 'one-b'],
        ...[2, 3, 4, 5, 6].map((number) => [`chapter-${number}`, `chapter-${number}-a`]),
      ];
      const expected = chapters.flatMap((ids) => [...(style === 'ticks' ? ids : ids.slice(0, 1)).map((id) => `${entry} #${id}`), ...ids.map((id) => `card #${id}`)]);
      const seen = [];
      for (let step = 0; step < expected.length; step += 1) {
        await page.keyboard.press('Tab');
        seen.push(await focused());
      }
      assert.deepEqual(seen, expected, style);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await focused(), style === 'ticks' ? `${entry} #chapter-6-a` : `${entry} #chapter-6`, `${style}: shift and tab go back from the card to the last entry of its chapter`);
      await context.close();
    }
    const { page, context } = await open({ style: 'notes', viewport: { width: 1100, height: 700 } });
    const isOpen = () => page.evaluate(() => document.querySelector('.bk-toc-panel').classList.contains('is-open'));
    const inside = () => page.evaluate(() => document.activeElement.closest('.bk-ticks, .bk-toc-panel') !== null);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.matches('.bk-ticks .bk-tick')), true, 'the keyboard reaches the tick rail first');
    await page.waitForFunction(() => document.querySelector('.bk-toc-panel').classList.contains('is-open'));
    let steps = 0;
    while (await inside()) {
      assert.equal(await isOpen(), true, `the notes panel closed while the focus was on the rail or the panel, after ${steps} steps`);
      await page.keyboard.press('Tab');
      steps += 1;
      assert.ok(steps < 60, 'the focus never leaves the rail and the panel');
    }
    await page.waitForFunction(() => !document.querySelector('.bk-toc-panel').classList.contains('is-open'), null, { timeout: 2000 });
    await context.close();
  });

  await t.test('Escape closes the chapter card of the tabs, dots and ticks styles, and returns the focus from the card to its entry', async () => {
    for (const style of ['tabs', 'dots', 'ticks']) {
      const { page, context } = await open({ style });
      const trigger = { tabs: '.bk-tab', dots: '.bk-dot-item', ticks: '.bk-tick.is-chapter' }[style];
      const frame = style === 'tabs' ? '.bk-index' : '.bk-popover';
      const shown = () => page.evaluate((selector) => document.querySelector(selector).classList.contains('is-on'), frame);
      const focused = () => page.evaluate((selector) => (document.activeElement.closest(selector) === null ? `${document.activeElement.classList[0]} ${decodeURIComponent(document.activeElement.getAttribute('href') ?? '')}` : 'card'), frame);
      await pointAt(page, page.locator(trigger).nth(1));
      await page.waitForFunction((selector) => document.querySelector(selector).classList.contains('is-on'), frame);
      await page.keyboard.press('Escape');
      assert.equal(await shown(), false, `${style}: Escape leaves the card of the hovered entry open`);
      await page.waitForTimeout(300);
      assert.equal(await shown(), false, `${style}: the card opens again while the pointer rests on its entry`);
      await page.mouse.move(900, 450);
      await page.waitForTimeout(300);
      await page.keyboard.press('Tab');
      await page.waitForFunction((selector) => document.querySelector(selector).classList.contains('is-on'), frame);
      for (let step = 0; step < (style === 'ticks' ? 3 : 1); step += 1) await page.keyboard.press('Tab');
      assert.equal(await focused(), 'card', `${style}: the keyboard does not reach the card`);
      await page.keyboard.press('Escape');
      assert.equal(await shown(), false, `${style}: Escape leaves the card open while it has the focus`);
      assert.equal(await focused(), { tabs: 'bk-tab #one', dots: 'bk-dot-item #one', ticks: 'bk-tick #one-b' }[style], `${style}: the focus does not return to the entry`);
      await page.waitForTimeout(300);
      assert.equal(await shown(), false, `${style}: the card opens again when the focus returns to its entry`);
      await context.close();
    }
  });

  await t.test('while a wide block crosses the notes column, its entries take no keyboard focus until the block is gone', async () => {
    const { page, context } = await open({ style: 'notes', path: 'long' });
    await scrollToHeading(page, 'chapter-9');
    const focusable = () =>
      page.evaluate(() => {
        const column = document.querySelector('.bk-toc-column');
        const links = [...column.querySelectorAll('a[href]')];
        const reached = links.filter((link) => {
          link.focus({ preventScroll: true });
          return document.activeElement === link;
        }).length;
        document.activeElement.blur();
        return { yielding: column.classList.contains('is-yielding'), reached, links: links.length };
      });
    const hidden = await focusable();
    assert.deepEqual([hidden.yielding, hidden.reached], [true, 0], `the hidden column takes focus: ${JSON.stringify(hidden)}`);
    const before = await page.evaluate(() => {
      const column = document.querySelector('.bk-toc-column');
      const earlier = [...document.querySelectorAll('a[href], button')].filter((element) => element.compareDocumentPosition(column) & Node.DOCUMENT_POSITION_FOLLOWING && element.checkVisibility());
      earlier.at(-1).focus({ preventScroll: true });
      return earlier.length;
    });
    assert.ok(before > 0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.bk-toc-column') === null), true, 'the tab key moves into the hidden column');
    await page.evaluate(() => {
      for (const block of document.querySelectorAll('.bk-block[data-width="page"]')) block.remove();
    });
    await settle(page);
    const shown = await focusable();
    assert.deepEqual([shown.yielding, shown.reached], [false, shown.links], `the column stays hidden: ${JSON.stringify(shown)}`);
    await context.close();
  });

  await t.test('the notes panel opens from the tick rail between 1000 and 1340 pixels and closes when the pointer leaves', async () => {
    const { page, context } = await open({ style: 'notes', viewport: { width: 1100, height: 700 } });
    await scrollToHeading(page, 'chapter-2');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.bk-toc').checkVisibility(), document.querySelector('.bk-ticks.is-rail').textContent]), [false, '']);
    await page.hover('.bk-ticks .bk-tick:nth-child(3)');
    await page.waitForFunction(() => document.querySelector('.bk-toc-panel').classList.contains('is-open'));
    const panel = await page.evaluate(() => ({
      label: document.querySelector('.bk-toc-panel .bk-toc-label').textContent,
      recaps: [...document.querySelectorAll('.bk-toc-panel .bk-toc-recap')].filter((recap) => recap.getBoundingClientRect().height > 10).length,
      covered: (() => {
        const box = document.querySelector('.bk-toc-panel').getBoundingClientRect();
        const button = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
        return box.bottom > button.top && box.left < button.right;
      })(),
    }));
    assert.deepEqual(panel, { label: '前文笔记', recaps: 2, covered: false });
    await page.mouse.move(900, 400);
    await page.waitForFunction(() => !document.querySelector('.bk-toc-panel').classList.contains('is-open'));
    await context.close();
  });

  await t.test('a jump from the dots or the tabs switches the chapter once, on arrival', async () => {
    for (const style of ['dots', 'tabs']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addInitScript((value) => localStorage.setItem('bk-toc', value), style);
      const page = await context.newPage();
      await page.goto(url);
      await settle(page);
      await page.evaluate((name) => {
        const selector = name === 'dots' ? '.bk-dot-item.is-current' : '.bk-tab-title.is-on';
        window.seen = [];
        const record = () => {
          const element = document.querySelector(selector);
          const index = [...element.parentElement.children].filter((child) => child.matches(name === 'dots' ? '.bk-dot-item' : '.bk-tab-title')).indexOf(element);
          if (window.seen.at(-1) !== index) window.seen.push(index);
          window.recording = requestAnimationFrame(record);
        };
        record();
      }, style);
      await page.click(style === 'dots' ? '.bk-dot-item:nth-child(5)' : '.bk-tab:nth-of-type(5)');
      await page.waitForFunction(() => Math.abs(document.getElementById('chapter-5').getBoundingClientRect().top - 24) < 2, null, { timeout: 5000 });
      await page.waitForTimeout(200);
      const seen = await page.evaluate(() => {
        cancelAnimationFrame(window.recording);
        return window.seen;
      });
      assert.deepEqual(seen, [0, 4], `${style} showed the chapters ${seen} during the jump`);
      await context.close();
    }
  });

  await t.test('on phones a handle opens the drawer of chapters, and a link in it jumps and closes it', async () => {
    for (const style of STYLES) {
      const { page, context } = await open({ style, viewport: { width: 375, height: 760 } });
      const handle = page.locator('.bk-toc-handle');
      assert.equal(await handle.getAttribute('class'), style === 'dots' ? 'bk-toc-handle is-capsule' : 'bk-toc-handle is-tab', style);
      const [above, below] = [await handle.boundingBox(), await page.locator('.bk-settings-toggle').boundingBox()];
      assert.ok(above.x === 0 && below.x === 0 && above.y + above.height + 10 <= below.y + 0.5, `${style}: the handle ends at ${above.y + above.height}, the settings button starts at ${below.y}`);
      await handle.click();
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
      assert.equal(await page.locator(style === 'dots' ? '.bk-drawer-index .bk-drawer-dot' : '.bk-drawer-index .bk-drawer-tab').count(), 6);
      assert.equal(await page.locator('.bk-drawer-detail .bk-toc-card-number').textContent(), '01');
      await page.locator('.bk-drawer-index button').nth(2).click();
      assert.equal(await page.locator('.bk-drawer-detail .bk-toc-card-title').textContent(), '第3章');
      await page.locator('.bk-drawer-detail .bk-toc-card-section').click();
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().right <= 0);
      await page.waitForFunction(() => Math.abs(document.getElementById('chapter-3-a').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
      await handle.click();
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().right <= 0);
      await context.close();
    }
  });

  await t.test('on phones choosing another style in the settings rebuilds the handle and the drawer at once', async () => {
    const { page, context } = await open({ style: 'tabs', viewport: { width: 375, height: 760 } });
    const read = async () => {
      const handle = await page.locator('.bk-toc-handle').getAttribute('class');
      await page.click('.bk-toc-handle');
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
      const index = await page.evaluate(() => [...document.querySelectorAll('.bk-drawer-index button')].map((button) => button.className.split(' ')[0]));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().right <= 0);
      return { handle, index: [...new Set(index)], count: index.length };
    };
    assert.deepEqual(await read(), { handle: 'bk-toc-handle is-tab', index: ['bk-drawer-tab'], count: 6 });
    for (const [name, handle, index] of [
      ['圆点胶囊', 'bk-toc-handle is-capsule', 'bk-drawer-dot'],
      ['刻度线', 'bk-toc-handle is-tab', 'bk-drawer-tab'],
    ]) {
      await page.click('.bk-settings-toggle');
      await page.getByRole('radio', { name: new RegExp(name) }).click();
      await page.keyboard.press('Escape');
      await settle(page);
      assert.deepEqual(await read(), { handle, index: [index], count: 6 }, name);
    }
    await context.close();
  });

  await t.test('on phones the handle and the settings button slide out of view to the left without reduced motion', async () => {
    const { page, context } = await open({ viewport: { width: 375, height: 760 }, hasTouch: true, reducedMotion: 'no-preference' });
    const rightEdges = () => page.evaluate(() => [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].map((element) => element.getBoundingClientRect().right));
    const [handle, settings] = await rightEdges();
    assert.ok(handle > 0 && settings > 0);
    for (let step = 0; step < 5; step += 1) {
      await page.evaluate(() => window.scrollBy(0, 120));
      await page.waitForTimeout(30);
    }
    await page.waitForFunction(() => document.documentElement.classList.contains('bk-buttons-hidden'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-toc-handle')).transform === 'none'), false);
    await page.waitForFunction(() => [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].every((element) => element.getBoundingClientRect().right <= 0));
    await context.close();
  });

  await t.test('on phones scrolling down hides the buttons, scrolling up shows them, and the setting turns this off', async () => {
    const { page, context } = await open({ viewport: { width: 375, height: 760 }, hasTouch: true });
    const hidden = () => page.evaluate(() => document.documentElement.classList.contains('bk-buttons-hidden'));
    const placed = (opacity) =>
      page
        .waitForFunction(
          (value) => [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].every((element) => element.getBoundingClientRect().left >= 0 && getComputedStyle(element).opacity === value),
          opacity,
          { timeout: 2000 },
        )
        .then(() => true, () => false);
    const focusable = () =>
      page.evaluate(() =>
        [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings-toggle')].map((element) => {
          element.focus();
          const focused = document.activeElement === element;
          element.blur();
          return focused;
        }),
      );
    const scrollBy = async (delta) => {
      for (let step = 0; step < 5; step += 1) {
        await page.evaluate((amount) => window.scrollBy(0, amount), delta / 5);
        await page.waitForTimeout(30);
      }
      await settle(page);
    };
    assert.equal(await placed('1'), true);
    await scrollBy(600);
    assert.equal(await hidden(), true);
    assert.equal(await placed('0'), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-toc-handle')).transitionDuration), '0.2s');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings')).visibility === 'hidden');
    assert.deepEqual(await focusable(), [false, false]);
    await scrollBy(-200);
    assert.equal(await hidden(), false);
    assert.equal(await placed('1'), true);
    assert.deepEqual(await focusable(), [true, true]);
    await scrollBy(600);
    await page.evaluate(() => scrollTo(0, 0));
    await settle(page);
    assert.equal(await hidden(), false);

    await page.click('.bk-settings-toggle');
    const toggle = page.getByRole('switch', { name: '向下滚动时隐藏按钮' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.buttons, localStorage.getItem('bk-buttons')]), ['always', 'always']);
    await page.mouse.click(300, 200);
    await scrollBy(800);
    assert.equal(await hidden(), false);
    assert.equal(await placed('1'), true);
    await context.close();
  });

  await t.test('the style chosen in the settings applies at once, survives a reload and is applied before the page script runs', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}/2026-10/dots/`);
    await settle(page);
    const read = () =>
      page.evaluate(() => ({
        toc: document.documentElement.dataset.toc,
        stored: localStorage.getItem('bk-toc'),
        views: ['.bk-toc', '.bk-tabs', '.bk-dots', '.bk-ticks'].filter((selector) => document.querySelector(selector)?.checkVisibility()),
        left: Math.round(document.querySelector('.bk-article').getBoundingClientRect().left),
      }));
    assert.deepEqual(await read(), { toc: 'dots', stored: null, views: ['.bk-dots'], left: 198 });
    assert.deepEqual(await page.locator('.bk-settings-label').allTextContents(), ['目录样式', '主题', '正文', '按钮']);
    await page.click('.bk-settings-toggle');
    await page.getByRole('radio', { name: /书签索引/ }).click();
    await settle(page);
    assert.deepEqual(await read(), { toc: 'tabs', stored: 'tabs', views: ['.bk-tabs'], left: 198 });
    await page.getByRole('radio', { name: /前文笔记/ }).click();
    await settle(page);
    assert.deepEqual(await read(), { toc: 'notes', stored: 'notes', views: ['.bk-toc'], left: 290 });
    await page.getByRole('radio', { name: /刻度线/ }).click();
    await page.reload();
    await settle(page);
    assert.deepEqual(await read(), { toc: 'ticks', stored: 'ticks', views: ['.bk-ticks'], left: 198 });
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(url);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.toc), 'ticks');
    await context.close();
  });

  await t.test('without scripts every style shows a readable table of contents whose links jump', async () => {
    for (const [path, viewport] of [
      ['toc', { width: 1440, height: 900 }],
      ['dots', { width: 1440, height: 900 }],
      ['dots', { width: 1100, height: 900 }],
      ['toc', { width: 375, height: 760 }],
    ]) {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`${base}/2026-10/${path}/`);
      const shown = await page.evaluate(() => ({
        label: document.querySelector('.bk-toc-label').innerText,
        entries: [...document.querySelectorAll('.bk-toc a')].filter((link) => link.checkVisibility({ opacityProperty: true }) && link.getBoundingClientRect().height > 10).map((link) => link.innerText.replace(/\s+/g, ' ')),
        left: Math.round(document.querySelector('.bk-article').getBoundingClientRect().left),
      }));
      assert.equal(shown.label, '目录');
      assert.deepEqual(shown.entries.slice(0, 4), ['01 第一章', '一之一', '一之二', '02 第2章'], `${path} at ${viewport.width}px`);
      assert.equal(shown.entries.length, 13);
      if (viewport.width === 1440) assert.equal(shown.left, 290, `${path} keeps the left column for the table of contents`);
      await page.locator('.bk-toc a', { hasText: '第4章的小节' }).click();
      await page.waitForFunction(() => location.hash === '#chapter-4-a' && Math.abs(document.getElementById('chapter-4-a').getBoundingClientRect().top - 24) < 2);
      await context.close();
    }
  });

  await t.test('without scripts the section titles of the table of contents have the secondary ink colour', async () => {
    for (const [colorScheme, ink2] of [
      ['light', 'rgb(79, 87, 94)'],
      ['dark', 'rgb(180, 186, 181)'],
    ]) {
      const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
      const page = await context.newPage();
      await page.goto(url);
      const colors = await page.evaluate(() => [...new Set([...document.querySelectorAll('.bk-toc-section-title')].map((title) => getComputedStyle(title).color))]);
      assert.deepEqual(colors, [ink2], colorScheme);
      await context.close();
    }
  });

  await t.test('the settings button covers no entry of the table of contents at short and tall viewports in an article with page-wide components', async () => {
    for (const style of STYLES) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1440, height: 600 },
        { width: 1024, height: 900 },
        { width: 1024, height: 600 },
      ]) {
        const { page, context } = await open({ style, path: 'long', viewport });
        const selector = viewport.width < 1340 && style === 'notes' ? '.bk-tick' : VISIBLE_ENTRIES[style];
        assert.ok((await page.locator(selector).count()) > 0, `${style} shows no entries at ${viewport.width}×${viewport.height}`);
        assert.deepEqual(await page.evaluate(coveredEntries, selector), [], `${style} at the top of the page, ${viewport.width}×${viewport.height}`);
        await scrollToHeading(page, 'chapter-9');
        await page.waitForFunction(() => document.querySelector('#chapter-9').closest('.bk-section').querySelector('figure.component').dataset.state === 'ready');
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(coveredEntries, selector), [], `${style} in the middle of the page, ${viewport.width}×${viewport.height}`);
        const box = await page.evaluate((entries) => {
          const all = [...document.querySelectorAll(entries)].map((entry) => entry.getBoundingClientRect()).filter((rect) => rect.height > 0);
          return { top: Math.min(...all.map((rect) => rect.top)), bottom: Math.max(...all.map((rect) => rect.bottom)) };
        }, style === 'notes' && viewport.width >= 1340 ? '.bk-toc-column' : selector);
        assert.ok(box.top >= 0 && box.bottom <= viewport.height, `${style} reaches outside the screen at ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
        await context.close();
      }
    }
  });
});
