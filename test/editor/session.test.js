import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { exportMarkdown, openEditor, placeCursor, session, startSite } from './setup.js';

const path = 'content/features.md';
const anchor = '局部导数只依赖本层的输入和输出';
let site;

before(async () => {
  site = await startSite('session');
});

after(async () => {
  await site.close();
});

function saveState(page) {
  return page.textContent('.bake-save-state');
}

function cursorBlock(page) {
  return session(page, (current) => {
    const { doc, selection } = current.view.state;
    return doc.child(doc.resolve(selection.from).index(0)).textContent.slice(0, 40);
  });
}

async function typeWithoutSaving(page, text) {
  await placeCursor(page, anchor);
  await page.keyboard.type(text);
}

test('连续输入时 800ms 内只保存一次', async () => {
  const { page, saves, errors } = await openEditor(site, '/features/');
  await placeCursor(page, anchor);
  for (const character of '连续输入的文字') {
    await page.keyboard.type(character);
    await page.waitForTimeout(150);
  }
  assert.equal(saves.length, 0);
  await page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await page.waitForTimeout(1000);
  assert.equal(saves.length, 1);
  assert.match(site.read(path), new RegExp(`${anchor}连续输入的文字`));
  assert.equal(await saveState(page), '已保存');
  await site.screenshot(page, 'debounce');
  assert.deepEqual(errors, []);
  await page.close();
});

async function openConflict(name, marker) {
  const opened = await openEditor(site, '/features/');
  const { page } = opened;
  const disk = site.read(path).replace('注释可以有多段', `注释可以有多段${marker}`);
  await typeWithoutSaving(page, '我的修改');
  site.write(path, disk);
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '冲突');
  await site.screenshot(page, name);
  return { ...opened, disk };
}

test('有未保存修改时在外部修改文件，使用磁盘上的版本', async () => {
  const { page, disk, errors } = await openConflict('conflict-use-disk', '（外部修改甲）');
  await page.click('text=使用磁盘上的版本');
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  assert.equal(await exportMarkdown(page), disk);
  await page.waitForTimeout(1200);
  assert.equal(site.read(path), disk);
  await site.screenshot(page, 'conflict-use-disk-done');
  assert.deepEqual(errors, []);
  await page.close();
});

test('有未保存修改时在外部修改文件，保留我的修改并覆盖', async () => {
  const { page, errors } = await openConflict('conflict-keep-mine', '（外部修改乙）');
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save') && response.status() === 200);
  await page.click('text=保留我的修改并覆盖');
  await response;
  const file = site.read(path);
  assert.match(file, new RegExp(`${anchor}我的修改`));
  assert.doesNotMatch(file, /外部修改乙/);
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  await site.screenshot(page, 'conflict-keep-mine-done');
  assert.deepEqual(errors, []);
  await page.close();
});

test('没有未保存修改时在外部修改文件，编辑器内容更新，光标所在的块不变', async () => {
  const { page, saves, errors } = await openEditor(site, '/features/');
  await placeCursor(page, anchor);
  const block = await cursorBlock(page);
  site.write(path, site.read(path).replace('注释可以有多段', '注释可以有多段（外部修改丙）'));
  await page.waitForFunction(() => document.querySelector('.milkdown').textContent.includes('（外部修改丙）'));
  assert.equal(await cursorBlock(page), block);
  assert.equal(await saveState(page), '已保存');
  await page.waitForTimeout(1200);
  assert.deepEqual(saves, []);
  await site.screenshot(page, 'reload');
  assert.deepEqual(errors, []);
  await page.close();
});

test('关闭编辑器后页面换成最新的渲染结果', async () => {
  const { page, errors } = await openEditor(site, '/features/');
  await typeWithoutSaving(page, '关闭前的修改');
  const updated = page.evaluate(() => new Promise((resolve) => window.addEventListener('bake:page-updated', () => resolve(true), { once: true })));
  await page.click('.bake-edit-toggle');
  assert.equal(await updated, true);
  assert.equal(await page.locator('.milkdown').count(), 0);
  assert.match(await page.textContent('article'), /关闭前的修改/);
  assert.match(site.read(path), /关闭前的修改/);
  await site.screenshot(page, 'closed');
  assert.deepEqual(errors, []);
  await page.close();
});
