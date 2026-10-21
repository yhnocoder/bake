import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { startDevServer } from '../../src/dev/server.js';
import { article, copyExample, createBlog, validConfig } from '../blog.js';
import { launchBrowser, settle, until } from './browser.js';

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
  const browser = await launchBrowser();
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
      const mark = document.querySelector('#bake-dev-marks').shadowRoot.querySelector(`.mark[data-line="${element.dataset.line}"]`);
      if (mark === null || !mark.getAnimations().some((animation) => animation.id === 'bake-changed')) return null;
      const box = element.getBoundingClientRect();
      const cover = mark.getBoundingClientRect();
      return cover.left <= box.left && cover.right >= box.right && cover.top <= box.top && cover.bottom >= box.bottom;
    });
    assert.equal(covered, true, 'the changed block is not covered by a highlight');
    assert.deepEqual(await page.evaluate(() => window.highlighted), [await block.getAttribute('data-line')]);
    await settle(page);
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
    await page.locator('.bk-copy-source').dispatchEvent('click');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), readFileSync(file, 'utf8'));
  });

  await t.test('the page scripts work on the replaced article', async () => {
    const notes = await page.evaluate(() => {
      const reference = [...document.querySelectorAll('.bk-article p')].find((paragraph) => paragraph.textContent.includes('says goodbye'));
      return [...document.querySelectorAll('.bk-sidenote')]
        .filter((note) => note.checkVisibility())
        .map((note) => ({ text: note.textContent, beside: note.getBoundingClientRect().left >= reference.getBoundingClientRect().right, offset: Math.abs(note.getBoundingClientRect().top - reference.getBoundingClientRect().top) }));
    });
    assert.deepEqual(
      notes.map(({ text, beside }) => [text, beside]),
      [['1The note next to the edited paragraph.', true]],
    );
    assert.ok(notes[0].offset < 40, `the note is ${notes[0].offset}px away from its paragraph`);
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
    await settle(page);
    const after = await top();
    assert.ok(Math.abs(after - before) <= 1, `the heading moved from ${before}px to ${after}px`);
  });

  await t.test('an error opens the problems list and keeps the last good page, and fixing it leaves a dot', async () => {
    assert.equal(await dot.isVisible(), true);
    assert.equal(await dot.getAttribute('title'), 'No problems');
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
    assert.equal(await dot.getAttribute('title'), 'No problems');
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
    assert.deepEqual([await dot.getAttribute('title'), await dot.textContent()], ['1 problem', '1']);
    await dot.click();
    await panel.waitFor();
    await dot.waitFor({ state: 'hidden' });
    await page.click('#bake-dev .close');
    await panel.waitFor({ state: 'hidden' });
    edit('[^missing]', '');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('says goodbye again.'));
    await page.waitForFunction(() => document.querySelector('#bake-dev').shadowRoot.querySelector('.dot').title === 'No problems');
    assert.equal(await panel.isVisible(), false);
    await dot.click();
    await panel.waitFor();
    assert.equal(await panel.locator('.title').textContent(), 'No problems');
    await page.click('#bake-dev .close');
    await panel.waitFor({ state: 'hidden' });
    await dot.waitFor();
  });

  await t.test('the problems list and the dot only fade when the reader prefers reduced motion', async () => {
    const transitions = () =>
      page.evaluate(() =>
        [...document.querySelector('#bake-dev').shadowRoot.querySelectorAll('.problems, .dot, .notice')].map((element) => {
          const style = getComputedStyle(element);
          const durations = style.transitionDuration.split(', ').map(parseFloat);
          return Object.fromEntries(style.transitionProperty.split(', ').map((property, index) => [property, durations[index % durations.length]]));
        }),
      );
    assert.ok((await transitions()).every((duration) => duration.translate > 0));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok((await transitions()).every((duration) => duration.opacity > 0 && duration.translate === 0));
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

function startConnectionProxy(target) {
  const sockets = new Set();
  let refusing = false;
  const proxy = createServer((socket) => {
    if (refusing) return socket.destroy();
    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
    sockets.add(socket).add(upstream);
    socket.pipe(upstream).pipe(socket);
    for (const end of [socket, upstream]) {
      end.on('error', () => {});
      end.on('close', () => {
        socket.destroy();
        upstream.destroy();
        sockets.delete(end);
      });
    }
  });
  return new Promise((done) =>
    proxy.listen(0, '127.0.0.1', () =>
      done({
        url: `http://127.0.0.1:${proxy.address().port}/`,
        cut() {
          refusing = true;
          for (const socket of sockets) socket.destroy();
        },
        restore() {
          refusing = false;
        },
        close: () => new Promise((closed) => proxy.close(closed)),
      }),
    ),
  );
}

test('bake dev updates a page with a save that it made while the event stream was disconnected', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': validConfig, [ARTICLE]: article({ title: 'Live', slug: 'live', body }) });
  const file = join(dir, ARTICLE);
  let printed = '';
  const server = await startDevServer(dir, { port: 0, print: (text) => (printed += `${text}\n`) });
  t.after(() => server.close());
  const proxy = await startConnectionProxy(new URL(server.url));
  t.after(() => proxy.close());
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(`${proxy.url}2026-10/live/`);
  await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
  await page.evaluate(() => {
    window.reloaded = false;
    window.addEventListener('beforeunload', () => {
      window.reloaded = true;
    });
  });
  proxy.cut();
  writeFileSync(file, readFileSync(file, 'utf8').replace('The edited paragraph says hello.', 'The edited paragraph was saved while the stream was down.'));
  await until(() => printed.includes('Updated '), 'bake dev did not update the page after the save');
  assert.equal(await page.evaluate(() => document.querySelector('.bk-article').textContent.includes('saved while the stream was down')), false);
  proxy.restore();
  await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('saved while the stream was down'));
  assert.equal(await page.evaluate(() => window.reloaded), false);
});

