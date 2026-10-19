import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startDevServer } from '../../src/dev/server.js';
import { article, createBlog, validConfig } from '../blog.js';

const filler = (topic, count = 4) => Array.from({ length: count }, (_, index) => `Paragraph ${index + 1} about ${topic}. ${'It fills the page so that the reader has to scroll. '.repeat(6)}`).join('\n\n');

const body = [
  filler('the introduction'),
  '',
  '## Folds {#folds}',
  '',
  ':::fold{title="Derivation"}',
  'The derivation inside the fold.',
  ':::',
  '',
  filler('folds'),
  '',
  '## Editing {#editing}',
  '',
  'The edited paragraph says hello.[^note]',
  '',
  '[^note]: The note next to the edited paragraph.',
  '',
  '```text',
  'A code block that the page script gives a width.',
  '```',
  '',
  filler('editing'),
  '',
  '## Far away {#far}',
  '',
  filler('the distance', 12),
  '',
  'The far paragraph is at the end.',
  '',
].join('\n');

const ARTICLE = 'content/posts/live/index.md';
const SYNTAX = 'content/posts/syntax/index.md';
const exampleBlog = join(import.meta.dirname, '../../examples/blog');

function lineOf(source, text) {
  return source.slice(0, source.indexOf(text)).split('\n').length;
}

