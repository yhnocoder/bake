import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { article, bake, copyExample, writeFiles } from '../blog.js';
import { launchBrowser, serve, settle } from './browser.js';

const overflowWidths = [375, 600, 1000, 1339, 1340, 1440];
const WENKAI_TEXT = '.bk-site, .bk-title, .bk-article :is(h2, h3, h4, h5, h6)';

const longToken = 'x'.repeat(240);
const wideRow = (cell, count) => `| ${Array.from({ length: count }, (_, index) => `${cell} ${index + 1}`).join(' | ')} |`;
const wideTable = (cell, count) => [wideRow('Heading', count), `|${'---|'.repeat(count)}`, wideRow(cell, count), wideRow(cell, count)].join('\n');
const wideListTable = Array.from({ length: 3 }, (_, row) => [`* - Row ${row}`, ...Array.from({ length: 11 }, (_, cell) => `  - Cell ${cell} holds a sentence that wraps inside the cell.`)].join('\n')).join('\n');
const wideFormula = Array.from({ length: 30 }, (_, index) => `x_{${index}}^2`).join(' + ');

const stressArticle = article({
  title: 'Layout stress',
  slug: 'stress',
  extra: 'tags: [layout, stress]\ncategory: writing\n',
  body: `A paragraph with a long URL https://example.com/${longToken} and long inline code \`${longToken}\`.

\`\`\`text
${'wide code '.repeat(40)}
\`\`\`

${wideTable('A cell with several words', 10)}

$$
${wideFormula}
$$

:::list-table
${wideListTable}
:::

::::example
${'Example source line without a break '.repeat(8)}

${wideTable('Example cell', 8)}
::::

## Sources

:::references
- [@stress] An entry right after a heading.
:::
`,
});

const manyBlocksBody = Array.from(
  { length: 30 },
  (_, section) =>
    `## Section ${section + 1}\n\n${Array.from({ length: 10 }, (_, index) => `$$\nx_{${section}} + y_{${index}} = ${section * 10 + index}\n$$\n\n\`\`\`text\nline ${index}\n\`\`\``).join('\n\n')}\n`,
).join('\n');

const tocBody = '## First\n\nText.\n\n## Second\n\nText.\n';

const widthsArticle = article({
  title: 'Width levels',
  slug: 'widths',
  extra: 'category: writing\n',
  body: `A paragraph before the blocks.

:::{width=body}
\`\`\`text
body
\`\`\`
:::

:::{width=wide}
\`\`\`text
wide
\`\`\`
:::

:::{width=page}
\`\`\`text
page
\`\`\`
:::

${wideTable('An auto cell with several words', 7)}

A paragraph before the references.

:::references
- [@widths] An entry after a paragraph.
:::
`,
});

