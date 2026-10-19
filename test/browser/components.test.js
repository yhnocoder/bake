import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const screenshotDir = join(import.meta.dirname, '../../test-out/syntax-sections');
const spacer = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1} keeps the last component far below the first screen.`).join('\n\n');

const blog = {
  'bake.config.js': validConfig,
  'preamble.sty': '\\ProvidesPackage{preamble}\n\n\\newcommand{\\R}{\\mathbb{R}}\n',
  'components/lib/shared.js': 'export const prefix = "grid";\n',
  'components/lib/count-view.css': '.count-view-text { margin: 0; }\n',
  'components/count-view.jsx': `import { createSignal, onCleanup } from 'solid-js';
import './lib/count-view.css';

export const params = {
  label: { label: 'Label', type: 'text', default: 'count' },
  count: { label: 'Count', type: 'number', min: 0, max: 9, default: 1 },
  on: { label: 'On', type: 'boolean', default: false },
};
export const layout = { height: 240, narrowHeight: (params) => (params.on ? 320 : 300) };

export default function CountView(props) {
  const [themes, setThemes] = createSignal(0);
  const redraw = () => setThemes(themes() + 1);
  document.addEventListener('bake:theme', redraw);
  onCleanup(() => document.removeEventListener('bake:theme', redraw));
  return <p class="count-view-text" data-themes={themes()}>{\`\${props.label} \${props.count} \${props.on}\`}</p>;
}
`,
  'components/grid-view.js': `import { prefix } from './lib/shared.js';

export const params = { mode: { label: 'Mode', type: 'enum', options: ['near', 'far'], default: 'near' } };
export const layout = { height: { ratio: 2 }, frame: false };

export default class GridView extends HTMLElement {
  connectedCallback() {
    this.update();
  }

  update() {
    this.textContent = \`\${prefix} \${this.params.mode}\`;
  }
}
`,
  'components/tex-view.js': `import { texToSvg } from 'bake/math';

export const layout = { height: 160 };

export default class TexView extends HTMLElement {
  async connectedCallback() {
    const formulas = await Promise.all([texToSvg('\\\\R^{n} \\\\to \\\\R', { display: true }), texToSvg('x\\\\,\\\\sigma(1.702x)')]);
    this.replaceChildren(...formulas);
    this.dataset.done = '';
  }
}
`,
  'components/text-view.js': `export const layout = { height: 200 };

export default class TextView extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<h3>Title</h3><p>Text with <code>code</code> and <a href="#top">a link</a>.</p>';
  }
}
`,
  'content/posts/rope/index.md': article({
    body: `:::count-view{label=hello count=3}
Counted *caption*.
:::

:::grid-view
:::

:::tex-view
:::

:::grid-view{width=560px}
:::

:::grid-view{width=70%}
:::

:::grid-view{width=900px}
:::

${spacer}

:::grid-view{mode=far}
:::
`,
  }),
  'content/posts/gelu/index.md': article({ slug: 'gelu', body: ':::grid-view\n:::\n' }),
  'content/posts/text/index.md': article({ slug: 'text', body: 'An article paragraph.\n\n### An article heading\n\n:::text-view\n:::\n' }),
};

function frameHeights() {
  return [...document.querySelectorAll('figure.component')].slice(0, 2).map((frame) => ({
    frame: frame.getBoundingClientRect().height,
    box: frame.querySelector('.component-box').getBoundingClientRect().height,
    width: frame.querySelector('.component-box').getBoundingClientRect().width,
  }));
}

function frameWidths() {
  const column = document.querySelector('.bk-article').getBoundingClientRect();
  return [...document.querySelectorAll('figure.component[style]')].map((frame) => {
    const rect = frame.getBoundingClientRect();
    const block = frame.closest('.bk-block').getBoundingClientRect();
    return {
      width: rect.width,
      right: rect.right,
      left: rect.left,
      columnOffset: rect.left + rect.width / 2 - (column.left + column.width / 2),
      blockOffset: rect.left + rect.width / 2 - (block.left + block.width / 2),
      blockWidth: block.width,
      column: column.width,
      screen: document.documentElement.clientWidth,
    };
  });
}

function waitForReady(page, count = Infinity) {
  return page.waitForFunction((first) => [...document.querySelectorAll('figure.component')].slice(0, first).every((frame) => frame.dataset.state === 'ready'), count);
}

test('components run in the browser', async (t) => {
  const dir = createBlog(t, blog);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const open = async (path, options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, ...options });
    const problems = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    page.problems = problems;
    if (path !== null) await page.goto(`${origin}/2026-10/${path}/`);
    return page;
  };

  await t.test('a SolidJS component and a plain custom element run with their params', async () => {
    const page = await open('rope');
    await waitForReady(page, 3);
    await page.waitForSelector('tex-view[data-done]');
    const texts = await page.evaluate(() => [document.querySelector('count-view').textContent, document.querySelector('grid-view').textContent]);
    assert.deepEqual(texts, ['hello 3 false', 'grid near']);
    assert.deepEqual(page.problems, []);
    await page.close();
  });

  await t.test('texToSvg typesets each formula into one SVG with the preamble macros and the dynamic font glyphs', async () => {
    const page = await open('rope');
    await page.waitForSelector('tex-view[data-done]');
    const formulas = await page.evaluate(() =>
      [...document.querySelector('tex-view').children].map((svg) => ({
        tag: svg.tagName,
        errors: svg.querySelectorAll('[data-mml-node="merror"]').length,
        glyphs: [...svg.querySelectorAll('[data-c]')].map((glyph) => glyph.getAttribute('data-c')),
        width: svg.getBoundingClientRect().width,
      })),
    );
    assert.deepEqual(
      formulas.map(({ tag, errors }) => [tag, errors]),
      [
        ['svg', 0],
        ['svg', 0],
      ],
    );
    assert.ok(formulas[0].glyphs.includes('211D'), `the display formula draws a double-struck R: ${formulas[0].glyphs}`);
    assert.deepEqual(formulas[1].glyphs, ['1D465', '1D70E', '28', '31', '2E', '37', '30', '32', '1D465', '29']);
    assert.ok(formulas.every((formula) => formula.width > 0));
    await page.close();
  });

  await t.test('the frame keeps its height when the component loads, at 1440 and 375 pixels', async () => {
    for (const [width, expected] of [
      [1440, 240],
      [375, 300],
    ]) {
      const page = await open(null, { viewport: { width, height: 800 } });
      let release;
      const held = new Promise((done) => {
        release = done;
      });
      await page.route(/\/assets\/(count-view|grid-view)-[\w-]+\.js$/, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`${origin}/2026-10/rope/`);
      await page.waitForFunction(() => document.querySelector('figure.component').dataset.state === 'loading');
      const before = await page.evaluate(frameHeights);
      release();
      await waitForReady(page, 2);
      const after = await page.evaluate(frameHeights);
      const elements = await page.evaluate(() => ['count-view', 'grid-view'].map((name) => document.querySelector(name).getBoundingClientRect().height));
      assert.deepEqual(after, before, `${width}px`);
      assert.equal(Math.round(before[0].box), expected, `${width}px: count-view placeholder height`);
      assert.ok(Math.abs(before[1].box - before[1].width / 2) < 1, `${width}px: grid-view keeps the ratio 2, ${before[1].width}x${before[1].box}`);
      assert.deepEqual(
        elements.map(Math.round),
        after.map((entry) => Math.round(entry.box)),
        `${width}px: each element fills its box`,
      );
      await page.close();
    }
  });

  await t.test('pixel and percent widths measure their width, are centred and never exceed the screen', async () => {
    for (const width of [1440, 1100, 375]) {
      const page = await open('rope', { viewport: { width, height: 800 } });
      await page.evaluate(() => document.fonts.ready);
      const [pixels, percent, wide] = await page.evaluate(frameWidths);
      const label = `${width}px`;
      for (const frame of [pixels, percent, wide]) assert.ok(frame.left >= 0 && frame.right <= frame.screen, `${label}: a frame spans ${frame.left}..${frame.right} on a ${frame.screen}px screen`);
      assert.ok(Math.abs(pixels.width - Math.min(560, pixels.column)) < 1, `${label}: 560px frame is ${pixels.width}`);
      assert.ok(Math.abs(percent.width - 0.7 * percent.column) < 1, `${label}: 70% frame is ${percent.width} of ${percent.column}`);
      assert.ok(Math.abs(pixels.columnOffset) < 1 && Math.abs(percent.columnOffset) < 1, `${label}: frames are centred in the body column`);
      assert.ok(Math.abs(wide.width - Math.min(900, wide.blockWidth)) < 1, `${label}: 900px frame is ${wide.width} in a ${wide.blockWidth}px block`);
      assert.ok(Math.abs(wide.blockOffset) < 1, `${label}: 900px frame is centred in its block`);
      if (width === 1440) assert.equal(Math.round(wide.width), 900);
      if (width === 375) assert.ok(Math.abs(wide.width - wide.column) < 1, `${label}: 900px frame fills the body column`);
      await page.close();
    }
  });

  await t.test('components start only near the viewport, and a page loads only the code of its components', async () => {
    const page = await open('rope');
    await waitForReady(page, 2);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state ?? null), null);
    await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
    assert.equal(await page.evaluate(() => document.querySelectorAll('grid-view')[document.querySelectorAll('grid-view').length - 1].textContent), 'grid far');
    await page.close();

    const other = await open(null);
    const requested = [];
    other.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await other.goto(`${origin}/2026-10/gelu/`);
    await waitForReady(other);
    const scripts = requested.filter((path) => path.endsWith('.js')).map((path) => path.split('/').pop().replace(/-[\w-]{8}\.js$/, ''));
    assert.ok(scripts.includes('grid-view'), scripts.join(', '));
    assert.ok(!scripts.some((name) => ['count-view', 'tex-view', 'solid-element'].includes(name)), scripts.join(', '));
    await other.close();
  });

  await t.test('the article styles of the essay theme do not reach the content of a component', async () => {
    const page = await open('text');
    await waitForReady(page);
    const styles = await page.evaluate(() => {
      const read = (element) => {
        const style = getComputedStyle(element);
        return {
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          color: style.color,
          background: style.backgroundColor,
          decoration: style.textDecorationThickness,
        };
      };
      const component = document.querySelector('text-view');
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = component.innerHTML;
      component.append(host);
      const reference = ['h3', 'p', 'code', 'a'].map((tag) => read(host.shadowRoot.querySelector(tag)));
      host.remove();
      return {
        component: ['h3', 'p', 'code', 'a'].map((tag) => read(document.querySelector(`text-view ${tag}`))),
        reference,
        article: [read(document.querySelector('.bk-article > h3, .bk-article h3')), read(document.querySelector('.bk-article p'))],
      };
    });
    assert.deepEqual(styles.component, styles.reference);
    assert.notEqual(styles.component[0].marginTop, styles.article[0].marginTop);
    assert.notEqual(styles.component[0].fontSize, styles.article[0].fontSize);
    assert.notEqual(styles.component[1].marginTop, styles.article[1].marginTop);
    await page.close();
  });

  await t.test('the theme setting and the system color scheme dispatch bake:theme', async () => {
    const page = await open('rope');
    await waitForReady(page, 1);
    const themes = () => page.evaluate(() => Number(document.querySelector('.count-view-text').dataset.themes));
    assert.equal(await themes(), 0);
    await page.click('.bk-settings-toggle');
    await page.click('[data-setting="theme"] [data-value="dark"]');
    assert.equal(await themes(), 1);
    await page.click('[data-setting="theme"] [data-value="system"]');
    assert.equal(await themes(), 2);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.querySelector('.count-view-text').dataset.themes === '3');
    await page.click('[data-setting="theme"] [data-value="light"]');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await themes(), 4);
    await page.close();
  });
});

