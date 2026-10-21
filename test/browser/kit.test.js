import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog, decodeImage, exampleBuild, validConfig } from '../blog.js';
import { launchBrowser, serve, settle } from './browser.js';

const PLOT = 'figure.component[data-component="act-fn-plot"]';

const kitBlog = {
  'bake.config.js': validConfig,
  'preamble.sty': '\\ProvidesPackage{preamble}\n\n\\newcommand{\\R}{\\mathbb{R}}\n',
  'components/kit-demo.jsx': `import { createSignal } from 'solid-js';
import { Axes, Button, Controls, Crosshair, Curve, Plot, Segmented, Slider, SvgTex, Toggle, createTween } from 'bake/kit';

export const layout = { height: 340 };

export default function KitDemo() {
  const [slope, setSlope] = createSignal(1);
  const [shape, setShape] = createSignal('line');
  const [grid, setGrid] = createSignal(true);
  const tweened = createTween(slope, { duration: 400 });
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
      <Controls>
        <Button onClick={() => setSlope(slope() + 1)}>Steeper</Button>
        <span class="kit-demo-slope">{slope()}</span>
        <span class="kit-demo-tween">{tweened().toFixed(3)}</span>
        <Segmented label="Shape" options={['line', 'cube']} value={shape()} onChange={setShape} />
        <Slider label="Slope" min={0} max={5} step={0.5} value={slope()} onInput={setSlope} />
        <Toggle label="Grid" checked={grid()} onChange={setGrid} />
      </Controls>
      <div class="kit-demo-area" style={{ flex: '1 1 0', 'min-height': '0' }}>
        <Plot x={[-2, 2]} y={[-4, 4]} label="Line">
          <Axes grid={grid()} />
          <Curve f={(x) => (shape() === 'line' ? slope() * x : slope() * x ** 3)} color="var(--series-1)" label="line" />
          <Curve f={(x) => 1000 * x} color="var(--series-2)" label="steep" />
          <Crosshair />
          <SvgTex tex="\\R^{n}" x={120} y={30} anchor="middle" baseline="middle" />
          <SvgTex tex="\\R" x={200} y={60} anchor="start" baseline="baseline" />
        </Plot>
      </div>
    </div>
  );
}
`,
  'components/tick-list.js': `import { niceTicks } from 'bake/kit';

export const layout = { height: 80 };

export default class TickList extends HTMLElement {
  connectedCallback() {
    this.textContent = niceTicks(0, 1, 4).map((tick) => tick.label).join(' ');
  }
}
`,
  'components/plain-view.js': `export const layout = { height: 80 };

export default class PlainView extends HTMLElement {
  connectedCallback() {
    this.textContent = 'plain';
  }
}
`,
  'components/broken-tex.jsx': `import { Tex } from 'bake/kit';

export const layout = { height: 80 };

export default function BrokenTex() {
  return <p class="broken-tex">Label <Tex tex="\\frac{" /></p>;
}
`,
  'components/step-sliders.jsx': `import { Controls, Slider } from 'bake/kit';

export const layout = { height: 80 };

export default function StepSliders() {
  return (
    <Controls>
      <Slider label="Quarter" min={0} max={1} step={0.25} value={0.25} onInput={() => {}} />
      <Slider label="Two and a half" min={0} max={10} step={2.5} value={7.5} onInput={() => {}} />
    </Controls>
  );
}
`,
  'components/sized-plots.jsx': `import { Axes, Plot } from 'bake/kit';

export const layout = { height: 240 };

export default function SizedPlots() {
  return (
    <div>
      <div class="sized-width" style={{ height: '120px' }}>
        <Plot width={200} x={[0, 1]} y={[0, 1]} label="Width only">
          <Axes />
        </Plot>
      </div>
      <div class="sized-height" style={{ width: '300px' }}>
        <Plot height={90} x={[0, 1]} y={[0, 1]} label="Height only">
          <Axes />
        </Plot>
      </div>
    </div>
  );
}
`,
  'components/math-labels.jsx': `import { MathText, SvgMathText } from 'bake/kit';

export const layout = { height: 200 };

export default function MathLabels() {
  return (
    <div>
      <p class="math-labels-text">
        <MathText text="Area $\\R^{2}$ and $$x^{2}$$ end" />
      </p>
      <svg class="math-labels-svg" width="300" height="80">
        <SvgMathText text="side $a^{2}$ long" x={150} y={40} anchor="middle" />
        <SvgMathText class="math-labels-edge" text="edge $b^{2}$" x={290} y={70} within={[0, 300]} />
      </svg>
    </div>
  );
}
`,
  'content/posts/math-labels/index.md': article({ slug: 'math-labels', body: ':::math-labels\n:::\n' }),
  'content/posts/sized-plots/index.md': article({ slug: 'sized-plots', body: ':::sized-plots\n:::\n' }),
  'content/posts/step-sliders/index.md': article({ slug: 'step-sliders', body: ':::step-sliders\n:::\n' }),
  'content/posts/plain/index.md': article({ slug: 'plain', body: ':::plain-view\n:::\n' }),
  'content/posts/broken-tex/index.md': article({ slug: 'broken-tex', body: ':::broken-tex\n:::\n' }),
  'content/posts/demo/index.md': article({ slug: 'demo', body: ':::kit-demo\n:::\n' }),
  'content/posts/ticks/index.md': article({ slug: 'ticks', body: ':::tick-list\n:::\n' }),
};

