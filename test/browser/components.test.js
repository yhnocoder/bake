import assert from 'node:assert/strict';
import { article, validConfig } from '../blog.js';
import { test as base, luminance, settle } from './browser.js';

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
    this.innerHTML = '<h3>Title</h3><p>Text with <code>code</code> and <a href="#top">a link</a>.</p><ul><li>An item</li></ul>';
  }
}
`,
  'components/hint-view.js': `export const layout = { placeholder: { narrow: 420, wide: 240 } };

export default class HintView extends HTMLElement {
  connectedCallback() {
    this.textContent = 'hint';
  }
}
`,
  'components/broken-view.js': `export const layout = { height: 120 };

export default class BrokenView extends HTMLElement {
  connectedCallback() {
    throw new Error('broken-view has no data');
  }
}
`,
  'components/broken-solid.jsx': `export const layout = { height: 120 };

export default function BrokenSolid() {
  throw new Error('broken-solid has no data');
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
  'content/posts/below/index.md': article({ slug: 'below', body: `:::grid-view\n:::\n\n${spacer}\n\n:::text-view\n:::\n` }),
  'content/posts/later/index.md': article({ slug: 'later', body: `:::grid-view\n:::\n\n${spacer}\n\n:::count-view\n:::\n\n${spacer}\n\n:::tex-view\n:::\n` }),
  'content/posts/hint/index.md': article({ slug: 'hint', body: ':::hint-view\n:::\n' }),
  'content/posts/broken/index.md': article({ slug: 'broken', body: ':::broken-view\n:::\n\n:::broken-solid\n:::\n\n:::grid-view\n:::\n' }),
  'content/posts/source/index.md': article({ slug: 'source', body: '## Grid {#grid}\n\n:::grid-view{mode=far}\n:::\n' }),
  'content/posts/embedder/index.md': article({ slug: 'embedder', body: 'An article without components of its own.\n\n:::embed\n/2026-10/source/#grid\n:::\n' }),
  'content/posts/text/index.md': article({ slug: 'text', body: 'An article paragraph.\n\n- An article item\n\n### An article heading\n\n:::text-view\n:::\n' }),
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

const test = base.extend({
  open: async ({ newPage }, use) => {
    await use(async (path, options = {}) => {
        const page = await newPage(options);
        const problems = [];
        page.on('console', (message) => {
          if (['error', 'warning'].includes(message.type())) problems.push(message.text());
        });
        page.on('pageerror', (error) => problems.push(error.message));
        page.problems = problems;
        if (path !== null) await page.goto(`/2026-10/${path}/`);
        return page;
    });
  },
  start: async ({ newPage }, use) => {
    await use(async (options, path = '2026-10/syntax/') => {
        const page = await newPage(options);
        const problems = [];
        page.on('console', (message) => {
          if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`);
        });
        page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
        await page.goto(`/${path}`);
        await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
        await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => frame.dataset.state === 'ready'));
        await page.evaluate(async () => {
          await document.fonts.ready;
          const count = () => [...document.querySelectorAll('.component-box svg')].filter((svg) => svg.querySelector(':scope > g > g[data-mml-node="math"]') !== null).length;
          let last = -1;
          let still = 0;
          while (still < 10) {
            const now = count();
            still = now === last ? still + 1 : 0;
            last = now;
            await new Promise((done) => requestAnimationFrame(done));
          }
        });
        await page.waitForFunction(() => [...document.querySelectorAll('.bk-kit-tex, .bk-kit-svg-tex')].every((label) => label.querySelector('svg, text') !== null || label.textContent !== ''));
        return { page, problems };
    });
  },
});

test.describe('components run in the browser', () => {
  test.use({ viewport: { width: 1440, height: 800 }, blog: { example: false, files: blog } });

  test('a SolidJS component and a plain custom element run with their params', async ({ open }) => {
    const page = await open('rope');
    await waitForReady(page, 3);
    await page.waitForSelector('tex-view[data-done]');
    const texts = await page.evaluate(() => [document.querySelector('count-view').textContent, document.querySelector('grid-view').textContent]);
    assert.deepEqual(texts, ['hello 3 false', 'grid near']);
    assert.deepEqual(page.problems, []);
  });

  test('texToSvg typesets each formula into one SVG with the preamble macros and the dynamic font glyphs', async ({ open }) => {
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
  });

  test('a component without layout.height shows the placeholder height until it loads and then the height of its content, and a box with a ratio keeps its height, at 1440 and 375 pixels', async ({ open }) => {
    for (const width of [1440, 375]) {
      const page = await open(null, { viewport: { width, height: 800 } });
      let release;
      const held = new Promise((done) => {
        release = done;
      });
      await page.route(/\/assets\/(count-view|grid-view)-[\w-]+\.js$/, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`/2026-10/rope/`);
      await page.waitForFunction(() => document.querySelector('figure.component').dataset.state === 'loading');
      const before = await page.evaluate(frameHeights);
      release();
      await waitForReady(page, 2);
      const after = await page.evaluate(frameHeights);
      const elements = await page.evaluate(() => ['count-view', 'grid-view'].map((name) => document.querySelector(name).getBoundingClientRect().height));
      const placeholder = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--component-placeholder-height')));
      const text = await page.evaluate(() => document.querySelector('.count-view-text').getBoundingClientRect().height);
      assert.equal(before[0].box, placeholder, `${width}px: count-view placeholder height`);
      assert.equal(after[0].box, text, `${width}px: count-view takes the height of its content`);
      assert.deepEqual(after[1], before[1], `${width}px: grid-view keeps its box`);
      assert.ok(Math.abs(before[1].box - before[1].width / 2) < 1, `${width}px: grid-view keeps the ratio 2, ${before[1].width}x${before[1].box}`);
      assert.deepEqual(
        elements.map(Math.round),
        after.map((entry) => Math.round(entry.box)),
        `${width}px: each element fills its box`,
      );
    }
  });

  test('a component with layout.placeholder shows the narrow height on screens below 600 pixels and the wide height from 600 pixels up until it starts', async ({ open }) => {
    for (const [width, height] of [
      [375, 420],
      [599, 420],
      [600, 240],
      [1440, 240],
    ]) {
      const page = await open('hint', { viewport: { width, height: 800 }, javaScriptEnabled: false });
      assert.equal(await page.evaluate(() => document.querySelector('.component-box').getBoundingClientRect().height), height, `${width}px`);
    }
  });

  test('a component that throws while it connects is marked failed and the frame says that it could not be loaded', async ({ open }) => {
    const page = await open('broken');
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => ['ready', 'failed'].includes(frame.dataset.state)));
    const frames = await page.evaluate(() =>
      [...document.querySelectorAll('figure.component')].map((frame) => {
        const box = frame.querySelector('.component-box');
        return { name: frame.dataset.component, state: frame.dataset.state, elements: box.children.length, message: getComputedStyle(box, '::before').content };
      }),
    );
    const failed = { state: 'failed', elements: 0, message: '"This interactive figure could not be loaded"' };
    assert.deepEqual(frames, [
      { name: 'broken-view', ...failed },
      { name: 'broken-solid', ...failed },
      { name: 'grid-view', state: 'ready', elements: 1, message: 'none' },
    ]);
    assert.deepEqual(page.problems.map((problem) => problem.split(' ').slice(0, 3).join(' ')).sort(), ['broken-solid cannot start', 'broken-view cannot start']);
  });

  test('without scripts every frame says that the interactive figure needs JavaScript', async ({ open }) => {
    const page = await open('rope', { javaScriptEnabled: false });
    const messages = await page.evaluate(() => [...document.querySelectorAll('.component-box')].map((box) => getComputedStyle(box, '::before').content));
    assert.equal(messages.length, 7);
    assert.ok(messages.every((message) => message === '"This interactive figure needs JavaScript"'), messages.join(', '));
  });

  test('a component in embedded content runs on the page that embeds it', async ({ open }) => {
    const page = await open('embedder');
    await waitForReady(page);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.embed grid-view')].map((element) => element.textContent)), ['grid far']);
    assert.deepEqual(page.problems, []);
  });

  test('the page of a component shows only the component with its parameters, takes the color scheme from ?scheme, and sends its height to the page that shows it in a frame', async ({ open }) => {
    const page = await open('rope/components/count-view');
    await waitForReady(page);
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('figure.component').length, document.querySelector('count-view').textContent, document.querySelector('figcaption')]), [1, 'hello 3 false', null]);
    const background = async (scheme) => {
      await page.goto(`/2026-10/rope/components/count-view/?scheme=${scheme}`);
      return luminance(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    };
    assert.ok((await background('dark')) < (await background('light')), 'the dark scheme is darker than the light one');

    await page.goto('/2026-10/gelu/');
    const heights = await page.evaluate(async () => {
      const frame = Object.assign(document.createElement('iframe'), { src: 'components/grid-view/' });
      frame.style.cssText = 'width: 400px; height: 10px; border: 0';
      const received = [];
      const next = () => new Promise((done) => addEventListener('message', (event) => done(event.source === frame.contentWindow ? event.data : null), { once: true }));
      let message = next();
      document.body.append(frame);
      received.push(await message);
      message = next();
      frame.style.width = '200px';
      received.push(await message);
      return { received, content: Math.ceil(frame.contentDocument.documentElement.getBoundingClientRect().height) };
    });
    assert.deepEqual(heights, { received: [{ type: 'bake:height', height: 200 }, { type: 'bake:height', height: 100 }], content: 100 });
    assert.deepEqual(page.problems, []);
  });

  test('pixel and percent widths measure their width, are centred and never exceed the screen', async ({ open }) => {
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
    }
  });

  test('components start only near the viewport, and a page loads only the code of its components', async ({ open }) => {
    const page = await open('rope');
    await waitForReady(page, 2);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state ?? null), null);
    await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
    assert.equal(await page.evaluate(() => document.querySelectorAll('grid-view')[document.querySelectorAll('grid-view').length - 1].textContent), 'grid far');

    const other = await open(null);
    const requested = [];
    other.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await other.goto(`/2026-10/gelu/`);
    await waitForReady(other);
    const scripts = requested.filter((path) => path.endsWith('.js')).map((path) => path.split('/').pop().replace(/-[\w-]{8}\.js$/, ''));
    assert.ok(scripts.includes('grid-view'), scripts.join(', '));
    assert.ok(!scripts.some((name) => ['count-view', 'tex-view', 'solid-element', 'mathjax'].includes(name)), scripts.join(', '));
  });

  test('once the page has loaded, the code of a component far below the screen is downloaded before the component starts and runs only when it starts', async ({ open }) => {
    const page = await open('below');
    await waitForReady(page, 1);
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /[/]text-view-[\w-]{8}\.js$/.test(entry.name) && entry.responseEnd > 0));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state ?? null), null);
    assert.equal(await page.evaluate(() => customElements.get('text-view') === undefined), true);
    await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
    const downloads = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /[/]text-view-[\w-]{8}\.js$/.test(entry.name)).map((entry) => entry.transferSize));
    assert.equal(downloads.filter((size) => size > 0).length, 1, `the component reads its code from the HTTP cache: ${downloads}`);
    assert.deepEqual(page.problems, []);
  });

  test('the files of components far below the screen are downloaded one component after another, nearest first, with the Solid wrapper of a Solid component and without MathJax', async ({ open }) => {
    const page = await open('later');
    await waitForReady(page, 1);
    const pattern = { count: /[/](count-view|solid-element)-[\w-]{8}\.(js|css)$/, tex: /[/](tex-view|math)-[\w-]{8}\.js$/ };
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /[/]tex-view-[\w-]{8}\.js$/.test(entry.name) && entry.responseEnd > 0));
    await page.waitForLoadState('networkidle');
    const entries = await page.evaluate(() => performance.getEntriesByType('resource').map(({ name, startTime, responseEnd }) => ({ name, startTime, responseEnd })));
    const count = entries.filter((entry) => pattern.count.test(entry.name));
    const tex = entries.filter((entry) => pattern.tex.test(entry.name));
    assert.ok(count.some((entry) => /solid-element/.test(entry.name)), entries.map((entry) => entry.name).join(', '));
    assert.ok(Math.max(...count.map((entry) => entry.responseEnd)) <= Math.min(...tex.map((entry) => entry.startTime)), JSON.stringify({ count, tex }));
    assert.ok(!entries.some((entry) => /[/]mathjax-[\w-]{8}\.js$/.test(entry.name)), 'MathJax is downloaded only when a component that needs it starts');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('figure.component')].map((frame) => frame.dataset.state ?? null)), ['ready', null, null]);
  });

  test('a download in advance that a starting component cancelled is downloaded again before its own component starts', async ({ open }) => {
    const page = await open(null);
    let delayed = false;
    let firstRequest;
    const requested = new Promise((resolve) => {
      firstRequest = resolve;
    });
    await page.route(/[/]count-view-[\w-]{8}\.js$/, async (route) => {
      if (delayed) return route.continue();
      delayed = true;
      firstRequest();
      await page.waitForEvent('requestfailed', (request) => request === route.request());
      await route.continue().catch(() => {});
    });
    await page.goto(`/2026-10/later/`);
    await waitForReady(page, 1);
    await requested;
    await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /[/]count-view-[\w-]{8}\.js$/.test(entry.name) && entry.initiatorType === 'fetch' && entry.responseStatus === 200));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('figure.component')].map((frame) => frame.dataset.state ?? null)), ['ready', null, 'ready']);
  });

  test('after a resize, a component starts within the larger of 800 pixels and one and a half heights of the new viewport', async ({ open }) => {
    const page = await open('below', { viewport: { width: 1440, height: 1000 } });
    await waitForReady(page, 1);
    await page.setViewportSize({ width: 1440, height: 500 });
    const scrollToDistance = (distance) =>
      page.evaluate((below) => {
        const frame = [...document.querySelectorAll('figure.component')].at(-1);
        scrollTo(0, frame.getBoundingClientRect().top + scrollY - innerHeight - below);
      }, distance);
    const lastState = () => page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state ?? null);
    await scrollToDistance(1000);
    await settle(page);
    assert.equal(await lastState(), null);
    await scrollToDistance(700);
    await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
  });

  test('with Save-Data or a 2G connection, the code of a component far below the screen loads only when the component starts', async ({ open }) => {
    for (const connection of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: '2g' }]) {
      const page = await open(null);
      await page.addInitScript((value) => Object.defineProperty(Navigator.prototype, 'connection', { get: () => value }), connection);
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(`/2026-10/below/`, { waitUntil: 'load' });
      await waitForReady(page, 1);
      await page.waitForTimeout(200);
      assert.deepEqual(requests.filter((url) => /[/]text-view-[\w-]{8}\.js$/.test(url)), [], JSON.stringify(connection));
      await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
      await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state === 'ready');
    }
  });

  test('a component far below the screen starts when its code could not be loaded right after the page loaded', async ({ open }) => {
    const page = await open(null);
    let blocked = true;
    await page.route(/[/]text-view-[\w-]{8}\.js$/, (route) => (blocked ? route.abort() : route.continue()));
    const failed = page.waitForEvent('requestfailed', (request) => /[/]text-view-[\w-]{8}\.js$/.test(request.url()));
    await page.goto(`/2026-10/below/`);
    await waitForReady(page, 1);
    await failed;
    blocked = false;
    await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).scrollIntoView());
    await page.waitForFunction(() => ['ready', 'failed'].includes([...document.querySelectorAll('figure.component')].at(-1).dataset.state));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('figure.component')].at(-1).dataset.state), 'ready');
  });

  test('a Solid component starts when the first request for its shared Solid wrapper fails', async ({ open }) => {
    const page = await open(null);
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true }) }));
    // why: page.route turns off the HTTP cache that the download before the import relies on, so the request is failed in the network layer instead
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setBlockedURLs', { urls: ['*/solid-element-*'] });
    page.on('requestfailed', (request) => {
      if (/[/]solid-element-[\w-]{8}\.js$/.test(request.url())) session.send('Network.setBlockedURLs', { urls: [] });
    });
    await page.goto(`/2026-10/rope/`);
    const frame = 'figure.component[data-component="count-view"]';
    await page.waitForFunction((selector) => ['ready', 'failed'].includes(document.querySelector(selector).dataset.state), frame);
    assert.equal(await page.locator(frame).getAttribute('data-state'), 'ready');
  });

  test('the article styles of the essay theme do not reach the headings, paragraphs, code, links and lists of a component', async ({ open }) => {
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
          paddingLeft: style.paddingLeft,
        };
      };
      const component = document.querySelector('text-view');
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = component.innerHTML;
      component.append(host);
      const tags = ['h3', 'p', 'code', 'a', 'ul', 'li'];
      const reference = tags.map((tag) => read(host.shadowRoot.querySelector(tag)));
      host.remove();
      return {
        component: tags.map((tag) => read(document.querySelector(`text-view ${tag}`))),
        reference,
        article: ['h3', 'p', 'ul', 'li'].map((tag) => read(document.querySelector(`.bk-article ${tag}`))),
      };
    });
    assert.deepEqual(styles.component, styles.reference);
    assert.notEqual(styles.component[0].marginTop, styles.article[0].marginTop);
    assert.notEqual(styles.component[0].fontSize, styles.article[0].fontSize);
    assert.notEqual(styles.component[1].marginTop, styles.article[1].marginTop);
    assert.notEqual(styles.component[4].paddingLeft, styles.article[2].paddingLeft);
    assert.notEqual(styles.component[5].marginTop, styles.article[3].marginTop);
  });

  test('the theme setting and the system color scheme dispatch bake:theme', async ({ open }) => {
    const page = await open('rope');
    await waitForReady(page, 1);
    const themes = () => page.evaluate(() => Number(document.querySelector('.count-view-text').dataset.themes));
    assert.equal(await themes(), 0);
    await page.click('.bk-settings-toggle');
    await page.click('[data-setting="theme"] [data-value="dark"]');
    await page.waitForFunction(() => document.querySelector('.count-view-text').dataset.themes === '1');
    await page.click('[data-setting="theme"] [data-value="system"]');
    await page.waitForFunction(() => document.querySelector('.count-view-text').dataset.themes === '2');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.querySelector('.count-view-text').dataset.themes === '3');
    await page.click('[data-setting="theme"] [data-value="light"]');
    await page.waitForFunction(() => document.querySelector('.count-view-text').dataset.themes === '4');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await themes(), 4);
  });
});

function formulaShifts() {
  const shifts = [];
  for (const box of document.querySelectorAll('.component-box')) {
    const formulas = [...box.querySelectorAll('svg')].filter((svg) => svg.querySelector(':scope > g > g[data-mml-node="math"]') !== null);
    const others = [...box.querySelectorAll('*')].filter((element) => !formulas.some((formula) => formula.contains(element) || element.contains(formula)));
    const rects = () => others.map((element) => element.getBoundingClientRect());
    const typeset = rects();
    formulas.forEach((formula) => formula.style.setProperty('display', 'none'));
    const pending = rects();
    formulas.forEach((formula) => formula.style.removeProperty('display'));
    others.forEach((element, index) => {
      const [before, after] = [pending[index], typeset[index]];
      if (['left', 'top', 'width', 'height'].some((side) => Math.abs(before[side] - after[side]) > 1)) {
        shifts.push(`${box.parentElement.dataset.component}: <${element.tagName.toLowerCase()} class="${element.getAttribute('class') ?? ''}"> moves from ${Math.round(before.left)},${Math.round(before.top)} to ${Math.round(after.left)},${Math.round(after.top)}`);
      }
    });
  }
  return shifts;
}

async function contentHeights() {
  const frames = [...document.querySelectorAll('figure.component')].filter((frame) => !frame.querySelector('.component-box').hasAttribute('style'));
  if (frames.length === 0) return ['the page has no component without layout.height'];
  const problems = [];
  for (const frame of frames) {
    frame.scrollIntoView({ block: 'center' });
    const box = frame.querySelector('.component-box');
    let height = -1;
    let still = 0;
    while (still < 10) {
      await new Promise((done) => requestAnimationFrame(done));
      still = box.offsetHeight === height ? still + 1 : 0;
      height = box.offsetHeight;
    }
    const element = box.firstElementChild;
    const parts = [...element.querySelectorAll('*')].map((part) => part.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
    const bottom = Math.max(...parts.map((rect) => rect.bottom));
    const blank = box.getBoundingClientRect().bottom - bottom;
    if (blank < -1 || blank > 24 || element.scrollHeight > element.clientHeight + 1) problems.push(`${frame.dataset.component}: the box ends ${Math.round(blank)} pixels below its content`);
  }
  return problems;
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

test.describe('the example components run on the syntax page', () => {
  test('every component stays inside its box at 1440 and 375 pixels, in the light and the dark scheme, its formulas move nothing when they arrive, and the page logs no console errors or warnings', async ({ start }) => {
    for (const width of [1440, 375]) {
      for (const colorScheme of ['light', 'dark']) {
        const { page, problems } = await start({ viewport: { width, height: 900 }, colorScheme });
        assert.ok((await page.evaluate(() => document.querySelectorAll('.example-result figure.component').length)) > 0);
        assert.deepEqual(await page.evaluate(componentOverflow), [], `${width}px ${colorScheme}`);
        assert.deepEqual(await page.evaluate(formulaShifts), [], `${width}px ${colorScheme}: formulas from texToSvg move nothing when they arrive`);
        assert.deepEqual(problems, [], `${width}px ${colorScheme}`);
      }
    }
  });

  test('a component without layout.height is as tall as its content at 1440, 800, 600 and 375 pixels', async ({ start }) => {
    const { page, problems } = await start({}, '2026-09/matrix-calculus/');
    for (const width of [1440, 800, 600, 375]) {
      await page.setViewportSize({ width, height: 900 });
      assert.deepEqual(await page.evaluate(contentHeights), [], `${width}px`);
    }
    assert.deepEqual(problems, []);
  });

  test('an example with a component stacks its source above its result, so pixel widths keep their size and stay centred', async ({ start }) => {
    for (const width of [1440, 375]) {
      const { page, problems } = await start({ viewport: { width, height: 900 } });
      const frames = await page.evaluate(() =>
        ['560px', '1000px'].map((size) => {
          const frame = document.querySelector(`.example-result figure.component[style="width:${size}"]`);
          const rect = frame.getBoundingClientRect();
          const result = frame.closest('.example-result').getBoundingClientRect();
          return { width: rect.width, offset: rect.left + rect.width / 2 - (result.left + result.width / 2), right: rect.right };
        }),
      );
      const screen = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      const label = `${width}px`;
      assert.ok(screen.scroll <= screen.client, `${label}: the page scrolls horizontally, ${screen.scroll} > ${screen.client}`);
      for (const frame of frames) {
        assert.ok(Math.abs(frame.offset) < 1, `${label}: a frame is ${frame.offset}px off the centre of its result`);
        assert.ok(frame.right <= screen.client, `${label}: a frame ends at ${frame.right}`);
      }
      if (width === 1440) assert.deepEqual(frames.map((frame) => Math.round(frame.width)), [560, 1000]);
      assert.deepEqual(problems, [], label);
    }
  });

  test('the heatmap redraws when the theme setting changes', async ({ start }) => {
    const { page, problems } = await start({ viewport: { width: 1440, height: 900 } });
    const pixels = () => page.evaluate(() => document.querySelector('glu-heatmap canvas').toDataURL());
    const light = await pixels();
    await page.click('.bk-settings-toggle');
    await page.click('[data-setting="theme"] [data-value="dark"]');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.notEqual(await pixels(), light);
    assert.deepEqual(problems, []);
  });
});
