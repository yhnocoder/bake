import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const settled = (name) => page.waitForFunction((selector) => document.querySelector('#bake-dev').shadowRoot.querySelector(selector).getAnimations().length === 0, `.${name}`);
  const dot = page.locator('#bake-dev .dot');
  const panel = page.locator('#bake-dev .problems');

  await t.test('saving the Markdown replaces the changed block in place and keeps the scroll position and open folds', async () => {
    await page.click('details.fold > summary');
    await page.waitForFunction(() => document.querySelector('details.fold').open && getComputedStyle(document.querySelector('details.fold'), '::details-content').opacity === '1');
    await page.evaluate(() => scrollTo(0, document.getElementById('editing').getBoundingClientRect().top + scrollY - 200));
    const before = await scrollPosition();
    await page.evaluate(() => {
      window.highlighted = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (options?.id === 'bake-changed') window.highlighted.push(this.dataset.line);
        return animate.call(this, keyframes, options);
      };
    });
    edit('The edited paragraph says hello.', 'The edited paragraph says goodbye.');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('says goodbye'));
    const block = page.locator('.bk-block', { hasText: 'says goodbye' });
    const covered = await block.evaluate((element) => {
      const mark = document.querySelector('#bake-dev').shadowRoot.querySelector(`.mark[data-line="${element.dataset.line}"]`);
      if (mark === null || !mark.getAnimations().some((animation) => animation.id === 'bake-changed')) return null;
      const box = element.getBoundingClientRect();
      const cover = mark.getBoundingClientRect();
      return cover.left <= box.left && cover.right >= box.right && cover.top <= box.top && cover.bottom >= box.bottom;
    });
    assert.equal(covered, true, 'the changed block is not covered by a highlight');
    assert.deepEqual(await page.evaluate(() => window.highlighted), [await block.getAttribute('data-line')]);
    await page.waitForTimeout(100);
    assert.equal(await scrollPosition(), before);
    assert.equal(await page.evaluate(() => document.querySelector('details.fold').open), true);
    assert.equal(await page.locator('#bake-dev .notice').isVisible(), false);
  });

  await t.test('a save that adds lines highlights only the added block and updates the source of the page', async () => {
    await page.evaluate(() => {
      window.highlighted = [];
    });
    edit('Paragraph 1 about folds.', 'An added paragraph.\n\nParagraph 1 about folds.');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('An added paragraph.'));
    assert.deepEqual(await page.evaluate(() => window.highlighted), [await page.locator('.bk-block', { hasText: 'An added paragraph.' }).getAttribute('data-line')]);
    assert.equal(await page.evaluate(() => JSON.parse(document.querySelector('script.bk-source').textContent)), readFileSync(file, 'utf8'));
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
    await page.waitForFunction(() => {
      const fold = document.querySelector('details.fold');
      return fold.open && Number(getComputedStyle(fold, '::details-content').opacity) < 1;
    });
    await page.waitForFunction(() => !document.querySelector('details.fold').open);
    await page.click('details.fold > summary');
    await page.waitForFunction(() => document.querySelector('details.fold').open && getComputedStyle(document.querySelector('details.fold'), '::details-content').opacity === '1');
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
    assert.equal(await panel.locator('.title').textContent(), '1 problem');
    assert.equal(await panel.locator('.file-name').textContent(), ARTICLE);
    const where = await problem.locator('.where').textContent();
    assert.match(where, new RegExp(`^${line}:\\d+$`));
    assert.match(await problem.locator('.message').textContent(), /^\S/);
    assert.ok(await page.locator('.bk-block', { hasText: 'says goodbye' }).isVisible());
    await problem.click();
    await page.waitForFunction(() => document.querySelector('#bake-dev').shadowRoot.querySelector('.problem[data-copied]') !== null);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${ARTICLE}:${where}`);
    await panel.locator('.copy-all').click();
    await page.waitForFunction(() => document.querySelector('#bake-dev').shadowRoot.querySelector('.copy-all[data-copied]') !== null);
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), new RegExp(`^${ARTICLE.replaceAll('.', '\\.')}:${where} \\S`));
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
    await settled('problems');
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
    assert.deepEqual(await transitions(), Array(3).fill('opacity, display'));
    await page.emulateMedia({ reducedMotion: null });
  });

  await t.test('a change outside the screen shows a notice that names its section and scrolls there when clicked', async () => {
    const before = await scrollPosition();
    edit('The far paragraph is at the end.', 'The far paragraph changed at the end.');
    const notice = page.locator('#bake-dev .notice', { hasText: 'Far away' });
    await notice.waitFor();
    assert.equal(await notice.textContent(), 'Changed below in 03 Far away');
    assert.equal(await scrollPosition(), before);
    await settled('notice');
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

const labelView = `export const params = { text: { label: 'Text', type: 'text', default: 'none' } };
export const layout = { height: 80 };

export default class LabelView extends HTMLElement {
  connectedCallback() {
    this.textContent = this.params.text;
  }
}
`;

const tocBody = [
  filler('the introduction', 2),
  '',
  '## First {#first}',
  '',
  filler('the first chapter'),
  '',
  '## Second {#second}',
  '',
  filler('the second chapter'),
  '',
  ':::label-view{text=start}',
  ':::',
  '',
  '### Inside {#inside}',
  '',
  filler('the subsection'),
  '',
  '## Third {#third}',
  '',
  filler('the third chapter', 8),
  '',
].join('\n');

const TOC_VIEWS = [
  { style: 'notes', width: 1440, parts: ['.bk-toc-marker', '.bk-toc-chapter[data-state="current"]'], titles: '.bk-toc-chapters' },
  { style: 'notes', width: 1024, parts: ['.bk-ticks', '.bk-toc-panel', '.bk-toc-panel .bk-toc-marker', '.bk-tick.is-current'], titles: '.bk-toc-panel .bk-toc-chapters' },
  { style: 'tabs', width: 1440, parts: ['.bk-tabs', '.bk-tab.is-current'], titles: '.bk-tabs' },
  { style: 'dots', width: 1024, parts: ['.bk-dots', '.bk-dot-item.is-current'], titles: '.bk-dots' },
  { style: 'ticks', width: 1440, parts: ['.bk-ticks', '.bk-popover.is-ticks', '.bk-tick.is-current'], titles: null },
  { style: 'dots', width: 375, parts: ['.bk-toc-handle', '.bk-drawer', '.bk-drawer-scrim', '.bk-drawer-dot.is-current'], titles: '.bk-drawer-index' },
  { style: 'tabs', width: 375, parts: ['.bk-toc-handle', '.bk-drawer', '.bk-drawer-scrim', '.bk-drawer-tab.is-current'], titles: '.bk-drawer-index' },
];

test('bake dev rebuilds every table of contents style from the saved headings and restarts the components', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': validConfig, 'components/label-view.js': labelView, [ARTICLE]: article({ title: 'Live', slug: 'live', body: tocBody }) });
  const file = join(dir, ARTICLE);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = `${server.url}2026-10/live/`;
  const snapshot = (view) =>
    page.evaluate(({ parts, titles }) => {
      const ui = document.querySelector('.bk-toc-ui');
      return {
        parts: parts.map((selector) => document.querySelectorAll(selector).length),
        children: ui.children.length,
        entries: document.querySelectorAll('.bk-toc [data-target]').length,
        ticks: document.querySelectorAll('.bk-tick').length,
        titles: titles === null ? null : [...document.querySelectorAll(titles)].flatMap((element) => [element.textContent, ...[...element.querySelectorAll('[aria-label]')].map((labelled) => labelled.getAttribute('aria-label'))]).join(' '),
      };
    }, view);

  for (const [round, view] of TOC_VIEWS.entries()) {
    await t.test(`the ${view.style} style at ${view.width} pixels shows the renamed and the added heading once next to a restarted component`, async () => {
      await page.setViewportSize({ width: view.width, height: view.width < 1000 ? 360 : 800 });
      await page.goto(url);
      await page.evaluate((style) => {
        localStorage.setItem('bk-toc', style);
        localStorage.setItem('bk-buttons', 'always');
      }, view.style);
      await page.reload();
      await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
      await page.evaluate(() => scrollTo(0, document.getElementById('inside').getBoundingClientRect().top + scrollY - 100));
      await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 1, view.parts.at(-1));
      const before = await snapshot(view);
      const drawer = () =>
        page.evaluate(() => ({
          open: document.querySelector('.bk-drawer').classList.contains('is-open'),
          selected: [...document.querySelectorAll('.bk-drawer-index button')].findIndex((button) => button.classList.contains('is-selected')),
          title: document.querySelector('.bk-drawer-detail .bk-toc-card-title').textContent,
          scroll: document.querySelector('.bk-drawer-detail').scrollTop,
        }));
      let drawerBefore = null;
      if (view.width < 1000) {
        await page.click('.bk-toc-handle');
        await page.waitForFunction(() => document.querySelector('.bk-drawer').getBoundingClientRect().left === 0);
        await page.locator('.bk-drawer-index button').nth(1).click();
        await page.evaluate(() => {
          document.querySelector('.bk-drawer-detail').scrollTop = 30;
        });
        drawerBefore = await drawer();
        assert.ok(drawerBefore.scroll > 0, `the drawer of the ${view.style} style does not scroll`);
      }
      const name = `Renamed ${round}`;
      writeFileSync(file, readFileSync(file, 'utf8').replace(/## \S.* \{#second\}/, `## ${name} {#second}`).replace('### Inside {#inside}', `### Added ${round} {#added-${round}}\n\nText.\n\n### Inside {#inside}`).replace(/text=\w+\}/, `text=round${round}}`));
      await page.waitForFunction((text) => document.querySelector('.bk-toc .bk-toc-chapters').textContent.includes(text), name);

      await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 1, view.parts.at(-1));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction((text) => document.querySelector('label-view')?.textContent === text && document.querySelector('figure.component').dataset.state === 'ready', `round${round}`);
      assert.equal(await page.locator('label-view').count(), 1);
      if (drawerBefore !== null) assert.deepEqual(await drawer(), { ...drawerBefore, title: name }, `the drawer of the ${view.style} style after the save`);
      const after = await snapshot(view);
      assert.deepEqual(after.parts, view.parts.map(() => 1), `parts of the ${view.style} style after the save`);
      assert.deepEqual(before.parts, after.parts);
      assert.equal(after.children, before.children);
      assert.equal(after.entries, before.entries + 1);
      if (before.ticks > 0) assert.equal(after.ticks, before.ticks + 1);
      if (view.titles !== null) {
        const old = round === 0 ? 'Second' : `Renamed ${round - 1}`;
        assert.ok(before.titles.includes(old), `the ${view.style} style showed ${old} before the save`);
        assert.ok(after.titles.includes(name) && !after.titles.includes(old), `the ${view.style} style shows ${name} after the save`);
      }
    });
  }
});

