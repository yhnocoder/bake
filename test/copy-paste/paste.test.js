import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import sharp from 'sharp';
import { placeCursor, startSite } from '../editor/setup.js';
import { articleBody, dispatchClipboard, emptyArticle, focusEditor, openEmptyArticle, selectBetween, statusMessage, waitForSave } from './setup.js';

let site;
let red;
let blue;
let green;

before(async () => {
  site = await startSite('copy-paste-paste');
  red = (await sharp({ create: { width: 4, height: 4, channels: 3, background: '#e00' } }).png().toBuffer()).toString('base64');
  blue = (await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00e' } }).png().toBuffer()).toString('base64');
  green = (await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0e0' } }).png().toBuffer()).toString('base64');
});

after(async () => {
  await site.close();
});

function body() {
  return articleBody(site.read(emptyArticle.path));
}

function assets() {
  return readdirSync(join(site.root, 'content/assets')).sort();
}

function pngFile(base64) {
  return { name: 'image.png', type: 'image/png', base64 };
}

async function pasteInto(name, initial, data, { place } = {}) {
  const { page, errors } = await openEmptyArticle(site, initial);
  if (place) await place(page);
  else await focusEditor(page);
  await waitForSave(page, () => dispatchClipboard(page, data));
  await site.screenshot(page, name);
  site.record(`${name}.md`, body());
  assert.deepEqual(errors, []);
  return page;
}

async function plainPasteInto(name, initial, data, options) {
  const page = await pasteInto(name, initial, data, options);
  await page.close();
  return body();
}

describe('处理顺序', () => {
  test('1. 光标在代码块里时按纯文本插入', async () => {
    const result = await plainPasteInto('rule-code-block', '```js\nlet a\n```\n', { types: { 'text/plain': '# 标题', 'text/html': '<h1>标题</h1>' } }, { place: (page) => selectBetween(page, 'let a', 'let a', { afterStart: true }) });
    assert.equal(result, '```js\nlet a# 标题\n```\n');
  });

  test('2. Mod-Shift-V 插入原文文字', async () => {
    const { page, errors } = await openEmptyArticle(site);
    await focusEditor(page);
    await page.evaluate(() => navigator.clipboard.writeText('# 标题\n\n- 第一项'));
    await waitForSave(page, () => page.keyboard.press('Control+Shift+V'));
    await site.screenshot(page, 'rule-plain-shortcut');
    assert.equal(body(), '\\# 标题\n\n\\- 第一项\n');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('3. 只有图片文件时保存图片并插入', async () => {
    const before = assets();
    const result = await plainPasteInto('rule-image', '', { files: [pngFile(red)] });
    const added = assets().filter((name) => !before.includes(name));
    assert.equal(added.length, 1);
    assert.match(added[0], /^[0-9a-f]{8}\.png$/);
    assert.equal(result, `![](./assets/${added[0]})\n`);
  });

  test('3. HTML 中只有 img 元素时按图片处理', async () => {
    const result = await plainPasteInto('rule-image-html', '', { types: { 'text/html': '<meta charset="utf-8"><img src="https://example.com/a.png">' }, files: [pngFile(blue)] });
    assert.match(result, /^!\[\]\(\.\/assets\/[0-9a-f]{8}\.png\)\n$/);
  });

  test('3. HTML 中有文字时按 HTML 处理，图片文件忽略', async () => {
    const result = await plainPasteInto('rule-image-table', '', { types: { 'text/html': '<table><tr><td>甲</td><td>乙</td></tr></table>', 'text/plain': '甲\t乙' }, files: [pngFile(red)] });
    assert.equal(result, '| | |\n| - | - |\n| 甲 | 乙 |\n');
  });

  test('4. data-bake-markdown 标记时使用纯文本', async () => {
    const result = await plainPasteInto('rule-marker', '', { types: { 'text/html': '<div data-bake-markdown><p>HTML 中的文字</p></div>', 'text/plain': '**粗体** 与 $x^2$' } });
    assert.equal(result, '**粗体** 与 $x^2$\n');
  });

  for (const component of [':::demo-plot{x0=1.2}\n从 $x_0$ 出发。\n:::', '::demo-plot{x0=0.5}']) {
    test(`4. 粘贴进空段落的组件保持完整：${component.split('\n')[0]}`, async () => {
      const result = await plainPasteInto('rule-marker-component', '', { types: { 'text/html': '<div data-bake-markdown></div>', 'text/plain': component } });
      assert.equal(result, `${component}\n`);
    });
  }

  test('5. SVG 源码先于 vscode-editor-data，存成 .svg', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="6"/></svg>\n';
    const result = await plainPasteInto('rule-svg', '', { types: { 'text/plain': svg, 'vscode-editor-data': JSON.stringify({ mode: 'xml' }) } });
    const [, file] = /^!\[\]\(\.\/assets\/([0-9a-f]{8}\.svg)\)\n$/.exec(result);
    assert.equal(site.read(`content/assets/${file}`), svg.trim());
  });

  test('5. 解析出错的 SVG 源码不按图片处理', async () => {
    const result = await plainPasteInto('rule-svg-invalid', '', { types: { 'text/plain': '<svg <rect' } });
    assert.equal(result, '\\<svg \\<rect\n');
  });

  test('6. vscode-editor-data 插入带语言名的代码块', async () => {
    const result = await plainPasteInto('rule-vscode', '', { types: { 'text/plain': 'def f():\n    return 1\n', 'text/html': '<div><span>def</span> f():</div>', 'vscode-editor-data': JSON.stringify({ version: 1, isFromEmptySelection: false, multicursorText: null, mode: 'python' }) } });
    assert.equal(result, '```python\ndef f():\n    return 1\n```\n');
  });

  test('6. vscode-editor-data 的 mode 为 markdown 时按 Markdown 文本处理', async () => {
    const result = await plainPasteInto('rule-vscode-markdown', '', { types: { 'text/plain': '## 标题\n\n- 项目\n', 'text/html': '<div><span>## 标题</span></div>', 'vscode-editor-data': JSON.stringify({ mode: 'markdown' }) } });
    assert.equal(result, '## 标题\n\n- 项目\n');
  });

  test('6. vscode-editor-data 的 mode 为 plaintext 时按纯文本插入', async () => {
    const result = await plainPasteInto('rule-vscode-plaintext', '', { types: { 'text/plain': '# 不是标题', 'text/html': '<div><span># 不是标题</span></div>', 'vscode-editor-data': JSON.stringify({ mode: 'plaintext' }) } });
    assert.equal(result, '\\# 不是标题\n');
  });

  test('7. HTML 转换成 Markdown', async () => {
    const html = '<h2>标题</h2><p><b>粗</b>与<i>斜</i>，<a href="https://example.com/">链接</a><img src="https://example.com/a.png"></p><ul><li>一</li><li>二</li></ul><pre><code class="language-js">let a = 1;\n</code></pre><script>alert(1)</script>';
    const result = await plainPasteInto('rule-html', '', { types: { 'text/html': html, 'text/plain': '标题' } });
    assert.equal(result, '## 标题\n\n**粗**与*斜*，[链接](https://example.com/)\n\n- 一\n- 二\n\n```js\nlet a = 1;\n```\n');
  });

  test('7. 网页公式转成 bake 公式', async () => {
    const html = [
      '<p>页面 <span class="math" data-tex="a+b"><svg></svg></span>',
      ' KaTeX <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>c</mi></mrow><annotation encoding="application/x-tex">c^2</annotation></semantics></math></span><span class="katex-html">c2</span></span>',
      ' MathJax <mjx-container><mjx-math data-latex="d_1"></mjx-math><mjx-assistive-mml><math><mi>d</mi></math></mjx-assistive-mml></mjx-container>',
      ' MathML <math alttext="{\\displaystyle e}"><mi>e</mi></math>',
      ' 没有源码 <math><mi>f</mi></math></p>',
      '<div class="math display" data-tex="\\sum_i x_i\n% 注释"><svg></svg></div>',
    ].join('');
    const result = await plainPasteInto('rule-formulas', '', { types: { 'text/html': html, 'text/plain': '公式' } });
    assert.equal(result, '页面 $a+b$ KaTeX $c^2$ MathJax $d_1$ MathML ${\\displaystyle e}$ 没有源码 f\n\n$$\n\\sum_i x_i\n% 注释\n$$\n');
  });

  test('8. 纯文本有块级写法时按 Markdown 插入', async () => {
    const result = await plainPasteInto('rule-markdown', '', { types: { 'text/plain': '## 标题\n\n正文 **加粗**。' } });
    assert.equal(result, '## 标题\n\n正文 **加粗**。\n');
  });

  test('9. 纯文本没有块级写法时按普通文本插入', async () => {
    const result = await plainPasteInto('rule-text', '', { types: { 'text/plain': '正文 **加粗**' } });
    assert.equal(result, '正文 \\*\\*加粗\\*\\*\n');
  });
});

describe('块级写法的判断', () => {
  const markdown = [
    ['标题', '# 一级标题\n'],
    ['列表', '- 第一项\n- 第二项\n'],
    ['表格', '| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n'],
    ['围栏代码块', '```js\nlet a = 1;\n```\n'],
    ['公式块', '$$\nx^2\n$$\n'],
  ];
  for (const [name, text] of markdown) {
    test(`${name}按 Markdown 插入`, async () => {
      assert.equal(await plainPasteInto(`block-${name}`, '', { types: { 'text/plain': text } }), text);
    });
  }

  test('只有加粗的文字按普通文本插入', async () => {
    assert.equal(await plainPasteInto('block-bold', '', { types: { 'text/plain': '**加粗**' } }), '\\*\\*加粗\\*\\*\n');
  });

  test('缩进四个空格的文字按普通文本插入', async () => {
    const result = await plainPasteInto('block-indented', '', { types: { 'text/plain': '    缩进的文字' } });
    assert.doesNotMatch(result, /```/);
    assert.match(result, /^\S.*缩进的文字\n$/);
  });
});

describe('结构错误', () => {
  test('卡片网格中直接写段落时按纯文本插入并提示', async () => {
    const { page, errors } = await openEmptyArticle(site);
    await focusEditor(page);
    await waitForSave(page, () => dispatchClipboard(page, { types: { 'text/plain': '::::bento\n网格中的段落\n::::\n\n## 标题\n' } }));
    assert.equal(await statusMessage(page), '粘贴的内容不符合结构规则，已按纯文本插入');
    await site.screenshot(page, 'structure-error');
    assert.equal(body(), ':::\\:bento\n\n网格中的段落\n\n:::\\:\n\n\\## 标题\n');
    await waitForSave(page, () => page.keyboard.type('继续输入'));
    assert.equal(body(), ':::\\:bento\n\n网格中的段落\n\n:::\\:\n\n\\## 标题继续输入\n');
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('图片', () => {
  test('同一张图片粘贴两次只写一个文件，图片独占一段', async () => {
    const before = assets();
    const { page, errors } = await openEmptyArticle(site, '前面的文字后面的文字\n');
    await placeCursor(page, '前面的文字');
    await waitForSave(page, () => dispatchClipboard(page, { files: [pngFile(green)] }));
    await waitForSave(page, () => dispatchClipboard(page, { files: [pngFile(green)] }));
    await site.screenshot(page, 'image-twice');
    const added = assets().filter((name) => !before.includes(name));
    assert.equal(added.length, 1);
    const [file] = added;
    assert.equal(body(), `前面的文字\n\n![](./assets/${file})\n\n![](./assets/${file})\n\n后面的文字\n`);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('保存失败时移除占位并提示', async () => {
    const { page, errors } = await openEmptyArticle(site, '正文。\n');
    await selectBetween(page, '正文。', '正文。');
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/__bake/asset', async (route) => {
      await held;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk is full' }) });
    });
    await dispatchClipboard(page, { files: [pngFile(blue)] });
    await page.waitForSelector('.milkdown .bake-image-saving');
    assert.equal(await page.textContent('.milkdown .bake-image-saving'), '图片保存中…');
    await site.screenshot(page, 'image-saving');
    release();
    await page.waitForSelector('.milkdown .bake-image-saving', { state: 'detached' });
    assert.equal(await statusMessage(page), '图片保存失败：Disk is full');
    await site.screenshot(page, 'image-failed');
    assert.equal(body(), '正文。\n');
    assert.deepEqual(errors.filter((error) => !error.includes('500')), []);
    await page.close();
  });

  test('光标在表格内时图片插在表格之后', async () => {
    const result = await plainPasteInto('image-table', '| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n\n表格之后的段落。\n', { files: [pngFile(red)] }, { place: (page) => selectBetween(page, '1', '1') });
    assert.match(result, /^\| 甲 \| 乙 \|\n\| - \| - \|\n\| 1 \| 2 \|\n\n!\[\]\(\.\/assets\/[0-9a-f]{8}\.png\)\n\n表格之后的段落。\n$/);
  });

  test('拖入的图片文件插在放下的位置', async () => {
    const { page, errors } = await openEmptyArticle(site, '第一段。\n\n第二段。\n');
    await waitForSave(page, () => dispatchClipboard(page, { files: [pngFile(blue)] }, { dropOn: '第二段。' }));
    await site.screenshot(page, 'image-drop');
    assert.match(body(), /^第一段。\n\n!\[\]\(\.\/assets\/[0-9a-f]{8}\.png\)\n\n第二段。\n$/);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('拖入的 HTML 插在放下的位置', async () => {
    const { page, errors } = await openEmptyArticle(site, '第一段。\n\n第二段。\n');
    await waitForSave(page, () => dispatchClipboard(page, { types: { 'text/html': '<h3>拖入的标题</h3>', 'text/plain': '拖入的标题' } }, { dropOn: '第二段。' }));
    assert.equal(body(), '第一段。\n\n### 拖入的标题第二段。\n');
    assert.deepEqual(errors, []);
    await page.close();
  });
});
