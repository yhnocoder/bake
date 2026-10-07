import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { format } from '../../src/format/index.js';
import { openEditor, placeCursor, startSite } from '../editor/setup.js';
import { articleBody, clipboardContent, emptyArticle, openEmptyArticle, selectBetween, waitForSave } from './setup.js';

const features = 'content/features.md';
const original = readFileSync(join(import.meta.dirname, '..', '..', 'examples/minimal', features), 'utf8');
const sample = [
  '第一段，含 **加粗** 和 *斜体*。',
  '',
  '第二段含 :span[标记文字][^m] 和 $a+b$ 的段落。',
  '',
  '[^m]: 注释内容 $c$。',
  '',
  '| 函数 | 导数 |',
  '| - | - |',
  '| ReLU | 1 |',
  '| GELU | 0.5 |',
  '',
  '最后一段。',
  '',
].join('\n');
let site;

before(async () => {
  site = await startSite('copy-paste-editor');
});

after(async () => {
  await site.close();
});

async function copied(name, page) {
  await page.keyboard.press('Control+c');
  const content = await clipboardContent(page);
  site.record(`${name}.txt`, `${content.text}\n\n${content.html}\n`);
  await site.screenshot(page, name);
  return content;
}

async function cellBox(page, text) {
  return page.evaluate((text) => {
    const cell = [...document.querySelectorAll('.milkdown td, .milkdown th')].find((element) => element.textContent === text);
    cell.scrollIntoView({ block: 'center' });
    const box = cell.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, text);
}

describe('编辑器复制的纯文本是 Markdown', () => {
  let page;
  let errors;

  before(async () => {
    ({ page, errors } = await openEmptyArticle(site, sample));
  });

  after(async () => {
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('段落内部分文字', async () => {
    await selectBetween(page, '加粗', '斜体');
    const { text, html } = await copied('editor-copy-partial', page);
    assert.equal(text, '**加粗** 和 *斜体*');
    assert.match(html, /^<div data-bake-markdown="">/);
  });

  test('跨段落', async () => {
    await selectBetween(page, '加粗', '第二段含');
    const { text } = await copied('editor-copy-paragraphs', page);
    assert.equal(text, '**加粗** 和 *斜体*。\n\n第二段含');
  });

  test('表格单元格内', async () => {
    await selectBetween(page, 'ReL', 'ReL');
    const { text } = await copied('editor-copy-cell', page);
    assert.equal(text, 'ReL');
  });

  test('跨单元格', async () => {
    await placeCursor(page, '最后一段。');
    const from = await cellBox(page, 'ReLU');
    const to = await cellBox(page, '0.5');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => document.querySelectorAll('.milkdown .selectedCell').length), 4);
    const { text } = await copied('editor-copy-cells', page);
    assert.equal(text, '| ReLU | 1 |\n| - | - |\n| GELU | 0.5 |');
  });

  test('带旁注引用的段落带上注释', async () => {
    await selectBetween(page, '第二段含', '的段落。');
    const { text, html } = await copied('editor-copy-sidenote', page);
    assert.equal(text, '第二段含 :span[标记文字][^m] 和 $a+b$ 的段落。\n\n[^m]: 注释内容 $c$。');
    assert.match(html, /^<div data-bake-markdown="">/);
  });

});

describe('编辑器内复制粘贴', () => {
  test('行内公式和 :span 在复制粘贴后不丢失', async () => {
    const { page, errors } = await openEmptyArticle(site, sample);
    await selectBetween(page, '第二段含', '的段落。');
    await page.keyboard.press('Control+c');
    await placeCursor(page, '最后一段。');
    await page.keyboard.press('Enter');
    await waitForSave(page, () => page.keyboard.press('Control+v'));
    await site.screenshot(page, 'editor-paste-formula-span');
    const body = articleBody(site.read(emptyArticle.path));
    site.record('editor-paste-formula-span.md', body);
    assert.equal(body, `${sample}\n第二段含 :span[标记文字][^n1] 和 $a+b$ 的段落。\n\n[^n1]: 注释内容 $c$。\n`);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('粘贴内容中的 id 和旁注名', () => {
  async function openFeatures() {
    site.write(features, original);
    const opened = await openEditor(site, '/features/');
    await opened.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
    return opened;
  }

  async function pasteAfter(page, anchor) {
    await placeCursor(page, anchor);
    await page.keyboard.press('Enter');
    await waitForSave(page, () => page.keyboard.press('Control+v'));
  }

  test('复制带旁注的段落再粘贴，新旁注名为 n1', async () => {
    const { page, errors } = await openFeatures();
    await selectBetween(page, '每一层的梯度都由', '再按顺序连乘起来。');
    await page.keyboard.press('Control+c');
    await pasteAfter(page, '进入下一轮前向传播。');
    await site.screenshot(page, 'paste-sidenote');
    const file = site.read(features);
    assert.ok(file.includes('进入下一轮前向传播。\n\n每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到[^n1]。局部导数只依赖本层的输入和输出，所以每一层可以独立计算，再按顺序连乘起来。\n\n[^n1]: 局部导数是本层输出对本层输入的导数 $\\partial y / \\partial x$。\n\n    注释可以有多段，后面的段落缩进四个空格。\n'), file);
    assert.ok(file.includes('得到[^d]。'));
    assert.equal(format(file), file);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('复制带 ^block-id 的段落再粘贴，新段落没有 id', async () => {
    const { page, errors } = await openFeatures();
    await selectBetween(page, '链式法则把复合函数', '各层导数的乘积。');
    await page.keyboard.press('Control+c');
    await pasteAfter(page, '第二行。');
    const file = site.read(features);
    site.record('paste-block-id.md', file);
    assert.ok(file.includes('链式法则把复合函数的导数写成各层导数的乘积。 ^chain-rule-def\n'));
    assert.ok(file.includes('第二行。\n\n链式法则把复合函数的导数写成各层导数的乘积。\n\n---'), file);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('剪切后粘贴，id 保留', async () => {
    const { page, errors } = await openFeatures();
    await selectBetween(page, '这里用到的是', '各层导数的乘积。', { afterStart: true });
    await waitForSave(page, () => page.keyboard.press('Control+x'));
    assert.ok(site.read(features).includes('## 站内引用 {#links}\n\n这里用到的是\n\n## 列表与代码'));
    await pasteAfter(page, '第二行。');
    const file = site.read(features);
    site.record('cut-block-id.md', file);
    assert.ok(file.includes('第二行。\n\n[链式法则](/features#chain-rule)。\n\n链式法则把复合函数的导数写成各层导数的乘积。 ^chain-rule-def\n'), file);
    assert.equal(file.match(/\^chain-rule-def/g).length, 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
