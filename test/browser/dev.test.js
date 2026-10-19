import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
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
});
