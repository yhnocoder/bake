import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { exportMarkdown, openEditor, placeCursor, saveAfter, startSite } from './setup.js';

const path = 'content/features.md';
let site;
let page;
let errors;

before(async () => {
  site = await startSite('editing');
  ({ page, errors } = await openEditor(site, '/features/'));
});

after(async () => {
  assert.deepEqual(errors, []);
  await site.close();
});

async function check(name, action, expected) {
  const before = site.read(path);
  const changes = await saveAfter(site, page, path, action);
  await site.screenshot(page, name);
  site.record(`${name}.diff`, [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
  if (typeof expected === 'function') assert.equal(site.read(path), expected(before));
  else assert.deepEqual(changes, expected);
  assert.equal(await exportMarkdown(page), site.read(path));
}

describe('编辑后保存的文件只改变对应的行', () => {
  test('在段落中输入文字', async () => {
    await check('paragraph', async () => {
      await placeCursor(page, '正文段落。');
      await page.keyboard.type('补充一句。');
    }, { removed: ['正文段落。'], added: ['正文段落。补充一句。'] });
  });

  test('加粗', async () => {
    await check('bold', async () => {
      await placeCursor(page, '沿计算图逆向', { select: true });
      await page.keyboard.press('ControlOrMeta+b');
    }, { removed: ['反向传播从损失函数开始，沿计算图逆向逐层计算梯度。'], added: ['反向传播从损失函数开始，**沿计算图逆向**逐层计算梯度。'] });
  });

  test('Mod-Shift-H 高亮', async () => {
    await check('highlight-shortcut', async () => {
      await placeCursor(page, '优化器', { select: true });
      await page.keyboard.press('ControlOrMeta+Shift+h');
    }, { removed: ['最后得到的是损失对每个参数的梯度。优化器用这些梯度更新参数，进入下一轮前向传播。'], added: ['最后得到的是损失对每个参数的梯度。==优化器==用这些梯度更新参数，进入下一轮前向传播。'] });
  });

  test('==文字== 输入规则', async () => {
    await check('highlight-input', async () => {
      await placeCursor(page, '是链式法则。');
      await page.keyboard.type('这是==重点==');
    }, { removed: ['式 $\\eqref{eq:chain}$ 是链式法则。'], added: ['式 $\\eqref{eq:chain}$ 是链式法则。这是==重点=='] });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.milkdown mark')].some((mark) => mark.textContent === '重点')), true);
  });

  test('修改行内公式', async () => {
    await check('inline-formula', async () => {
      await page.click('.milkdown .math[data-tex="E = mc^2"]');
      await page.fill('.bake-math-input', 'E = mc^3');
      await page.keyboard.press('Enter');
    }, { removed: ['行内公式 $E = mc^2$ 写在段落里。'], added: ['行内公式 $E = mc^3$ 写在段落里。'] });
  });

  test('新增独立公式', async () => {
    await check('display-formula', async () => {
      await placeCursor(page, '写在段落里。');
      await page.keyboard.press('Enter');
      await page.keyboard.type('$$');
      await page.keyboard.press('Enter');
      await page.fill('.bake-math-input', 'a^2 + b^2 = c^2');
      await page.keyboard.press('Enter');
    }, (before) => before.replace('写在段落里。\n', () => '写在段落里。\n\n$$\na^2 + b^2 = c^2\n$$\n'));
  });

  test('修改表格单元格', async () => {
    await check('table-cell', async () => {
      await placeCursor(page, '不存在');
      await page.keyboard.type('（不可导）');
    }, { removed: ['| ReLU | 不存在 |'], added: ['| ReLU | 不存在（不可导） |'] });
  });

  test('增加表格行', async () => {
    await check('table-row', async () => {
      await placeCursor(page, 'GELU', { select: true });
      const cell = page.locator('.milkdown td', { hasText: 'GELU' }).first();
      await cell.click({ button: 'right' });
      await page.click('.bake-table-menu button:text("在下方插入行")');
    }, (before) => before.replace('| GELU | 0.5 |\n', '| GELU | 0.5 |\n| | |\n'));
  });

  test('修改代码块语言名', async () => {
    await check('code-language', async () => {
      await page.fill('.milkdown .bake-code-language', 'ts');
      await page.keyboard.press('Enter');
    }, { removed: ['```js'], added: ['```ts'] });
  });

  test('在折叠块中输入', async () => {
    await check('fold-content', async () => {
      await placeCursor(page, '代入后逐项求导。');
      await page.keyboard.type('再求和。');
    }, { removed: ['把 $z = Wx + b$ 代入后逐项求导。'], added: ['把 $z = Wx + b$ 代入后逐项求导。再求和。'] });
  });

  test('修改折叠标题', async () => {
    await check('fold-title', async () => {
      await placeCursor(page, '推导细节');
      await page.keyboard.type('（选读）');
    }, { removed: [':::fold[推导细节]'], added: [':::fold[推导细节（选读）]'] });
  });

  test('在提示框中输入', async () => {
    await check('callout', async () => {
      await placeCursor(page, '先看图再看公式。');
      await page.keyboard.type('图在上一节。');
    }, { removed: ['先看图再看公式。'], added: ['先看图再看公式。图在上一节。'] });
  });

  test('修改提示框的自定义名称', async () => {
    await check('callout-label', async () => {
      await placeCursor(page, '求和次序');
      await page.keyboard.type('的限制');
    }, { removed: [':::callout[求和次序]{kind=warning}'], added: [':::callout[求和次序的限制]{kind=warning}'] });
    assert.equal(await page.textContent('.milkdown aside.callout.warning > .callout-label'), '求和次序的限制');
  });

  test('删空提示框的自定义名称后不再写方括号', async () => {
    await check('callout-label-empty', async () => {
      await placeCursor(page, '求和次序的限制', { select: true });
      await page.keyboard.press('Backspace');
    }, { removed: [':::callout[求和次序的限制]{kind=warning}'], added: [':::callout{kind=warning}'] });
  });

  test('修改组件图题', async () => {
    await check('component-caption', async () => {
      await placeCursor(page, '出发沿负梯度方向下降。');
      await page.keyboard.type('步长为 0.2。');
    }, { removed: ['从 $x_0$ 出发沿负梯度方向下降。'], added: ['从 $x_0$ 出发沿负梯度方向下降。步长为 0.2。'] });
  });

  test('修改独立 HTML 块源码', async () => {
    await check('html', async () => {
      await page.click('.milkdown .bake-html');
      const source = page.locator('.bake-html-source');
      await source.fill((await source.inputValue()).replace('<path d="M44 20 H76"/>', '<path d="M44 20 H70"/>'));
      await placeCursor(page, '正文段落。');
    }, { removed: ['  <path d="M44 20 H76"/>'], added: ['  <path d="M44 20 H70"/>'] });
    assert.match(await page.innerHTML('.milkdown .bake-html-preview'), /M44 20 H70/);
  });

  test('撤销', async () => {
    const before = site.read(path);
    await check('undo-type', async () => {
      await placeCursor(page, '这里的求和不能交换次序。');
      await page.keyboard.type('撤销前');
    }, { removed: ['这里的求和不能交换次序。'], added: ['这里的求和不能交换次序。撤销前'] });
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('ControlOrMeta+z'));
    await site.screenshot(page, 'undo');
    assert.deepEqual(changes, { removed: ['这里的求和不能交换次序。撤销前'], added: ['这里的求和不能交换次序。'] });
    assert.equal(site.read(path), before);
  });
});
