import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const config = `export default {
  title: '测试博客',
  description: '用来测试首页的博客。',
  url: 'https://example.com',
  language: 'zh-CN',
  categories: [
    { id: 'ml', name: '模型', color: '#2a78d6', desc: '模型结构。' },
    { id: 'math', name: '数学', color: '#985b57', desc: '推导。' },
  ],
};
`;

const recordingPreview = `export default function preview(element) {
  const name = element.closest('.bk-card').querySelector('.bk-card-title').textContent;
  element.dataset.drawn = 'yes';
  element.textContent = 'first frame';
  window.previewLog ??= [];
  return {
    start() {
      element.dataset.state = 'running';
      window.previewLog.push('start ' + name);
    },
    stop() {
      element.dataset.state = 'stopped';
      window.previewLog.push('stop ' + name);
    },
  };
}
`;

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#2a78d6"/></svg>';

function post(name, date, category, tags, extra = '') {
  return article({ title: name, slug: name.toLowerCase(), date, extra: `category: ${category}\ntags: [${tags.join(', ')}]\nsummary: ${name} 的摘要。\n${extra}` });
}

const files = {
  'bake.config.js': config,
  'content/posts/gate/index.md': post('Gate', '2026-10-12', 'ml', ['激活'], 'preview: preview.js\n'),
  'content/posts/gate/preview.js': recordingPreview,
  'content/posts/broken/index.md': post('Broken', '2026-10-10', 'ml', ['激活'], 'preview: preview.js\n'),
  'content/posts/broken/preview.js': "export default function preview() {\n  throw new Error('cannot draw');\n}\n",
  'content/posts/norm/index.md': post('Norm', '2026-10-08', 'ml', ['归一化']),
  'content/posts/chain/index.md': article({ title: 'Chain', slug: 'chain', date: '2026-09-20', extra: 'category: math\ntags: [梯度]\n', body: '![](plot.svg)\n' }),
  'content/posts/chain/plot.svg': svg,
  'content/posts/jacobian/index.md': post('Jacobian', '2026-09-15', 'math', ['梯度', '激活'], 'preview: preview.js\n'),
  'content/posts/jacobian/preview.js': recordingPreview,
  'content/posts/series/index.md': post('Series', '2026-08-03', 'math', ['级数']),
};

