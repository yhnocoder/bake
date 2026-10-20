import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const PLOT = 'figure.component[data-component="act-fn-plot"]';

const kitBlog = {
  'bake.config.js': validConfig,
  'preamble.sty': '\\ProvidesPackage{preamble}\n\n\\newcommand{\\R}{\\mathbb{R}}\n',
  'components/kit-demo.jsx': `import { createSignal } from 'solid-js';
import { Axes, Button, Controls, Crosshair, Curve, Plot, SvgTex } from 'bake/kit';

export const layout = { height: 300 };

export default function KitDemo() {
  const [slope, setSlope] = createSignal(1);
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
      <Controls>
        <Button onClick={() => setSlope(slope() + 1)}>Steeper</Button>
        <span class="kit-demo-slope">{slope()}</span>
      </Controls>
      <div class="kit-demo-area" style={{ flex: '1 1 0', 'min-height': '0' }}>
        <Plot x={[-2, 2]} y={[-4, 4]} label="Line">
          <Axes />
          <Curve f={(x) => slope() * x} color="var(--series-1)" label="line" />
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
    legend: [...frame.querySelectorAll('.bk-kit-legend-item')].map((item) => item.textContent.trim() || item.querySelector('svg')?.getAttribute('aria-label') || 'formula'),
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

async function settled() {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})));
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
  const dir = mkdtempSync(join(tmpdir(), 'bake-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

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
    await page.evaluate(settled);
    return { page, problems };
  };

  await t.test('each plot draws its curves, axes and legend in two panels', async () => {
    const { page, problems } = await open();
    const [gelu, silu, relu] = await Promise.all([0, 1, 2].map((index) => page.evaluate(plotState, index)));
    assert.deepEqual([gelu.legend.length, silu.legend.length, relu.legend.length], [3, 1, 1]);
    assert.ok(gelu.legend.includes('tanh 近似'), gelu.legend.join(', '));
    for (const plot of [gelu, silu, relu]) {
      assert.equal(plot.panels.length, 2);
      for (const panel of plot.panels) {
        assert.ok(panel.curves.length > 0 && panel.curves.every((path) => path.startsWith('M')));
        assert.equal(panel.axes, 2);
        assert.ok(panel.grid > 4 && panel.ticks.length > 4, panel.ticks.join(' '));
      }
    }
    assert.deepEqual(gelu.panels.map((panel) => panel.curves.length), [3, 3]);
    assert.ok(silu.panels[0].ticks.includes('−6') && silu.panels[0].ticks.includes('6'), silu.panels[0].ticks.join(' '));
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
    await page.mouse.move(svg.x + svg.width * 0.3, svg.y + svg.height / 2);
    await page.evaluate(settled);
    const left = await readout();
    await page.mouse.move(svg.x + svg.width * 0.7, svg.y + svg.height / 2);
    await page.evaluate(settled);
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
    await page.evaluate(settled);
    const gone = await readout();
    assert.equal(gone.visible, '0');
    assert.ok(Number.isNaN(gone.crosshair));
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the segmented control, the sliders and the toggle change the plot', async () => {
    const { page, problems } = await open({ reducedMotion: 'reduce' });
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    const before = await page.evaluate(plotState, 0);

    await frame.locator('.bk-kit-toggle').click();
    const exact = await page.evaluate(plotState, 0);
    assert.deepEqual(exact.panels.map((panel) => panel.curves.length), [1, 1]);
    assert.equal(exact.legend.length, 1);
    assert.equal(await frame.locator('.bk-kit-toggle input').isChecked(), false);

    await frame.locator('.bk-kit-segment', { hasText: 'SiLU' }).click();
    assert.equal(await frame.locator('.bk-kit-toggle').count(), 0);
    const silu = await page.evaluate(plotState, 0);
    assert.notEqual(silu.panels[0].curves[0], before.panels[0].curves[0]);
    await page.evaluate(setSlider, { index: 0, label: 'β', value: 3 });
    const steep = await page.evaluate(plotState, 0);
    assert.notEqual(steep.panels[0].curves[0], silu.panels[0].curves[0]);
    assert.equal(await frame.locator('.bk-kit-value').last().textContent(), '3.0');

    await page.evaluate(setSlider, { index: 0, label: '横轴范围', value: 8 });
    const wide = await page.evaluate(plotState, 0);
    assert.ok(wide.panels[0].ticks.includes('8') && wide.panels[0].ticks.includes('−8'), wide.panels[0].ticks.join(' '));

    await frame.locator('.bk-kit-segment input[value="relu"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await frame.locator('.bk-kit-segment input:checked').getAttribute('value'), 'gelu');
    assert.equal(await frame.locator('.bk-kit-toggle').count(), 1);
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('every plot stays inside its box with each function at 1440 and 375 pixels', async () => {
    for (const width of [1440, 375]) {
      const { page, problems } = await open({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      for (const fn of ['ReLU', 'GELU', 'SiLU']) {
        for (const index of [0, 1, 2]) await page.locator(PLOT).nth(index).locator('.bk-kit-segment', { hasText: fn }).click();
        await page.evaluate(nextFrames);
        assert.deepEqual(await page.evaluate(overflow), [], `${width}px ${fn}`);
      }
      assert.deepEqual(problems, [], `${width}px`);
      await page.close();
    }
  });

  await t.test('with reduced motion no transition and no tween runs', async () => {
    const changes = async (reducedMotion) => {
      const { page, problems } = await open({ reducedMotion });
      const frame = page.locator(PLOT).first();
      await frame.scrollIntoViewIfNeeded();
      const state = await page.evaluate(async () => {
        const frame = document.querySelector('figure.component[data-component="act-fn-plot"]');
        const running = () => document.getAnimations().filter((animation) => frame.contains(animation.effect?.target)).length;
        frame.querySelector('.bk-kit-toggle input').click();
        await new Promise((done) => requestAnimationFrame(done));
        const transitions = running();
        const path = () => frame.querySelector('path.bk-kit-curve').getAttribute('d');
        const slider = [...frame.querySelectorAll('.bk-kit-slider input')][0];
        slider.value = '9';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const early = path();
        const started = performance.now();
        while (path() === early && performance.now() - started < 1000) await new Promise((done) => requestAnimationFrame(done));
        return { transitions, tweening: early !== path() };
      });
      assert.deepEqual(problems, []);
      await page.close();
      return state;
    };
    assert.deepEqual(await changes('reduce'), { transitions: 0, tweening: false });
    const moving = await changes('no-preference');
    assert.ok(moving.transitions > 0 && moving.tweening, JSON.stringify(moving));
  });

  await t.test('the controls and the TeX labels have accessible names, and the segments are at least 24 pixels tall', async () => {
    const { page, problems } = await open();
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    assert.equal(await frame.getByRole('slider', { name: '横轴范围', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('slider', { name: '横轴范围', exact: true }).getAttribute('aria-valuetext'), '±4.0');
    assert.equal(await frame.getByRole('radio', { name: 'SiLU', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('switch', { name: '近似', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('img', { name: 'GELU', exact: true }).count(), 1);
    assert.equal(await frame.getByRole('img', { name: '\\mathrm{GELU}(x)', exact: true }).count(), 0);
    assert.equal(await frame.getByRole('img', { name: "f'(x)", exact: true }).count(), 1);
    const heights = await frame.locator('.bk-kit-segment').evaluateAll((segments) => segments.map((segment) => segment.getBoundingClientRect().height));
    assert.ok(heights.every((height) => height >= 24), heights.join(', '));
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the chosen segment fades in a layer and animates no shadow or background', async () => {
    const { page, problems } = await open();
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    const styles = await page.evaluate(() => {
      const segments = [...document.querySelector('figure.component[data-component="act-fn-plot"]').querySelectorAll('.bk-kit-segment span')];
      const chosen = segments.find((span) => span.previousElementSibling.checked);
      const other = segments.find((span) => !span.previousElementSibling.checked);
      return {
        span: getComputedStyle(chosen).transitionDuration,
        layer: getComputedStyle(chosen, '::before').transitionProperty,
        opacity: [getComputedStyle(chosen, '::before').opacity, getComputedStyle(other, '::before').opacity],
      };
    });
    assert.deepEqual(styles, { span: '0s', layer: 'opacity', opacity: ['1', '0'] });
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('controls show the pointer cursor and a focus outline', async () => {
    const { page, problems } = await open();
    const frame = page.locator(PLOT).first();
    await frame.scrollIntoViewIfNeeded();
    const cursors = await page.evaluate(() => {
      const frame = document.querySelector('figure.component[data-component="act-fn-plot"]');
      return ['.bk-kit-segment', '.bk-kit-segment input', '.bk-kit-slider', '.bk-kit-slider input', '.bk-kit-toggle', '.bk-kit-toggle input'].map((selector) => getComputedStyle(frame.querySelector(selector)).cursor);
    });
    assert.deepEqual(new Set(cursors), new Set(['pointer']));
    await frame.locator('.bk-kit-segment input').first().focus();
    await page.keyboard.press('ArrowRight');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement.nextElementSibling).outlineStyle);
    assert.equal(outline, 'solid');
    for (const control of ['.bk-kit-slider input', '.bk-kit-toggle input']) {
      await frame.locator(control).first().focus();
      await page.keyboard.press('Shift');
      const style = await frame.locator(control).first().evaluate((input) => getComputedStyle(input.type === 'checkbox' ? input.nextElementSibling : input).outlineStyle);
      assert.equal(style, 'solid', control);
    }
    assert.deepEqual(problems, []);
    await page.close();
  });

  await t.test('the plot follows the color scheme, and its screenshots differ between light and dark', async () => {
    const screenshotDir = process.env.BAKE_KIT_SCREENSHOTS ?? join(dir, 'kit-screenshots');
    mkdirSync(screenshotDir, { recursive: true });
    const shots = {};
    const strokes = {};
    for (const colorScheme of ['light', 'dark']) {
      for (const width of [1440, 375]) {
        const { page, problems } = await open({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce' });
        const frame = page.locator(PLOT).first();
        await frame.scrollIntoViewIfNeeded();
        const svg = await frame.locator('.bk-kit-plot-svg').first().boundingBox();
        await page.mouse.move(svg.x + svg.width * 0.6, svg.y + svg.height / 2);
        await page.evaluate(settled);
        const image = await frame.screenshot();
        const file = join(screenshotDir, `act-fn-plot-${width}-${colorScheme}.png`);
        writeFileSync(file, image);
        if (width === 1440) {
          shots[colorScheme] = PNG.sync.read(image);
          strokes[colorScheme] = await page.evaluate(() => {
            const frame = document.querySelector('figure.component[data-component="act-fn-plot"]');
            return [frame.querySelector('path.bk-kit-curve'), frame.querySelector('.bk-kit-grid'), frame.querySelector('.bk-kit-readout')].map((element) => {
              const style = getComputedStyle(element);
              return element.tagName === 'DIV' ? style.backgroundColor : style.stroke;
            });
          });
        }
        assert.deepEqual(problems, [], `${width}px ${colorScheme}`);
        await page.close();
      }
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
  const browser = await chromium.launch();
  t.after(() => browser.close());

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

  const assetsOf = async (slug) => {
    const page = await browser.newPage();
    const requested = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await page.goto(`${origin}/2026-10/${slug}/`);
    await waitForComponents(page);
    const text = await page.evaluate(() => document.querySelector('figure.component .component-box').textContent);
    await page.close();
    const assets = requested.filter((path) => path.startsWith('/assets/') && /\.(js|css)$/.test(path));
    return { text, assets, kit: assets.filter((path) => readFileSync(join(dir, 'dist', path), 'utf8').includes('bk-kit-')) };
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
