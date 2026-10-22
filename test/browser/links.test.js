import assert from 'node:assert/strict';
import { serveStatic } from '../../scripts/static-server.js';
import { article, filler, validConfig } from '../blog.js';
import { test as base } from './browser.js';

// why: serving the blog folder puts the published site under the sub-path /dist/, as a project site on GitHub Pages is
const test = base.extend({
  baseURL: async ({ site }, use) => {
    const server = await serveStatic(site.dir);
    await use(`${server.origin}/dist/`);
    await server.close();
  },
});


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
  new MutationObserver(() => cardLog.push({ on: card.getAttribute('aria-hidden') === 'false', text: card.textContent, time: performance.now() })).observe(card, {
    attributes: true,
    attributeFilter: ['aria-hidden'],
    childList: true,
    subtree: true,
  });
  window.pointerLog = [];
  for (const type of ['pointerover', 'pointerout']) {
    document.addEventListener(type, (event) => pointerLog.push({ type, target: event.target.closest('a')?.textContent ?? null, inCard: event.target.closest('.bk-preview') !== null, time: event.timeStamp }), true);
  }
}

const isOn = () => document.querySelector('.bk-preview')?.getAttribute('aria-hidden') === 'false';

test.describe('internal links, preview cards and embeds', () => {
  test.use({
    blog: {
      example: false,
      files: {
        'bake.config.js': validConfig,
        'content/posts/host/index.md': article({ title: 'Host', slug: 'host', body: host }),
        'content/posts/target/index.md': article({ title: 'Target', slug: 'target', body: target }),
      },
    },
  });
  const url = '2026-10/host/';

  const desktop = async (page, { clock = false } = {}) => {
    if (clock) await page.clock.install();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, document.getElementById('links').getBoundingClientRect().top + scrollY - 100));
  };

  test('a card appears 300 ms after the pointer rests on a link, below the link and inside the viewport', async ({ page }) => {
    await desktop(page);
    await page.evaluate(recordCard);
    const link = page.getByRole('link', { name: 'chain rule', exact: true });
    await link.hover();
    await page.waitForFunction(isOn);
    const delay = await page.evaluate(() => {
      const over = pointerLog.find((entry) => entry.type === 'pointerover' && entry.target === 'chain rule');
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
  });

  test('the card switches to another link at once and hides 200 ms after the pointer leaves', async ({ page }) => {
    await desktop(page);
    await page.getByRole('link', { name: 'chain rule', exact: true }).hover();
    await page.waitForFunction(isOn);
    await page.evaluate(recordCard);
    await page.getByRole('link', { name: 'the local gradient' }).hover();
    await page.waitForFunction(() => /Each layer multiplies/.test(document.querySelector('.bk-preview-body')?.textContent));
    const switched = await page.evaluate(() => {
      const over = pointerLog.find((entry) => entry.type === 'pointerover' && entry.target === 'the local gradient');
      return cardLog.find((entry) => /Each layer multiplies/.test(entry.text)).time - over.time;
    });
    assert.ok(switched < 300, `the card switched ${switched} ms after the pointer reached the second link`);
    const box = await page.locator('.bk-preview').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(5, 450);
    await page.waitForFunction(() => document.querySelector('.bk-preview').getAttribute('aria-hidden') === 'true');
    const hidden = await page.evaluate(() => {
      const left = pointerLog.findLast((entry) => entry.type === 'pointerout' && entry.inCard);
      return cardLog.findLast((entry) => !entry.on).time - left.time;
    });
    assert.ok(hidden >= 190, `the card hid ${hidden} ms after the pointer left it`);
  });

  test('the card stays while the pointer is in it, and an external link shows no card', async ({ page }) => {
    await desktop(page, { clock: true });
    await page.getByRole('link', { name: 'chain rule', exact: true }).hover();
    await page.clock.runFor(400);
    await page.waitForFunction(isOn);
    const box = await page.locator('.bk-preview').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(isOn), true, 'the card hides while the pointer is in it');
    await page.mouse.move(5, 450);
    await page.clock.runFor(1000);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-preview')).visibility === 'hidden');
    await page.hover('a[href="https://example.com/"]');
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(isOn), false, 'an external link shows a card');
  });

  test('a citation shows the entry of its own article, also inside an embed', async ({ page }) => {
    await desktop(page);
    const entries = [];
    for (const citation of [page.locator('a.citation').first(), page.locator('.embed a.citation')]) {
      await citation.evaluate(async (element) => {
        element.scrollIntoView({ block: 'center' });
        for (let frame = 0; frame < 2; frame += 1) await new Promise((done) => requestAnimationFrame(done));
      });
      await citation.hover();
      await page.waitForFunction(isOn);
      entries.push(await page.locator('.bk-preview').textContent());
      await page.mouse.move(5, 450);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-preview')).visibility === 'hidden');
    }
    assert.deepEqual(entries, ['[1]The host entry.', '[1]The target entry.']);
  });

  test('keyboard focus on an internal link shows its card and Escape hides it', async ({ page }) => {
    await desktop(page);
    await page.locator('#links .bk-heading-link').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'chain rule');
    await page.waitForFunction(isOn);
    assert.equal(await page.locator('.bk-preview-title').textContent(), 'Chain rule');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => /Each layer multiplies/.test(document.querySelector('.bk-preview-body')?.textContent));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.bk-preview').getAttribute('aria-hidden') === 'true');
  });

  test('a click on the card opens the target', async ({ page, baseURL }) => {
    await desktop(page);
    await page.getByRole('link', { name: 'chain rule', exact: true }).hover();
    await page.waitForFunction(isOn);
    await page.locator('.bk-preview-hint').click();
    await page.waitForURL(`${baseURL}2026-10/target/#chain-rule`);
  });

  test('on a phone there is no card and a tap opens the target under the site sub-path', async ({ browser, baseURL }) => {
    const page = await browser.newPage({ baseURL, viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
    await page.clock.install();
    await page.goto(url);
    await page.getByRole('link', { name: 'the local gradient' }).tap();
    await page.waitForURL(`${baseURL}2026-10/target/#local-grad`);
    assert.equal(await page.evaluate(() => document.querySelector('#local-grad').textContent), 'Each layer multiplies the gradient by its local derivative.');
    await page.goBack();
    await page.getByRole('link', { name: 'chain rule', exact: true }).hover();
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(isOn), false);
  });

  test('an embed shows each part with its formulas and a source line that links to the original', async ({ page, baseURL }) => {
    await desktop(page);
    const report = await page.evaluate(() => {
      const embed = document.querySelector('.embed');
      return {
        parts: [...embed.querySelectorAll('.embed-part')].map((part) => part.querySelector('h2').textContent),
        sources: [...embed.querySelectorAll('.embed-source a')].map((link) => {
          const cite = link.querySelector('cite');
          const content = (pseudo) => getComputedStyle(cite, pseudo).content;
          return `${content('::before')}${link.textContent}${content('::after')}${getComputedStyle(link, '::after').content}`;
        }),
        hrefs: [...embed.querySelectorAll('.embed-source a')].map((link) => link.href),
        formulas: [...embed.querySelectorAll('mjx-container')].filter((container) => container.querySelector('svg').getBoundingClientRect().width > 0).length,
      };
    });
    assert.deepEqual(report.parts, ['Chain rule', 'Order']);
    assert.deepEqual(report.sources, ['"From “"Target1"”""↗"', '"From “"Target2"”""↗"']);
    assert.deepEqual(report.hrefs, [`${baseURL}2026-10/target/#chain-rule`, `${baseURL}2026-10/target/#order`]);
    assert.equal(report.formulas, 3);
  });
});
