import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { article, createBlog, decodeImage, exampleBlog, writeFiles } from '../blog.js';
import { addPasskeyAuthenticator, test as base, expect, luminance, settle, startDev } from './browser.js';
import { openWithSelectionModule } from './selection-module.js';

const widths = [1440, 1100, 375];
const activationsSource = readFileSync(join(exampleBlog, 'content/posts/activations/index.md'), 'utf8');
const activationsRows = Object.fromEntries([...activationsSource.matchAll(/^## (.+?) \{[^}]*rows=(\d+)[^}]*\}$/gm)].map(([, title, rows]) => [title, Number(rows)]));
const ROW_HEIGHT = 24;
const englishCards = (one) => article({ title: 'Cards', slug: 'cards', extra: 'theme: bento\n', body: `Text before the first section.\n\n## One\n\n${one}\n\n## Two\n\nText.\n\n## Three {width=wide}\n\nText.\n\n## Four {rows=2}\n\n${'Text that does not fit into two rows. '.repeat(20)}\n` });

const cardsArticle = article({
  title: 'Bento cards',
  slug: 'bento-cards',
  extra: 'category: writing\ntheme: bento\n',
  body: `A paragraph before the first section.

## Wide section {width=wide}

Text.

## Body one

Text with a note.[^one]

[^one]: A note at the bottom of this card.

## Body two

Text.

## Page section {width=page}

Text.

## Component

:::glu-heatmap{width=560px}
:::

## Body three

Text.

## Body four

Text.

## Fixed {cols=3 rows=4}

A short paragraph with a note.[^fixed]

[^fixed]: A note that the rows of this card hide.

${'A long paragraph that does not fit into four rows. '.repeat(30)}

Last line.
`,
});

const gapsArticle = article({
  title: 'Bento gaps',
  slug: 'bento-gaps',
  extra: 'category: writing\ntheme: bento\n',
  body: `## Tall {cols=3 rows=12}

Text.

:::sticker{rows=3}
🧪
:::

## Short {cols=3 rows=4}

Text.

## Across {cols=6 rows=4}

Text.

:::note{rows=4 color=green}
A note.
:::
`,
});

const englishBlog = {
  'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', theme: 'bento', themes: { bento: { columns: 2 } } };\n",
  'content/posts/cards/index.md': englishCards('Text.'),
};

const test = base.extend({
  open: async ({ newPage }, use) => {
    await use(async (path, options = {}) => {
      const page = await newPage(options);
      await page.goto(`/2026-10/${path}/`);
      if (options.javaScriptEnabled !== false) await settle(page);
      return page;
    });
  },
});

async function resize(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await settle(page);
}

test.use({ reducedMotion: 'reduce', blog: { files: { 'content/posts/bento-cards/index.md': cardsArticle, 'content/posts/bento-gaps/index.md': gapsArticle } } });

test.describe('the bento theme lays out sections as cards', () => {
  test('cards span the columns their sections ask for, the cards keep the order of the article and every card takes the whole row on a phone', async ({ open }) => {
    const page = await open('bento-cards');
    const desktop = { 'Wide section': 3, 'Body one': 2, 'Body two': 2, 'Page section': 6, Component: 3, 'Body three': 2, 'Body four': 2, Fixed: 3 };
    for (const width of [1440, 1100]) {
      await resize(page, width);
      const grid = await page.evaluate(gridLayout, 6);
      assert.deepEqual(grid.spans, desktop, `${width}px`);
      assert.ok(grid.inOrder, `${width}px`);
    }
    await resize(page, 375);
    const phone = await page.evaluate(gridLayout, 1);
    assert.ok(phone.fullWidth && phone.inOrder, '375px');
  });

  test('stickers and notes fill the gaps that the section cards leave from 1000 pixels up and follow the order of the article below', async ({ open }) => {
    const page = await open('bento-gaps');
    const cards = () =>
      page.evaluate(() => {
        const grid = document.querySelector('.bt-grid');
        const gap = parseFloat(getComputedStyle(grid).columnGap);
        const column = (grid.clientWidth - 5 * gap) / 6;
        return [...grid.children].map((card) => {
          const box = card.getBoundingClientRect();
          const origin = grid.getBoundingClientRect();
          const style = getComputedStyle(card);
          const packed = grid.hasAttribute('data-packed');
          const left = packed ? parseFloat(style.getPropertyValue('--bt-x')) : box.left - origin.left;
          const top = packed ? parseFloat(style.getPropertyValue('--bt-y')) : box.top - origin.top;
          return { name: card.dataset.themeBlock ?? card.querySelector('h2 .bk-heading-text').textContent, start: Math.round(left / (column + gap)), top: Math.round(top) };
        });
      });
    for (const width of [1440, 1100]) {
      await resize(page, width);
      const placed = Object.fromEntries((await cards()).map(({ name, start, top }) => [name, { start, top }]));
      const short = 4 * ROW_HEIGHT + 3 * 6 + 6;
      assert.deepEqual(placed, { Tall: { start: 0, top: 0 }, sticker: { start: 3, top: short }, Short: { start: 3, top: 0 }, Across: { start: 0, top: 12 * ROW_HEIGHT + 11 * 6 + 6 }, note: { start: 4, top: short } }, `${width}px`);
      assert.deepEqual(await page.evaluate(overlappingCards), [], `${width}px`);
    }
    await resize(page, 375);
    const narrow = await cards();
    assert.deepEqual(narrow.map(({ name }) => name), ['Tall', 'sticker', 'Short', 'Across', 'note']);
    assert.ok(narrow.every(({ top }, index) => index === 0 || top >= narrow[index - 1].top), JSON.stringify(narrow));
  });

  test('below 1000 pixels the cards wrap into rows in the order of the article, a card is as wide as its span in desktop columns or takes the row when that is more than half of it, and the cards of a row fill it and are equally tall', async ({ open }) => {
    const page = await open('bento-cards');
    const expected = {
      768: [['Wide section'], ['Body one', 'Body two'], ['Page section'], ['Component', 'Body three'], ['Body four'], ['Fixed']],
      600: [['Wide section'], ['Body one', 'Body two'], ['Page section'], ['Component', 'Body three'], ['Body four'], ['Fixed']],
      430: [['Wide section'], ['Body one'], ['Body two'], ['Page section'], ['Component'], ['Body three'], ['Body four'], ['Fixed']],
    };
    for (const [width, names] of Object.entries(expected)) {
      await resize(page, Number(width));
      const rows = await page.evaluate(() => {
        const grid = document.querySelector('.bt-grid');
        const gap = parseFloat(getComputedStyle(grid).columnGap);
        const rows = [];
        for (const card of grid.querySelectorAll(':scope > .bt-card')) {
          const box = card.getBoundingClientRect();
          const row = rows.at(-1);
          if (row !== undefined && Math.abs(row.top - box.top) < 0.5) row.cards.push({ card, box });
          else rows.push({ top: box.top, cards: [{ card, box }] });
        }
        return rows.map(({ cards }) => ({
          names: cards.map(({ card }) => card.querySelector('h2 .bk-heading-text').textContent),
          free: grid.clientWidth - cards.reduce((sum, { box }) => sum + box.width, 0) - gap * (cards.length - 1),
          inOrder: cards.every(({ box }, index) => index === 0 || box.left > cards[index - 1].box.right),
          heights: new Set(cards.map(({ box }) => Math.round(box.height))).size,
        }));
      });
      assert.deepEqual(rows.map((row) => row.names), names, `${width}px`);
      for (const row of rows) assert.deepEqual([Math.abs(row.free) < 1, row.inOrder, row.heights], [true, true, 1], `${width}px ${row.names.join(', ')}: ${JSON.stringify(row)}`);
    }
    const still = await open('bento-cards', { javaScriptEnabled: false, viewport: { width: 768, height: 900 } });
    assert.ok((await still.evaluate(gridLayout, 1)).fullWidth);
  });

  test('a card with rows is as tall as its rows from 1000 pixels up, every other card is as tall as its content, and sidenotes follow the last block', async ({ open }) => {
    const page = await open('activations');
    for (const width of widths) {
      await resize(page, width);
      if (width >= 1000) {
        const heights = await page.evaluate(
          ([rowsByTitle, row]) => {
            const grid = document.querySelector('.bt-grid');
            const gap = parseFloat(getComputedStyle(grid).rowGap);
            return [...grid.querySelectorAll('section.bt-card')]
              .map((card) => ({ card, rows: rowsByTitle[card.querySelector('h2 .bk-heading-text').textContent] }))
              .filter(({ rows }) => rows !== undefined)
              .map(({ card, rows }) => ({ rows, height: Math.round(card.getBoundingClientRect().height * 10) / 10, expected: Math.round((rows * row + (rows - 1) * gap) * 10) / 10 }));
          },
          [activationsRows, ROW_HEIGHT],
        );
        assert.equal(heights.length, Object.keys(activationsRows).length, `${width}px`);
        assert.deepEqual(heights.filter(({ height, expected }) => Math.abs(height - expected) > 0.5), [], `${width}px`);
        continue;
      }
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll('section.bt-card')].map((card) => {
          const style = getComputedStyle(card);
          const contentBottom = card.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
          const notes = card.querySelector(':scope > .bt-notes');
          const gapAfterContent = Math.round(contentBottom - card.lastElementChild.getBoundingClientRect().bottom);
          const gapBeforeNotes = notes === null ? 0 : Math.round(notes.getBoundingClientRect().top - notes.previousElementSibling.getBoundingClientRect().bottom);
          return { title: card.querySelector('h2 .bk-heading-text').textContent, gapAfterContent, gapBeforeNotes };
        }),
      );
      assert.deepEqual(
        cards.filter(({ gapAfterContent, gapBeforeNotes }) => gapAfterContent > 1 || gapBeforeNotes > 1),
        [],
        `${width}px`,
      );
    }
  });

  test('each card goes to the columns that end highest, in the order of the article', async ({ open }) => {
    const page = await open('activations');
    for (const width of [1440, 1100]) {
      await resize(page, width);
      const grid = await page.evaluate(gridLayout, 6);
      assert.deepEqual(grid.starts, { ReLU: 0, GELU: 2, SiLU: 4, 导数: 4, 怎么选: 2, 反向传播: 0, 实现: 0, '写成 Markdown': 4, 对比: 0, 参考文献: 4 }, `${width}px`);
      assert.ok(grid.inOrder, `${width}px`);
      assert.deepEqual(await page.evaluate(overlappingCards), [], `${width}px`);
    }
  });

  test('content that does not fit into the rows of a card fades out at the bottom and scrolls inside the card only after the card is chosen by a click or the keyboard', async ({ open }) => {
    const page = await open('bento-cards', { reducedMotion: 'no-preference' });
    const card = page.locator('.bt-card').filter({ has: page.getByRole('heading', { name: 'Fixed' }) });
    const outline = () => card.evaluate((element) => getComputedStyle(element).outlineColor);
    const unchosen = await outline();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => scrollY > 0);
    assert.equal(await card.evaluate((element) => element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element, '::after').content !== 'none'), true);
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const pageTop = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, -200);
    await page.waitForFunction((top) => scrollY < top, pageTop);
    assert.equal(await card.evaluate((element) => element.scrollTop), 0);
    const chosen = await card.boundingBox();
    await page.mouse.click(chosen.x + chosen.width / 2, chosen.y + chosen.height / 2);
    await page.waitForFunction((before) => getComputedStyle([...document.querySelectorAll('.bt-card')].at(-1)).outlineColor !== before, unchosen);
    const top = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 2000);
    await card.evaluate((element) => new Promise((done) => {
      const check = () => (element.scrollTop + element.clientHeight >= element.scrollHeight - 1 ? done() : requestAnimationFrame(check));
      check();
    }));
    assert.equal(await page.evaluate(() => scrollY), top);
    await page.keyboard.press('Escape');
    await page.waitForFunction((before) => getComputedStyle([...document.querySelectorAll('.bt-card')].at(-1)).outlineColor === before, unchosen);
    await page.mouse.click(5, 5);
    await card.focus();
    await page.waitForFunction((before) => getComputedStyle([...document.querySelectorAll('.bt-card')].at(-1)).outlineColor !== before, unchosen);
    await card.evaluate((element) => element.blur());
    await page.waitForFunction((before) => getComputedStyle([...document.querySelectorAll('.bt-card')].at(-1)).outlineColor === before, unchosen);
    await resize(page, 375);
    assert.equal(await card.evaluate((element) => element.scrollHeight > element.clientHeight + 1), false);
  });

  test('a click on a sidenote number chooses its card and scrolls the note into view when the rows of the card hide it, and the chosen card has an outline in the accent colour', async ({ open }) => {
    const page = await open('bento-cards');
    const card = page.locator('.bt-card').filter({ has: page.getByRole('heading', { name: 'Fixed' }) });
    await card.locator('.sidenote-ref a').scrollIntoViewIfNeeded();
    const hidden = await card.evaluate((element) => element.querySelector('.bk-sidenote').getBoundingClientRect().top >= element.getBoundingClientRect().bottom);
    assert.equal(hidden, true);
    await card.locator('.sidenote-ref a').click();
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('.bt-card')].at(-1);
      const note = card.querySelector('.bk-sidenote').getBoundingClientRect();
      const frame = card.getBoundingClientRect();
      return note.top >= frame.top && note.bottom <= frame.bottom && note.top >= 0 && note.bottom <= innerHeight;
    });
    const outline = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      element.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { width: style.outlineWidth, color: style.outlineColor === accent };
    });
    assert.deepEqual(outline, { width: '2px', color: true });
  });

  test('no page scrolls horizontally', async ({ open }) => {
    const overflowing = [];
    for (const path of ['bento-cards', 'activations']) {
      const page = await open(path);
      for (const width of [...widths, 1000, 600]) {
        await resize(page, width);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scrollWidth > width) overflowing.push(`${path} at ${width}px is ${scrollWidth}px wide`);
      }
    }
    assert.deepEqual(overflowing, []);
  });

  test('sidenotes sit at the bottom of their card and there is no table of contents', async ({ open }) => {
    const page = await open('activations');
    for (const width of widths) {
      await resize(page, width);
      const notes = await page.evaluate(() =>
        [...document.querySelectorAll('.bt-card')].flatMap((card) => {
          const list = card.querySelector(':scope > .bt-notes');
          if (list === null) return [];
          const box = card.getBoundingClientRect();
          const padding = parseFloat(getComputedStyle(card).paddingBottom) + parseFloat(getComputedStyle(card).borderBottomWidth);
          const above = [...card.children].filter((child) => child !== list).every((child) => child.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 0.5);
          const atBottom = innerWidth >= 1000 || Math.abs(box.bottom - padding - list.getBoundingClientRect().bottom) < 1;
          return [{ notes: list.querySelectorAll('.bk-sidenote').length, visible: list.checkVisibility(), atBottom, above, last: card.lastElementChild === list }];
        }),
      );
      assert.deepEqual(
        notes,
        [
          { notes: 1, visible: true, atBottom: true, above: true, last: true },
          { notes: 1, visible: true, atBottom: true, above: true, last: true },
        ],
        `${width}px`,
      );
    }
    assert.equal(await page.locator('.bk-toc, nav').count(), 0);
  });

  test('a component in a card loads and keeps its frame inside the card', async ({ open }) => {
    for (const width of widths) {
      const page = await open('activations', { viewport: { width, height: 900 } });
      const frame = page.locator('.bt-card figure.component');
      await frame.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.bt-card figure.component').dataset.state === 'ready');
      const fits = await frame.evaluate((figure) => {
        const card = figure.closest('.bt-card').getBoundingClientRect();
        const box = figure.getBoundingClientRect();
        const element = figure.querySelector('.component-box > *').getBoundingClientRect();
        return box.left >= card.left && box.right <= card.right && element.height > 100;
      });
      assert.ok(fits, `${width}px`);
      const typography = await frame.evaluate((figure) => {
        const box = getComputedStyle(figure.querySelector('.component-box'));
        const card = getComputedStyle(figure.closest('.bt-card'));
        return { box: [box.fontSize, box.lineHeight], card: [card.fontSize, card.lineHeight] };
      });
      assert.deepEqual(typography.box, typography.card, `${width}px`);
      assert.deepEqual(typography.box, { 1440: ['15.5px', '27.9px'], 1100: ['14px', '21.7px'], 375: ['15px', '27px'] }[width], `${width}px`);
    }
  });

  test('dark mode changes the page and the cards', async ({ open }) => {
    const colors = async (colorScheme) => {
      const page = await open('activations', { colorScheme });
      return (await page.evaluate(() => [document.body, document.querySelector('.bt-card')].map((element) => getComputedStyle(element).backgroundColor))).map(luminance);
    };
    const [darkPage, darkCard] = await colors('dark');
    const [lightPage, lightCard] = await colors('light');
    assert.ok(darkPage < 0.2 && lightPage > 0.8, `the page has the luminance ${darkPage} in dark and ${lightPage} in light mode`);
    assert.ok(darkCard > darkPage && lightCard > lightPage, 'the cards stand out from the page');
  });

  test('a code block, a table or a display formula that fits its card shows no scroll shadow at its edges', async ({ open }) => {
    for (const colorScheme of ['light', 'dark']) {
      const page = await open('activations', { colorScheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      const boxes = page.locator('.bt-card :is(pre.shiki, .table-scroll, mjx-container[display])');
      const leaks = [];
      for (let index = 0; index < (await boxes.count()); index += 1) {
        const box = boxes.nth(index);
        if (await box.evaluate((element) => !element.checkVisibility() || element.scrollWidth > element.clientWidth)) continue;
        await box.scrollIntoViewIfNeeded();
        const shown = await box.screenshot();
        await box.evaluate((element) => (element.style.backgroundImage = 'none'));
        const plain = await box.screenshot();
        await box.evaluate((element) => element.style.removeProperty('background-image'));
        const difference = largestDifference(await decodeImage(shown), await decodeImage(plain));
        if (difference > 2) leaks.push(`${colorScheme}: ${await box.evaluate((element) => element.closest('.bt-card').querySelector('h2 .bk-heading-text').textContent)} ${index} differs by ${difference}`);
      }
      assert.deepEqual(leaks, []);
    }
  });

  test('the code blocks, tables and display formulas of the example article fit their cards, code wraps on a phone, and a component in a card has no frame of its own', async ({ open }) => {
    for (const width of [1440, 1100, 1000, 375]) {
      const page = await open('activations', { viewport: { width, height: 900 } });
      const overflowing = await page.evaluate((phone) =>
        [...document.querySelectorAll(phone ? '.bt-card pre.shiki' : '.bt-card :is(pre.shiki, .table-scroll, mjx-container[display])')]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => `${element.closest('.bt-card').querySelector('h2 .bk-heading-text').textContent} ${element.localName}`),
      width < 1000);
      assert.deepEqual(overflowing, [], `${width}px`);
      const frame = await page.locator('.bt-card figure.component').evaluate((figure) => {
        const style = getComputedStyle(figure);
        return [style.borderTopWidth, style.paddingLeft, style.boxShadow];
      });
      assert.deepEqual(frame, ['0px', '0px', 'none'], `${width}px`);
    }
  });

  test('without scripts the cards keep their declared spans and every sidenote is shown', async ({ open }) => {
    const page = await open('bento-cards', { javaScriptEnabled: false });
    const grid = await page.evaluate(gridLayout, 6);
    assert.deepEqual(grid.spans, { 'Wide section': 3, 'Body one': 2, 'Body two': 2, 'Page section': 6, Component: 2, 'Body three': 2, 'Body four': 2, Fixed: 3 });
    assert.ok(await page.evaluate(() => { const card = [...document.querySelectorAll('.bt-card')].at(-1); return card.scrollHeight <= card.clientHeight + 1; }));
    assert.equal(await page.locator('.bk-sidenote').evaluateAll((notes) => notes.every((note) => note.checkVisibility())), true);
  });

  test('the settings panel offers the theme, the text size, the weight, the spacing and the font and no table of contents style', async ({ open }) => {
    for (const width of [1440, 375]) {
      const page = await open('activations', { viewport: { width, height: 900 } });
      await page.locator('.bk-settings-toggle').click();
      const rows = await page.locator('.bk-settings-label').evaluateAll((labels) => labels.filter((label) => label.checkVisibility()).map((label) => label.textContent));
      assert.deepEqual(rows, ['主题', '字号', '字重', '间距', '字体'], `${width}px`);
      await page.locator('.bk-settings-row[data-setting="theme"] button[data-value="dark"]').click();
      await expect.poll(async () => luminance(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)), `${width}px`).toBeLessThan(0.2);
    }
  });

  test('copying a selection or the whole article gives its Markdown', async ({ page, context, after }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openWithSelectionModule(page, '/2026-10/activations/');
    await settle(page);
    const lines = activationsSource.split('\n');
    const between = (first, last) => {
      const start = lines.findIndex((line) => line.startsWith(first));
      const end = lines.findIndex((line, index) => index > start && line.startsWith(last));
      return lines.slice(start, end + 1).join('\n');
    };
    const copy = async (start, end) => {
      await page.evaluate(
        ([start, end]) => {
          const point = ({ selector, text, after }) => {
            const element = document.querySelector(selector);
            if (text === undefined) return [element, after ? element.childNodes.length : 0];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const index = walker.currentNode.data.indexOf(text);
              if (index !== -1) return [walker.currentNode, index + (after ? text.length : 0)];
            }
            throw new Error(`"${text}" is not in ${selector}`);
          };
          const range = document.createRange();
          range.setStart(...point(start));
          range.setEnd(...point(end));
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        },
        [start, end],
      );
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press('ControlOrMeta+C');
      return page.evaluate(() => navigator.clipboard.readText());
    };
    const block = (start) => `.bt-card > .bk-block[data-line="${lines.findIndex((line) => line.startsWith(start)) + 1}"]`;
    assert.equal(
      await copy({ selector: block('它在 0 附近'), text: '它在' }, { selector: block('它在 0 附近'), text: 'GELU。', after: true }),
      `${lines.find((line) => line.startsWith('它在 0 附近'))}\n\n${lines.find((line) => line.startsWith('[^gelu-min]:'))}`,
    );
    assert.equal(await copy({ selector: '.bt-card > h2#gelu' }, { selector: block('GELU 用标准正态分布'), after: true }), between('## GELU', 'GELU 用标准正态分布'));
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].filter((toast) => getComputedStyle(toast).opacity === '1').length === 1);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.locator('.bk-header .bk-copy-source').click();
    await page.waitForFunction((expected) => navigator.clipboard.readText().then((text) => text === expected), activationsSource);
  });
});

