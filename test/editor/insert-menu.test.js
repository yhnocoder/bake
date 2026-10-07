import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { bakeRoot } from '../../src/dev/plugin.js';
import { format } from '../../src/format/index.js';
import { exportMarkdown, openEditor, placeCursor, saveAfter, startSite } from './setup.js';

const path = 'content/features.md';
const plainPath = 'content/plain.md';
const plain = `---
title: 插入位置
slug: plain
---

第一段。

## 小节 {#section}

> 引文。
>
> 出处占位

::::bento
:::card
卡片。
:::
::::

最后一段。
`;
let site;
let page;
let errors;

before(async () => {
  site = await startSite('insert-menu');
  site.write(plainPath, plain);
  ({ page, errors } = await openEditor(site, '/features/'));
});

after(async () => {
  const files = [site.read(path), site.read(plainPath)];
  await site.close();
  assert.deepEqual(errors, []);
  for (const text of files) assert.equal(format(text), text);
});

function menuShown(target = page) {
  return target.evaluate(() => document.querySelector('.bake-insert-menu')?.dataset.show === 'true');
}

function menuItems(target = page) {
  return target.$$eval('.bake-insert-menu .bake-insert-item', (items) => items.map((item) => item.textContent));
}

async function waitMenu(target = page) {
  await target.waitForFunction(() => document.querySelector('.bake-insert-menu')?.dataset.show === 'true');
}

async function newLineAfter(text, target = page) {
  await placeCursor(target, text);
  await target.keyboard.press('Enter');
}

async function openMenu(query, target = page) {
  await target.keyboard.type(`/${query}`);
  await waitMenu(target);
  await target.waitForTimeout(50);
}