test('the bake dev dot and problems list leave the chat button and the settings button uncovered', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': validConfig, [ARTICLE]: article({ title: 'Live', slug: 'live', body }) });
  const file = join(dir, ARTICLE);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
    });
    writeFileSync(file, article({ title: 'Live', slug: 'live', body }));
    await page.goto(`${server.url}2026-10/live/`, { waitUntil: 'load' });
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]')?.shadowRoot.querySelector('.bk-chat-launcher') != null);
    const boxes = (selector) =>
      page.evaluate((selector) => {
        const box = (element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return { left, right, top, bottom };
        };
        const shadow = document.querySelector('#bake-dev').shadowRoot;
        return {
          own: box(shadow.querySelector(selector)),
          others: [document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher'), ...document.querySelectorAll('.bk-settings-toggle, .bk-toc-handle')].map(box),
        };
      }, selector);
    const settle = (selector) => page.waitForFunction((selector) => document.querySelector('#bake-dev').shadowRoot.querySelector(selector).getAnimations().length === 0, selector);
    const check = async (selector, state) => {
      await settle(selector);
      const { own, others } = await boxes(selector);
      assert.ok(others.length >= 2, `the chat button and the settings button are on the page at ${width} pixels`);
      for (const other of others) assert.ok(!overlaps(own, other), `the ${state} at ${width} pixels covers ${JSON.stringify(other)} with ${JSON.stringify(own)}`);
    };
    await check('.dot', 'quiet dot');
    writeFileSync(file, article({ title: 'Live', slug: 'live', body: body.replace('says hello.', 'says hello[^missing].') }));
    await page.locator('#bake-dev .problems').waitFor();
    await check('.problems', 'problems list');
    await page.click('#bake-dev .close');
    await page.locator('#bake-dev .dot').waitFor();
    await check('.dot', 'dot with the problem count');
    await context.close();
  }
});