test('the essay homepage', async (t) => {
  const dir = createBlog(t, files);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${origin}/`);
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  };
  const state = (page) =>
    page.evaluate(() => ({
      group: document.documentElement.dataset.group,
      columns: document.documentElement.dataset.columns,
      visible: [...document.querySelectorAll('.bk-grouping')].filter((grouping) => grouping.offsetParent !== null).map((grouping) => grouping.dataset.grouping),
      gridColumns: getComputedStyle([...document.querySelectorAll('.bk-grid')].find((grid) => grid.offsetParent !== null)).gridTemplateColumns.split(' ').length,
    }));
  const cardIn = (grouping, url) => `[data-grouping="${grouping}"] .bk-card[href="${url}"]`;
  const previewState = (page, selector) => page.locator(selector).evaluate((card) => card.querySelector('.bk-card-preview')?.dataset.state ?? null);

  await t.test('grouping and column choices change the page, survive a reload and are applied before the page script runs', async () => {
    const { context, page } = await open();
    assert.deepEqual(await state(page), { group: 'category', columns: '3', visible: ['category'], gridColumns: 3 });
    await page.getByRole('button', { name: '月份' }).click();
    await page.getByRole('button', { name: '5', exact: true }).click();
    assert.deepEqual(await state(page), { group: 'month', columns: '5', visible: ['month'], gridColumns: 5 });
    assert.equal(await page.getByRole('button', { name: '月份' }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('bk-group'), localStorage.getItem('bk-columns')]), ['month', '5']);
    await page.reload();
    assert.deepEqual(await state(page), { group: 'month', columns: '5', visible: ['month'], gridColumns: 5 });
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    assert.deepEqual(await state(page), { group: 'month', columns: '5', visible: ['month'], gridColumns: 5 });
    await page.unroute('**/assets/*.js');
    await context.close();
  });

  await t.test('a preview loads only in the visible grouping, starts while the pointer rests on its card and stops when it leaves', async () => {
    const { context, page, errors } = await open();
    const gate = cardIn('category', '2026-10/gate/');
    await page.waitForFunction(() => document.querySelector('[data-grouping="category"] .bk-card-preview[data-drawn]') !== null);
    assert.equal(await page.locator('[data-grouping="month"] .bk-card-preview').count(), 0);
    assert.equal(await page.locator(gate).locator('.bk-card-fallback').count(), 0);
    assert.equal(await previewState(page, gate), null);
    await page.hover(gate);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'running', gate);
    await page.waitForFunction((selector) => getComputedStyle(document.querySelector(selector)).borderColor === 'rgb(42, 120, 214)', gate);
    assert.equal(await page.locator(gate).evaluate((card) => getComputedStyle(card).translate), '0px -2px');
    await page.mouse.move(5, 5);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'stopped', gate);
    assert.deepEqual(await page.evaluate(() => window.previewLog), ['start Gate', 'stop Gate']);

    const broken = page.locator(cardIn('category', '2026-10/broken/'));
    await page.waitForFunction(() => document.querySelectorAll('.bk-card-preview').length === 2);
    assert.equal(await broken.locator('.bk-card-fallback .bk-card-cover').textContent(), 'Broken');
    assert.equal(await broken.locator('.bk-card-preview').count(), 0);
    assert.ok(errors.some((text) => text.includes('broken/preview.js')), `console errors: ${errors.join(' | ')}`);

    await page.hover(gate);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'running', gate);
    await page.getByRole('button', { name: '月份' }).click();
    assert.equal(await previewState(page, gate), 'stopped');
    await page.waitForFunction(() => document.querySelector('[data-grouping="month"] .bk-card-preview[data-drawn]') !== null);
    await context.close();
  });

  await t.test('on a phone a card plays while it is in the middle of the screen', async () => {
    const { context, page } = await open({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
    assert.equal(await page.locator('[data-control="columns"]').isVisible(), false);
    const jacobian = cardIn('category', '2026-09/jacobian/');
    await page.locator(jacobian).evaluate((card) => card.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.state === 'running', jacobian);
    assert.equal(await page.locator(jacobian).getAttribute('data-active'), '');
    await page.locator(jacobian).evaluate((card) => scrollBy({ top: card.getBoundingClientRect().bottom + 20, behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'stopped', jacobian);
    assert.equal(await page.locator(jacobian).getAttribute('data-active'), null);
    await context.close();
  });

  await t.test('with reduced motion a preview shows its first frame and never starts', async () => {
    const { context, page } = await open({ reducedMotion: 'reduce' });
    const gate = cardIn('category', '2026-10/gate/');
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.drawn === 'yes', gate);
    await page.hover(gate);
    await page.locator(gate).focus();
    await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
    assert.equal(await previewState(page, gate), null);
    assert.deepEqual(await page.evaluate(() => window.previewLog), []);
    await context.close();
  });

  await t.test('category chips jump to their group and mark the group on screen, and tag chips filter the month grouping', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 700 } });
    await page.locator('.bk-chip[data-target="category-math"]').click();
    await page.waitForFunction(() => {
      const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      return atEnd || Math.abs(document.getElementById('category-math').getBoundingClientRect().top - document.querySelector('.bk-home-bar').offsetHeight) < 30;
    });
    assert.deepEqual(await page.locator('.bk-chip.is-current').evaluateAll((chips) => chips.map((chip) => chip.dataset.target)), ['category-math']);
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -5000);
    await page.waitForFunction(() => scrollY === 0);
    await page.waitForFunction(() => document.querySelector('.bk-chip.is-current')?.dataset.target === 'category-ml');
    await page.mouse.wheel(0, 5000);
    await page.waitForFunction(() => document.querySelector('.bk-chip.is-current')?.dataset.target === 'category-math');

    await page.getByRole('button', { name: '月份' }).click();
    const months = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-grouping="month"] .bk-group')]
          .filter((group) => group.offsetParent !== null)
          .map((group) => [group.querySelector('.bk-group-title').textContent, group.querySelector('.bk-group-count').textContent, [...group.querySelectorAll('.bk-card')].filter((card) => card.offsetParent !== null).map((card) => card.querySelector('.bk-card-title').textContent)]),
      );
    await page.getByRole('button', { name: '梯度' }).click();
    assert.deepEqual(await months(), [['2026-09', '2 篇', ['Chain', 'Jacobian']]]);
    assert.equal(await page.getByRole('button', { name: '梯度' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '激活' }).click();
    assert.deepEqual(await months(), [
      ['2026-10', '2 篇', ['Gate', 'Broken']],
      ['2026-09', '1 篇', ['Jacobian']],
    ]);
    await page.getByRole('button', { name: '全部' }).click();
    assert.deepEqual(await months(), [
      ['2026-10', '3 篇', ['Gate', 'Broken', 'Norm']],
      ['2026-09', '2 篇', ['Chain', 'Jacobian']],
      ['2026-08', '1 篇', ['Series']],
    ]);
    await context.close();
  });

  await t.test('without scripts the default grouping and its cards are shown and the controls are hidden', async () => {
    const { context, page } = await open({ javaScriptEnabled: false });
    const shown = await page.evaluate(() => ({
      groupings: [...document.querySelectorAll('.bk-grouping')].filter((grouping) => grouping.offsetParent !== null).map((grouping) => grouping.dataset.grouping),
      cards: [...document.querySelectorAll('.bk-card')].filter((card) => card.offsetParent !== null).length,
      controls: document.querySelector('.bk-home-controls').offsetParent !== null,
      tags: document.querySelector('.bk-chips[data-for="month"]').offsetParent !== null,
      chips: [...document.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')].filter((chip) => chip.offsetParent !== null).length,
      image: document.querySelector('[data-grouping="category"] .bk-card-fallback img')?.getAttribute('src'),
    }));
    assert.deepEqual(shown, { groupings: ['category'], cards: 6, controls: false, tags: false, chips: 2, image: '2026-09/chain/plot.svg' });
    await page.locator('.bk-chip[data-target="category-math"]').click();
    assert.match(page.url(), /#category-math$/);
    await context.close();
  });

  await t.test('the homepage stays inside the screen at every width and follows dark mode', async () => {
    const { context, page } = await open({ colorScheme: 'dark' });
    const overflowing = [];
    for (const width of [1440, 1100, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > width) overflowing.push(`${width}px is ${scrollWidth}px wide`);
    }
    assert.deepEqual(overflowing, []);
    const colors = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.bk-card')).backgroundColor]);
    assert.deepEqual(colors, ['rgb(17, 20, 19)', 'rgb(26, 30, 28)']);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '浅' }).click();
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 244)');
    await context.close();
  });
});
