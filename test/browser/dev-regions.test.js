import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { serve } from './server.js';

const page = (article, outside = '<header>Site</header>') => `<!doctype html><html><body>${outside}<article data-region="article">${article}</article><script data-bake-dev data-version="1"></script></body></html>`;

async function openRegions(t) {
  const origin = await serve(t, join(import.meta.dirname, '../../src/dev/client'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const tab = await browser.newPage();
  await tab.goto(`${origin}/regions.js`);
  return (run, ...args) => tab.evaluate(async ([body, args]) => new Function('regions', 'parse', 'args', `return (async () => { ${body} })()`)(await import('/regions.js'), (html) => new DOMParser().parseFromString(html, 'text/html'), args), [run, args]);
}

test('the region functions of the bake dev page script compare pages and plan in-place updates', async (t) => {
  const run = await openRegions(t);

  await t.test('the skeleton ignores region content and the dev script and sees every other change', async () => {
    const same = await run('return regions.skeleton(parse(args[0])) === regions.skeleton(parse(args[1]));', page('<p data-line="3">A</p>'), page('<p data-line="3">B</p>').replace('data-version="1"', 'data-version="2"'));
    assert.equal(same, true);
    const changed = await run('return regions.skeleton(parse(args[0])) === regions.skeleton(parse(args[1]));', page('<p data-line="3">A</p>'), page('<p data-line="3">A</p>', '<header>Other</header>'));
    assert.equal(changed, false);
  });

  await t.test('changed lines name the new block and not the blocks that only moved down', async () => {
    const lines = await run('return regions.changedLines(parse(args[0]), parse(args[1]));', page('<p data-line="3">A</p><p data-line="5">B</p>'), page('<p data-line="3">A</p><p data-line="5">New</p><p data-line="7">B</p>'));
    assert.deepEqual(lines, ['5']);
  });

  await t.test('the anchor follows a block to its new line and to the same occurrence of a repeated block', async () => {
    const before = page('<p data-line="3">Same</p><p data-line="5">Same</p>');
    const after = page('<p data-line="3">New</p><p data-line="5">Same</p><p data-line="7">Same</p>');
    assert.equal(await run('return regions.anchorFor(parse(args[0]), parse(args[1]), "5");', before, after), '7');
    assert.equal(await run('return regions.anchorFor(parse(args[0]), parse(args[1]), "9");', before, after), null);
  });

  await t.test('an update replaces only the changed node and skips nodes that a page script inserted', async () => {
    const plan = await run(
      `const old = parse(args[0]);
      const next = parse(args[1]);
      const live = parse(args[0]);
      const region = live.querySelector('[data-region]');
      const pageNodes = new Set(region.childNodes);
      region.prepend(live.createElement('nav'));
      const { changed, regions: planned } = regions.planUpdate(old, next, live, { isPageNode: (node) => pageNodes.has(node), shownParams: () => null });
      return { changed, regions: planned.map(({ steps, children }) => ({ children: children?.length, steps: steps?.map((step) => [step.live.outerHTML, step.next.outerHTML]) })) };`,
      page('<p data-line="3">A</p><p data-line="5">B</p>'),
      page('<p data-line="3">A</p><p data-line="5">C</p>'),
    );
    assert.deepEqual(plan, { changed: true, regions: [{ children: undefined, steps: [['<p data-line="5">B</p>', '<p data-line="5">C</p>']] }] });
  });

  await t.test('an update replaces every child of a region whose nodes do not line up', async () => {
    const plan = await run(
      `const { regions: planned } = regions.planUpdate(parse(args[0]), parse(args[1]), parse(args[0]), { isPageNode: () => true, shownParams: () => null });
      return planned.map(({ steps, children }) => ({ steps, children: children?.length }));`,
      page('<p data-line="3">A</p>'),
      page('<p data-line="3">A</p><p data-line="5">B</p>'),
    );
    assert.deepEqual(plan, [{ steps: undefined, children: 2 }]);
  });

  await t.test('a component frame whose new parameters equal the shown values is kept', async () => {
    const frame = (params) => `<figure class="component" data-component="a-b" data-line="3" data-params='${params}'><div class="component-box" style="height:1px"></div></figure>`;
    const plan = (shown) =>
      run(
        `const { regions: planned } = regions.planUpdate(parse(args[0]), parse(args[1]), parse(args[0]), { isPageNode: () => true, shownParams: () => args[2] });
        return planned[0].steps.map((step) => step.frame === undefined ? 'replaced' : step.params);`,
        page(frame('{"n":1}')),
        page(frame('{"n":2}')),
        shown,
      );
    assert.deepEqual(await plan({ n: 2 }), ['{"n":2}']);
    assert.deepEqual(await plan({ n: 1 }), ['replaced']);
    assert.deepEqual(await plan(null), ['replaced']);
  });

  await t.test('a line names the last heading above it or the introduction', async () => {
    const outline = [
      { line: 4, title: 'First' },
      { line: 9, title: 'Second' },
    ];
    assert.deepEqual(await run('return [2, 4, 12].map((line) => regions.sectionOf(args[0], line));', outline), ['the introduction', 'First', 'Second']);
  });
});