test('bake dev updates the page in place, lists problems and opens blocks in VS Code', async (t) => {
  const source = article({ title: 'Live', slug: 'live', body });
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    [ARTICLE]: source,
    'content/posts/sketch/index.md': article({ title: 'Sketch', slug: 'sketch', extra: 'draft: true\n' }),
  });
  const file = join(dir, ARTICLE);
  const edit = (from, to) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    window.open = (url, target) => {
      window.openedUrls = [...(window.openedUrls ?? []), [url, target]];
      return null;
    };
  });
  const page = await context.newPage();
  const url = `${server.url}2026-10/live/`;
  await page.goto(url);
  await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
  const scrollPosition = () => page.evaluate(() => scrollY);
  await page.evaluate(() => {
    window.devTransitions = [];
    document.querySelector('#bake-dev').shadowRoot.addEventListener('transitionrun', (event) => {
      window.devTransitions.push(`${event.target.className} ${event.propertyName}`);
    });
  });
  const clearTransitions = () =>
    page.evaluate(() => {
      window.devTransitions = [];
    });
  const fades = (name) => page.waitForFunction((expected) => window.devTransitions.includes(expected), `${name} opacity`);
  const dot = page.locator('#bake-dev .dot');
  const panel = page.locator('#bake-dev .problems');

  await t.test('saving the Markdown replaces the changed block in place and keeps the scroll position and open folds', async () => {
    await page.click('details.fold > summary');
    await page.waitForFunction(() => document.querySelector('details.fold').open && document.querySelector('details.fold').getAnimations().length === 0);
    await page.evaluate(() => scrollTo(0, document.getElementById('editing').getBoundingClientRect().top + scrollY - 200));
    const before = await scrollPosition();
    await page.evaluate(() => {
      window.highlighted = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (options?.id === 'bake-changed') window.highlighted.push(this.textContent);
        return animate.call(this, keyframes, options);
      };
    });
    edit('The edited paragraph says hello.', 'The edited paragraph says goodbye.');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('says goodbye'));
    const block = page.locator('.bk-block', { hasText: 'says goodbye' });
    assert.ok(await block.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'bake-changed')), 'the changed block is not highlighted');
    assert.deepEqual(await page.evaluate(() => window.highlighted), ['The edited paragraph says goodbye.1']);
    await page.waitForTimeout(100);
    assert.equal(await scrollPosition(), before);
    assert.equal(await page.evaluate(() => document.querySelector('details.fold').open), true);
    assert.equal(await page.locator('#bake-dev .notice').isVisible(), false);
  });

  await t.test('the page scripts work on the replaced article', async () => {
    await page.evaluate(() => scrollBy(0, 10));
    await page.waitForFunction(() => document.querySelector('.bk-toc [data-target="editing"]').dataset.state === 'current');
    const state = await page.evaluate(() => ({
      notes: [...document.querySelectorAll('.bk-notes-layer .bk-sidenote')].map((note) => [note.textContent, note.style.top !== '']),
      unresolved: [...document.querySelectorAll('.bk-block[data-width]')].filter((block) => block.dataset.resolved === undefined).length,
    }));
    assert.deepEqual(state, { notes: [['1The note next to the edited paragraph.', true]], unresolved: 0 });
    await page.click('details.fold > summary');
    assert.ok(await page.evaluate(() => document.querySelector('details.fold').getAnimations().length > 0), 'closing the replaced fold does not animate');
    await page.waitForFunction(() => !document.querySelector('details.fold').open);
    await page.click('details.fold > summary');
    await page.waitForFunction(() => document.querySelector('details.fold').open && document.querySelector('details.fold').getAnimations().length === 0);
    edit('gives a width.\n```\n', 'gives a width.\n```\n\nSee [the far section](/2026-10/live/#far).\n');
    const link = page.locator('.bk-article a.internal-link', { hasText: 'the far section' });
    await link.waitFor();
    await link.hover();
    const card = page.locator('.bk-preview.is-on');
    await card.waitFor();
    assert.match(await card.textContent(), /Far away/);
    await page.mouse.move(0, 0);
    await card.waitFor({ state: 'hidden' });
  });

  await t.test('a change above the screen keeps the visible text in place and names the introduction', async () => {
    await page.evaluate(() => scrollTo(0, document.getElementById('editing').getBoundingClientRect().top + scrollY - 200));
    const top = () => page.evaluate(() => document.getElementById('editing').getBoundingClientRect().top);
    const before = await top();
    await clearTransitions();
    edit('Paragraph 1 about the introduction.', `Paragraph 1 about the introduction. ${'It grows. '.repeat(200)}`);
    const notice = page.locator('#bake-dev .notice', { hasText: 'introduction' });
    await notice.waitFor();
    await fades('notice');
    assert.equal(await notice.textContent(), 'Changed above in the introduction');
    await page.waitForTimeout(100);
    const after = await top();
    assert.ok(Math.abs(after - before) <= 1, `the heading moved from ${before}px to ${after}px`);
  });

  await t.test('an error opens the problems list and keeps the last good page, and fixing it leaves a dot', async () => {
    assert.equal(await dot.isVisible(), true);
    assert.equal(await dot.getAttribute('data-state'), 'clear');
    assert.equal(await panel.isVisible(), false);
    await clearTransitions();
    edit('The edited paragraph says goodbye.', 'The edited paragraph says goodbye[^missing].');
    const problem = page.locator('#bake-dev .problem');
    await problem.waitFor();
    await fades('problems');
    await fades('dot');
    await dot.waitFor({ state: 'hidden' });
    const line = lineOf(readFileSync(file, 'utf8'), 'The edited paragraph');
    const text = await problem.textContent();
    assert.match(text, new RegExp(`^${ARTICLE.replaceAll('.', '\\.')}:${line}:\\d+ \\S`));
    assert.ok(await page.locator('.bk-block', { hasText: 'says goodbye' }).isVisible());
    await problem.click();
    await page.waitForFunction(() => document.querySelector('#bake-dev').shadowRoot.querySelector('.problem[data-copied]') !== null);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text.split(' ')[0]);
    await clearTransitions();
    edit('[^missing]', ' again');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('says goodbye again'));
    await fades('problems');
    await fades('dot');
    await panel.waitFor({ state: 'hidden' });
    await dot.waitFor();
    assert.equal(await dot.getAttribute('data-state'), 'clear');
  });

  await t.test('closing the problems list leaves a dot with the count that opens it again', async () => {
    edit('says goodbye again.', 'says goodbye again[^missing].');
    await panel.waitFor();
    await clearTransitions();
    await page.click('#bake-dev .close');
    await fades('problems');
    await panel.waitFor({ state: 'hidden' });
    await dot.waitFor();
    assert.deepEqual([await dot.getAttribute('data-state'), await dot.textContent()], ['problems', '1']);
    await dot.click();
    await panel.waitFor();
    await dot.waitFor({ state: 'hidden' });
    await page.click('#bake-dev .close');
    await panel.waitFor({ state: 'hidden' });
    edit('[^missing]', '');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('says goodbye again.'));
    await page.waitForFunction(() => document.querySelector('#bake-dev').shadowRoot.querySelector('.dot').dataset.state === 'clear');
    assert.equal(await panel.isVisible(), false);
    await dot.click();
    await panel.waitFor();
    assert.equal(await panel.locator('.title').textContent(), 'No problems');
    await page.click('#bake-dev .close');
    await panel.waitFor({ state: 'hidden' });
    await dot.waitFor();
  });

  await t.test('the problems list and the dot only fade when the reader prefers reduced motion', async () => {
    const transitions = () => page.evaluate(() => [...document.querySelector('#bake-dev').shadowRoot.querySelectorAll('.problems, .dot, .notice')].map((element) => getComputedStyle(element).transitionProperty));
    assert.ok((await transitions()).every((property) => property.includes('translate')));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await transitions(), Array(3).fill('opacity, background-color, color, display'));
    await page.emulateMedia({ reducedMotion: null });
  });

  await t.test('a change outside the screen shows a notice that names its section and scrolls there when clicked', async () => {
    const before = await scrollPosition();
    edit('The far paragraph is at the end.', 'The far paragraph changed at the end.');
    const notice = page.locator('#bake-dev .notice', { hasText: 'Far away' });
    await notice.waitFor();
    assert.equal(await notice.textContent(), 'Changed below in 03 Far away');
    assert.equal(await scrollPosition(), before);
    await clearTransitions();
    await notice.click();
    await fades('notice');
    await page.waitForFunction(() => {
      const box = [...document.querySelectorAll('.bk-block')].find((block) => block.textContent.includes('changed at the end')).getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    });
    await notice.waitFor({ state: 'hidden' });
  });

  await t.test('double-clicking a block opens its line in VS Code', async () => {
    await page.locator('.bk-block', { hasText: 'changed at the end' }).dblclick();
    const line = lineOf(readFileSync(file, 'utf8'), 'The far paragraph');
    assert.deepEqual(await page.evaluate(() => window.openedUrls.at(-1)), [`vscode://file${pathToFileURL(file).pathname}:${line}:1`, '_self']);
  });

  await t.test('changing the front matter reloads the page at the same scroll position', async () => {
    await page.evaluate(() => scrollTo(0, document.getElementById('editing').getBoundingClientRect().top + scrollY - 200));
    const before = await scrollPosition();
    await page.evaluate(() => {
      window.beforeReload = true;
    });
    edit('title: Live', 'title: Live again');
    await page.waitForFunction(() => document.querySelector('.bk-title')?.textContent === 'Live again' && window.beforeReload === undefined);
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    await page.waitForFunction((expected) => Math.abs(scrollY - expected) <= 1, before);
  });

  await t.test('a draft shows its label and the page for a missing address lists every article', async () => {
    await page.goto(`${server.url}2026-10/sketch/`);
    assert.equal(await page.locator('.bk-draft').textContent(), 'Draft');
    const response = await page.goto(`${server.url}missing/`);
    assert.equal(response.status(), 404);
    assert.deepEqual(
      await page.locator('li').evaluateAll((items) => items.map((item) => [item.querySelector('a').getAttribute('href'), item.textContent])),
      [
        ['/2026-10/live/', 'Live again2026-10-19content/posts/live/index.md'],
        ['/2026-10/sketch/', 'Sketch2026-10-19Draftcontent/posts/sketch/index.md'],
      ],
    );
  });

  await t.test('the homepage lists drafts and reloads when an article title changes or an article is added', async () => {
    const response = await page.goto(server.url);
    assert.equal(response.status(), 200);
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    const titles = () => page.evaluate(() => [...new Set([...document.querySelectorAll('.bk-card-title')].map((title) => title.textContent))].sort());
    assert.deepEqual(await titles(), ['Live again', 'Sketch']);
    assert.equal(await page.locator('.bk-card-draft').first().textContent(), 'Draft');
    edit('title: Live again', 'title: Live on the homepage');
    await page.waitForFunction(() => [...document.querySelectorAll('.bk-card-title')].some((title) => title.textContent === 'Live on the homepage'));
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    mkdirSync(join(dir, 'content/posts/added'));
    writeFileSync(join(dir, 'content/posts/added/index.md'), article({ title: 'Added', slug: 'added' }));
    await page.waitForFunction(() => [...document.querySelectorAll('.bk-card-title')].some((title) => title.textContent === 'Added'));
    assert.deepEqual(await titles(), ['Added', 'Live on the homepage', 'Sketch']);
  });
});

