import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { article, bake, copyExample, exampleBlog, writeFiles } from '../blog.js';
import { openWithSelectionModule } from './selection-module.js';
import { launchBrowser, serve, settle } from './browser.js';

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

## Fixed {cols=3 rows=4}

A short paragraph with a note.[^fixed]

[^fixed]: A note that the rows of this card hide.

${'A long paragraph that does not fit into four rows. '.repeat(30)}

Last line.
`,
});

test('the bento theme lays out sections as cards', async (t) => {
  const dir = copyExample(t);
  writeFiles(dir, { 'content/posts/bento-cards/index.md': cardsArticle });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'), { localhost: true });

  const english = mkdtempSync(join(tmpdir(), 'bake-bento-english-'));
  t.after(() => rmSync(english, { recursive: true, force: true }));
  writeFiles(english, {
    'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', theme: 'bento', themes: { bento: { columns: 2 } } };\n",
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', extra: 'theme: bento\n', body: `Text before the first section.\n\n## One\n\nText.\n\n## Two\n\nText.\n\n## Three {width=wide}\n\nText.\n\n## Four {rows=2}\n\n${'Text that does not fit into two rows. '.repeat(20)}\n` }),
  });
  const englishBuild = bake(english, 'build');
  assert.equal(englishBuild.stderr, '');
  const englishOrigin = await serve(t, join(english, 'dist'), { localhost: true });

  const browser = await launchBrowser();
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

  await t.test('cards span the columns their sections ask for, the cards keep the order of the article and the grid has one column below 1000 pixels', async () => {
    const page = await open('bento-cards');
    const desktop = { columns: 6, spans: { 'Wide section': 3, 'Body one': 2, 'Body two': 2, 'Page section': 6, Component: 3, 'Body three': 2, 'Body four': 2, Fixed: 3 } };
    const expected = {
      1440: desktop,
      1100: desktop,
      375: { columns: 1, spans: { 'Wide section': 1, 'Body one': 1, 'Body two': 1, 'Page section': 1, Component: 1, 'Body three': 1, 'Body four': 1, Fixed: 1 } },
    };
    for (const width of widths) {
      await resize(page, width);
      const grid = await page.evaluate(gridLayout);
      assert.deepEqual({ columns: grid.columns, spans: grid.spans }, expected[width], `${width}px`);
      assert.ok(grid.inOrder, `${width}px`);
    }
    await page.close();
  });

  await t.test('the column count follows themes.bento.columns in bake.config.js', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(`${englishOrigin}/2026-10/cards/`);
    await settle(page);
    const grid = await page.evaluate(gridLayout);
    assert.deepEqual({ columns: grid.columns, spans: grid.spans, inOrder: grid.inOrder }, { columns: 2, spans: { One: 1, Two: 1, Three: 2, Four: 1 }, inOrder: true });
    await page.close();
  });

  await t.test('the settings button and the AI chat button sit on one line in equal gutters and cover no card and not the text before the first section from 1000 pixels up', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
    });
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
    for (const url of [`${origin}/2026-10/bento-cards/`, `${englishOrigin}/2026-10/cards/`]) {
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
    }
    await page.goto(`${englishOrigin}/`);
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]')?.shadowRoot.querySelector('.bk-chat-launcher') != null);
    assert.equal(await page.locator('.bk-home').count(), 1);
    assert.deepEqual(problems, []);
    await context.close();
  });

  await t.test('a card with rows is as tall as its rows from 1000 pixels up, every other card is as tall as its content, and sidenotes follow the last block', async () => {
    const page = await open('activations');
    for (const width of widths) {
      await resize(page, width);
      if (width >= 1000) {
        const heights = await page.evaluate(() => {
          const grid = document.querySelector('.bt-grid');
          const gap = parseFloat(getComputedStyle(grid).columnGap);
          const row = parseFloat(getComputedStyle(grid).getPropertyValue('--bt-row-height'));
          return [...grid.querySelectorAll('.bt-card[data-rows]')].map((card) => {
            const rows = Number(card.dataset.rows);
            return { rows, height: Math.round(card.getBoundingClientRect().height * 10) / 10, expected: Math.round((rows * row + (rows - 1) * gap) * 10) / 10 };
          });
        });
        assert.equal(heights.length, 10, `${width}px`);
        assert.deepEqual(heights.filter(({ height, expected }) => Math.abs(height - expected) > 0.5), [], `${width}px`);
        continue;
      }
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

  await t.test('each card goes to the columns that end highest, in the order of the article', async () => {
    const page = await open('activations');
    for (const width of [1440, 1100]) {
      await resize(page, width);
      const grid = await page.evaluate(gridLayout);
      assert.deepEqual(grid.starts, { ReLU: 0, GELU: 2, SiLU: 4, 导数: 4, 怎么选: 2, 反向传播: 0, 实现: 0, '写成 Markdown': 4, 对比: 0, 参考文献: 4 }, `${width}px`);
      assert.ok(grid.inOrder, `${width}px`);
      const gaps = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.bt-card')].map((card) => card.getBoundingClientRect());
        const gap = parseFloat(getComputedStyle(document.querySelector('.bt-grid')).columnGap);
        return boxes.flatMap((box) => {
          const below = boxes.filter((other) => other.top > box.bottom - 0.5 && other.left < box.right - 1 && other.right > box.left + 1);
          if (below.length === 0) return [];
          const distance = Math.min(...below.map((other) => other.top)) - box.bottom;
          return Math.abs(distance - gap) > 0.5 ? [distance] : [];
        });
      });
      assert.deepEqual(gaps, [], `${width}px`);
    }
    await page.close();
  });

  await t.test('content that does not fit into the rows of a card scrolls inside the card only after the card is chosen', async () => {
    const page = await open('bento-cards', { reducedMotion: 'no-preference' });
    const card = page.locator('.bt-card[data-rows]');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => scrollY > 0);
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-overflow') && !element.hasAttribute('data-end') && getComputedStyle(element, '::after').content !== 'none'), true);
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const pageTop = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, -200);
    await page.waitForFunction((top) => scrollY < top, pageTop);
    assert.equal(await card.evaluate((element) => element.scrollTop), 0);
    const chosen = await card.boundingBox();
    await page.mouse.click(chosen.x + chosen.width / 2, chosen.y + chosen.height / 2);
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-active')), true);
    const top = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 2000);
    await page.waitForFunction(() => document.querySelector('.bt-card[data-rows]').hasAttribute('data-end'));
    assert.equal(await page.evaluate(() => scrollY), top);
    await page.keyboard.press('Escape');
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-active')), false);
    await page.mouse.click(5, 5);
    await card.focus();
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-active') && element.tabIndex === 0), true);
    await card.evaluate((element) => element.blur());
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-active')), false);
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-hint')), false);
    await page.evaluate(() => {
      const marker = document.createElement('script');
      marker.type = 'application/json';
      marker.dataset.bakeDev = '';
      document.head.append(marker);
      document.dispatchEvent(new CustomEvent('bake:content'));
    });
    await page.waitForFunction(() => document.querySelector('.bt-card[data-rows]').hasAttribute('data-hint'));
    const [, pixels, rows] = /^内容超出卡片 (\d+) 像素，rows 至少写 (\d+)$/.exec(await card.getAttribute('data-hint'));
    const fit = await card.evaluate((element, rows) => {
      const style = getComputedStyle(element);
      const gap = parseFloat(getComputedStyle(element.parentElement).rowGap);
      const rowHeight = parseFloat(style.getPropertyValue('--bt-row-height'));
      const needed = element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const height = (count) => count * rowHeight + (count - 1) * gap;
      return { overflow: Math.ceil(element.scrollHeight - element.clientHeight), fits: height(rows) >= needed, fitsWithOneLess: height(rows - 1) >= needed };
    }, Number(rows));
    assert.deepEqual(fit, { overflow: Number(pixels), fits: true, fitsWithOneLess: false });
    const englishPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await englishPage.goto(`${englishOrigin}/2026-10/cards/`);
    await settle(englishPage);
    await englishPage.evaluate(() => {
      const marker = document.createElement('script');
      marker.type = 'application/json';
      marker.dataset.bakeDev = '';
      document.head.append(marker);
      document.dispatchEvent(new CustomEvent('bake:content'));
    });
    await englishPage.waitForFunction(() => document.querySelector('.bt-card[data-rows]').hasAttribute('data-hint'));
    assert.match(await englishPage.locator('.bt-card[data-rows]').getAttribute('data-hint'), /^Content is \d+ px taller than the card; set rows to at least \d+$/);
    await englishPage.close();
    await resize(page, 375);
    assert.equal(await card.evaluate((element) => element.hasAttribute('data-overflow') || element.scrollHeight > element.clientHeight + 1), false);
    await page.close();
  });

  await t.test('a click on a sidenote number chooses its card and scrolls the note into view when the rows of the card hide it, and the chosen card has an outline in the accent colour', async () => {
    const page = await open('bento-cards');
    const card = page.locator('.bt-card[data-rows]');
    await card.locator('.sidenote-ref a').scrollIntoViewIfNeeded();
    const hidden = await card.evaluate((element) => element.querySelector('.bk-sidenote').getBoundingClientRect().top >= element.getBoundingClientRect().bottom);
    assert.equal(hidden, true);
    await card.locator('.sidenote-ref a').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('.bt-card[data-rows]');
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
      return { active: element.hasAttribute('data-active'), width: style.outlineWidth, color: style.outlineColor === accent };
    });
    assert.deepEqual(outline, { active: true, width: '2px', color: true });
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
      const typography = await frame.evaluate((figure) => {
        const box = getComputedStyle(figure.querySelector('.component-box'));
        const card = getComputedStyle(figure.closest('.bt-card'));
        return { box: [box.fontSize, box.lineHeight], card: [card.fontSize, card.lineHeight] };
      });
      assert.deepEqual(typography.box, typography.card, `${width}px`);
      assert.deepEqual(typography.box, { 1440: ['15.5px', '27.9px'], 1100: ['14px', '21.7px'], 375: ['15px', '27px'] }[width], `${width}px`);
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

  await t.test('a code block, a table or a display formula that fits its card shows no scroll shadow at its edges', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const page = await open('activations', { colorScheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      const boxes = page.locator('.bt-card :is(pre.shiki, .table-scroll, mjx-container[display])');
      const leaks = [];
      for (let index = 0; index < (await boxes.count()); index += 1) {
        const box = boxes.nth(index);
        if (await box.evaluate((element) => !element.checkVisibility() || element.scrollWidth > element.clientWidth)) continue;
        await box.scrollIntoViewIfNeeded();
        const shown = await box.screenshot();
        await box.evaluate((element) => element.style.setProperty('--scroll-shadow', 'transparent'));
        const plain = await box.screenshot();
        await box.evaluate((element) => element.style.removeProperty('--scroll-shadow'));
        const difference = largestDifference(PNG.sync.read(shown), PNG.sync.read(plain));
        if (difference > 2) leaks.push(`${colorScheme}: ${await box.evaluate((element) => element.closest('.bt-card').querySelector('h2 .bk-heading-text').textContent)} ${index} differs by ${difference}`);
      }
      assert.deepEqual(leaks, []);
      await page.close();
    }
  });

  await t.test('the code blocks, tables and display formulas of the example article fit their cards, code wraps on a phone, and a component in a card has no frame of its own', async () => {
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
      await page.close();
    }
  });

  await t.test('without scripts the cards keep their declared spans and every sidenote is shown', async () => {
    const page = await open('bento-cards', { javaScriptEnabled: false });
    const grid = await page.evaluate(gridLayout);
    assert.deepEqual(grid.spans, { 'Wide section': 3, 'Body one': 2, 'Body two': 2, 'Page section': 6, Component: 2, 'Body three': 2, 'Body four': 2, Fixed: 3 });
    assert.equal(await page.locator('.bt-grid[data-packed], .bt-card[data-overflow]').count(), 0);
    assert.ok(await page.evaluate(() => { const card = [...document.querySelectorAll('.bt-card')].at(-1); return card.scrollHeight <= card.clientHeight + 1; }));
    assert.equal(await page.locator('.bk-sidenote').evaluateAll((notes) => notes.every((note) => note.checkVisibility())), true);
    await page.close();
  });

  await t.test('the cards are placed again after bake dev replaces the article', async () => {
    const page = await open('bento-cards');
    const before = await page.evaluate(gridLayout);
    await page.evaluate(async () => {
      const html = await (await fetch(location.href)).text();
      const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('.bk-article');
      document.querySelector('.bk-article').replaceChildren(...fresh.childNodes);
      document.dispatchEvent(new CustomEvent('bake:content'));
    });
    await settle(page);
    const after = await page.evaluate(gridLayout);
    assert.equal(await page.locator('.bt-grid[data-packed]').count(), 1);
    assert.deepEqual(after, before);
    await page.close();
  });

  await t.test('the settings panel offers the theme, the body font, the text size, the weight and the spacing and no table of contents style', async () => {
    for (const width of [1440, 375]) {
      const page = await open('activations', { viewport: { width, height: 900 } });
      await page.locator('.bk-settings-toggle').click();
      const rows = await page.locator('.bk-settings-row').evaluateAll((elements) => elements.filter((row) => row.checkVisibility()).map((row) => row.dataset.setting));
      assert.deepEqual(rows, ['theme', 'font', 'size', 'weight', 'spacing'], `${width}px`);
      await page.locator('.bk-settings-row[data-setting="theme"] button[data-value="dark"]').click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 20, 19)', `${width}px`);
      await page.close();
    }
  });

  await t.test('copying a selection or the whole article gives its Markdown', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await openWithSelectionModule(page, `${origin}/2026-10/activations/`);
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
  const columns = Number(style.getPropertyValue('--bt-cols'));
  const gap = parseFloat(style.columnGap);
  const origin = grid.getBoundingClientRect();
  const track = (origin.width - gap * (columns - 1)) / columns;
  const cards = [...grid.querySelectorAll(':scope > .bt-card')].map((card) => ({ title: card.querySelector('h2 .bk-heading-text').textContent, box: card.getBoundingClientRect() }));
  const spans = Object.fromEntries(cards.map(({ title, box }) => [title, Math.round((box.width + gap) / (track + gap))]));
  const starts = Object.fromEntries(cards.map(({ title, box }) => [title, Math.round((box.left - origin.left) / (track + gap))]));
  const inOrder = cards.every(({ box }, index) =>
    cards.slice(0, index).every(({ box: earlier }) => {
      const sameColumns = box.left < earlier.right - 1 && box.right > earlier.left + 1;
      if (sameColumns) return box.top > earlier.top;
      return Math.abs(box.top - earlier.top) >= 0.5 || box.left > earlier.left;
    }),
  );
  return { columns, spans, starts, inOrder };
}

function largestDifference(first, second) {
  const corner = 20;
  let largest = 0;
  for (let y = corner; y < first.height - corner; y += 1) {
    for (let index = y * first.width * 4; index < (y + 1) * first.width * 4; index += 1) largest = Math.max(largest, Math.abs(first.data[index] - second.data[index]));
  }
  return largest;
}
