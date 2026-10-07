import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { serveExample } from '../scripts/example-server.js';
import { glyphsOf } from '../src/client/math-defs.js';
import { render } from '../src/render/index.js';

let server;
let browser;

before(async () => {
  server = await serveExample();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open() {
  const page = await browser.newPage();
  await page.goto(server.origin + server.pages.features);
  await page.evaluate(async () => {
    window.mathDefs = await import('/src/client/math-defs.js');
  });
  return page;
}

test('glyphsOf 读出 mathDefs 中的每个字形', async () => {
  const { mathDefs } = await render('---\ntitle: t\nslug: t\n---\n\n$x+y$\n', { path: 'content/t.md' });
  const glyphs = glyphsOf(mathDefs);
  const ids = [...mathDefs.matchAll(/<path id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  assert.deepEqual(Object.keys(glyphs), ids);
  for (const [id, d] of Object.entries(glyphs)) assert.ok(mathDefs.includes(`<path id="${id}" d="${d}">`));
  assert.deepEqual(glyphsOf(''), {});
});

test('addGlyphs 加入新字形，已有的 id 不重复加入，不删除已有字形', async () => {
  const page = await open();
  const result = await page.evaluate(() => {
    const container = document.getElementById('math-defs');
    const before = [...container.querySelectorAll('path')].map((path) => path.id);
    const existing = before[0];
    const existingD = document.getElementById(existing).getAttribute('d');
    window.mathDefs.addGlyphs({ [existing]: 'M0 0', 'test-glyph': 'M1 1' });
    const after = [...container.querySelectorAll('path')].map((path) => path.id);
    return {
      containers: document.querySelectorAll('#math-defs').length,
      added: after.filter((id) => !before.includes(id)),
      kept: before.every((id) => after.includes(id)),
      duplicates: after.length - new Set(after).size,
      existingD: document.getElementById(existing).getAttribute('d') === existingD,
      newD: document.getElementById('test-glyph').getAttribute('d'),
      inDefs: document.getElementById('test-glyph').parentElement.tagName,
    };
  });
  assert.deepEqual(result, { containers: 1, added: ['test-glyph'], kept: true, duplicates: 0, existingD: true, newD: 'M1 1', inDefs: 'defs' });
  await page.close();
});

test('容器不存在时在 <body> 开头创建', async () => {
  const page = await open();
  const result = await page.evaluate(() => {
    document.getElementById('math-defs').remove();
    window.mathDefs.addGlyphs({ a: 'M0 0' });
    window.mathDefs.addGlyphs({ b: 'M1 1' });
    const container = document.getElementById('math-defs');
    return {
      first: document.body.firstElementChild === container,
      namespace: container.namespaceURI,
      hidden: getComputedStyle(container).display,
      paths: [...container.querySelectorAll('defs > path')].map((path) => [path.id, path.getAttribute('d'), path.namespaceURI]),
      containers: document.querySelectorAll('#math-defs').length,
    };
  });
  const svg = 'http://www.w3.org/2000/svg';
  assert.deepEqual(result, {
    first: true,
    namespace: svg,
    hidden: 'none',
    paths: [
      ['a', 'M0 0', svg],
      ['b', 'M1 1', svg],
    ],
    containers: 1,
  });
  await page.close();
});

test('<use> 引用的字形在之后加入时公式显示', async () => {
  const page = await open();
  const width = await page.evaluate(async () => {
    const formula = document.querySelector('.math svg');
    const ids = [...formula.querySelectorAll('use')].map((use) => use.getAttribute('href').slice(1));
    const glyphs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getAttribute('d')]));
    const copy = formula.cloneNode(true);
    for (const use of copy.querySelectorAll('use')) use.setAttribute('href', `${use.getAttribute('href')}-copy`);
    document.querySelector('article').append(copy);
    window.mathDefs.addGlyphs(Object.fromEntries(Object.entries(glyphs).map(([id, d]) => [`${id}-copy`, d])));
    await new Promise(requestAnimationFrame);
    return copy.getBBox().width;
  });
  assert.ok(width > 0);
  await page.close();
});
