import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, writeFiles } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
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
  const dir = mkdtempSync(join(tmpdir(), 'bake-layout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  writeFiles(dir, {
    'content/posts/stress/index.md': stressArticle,
    'content/posts/widths/index.md': widthsArticle,
    'content/posts/notes/index.md': article({ title: 'Notes', slug: 'notes', extra: 'toc: notes\ncategory: writing\n', body: tocBody }),
    'content/posts/tabs/index.md': article({ title: 'Tabs', slug: 'tabs', extra: 'toc: tabs\ncategory: writing\n', body: tocBody }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const origin = await serve(t, join(dir, 'dist'));

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const open = async (path, options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
    await page.goto(`${origin}/2026-10/${path}/`);
    await settle(page);
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
        auto: [...document.querySelectorAll('.bk-block[data-width="auto"]')].map((block) => ({ resolved: block.dataset.resolved, width: block.getBoundingClientRect().width })),
      }));
    const wide = await measure();
    assert.equal(Math.round(wide.blocks.body.width), 820);
    assert.equal(Math.round(wide.blocks.wide.width), 1100);
    assert.equal(Math.round(wide.blocks.page.width), 1340);
    assert.ok(wide.blocks.page.left >= 0 && wide.blocks.page.right <= wide.viewport, `page block spans ${wide.blocks.page.left} to ${wide.blocks.page.right}`);
    assert.deepEqual(wide.auto, [{ resolved: 'wide', width: 1100 }]);

    await page.setViewportSize({ width: 900, height: 900 });
    await settle(page);
    const narrow = await measure();
    assert.equal(Math.round(narrow.column), 820);
    for (const [width, box] of Object.entries(narrow.blocks)) assert.equal(Math.round(box.width), Math.round(narrow.column), `${width} block at 900px`);
    assert.deepEqual(narrow.auto, [{ resolved: 'body', width: narrow.column }]);
    await page.close();
  });

  await t.test('every table of contents style places the table of contents and the body where the notes style does', async () => {
    const positions = async (path) => {
      const page = await open(path);
      const result = await page.evaluate(() => ({
        toc: Math.round(document.querySelector('.bk-toc-list').getBoundingClientRect().width),
        body: Math.round(document.querySelector('.bk-article').getBoundingClientRect().left),
      }));
      await page.close();
      return result;
    };
    const notes = await positions('notes');
    assert.ok(notes.toc >= 180, `the notes table of contents is ${notes.toc}px wide`);
    assert.deepEqual(await positions('tabs'), notes);
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

  await t.test('dark mode follows the system and data-theme overrides it both ways', async () => {
    const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const darkSystem = await open('widths', { colorScheme: 'dark' });
    assert.equal(await background(darkSystem), 'rgb(17, 20, 19)');
    await darkSystem.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    assert.equal(await background(darkSystem), 'rgb(245, 246, 244)');
    await darkSystem.close();
    const lightSystem = await open('widths', { colorScheme: 'light' });
    assert.equal(await background(lightSystem), 'rgb(245, 246, 244)');
    await lightSystem.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    assert.equal(await background(lightSystem), 'rgb(17, 20, 19)');
    await lightSystem.close();
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
});

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let frame = 0; frame < 3; frame += 1) await new Promise((done) => requestAnimationFrame(done));
  });
}

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
