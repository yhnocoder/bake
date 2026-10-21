import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog } from '../blog.js';
import { launchBrowser, serve } from './browser.js';

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
  const name = element.closest('.bk-card')?.querySelector('.bk-card-title').textContent ?? 'share image';
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

const longWord = 'scaled_dot_product_attention_with_causal_mask';

function post(name, date, category, tags, extra = '') {
  return article({ title: name, slug: name.toLowerCase(), date, extra: `category: ${category}\ntags: [${tags.join(', ')}]\nsummary: ${name} 的摘要。\n${extra}` });
}

const files = {
  'bake.config.js': config,
  'content/posts/gate/index.md': post('Gate', '2026-10-12', 'ml', ['激活'], 'preview: preview.js\n'),
  'content/posts/gate/preview.js': recordingPreview,
  'content/posts/broken/index.md': post('Broken', '2026-10-10', 'ml', ['激活'], 'preview: preview.js\n'),
  'content/posts/broken/preview.js': "export default function preview(element) {\n  if (element.closest('.bk-card')) throw new Error('cannot draw');\n  return { start() {}, stop() {} };\n}\n",
  'content/posts/norm/index.md': post('Norm', '2026-10-08', 'ml', ['归一化']),
  'content/posts/chain/index.md': article({ title: 'Chain', slug: 'chain', date: '2026-09-20', extra: 'category: math\ntags: [梯度]\n', body: '![](plot.svg)\n' }),
  'content/posts/chain/plot.svg': svg,
  'content/posts/jacobian/index.md': post('Jacobian', '2026-09-15', 'math', ['梯度', '激活'], 'preview: preview.js\n'),
  'content/posts/jacobian/preview.js': recordingPreview,
  'content/posts/series/index.md': post('Series', '2026-08-03', 'math', ['级数']),
  'content/posts/attention/index.md': article({ title: longWord, slug: 'attention', date: '2026-07-01', extra: `category: ml\ntags: [注意力]\nsummary: ${longWord} 的摘要。\n` }),
};

const sharedShadowLayers = (light, dark) => {
  const layers = (shadow) => shadow.split(/,\s*(?![^(]*\))/);
  return layers(light).filter((layer) => layers(dark).includes(layer));
};

