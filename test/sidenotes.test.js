import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { serveExample } from '../scripts/example-server.js';

let server;
let browser;

before(async () => {
  server = await serveExample();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(width, errors = []) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(server.origin + server.pages.features);
  return page;
}

function aligned() {
  const article = document.querySelector('article');
  const articleRight = article.getBoundingClientRect().right;
  let previous = null;
  return [...article.querySelectorAll('.sidenote')].every((note) => {
    let anchor = note.previousElementSibling;
    while (anchor.classList.contains('sidenote')) anchor = anchor.previousElementSibling;
    if (!note.classList.contains('unnumbered')) anchor = document.getElementById(`sn-ref-${note.id.slice(3)}`);
    const box = note.getBoundingClientRect();
    const anchorTop = anchor.getBoundingClientRect().top;
    const atAnchor = Math.abs(box.top - anchorTop) < 1;
    const belowPrevious = previous !== null && box.top > anchorTop && Math.abs(box.top - previous.bottom - 12) < 1;
    previous = box;
    return box.left > articleRight && (atAnchor || belowPrevious);
  });
}

describe('旁注脚本', () => {
  test('1440px 下注释与编号所在行对齐，放不下时位于上一条注释下方 12px', async () => {
    const errors = [];
    const page = await open(1440, errors);
    await page.waitForFunction(aligned);
    const pushed = await page.evaluate(() => {
      const first = document.getElementById('sn-1').getBoundingClientRect();
      const second = document.getElementById('sn-2').getBoundingClientRect();
      return second.top - first.bottom;
    });
    assert.ok(Math.abs(pushed - 12) < 1, `second note is ${pushed}px below the first`);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('<details> 展开后重新对齐', async () => {
    const page = await open(1440);
    await page.waitForFunction(aligned);
    const before = await page.evaluate(() => document.getElementById('sn-1').getBoundingClientRect().top + window.scrollY);
    await page.click('details.fold > summary');
    await page.waitForFunction((top) => document.getElementById('sn-1').getBoundingClientRect().top + window.scrollY > top + 10, before);
    await page.waitForFunction(aligned);
    await page.close();
  });

  test('悬停注释时高亮被注释的内容，悬停编号时注释加 active', async () => {
    const page = await open(1440);
    await page.waitForFunction(aligned);
    const highlighted = () => [...(CSS.highlights.get('sidenote') ?? [])].map((range) => range.toString());
    await page.hover('#sn-1');
    const paragraph = await page.evaluate(() => document.getElementById('sn-ref-1').closest('p').textContent);
    assert.deepEqual(await page.evaluate(highlighted), [paragraph]);
    await page.hover('#sn-2');
    assert.deepEqual(await page.evaluate(highlighted), ['激活函数的导数']);
    await page.hover('h1');
    assert.deepEqual(await page.evaluate(highlighted), []);
    await page.hover('#sn-ref-2 a');
    assert.deepEqual(await page.$$eval('.sidenote.active', (notes) => notes.map((note) => note.id)), ['sn-2']);
    await page.hover('h1');
    assert.deepEqual(await page.$$eval('.sidenote.active', (notes) => notes.map((note) => note.id)), []);
    await page.close();
  });

  test('1100px 以下注释显示在所在段落之后', async () => {
    const page = await open(1000);
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll('article .sidenote')].map((note) => ({
        position: getComputedStyle(note).position,
        belowParagraph: note.getBoundingClientRect().top >= note.previousElementSibling.getBoundingClientRect().bottom,
        smaller: parseFloat(getComputedStyle(note).fontSize) < parseFloat(getComputedStyle(note.previousElementSibling).fontSize),
      })),
    );
    assert.equal(layout.length, 3);
    for (const note of layout) assert.deepEqual(note, { position: 'static', belowParagraph: true, smaller: true });
    await page.close();
  });
});