test.describe('the settings button and the AI chat button of the bento theme', () => {
  for (const [name, url, blog] of [
    ['the example blog', '/2026-10/bento-cards/', { files: { 'content/posts/bento-cards/index.md': cardsArticle }, localhost: true }],
    ['a blog with two columns', '/2026-10/cards/', { example: false, files: englishBlog, localhost: true }],
  ]) {
    test.describe(name, () => {
      test.use({ blog });

      test('the buttons sit on one line in equal gutters and cover no card and not the text before the first section from 1000 pixels up', async ({ page, context }) => {
        await addPasskeyAuthenticator(context, page);
        const problems = [];
        const measure = () =>
          page.evaluate(() => {
            const settings = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
            const chat = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher').getBoundingClientRect();
            const boxes = [...document.querySelectorAll('.bt-card, .bt-intro')].map((element) => element.getBoundingClientRect());
            const left = Math.min(...boxes.map((box) => box.left));
            const right = Math.max(...boxes.map((box) => box.right));
            const covers = (button) => boxes.some((box) => box.left < button.right && box.right > button.left);
            return { settingsGap: left - settings.right, chatGap: chat.left - right, covered: covers(settings) || covers(chat), gutters: [left, document.documentElement.clientWidth - right], bottoms: [settings.bottom, chat.bottom] };
          });
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('[data-bake-chat]')?.shadowRoot.querySelector('.bk-chat-launcher') != null);
        for (const width of [1440, 1340, 1339, 1100, 1000, 999, 375]) {
          await resize(page, width);
          const { settingsGap, chatGap, covered, gutters, bottoms } = await measure();
          const at = `${url} at ${width}px`;
          if (Math.abs(bottoms[0] - bottoms[1]) > 0.5) problems.push(`${at}: the buttons end at ${bottoms.join(' and ')}`);
          if (Math.abs(gutters[0] - gutters[1]) > 1) problems.push(`${at}: the gutters are ${gutters.join(' and ')}`);
          if (width < 1000) continue;
          if (covered) problems.push(`${at}: a button covers a card or the intro`);
          if (settingsGap < 16) problems.push(`${at}: the settings button is ${settingsGap}px from the content`);
          if (Math.abs(chatGap - 12) > 1) problems.push(`${at}: the chat button is ${chatGap}px from the content`);
        }
        assert.deepEqual(problems, []);
      });
    });
  }
});

