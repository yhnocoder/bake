import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openEditor, saveAfter, startSite } from './setup.js';

let site;

before(async () => {
  site = await startSite('formulas');
});

after(async () => {
  await site.close();
});

test('打开编辑器时使用页面上的公式，修改一个公式后只渲染这一个，新字形加入页面', async () => {
  const { page, errors } = await openEditor(site, '/features/');
  const mathjaxRequests = [];
  page.on('request', (request) => {
    if (/mathjax|src\/math\/browser\.js/i.test(request.url())) mathjaxRequests.push(request.url());
  });
  const formulas = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('.milkdown .math svg')];
    window.loadedFormulas = new Set(elements);
    return elements.length;
  });
  assert.ok(formulas > 5);
  const glyphsBefore = await page.evaluate(() => [...document.querySelectorAll('svg defs path[id^="MJX-"]')].map((path) => path.id));
  await page.waitForTimeout(500);
  assert.deepEqual(mathjaxRequests, []);

  await saveAfter(site, page, 'content/features.md', async () => {
    await page.click('.milkdown .math[data-tex="x \\\\in \\\\R^n"]');
    await page.fill('.bake-math-input', 'x \\in \\R^m \\otimes \\aleph');
    await page.keyboard.press('Enter');
  });
  await page.waitForSelector('.milkdown .math[data-tex="x \\\\in \\\\R^m \\\\otimes \\\\aleph"] svg');
  await site.screenshot(page, 'changed');
  assert.ok(mathjaxRequests.length > 0);
  const after = await page.evaluate(() => ({
    reused: [...document.querySelectorAll('.milkdown .math svg')].filter((svg) => window.loadedFormulas.has(svg)).length,
    lost: [...document.querySelectorAll('.milkdown .math')]
      .filter((m) => m.querySelector('svg') && !window.loadedFormulas.has(m.querySelector('svg')))
      .map((m) => m.dataset.tex),
    changed: document.querySelector('.milkdown .math[data-tex="x \\\\in \\\\R^m \\\\otimes \\\\aleph"] svg')?.outerHTML ?? null,
    glyphs: [...document.querySelectorAll('svg defs path[id^="MJX-"]')].map((path) => path.id),
  }));
  assert.deepEqual(after.lost, ['x \\in \\R^m \\otimes \\aleph']);
  assert.equal(after.reused, formulas - 1);
  assert.match(after.changed, /<use [^>]*href="#MJX-/);
  for (const id of glyphsBefore) assert.ok(after.glyphs.includes(id), id);
  assert.ok(after.glyphs.length > glyphsBefore.length);
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('.milkdown .math use')].map((use) => use.getAttribute('href').slice(1)).filter((id) => !document.getElementById(id)),
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(errors, []);
});