test('the essay theme lays out articles', async (t) => {
  const dir = copyExample(t);
  writeFiles(dir, {
    'content/posts/stress/index.md': stressArticle,
    'content/posts/widths/index.md': widthsArticle,
    'content/posts/notes/index.md': article({ title: 'Notes', slug: 'notes', extra: 'toc: notes\ncategory: writing\n', body: tocBody }),
    'content/posts/tabs/index.md': article({ title: 'Tabs', slug: 'tabs', extra: 'toc: tabs\ncategory: writing\n', body: tocBody }),
    'content/posts/many-blocks/index.md': article({ title: 'Many blocks', slug: 'many-blocks', extra: 'category: writing\n', body: manyBlocksBody }),
    'content/posts/many-cards/index.md': article({ title: 'Many cards', slug: 'many-cards', extra: 'category: writing\ntheme: bento\n', body: manyBlocksBody }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'));

  const browser = await launchBrowser();
  const open = async (path, options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
    await page.goto(`${origin}/2026-10/${path}/`);
    if (options.javaScriptEnabled !== false) await settle(page);
    return page;
  };

  await t.test('no article scrolls horizontally at any breakpoint', async () => {
    const overflowing = [];
    for (const path of ['syntax', 'stress']) {
      const page = await open(path);
      for (const width of overflowWidths) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scrollWidth > width) overflowing.push(`${path} at ${width}px is ${scrollWidth}px wide`);
      }
      await page.close();
    }
    assert.deepEqual(overflowing, []);
  });

  await t.test('body, wide and page blocks have their widths, and an auto block wider than the body resolves to wide', async () => {
    const page = await open('widths');
    const measure = () =>
      page.evaluate(() => ({
        column: document.querySelector('.bk-article').getBoundingClientRect().width,
        viewport: document.documentElement.clientWidth,
        blocks: Object.fromEntries(
          ['body', 'wide', 'page'].map((width) => {
            const box = document.querySelector(`.bk-block[data-width="${width}"]`).getBoundingClientRect();
            return [width, { width: box.width, left: box.left, right: box.right }];
          }),
        ),
        auto: [...document.querySelectorAll('.bk-block[data-width="auto"]')].map((block) => block.getBoundingClientRect().width),
      }));
    const wide = await measure();
    assert.equal(Math.round(wide.blocks.body.width), 820);
    assert.equal(Math.round(wide.blocks.wide.width), 1100);
    assert.equal(Math.round(wide.blocks.page.width), 1340);
    assert.ok(wide.blocks.page.left >= 0 && wide.blocks.page.right <= wide.viewport, `page block spans ${wide.blocks.page.left} to ${wide.blocks.page.right}`);
    assert.deepEqual(wide.auto, [1100]);

    await page.setViewportSize({ width: 900, height: 900 });
    await settle(page);
    const narrow = await measure();
    assert.equal(Math.round(narrow.column), 820);
    for (const [width, box] of Object.entries(narrow.blocks)) assert.equal(Math.round(box.width), Math.round(narrow.column), `${width} block at 900px`);
    assert.deepEqual(narrow.auto, [narrow.column]);
    await page.close();
  });

  await t.test('without scripts a formula and a code block wider than the body take the wide width, and a short one keeps the body width', async () => {
    const page = await open('stress', { javaScriptEnabled: false });
    const widths = await page.evaluate(() => ['code', 'math'].map((type) => Math.round(document.querySelector(`.bk-block[data-type="${type}"]`).getBoundingClientRect().width)));
    assert.deepEqual(widths, [1100, 1100]);
    await page.goto(`${origin}/2026-10/syntax/`);
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.bk-block[data-type="code"]').getBoundingClientRect().width)), 820);
    await page.close();
  });

  await t.test('the notes style keeps the left column for the table of contents and the other styles centre the text right of the rail', async () => {
    const left = async (path, width) => {
      const page = await open(path, { viewport: { width, height: 900 } });
      const result = await page.evaluate(() => Math.round(document.querySelector('.bk-article').getBoundingClientRect().left));
      await page.close();
      return result;
    };
    assert.deepEqual([await left('notes', 1440), await left('tabs', 1440), await left('notes', 1024), await left('tabs', 1024)], [290, 198, 88, 88]);
  });

  await t.test('examples show the source beside the result where there is room and above it on phones', async () => {
    const page = await open('syntax');
    const columns = async () =>
      page.evaluate(() => {
        const example = document.querySelector('.bk-block[data-type="example"] .example');
        const [source, result] = [example.querySelector('.example-source'), example.querySelector('.example-result')].map((part) => part.getBoundingClientRect());
        return { sideBySide: Math.abs(source.top - result.top) < 1 && source.right <= result.left + 1, stacked: source.bottom <= result.top + 1 };
      });
    assert.deepEqual(await columns(), { sideBySide: true, stacked: false });
    await page.setViewportSize({ width: 375, height: 900 });
    await settle(page);
    assert.deepEqual(await columns(), { sideBySide: false, stacked: true });
    await page.close();
  });

  await t.test('a table wider than its column keeps the right border of its frame while it scrolls', async () => {
    for (const [path, width] of [
      ['syntax', 1440],
      ['syntax', 375],
      ['stress', 1440],
    ]) {
      const page = await open(path, { viewport: { width, height: 900 } });
      const count = await page.evaluate(() => document.querySelectorAll('.bk-article .table-scroll').length);
      let scrolled = 0;
      for (let index = 0; index < count; index += 1) {
        const scroller = page.locator('.bk-article .table-scroll').nth(index);
        if (!(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 1))) continue;
        for (const position of [0, 0.5]) {
          await scroller.scrollIntoViewIfNeeded();
          const frame = await scroller.evaluate((element, fraction) => {
            element.scrollLeft = (element.scrollWidth - element.clientWidth) * fraction;
            const box = element.getBoundingClientRect();
            return { x: Math.floor(box.right) - 1, y: Math.floor(box.top + box.height / 2), border: getComputedStyle(element).borderRightColor };
          }, position);
          await settle(page);
          const pixel = await page.screenshot({ clip: { x: frame.x, y: frame.y, width: 1, height: 1 } });
          const { data } = await sharp(pixel).raw().toBuffer({ resolveWithObject: true });
          const expected = frame.border.match(/\d+/g).map(Number);
          const close = expected.every((channel, index) => Math.abs(channel - data[index]) <= 3);
          assert.ok(close, `${path} at ${width}px, table ${index} scrolled to ${position}: right border is rgb(${[...data.subarray(0, 3)]}), expected ${frame.border}`);
        }
        scrolled += 1;
      }
      assert.ok(scrolled > 0, `${path} at ${width}px has a table that scrolls`);
      await page.close();
    }
  });

  await t.test('list table cells with text are at least 9em wide on a phone, so the table scrolls instead of stacking characters', async () => {
    const page = await open('syntax', { viewport: { width: 375, height: 900 } });
    const narrow = await page.evaluate(() =>
      [...document.querySelectorAll('.bk-article table.list-table td')]
        .filter((cell) => !cell.querySelector(':scope > :is(img, mjx-container):only-child'))
        .map((cell) => ({ text: cell.textContent.trim().slice(0, 12), width: cell.getBoundingClientRect().width, em: parseFloat(getComputedStyle(cell).fontSize) }))
        .filter((cell) => cell.width < cell.em * 9 - 0.5),
    );
    assert.deepEqual(narrow, []);
    await page.close();
  });

  await t.test('display math in an example result fits the result beside the source and scrolls inside the result on a phone', async () => {
    const page = await open('syntax');
    const formulas = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.bk-article .example-result mjx-container[display]')].map((formula) => {
          const result = formula.closest('.example-result').getBoundingClientRect();
          const box = formula.getBoundingClientRect();
          return {
            tex: formula.dataset.tex.slice(0, 24),
            fits: formula.scrollWidth <= formula.clientWidth + 1,
            scrolls: getComputedStyle(formula).overflowX === 'auto',
            inside: box.left >= result.left - 0.5 && box.right <= result.right + 0.5,
          };
        }),
      );
    const wide = await formulas();
    assert.ok(wide.length > 0);
    assert.deepEqual(
      wide.filter((formula) => !formula.fits || !formula.inside),
      [],
    );
    await page.setViewportSize({ width: 375, height: 900 });
    await settle(page);
    assert.deepEqual(
      (await formulas()).filter((formula) => !formula.inside || (!formula.fits && !formula.scrolls)),
      [],
    );
    await page.close();
  });

  await t.test('a line with inline math, code, a highlight or a sidenote number keeps the line height of its paragraph at every text size, also in an example result on a first visit while the fonts load', async () => {
    const uneven = [];
    for (const width of [1440, 375]) {
      for (const size of ['small', 'medium', 'larger']) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await page.addInitScript((value) => localStorage.setItem('bk-size', value), size);
        await page.goto(`${origin}/2026-10/syntax/`);
        await settle(page);
        const gaps = await page.evaluate(() =>
          [...document.querySelectorAll('.bk-article p')]
            .filter((paragraph) => !paragraph.closest('.component-box, .example-source') && paragraph.querySelector('mjx-container:not([display]), code, mark, sup'))
            .filter((paragraph) => [...paragraph.querySelectorAll('mjx-container svg')].every((svg) => svg.getBoundingClientRect().height < parseFloat(getComputedStyle(paragraph).lineHeight)))
            .flatMap((paragraph) => {
              const tops = [];
              const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (node.parentElement.closest('code, mjx-container, sup')) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects()) if (rect.height > 0 && !tops.some((top) => Math.abs(top - rect.top) < 4)) tops.push(rect.top);
              }
              tops.sort((a, b) => a - b);
              const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
              return tops.slice(1).map((top, index) => [paragraph.textContent.slice(0, 12), index + 1, Math.round((top - tops[index]) * 10) / 10, Math.round(lineHeight * 10) / 10]).filter(([, , gap, height]) => Math.abs(gap - height) > 0.6);
            }),
        );
        uneven.push(...gaps.map(([text, line, gap, height]) => `${width} pixels, size ${size}: line ${line + 1} of "${text}" starts ${gap} px after the line before it, with a line height of ${height} px`));
        await page.close();
      }
    }
    assert.deepEqual(uneven, []);
  });

  await t.test('dark mode follows the system colour scheme', async () => {
    const page = await open('widths', { colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 20, 19)');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 244)');
    await page.close();
  });

  await t.test('display math shows a scroll shadow only on an overflowing side in both schemes, also in the first frame after the colour scheme changes', async () => {
    const problems = [];
    for (const width of [1440, 375]) {
      const page = await open('jacobian', { viewport: { width, height: 900 }, reducedMotion: 'no-preference', colorScheme: 'light' });
      const edges = async () => {
        const boxes = await page.evaluate(() =>
          [...document.querySelectorAll('.bk-article mjx-container[display]')].map((formula) => {
            const box = formula.getBoundingClientRect();
            return { left: Math.ceil(box.left), right: Math.floor(box.right) - 1, top: Math.ceil(box.top), overflows: formula.scrollWidth > formula.clientWidth };
          }),
        );
        const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
        const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
        return boxes.map((box) => ({ ...box, page: pixel(box.left, box.top - 6), start: pixel(box.left, box.top + 2), end: pixel(box.right, box.top + 2) }));
      };
      const distance = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
      const check = async (moment) => {
        for (const [index, edge] of (await edges()).entries()) {
          const name = `formula ${index + 1} at ${width}px ${moment}`;
          if (distance(edge.start, edge.page) > 2) problems.push(`${name}: start edge ${edge.start} on page ${edge.page}`);
          const endShadow = distance(edge.end, edge.page) > 2;
          if (endShadow !== edge.overflows) problems.push(`${name}: end edge ${edge.end} on page ${edge.page}, overflows ${edge.overflows}`);
        }
      };
      await page.locator('mjx-container[display]').nth(1).scrollIntoViewIfNeeded();
      await settle(page);
      await check('in the light scheme');
      await page.emulateMedia({ colorScheme: 'dark' });
      // why: the page fades to the new scheme with a view transition, and Chromium on Linux draws that fade without the old snapshot when the root color-scheme changes, so the first frame of the dark scheme is read with the fade finished
      await page.waitForFunction(() => document.getAnimations().some((animation) => animation.effect.pseudoElement?.startsWith('::view-transition')));
      await page.evaluate(async () => {
        for (const animation of document.getAnimations()) if (animation.effect.pseudoElement?.startsWith('::view-transition')) animation.finish();
        await new Promise((done) => requestAnimationFrame(done));
      });
      await check('in the first frame of the dark scheme');
      await settle(page);
      await check('in the dark scheme');
      if (width === 375) assert.ok((await edges()).some((edge) => edge.overflows), 'a formula overflows on a phone');
      await page.close();
    }
    assert.deepEqual(problems, []);
  });

  await t.test('tags are styled as inline code', async () => {
    const page = await open('stress');
    const tags = await page.evaluate(() => {
      const code = getComputedStyle(document.querySelector('.bk-article p code'));
      return [...document.querySelectorAll('.bk-tag')].map((tag) => {
        const style = getComputedStyle(tag);
        return { text: tag.textContent, font: style.fontFamily === code.fontFamily && style.fontFamily.startsWith('"JetBrains Mono"'), background: style.backgroundColor };
      });
    });
    assert.deepEqual(tags, [
      { text: 'layout', font: true, background: 'rgb(238, 240, 236)' },
      { text: 'stress', font: true, background: 'rgb(238, 240, 236)' },
    ]);
    await page.close();
  });

  await t.test('no separator of the masthead meta line starts a line on a phone', async () => {
    const page = await open('syntax', { viewport: { width: 375, height: 800 } });
    const items = await page.evaluate(() => {
      const meta = document.querySelector('.bk-meta').getBoundingClientRect();
      return [...document.querySelectorAll('.bk-meta :is(time, .bk-words, .bk-tags, .bk-copy)')].map((item) => {
        const box = item.getBoundingClientRect();
        return { text: item.textContent, top: Math.round(box.top), separatorShown: box.left >= meta.left - 1 };
      });
    });
    const lines = [...new Set(items.map((item) => item.top))];
    assert.ok(lines.length >= 2, `the meta line does not wrap at 375 px: ${JSON.stringify(items)}`);
    const startsLine = (item, index) => index === 0 || items[index - 1].top !== item.top;
    assert.deepEqual(
      items.filter((item, index) => startsLine(item, index) === item.separatorShown).map((item) => item.text),
      [],
    );
    await page.close();
  });

  await t.test('with the default body font the page downloads only the WenKai subsets that the masthead, title and headings use', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const requested = [];
    page.on('request', (request) => {
      const file = request.url().split('/').pop();
      if (file.startsWith('lxgwwenkai-')) requested.push(file);
    });
    await page.goto(`${origin}/2026-10/syntax/`, { waitUntil: 'networkidle' });
    await settle(page);
    const { outside, codePoints } = await page.evaluate((selector) => {
      const elements = [...document.querySelectorAll('body *')].filter(
        (element) => getComputedStyle(element).fontFamily.startsWith('"LXGW WenKai"') && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ''),
      );
      return {
        outside: elements.filter((element) => element.closest(selector) === null).map((element) => element.outerHTML.slice(0, 80)),
        codePoints: [...new Set([...elements.map((element) => element.textContent).join('')].map((character) => character.codePointAt(0)))],
      };
    }, WENKAI_TEXT);
    await page.close();
    assert.deepEqual(outside, []);
    const subsets = wenkaiSubsets(join(dir, 'dist/assets'));
    const needed = new Set(subsets.filter((subset) => codePoints.some((point) => subset.ranges.some(([from, to]) => point >= from && point <= to))).map((subset) => subset.file));
    assert.ok(requested.length > 0, 'expected the title and headings to load WenKai');
    assert.deepEqual(
      requested.filter((file) => !needed.has(file)),
      [],
    );
  });

  await t.test('the font faces load from a stylesheet that does not block the first paint, with and without scripts', async () => {
    for (const path of ['', '2026-10/syntax/', '2026-10/activations/', 'missing/']) {
      const html = await (await fetch(`${origin}/${path}`)).text();
      const blocking = [...html.replace(/<noscript>.*?<\/noscript>/gs, '').matchAll(/<link rel="stylesheet" href="([^"]+)"( media="[^"]+")?/g)].filter(([, , media]) => media === undefined).map(([, href]) => href);
      assert.ok(blocking.length > 0, `${path} links no stylesheet`);
      for (const href of blocking) {
        const css = readFileSync(join(dir, 'dist/assets', href.split('/').pop()), 'utf8');
        assert.equal(css.includes('@font-face'), false, `${path} blocks its first paint on ${href}, which declares fonts`);
      }
    }
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(`${origin}/2026-10/syntax/`, { waitUntil: 'networkidle' });
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family} ${face.weight}`);
      });
      await context.close();
      assert.ok(loaded.includes('LXGW WenKai 700'), `with scripts ${javaScriptEnabled ? 'enabled' : 'disabled'} the headings did not load WenKai: ${loaded.join(', ')}`);
    }
  });

  await t.test('the references label is hidden right after a heading and shown otherwise', async () => {
    const labels = async (path) => {
      const page = await open(path);
      const shown = await page.evaluate(() => [...document.querySelectorAll('.bk-references-label')].filter((label) => label.getBoundingClientRect().height > 0).map((label) => label.textContent));
      await page.close();
      return shown;
    };
    assert.deepEqual(await labels('stress'), []);
    assert.deepEqual(await labels('widths'), ['参考文献']);
  });

  await t.test('placing blocks and cards forces a fixed number of layouts however many blocks an article has', async () => {
    const layoutsOnResize = async (path) => {
      const page = await open(path);
      const session = await page.context().newCDPSession(page);
      await session.send('Performance.enable');
      const count = async () => (await session.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'LayoutCount').value;
      const before = await count();
      await page.setViewportSize({ width: 1400, height: 900 });
      await settle(page);
      const layouts = (await count()) - before;
      await page.close();
      return layouts;
    };
    const layouts = { 'many-blocks': await layoutsOnResize('many-blocks'), 'many-cards': await layoutsOnResize('many-cards') };
    assert.deepEqual(Object.entries(layouts).filter(([, count]) => count > 30), []);
  });
});

function wenkaiSubsets(assets) {
  const css = readdirSync(assets)
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(join(assets, file), 'utf8'))
    .join('\n');
  return [...css.matchAll(/@font-face\{[^}]*LXGW WenKai[^}]*url\(\.\/([^)]+)\)[^}]*unicode-range:([^;}]+)/g)].map(([, file, ranges]) => ({
    file,
    ranges: ranges.split(',').map((range) => {
      const [from, to = from] = range.trim().slice(2).split('-');
      return [parseInt(from, 16), parseInt(to, 16)];
    }),
  }));
}