test.describe('the bento theme in a blog with two columns', () => {
  test.use({ blog: { example: false, files: englishBlog } });

  test('the column count follows themes.bento.columns in bake.config.js', async ({ open }) => {
    const page = await open('cards');
    const grid = await page.evaluate(gridLayout, 2);
    assert.deepEqual({ spans: grid.spans, inOrder: grid.inOrder }, { spans: { One: 1, Two: 1, Three: 2, Four: 1 }, inOrder: true });
  });

  test('in bake dev a card whose content does not fit shows the rows it needs, and the cards are placed again after the article is saved', async ({ page, after }) => {
    const dir = createBlog({ after }, englishBlog);
    const dev = await startDev(dir);
    after(dev.close);
    await page.goto(new URL('2026-10/cards/', dev.url).href);
    await settle(page);
    const card = page.locator('.bt-card').filter({ has: page.getByRole('heading', { name: 'Four' }) });
    const hint = () => card.evaluate((element) => getComputedStyle(element, '::before').content);
    await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll('.bt-card')].at(-1), '::before').content.startsWith('"Content'));
    const [, pixels, rows] = /^"Content is (\d+) px taller than the card; set rows to at least (\d+)"$/.exec(await hint());
    const fit = await card.evaluate(
      (element, [rows, rowHeight]) => {
        const style = getComputedStyle(element);
        const gap = parseFloat(getComputedStyle(element.parentElement).rowGap);
        const needed = element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const height = (count) => count * rowHeight + (count - 1) * gap;
        return { overflow: Math.ceil(element.scrollHeight - element.clientHeight), fits: height(rows) >= needed, fitsWithOneLess: height(rows - 1) >= needed };
      },
      [Number(rows), ROW_HEIGHT],
    );
    assert.deepEqual(fit, { overflow: Number(pixels), fits: true, fitsWithOneLess: false });
    const before = await page.evaluate(gridLayout, 2);
    // why: macOS starts reporting changes a moment after fs.watch returns and drops what happens before, so the file is written until the page shows it
    for (let attempt = 0; !(await page.getByText('Saved text.').isVisible()); attempt += 1) {
      assert.ok(attempt < 50, 'the page did not show the saved article');
      writeFiles(dir, { 'content/posts/cards/index.md': englishCards('Saved text.') });
      await page.waitForTimeout(200);
    }
    await settle(page);
    assert.deepEqual(await page.evaluate(gridLayout, 2), before);
  });
});

