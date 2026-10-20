import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { serve } from './server.js';

const filler = (topic) => Array.from({ length: 4 }, (_, index) => `Paragraph ${index + 1} about ${topic}. ${'It fills the page so that the reader has to scroll. '.repeat(5)}`).join('\n\n');

const host = [
  filler('the introduction'),
  '',
  '## Links {#links}',
  '',
  'The [chain rule](/2026-10/target/#chain-rule) and [the local gradient](/2026-10/target/#local-grad) come from another article, the [home page](https://example.com/) does not [@k].',
  '',
  ':::embed',
  '/2026-10/target/#chain-rule',
  '/2026-10/target/#order',
  ':::',
  '',
  ':::references',
  '- [@k] The host entry.',
  ':::',
  '',
  filler('the end'),
  '',
].join('\n');

const target = [
  'The article that the host links to.',
  '',
  '## Chain rule {#chain-rule}',
  '',
  'Let $y = f(u)$ and $u = g(x)$, then',
  '',
  '$$',
  '\\frac{\\partial y}{\\partial x} = \\frac{\\partial y}{\\partial u} \\frac{\\partial u}{\\partial x} \\label{eq:chain}',
  '$$',
  '',
  'Each layer multiplies the gradient by its local derivative. ^local-grad',
  '',
  '## Order {#order}',
  '',
  'Visit the nodes in reverse topological order [@k].',
  '',
  ':::references',
  '- [@k] The target entry.',
  ':::',
  '',
].join('\n');