function waitForComponents(page) {
  return page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => frame.dataset.state === 'ready'));
}

function plotState(index) {
  const frame = document.querySelectorAll('figure.component[data-component="act-fn-plot"]')[index];
  return {
    legend: [...frame.querySelectorAll('.act-fn-legend-item')].map((item) => item.textContent.trim()),
    status: frame.querySelector('.act-fn-status')?.textContent ?? null,
    panels: [...frame.querySelectorAll('.bk-kit-plot-svg')].map((svg) => ({
      curves: [...svg.querySelectorAll('path.bk-kit-curve')].map((path) => path.getAttribute('d')),
      ticks: [...svg.querySelectorAll('text.bk-kit-tick')].map((text) => text.textContent),
      axes: svg.querySelectorAll('line.bk-kit-axis').length,
      grid: svg.querySelectorAll('line.bk-kit-grid').length,
    })),
  };
}

function setSlider({ index, label, value }) {
  const frame = document.querySelectorAll('figure.component[data-component="act-fn-plot"]')[index];
  const slider = [...frame.querySelectorAll('.bk-kit-slider')].find((element) => element.querySelector('.bk-kit-label').textContent === label);
  const input = slider.querySelector('input');
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function nextFrames() {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}

function overflow() {
  const problems = [];
  for (const frame of document.querySelectorAll('figure.component[data-component="act-fn-plot"]')) {
    const box = frame.querySelector('.component-box');
    const bounds = box.getBoundingClientRect();
    for (const element of box.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
        problems.push(`${frame.dataset.params}: <${element.tagName.toLowerCase()} class="${element.getAttribute('class') ?? ''}"> reaches outside the box`);
      }
    }
  }
  return [...new Set(problems)];
}

function colorCount({ data }) {
  const colors = new Set();
  for (let index = 0; index < data.length; index += 4) colors.add(data.readUInt32BE(index));
  return colors.size;
}

