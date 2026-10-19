import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, writeFiles } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const widths = [1440, 1100, 375];
const activationsSource = readFileSync(join(exampleBlog, 'content/posts/activations/index.md'), 'utf8');

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
`,
});

test('the bento theme lays out sections as cards', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-bento-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  writeFiles(dir, { 'content/posts/bento-cards/index.md': cardsArticle });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'));

  const english = mkdtempSync(join(tmpdir(), 'bake-bento-english-'));
  t.after(() => rmSync(english, { recursive: true, force: true }));
  writeFiles(english, {
    'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', bento: { columns: 2 } };\n",
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', extra: 'theme: bento\n', body: 'Text before the first section.\n\n## One\n\nText.\n\n## Two\n\nText.\n\n## Three {width=wide}\n\nText.\n' }),
  });
  const englishBuild = bake(english, 'build');
  assert.equal(englishBuild.stderr, '');
  const englishOrigin = await serve(t, join(english, 'dist'));

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const open = async (path, options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
    await page.goto(`${origin}/2026-10/${path}/`);
    if (options.javaScriptEnabled !== false) await settle(page);
    return page;
  };
  const resize = async (page, width) => {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
  };

  await t.test('cards span the columns their sections ask for, the cards keep the order of the article and the column count drops on narrow screens', async () => {
    const page = await open('bento-cards');
    const expected = {
      1440: { columns: 4, spans: { 'Wide section': 2, 'Body one': 1, 'Body two': 1, 'Page section': 4, Component: 2, 'Body three': 1, 'Body four': 1 } },
      1100: { columns: 2, spans: { 'Wide section': 2, 'Body one': 1, 'Body two': 1, 'Page section': 2, Component: 2, 'Body three': 1, 'Body four': 1 } },
      375: { columns: 1, spans: { 'Wide section': 1, 'Body one': 1, 'Body two': 1, 'Page section': 1, Component: 1, 'Body three': 1, 'Body four': 1 } },
    };
    for (const width of widths) {
      await resize(page, width);
      const grid = await page.evaluate(gridLayout);
      assert.deepEqual({ columns: grid.columns, spans: grid.spans }, expected[width], `${width}px`);
      assert.ok(grid.inOrder, `${width}px`);
    }
    await page.close();
  });

  await t.test('the column count follows bento.columns in bake.config.js', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(`${englishOrigin}/2026-10/cards/`);
    await settle(page);
    assert.deepEqual(await page.evaluate(gridLayout), { columns: 2, spans: { One: 1, Two: 1, Three: 2 }, inOrder: true });
    await page.close();
  });

  await t.test('the settings button covers no card and not the text before the first section from 1000 pixels up, with a gap of 16 to 24 pixels', async () => {
    const covered = [];
    const gaps = [];
    for (const url of [`${origin}/2026-10/bento-cards/`, `${englishOrigin}/2026-10/cards/`]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(url);
      for (const width of [1440, 1340, 1339, 1100, 1000]) {
        await resize(page, width);
        const { hits, gap } = await page.evaluate(() => {
          const button = document.querySelector('.bk-settings-toggle').getBoundingClientRect();
          const boxes = [...document.querySelectorAll('.bt-card, .bt-intro')].map((element) => ({ name: element.className, box: element.getBoundingClientRect() }));
          return {
            hits: boxes.filter(({ box }) => box.left < button.right && box.right > button.left).map(({ name }) => name),
            gap: Math.min(...boxes.map(({ box }) => box.left)) - button.right,
          };
        });
        if (hits.length > 0) covered.push(`${url} at ${width}px: ${[...new Set(hits)].join(', ')}`);
        if (gap < 16 || gap > 24) gaps.push(`${url} at ${width}px: ${gap}px`);
      }
      await page.close();
    }
    assert.deepEqual(covered, []);
    assert.deepEqual(gaps, []);
  });

  await t.test('a card is as tall as its content and its sidenotes follow its last block', async () => {
    const page = await open('activations');
    for (const width of widths) {
      await resize(page, width);
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll('.bt-card')].map((card) => {
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
    await page.close();
  });

  await t.test('no page scrolls horizontally', async () => {
    const overflowing = [];
    for (const path of ['bento-cards', 'activations']) {
      const page = await open(path);
      for (const width of [...widths, 1000, 600]) {
        await resize(page, width);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scrollWidth > width) overflowing.push(`${path} at ${width}px is ${scrollWidth}px wide`);
      }
      await page.close();
    }
    assert.deepEqual(overflowing, []);
  });

  await t.test('sidenotes sit at the bottom of their card and there is no table of contents', async () => {
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
          return [{ notes: list.querySelectorAll('.bk-sidenote').length, visible: list.checkVisibility(), atBottom: Math.abs(box.bottom - padding - list.getBoundingClientRect().bottom) < 1, above, last: card.lastElementChild === list }];
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
    await page.close();
  });

  await t.test('a component in a card loads and keeps its frame inside the card', async () => {
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
      await page.close();
    }
  });

  await t.test('dark mode changes the page and the cards', async () => {
    const colors = (page) => page.evaluate(() => [document.body, document.querySelector('.bt-card')].map((element) => getComputedStyle(element).backgroundColor));
    const dark = await open('activations', { colorScheme: 'dark' });
    assert.deepEqual(await colors(dark), ['rgb(17, 20, 19)', 'rgb(26, 30, 28)']);
    await dark.close();
    const light = await open('activations', { colorScheme: 'light' });
    assert.deepEqual(await colors(light), ['rgb(245, 246, 244)', 'rgb(255, 255, 255)']);
    await light.close();
  });

  await t.test('without scripts the cards keep their declared spans and every sidenote is shown', async () => {
    const page = await open('bento-cards', { javaScriptEnabled: false });
    const grid = await page.evaluate(gridLayout);
    assert.deepEqual(grid.spans, { 'Wide section': 2, 'Body one': 1, 'Body two': 1, 'Page section': 4, Component: 1, 'Body three': 1, 'Body four': 1 });
    assert.equal(await page.locator('.bk-sidenote').evaluateAll((notes) => notes.every((note) => note.checkVisibility())), true);
    await page.close();
  });

  await t.test('the cards are placed again after bake dev replaces the article', async () => {
    const page = await open('bento-cards');
    await page.evaluate(() => {
      const article = document.querySelector('.bk-article');
      article.innerHTML = article.innerHTML.replaceAll(/ style="grid-column:[^"]*"/g, '');
      document.dispatchEvent(new CustomEvent('bake:content'));
    });
    await settle(page);
    assert.deepEqual((await page.evaluate(gridLayout)).spans, { 'Wide section': 2, 'Body one': 1, 'Body two': 1, 'Page section': 4, Component: 2, 'Body three': 1, 'Body four': 1 });
    await page.close();
  });

  await t.test('the settings panel offers the theme and the body font and no table of contents style', async () => {
    for (const width of [1440, 375]) {
      const page = await open('activations', { viewport: { width, height: 900 } });
      await page.locator('.bk-settings-toggle').click();
      const rows = await page.locator('.bk-settings-row').evaluateAll((elements) => elements.filter((row) => row.checkVisibility()).map((row) => row.dataset.setting));
      assert.deepEqual(rows, ['theme', 'font'], `${width}px`);
      await page.locator('.bk-settings-row[data-setting="theme"] button[data-value="dark"]').click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 20, 19)', `${width}px`);
      await page.close();
    }
  });

  await t.test('copying a selection or the whole article gives its Markdown', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(`${origin}/2026-10/activations/`);
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
      await page.keyboard.press('Control+C');
      return page.evaluate(() => navigator.clipboard.readText());
    };
    const block = (start) => `.bt-card > .bk-block[data-line="${lines.findIndex((line) => line.startsWith(start)) + 1}"]`;
    assert.equal(
      await copy({ selector: block('它在 0 附近'), text: '它在' }, { selector: block('它在 0 附近'), text: 'GELU。', after: true }),
      `${lines.find((line) => line.startsWith('它在 0 附近'))}\n\n${lines.find((line) => line.startsWith('[^gelu-min]:'))}`,
    );
    assert.equal(await copy({ selector: '.bt-card > h2#gelu' }, { selector: block('GELU 用标准正态分布'), after: true }), between('## GELU', 'GELU 用标准正态分布'));
    await page.waitForFunction(() => document.querySelector('.bk-toast').classList.contains('is-on'));
    assert.equal(await page.locator('.bk-toast').count(), 1);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.locator('.bk-header .bk-copy-source').click();
    await page.waitForFunction((expected) => navigator.clipboard.readText().then((text) => text === expected), activationsSource);
    await context.close();
  });

  await t.test('screenshots of the bento article at 1440, 1100 and 375 pixels', async () => {
    const screenshotDir = process.env.BAKE_BENTO_SCREENSHOTS ?? join(dir, 'bento-screenshots');
    mkdirSync(screenshotDir, { recursive: true });
    for (const width of widths) {
      for (const colorScheme of ['light', 'dark']) {
        const page = await open('activations', { viewport: { width, height: 900 }, colorScheme });
        await page.waitForFunction(() => document.querySelector('.bt-card figure.component').dataset.state === 'ready');
        await settle(page);
        const image = await page.screenshot({ fullPage: true, path: join(screenshotDir, `bento-${width}-${colorScheme}.png`) });
        assert.ok(image.length > 0);
        await page.close();
      }
    }
  });
});

function gridLayout() {
  const grid = document.querySelector('.bt-grid');
  const style = getComputedStyle(grid);
  const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
  const gap = parseFloat(style.columnGap);
  const cards = [...grid.querySelectorAll(':scope > .bt-card')].map((card) => ({ title: card.querySelector('h2 .bk-heading-text').textContent, box: card.getBoundingClientRect() }));
  const spans = Object.fromEntries(cards.map(({ title, box }) => [title, Math.round((box.width + gap) / (tracks[0] + gap))]));
  const inOrder = cards.every(({ box }, index) => {
    if (index === 0) return true;
    const previous = cards[index - 1].box;
    return Math.abs(box.top - previous.top) < 0.5 ? box.left > previous.right : box.top > previous.top;
  });
  return { columns: tracks.length, spans, inOrder };
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let frame = 0; frame < 3; frame += 1) await new Promise((done) => requestAnimationFrame(done));
  });
}