function distinctColors({ data }) {
  const colors = new Set();
  for (let index = 0; index < data.length && colors.size < 2; index += 4) colors.add(data.readUInt32BE(index));
  return colors.size;
}

function componentOverflow() {
  const problems = [];
  for (const frame of document.querySelectorAll('figure.component')) {
    const box = frame.querySelector('.component-box');
    const element = box.firstElementChild;
    const bounds = box.getBoundingClientRect();
    const name = `${frame.dataset.component} ${frame.dataset.params}`;
    if (element.scrollHeight > box.clientHeight + 1) problems.push(`${name}: content height ${element.scrollHeight} in a ${box.clientHeight}px box`);
    if (element.scrollWidth > element.clientWidth + 1) problems.push(`${name}: content width ${element.scrollWidth} in a ${element.clientWidth}px element`);
    for (const descendant of element.querySelectorAll('*')) {
      const rect = descendant.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || getComputedStyle(descendant).visibility === 'hidden') continue;
      if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
        problems.push(`${name}: <${descendant.tagName.toLowerCase()} class="${descendant.getAttribute('class') ?? ''}"> reaches outside the box`);
      }
    }
  }
  return problems;
}

test('the example components run on the syntax page', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-components-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const start = async (options) => {
    const page = await browser.newPage(options);
    const problems = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    await page.goto(`${origin}/2026-10/syntax/`);
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => frame.dataset.state === 'ready'));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) => setTimeout(done, 500));
    });
    return { page, problems };
  };

  await t.test('every component stays inside its box at 1440 and 375 pixels, in the light and the dark scheme, without console errors or warnings', async () => {
    for (const width of [1440, 375]) {
      for (const colorScheme of ['light', 'dark']) {
        const { page, problems } = await start({ viewport: { width, height: 900 }, colorScheme });
        assert.ok((await page.evaluate(() => document.querySelectorAll('.example-result figure.component').length)) > 0);
        assert.deepEqual(await page.evaluate(componentOverflow), [], `${width}px ${colorScheme}`);
        assert.deepEqual(problems, [], `${width}px ${colorScheme}`);
        await page.close();
      }
    }
  });

  await t.test('every chapter of the syntax article renders a screenshot with content at 1440 and 375 pixels', async () => {
    mkdirSync(screenshotDir, { recursive: true });
    for (const width of [1440, 375]) {
      const { page, problems } = await start({ viewport: { width, height: 900 } });
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('section.bk-section')].map((section) => {
          const rect = section.getBoundingClientRect();
          return { id: section.querySelector('h2').id, top: rect.top + scrollY, width: rect.width, height: rect.height };
        }),
      );
      assert.equal(sections.length, 15);
      for (const { id, top, width: sectionWidth, height } of sections) {
        assert.ok(sectionWidth > 0 && height > 0, `${width}px ${id}: the section is ${sectionWidth}x${height}`);
        const clip = { x: 0, y: top, width, height };
        const image = PNG.sync.read(await page.screenshot({ fullPage: true, clip, path: join(screenshotDir, `${width}-${id}.png`) }));
        assert.ok(distinctColors(image) > 1, `${width}px ${id}: the screenshot has one color`);
      }
      assert.deepEqual(problems, [], `${width}px`);
      await page.close();
    }
  });

  await t.test('the heatmap redraws when the theme setting changes', async () => {
    const { page, problems } = await start({ viewport: { width: 1440, height: 900 } });
    const pixels = () => page.evaluate(() => document.querySelector('glu-heatmap canvas').toDataURL());
    const light = await pixels();
    await page.click('.bk-settings-toggle');
    await page.click('[data-setting="theme"] [data-value="dark"]');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.notEqual(await pixels(), light);
    assert.deepEqual(problems, []);
    await page.close();
  });
});