function gridLayout(columns) {
  const grid = document.querySelector('.bt-grid');
  const gap = parseFloat(getComputedStyle(grid).columnGap);
  const origin = grid.getBoundingClientRect();
  const track = (origin.width - gap * (columns - 1)) / columns;
  const cards = [...grid.querySelectorAll(':scope > section.bt-card')].map((card) => ({ title: card.querySelector('h2 .bk-heading-text').textContent, box: card.getBoundingClientRect() }));
  const spans = Object.fromEntries(cards.map(({ title, box }) => [title, Math.round((box.width + gap) / (track + gap))]));
  const starts = Object.fromEntries(cards.map(({ title, box }) => [title, Math.round((box.left - origin.left) / (track + gap))]));
  const inOrder = cards.every(({ box }, index) =>
    cards.slice(0, index).every(({ box: earlier }) => {
      const sameColumns = box.left < earlier.right - 1 && box.right > earlier.left + 1;
      if (sameColumns) return box.top > earlier.top;
      return Math.abs(box.top - earlier.top) >= 0.5 || box.left > earlier.left;
    }),
  );
  const fullWidth = cards.every(({ box }) => Math.abs(box.width - origin.width) < 1);
  return { spans, starts, inOrder, fullWidth };
}

function largestDifference(first, second) {
  const corner = 20;
  let largest = 0;
  for (let y = corner; y < first.height - corner; y += 1) {
    for (let index = y * first.width * 4; index < (y + 1) * first.width * 4; index += 1) largest = Math.max(largest, Math.abs(first.data[index] - second.data[index]));
  }
  return largest;
}

function overlappingCards() {
  const gap = parseFloat(getComputedStyle(document.querySelector('.bt-grid')).columnGap);
  // why: the bounding box of a tilted sticker is larger than the box the packing gives it
  const layoutBox = (card) => {
    const style = getComputedStyle(card);
    const left = parseFloat(style.getPropertyValue('--bt-x'));
    const top = parseFloat(style.getPropertyValue('--bt-y'));
    return { left, top, right: left + card.offsetWidth, bottom: top + card.offsetHeight };
  };
  const cards = [...document.querySelectorAll('.bt-grid > .bt-card')].map((card) => ({ line: card.dataset.line ?? card.querySelector('h2').dataset.line, box: layoutBox(card) }));
  return cards.flatMap(({ line, box }, index) =>
    cards
      .slice(index + 1)
      .filter(({ box: other }) => box.left < other.right + gap - 0.5 && other.left < box.right + gap - 0.5 && box.top < other.bottom + gap - 0.5 && other.top < box.bottom + gap - 0.5)
      .map((other) => `${line} and ${other.line}`),
  );
}