test('the essay homepage', async (t) => {
  const dir = createBlog(t, files);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const origin = await serve(t, join(dir, 'dist'));
  const browser = await launchBrowser();

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
      groups: [...document.querySelectorAll('.bk-group-title')].filter((title) => title.checkVisibility()).map((title) => title.textContent),
      gridColumns: getComputedStyle([...document.querySelectorAll('.bk-grid')].find((grid) => grid.checkVisibility())).gridTemplateColumns.split(' ').length,
    }));
  const byCategory = { groups: ['模型', '数学'], gridColumns: 3 };
  const byMonth = { groups: ['2026-10', '2026-09', '2026-08', '2026-07'], gridColumns: 5 };
  const thumbs = (page, chosen) =>
    page.evaluate(
      (labels) =>
        [...document.querySelectorAll('.bk-switch-options')].map((options, index) => {
          const thumb = getComputedStyle(options, '::before');
          const button = [...options.querySelectorAll('button')].find((option) => option.textContent === labels[index]).getBoundingClientRect();
          const left = options.getBoundingClientRect().left + 2 + new DOMMatrix(thumb.transform).m41;
          return Math.abs(left - button.left) < 1 && Math.abs(parseFloat(thumb.width) - button.width) < 1 && options.getAnimations({ subtree: true }).length === 0;
        }),
      chosen,
    );
  const currentChips = (page) =>
    page.evaluate(() => [...document.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')].filter((chip) => chip.getAttribute('aria-current') === 'true').map((chip) => chip.getAttribute('href')));
  const cardIn = (grouping, url) => `[data-grouping="${grouping}"] .bk-card[href="${url}"]`;
  const previewState = (page, selector) => page.locator(selector).evaluate((card) => card.querySelector('.bk-card-preview')?.dataset.state ?? null);

  await t.test('grouping and column choices change the page, survive a reload and are applied with the switch thumbs on the chosen buttons before the page script runs', async () => {
    const { context, page } = await open();
    assert.deepEqual(await state(page), byCategory);
    await page.getByRole('button', { name: '月份' }).click();
    await page.getByRole('button', { name: '5', exact: true }).click();
    assert.deepEqual(await state(page), byMonth);
    assert.equal(await page.getByRole('button', { name: '月份' }).getAttribute('aria-pressed'), 'true');
    await page.reload();
    assert.deepEqual(await state(page), byMonth);
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.reload();
    assert.deepEqual(await state(page), byMonth);
    assert.deepEqual(await thumbs(page, ['月份', '5']), [true, true]);
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
    await page.waitForFunction((selector) => {
      const ring = getComputedStyle(document.querySelector(selector), '::after');
      return ring.borderColor === 'rgb(42, 120, 214)' && ring.opacity === '1';
    }, gate);
    assert.equal(await page.locator(gate).evaluate((card) => getComputedStyle(card).translate), '0px -3px');
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
    const bar = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return { bar: box('.bk-home-bar').width, chips: box('.bk-chips[data-for="category"]').width, chipsBottom: box('.bk-chips[data-for="category"]').bottom, controlsTop: box('.bk-home-controls').top };
    });
    assert.equal(bar.chips, bar.bar);
    assert.ok(bar.controlsTop >= bar.chipsBottom, `the switches start at ${bar.controlsTop}px, above the end of the chip row at ${bar.chipsBottom}px`);
    const jacobian = cardIn('category', '2026-09/jacobian/');
    await page.locator(jacobian).evaluate((card) => card.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.state === 'running', jacobian);
    await page.locator(jacobian).evaluate((card) => scrollBy({ top: card.getBoundingClientRect().bottom + 20, behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'stopped', jacobian);
    await context.close();
  });

  await t.test('on a phone a preview in the middle of the screen waits until the scrolling stops', async () => {
    const { context, page } = await open({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    const jacobian = cardIn('category', '2026-09/jacobian/');
    await page.locator(jacobian).evaluate((card) => card.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.state === 'running', jacobian);
    const states = await page.locator(jacobian).evaluate(async (card) => {
      const seen = [];
      for (let step = 0; step < 16; step += 1) {
        scrollBy({ top: step % 2 === 0 ? 3 : -3, behavior: 'instant' });
        await new Promise((done) => setTimeout(done, 50));
        seen.push(card.querySelector('.bk-card-preview').dataset.state);
      }
      return seen;
    });
    assert.deepEqual(new Set(states.slice(1)), new Set(['stopped']));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'running', jacobian);
    await context.close();
  });

  await t.test('a column switch animates the cards only by moving and scaling them', async () => {
    const { context, page } = await open();
    const properties = await page.evaluate(() => {
      document.querySelector('[data-control="columns"] button[data-value="5"]').click();
      return [...new Set(document.getAnimations().filter((animation) => animation.effect.target.matches('.bk-card')).flatMap((animation) => animation.effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe))))].sort();
    });
    assert.deepEqual(properties.filter((name) => !['composite', 'computedOffset', 'easing', 'offset'].includes(name)), ['scale', 'translate']);
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

  await t.test('a focused card stops its preview when it leaves the screen and starts it again when it comes back', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 500 } });
    const gate = cardIn('category', '2026-10/gate/');
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.drawn === 'yes', gate);
    await page.locator(gate).focus();
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'running', gate);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    assert.equal(await page.locator(gate).evaluate((card) => card.getBoundingClientRect().bottom < 0 && document.activeElement === card), true);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'stopped', gate);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'running', gate);
    await context.close();
  });

  await t.test('a preview keeps running while either the pointer or the keyboard focus stays on its card', async () => {
    const { context, page } = await open();
    const gate = cardIn('category', '2026-10/gate/');
    const running = (selector) => page.locator(selector).evaluate((card) => card.querySelector('.bk-card-preview').dataset.state);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview')?.dataset.drawn === 'yes', gate);
    await page.locator(gate).focus();
    await page.hover(gate);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(100);
    assert.equal(await running(gate), 'running', 'the pointer left a focused card');
    await page.hover(gate);
    await page.locator(gate).evaluate((card) => card.blur());
    await page.waitForTimeout(100);
    assert.equal(await running(gate), 'running', 'the focus left a hovered card');
    await page.mouse.move(5, 5);
    await page.waitForFunction((selector) => document.querySelector(selector).querySelector('.bk-card-preview').dataset.state === 'stopped', gate);
    await context.close();
  });

  await t.test('clicking the chip of the group on screen does not keep the highlight from following the scroll', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 700 } });
    const settled = () =>
      page.evaluate(
        () =>
          new Promise((done) => {
            let last = scrollY;
            let still = 0;
            const check = () => {
              still = scrollY === last ? still + 1 : 0;
              last = scrollY;
              if (still >= 10) done();
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          }),
      );
    const math = page.getByRole('link', { name: '数学' });
    await math.click();
    await settled();
    await page.waitForFunction(() => document.querySelector('.bk-chip[href="#category-math"]').getAttribute('aria-current') === 'true');
    assert.deepEqual(await currentChips(page), ['#category-math']);
    const chip = await math.boundingBox();
    const before = await page.evaluate(() => scrollY);
    await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await settled();
    assert.equal(await page.evaluate(() => scrollY), before);
    const followed = await page.evaluate(
      () =>
        new Promise((done) => {
          let seen = false;
          const record = () => {
            if (scrollY > 0 && document.querySelector('.bk-chip[href="#category-ml"]').getAttribute('aria-current') === 'true') seen = true;
            requestAnimationFrame(record);
          };
          addEventListener('scrollend', () => done(seen), { once: true });
          requestAnimationFrame(record);
          scrollTo({ top: 0, behavior: 'smooth' });
        }),
    );
    assert.equal(followed, true, 'the highlight did not move to the first group while the page scrolled to the top');
    await page.waitForFunction(() => document.querySelector('.bk-chip[href="#category-ml"]').getAttribute('aria-current') === 'true');
    assert.deepEqual(await currentChips(page), ['#category-ml']);
    await context.close();
  });

  await t.test('category chips jump to their group and mark the group on screen, and tag chips filter the month grouping', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 700 } });
    const current = (href) => page.waitForFunction((target) => [...document.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')].every((chip) => (chip.getAttribute('aria-current') === 'true') === (chip.getAttribute('href') === target)), href);
    await page.getByRole('link', { name: '数学' }).click();
    await page.waitForFunction(() => {
      const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      return atEnd || Math.abs(document.getElementById('category-math').getBoundingClientRect().top - document.querySelector('.bk-home-bar').offsetHeight) < 30;
    });
    await current('#category-math');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -5000);
    await page.waitForFunction(() => scrollY === 0);
    await current('#category-ml');
    await page.mouse.wheel(0, 5000);
    await current('#category-math');

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
      ['2026-07', '1 篇', [longWord]],
    ]);
    await context.close();
  });

  await t.test('the bar covers the whole width with an edge only while it is stuck, and the switches slide a thumb to the chosen value', async () => {
    const { context, page } = await open({ viewport: { width: 1440, height: 700 } });
    const edge = (opacity) => page.waitForFunction((value) => getComputedStyle(document.querySelector('.bk-home-bar'), '::before').opacity === value, opacity);
    await edge('0');
    await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
    await edge('1');
    const cover = await page.evaluate(() => {
      const bar = document.querySelector('.bk-home-bar');
      const box = bar.getBoundingClientRect();
      return { top: box.top, background: getComputedStyle(bar).backgroundColor, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.deepEqual(cover, { top: 0, background: 'rgb(245, 246, 244)', scrollWidth: 1440 });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await edge('0');

    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: '月份' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.bk-switch-options')].every((options) => options.getAnimations({ subtree: true }).length === 0));
    assert.deepEqual(await thumbs(page, ['月份', '5']), [true, true]);

    const moving = await page.evaluate(() =>
      ['.bk-card', '.bk-card-fallback', '.bk-chip', '.bk-home-bar', '.bk-switch-options'].flatMap((selector) =>
        ['', '::before', '::after'].flatMap((pseudo) => {
          const element = document.querySelector(selector);
          if (element === null) return [];
          return getComputedStyle(element, pseudo || null)
            .transitionProperty.split(', ')
            .filter((property) => !['all', 'none', 'opacity', 'transform', 'translate', 'scale'].includes(property))
            .map((property) => `${selector}${pseudo} ${property}`);
        }),
      ),
    );
    assert.deepEqual(moving, []);
    await context.close();
  });

  await t.test('without scripts the default grouping and its cards are shown and the controls are hidden', async () => {
    const { context, page } = await open({ javaScriptEnabled: false });
    const shown = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.bk-group-title')].filter((title) => title.offsetParent !== null).map((title) => title.textContent),
      cards: [...document.querySelectorAll('.bk-card')].filter((card) => card.offsetParent !== null).length,
      controls: document.querySelector('.bk-home-controls').offsetParent !== null,
      tags: document.querySelector('.bk-chips[data-for="month"]').offsetParent !== null,
      chips: [...document.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')].filter((chip) => chip.offsetParent !== null).length,
      image: document.querySelector('[data-grouping="category"] .bk-card-fallback img')?.getAttribute('src'),
    }));
    assert.deepEqual(shown, { groups: ['模型', '数学'], cards: 7, controls: false, tags: false, chips: 2, image: '2026-09/chain/plot.svg' });
    await page.getByRole('link', { name: '数学' }).click();
    assert.match(page.url(), /#category-math$/);
    await context.close();
  });

  await t.test('the settings panel on the homepage offers the theme and the font with their current values', async () => {
    const { context, page } = await open();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await page.getByRole('button', { name: '设置' }).click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-settings-panel')).opacity === '1');
      const panel = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('.bk-settings-row')].filter((row) => row.checkVisibility()).map((row) => row.querySelector('.bk-settings-label').textContent),
        pressed: [...document.querySelectorAll('.bk-settings-panel [aria-pressed="true"]')].map((button) => button.textContent),
        handles: document.querySelectorAll('.bk-toc-handle').length,
        homeLinks: document.querySelectorAll('.bk-settings-home').length,
        gap: Math.round(document.querySelector('.bk-settings-toggle').getBoundingClientRect().top - document.querySelector('.bk-settings-panel').getBoundingClientRect().bottom),
      }));
      assert.deepEqual(panel, { rows: ['主题', '字体'], pressed: ['跟随系统'], handles: 0, homeLinks: 0, gap: 8 }, `at ${width} pixels`);
      await page.keyboard.press('Escape');
    }
    await context.close();
  });

  await t.test('a link to another page fades the page out before it opens, and going back shows the page again', async () => {
    const { context, page } = await open();
    const card = page.locator('[data-grouping="category"] .bk-card').first();
    const href = await card.getAttribute('href');
    const fades = await card.evaluate((element) => {
      element.click();
      return document
        .querySelector('.bk-home')
        .getAnimations()
        .filter((animation) => !(animation instanceof CSSTransition || animation instanceof CSSAnimation))
        .map((animation) => animation.effect.getKeyframes().map((frame) => frame.opacity));
    });
    assert.deepEqual(fades, [['1', '0']]);
    await page.waitForURL(`**/${href}`);
    await page.goBack();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-home')).opacity === '1');
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
    const clipped = [];
    for (const [width, columns] of [
      [1440, '3'],
      [1440, '4'],
      [1440, '5'],
      [375, null],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      if (columns !== null) await page.getByRole('button', { name: columns, exact: true }).click();
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
      const outside = await page.locator(cardIn('category', '2026-07/attention/')).evaluate((card) => {
        const box = card.getBoundingClientRect();
        return ['.bk-card-cover', '.bk-card-title', '.bk-card-summary'].filter((selector) => {
          const element = card.querySelector(selector);
          const text = document.createRange();
          text.selectNodeContents(element);
          const rect = text.getBoundingClientRect();
          return element.scrollWidth > element.clientWidth || rect.left < box.left || rect.right > box.right;
        });
      });
      if (outside.length > 0) clipped.push(`${width}px with ${columns} columns: ${outside.join(', ')}`);
    }
    assert.deepEqual(clipped, []);
    const colors = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.bk-card')).backgroundColor]);
    assert.deepEqual(colors, ['rgb(17, 20, 19)', 'rgb(26, 30, 28)']);
    const pressedShadow = () => page.evaluate(() => getComputedStyle(document.querySelector('.bk-switch[data-control="group"] .bk-switch-options'), '::before').boxShadow);
    const darkShadow = await pressedShadow();
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '浅' }).click();
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 244)');
    assert.deepEqual(sharedShadowLayers(await pressedShadow(), darkShadow), [], 'the shadow of the chosen grouping follows dark mode');
    await context.close();
  });
});