test('bake dev shows a parameter bar on each component of the article that changes, writes, copies and resets its parameters', async (t) => {
  const dir = copyExample(t);
  const file = join(dir, SYNTAX);
  const original = readFileSync(file, 'utf8');
  const directive = ':::act-fn-plot{fns=swish beta=2 xmin=-6 xmax=6 ymax=6 width=body}';
  const line = lineOf(original, directive);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await launchBrowser();
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
  const liveParams = () => page.evaluate((selector) => (({ fns, guides, xmax, beta }) => ({ fns, guides, xmax, beta }))(document.querySelector(selector).querySelector('act-fn-plot').params), frameSelector);
  const open = async () => {
    await page.goto(url);
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    await frame.scrollIntoViewIfNeeded();
    await page.waitForFunction((selector) => document.querySelector(selector).dataset.state === 'ready', frameSelector);
  };
  let beforeParams = null;
  // why: Playwright loses requests that are in flight while page.unroute runs, so this route stays until the page closes
  await page.route('**/__bake/params', (route) => {
    const handle = beforeParams;
    beforeParams = null;
    return handle === null ? route.continue() : handle(route);
  });
  await open();
  let boxHeight;

  await t.test('the bar shows one control per parameter above the component without changing the height of its box', async () => {
    assert.equal(await bar.locator('.name').textContent(), 'act-fn-plot');
    assert.deepEqual(
      await bar.locator('.control').evaluateAll((controls) => controls.map((item) => [item.dataset.param, item.querySelector('.label').textContent, [...item.querySelectorAll('input, select')].map((field) => field.type)])),
      [
        ['fns', '函数（实线）', ['text']],
        ['dashed', '函数（虚线）', ['text']],
        ['reference', '参考函数（淡色虚线）', ['text']],
        ['colors', '颜色编号', ['text']],
        ['off', '初始不勾选', ['text']],
        ['xmin', '横轴下限', ['range', 'number']],
        ['xmax', '横轴上限', ['range', 'number']],
        ['ymin', 'f(x) 纵轴下限', ['range', 'number']],
        ['ymax', 'f(x) 纵轴上限', ['range', 'number']],
        ['dymin', '导数纵轴下限', ['range', 'number']],
        ['dymax', '导数纵轴上限', ['range', 'number']],
        ['guides', '标注', ['select-one']],
        ['toggle', '勾选曲线', ['checkbox']],
        ['zoom', '横轴缩放滑块', ['checkbox']],
        ['beta', 'β 初始值', ['range', 'number']],
      ],
    );
    assert.deepEqual(await bar.locator('button').allTextContents(), ['Reset', 'Copy', 'Write to file']);
    boxHeight = await frame.locator('.component-box').evaluate((box) => box.getBoundingClientRect().height);
    const [barBox, componentBox] = await Promise.all([bar.boundingBox(), frame.locator('.component-box').boundingBox()]);
    assert.ok(barBox.y + barBox.height <= componentBox.y + 1, 'the bar is above the component');
    assert.equal(await page.locator('figure.component bake-param-bar').count(), await page.locator('figure.component:not(.embed figure.component)').count());
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
    assert.ok(beta > 2 && beta < 5, `beta is ${beta}`);
    assert.equal(String(beta), String(Number((Math.round(beta / 0.05) * 0.05).toFixed(2))), 'the value is a step of the slider');
    assert.equal(await control('beta').getAttribute('data-changed'), '');
    assert.equal(await control('xmax').getAttribute('data-changed'), null);
    assert.deepEqual(await liveParams(), { fns: 'swish', guides: 'auto', xmax: 6, beta });
    assert.equal(await bar.locator('.write').isDisabled(), false);
  });

  const otherSelector = `figure.component[data-line="${lineOf(original, ':::act-fn-plot{fns=gelu dashed="gelu-tanh,gelu-quick" zoom}')}"]`;
  const otherControl = (param) => page.locator(`${otherSelector} bake-param-bar .control[data-param="${param}"]`);
  const watchFrames = () =>
    page.evaluate(() => {
      window.highlighted = [];
      for (const element of document.querySelectorAll('figure.component .component-box > *')) element.bakeMarker = true;
      if (window.animatePatched) return;
      window.animatePatched = true;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (options?.id === 'bake-changed') window.highlighted.push(this.dataset.line);
        return animate.call(this, keyframes, options);
      };
    });
  const unmarked = () => page.evaluate(() => [...document.querySelectorAll('figure.component[data-state="ready"] .component-box > *')].filter((element) => !element.bakeMarker).map((element) => element.localName));
  const top = () => frame.evaluate((element) => element.getBoundingClientRect().top);
  const edit = (from, to) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
  const copiedSource = () =>
    until(async () => {
      await page.locator('.bk-copy-source').dispatchEvent('click');
      return (await page.evaluate(() => navigator.clipboard.readText())) === readFileSync(file, 'utf8');
    }, 'the page did not take the saved source');

  await t.test('Write to file rewrites the line, and the update keeps every component running without a highlight', async () => {
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.state === 'ready', otherSelector);
    await otherControl('xmax').locator('.number').fill('7');
    await watchFrames();
    await bar.locator('.write').scrollIntoViewIfNeeded();
    const before = await top();
    await bar.locator('.write').click();
    await message.filter({ hasText: `Wrote line ${line} of ${SYNTAX}` }).waitFor();
    assert.equal(readFileSync(file, 'utf8'), original.replace(directive, `:::act-fn-plot{fns=swish beta=${beta} xmin=-6 xmax=6 ymax=6 width=body}`));
    await copiedSource();
    await settle(page);
    assert.deepEqual(await unmarked(), []);
    assert.deepEqual(await page.evaluate(() => window.highlighted), []);
    assert.equal(await top(), before);
    assert.equal(await message.isVisible(), true);
    assert.equal(await control('beta').getAttribute('data-changed'), null);
    assert.equal(Number(await control('beta').locator('.number').inputValue()), beta);
    assert.equal(await bar.locator('.write').isDisabled(), true);
    assert.deepEqual(await liveParams(), { fns: 'swish', guides: 'auto', xmax: 6, beta });
    assert.deepEqual([await otherControl('xmax').locator('.number').inputValue(), await otherControl('xmax').getAttribute('data-changed')], ['7', '']);
  });

  await t.test('an unrelated save keeps the components running and the unsaved values of the bars', async () => {
    await watchFrames();
    edit('这篇文章列出 Bake 的全部写法。', '这篇文章列出 Bake 的全部写法，第一次改。');
    await page.waitForFunction(() => document.querySelector('.bk-article').textContent.includes('第一次改'));
    await settle(page);
    assert.deepEqual(await unmarked(), []);
    assert.deepEqual([await otherControl('xmax').locator('.number').inputValue(), await otherControl('xmax').getAttribute('data-changed')], ['7', '']);
  });

  await t.test('a bar that a save replaces keeps its unsaved values and gives them to the restarted component', async () => {
    edit('实线是精确 GELU', '实线是精确的 GELU');
    await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('实线是精确的 GELU'), otherSelector);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('act-fn-plot')?.params.xmax === 7, otherSelector);
    assert.deepEqual([await otherControl('xmax').locator('.number').inputValue(), await otherControl('xmax').getAttribute('data-changed')], ['7', '']);
  });

  await t.test('unsaved values stay after a reload and after a save that adds lines above the component', async () => {
    await open();
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('act-fn-plot')?.params.xmax === 7, otherSelector);
    assert.deepEqual([await otherControl('xmax').locator('.number').inputValue(), await otherControl('xmax').getAttribute('data-changed')], ['7', '']);
    const otherLine = Number(otherSelector.match(/\d+/)[0]);
    const moved = `figure.component[data-line="${otherLine + 2}"]`;
    edit('这篇文章列出 Bake 的全部写法', '新加的一段。\n\n这篇文章列出 Bake 的全部写法');
    await page.waitForFunction((selector) => document.querySelector(selector)?.querySelector('act-fn-plot')?.params.xmax === 7, moved);
    assert.deepEqual(await page.locator(`${moved} bake-param-bar .control[data-param="xmax"]`).evaluate((item) => [item.querySelector('.number').value, item.hasAttribute('data-changed')]), ['7', true]);
    edit('新加的一段。\n\n', '');
    await page.waitForFunction((selector) => document.querySelector(selector)?.querySelector('act-fn-plot')?.params.xmax === 7, otherSelector);
    await page.locator(`${otherSelector} bake-param-bar .reset`).click();
    await open();
    assert.equal(await otherControl('xmax').getAttribute('data-changed'), null);
    assert.notEqual(await otherControl('xmax').locator('.number').inputValue(), '7');
  });

  await t.test('the bar takes its colours from the theme and follows its dark mode', async () => {
    const colours = () => bar.evaluate((host) => {
      const style = getComputedStyle(host.shadowRoot.querySelector('.bar'));
      return [style.backgroundColor, style.color];
    });
    const choose = async (theme) => {
      await page.click('.bk-settings-toggle');
      await page.click(`[data-setting="theme"] [data-value="${theme}"]`);
      await page.click('.bk-settings-toggle');
    };
    await choose('light');
    const light = await colours();
    await choose('dark');
    const dark = await colours();
    await choose('system');
    assert.notEqual(dark[0], light[0]);
    assert.notEqual(dark[1], light[1]);
  });

  await t.test('a parameter changed in the editor restarts the component and highlights its block once', async () => {
    await watchFrames();
    edit(`beta=${beta} xmin=-6 xmax=6`, `beta=${beta} xmin=-6 xmax=5`);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('act-fn-plot')?.params.xmax === 5, frameSelector);
    const block = await page.evaluate((selector) => document.querySelector(selector).closest('.bk-block').dataset.line, frameSelector);
    assert.deepEqual(await page.evaluate(() => window.highlighted), [block]);
    assert.deepEqual(await liveParams(), { fns: 'swish', guides: 'auto', xmax: 5, beta });
  });

  await t.test('Reset goes back to the values in the Markdown', async () => {
    await control('guides').locator('select').selectOption('none');
    assert.equal(await control('guides').getAttribute('data-changed'), '');
    assert.equal((await liveParams()).guides, 'none');
    await bar.locator('.reset').click();
    assert.equal(await control('guides').locator('select').inputValue(), 'auto');
    assert.equal(await control('guides').getAttribute('data-changed'), null);
    assert.equal((await liveParams()).guides, 'auto');
    assert.equal(await bar.locator('.write').isDisabled(), true);
  });

  await t.test('Copy puts the rewritten line on the clipboard and leaves the file unchanged', async () => {
    const before = readFileSync(file, 'utf8');
    await control('xmax').locator('.number').fill('8');
    assert.equal(Number(await control('xmax').locator('.slider').inputValue()), 8);
    assert.equal((await liveParams()).xmax, 8);
    await bar.locator('.copy').click();
    await message.filter({ hasText: 'Copied' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `:::act-fn-plot{fns=swish beta=${beta} xmin=-6 xmax=8 ymax=6 width=body}`);
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
    await page.waitForFunction(() => [...document.querySelectorAll('bake-param-bar')].every((item) => !item.checkVisibility() && item.getBoundingClientRect().height === 0));
    assert.equal(await frame.locator('.component-box').evaluate((box) => box.getBoundingClientRect().height), boxHeight, 'the bar does not change the height of the component box');
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
    await control('xmax').locator('.number').fill(String(range));
    let edited = null;
    beforeParams = async (route) => {
      edit('全部写法，', `全部写法，${text}，`);
      edited = readFileSync(file, 'utf8');
      const response = await route.fetch();
      if (waitForRefresh) await page.waitForFunction((expected) => document.querySelector('.bk-article').textContent.includes(expected), text);
      await route.fulfill({ response });
    };
    await bar.locator('.write').click();
    await message.filter({ hasText: refused }).waitFor();
    await page.waitForFunction((expected) => document.querySelector('.bk-article').textContent.includes(expected), text);
    await settle(page);
    assert.deepEqual([await message.isVisible(), await message.textContent()], [true, refused]);
    assert.deepEqual([await control('xmax').locator('.number').inputValue(), await control('xmax').getAttribute('data-changed')], [String(range), '']);
    assert.equal((await liveParams()).xmax, range);
    assert.equal(readFileSync(file, 'utf8'), edited);
    await bar.locator('.write').click();
    await message.filter({ hasText: `Wrote line ${line}` }).waitFor();
    assert.match(readFileSync(file, 'utf8'), new RegExp(`xmin=-6 xmax=${range} ymax=6 width`));
  };

  await t.test('Write refuses when the file changed before the page updated, keeps the message and values, and a second Write succeeds', async () => {
    await refuseThenWrite(9, '第二次改', false);
  });

  await t.test('Write refuses when the page updated before the refusal arrived, and a second Write succeeds', async () => {
    await refuseThenWrite(3, '第三次改', true);
  });

  const plotAt = (directive) => `figure.component[data-line="${lineOf(readFileSync(file, 'utf8'), directive)}"]`;
  const shown = async (selector) => {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.state === 'ready' && document.querySelector(selector).querySelector('act-fn-plot')?.params !== undefined, selector);
    return {
      xmax: await page.locator(`${selector} bake-param-bar .control[data-param="xmax"] .number`).inputValue(),
      unsaved: !(await page.locator(`${selector} bake-param-bar .write`).isDisabled()),
      live: await page.evaluate((selector) => document.querySelector(selector).querySelector('act-fn-plot').params.xmax, selector),
    };
  };

  await t.test('after a reload, an unsaved value that the declaration no longer accepts and the value of a removed component are dropped', async () => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const reloaded = async (change) => {
      await page.evaluate(() => {
        window.beforeReload = true;
      });
      change();
      await page.waitForFunction(() => window.beforeReload === undefined);
      await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    };

    await control('xmax').locator('.number').fill('20');
    assert.equal((await liveParams()).xmax, 20);
    const declaration = join(dir, 'components/act-fn-plot.jsx');
    await reloaded(() => writeFileSync(declaration, readFileSync(declaration, 'utf8').replace("xmax: { label: '横轴上限', type: 'number', min: -100, max: 100", "xmax: { label: '横轴上限', type: 'number', min: -100, max: 12")));
    assert.deepEqual(await shown(frameSelector), { xmax: '3', unsaved: false, live: 3 });

    const directive = ':::act-fn-plot{fns=silu xmin=-6 xmax=6 ymax=6}';
    const caption = '选中交互组件的任何部分';
    const block = `${directive}\n${caption}，复制的都是它的整个 \`:::\` 块。\n:::\n`;
    assert.ok(readFileSync(file, 'utf8').includes(block));
    const last = plotAt(directive);
    await shown(last);
    await page.locator(`${last} bake-param-bar .control[data-param="xmax"] .number`).fill('7');
    assert.equal((await shown(last)).unsaved, true);
    edit(block, '');
    await page.waitForFunction((caption) => !document.querySelector('.bk-article').textContent.includes(caption), caption);
    await page.reload();
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    edit('[^copy-notes]: ', `${block}\n[^copy-notes]: `);
    await page.waitForFunction((caption) => document.querySelector('.bk-article').textContent.includes(caption), caption);
    assert.deepEqual(await shown(plotAt(directive)), { xmax: '6', unsaved: false, live: 6 });
    assert.deepEqual(errors, []);
  });

  await t.test('removing a component from the middle of the article drops its unsaved value, and the other components of the same name keep theirs', async () => {
    const middle = ':::act-fn-plot{fns=relu width=70%}';
    const last = ':::act-fn-plot{fns=silu xmin=-6 xmax=6 ymax=6}';
    const block = `::::example\n${middle}\n:::\n::::\n\n`;
    const after = '像素宽度超过正文栏时';
    assert.ok(readFileSync(file, 'utf8').includes(`${block}${after}`));
    await shown(plotAt(middle));
    await page.locator(`${plotAt(middle)} bake-param-bar .control[data-param="xmax"] .number`).fill('5');
    await shown(plotAt(last));
    await page.locator(`${plotAt(last)} bake-param-bar .control[data-param="xmax"] .number`).fill('8');
    const lastLine = plotAt(last);
    edit(block, '');
    await page.locator(lastLine).waitFor({ state: 'detached' });
    assert.deepEqual(await shown(plotAt(last)), { xmax: '8', unsaved: true, live: 8 });
    await page.reload();
    await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
    assert.deepEqual(await shown(plotAt(last)), { xmax: '8', unsaved: true, live: 8 });
    edit(after, `${block}${after}`);
    await page.locator(plotAt(middle)).waitFor();
    assert.deepEqual(await shown(plotAt(middle)), { xmax: '4', unsaved: false, live: 4 });
    assert.deepEqual(await shown(plotAt(last)), { xmax: '8', unsaved: true, live: 8 });
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
  { style: 'notes', width: 1440 },
  { style: 'notes', width: 1024 },
  { style: 'tabs', width: 1440 },
  { style: 'dots', width: 1024 },
  { style: 'ticks', width: 1440 },
  { style: 'dots', width: 375 },
  { style: 'tabs', width: 375 },
];

test('bake dev rebuilds every table of contents style from the saved headings and restarts the components', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': validConfig, 'components/label-view.js': labelView, [ARTICLE]: article({ title: 'Live', slug: 'live', body: tocBody }) });
  const file = join(dir, ARTICLE);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const url = `${server.url}2026-10/live/`;
  const occurrences = (titles) =>
    page.evaluate((titles) => {
      const text = [...document.querySelectorAll('.bk-toc, .bk-toc-ui')]
        .flatMap((root) => [root.textContent, ...[...root.querySelectorAll('[aria-label]')].map((labelled) => labelled.getAttribute('aria-label'))])
        .join('\n');
      return titles.map((title) => text.split(title).length - 1);
    }, titles);

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
      await page.evaluate(() => {
        window.keptAcrossUpdates = true;
        scrollTo(0, document.getElementById('inside').getBoundingClientRect().top + scrollY - 100);
      });
      await settle(page);
      const drawer = () =>
        page.evaluate(() => ({
          open: document.querySelector('.bk-toc-handle').getAttribute('aria-expanded'),
          selected: [...document.querySelectorAll('.bk-toc-drawer-index button')].findIndex((button) => button.getAttribute('aria-expanded') === 'true'),
          title: document.querySelector('.bk-toc-drawer-detail .bk-toc-card-title').textContent,
          scroll: document.querySelector('.bk-toc-drawer-detail').scrollTop,
        }));
      let drawerBefore = null;
      if (view.width < 1000) {
        await page.click('.bk-toc-handle');
        await page.waitForFunction(() => document.querySelector('.bk-toc-drawer').getBoundingClientRect().left === 0);
        await page.locator('.bk-toc-drawer-index button').nth(1).click();
        await page.evaluate(() => {
          document.querySelector('.bk-toc-drawer-detail').scrollTop = 30;
        });
        drawerBefore = await drawer();
        assert.ok(drawerBefore.scroll > 0, `the drawer of the ${view.style} style does not scroll`);
      }
      const old = round === 0 ? 'Second' : `Renamed ${round - 1}`;
      const [oldBefore, insideBefore] = await occurrences([old, 'Inside']);
      assert.ok(oldBefore > 0 && insideBefore > 0, `the ${view.style} style shows ${old} ${oldBefore} times and Inside ${insideBefore} times`);
      const name = `Renamed ${round}`;
      writeFileSync(file, readFileSync(file, 'utf8').replace(/## \S.* \{#second\}/, `## ${name} {#second}`).replace('### Inside {#inside}', `### Added ${round} {#added-${round}}\n\nText.\n\n### Inside {#inside}`).replace(/text=\w+\}/, `text=round${round}}`));
      await page.waitForFunction((text) => document.querySelector('label-view')?.textContent === text, `round${round}`);
      await until(async () => (await occurrences([name]))[0] > 0, `the ${view.style} style does not show ${name}`);
      await settle(page);
      assert.equal(await page.locator('label-view').count(), 1);
      assert.equal(await page.evaluate(() => window.keptAcrossUpdates), true, 'the save reloaded the page');
      if (drawerBefore !== null) assert.deepEqual(await drawer(), { ...drawerBefore, title: name }, `the drawer of the ${view.style} style after the save`);
      assert.deepEqual(await occurrences([old, name, `Added ${round}`, 'Inside']), [0, oldBefore, insideBefore, insideBefore], `the ${view.style} style shows ${old}, ${name}, Added ${round} and Inside after the save`);
    });
  }
});

