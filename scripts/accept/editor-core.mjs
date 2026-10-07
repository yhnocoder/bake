import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [scenario, origin, blog, output] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
const path = join(blog, 'content/features.md');
const anchor = '局部导数只依赖本层的输入和输出';

async function open(options = {}, url = '/features/') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}${url}`);
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function startEditing(page) {
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
  await page.waitForTimeout(300);
}

function blockBoxes() {
  const boxes = {};
  for (const element of document.querySelectorAll('article p, article li, article h2, article h3, article table, article pre, article figure, article blockquote')) {
    if (element.closest('td, th, .sidenote') || getComputedStyle(element).display === 'contents') continue;
    const copy = element.cloneNode(true);
    for (const label of copy.querySelectorAll('.bake-heading-id, .sidenote-ref')) label.remove();
    const key = `${copy.textContent.replace(/\s+/g, '').replace(/^#/, '').slice(0, 30)}`;
    if (key in boxes) continue;
    const box = element.getBoundingClientRect();
    boxes[key] = { top: Math.round(box.top + scrollY), width: Math.round(box.width), height: Math.round(box.height) };
  }
  return boxes;
}

async function layout() {
  const { context, page } = await open();
  await page.screenshot({ path: join(output, 'read.png'), fullPage: true });
  const read = await page.evaluate(blockBoxes);
  await startEditing(page);
  await page.screenshot({ path: join(output, 'edit.png'), fullPage: true, caret: 'initial' });
  const edit = await page.evaluate(blockBoxes);
  await context.close();
  const common = Object.keys(read).filter((key) => key in edit);
  const different = common.filter((key) => Math.abs(read[key].width - edit[key].width) > 1 || Math.abs(read[key].height - edit[key].height) > 1);
  console.log('not compared: sidenotes, which scripts/accept/sidenotes.sh compares; table cells; heading id labels and sidenote reference numbers');
  console.log(`blocks in read mode: ${Object.keys(read).length}, in edit mode: ${Object.keys(edit).length}, compared: ${common.length}`);
  console.log(`blocks whose size differs by more than 1px: ${different.length}`);
  for (const key of different) console.log(`  ${key}: read ${JSON.stringify(read[key])}, edit ${JSON.stringify(edit[key])}`);
  console.log(`only in read mode: ${JSON.stringify(Object.keys(read).filter((key) => !(key in edit)))}`);
  console.log(`only in edit mode: ${JSON.stringify(Object.keys(edit).filter((key) => !(key in read)))}`);
  if (different.length > 0) problems.push('block sizes differ between read and edit mode');
}

async function placeCursor(page) {
  await page.evaluate((text) => {
    const editor = document.querySelector('.milkdown .editor');
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const index = walker.currentNode.data.indexOf(text);
      if (index === -1) continue;
      editor.focus();
      const range = document.createRange();
      range.setStart(walker.currentNode, index + text.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
  }, anchor);
  await page.locator('.milkdown p', { hasText: anchor }).scrollIntoViewIfNeeded();
}

async function recorded(name, action) {
  const { context, page } = await open({ recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  await startEditing(page);
  await placeCursor(page);
  await action(page);
  await page.waitForTimeout(800);
  const video = await page.video().path();
  await context.close();
  renameSync(video, join(output, `${name}.webm`));
  console.log(`video: ${join(output, `${name}.webm`)}`);
}

function writeOutside(marker) {
  writeFileSync(path, readFileSync(path, 'utf8').replace('注释可以有多段', `注释可以有多段${marker}`));
}

async function conflict() {
  await recorded('conflict', async (page) => {
    await page.keyboard.type('（我的修改）');
    writeOutside('（外部修改甲）');
    await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '冲突');
    await page.screenshot({ path: join(output, 'conflict.png') });
    console.log(`status bar: ${await page.textContent('.bake-save-state')}; buttons: ${(await page.locator('.bake-conflict-actions button').allTextContents()).join(', ')}`);
    await page.waitForTimeout(800);
    await page.click('text=保留我的修改并覆盖');
    await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  });
  const file = readFileSync(path, 'utf8');
  console.log(`file contains 我的修改: ${file.includes('（我的修改）')}, contains 外部修改甲: ${file.includes('（外部修改甲）')}`);
  if (!file.includes('（我的修改）') || file.includes('（外部修改甲）')) problems.push('keep mine did not overwrite the file');
}

async function reload() {
  await recorded('reload', async (page) => {
    writeOutside('（外部修改乙）');
    await page.waitForFunction(() => document.querySelector('.milkdown').textContent.includes('（外部修改乙）'));
    const block = await page.evaluate(() => getSelection().anchorNode?.parentElement?.closest('.milkdown p')?.textContent.slice(0, 40));
    console.log(`editor shows the outside change; status bar: ${await page.textContent('.bake-save-state')}; cursor block: ${block}`);
    if (!block?.includes(anchor.slice(0, 10))) problems.push('cursor moved to another block');
    await page.screenshot({ path: join(output, 'reload.png') });
  });
}

async function structure() {
  writeFileSync(join(blog, 'content/broken.md'), '---\ntitle: 结构错误\nslug: broken\n---\n\n::::callout{kind=note}\n\n:::card{title=嵌套}\n\n卡片在卡片网格之外。\n\n:::\n\n::::\n');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { context, page } = await open({}, '/broken/');
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent !== '');
  const message = await page.textContent('.bake-save-state');
  const opened = await page.locator('article .milkdown').count();
  console.log(`status bar: ${message}; editor elements in article: ${opened}`);
  if (message !== '文章有结构错误，修正后才能编辑' || opened !== 0) problems.push('the editor opened an article with a structure error');
  await page.screenshot({ path: join(output, 'structure-error.png') });
  await context.close();
}

mkdirSync(output, { recursive: true });
await { layout, conflict, reload, structure }[scenario]();
await browser.close();
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
