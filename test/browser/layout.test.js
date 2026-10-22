import assert from 'node:assert/strict';
import sharp from 'sharp';
import { article } from '../blog.js';
import { test as base, settle } from './browser.js';

const overflowWidths = [375, 600, 1000, 1339, 1340, 1440];

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

const test = base.extend({
  open: async ({ newPage }, use) =>
    use(async (path, options = {}) => {
      const page = await newPage({ reducedMotion: 'reduce', ...options });
      await page.goto(`/2026-10/${path}/`);
      if (options.javaScriptEnabled !== false) await settle(page);
      return page;
    }),
});

test.describe('the essay theme lays out articles', () => {
  test.use({
    blog: {
      files: {
    'content/posts/stress/index.md': stressArticle,
    'content/posts/widths/index.md': widthsArticle,
    'content/posts/notes/index.md': article({ title: 'Notes', slug: 'notes', extra: 'toc: notes\ncategory: writing\n', body: tocBody }),
    'content/posts/dots/index.md': article({ title: 'Dots', slug: 'dots', extra: 'toc: dots\ncategory: writing\n', body: tocBody }),
    'content/posts/many-blocks/index.md': article({ title: 'Many blocks', slug: 'many-blocks', extra: 'category: writing\n', body: manyBlocksBody }),
    'content/posts/many-cards/index.md': article({ title: 'Many cards', slug: 'many-cards', extra: 'category: writing\ntheme: bento\n', body: manyBlocksBody }),
      },
    },
  });

  test('an article of long words, wide tables and long formulas does not scroll horizontally at any breakpoint', async ({ open }) => {
    const overflowing = [];
    const page = await open('stress');
    for (const width of overflowWidths) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > width) overflowing.push(`${width}px is ${scrollWidth}px wide`);
    }
    assert.deepEqual(overflowing, []);
    await page.close();
  });

  test('body, wide and page blocks have their widths, and an auto block wider than the body resolves to wide', async ({ open }) => {
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

  test('without scripts a formula and a code block wider than the body take the wide width, and a short one keeps the body width', async ({ open }) => {
    const page = await open('stress', { javaScriptEnabled: false });
    const widths = await page.evaluate(() => ['code', 'math'].map((type) => Math.round(document.querySelector(`.bk-block[data-type="${type}"]`).getBoundingClientRect().width)));
    assert.deepEqual(widths, [1100, 1100]);
    await page.goto('/2026-10/syntax/');
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.bk-block[data-type="code"]').getBoundingClientRect().width)), 820);
    await page.close();
  });

  test('the notes style keeps the left column for the table of contents and the other styles centre the text right of the rail', async ({ open }) => {
    const left = async (path, width) => {
      const page = await open(path, { viewport: { width, height: 900 } });
      const result = await page.evaluate(() => Math.round(document.querySelector('.bk-article').getBoundingClientRect().left));
      await page.close();
      return result;
    };
    assert.deepEqual([await left('notes', 1440), await left('dots', 1440), await left('notes', 1024), await left('dots', 1024)], [290, 198, 88, 88]);
  });

  test('examples show the source beside the result where there is room and above it on phones', async ({ open }) => {
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

  test('a table wider than its column keeps the right border of its frame while it scrolls', async ({ open }) => {
    for (const [path, width] of [
      ['syntax', 1440],
      ['syntax', 375],
      ['stress', 1440],
    ]) {
      const page = await open(path, { viewport: { width, height: 900 } });
      // why: a component takes its height when it comes near the screen, which moves every table below it
      await page.evaluate(async () => {
        for (const frame of [...document.querySelectorAll('.bk-article figure.component')].filter((element) => element.checkVisibility())) {
          frame.scrollIntoView({ block: 'center' });
          await new Promise((done) => {
            const ready = () => frame.dataset.state === 'ready' || frame.dataset.state === 'failed';
            if (ready()) return done();
            new MutationObserver((_, observer) => ready() && (observer.disconnect(), done())).observe(frame, { attributes: true, attributeFilter: ['data-state'] });
          });
        }
      });
      const count = await page.evaluate(() => document.querySelectorAll('.bk-article .table-scroll').length);
      let scrolled = 0;
      for (let index = 0; index < count; index += 1) {
        const scroller = page.locator('.bk-article .table-scroll').nth(index);
        if (!(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 1))) continue;
        for (const position of [0, 0.5]) {
          await scroller.scrollIntoViewIfNeeded();
          await scroller.evaluate((element, fraction) => {
            element.scrollLeft = (element.scrollWidth - element.clientWidth) * fraction;
          }, position);
          await settle(page);
          const frame = await scroller.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { x: Math.floor(box.right) - 1, y: Math.floor(box.top + box.height / 2), border: getComputedStyle(element).borderRightColor };
          });
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

  test('list table cells with text are at least 9em wide on a phone, so the table scrolls instead of stacking characters', async ({ open }) => {
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

  test('display math in an example result fits the result beside the source and scrolls inside the result on a phone', async ({ open }) => {
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



  test('placing blocks and cards forces a fixed number of layouts however many blocks an article has', async ({ open }) => {
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