test('bake dev starts an embedded component again when its source article changes its box', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'components/label-view.js': labelView,
    'content/posts/rope/index.md': article({ body: '## Grid {#grid}\n\n:::label-view{text=first}\nThe caption.\n:::\n' }),
    'content/posts/host/index.md': article({ title: 'Host', slug: 'host', body: 'The host paragraph.\n\n:::embed\n/2026-10/rope/#grid\n:::\n' }),
  });
  const file = join(dir, 'content/posts/rope/index.md');
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${server.url}2026-10/host/`);
  await page.waitForSelector('#bake-dev[data-ready]', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('.embed label-view')?.textContent === 'first');
  writeFileSync(file, readFileSync(file, 'utf8').replace('{text=first}', '{text=first height=200}'));
  await page.waitForFunction(() => document.querySelector('.embed .component-box').getBoundingClientRect().height === 200);
  await page.waitForFunction(() => document.querySelector('.embed label-view')?.textContent === 'first');
  await page.close();
});

test('the bake dev dot and problems list leave the chat button and the settings button uncovered', async (t) => {
  const dir = createBlog(t, { 'bake.config.js': validConfig, [ARTICLE]: article({ title: 'Live', slug: 'live', body }) });
  const file = join(dir, ARTICLE);
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const browser = await launchBrowser();
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