function record(name, changes) {
  site.record(`${name}.diff`, [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
}

describe('打开、筛选和关闭', () => {
  test('空行输入 / 显示菜单，列出块和组件', async () => {
    await newLineAfter('正文段落。');
    await openMenu('');
    assert.equal(await menuShown(), true);
    assert.deepEqual(await page.$$eval('.bake-insert-group', (groups) => groups.map((group) => group.textContent)), ['块', '组件']);
    assert.deepEqual(await menuItems(), ['折叠 fold', '提示框 callout', '加宽 wide', '边注 margin', '卡片网格 bento', '参考文献 references', '表格', '链接', 'demo-plot']);
    await site.screenshot(page, 'menu-open');
  });

  test('/cal 只剩提示框', async () => {
    await page.keyboard.type('cal');
    await page.waitForTimeout(50);
    assert.deepEqual(await menuItems(), ['提示框 callout']);
    await site.screenshot(page, 'menu-filter');
  });

  test('↑ ↓ 在两端循环', async () => {
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    const selected = () => page.$eval('.bake-insert-item[aria-selected="true"]', (item) => item.textContent);
    assert.equal(await selected(), '折叠 fold');
    await page.keyboard.press('ArrowUp');
    assert.equal(await selected(), 'demo-plot');
    await page.keyboard.press('ArrowDown');
    assert.equal(await selected(), '折叠 fold');
    await page.keyboard.press('ArrowDown');
    assert.equal(await selected(), '提示框 callout');
  });

  test('Esc 关闭菜单，/ 留在段落里', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal(await menuShown(), false);
    assert.match(await exportMarkdown(page), /正文段落。\n\n\/\n/);
    await site.screenshot(page, 'menu-escape');
  });

  test('没有匹配的项时显示提示，Enter 按普通回车处理', async () => {
    await page.keyboard.type('zzz');
    await waitMenu();
    await page.waitForTimeout(50);
    assert.equal(await page.textContent('.bake-insert-menu'), '没有匹配的项');
    await site.screenshot(page, 'menu-empty');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.match(await exportMarkdown(page), /正文段落。\n\n\/zzz\n/);
    assert.equal(await menuShown(), false);
    await page.keyboard.press('Backspace');
    for (let index = 0; index < 5; index++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  });

  test('输入空格后菜单关闭', async () => {
    await newLineAfter('正文段落。');
    await openMenu('ca');
    await page.keyboard.type(' ');
    await page.waitForTimeout(50);
    assert.equal(await menuShown(), false);
    for (let index = 0; index < 5; index++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  });

  test('段落中间输入 / 不显示菜单', async () => {
    await placeCursor(page, '正文');
    await page.keyboard.type('/');
    await page.waitForTimeout(100);
    assert.equal(await menuShown(), false);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  });
});

function clickItem(target, text) {
  return target.locator('.bake-insert-item').filter({ hasText: new RegExp(`^${text}$`) }).click();
}

async function insert(name, query, expected, { target = page, file = path, anchor = '正文段落。', choose } = {}) {
  await newLineAfter(anchor, target);
  await openMenu(query, target);
  await site.screenshot(target, `insert-${name}-menu`);
  const changes = await saveAfter(site, target, file, async () => {
    if (choose) await clickItem(target, choose);
    else await target.keyboard.press('Enter');
  });
  await site.screenshot(target, `insert-${name}`);
  record(`insert-${name}`, changes);
  assert.deepEqual(changes, expected);
  assert.equal(await exportMarkdown(target), site.read(file));
}

describe('插入内置块、表格和组件，文件只增加插入的几行', () => {
  test('折叠：光标在标题里', async () => {
    await insert('fold', 'fold', { removed: [], added: [':::fold', ':::', ''] });
    await page.keyboard.type('细节');
    await page.waitForTimeout(900);
    assert.match(site.read(path), /^:::fold\[细节\]$/m);
  });

  test('提示框：光标在正文段落，直接输入', async () => {
    await insert('callout', 'callout', { removed: [], added: [':::callout', ':::', ''] });
    const changes = await saveAfter(site, page, path, () => page.keyboard.type('提示内容。'));
    assert.deepEqual(changes, { removed: [], added: ['提示内容。'] });
    assert.equal(await page.getAttribute('.milkdown aside.callout.note .callout-label', 'data-placeholder'), '说明');
  });

  test('加宽', async () => {
    await insert('wide', 'wide', { removed: [], added: [':::wide', ':::', ''] });
  });

  test('边注，用鼠标点击菜单项', async () => {
    await insert('margin', 'mar', { removed: [], added: [':::margin', ':::', ''] }, { choose: '边注 margin' });
  });

  test('卡片网格：生成一张卡片', async () => {
    await insert('bento', 'bento', { removed: [], added: ['::::bento', ':::card', ':::', '::::', ''] });
  });

  test('参考文献：生成一个列表', async () => {
    await insert('references', 'references', { removed: [], added: [':::references', '-', ':::', ''] });
  });

  test('表格：3 行 3 列，光标在第一个单元格', async () => {
    await insert('table', '表格', { removed: [], added: ['| | | |', '| :- | :- | :- |', '| | | |', '| | | |', ''] });
    const changes = await saveAfter(site, page, path, () => page.keyboard.type('列一'));
    assert.deepEqual(changes, { removed: ['| | | |'], added: ['| 列一 | | |'] });
  });

  test('表格单元格里不列出块和组件，只列出链接', async () => {
    await page.keyboard.press('Tab');
    await openMenu('');
    assert.deepEqual(await menuItems(), ['链接']);
    await site.screenshot(page, 'menu-table-cell');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  });

  test('组件：光标在图题里', async () => {
    await insert('demo-plot', 'demo', { removed: [], added: ['::demo-plot', ''] });
    const changes = await saveAfter(site, page, path, () => page.keyboard.type('新图题。'));
    assert.deepEqual(changes, { removed: ['::demo-plot'], added: [':::demo-plot', '新图题。', ':::'] });
  });
});

describe('位置规则', () => {
  let plainPage;
  let plainErrors;

  before(async () => {
    ({ page: plainPage, errors: plainErrors } = await openEditor(site, '/plain/'));
  });

  after(async () => {
    assert.deepEqual(plainErrors, []);
    await plainPage.close();
  });

  test('正文第一个块处列出导语，其他位置不列出', async () => {
    await placeCursor(plainPage, '最后一段。');
    await openMenuAt(plainPage, '');
    assert.equal((await menuItems(plainPage)).includes('导语 lede'), false);
    await clearQuery(plainPage, 1);
    await plainPage.keyboard.press('ControlOrMeta+Home');
    await plainPage.keyboard.press('Enter');
    await plainPage.keyboard.press('ArrowUp');
    await openMenu('', plainPage);
    assert.equal((await menuItems(plainPage)).includes('导语 lede'), true);
    await site.screenshot(plainPage, 'position-lede');
    const changes = await saveAfter(site, plainPage, plainPath, () => clickItem(plainPage, '导语 lede'));
    assert.deepEqual(changes, { removed: [], added: [':::lede', ':::', ''] });
  });

  test('标题之后列出副标题', async () => {
    await insert('subtitle', 'sub', { removed: [], added: ['::subtitle', ''] }, { target: plainPage, file: plainPath, anchor: '小节' });
  });

  test('引用块最后一段列出出处，其他段落不列出', async () => {
    await placeCursor(plainPage, '引文。', { select: true });
    await openMenu('', plainPage);
    assert.equal((await menuItems(plainPage)).includes('出处 source'), false);
    await placeCursor(plainPage, '出处占位', { select: true });
    await openMenu('so', plainPage);
    assert.deepEqual(await menuItems(plainPage), ['出处 source']);
    await site.screenshot(plainPage, 'position-source');
    const changes = await saveAfter(site, plainPage, plainPath, () => plainPage.keyboard.press('Enter'));
    record('insert-source', changes);
    assert.deepEqual(changes, { removed: ['> 引文。', '>', '> 出处占位'], added: ['> /', '>', '> ::source'] });
  });

  test('卡片里列出卡片，新卡片加在当前卡片之后', async () => {
    await newLineAfter('卡片。', plainPage);
    await openMenu('card', plainPage);
    assert.deepEqual(await menuItems(plainPage), ['卡片 card']);
    await site.screenshot(plainPage, 'position-card');
    const changes = await saveAfter(site, plainPage, plainPath, () => plainPage.keyboard.press('Enter'));
    record('insert-card', changes);
    assert.deepEqual(changes, { removed: [], added: ['', ':::card', ':::'] });
    await saveAfter(site, plainPage, plainPath, () => plainPage.keyboard.type('第二张。'));
    assert.match(site.read(plainPath), /:::card\n卡片。\n:::\n\n:::card\n第二张。\n:::\n::::/);
  });

  test('其他位置不列出副标题和出处', async () => {
    await newLineAfter('第一段。', plainPage);
    await openMenu('', plainPage);
    const items = await menuItems(plainPage);
    assert.equal(items.includes('章节副标题 subtitle'), false);
    assert.equal(items.includes('出处 source'), false);
    assert.equal(items.includes('卡片 card'), false);
    await clearQuery(plainPage, 2);
  });
});

async function openMenuAt(target, query) {
  await target.keyboard.press('Enter');
  await openMenu(query, target);
}

async function clearQuery(target, count) {
  await target.keyboard.press('Escape');
  for (let index = 0; index < count; index++) await target.keyboard.press('Backspace');
  await target.waitForTimeout(900);
}

describe('撤销与登记', () => {
  test('插入后 Mod-Z 恢复 /查询文字', async () => {
    await newLineAfter('正文段落。');
    await openMenu('wid');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.match(await exportMarkdown(page), /正文段落。\n\n:::wide\n:::\n/);
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(50);
    assert.match(await exportMarkdown(page), /正文段落。\n\n\/wid\n/);
    await site.screenshot(page, 'undo-insert');
    await clearQuery(page, 5);
  });

  test('用 insertMenuItemsCtx 登记的菜单项出现在块组末尾并可以执行', async () => {
    const module = `/@fs${join(bakeRoot, 'src/editor/insert-menu.js')}`;
    await page.evaluate(async (module) => {
      const { insertMenuItemsCtx } = await import(module);
      const { currentSession } = await import(module.replace('insert-menu.js', 'index.js'));
      currentSession().editor.action((ctx) => {
        ctx.update(insertMenuItemsCtx, (items) => [
          ...items,
          {
            label: '测试项',
            keywords: ['probe'],
            run: (view, range) => view.dispatch(view.state.tr.insertText('测试项已执行', range.from + 1, range.to - 1)),
          },
        ]);
      });
    }, module);
    await newLineAfter('正文段落。');
    await openMenu('');
    const items = await menuItems();
    assert.deepEqual(items.slice(items.indexOf('表格') + 1, items.indexOf('表格') + 3), ['链接', '测试项']);
    await page.keyboard.press('Backspace');
    await openMenu('probe');
    assert.deepEqual(await menuItems(), ['测试项']);
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changes, { removed: [], added: ['测试项已执行', ''] });
    await site.screenshot(page, 'registered-item');
  });
});
