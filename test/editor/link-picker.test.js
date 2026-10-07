import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { format } from '../../src/format/index.js';
import { changedLines, openEditor, placeCursor, saveAfter, startSite } from './setup.js';

const path = 'content/features.md';
let site;
let page;
let errors;

before(async () => {
  site = await startSite('link-picker');
});

after(async () => {
  const text = site.read(path);
  await site.close();
  assert.deepEqual(errors, []);
  assert.equal(format(text), text);
});

async function hoverCard(locator) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await locator.scrollIntoViewIfNeeded();
  const response = page.waitForResponse((response) => response.url().includes('/__bake/preview?'));
  await locator.hover();
  await response;
  await page.waitForSelector('.link-preview');
  return page.locator('.link-preview');
}

async function openPicker() {
  const sections = page.waitForResponse((response) => response.url().endsWith('/__bake/sections'));
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForSelector('.link-picker');
  await sections;
  await page.waitForTimeout(50);
}

function pickerItems() {
  return page.$$eval('.link-picker li', (items) =>
    items.map((item) => ({
      kind: item.querySelector('.link-picker-kind').textContent,
      text: item.querySelector('.link-picker-text').textContent,
      target: item.querySelector('.link-picker-target').textContent,
    })),
  );
}

async function search(text) {
  await page.fill('.link-picker input', text);
  await page.waitForTimeout(50);
}

describe('开发服务器上的预览', () => {
  test('阅读模式下悬停站内链接，卡片内容来自 /__bake/preview', async () => {
    page = await site.browser.newPage({ viewport: { width: 1440, height: 900 } });
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto(`${site.origin}/features/`);
    const card = await hoverCard(page.locator('article a[href="/paper/#step-size"]'));
    assert.match(await card.locator('h3').textContent(), /步长的选择/);
    await site.screenshot(page, 'dev-reading-card');
    await page.close();
  });

  test('编辑器里悬停链接同样显示卡片', async () => {
    ({ page, errors } = await openEditor(site, '/features/'));
    const card = await hoverCard(page.locator('.milkdown a[href="/paper#step-size"]'));
    assert.match(await card.locator('h3').textContent(), /步长的选择/);
    await site.screenshot(page, 'dev-editor-card');
  });

  test('在外部修改目标文章后，再次悬停显示新内容', async () => {
    site.write('content/paper.md', site.read('content/paper.md').replace('### 步长的选择 {#step-size}', '### 步长怎样选择 {#step-size}'));
    const card = await hoverCard(page.locator('.milkdown a[href="/paper#step-size"]'));
    assert.match(await card.locator('h3').textContent(), /步长怎样选择/);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
  });
});