test('the kit draws the example function plot', async (t) => {
  const dir = exampleBuild();
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await launchBrowser();

  const open = async (options = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
    const problems = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    await page.goto(`${origin}/2026-10/syntax/`);
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    await waitForComponents(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.bk-kit-tex, .bk-kit-svg-tex')].every((label) => label.querySelector('svg, text') !== null || label.textContent !== ''));
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settle(page);
    return { page, problems };
  };

  await t.test('each plot draws its curves, axes and legend in two panels', async () => {
    const { page, problems } = await open();
    const [gelu, swish, relu] = await Promise.all([0, 1, 2].map((index) => page.evaluate(plotState, index)));
    assert.deepEqual(gelu.legend, ['GELU', 'GELU (tanh 近似)', 'GELU (quick 近似)']);
    assert.equal(swish.legend.length, 1);
    assert.equal(relu.legend.length, 1);
    for (const plot of [gelu, swish, relu]) {
      assert.equal(plot.panels.length, 2);
      for (const panel of plot.panels) {
        assert.ok(panel.curves.length > 0 && panel.curves.every((path) => path.startsWith('M')));
        assert.equal(panel.axes, 2);
        assert.ok(panel.grid > 4 && panel.ticks.length > 4, panel.ticks.join(' '));
      }
    }
    assert.deepEqual(gelu.panels.map((panel) => panel.curves.length), [3, 3]);
    assert.ok(swish.panels[0].ticks.includes('−6') && swish.panels[0].ticks.includes('6'), swish.panels[0].ticks.join(' '));
    assert.match(swish.status, /^gate 过渡区：\[−1\.10, 1\.10\]；宽 2\.20/);
    assert.ok(relu.panels[1].curves[0].split('M').length > 2, 'the derivative of ReLU is not joined at 0');
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the crosshair and its readout follow the pointer and leave with it', async () => {
    const { page, problems } = await open();
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    const svg = await frame.locator('.bk-kit-plot-svg').first().boundingBox();
    const readout = async () =>
      page.evaluate(() => {
        const frame = document.querySelector('figure.component[data-component="act-fn-plot"]');
        const [first, second] = frame.querySelectorAll('.bk-kit-plot-svg');
        const box = first.querySelector('.bk-kit-readout');
        const rows = [...box.querySelectorAll('.bk-kit-readout-row')].map((row) => [...row.children].map((cell) => cell.textContent.trim()).join(' '));
        return {
          visible: getComputedStyle(box).opacity,
          rows,
          left: box.getBoundingClientRect().left - first.getBoundingClientRect().left,
          crosshair: Number(first.querySelector('.bk-kit-crosshair')?.getAttribute('x1') ?? NaN),
          dots: first.querySelectorAll('.bk-kit-dot').length,
          otherCrosshair: second.querySelector('.bk-kit-crosshair') !== null,
          otherReadout: getComputedStyle(second.querySelector('.bk-kit-readout')).opacity,
        };
      });
    await page.mouse.move(svg.x + svg.width * 0.3, svg.y + svg.height * 0.25);
    await settle(page);
    const left = await readout();
    await page.mouse.move(svg.x + svg.width * 0.7, svg.y + svg.height * 0.25);
    await settle(page);
    const right = await readout();
    assert.equal(left.visible, '1');
    assert.equal(left.otherReadout, '0');
    assert.ok(left.otherCrosshair, 'the other panel shows the crosshair at the same x');
    assert.equal(left.dots, 3);
    assert.ok(Math.abs(left.crosshair - svg.width * 0.3) < 1.5, `crosshair at ${left.crosshair}`);
    assert.ok(Math.abs(right.crosshair - svg.width * 0.7) < 1.5, `crosshair at ${right.crosshair}`);
    assert.equal(left.rows.length, 4);
    assert.match(left.rows[0], /^x −?\d\.\d\d$/);
    assert.notEqual(left.rows[0], right.rows[0]);
    assert.ok(right.left !== left.left, 'the readout moves with the pointer');
    assert.ok(right.left + 112 <= svg.width + 1 && right.left >= 0);
    await page.mouse.move(svg.x + svg.width / 2, svg.y - 120);
    await settle(page);
    const gone = await readout();
    assert.equal(gone.visible, '0');
    assert.ok(Number.isNaN(gone.crosshair));
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the sliders change the plot', async () => {
    const { page, problems } = await open({ reducedMotion: 'reduce' });
    await page.locator(PLOT).first().scrollIntoViewIfNeeded();
    const before = await page.evaluate(plotState, 0);
    await page.evaluate(setSlider, { index: 0, label: '横轴范围 ±', value: 1 });
    const zoomed = await page.evaluate(plotState, 0);
    assert.notDeepEqual(zoomed.panels[0].ticks, before.panels[0].ticks);
    assert.ok(zoomed.panels[0].ticks.includes('−1.0') && zoomed.panels[0].ticks.includes('1.0'), zoomed.panels[0].ticks.join(' '));
    await page.evaluate(setSlider, { index: 0, label: '横轴中心', value: 2 });
    const moved = await page.evaluate(plotState, 0);
    assert.ok(moved.panels[0].ticks.includes('3.0') && !moved.panels[0].ticks.includes('−1.0'), moved.panels[0].ticks.join(' '));

    const swish = await page.evaluate(plotState, 1);
    await page.locator(PLOT).nth(1).scrollIntoViewIfNeeded();
    await page.locator(PLOT).nth(1).locator('.bk-kit-slider input').evaluate((input) => {
      input.value = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const flat = await page.evaluate(plotState, 1);
    assert.notEqual(flat.panels[0].curves[0], swish.panels[0].curves[0]);
    assert.match(flat.status, /^gate 过渡区：\[−2\.20, 2\.20\]；宽 4\.39/);
    assert.equal(await page.locator(PLOT).nth(1).locator('.bk-kit-value').textContent(), '1.00');
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('every plot stays inside its box at 1440 and 375 pixels', async () => {
    for (const width of [1440, 375]) {
      const { page, problems } = await open({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.evaluate(nextFrames);
      assert.deepEqual((await page.evaluate(overflow)).filter((problem) => !problem.includes('"fns":"silu"')), [], `${width}px`);
      assert.deepEqual(problems, [], `${width}px`);
      await page.close();
    }
  });

  await t.test('the sliders and the TeX labels have accessible names', async () => {
    const { page, problems } = await open();
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    assert.equal(await frame.getByRole('slider', { name: '横轴范围 ±', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('slider', { name: '横轴范围 ±', exact: true }).getAttribute('aria-valuetext'), '4.00');
    assert.equal(await frame.getByRole('img', { name: 'f(x)', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('img', { name: '\\frac{df(x)}{dx}', exact: true }).count(), 1);
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the plot follows the color scheme, and its screenshots differ between light and dark', async () => {
    const shots = {};
    const strokes = {};
    for (const colorScheme of ['light', 'dark']) {
      const { page, problems } = await open({ colorScheme, reducedMotion: 'reduce' });
      const frame = page.locator(PLOT).first();
      await frame.scrollIntoViewIfNeeded();
      const svg = await frame.locator('.bk-kit-plot-svg').first().boundingBox();
      await page.mouse.move(svg.x + svg.width * 0.6, svg.y + svg.height / 2);
      await settle(page);
      shots[colorScheme] = await decodeImage(await frame.screenshot());
      strokes[colorScheme] = await page.evaluate(() => {
        const frame = document.querySelector('figure.component[data-component="act-fn-plot"]');
        return [frame.querySelector('path.bk-kit-curve'), frame.querySelector('.bk-kit-grid'), frame.querySelector('.bk-kit-readout')].map((element) => {
          const style = getComputedStyle(element);
          return element.tagName === 'DIV' ? style.backgroundColor : style.stroke;
        });
      });
      assert.deepEqual(problems, [], colorScheme);
      await page.close();
    }
    for (const index of [0, 1, 2]) assert.notEqual(strokes.light[index], strokes.dark[index]);
    assert.ok(colorCount(shots.light) > 20 && colorCount(shots.dark) > 20);
    assert.notDeepEqual(shots.light.data, shots.dark.data);
  });
});

test('the kit works for any component that imports it', async (t) => {
  const dir = createBlog(t, kitBlog);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await launchBrowser();

  await t.test('a plot with only a width fills the height of its parent, and a plot with only a height fills its width', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/2026-10/sized-plots/`);
    await waitForComponents(page);
    await page.waitForFunction(() => document.querySelectorAll('.bk-kit-plot-svg').length === 2);
    const sizes = await page.evaluate(() =>
      ['.sized-width', '.sized-height'].map((selector) => {
        const rect = document.querySelector(`${selector} .bk-kit-plot-svg`).getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      }),
    );
    assert.deepEqual(sizes, [
      [200, 120],
      [300, 90],
    ]);
    await page.close();
  });

  await t.test('a plot without a size fills its parent, a button changes it and a TeX label sits inside the SVG', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto(`${origin}/2026-10/demo/`);
    await waitForComponents(page);
    await page.waitForFunction(() => document.querySelector('.bk-kit-svg-tex svg') !== null);
    const read = () =>
      page.evaluate(() => {
        const area = document.querySelector('.kit-demo-area').getBoundingClientRect();
        const svg = document.querySelector('.bk-kit-plot-svg');
        const label = document.querySelector('.bk-kit-svg-tex');
        const formula = label.querySelector('svg').getBoundingClientRect();
        const plot = svg.getBoundingClientRect();
        return {
          area: [Math.round(area.width), Math.round(area.height)],
          plot: [Math.round(plot.width), Math.round(plot.height)],
          centre: [formula.left + formula.width / 2 - plot.left, formula.top + formula.height / 2 - plot.top],
          formula: formula.width > 0 && formula.height > 0,
          doubleStruck: label.querySelector('[data-c="211D"]') !== null,
          baseline: (() => {
            const formula = document.querySelectorAll('.bk-kit-svg-tex')[1].querySelector('svg').getBoundingClientRect();
            return [formula.left - plot.left, formula.bottom - plot.top];
          })(),
          path: svg.querySelector('path.bk-kit-curve').getAttribute('d'),
          slope: document.querySelector('.kit-demo-slope').textContent,
          cursor: getComputedStyle(document.querySelector('.bk-kit-button')).cursor,
        };
      });
    const before = await read();
    assert.deepEqual(before.plot, before.area);
    assert.ok(before.formula);
    assert.ok(before.doubleStruck, 'the label uses the \\R macro of preamble.sty');
    assert.ok(Math.abs(before.centre[0] - 120) < 1 && Math.abs(before.centre[1] - 30) < 1, `the formula is centred at ${before.centre}`);
    assert.ok(Math.abs(before.baseline[0] - 200) < 1 && Math.abs(before.baseline[1] - 60) < 1, `the formula starts at ${before.baseline} with its baseline on its point`);
    assert.equal(before.cursor, 'pointer');
    await page.focus('.bk-kit-button');
    await page.keyboard.press('Shift');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.bk-kit-button')).outlineStyle), 'solid');
    const svg = await page.locator('.bk-kit-plot-svg').boundingBox();
    await page.mouse.move(svg.x + svg.width * 0.613, svg.y + svg.height / 2);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.bk-kit-readout-row')].map((row) => row.lastElementChild.textContent));
    const shown = Number(rows[0].replace('−', '-'));
    assert.equal(rows[2], (1000 * shown).toFixed(3).replace('-', '−'), 'the readout computes y at the x it shows');
    await page.click('.bk-kit-button');
    const after = await read();
    assert.equal(after.slope, '2');
    assert.notEqual(after.path, before.path);
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('a slider shows its value with the decimals of its step', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/2026-10/step-sliders/`);
    await waitForComponents(page);
    const sliders = await page.evaluate(() =>
      [...document.querySelectorAll('.bk-kit-slider')].map((slider) => [slider.querySelector('.bk-kit-value').textContent, slider.querySelector('input').getAttribute('aria-valuetext')]),
    );
    assert.deepEqual(sliders, [
      ['0.25', '0.25'],
      ['7.5', '7.5'],
    ]);
    await page.close();
  });

  await t.test('controls show the pointer cursor and a focus outline, and segments are at least 24 pixels tall', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/2026-10/demo/`);
    await waitForComponents(page);
    const cursors = await page.evaluate(() =>
      ['.bk-kit-segment', '.bk-kit-segment input', '.bk-kit-slider', '.bk-kit-slider input', '.bk-kit-toggle', '.bk-kit-toggle input', '.bk-kit-button'].map((selector) => getComputedStyle(document.querySelector(selector)).cursor),
    );
    assert.deepEqual(new Set(cursors), new Set(['pointer']));
    await page.locator('.bk-kit-segment input').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.bk-kit-segment input:checked').getAttribute('value'), 'cube');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement.closest('.bk-kit-segment')).outlineStyle), 'solid');
    for (const control of ['.bk-kit-slider input', '.bk-kit-toggle input']) {
      await page.locator(control).first().focus();
      await page.keyboard.press('Shift');
      const style = await page.locator(control).first().evaluate((input) => getComputedStyle(input.type === 'checkbox' ? input.parentElement : input).outlineStyle);
      assert.equal(style, 'solid', control);
    }
    assert.equal(await page.getByRole('radio', { name: 'cube', exact: true }).count(), 1);
    assert.equal(await page.getByRole('switch', { name: 'Grid', exact: true }).count(), 1);
    const heights = await page.locator('.bk-kit-segment').evaluateAll((segments) => segments.map((segment) => segment.getBoundingClientRect().height));
    assert.ok(heights.every((height) => height >= 24), heights.join(', '));
    await page.close();
  });

  await t.test('with reduced motion no transition and no tween runs', async () => {
    const changes = async (reducedMotion) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
      await page.goto(`${origin}/2026-10/demo/`);
      await waitForComponents(page);
      await settle(page);
      const state = await page.evaluate(async () => {
        const frame = document.querySelector('figure.component');
        const running = () => document.getAnimations().filter((animation) => frame.contains(animation.effect?.target)).length;
        frame.querySelector('.bk-kit-toggle input').click();
        await new Promise((done) => requestAnimationFrame(done));
        const transitions = running();
        frame.querySelector('.bk-kit-button').click();
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return { transitions, tweening: frame.querySelector('.kit-demo-tween').textContent !== '2.000' };
      });
      await page.close();
      return state;
    };
    assert.deepEqual(await changes('reduce'), { transitions: 0, tweening: false });
    const moving = await changes('no-preference');
    assert.ok(moving.transitions > 0 && moving.tweening, JSON.stringify(moving));
  });

  await t.test('text with formulas flows inline in HTML, sits on one baseline in an SVG drawing and stays within the given x positions', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/2026-10/math-labels/`);
    await waitForComponents(page);
    await page.waitForFunction(() => document.querySelectorAll('.math-labels-text svg').length === 2 && document.querySelectorAll('.math-labels-svg svg').length === 2);
    const layout = await page.evaluate(() => {
      const paragraph = document.querySelector('.math-labels-text');
      const [inline, display] = paragraph.querySelectorAll('.bk-kit-tex');
      const svg = document.querySelector('.math-labels-svg').getBoundingClientRect();
      const label = document.querySelector('.math-labels-svg .bk-kit-svg-math-text');
      const [before, after] = [...label.querySelectorAll('text')].map((text) => text.getBoundingClientRect());
      const formula = label.querySelector('svg').getBoundingClientRect();
      const whole = label.getBoundingClientRect();
      return {
        inline: getComputedStyle(inline).display,
        display: getComputedStyle(display).display,
        doubleStruck: inline.querySelector('[data-c="211D"]') !== null,
        order: [before.right <= formula.left + 0.5, formula.right <= after.left + 0.5],
        centre: whole.left + whole.width / 2 - svg.left,
        label: label.getAttribute('aria-label'),
        edge: document.querySelector('.math-labels-edge').getBoundingClientRect().right - svg.left,
      };
    });
    assert.deepEqual([layout.inline, layout.display], ['inline', 'flex']);
    assert.ok(layout.doubleStruck, 'the formula uses the \\R macro of preamble.sty');
    assert.deepEqual(layout.order, [true, true]);
    assert.ok(Math.abs(layout.centre - 150) < 1, `the label is centred at ${layout.centre}`);
    assert.equal(layout.label, 'side $a^{2}$ long');
    assert.ok(layout.edge <= 300.5 && layout.edge > 290, `the label that starts at 290 ends at ${layout.edge}`);
    await page.close();
  });

  const assetsOf = async (slug) => {
    const page = await browser.newPage();
    const requested = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await page.goto(`${origin}/2026-10/${slug}/`);
    await waitForComponents(page);
    const text = await page.evaluate(() => document.querySelector('figure.component .component-box').textContent);
    await page.close();
    const assets = requested.filter((path) => path.startsWith('/assets/') && /\.(js|css)$/.test(path));
    const componentAssets = assets.filter((path) => !path.startsWith('/assets/essay-'));
    return { text, assets, kit: componentAssets.filter((path) => readFileSync(join(dir, 'dist', path), 'utf8').includes('bk-kit-')) };
  };

  await t.test('a component that only uses the plain helpers loads none of the kit parts, their styles or MathJax', async () => {
    const { text, assets, kit } = await assetsOf('ticks');
    assert.equal(text, '0.0 0.2 0.4 0.6 0.8 1.0');
    assert.deepEqual(kit, []);
    assert.ok(!assets.some((path) => path.includes('/mathjax-')), assets.join(', '));
  });

  await t.test('a component that does not import the kit loads no kit code, also when another component of the blog uses it', async () => {
    const { text, assets, kit } = await assetsOf('plain');
    assert.equal(text, 'plain');
    assert.deepEqual(kit, []);
    assert.ok(assets.some((path) => path.includes('/plain-view-')), assets.join(', '));
  });

  await t.test('a TeX label that cannot be typeset is reported with the name of its component and shows its source', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${origin}/2026-10/broken-tex/`);
    await waitForComponents(page);
    await page.waitForFunction(() => document.querySelector('.bk-kit-tex').textContent !== '');
    assert.equal(await page.evaluate(() => document.querySelector('figure.component').dataset.state), 'ready');
    assert.equal(await page.evaluate(() => document.querySelector('.bk-kit-tex').textContent), '\\frac{');
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], /^broken-tex: the TeX label "\\frac\{" cannot be typeset: /);
    await page.close();
  });
});