test('bake dev starts the components of an article that it updates in place', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'components/label-view.js': `export const params = { text: { label: 'Text', type: 'text', default: 'none' } };
export const layout = { height: 80 };

export default class LabelView extends HTMLElement {
  connectedCallback() {
    this.textContent = this.params.text;
  }
}
`,
    [ARTICLE]: article({ title: 'Live', slug: 'live', body: 'A paragraph before the component.\n\n:::label-view{text=first}\n:::\n' }),
  });
  const file = join(dir, ARTICLE);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${server.url}2026-10/live/`);
  await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('label-view')?.textContent === 'first');
  await page.evaluate(() => {
    window.keptAcrossUpdates = true;
  });
  writeFileSync(file, readFileSync(file, 'utf8').replace('text=first', 'text=second'));
  await page.waitForFunction(() => document.querySelector('label-view')?.textContent === 'second');
  assert.deepEqual(
    await page.evaluate(() => [window.keptAcrossUpdates, document.querySelector('figure.component').dataset.state]),
    [true, 'ready'],
  );
  await page.close();
});

test('bake dev shows a parameter bar on each component of the article that changes, writes, copies and resets its parameters', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-param-bar-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const file = join(dir, SYNTAX);
  const original = readFileSync(file, 'utf8');
  const directive = ':::act-fn-plot{fn=silu range=6 beta=2 width=body}';
  const line = lineOf(original, directive);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    window.open = (url, target) => {
      window.openedUrls = [...(window.openedUrls ?? []), [url, target]];
      return null;
    };
  });
  const page = await context.newPage();
  const url = `${server.url}2026-10/syntax/`;
  const frameSelector = `figure.component[data-line="${line}"]`;
  const frame = page.locator(frameSelector);
  const bar = frame.locator('bake-param-bar');
  const control = (param) => bar.locator(`.control[data-param="${param}"]`);
  const message = bar.locator('.message');
  const liveParams = () => page.evaluate((selector) => ({ ...document.querySelector(selector).querySelector('act-fn-plot').params }), frameSelector);
  const open = async () => {
    await page.goto(url);
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    await frame.scrollIntoViewIfNeeded();
    await page.waitForFunction((selector) => document.querySelector(selector).dataset.state === 'ready', frameSelector);
  };
  await open();

  await t.test('the bar shows one control per parameter above the component without changing the height of its box', async () => {
    assert.equal(await bar.locator('.name').textContent(), 'act-fn-plot');
    assert.deepEqual(
      await bar.locator('.control').evaluateAll((controls) => controls.map((item) => [item.dataset.param, item.querySelector('.label').textContent, [...item.querySelectorAll('input, select')].map((field) => field.type)])),
      [
        ['fn', '函数', ['select-one']],
        ['range', '横轴范围', ['range', 'number']],
        ['beta', 'β 初始值', ['range', 'number']],
      ],
    );
    assert.deepEqual(await bar.locator('button').allTextContents(), ['Reset', 'Copy', 'Write to file']);
    assert.equal(await frame.locator('.component-box').evaluate((box) => box.getBoundingClientRect().height), 340);
    assert.ok(await page.evaluate((selector) => document.querySelector(selector).querySelector('bake-param-bar').nextElementSibling.matches('.component-box'), frameSelector));
    assert.equal(await page.locator('figure.component bake-param-bar').count(), await page.locator('[data-region] figure.component[data-line]').count());
    assert.equal(await page.locator('.embed figure.component bake-param-bar').count(), 0);
  });

  let beta;
  await t.test('dragging a slider marks the control as changed and updates the running component', async () => {
    const slider = control('beta').locator('.slider');
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    beta = Number(await control('beta').locator('.number').inputValue());
    assert.ok(beta > 2 && beta <= 4, `beta is ${beta}`);
    assert.equal(String(beta), beta.toFixed(String(beta).includes('.') ? 1 : 0));
    assert.equal(await control('beta').getAttribute('data-changed'), '');
    assert.equal(await control('range').getAttribute('data-changed'), null);
    assert.deepEqual(await liveParams(), { fn: 'silu', range: 6, beta });
    assert.equal(await bar.locator('.write').isDisabled(), false);
  });

  const otherSelector = `figure.component[data-line="${lineOf(original, ':::act-fn-plot{fn=gelu}')}"]`;
  const otherControl = (param) => page.locator(`${otherSelector} bake-param-bar .control[data-param="${param}"]`);
  const watchFrames = () =>
    page.evaluate(() => {
      window.highlighted = [];
      window.states = [];
      window.shifts = [];
      for (const element of document.querySelectorAll('figure.component .component-box > *')) element.bakeMarker = true;
      for (const frame of document.querySelectorAll('figure.component')) {
        new MutationObserver(() => window.states.push(frame.dataset.state)).observe(frame, { attributes: true, attributeFilter: ['data-state'] });
      }
      if (window.animatePatched) return;
      window.animatePatched = true;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (options?.id === 'bake-changed') window.highlighted.push(this.className);
        return animate.call(this, keyframes, options);
      };
    });
  const unmarked = () => page.evaluate(() => [...document.querySelectorAll('figure.component[data-state="ready"] .component-box > *')].filter((element) => !element.bakeMarker).map((element) => element.localName));
  const top = () => frame.evaluate((element) => element.getBoundingClientRect().top);
  const edit = (from, to) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));

  await t.test('Write to file rewrites the line, and the update keeps every component running without a highlight', async () => {
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.state === 'ready', otherSelector);
    await otherControl('range').locator('.number').fill('7');
    await watchFrames();
    const before = await top();
    await bar.locator('.write').click();
    await message.filter({ hasText: `Wrote line ${line} of ${SYNTAX}` }).waitFor();
    assert.equal(readFileSync(file, 'utf8'), original.replace(directive, `:::act-fn-plot{fn=silu range=6 beta=${beta} width=body}`));
    await page.waitForFunction(([selector, expected]) => JSON.parse(document.querySelector(selector).dataset.params).beta === expected, [frameSelector, beta]);
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [window.highlighted, window.states]), [[], []]);
    assert.deepEqual(await unmarked(), []);
    assert.equal(await top(), before);
    assert.equal(await message.isVisible(), true);
    assert.equal(await control('beta').getAttribute('data-changed'), null);
    assert.equal(await bar.locator('.write').isDisabled(), true);
    assert.equal(Number(await control('beta').locator('.number').inputValue()), beta);
    assert.deepEqual(await liveParams(), { fn: 'silu', range: 6, beta });
    assert.deepEqual([await otherControl('range').locator('.number').inputValue(), await otherControl('range').getAttribute('data-changed')], ['7', '']);
  });

  await t.test('an unrelated save keeps the components running and the unsaved values of the bars', async () => {
    await watchFrames();
    edit('这篇文章列出 Bake 的全部写法。', '这篇文章列出 Bake 的全部写法，第一次改。');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('第一次改'));
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.states), []);
    assert.deepEqual(await unmarked(), []);
    assert.deepEqual([await otherControl('range').locator('.number').inputValue(), await otherControl('range').getAttribute('data-changed')], ['7', '']);
  });

  await t.test('a bar that a save replaces keeps its unsaved values and gives them to the restarted component', async () => {
    edit('实线是精确 GELU', '实线是精确的 GELU');
    await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('实线是精确的 GELU'), otherSelector);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('act-fn-plot')?.params.range === 7, otherSelector);
    assert.deepEqual([await otherControl('range').locator('.number').inputValue(), await otherControl('range').getAttribute('data-changed')], ['7', '']);
    await page.locator(`${otherSelector} bake-param-bar .reset`).click();
  });

  await t.test('a parameter changed in the editor restarts the component and highlights its block once', async () => {
    await watchFrames();
    edit(`fn=silu range=6 beta=${beta}`, `fn=silu range=5 beta=${beta}`);
    await page.waitForFunction((selector) => JSON.parse(document.querySelector(selector).dataset.params).range === 5, frameSelector);
    await page.waitForFunction((selector) => document.querySelector(selector).dataset.state === 'ready', frameSelector);
    assert.deepEqual(await page.evaluate(() => window.highlighted), ['bk-block']);
    assert.deepEqual(await liveParams(), { fn: 'silu', range: 5, beta });
  });

  await t.test('Reset goes back to the values in the Markdown', async () => {
    await control('fn').locator('select').selectOption('relu');
    assert.equal(await control('fn').getAttribute('data-changed'), '');
    assert.equal((await liveParams()).fn, 'relu');
    await bar.locator('.reset').click();
    assert.equal(await control('fn').locator('select').inputValue(), 'silu');
    assert.equal(await control('fn').getAttribute('data-changed'), null);
    assert.equal((await liveParams()).fn, 'silu');
    assert.equal(await bar.locator('.write').isDisabled(), true);
  });

  await t.test('Copy puts the rewritten line on the clipboard and leaves the file unchanged', async () => {
    const before = readFileSync(file, 'utf8');
    await control('range').locator('.number').fill('8');
    assert.equal(Number(await control('range').locator('.slider').inputValue()), 8);
    assert.equal((await liveParams()).range, 8);
    await bar.locator('.copy').click();
    await message.filter({ hasText: 'Copied' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `:::act-fn-plot{fn=silu range=8 beta=${beta} width=body}`);
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  await t.test('double-clicking inside a bar does not open VS Code', async () => {
    await bar.locator('.name').dblclick();
    assert.equal(await page.evaluate(() => window.openedUrls), undefined);
  });

  await t.test('the switch in the problems panel hides and shows every bar and keeps the choice', async () => {
    await page.click('#bake-dev .dot');
    const toggle = page.locator('#bake-dev .bars input');
    assert.equal(await toggle.isChecked(), true);
    await toggle.click();
    await page.waitForFunction(() => [...document.querySelectorAll('bake-param-bar')].every((item) => item.hidden && item.getBoundingClientRect().height === 0));
    assert.equal(await page.evaluate(() => localStorage.getItem('bake-dev-param-bars')), 'hidden');
    await open();
    assert.equal(await bar.isVisible(), false);
    await page.click('#bake-dev .dot');
    assert.equal(await toggle.isChecked(), false);
    await toggle.click();
    await bar.waitFor();
    await page.click('#bake-dev .close');
  });

  const refused = `${SYNTAX} changed after this page was built; save it in your editor and try again`;
  const refuseThenWrite = async (range, text, waitForRefresh) => {
    await control('range').locator('.number').fill(String(range));
    let edited = null;
    await page.route('**/__bake/params', async (route) => {
      edit('全部写法，', `全部写法，${text}，`);
      edited = readFileSync(file, 'utf8');
      const response = await route.fetch();
      if (waitForRefresh) await page.waitForFunction((expected) => document.querySelector('.bk-article').textContent.includes(expected), text);
      await route.fulfill({ response });
    });
    await bar.locator('.write').click();
    await message.filter({ hasText: refused }).waitFor();
    await page.unroute('**/__bake/params');
    await page.waitForFunction((expected) => document.querySelector('.bk-article').textContent.includes(expected), text);
    await page.waitForTimeout(300);
    assert.deepEqual([await message.isVisible(), await message.getAttribute('data-kind'), await message.textContent()], [true, 'error', refused]);
    assert.deepEqual([await control('range').locator('.number').inputValue(), await control('range').getAttribute('data-changed')], [String(range), '']);
    assert.equal((await liveParams()).range, range);
    assert.equal(readFileSync(file, 'utf8'), edited);
    await bar.locator('.write').click();
    await message.filter({ hasText: `Wrote line ${line}` }).waitFor();
    assert.match(readFileSync(file, 'utf8'), new RegExp(`\\{fn=silu range=${range} beta`));
  };

  await t.test('Write refuses when the file changed before the page updated, keeps the message and values, and a second Write succeeds', async () => {
    await refuseThenWrite(9, '第二次改', false);
  });

  await t.test('Write refuses when the page updated before the refusal arrived, and a second Write succeeds', async () => {
    await refuseThenWrite(3, '第三次改', true);
  });

  await page.close();
  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await phone.goto(url);
  await phone.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
  await phone.locator(frameSelector).scrollIntoViewIfNeeded();
  await t.test('the controls wrap inside the bar on a phone', async () => {
    const sizes = await phone.evaluate((selector) => {
      const host = document.querySelector(selector).querySelector('bake-param-bar');
      const inner = host.shadowRoot.querySelector('.bar');
      return { inner: [inner.scrollWidth, inner.clientWidth], host: host.getBoundingClientRect().right, page: [document.documentElement.scrollWidth, innerWidth] };
    }, frameSelector);
    assert.ok(sizes.inner[0] <= sizes.inner[1], JSON.stringify(sizes));
    assert.ok(sizes.host <= 375 && sizes.page[0] <= sizes.page[1], JSON.stringify(sizes));
  });
  await phone.close();
});