describe('链接选择器', () => {
  test('Mod-K 打开选择器，输入标题文字后第一项是对应的标题，Enter 插入跨页链接', async () => {
    await placeCursor(page, '最后得到的是损失对每个参数的梯度。');
    await openPicker();
    assert.equal(await page.getAttribute('.link-picker input', 'placeholder'), '输入文章标题、标题文字或段落 id，或粘贴网址');
    const initial = await pickerItems();
    assert.equal(initial[0].target.startsWith('bake 的全部写法 #'), true);
    assert.ok(initial.length <= 20);
    await search('更新规则');
    assert.deepEqual((await pickerItems())[0], { kind: '标题', text: '更新规则', target: '用梯度下降求函数的最小值 #update' });
    await site.screenshot(page, 'picker-heading');
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changes, {
      removed: ['最后得到的是损失对每个参数的梯度。优化器用这些梯度更新参数，进入下一轮前向传播。'],
      added: ['最后得到的是损失对每个参数的梯度。[更新规则](/paper#update)优化器用这些梯度更新参数，进入下一轮前向传播。'],
    });
    assert.equal(await page.locator('.link-picker').count(), 0);
  });

  test('插入后 Mod-Z 一步撤销，文件恢复', async () => {
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('ControlOrMeta+z'));
    assert.deepEqual(changes, {
      removed: ['最后得到的是损失对每个参数的梯度。[更新规则](/paper#update)优化器用这些梯度更新参数，进入下一轮前向传播。'],
      added: ['最后得到的是损失对每个参数的梯度。优化器用这些梯度更新参数，进入下一轮前向传播。'],
    });
  });

  test('有选区时只给选区加链接，目标在当前页时写 #id', async () => {
    await placeCursor(page, '反向传播从损失函数开始', { select: true });
    await openPicker();
    await search('链式法则把');
    assert.deepEqual((await pickerItems())[0], { kind: '段落', text: '链式法则把复合函数的导数写成各层导数的乘积。', target: 'bake 的全部写法 #chain-rule-def' });
    await site.screenshot(page, 'picker-block');
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changes, {
      removed: ['反向传播从损失函数开始，沿计算图逆向逐层计算梯度。'],
      added: ['[反向传播从损失函数开始](#chain-rule-def)，沿计算图逆向逐层计算梯度。'],
    });
  });

  test('输入 https:// 地址插入外部链接', async () => {
    await placeCursor(page, '正文段落。');
    await openPicker();
    await search('https://example.com/docs');
    await site.screenshot(page, 'picker-external');
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changes, { removed: ['正文段落。'], added: ['正文段落。<https://example.com/docs>'] });
  });

  test('在已有链接上按 Mod-K：输入框填入原地址，选择新目标后地址改变，清空后按 Enter 去掉链接', async () => {
    await page.locator('.milkdown a[href="/features#chain-rule"]').click();
    await page.waitForTimeout(100);
    await openPicker();
    assert.equal(await page.inputValue('.link-picker input'), '/features#chain-rule');
    await search('问题');
    assert.deepEqual((await pickerItems())[0], { kind: '标题', text: '问题', target: '用梯度下降求函数的最小值 #problem' });
    const changed = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changed, { removed: ['这里用到的是[链式法则](/features#chain-rule)。'], added: ['这里用到的是[链式法则](/paper#problem)。'] });
    await page.locator('.milkdown a[href="/paper#problem"]').click();
    await page.waitForTimeout(100);
    await openPicker();
    assert.equal(await page.inputValue('.link-picker input'), '/paper#problem');
    await search('');
    const removed = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(removed, { removed: ['这里用到的是[链式法则](/paper#problem)。'], added: ['这里用到的是链式法则。'] });
  });

  test('Esc 关闭后焦点回到编辑器，文件没有变化', async () => {
    const before = site.read(path);
    await placeCursor(page, '第二行。');
    await openPicker();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.link-picker').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.closest('.milkdown') !== null), true);
    await page.waitForTimeout(1200);
    assert.equal(site.read(path), before);
  });

  test('点击选择器外部时关闭', async () => {
    await placeCursor(page, '第二行。');
    await openPicker();
    await page.mouse.click(5, 450);
    assert.equal(await page.locator('.link-picker').count(), 0);
  });

  test('空行输入 /链接，选择「链接」后选择器打开，/链接 被删除', async () => {
    const before = site.read(path);
    await placeCursor(page, '第二行。');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/链接');
    await page.waitForFunction(() => document.querySelector('.bake-insert-menu')?.dataset.show === 'true');
    const sections = page.waitForResponse((response) => response.url().endsWith('/__bake/sections'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.link-picker');
    await sections;
    assert.equal(await page.evaluate(() => document.querySelector('.milkdown .editor').textContent.includes('/链接')), false);
    await search('激活函数');
    assert.deepEqual((await pickerItems())[0], { kind: '文章', text: '激活函数一览', target: '/bento/' });
    await site.screenshot(page, 'picker-menu');
    const changes = await saveAfter(site, page, path, () => page.keyboard.press('Enter'));
    assert.deepEqual(changedLines(before, site.read(path)), { removed: [], added: ['[激活函数一览](/bento)', ''] });
    assert.ok(changes.added.includes('[激活函数一览](/bento)'));
  });
});