function recordCard() {
  window.cardLog = [];
  const card = document.querySelector('.bk-preview');
  new MutationObserver(() => cardLog.push({ on: card.classList.contains('is-on'), text: card.textContent, time: performance.now() })).observe(card, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
  window.pointerLog = [];
  for (const type of ['pointerover', 'pointerout']) {
    document.addEventListener(type, (event) => pointerLog.push({ type, target: event.target.closest('a')?.dataset.target ?? null, inCard: event.target.closest('.bk-preview') !== null, time: event.timeStamp }), true);
  }
}

const isOn = () => document.querySelector('.bk-preview')?.classList.contains('is-on') === true;

test('internal links, preview cards and embeds', async (t) => {
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/host/index.md': article({ title: 'Host', slug: 'host', body: host }),
    'content/posts/target/index.md': article({ title: 'Target', slug: 'target', body: target }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, dir);
  const url = `${base}/dist/2026-10/host/`;
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const desktop = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, document.getElementById('links').getBoundingClientRect().top + scrollY - 100));
    return page;
  };

  await t.test('a card appears 300 ms after the pointer rests on a link, below the link and inside the viewport', async () => {
    const page = await desktop();
    await page.evaluate(recordCard);
    const link = page.locator('a.internal-link[data-target="/2026-10/target/#chain-rule"]');
    await link.hover();
    await page.waitForFunction(isOn);
    const delay = await page.evaluate(() => {
      const over = pointerLog.find((entry) => entry.type === 'pointerover' && entry.target === '/2026-10/target/#chain-rule');
      return cardLog.find((entry) => entry.on).time - over.time;
    });
    assert.ok(delay >= 290, `the card showed ${delay} ms after the pointer reached the link`);
    const card = page.locator('.bk-preview');
    await page.waitForFunction(() => document.querySelector('.bk-preview').getAnimations().length === 0);
    assert.deepEqual(
      await card.evaluate((element) => [...element.querySelectorAll('.bk-preview-source, .bk-preview-title, .bk-preview-hint')].map((part) => part.textContent)),
      ['Target · 1', 'Chain rule', 'Click to open the original'],
    );
    const [box, anchor] = [await card.boundingBox(), await link.boundingBox()];
    assert.ok(box.y >= anchor.y + anchor.height, `the card starts at ${box.y}, the link ends at ${anchor.y + anchor.height}`);
    assert.ok(box.x >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900, `the card is outside the viewport: ${JSON.stringify(box)}`);
    const formulas = await card.evaluate((element) =>
      [...element.querySelectorAll('mjx-container')].map((container) => {
        const svg = container.querySelector('svg').getBoundingClientRect();
        const missing = [...container.querySelectorAll('use')].filter((use) => document.getElementById(use.getAttribute('xlink:href').slice(1)) === null).length;
        return { width: svg.width > 0, missing };
      }),
    );
    assert.equal(formulas.length, 3);
    assert.deepEqual(formulas.filter((formula) => !formula.width || formula.missing > 0), []);
    await page.close();
  });

  await t.test('the card switches to another link at once, stays while the pointer is in it and hides 200 ms after the pointer leaves', async () => {
    const page = await desktop();
    await page.hover('a.internal-link[data-target="/2026-10/target/#chain-rule"]');
    await page.waitForFunction(isOn);
    await page.evaluate(recordCard);
    await page.hover('a.internal-link[data-target="/2026-10/target/#local-grad"]');
    await page.waitForFunction(() => /Each layer multiplies/.test(document.querySelector('.bk-preview-body')?.textContent));
    const switched = await page.evaluate(() => {
      const over = pointerLog.find((entry) => entry.type === 'pointerover' && entry.target === '/2026-10/target/#local-grad');
      return cardLog.find((entry) => /Each layer multiplies/.test(entry.text)).time - over.time;
    });
    assert.ok(switched < 300, `the card switched ${switched} ms after the pointer reached the second link`);
    const box = await page.locator('.bk-preview').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(isOn), true, 'the card hides while the pointer is in it');
    await page.mouse.move(5, 450);
    await page.waitForFunction(() => !document.querySelector('.bk-preview').classList.contains('is-on'));
    const hidden = await page.evaluate(() => {
      const left = pointerLog.findLast((entry) => entry.type === 'pointerout' && entry.inCard);
      return cardLog.findLast((entry) => !entry.on).time - left.time;
    });
    assert.ok(hidden >= 190, `the card hid ${hidden} ms after the pointer left it`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-preview')).visibility === 'hidden');
    await page.hover('a[href="https://example.com/"]');
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(isOn), false, 'an external link shows a card');
    await page.close();
  });

  await t.test('a citation shows the entry of its own article, also inside an embed', async () => {
    const page = await desktop();
    const entries = [];
    for (const selector of ['.bk-block[data-type="paragraph"] a.citation', '.embed a.citation']) {
      await page.locator(selector).evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(100);
      await page.hover(selector);
      await page.waitForFunction(isOn);
      entries.push(await page.locator('.bk-preview').textContent());
      await page.mouse.move(5, 450);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-preview')).visibility === 'hidden');
    }
    assert.deepEqual(entries, ['[1]The host entry.', '[1]The target entry.']);
    await page.close();
  });

  await t.test('keyboard focus on an internal link shows its card and Escape hides it', async () => {
    const page = await desktop();
    await page.locator('#links .bk-heading-link').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.target), '/2026-10/target/#chain-rule');
    await page.waitForFunction(isOn);
    assert.equal(await page.locator('.bk-preview-title').textContent(), 'Chain rule');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => /Each layer multiplies/.test(document.querySelector('.bk-preview-body')?.textContent));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.bk-preview').classList.contains('is-on'));
    await page.close();
  });

  await t.test('a click on the card opens the target', async () => {
    const page = await desktop();
    await page.hover('a.internal-link[data-target="/2026-10/target/#chain-rule"]');
    await page.waitForFunction(isOn);
    await page.locator('.bk-preview-hint').click();
    await page.waitForURL(`${base}/dist/2026-10/target/#chain-rule`);
    await page.close();
  });

  await t.test('on a phone there is no card and a tap opens the target under the site sub-path', async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
    await page.goto(url);
    await page.locator('a.internal-link[data-target="/2026-10/target/#local-grad"]').tap();
    await page.waitForURL(`${base}/dist/2026-10/target/#local-grad`);
    assert.equal(await page.evaluate(() => document.querySelector('#local-grad').textContent), 'Each layer multiplies the gradient by its local derivative.');
    await page.goBack();
    await page.locator('a.internal-link[data-target="/2026-10/target/#chain-rule"]').hover();
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(isOn), false);
    await page.close();
  });

  await t.test('an embed shows each part with its formulas and a source line that links to the original', async () => {
    const page = await desktop();
    const report = await page.evaluate(() => {
      const embed = document.querySelector('.bk-block[data-type="embed"] .embed');
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      return {
        parts: [...embed.querySelectorAll('.embed-part')].map((part) => part.querySelector('h2').textContent),
        sources: [...embed.querySelectorAll('.embed-source a')].map((link) => {
          const cite = link.querySelector('cite');
          const content = (pseudo) => getComputedStyle(cite, pseudo).content;
          return `${content('::before')}${link.textContent}${content('::after')}${getComputedStyle(link, '::after').content}`;
        }),
        hrefs: [...embed.querySelectorAll('.embed-source a')].map((link) => link.href),
        formulas: [...embed.querySelectorAll('mjx-container')].filter((container) => container.querySelector('svg').getBoundingClientRect().width > 0).length,
        border: getComputedStyle(embed).borderLeftWidth,
        citations: [...embed.querySelectorAll('a.citation')].map((link) => link.getAttribute('href')),
        missingGlyphs: [...embed.querySelectorAll('use')].map((use) => use.getAttribute('xlink:href')).filter((href) => document.getElementById(href.slice(1)) === null),
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        toc: [...document.querySelectorAll('.bk-toc [data-target]')].map((entry) => entry.dataset.target),
      };
    });
    assert.deepEqual(report.parts, ['Chain rule', 'Order']);
    assert.deepEqual(report.citations, ['../../2026-10/target/#reference-k']);
    assert.deepEqual(report.sources, ['"From “"Target1"”""↗"', '"From “"Target2"”""↗"']);
    assert.deepEqual(report.hrefs, [`${base}/dist/2026-10/target/#chain-rule`, `${base}/dist/2026-10/target/#order`]);
    assert.equal(report.formulas, 3);
    assert.equal(report.border, '2px');
    assert.deepEqual(report.missingGlyphs, []);
    assert.deepEqual(report.duplicateIds, []);
    assert.deepEqual(report.toc, ['links']);
    await page.close();
  });
});
