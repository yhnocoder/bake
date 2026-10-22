import assert from 'node:assert/strict';
import { article } from '../blog.js';
import { test as base, expect, scrollInSteps, settle, sharedShadowLayers } from './browser.js';

const config = "export default { title: '目录测试', url: 'https://example.com', language: 'zh-CN' };\n";
const STYLES = ['notes', 'dots', 'ticks'];
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
  dots: '.bk-toc-dot-item',
  ticks: '.bk-toc-tick',
};

function current(style) {
  const selector = {
    notes: '.bk-toc [aria-current="true"]',
    rail: '.bk-toc-ticks.is-rail [aria-current="true"]',
    dots: '.bk-toc-dots [aria-current="true"]',
    ticks: '.bk-toc-ticks [aria-current="true"]',
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

function shownCard(selector) {
  return document.querySelector(selector).checkVisibility({ visibilityProperty: true });
}

function hiddenCard(selector) {
  return !document.querySelector(selector).checkVisibility({ visibilityProperty: true });
}

function focusTarget(card) {
  const element = document.activeElement;
  return `${element.closest(card) === null ? 'entry' : 'card'} ${decodeURIComponent(element.getAttribute('href') ?? '')}`;
}

async function pointAt(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
}

async function restingBox(locator) {
  await locator.evaluate(async (entry) => {
    const host = entry.closest('.bk-toc-ui');
    const texts = [...host.querySelectorAll('*')].filter((element) => element.childElementCount === 0 && element.textContent.trim() !== '');
    await Promise.all(
      texts.map((element) => {
        const style = getComputedStyle(element);
        return document.fonts.load(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, element.textContent).catch(() => {});
      }),
    );
    await document.fonts.ready;
    let last = '';
    let since = performance.now();
    while (performance.now() - since < 500) {
      await new Promise((done) => requestAnimationFrame(done));
      const box = entry.getBoundingClientRect();
      const key = `${box.x} ${box.y} ${box.width} ${box.height}`;
      if (key !== last) {
        last = key;
        since = performance.now();
      }
    }
  });
  return locator.boundingBox();
}

async function scrollAndSettle(page, delta) {
  await scrollInSteps(page, delta);
  await settle(page);
}

async function scrollToHeading(page, id) {
  await page.evaluate((target) => scrollTo(0, document.getElementById(target).getBoundingClientRect().top + scrollY - 60), id);
  await settle(page);
}

const url = '/2026-10/toc/';

const test = base.extend({
  open: async ({ newContext }, use) => {
    await use(async ({ style, path = 'toc', viewport = { width: 1440, height: 900 }, ...options } = {}) => {
      const context = await newContext({ viewport, reducedMotion: 'reduce', ...options });
      const page = await context.newPage();
      await page.goto(`/2026-10/${style === undefined ? path : `${path}-${style}`}/`);
      await settle(page);
      return { page, context };
    });
  },
});

test.use({
  blog: {
    example: false,
    files: {
        'bake.config.js': config,
        'content/posts/toc/index.md': article({ title: '目录', slug: 'toc', body }),
        ...Object.fromEntries(STYLES.flatMap((style) => [
          [`content/posts/toc-${style}/index.md`, article({ title: '目录', slug: `toc-${style}`, extra: `toc: ${style}\n`, body })],
          [`content/posts/long-${style}/index.md`, article({ title: 'Long', slug: `long-${style}`, extra: `toc: ${style}\n`, body: longBody })],
        ])),
        'content/posts/plain/index.md': article({ title: '无目录', slug: 'plain', body: filler('正文', 12) }),
        'components/page-box.js': pageBox,
    },
  },
});

test.describe('the table of contents', () => {
  test('the current entry follows the reading position in every style', async ({ open }) => {
    for (const [style, width] of [...STYLES.map((name) => [name, 1440]), ['rail', 1100]]) {
      const { page, context } = await open({ style: style === 'rail' ? 'notes' : style, viewport: { width, height: 900 } });
      const readCurrent = () => page.evaluate(current, style);
      const chapterLevel = style === 'dots';
      assert.equal(await readCurrent(), chapterLevel ? 'one' : null, `${style} before the first chapter`);
      await scrollToHeading(page, 'one-b');
      assert.equal(await readCurrent(), chapterLevel ? 'one' : 'one-b', `${style} in the second section of the first chapter`);
      await scrollToHeading(page, 'chapter-3');
      assert.equal(await readCurrent(), 'chapter-3', `${style} at the third chapter`);
      await scrollToHeading(page, 'chapter-4-a');
      assert.equal(await readCurrent(), chapterLevel ? 'chapter-4' : 'chapter-4-a', `${style} in the section of the fourth chapter`);
    }
  });

  test('the notes style shows the recap of read sections and fades the chapters ahead', async ({ open }) => {
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
  });

  test('the notes style shows the recap of a section once 85 percent of it is above the middle of the viewport', async ({ open }) => {
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
        return page.evaluate(() => {
          const recap = document.querySelector('.bk-toc [data-target="one-a"] .bk-toc-recap');
          return recap.checkVisibility({ opacityProperty: true }) && recap.getBoundingClientRect().height > 10;
        });
      };
      assert.equal(await readAt(0.84), false, `the recap shows just under the threshold at ${viewport.width}×${viewport.height}`);
      assert.equal(await readAt(0.86), true, `the recap stays hidden just over the threshold at ${viewport.width}×${viewport.height}`);
    }
  });

  test('hover cards stay inside the viewport and show the recap, else the first sentence, without highlights', async ({ open }) => {
    const triggers = { dots: '.bk-toc-dot-item', ticks: '.bk-toc-tick.is-chapter' };
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 600 },
    ]) {
      for (const style of ['dots', 'ticks']) {
        const { page, context } = await open({ style, viewport });
        await scrollToHeading(page, 'one-a');
        const selector = '.bk-toc-popover';
        await pointAt(page, page.locator(triggers[style]).first());
        await page.waitForFunction(shownCard, selector);
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
      }
    }
  });


  test('the cards of the table of contents keep their own look on article pages, and the homepage cards keep theirs', async ({ open }) => {
    for (const style of ['dots', 'ticks']) {
      const { page, context } = await open({ style });
      const trigger = { dots: '.bk-toc-dot-item', ticks: '.bk-toc-tick.is-chapter' }[style];
      const box = '.bk-toc-popover';
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
        { border: '0px', radius: '0px', shadow: 'none', background: 'rgba(0, 0, 0, 0)', width: true, titleSize: '17px', titleWrap: 'balance', frameRadius: '12px', frameShadow: true },
        `the ${style} card`,
      );
    }
    const { page, context } = await open();
    await page.goto('/');
    const home = await page.evaluate(() => {
      const card = document.querySelector('.bk-home .bk-card');
      const cardStyle = getComputedStyle(card);
      const titleStyle = getComputedStyle(card.querySelector('.bk-card-title'));
      return { border: cardStyle.borderTopWidth, radius: cardStyle.borderTopLeftRadius, shadow: cardStyle.boxShadow !== 'none', titleWeight: titleStyle.fontWeight, titleWrap: titleStyle.textWrapStyle, titleMargin: titleStyle.marginTop };
    });
    assert.deepEqual(home, { border: '1px', radius: '14px', shadow: true, titleWeight: '700', titleWrap: 'pretty', titleMargin: '0px' });
  });

  test('the drawer tabs, the drawer close button and the settings button use the ink colour', async ({ open }) => {
    for (const [colorScheme, ink] of [
      ['light', 'rgb(22, 26, 29)'],
      ['dark', 'rgb(233, 236, 231)'],
    ]) {
      const desk = await open({ style: 'dots', colorScheme });
      assert.equal(await desk.page.evaluate(() => getComputedStyle(document.querySelector('.bk-settings-toggle')).color), ink, colorScheme);
      await desk.context.close();
      const phone = await open({ style: 'ticks', colorScheme, viewport: { width: 375, height: 760 } });
      await phone.page.click('.bk-settings-toggle');
      await phone.page.getByRole('switch').click();
      await phone.page.keyboard.press('Escape');
      await scrollToHeading(phone.page, 'chapter-2');
      await phone.page.click('.bk-toc-handle');
      await phone.page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
      const drawer = await phone.page.evaluate(() => ({
        ahead: getComputedStyle(document.querySelectorAll('.bk-toc-drawer-tab')[4]).color,
        close: getComputedStyle(document.querySelector('.bk-toc-drawer-close')).color,
        settings: getComputedStyle(document.querySelector('.bk-settings-toggle')).color,
      }));
      assert.deepEqual(drawer, { ahead: ink, close: ink, settings: ink }, `${colorScheme} on a phone`);
      await phone.context.close();
    }
  });

  test('the shadow of the phone handle follows dark mode', async ({ open }) => {
    const shadows = {};
    for (const colorScheme of ['light', 'dark']) {
      const phone = await open({ style: 'ticks', colorScheme, viewport: { width: 375, height: 760 } });
      shadows[colorScheme] = await phone.page.evaluate(() => getComputedStyle(document.querySelector('.bk-toc-handle.is-tab')).boxShadow);
      await phone.context.close();
    }
    assert.deepEqual(sharedShadowLayers(shadows.light, shadows.dark), []);
  });

  test('the notes style keeps the top padding of the first chapter', async ({ open }) => {
    const { page, context } = await open({ style: 'notes' });
    const padding = await page.evaluate(() => [...document.querySelectorAll('.bk-toc .bk-toc-chapter-title')].slice(0, 2).map((title) => getComputedStyle(title).paddingTop));
    assert.deepEqual(padding, ['20px', '20px']);
  });

  test('the dots and ticks cards may reach 12 pixels above the bottom of the screen', async ({ open }) => {
    for (const style of ['dots', 'ticks']) {
      const { page, context } = await open({ style, path: 'long', viewport: { width: 1440, height: 600 } });
      const trigger = { dots: '.bk-toc-dot-item', ticks: '.bk-toc-tick.is-chapter' }[style];
      const box = '.bk-toc-popover';
      await pointAt(page, page.locator(trigger).last());
      await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('Chapter 18'), box);
      const limit = await page.evaluate((selector) => {
        const frame = document.querySelector(selector);
        return { maxHeight: parseFloat(getComputedStyle(frame).maxHeight), screen: innerHeight - 24 };
      }, box);
      assert.equal(limit.maxHeight, limit.screen, `${style}: ${JSON.stringify(limit)}`);
    }
  });

  test('the keyboard reaches the dots and ticks first, and moves from the entries of each chapter into the links of its card and on to the next chapter, and the notes panel closes when the focus leaves it', async ({ open }) => {
    for (const style of ['dots', 'ticks']) {
      const { page, context } = await open({ style });
      const entry = 'entry';
      const focused = () => page.evaluate(focusTarget, '.bk-toc-popover');
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
    }
    const { page, context } = await open({ style: 'notes', viewport: { width: 1100, height: 700 } });
    const isOpen = () => page.evaluate(shownCard, '.bk-toc-panel');
    const inside = () => page.evaluate(() => document.activeElement.closest('.bk-toc-ticks, .bk-toc-panel') !== null);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.matches('.bk-toc-ticks .bk-toc-tick')), true, 'the keyboard reaches the tick rail first');
    await page.waitForFunction(shownCard, '.bk-toc-panel');
    let steps = 0;
    while (await inside()) {
      assert.equal(await isOpen(), true, `the notes panel closed while the focus was on the rail or the panel, after ${steps} steps`);
      await page.keyboard.press('Tab');
      steps += 1;
      assert.ok(steps < 60, 'the focus never leaves the rail and the panel');
    }
    await page.waitForFunction(hiddenCard, '.bk-toc-panel', { timeout: 2000 });
  });

  test('Escape closes the chapter card of the dots and ticks styles, returns the focus from the card to its entry, and after a keyboard Escape the pointer opens the card of that entry again', async ({ open }) => {
    for (const style of ['dots', 'ticks']) {
      const { page, context } = await open({ style, reducedMotion: 'no-preference' });
      const trigger = { dots: '.bk-toc-dot-item', ticks: '.bk-toc-tick.is-chapter' }[style];
      const frame = '.bk-toc-popover';
      const shown = () => page.evaluate(shownCard, frame);
      const focused = async () => {
        const entry = await page.evaluate(focusTarget, frame);
        return entry.startsWith('card') ? 'card' : entry;
      };
      const cardOpens = (problem) =>
        page.waitForFunction(shownCard, frame).catch((error) => {
          throw new Error(`${style}: ${problem}`, { cause: error });
        });
      const cardCloses = (problem) =>
        page.waitForFunction(hiddenCard, frame, { timeout: 2000 }).catch((error) => {
          throw new Error(`${style}: ${problem}`, { cause: error });
        });
      const entry = await restingBox(page.locator(trigger).nth(1));
      const rest = (offset) => page.mouse.move(entry.x + entry.width / 2 + offset, entry.y + entry.height / 2);
      await rest(0);
      await cardOpens('the card does not open while the pointer rests on its entry');
      await settle(page);
      await rest(1);
      await page.keyboard.press('Escape');
      await cardCloses('Escape leaves the card of the hovered entry open');
      await settle(page);
      await rest(0);
      await page.waitForTimeout(300);
      assert.equal(await shown(), false, `${style}: the card opens again while the pointer rests on its entry`);
      await page.mouse.move(900, 450);
      await page.keyboard.press('Tab');
      await cardOpens('the card does not open when the keyboard reaches its entry');
      for (let step = 0; step < (style === 'ticks' ? 3 : 1); step += 1) await page.keyboard.press('Tab');
      assert.equal(await focused(), 'card', `${style}: the keyboard does not reach the card`);
      await page.keyboard.press('Escape');
      await cardCloses('Escape leaves the card open while it has the focus');
      assert.equal(await focused(), { dots: 'entry #one', ticks: 'entry #one-b' }[style], `${style}: the focus does not return to the entry`);
      await page.waitForTimeout(300);
      assert.equal(await shown(), false, `${style}: the card opens again when the focus returns to its entry`);
      const focusedEntry = await page.evaluate(() => {
        const box = document.activeElement.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.mouse.move(focusedEntry.x, focusedEntry.y);
      const opened = await page.waitForFunction(shownCard, frame, { timeout: 2000 }).then(
        () => true,
        () => false,
      );
      assert.equal(opened, true, `${style}: the card stays closed when the pointer reaches the entry that the keyboard closed it from`);
    }
  });

  test('while a wide block crosses the notes column, its entries take no keyboard focus until the block is gone', async ({ open }) => {
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
        return { reached, links: links.length };
      });
    const hidden = await focusable();
    assert.equal(hidden.reached, 0, `the hidden column takes focus: ${JSON.stringify(hidden)}`);
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
    assert.equal(shown.reached, shown.links, `the column stays hidden: ${JSON.stringify(shown)}`);
  });

  test('on phones the capsule of the dots handle fills with the reading progress', async ({ open }) => {
    const { page, context } = await open({ style: 'dots', path: 'long', viewport: { width: 375, height: 760 } });
    await scrollToHeading(page, 'chapter-5');
    const fill = await page.evaluate(() => {
      const capsule = document.querySelector('.bk-toc-handle-capsule');
      return { capsule: capsule.getBoundingClientRect().height, filled: capsule.querySelector('i').getBoundingClientRect().height };
    });
    assert.ok(fill.filled > 0 && fill.filled < fill.capsule, `the capsule fill does not show the progress: ${JSON.stringify(fill)}`);
  });

  test('the notes panel opens from the tick rail between 1000 and 1340 pixels and closes when the pointer leaves', async ({ open }) => {
    const { page, context } = await open({ style: 'notes', viewport: { width: 1100, height: 700 } });
    await scrollToHeading(page, 'chapter-2');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.bk-toc').checkVisibility(), document.querySelector('.bk-toc-ticks.is-rail').textContent]), [false, '']);
    await page.hover('.bk-toc-ticks .bk-toc-tick:nth-child(3)');
    await page.waitForFunction(shownCard, '.bk-toc-panel');
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
    await page.waitForFunction(hiddenCard, '.bk-toc-panel');
  });

  test('a jump from the dots to another chapter folds the capsule, lights the dots it passes and opens the capsule of the target chapter once', async ({ open }) => {
    const { page, context } = await open({ style: 'dots', reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      window.seen = [];
      window.passed = new Set();
      const record = () => {
        const items = [...document.querySelectorAll('.bk-toc-dot-item')];
        const index = items.findIndex((element) => element.getAttribute('aria-current') === 'true');
        if (window.seen.at(-1) !== index) window.seen.push(index);
        items.forEach((element, item) => element.classList.contains('is-passing') && window.passed.add(item));
        window.recording = requestAnimationFrame(record);
      };
      record();
    });
    await page.click('.bk-toc-dot-item:nth-child(5)');
    await page.waitForFunction(() => Math.abs(document.getElementById('chapter-5').getBoundingClientRect().top - 24) < 2, null, { timeout: 5000 });
    await settle(page);
    const { seen, passed } = await page.evaluate(() => {
      cancelAnimationFrame(window.recording);
      return { seen: window.seen, passed: [...window.passed] };
    });
    assert.deepEqual(seen, [0, -1, 4], `the dots showed the chapters ${seen} during the jump`);
    assert.ok(passed.length > 0 && passed.every((index) => index < 4), `the dots passed ${passed}`);
  });

  test('a change of the text metrics, such as a font that finishes loading, moves the dots and the notes marker without a transition', async ({ open }) => {
    for (const style of ['dots', 'notes']) {
      const { page, context } = await open({ style, reducedMotion: 'no-preference' });
      await scrollToHeading(page, 'chapter-3');
      const { moved, moving } = await page.evaluate(async () => {
        const entries = () => [...document.querySelectorAll('.bk-toc-dot-item, .bk-toc-marker')].map((entry) => `${getComputedStyle(entry).translate} ${getComputedStyle(entry).transform}`).join();
        const before = entries();
        const style = document.createElement('style');
        style.textContent = '.bk-toc-ui *, .bk-toc * { font-size: 19px !important; letter-spacing: 0.3em !important; }';
        document.head.append(style);
        window.dispatchEvent(new Event('resize'));
        for (let frame = 0; frame < 4; frame += 1) await new Promise((done) => requestAnimationFrame(done));
        const running = document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition && ['transform', 'translate'].includes(animation.transitionProperty))
          .filter((animation) => animation.effect.target.closest('.bk-toc-ui, .bk-toc'))
          .map((animation) => `${animation.effect.target.className} ${animation.transitionProperty}`);
        for (const animation of document.getAnimations()) animation.finish();
        return { moved: entries() !== before, moving: running };
      });
      assert.ok(moved, `the ${style} entries stayed in place`);
      assert.deepEqual(moving, [], `${style} animated ${moving.join(', ')}`);
    }
  });

  const capsules = (page) => page.locator('.bk-toc-handle .bk-toc-handle-capsule').count();
  const handleFocused = (page) => page.locator('.bk-toc-handle').evaluate((handle) => handle === document.activeElement);

  test('on phones a handle opens the drawer of chapters, a link in it jumps and closes it, and closing it returns the focus to the handle', async ({ open }) => {
    for (const style of STYLES) {
      const { page, context } = await open({ style, viewport: { width: 375, height: 760 }, reducedMotion: 'no-preference' });
      const handle = page.locator('.bk-toc-handle');
      assert.equal(await capsules(page), style === 'dots' ? 1 : 0, `${style}: the handle shows a capsule only for the dots style`);
      const [above, below] = [await handle.boundingBox(), await page.locator('.bk-settings-toggle').boundingBox()];
      assert.ok(above.x === 0 && below.x === 0 && above.y + above.height + 10 <= below.y + 0.5, `${style}: the handle ends at ${above.y + above.height}, the settings button starts at ${below.y}`);
      await handle.click();
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
      assert.equal(await page.locator(style === 'dots' ? '.bk-toc-drawer-index .bk-toc-drawer-dot' : '.bk-toc-drawer-index .bk-toc-drawer-tab').count(), 6);
      assert.equal(await page.locator('.bk-toc-drawer-detail .bk-toc-card-number').textContent(), '01');
      await page.locator('.bk-toc-drawer-index button').nth(2).click();
      assert.equal(await page.locator('.bk-toc-drawer-detail .bk-toc-card-title').textContent(), '第3章');
      const marked = await page.locator('.bk-toc-drawer-index button').evaluateAll((buttons) => ['aria-current', 'aria-expanded'].map((name) => buttons.findIndex((button) => button.getAttribute(name) === 'true')));
      assert.deepEqual(marked, [0, 2], `${style}: the first chapter is current and the third chapter's card is shown`);
      await page.locator('.bk-toc-drawer-detail .bk-toc-card-section').click();
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().right <= 0);
      await page.waitForFunction(() => Math.abs(document.getElementById('chapter-3-a').getBoundingClientRect().top - 24) < 2, null, { timeout: 3000 });
      await handle.click();
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().right <= 0);
      assert.equal(await handleFocused(page), true, `${style}: Escape returns the focus to the handle`);
      await handle.click();
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
      await page.click('.bk-toc-drawer-close');
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().right <= 0);
      assert.equal(await handleFocused(page), true, `${style}: the close button returns the focus to the handle`);
    }
  });

  test('on phones choosing another style in the settings rebuilds the handle and the drawer at once', async ({ open }) => {
    const { page, context } = await open({ style: 'ticks', viewport: { width: 375, height: 760 } });
    const read = async () => {
      const capsule = await capsules(page);
      await page.click('.bk-toc-handle');
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
      const index = { dots: await page.locator('.bk-toc-drawer-index .bk-toc-drawer-dot').count(), tabs: await page.locator('.bk-toc-drawer-index .bk-toc-drawer-tab').count() };
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().right <= 0);
      return { capsule, ...index };
    };
    assert.deepEqual(await read(), { capsule: 0, dots: 0, tabs: 6 });
    for (const [name, capsule, dots, tabs] of [
      ['圆点胶囊', 1, 6, 0],
      ['前文笔记', 0, 0, 6],
    ]) {
      await page.click('.bk-settings-toggle');
      await page.getByRole('radio', { name: new RegExp(name) }).click();
      await page.keyboard.press('Escape');
      await settle(page);
      assert.deepEqual(await read(), { capsule, dots, tabs }, name);
    }
  });

  test('on phones the handle and the settings button slide out of view to the left without reduced motion', async ({ open }) => {
    const { page, context } = await open({ viewport: { width: 375, height: 760 }, hasTouch: true, reducedMotion: 'no-preference' });
    const rightEdges = () => page.evaluate(() => [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].map((element) => element.getBoundingClientRect().right));
    const [handle, settings] = await rightEdges();
    assert.ok(handle > 0 && settings > 0);
    for (let step = 0; step < 5; step += 1) {
      await page.evaluate(() => window.scrollBy(0, 120));
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    }
    await page.waitForFunction(() => [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].every((element) => element.getBoundingClientRect().right <= 0));
  });

  test('on phones scrolling down fades the buttons out in place with reduced motion, scrolling up shows them, and the setting turns this off', async ({ open }) => {
    const { page, context } = await open({ viewport: { width: 375, height: 760 }, hasTouch: true });
    const placed = (opacity) =>
      page
        .waitForFunction(
          (value) => {
            const seenOpacity = (element) => (element === null ? 1 : Number(getComputedStyle(element).opacity) * seenOpacity(element.parentElement));
            return [document.querySelector('.bk-toc-handle'), document.querySelector('.bk-settings')].every((element) => element.getBoundingClientRect().left >= 0 && seenOpacity(element) === value);
          },
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
    const scrollBy = (delta) => scrollAndSettle(page, delta);
    assert.equal(await placed(1), true);
    await page.evaluate(() => {
      const handle = document.querySelector('.bk-toc-handle');
      const seenOpacity = (element) => (element === null ? 1 : Number(getComputedStyle(element).opacity) * seenOpacity(element.parentElement));
      window.handleFrames = [];
      const record = () => {
        window.handleFrames.push({ opacity: seenOpacity(handle), left: handle.getBoundingClientRect().left });
        window.handleRecording = requestAnimationFrame(record);
      };
      record();
    });
    await scrollBy(600);
    assert.equal(await placed(0), true);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.handleRecording);
      return window.handleFrames;
    });
    assert.ok(frames.some((frame) => frame.opacity > 0 && frame.opacity < 1), 'the handle disappeared without fading');
    assert.ok(frames.every((frame) => frame.left === 0), 'the handle moved while it faded');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings')).visibility === 'hidden');
    assert.deepEqual(await focusable(), [false, false]);
    await scrollBy(-200);
    assert.equal(await placed(1), true);
    assert.deepEqual(await focusable(), [true, true]);
    await scrollBy(600);
    await page.evaluate(() => scrollTo(0, 0));
    await settle(page);
    assert.equal(await placed(1), true);

    await page.click('.bk-settings-toggle');
    const toggle = page.getByRole('switch', { name: '向下滚动时隐藏按钮' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.mouse.click(300, 200);
    await scrollBy(800);
    assert.equal(await placed(1), true);
    await page.reload();
    await settle(page);
    await scrollBy(800);
    assert.equal(await placed(1), true, 'the buttons hide again after a reload');
  });

  test('on phones an article without a table of contents hides the settings button while scrolling down and shows it on scrolling up', async ({ open }) => {
    const { page, context } = await open({ path: 'plain', viewport: { width: 375, height: 760 }, hasTouch: true });
    const state = () =>
      page.evaluate(() => {
        const seenOpacity = (element) => (element === null ? 1 : Number(getComputedStyle(element).opacity) * seenOpacity(element.parentElement));
        return seenOpacity(document.querySelector('.bk-settings'));
      });
    assert.deepEqual([await page.locator('.bk-toc').count(), await page.locator('.bk-toc-handle').count()], [0, 0]);
    assert.equal(await state(), 1);
    await scrollAndSettle(page, 600);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings')).visibility === 'hidden', null, { timeout: 2000 });
    assert.equal(await state(), 0);
    await scrollAndSettle(page, -200);
    await expect.poll(state, { message: 'the settings button does not show again' }).toBe(1);
  });

  test('the style chosen in the settings applies at once, survives a reload and is applied before the page script runs', async ({ newContext }) => {
    const context = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`/2026-10/toc-dots/`);
    await settle(page);
    const read = () =>
      page.evaluate(() => ({
        views: ['.bk-toc', '.bk-toc-dots', '.bk-toc-ticks'].filter((selector) => document.querySelector(selector)?.checkVisibility()),
        left: Math.round(document.querySelector('.bk-article').getBoundingClientRect().left),
      }));
    const narrow = await read();
    assert.deepEqual(narrow.views, ['.bk-toc-dots']);
    assert.deepEqual(await page.locator('.bk-settings-label').allTextContents(), ['目录样式', '主题', '字号', '字重', '间距', '字体', '按钮']);
    await page.click('.bk-settings-toggle');
    await page.getByRole('radio', { name: /刻度线/ }).click();
    await settle(page);
    assert.deepEqual(await read(), { views: ['.bk-toc-ticks'], left: narrow.left });
    await page.getByRole('radio', { name: /前文笔记/ }).click();
    await settle(page);
    const notes = await read();
    assert.deepEqual(notes.views, ['.bk-toc']);
    assert.ok(notes.left > narrow.left, `the notes style leaves a column of ${notes.left} pixels for the table of contents, the dots style ${narrow.left}`);
    await page.getByRole('radio', { name: /刻度线/ }).click();
    await page.reload();
    await settle(page);
    assert.deepEqual(await read(), { views: ['.bk-toc-ticks'], left: narrow.left });
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(url);
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.bk-article').getBoundingClientRect().left)), narrow.left);
  });

  test('without scripts every style shows a readable table of contents whose links jump', async ({ newContext, open }) => {
    const { page: scripted } = await open();
    const notesLeft = await scripted.evaluate(() => Math.round(document.querySelector('.bk-article').getBoundingClientRect().left));
    for (const [path, viewport] of [
      ['toc', { width: 1440, height: 900 }],
      ['toc-dots', { width: 1440, height: 900 }],
      ['toc-dots', { width: 1100, height: 900 }],
      ['toc', { width: 375, height: 760 }],
    ]) {
      const context = await newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`/2026-10/${path}/`);
      const shown = await page.evaluate(() => ({
        label: document.querySelector('.bk-toc-label').innerText,
        entries: [...document.querySelectorAll('.bk-toc a')].filter((link) => link.checkVisibility({ opacityProperty: true }) && link.getBoundingClientRect().height > 10).map((link) => link.innerText.replace(/\s+/g, ' ')),
        left: Math.round(document.querySelector('.bk-article').getBoundingClientRect().left),
      }));
      assert.equal(shown.label, '目录');
      assert.deepEqual(shown.entries.slice(0, 4), ['01 第一章', '一之一', '一之二', '02 第2章'], `${path} at ${viewport.width}px`);
      assert.equal(shown.entries.length, 13);
      if (viewport.width === 1440) assert.equal(shown.left, notesLeft, `${path} keeps the left column for the table of contents`);
      await page.locator('.bk-toc a', { hasText: '第4章的小节' }).click();
      await page.waitForFunction(() => location.hash === '#chapter-4-a' && Math.abs(document.getElementById('chapter-4-a').getBoundingClientRect().top - 24) < 2);
    }
  });

  test('without scripts the section titles of the table of contents have the secondary ink colour', async ({ newContext }) => {
    for (const colorScheme of ['light', 'dark']) {
      const context = await newContext({ javaScriptEnabled: false, colorScheme });
      const page = await context.newPage();
      await page.goto(url);
      const { colors, ink2 } = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('span'));
        probe.style.color = 'var(--ink-2)';
        return { colors: [...new Set([...document.querySelectorAll('.bk-toc-section-title')].map((title) => getComputedStyle(title).color))], ink2: getComputedStyle(probe).color };
      });
      assert.deepEqual(colors, [ink2], colorScheme);
    }
  });

  test('the settings button covers no entry of the table of contents at short and tall viewports in an article with page-wide components', async ({ open }) => {
    for (const style of STYLES) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1440, height: 600 },
        { width: 1024, height: 900 },
        { width: 1024, height: 600 },
      ]) {
        const { page, context } = await open({ style, path: 'long', viewport });
        const selector = viewport.width < 1340 && style === 'notes' ? '.bk-toc-tick' : VISIBLE_ENTRIES[style];
        assert.ok((await page.locator(selector).count()) > 0, `${style} shows no entries at ${viewport.width}×${viewport.height}`);
        assert.deepEqual(await page.evaluate(coveredEntries, selector), [], `${style} at the top of the page, ${viewport.width}×${viewport.height}`);
        await scrollToHeading(page, 'chapter-9');
        await page.waitForFunction(() => document.querySelector('#chapter-9').closest('.bk-section').querySelector('page-box')?.textContent === 'A component as wide as the page.');
        await settle(page);
        assert.deepEqual(await page.evaluate(coveredEntries, selector), [], `${style} in the middle of the page, ${viewport.width}×${viewport.height}`);
        const box = await page.evaluate((entries) => {
          const all = [...document.querySelectorAll(entries)].map((entry) => entry.getBoundingClientRect()).filter((rect) => rect.height > 0);
          return { top: Math.min(...all.map((rect) => rect.top)), bottom: Math.max(...all.map((rect) => rect.bottom)) };
        }, style === 'notes' && viewport.width >= 1340 ? '.bk-toc-column' : selector);
        assert.ok(box.top >= 0 && box.bottom <= viewport.height, `${style} reaches outside the screen at ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
      }
    }
  });
});
