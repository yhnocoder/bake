import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { parse } from '../../src/format/index.js';
import { card, clickMenu, drag, menuItems, openMenu, paragraph } from '../../test/editor/block-actions.js';
import { exportMarkdown, placeCursor } from '../../test/editor/setup.js';

const [origin, blog, output] = process.argv.slice(2);
const file = join(blog, 'content/blocks.md');
const read = () => readFileSync(file, 'utf8');
const original = read();
const problems = [];
mkdirSync(output, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 2200 }, recordVideo: { dir: output, size: { width: 720, height: 1100 } } });
const page = await context.newPage();
page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
await page.goto(`${origin}/blocks/`);
await page.click('.bake-edit-toggle');
await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');

const heading = (text) => page.locator('.milkdown .editor h2', { hasText: text }).first();
const screenshotOf = (name) => join(output, `${name}-dragging.png`);
const dragStep = (name, source, type, target) => drag(page, source, type, target, screenshotOf(name));

async function settled() {
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  const deadline = Date.now() + 10000;
  while ((await exportMarkdown(page)) !== read()) {
    if (Date.now() > deadline) throw new Error('The editor did not save its document');
    await page.waitForTimeout(200);
  }
}

async function perform(action, changes) {
  const saved = changes ? page.waitForResponse((response) => response.url().endsWith('/__bake/save')) : null;
  await action();
  if (saved) await saved;
  else await page.waitForTimeout(1000);
  await settled();
}

function diffText(before) {
  const previous = join(output, 'previous.md');
  writeFileSync(previous, before);
  const result = spawnSync('diff', ['-u', '--label', 'before/blocks.md', '--label', 'after/blocks.md', previous, file], { encoding: 'utf8' });
  rmSync(previous);
  return result.stdout;
}

const steps = [
  ['drag', 'drag-paragraph', '第一段正文拖到第二段正文之后', () => dragStep('drag-paragraph', { locator: paragraph(page, '第一段正文') }, 'paragraph', { locator: paragraph(page, '第二段正文'), fy: 0.8 })],
  ['drag', 'drag-heading', '带副标题的标题拖到第二段正文之前，副标题一起移动', () => dragStep('drag-heading', { locator: heading('带副标题的标题') }, 'heading', { locator: paragraph(page, '第二段正文'), fy: 0.2 })],
  ['drag', 'drag-into-callout', '第三段正文拖进提示框', () => dragStep('drag-into-callout', { locator: paragraph(page, '第三段正文') }, 'paragraph', { locator: paragraph(page, '提示框的第一段'), fy: 0.8 })],
  ['drag', 'drag-out-of-callout', '提示框的第二段拖出提示框，放到最后一段之后', () => dragStep('drag-out-of-callout', { locator: paragraph(page, '提示框的第二段') }, 'paragraph', { locator: paragraph(page, '最后一段正文'), fy: 0.8 })],
  ['drag', 'drag-card', '第一张卡片拖到最后', () => dragStep('drag-card', { locator: card(page, '甲'), fx: 0.5, fy: 0.7 }, 'directive_card', { locator: card(page, '丙'), fx: 0.8, fy: 0.5 })],
  [
    'drag',
    'drag-between-cards',
    '第一段正文拖到两张卡片之间，放在卡片网格之外',
    () =>
      dragStep('drag-between-cards', { locator: paragraph(page, '第一段正文') }, 'paragraph', async () => {
        const left = await card(page, '乙').boundingBox();
        const right = await card(page, '丙').boundingBox();
        return { x: (left.x + left.width + right.x) / 2, y: left.y + left.height * 0.6 };
      }),
  ],
  ['drag', 'drag-card-to-body', '卡片拖到正文段落旁，没有放置线，文件不变', () => dragStep('drag-card-to-body', { locator: card(page, '乙'), fx: 0.5, fy: 0.7 }, 'directive_card', { locator: paragraph(page, '第二段正文'), fy: 0.8 }), false],
  ['drag', 'drag-list-item', '无序列表第一项拖到第二项之后', () => dragStep('drag-list-item', { locator: paragraph(page, '无序列表第一项') }, 'list_item', { locator: paragraph(page, '无序列表第二项'), fy: 0.8 })],
  ['drag', 'drag-wide', '整个加宽块拖到第二段正文之前', () => dragStep('drag-wide', { locator: paragraph(page, '加宽块的第一段') }, 'directive_wide', { locator: paragraph(page, '第二段正文'), fy: 0.2 })],
  ['sidenote', 'drag-sidenote', '第一条旁注所在的段落拖到第二条之后', () => dragStep('drag-sidenote', { locator: paragraph(page, '第一条旁注所在的段落') }, 'paragraph', { locator: paragraph(page, '第二条旁注所在的段落'), fy: 0.8 })],
  ['menu', 'menu-delete', '删除第二条旁注所在的段落', async () => {
    await openMenu(page, paragraph(page, '第二条旁注所在的段落'), 'paragraph');
    await page.screenshot({ path: join(output, 'menu-delete-open.png') });
    await clickMenu(page, '删除');
  }],
  ['menu', 'menu-copy-heading', '复制带显式 id 的标题', async () => {
    await openMenu(page, heading('带显式 id 的标题'), 'heading');
    await clickMenu(page, '复制一份');
  }],
  ['menu', 'menu-copy-sidenote', '复制第一条旁注所在的段落', async () => {
    await openMenu(page, paragraph(page, '第一条旁注所在的段落'), 'paragraph');
    await clickMenu(page, '复制一份');
  }],
  ['menu', 'menu-copy-block-id', '复制带块 id 的段落', async () => {
    await openMenu(page, paragraph(page, '带块 id 的段落'), 'paragraph');
    await clickMenu(page, '复制一份');
  }],
  ['menu', 'menu-copy-formula', '复制带 \\label 的公式', async () => {
    await openMenu(page, page.locator('.milkdown .editor .math.display').first(), 'math_block');
    await clickMenu(page, '复制一份');
  }],
  ['menu', 'menu-up', '第二段正文上移', async () => {
    await openMenu(page, paragraph(page, '第二段正文'), 'paragraph');
    await clickMenu(page, '上移');
  }],
  ['menu', 'menu-down', '标题之后的段落下移', async () => {
    await openMenu(page, paragraph(page, '标题之后的段落'), 'paragraph');
    await clickMenu(page, '下移');
  }],
  ['menu', 'menu-card', '卡片网格的第一张卡片打开块菜单，「上移」置灰，按 Esc 关闭', async () => {
    await openMenu(page, card(page, '乙'), 'directive_card');
    const items = await menuItems(page);
    console.log(`  menu items: ${JSON.stringify(items)}`);
    if (!items.find((item) => item.label === '上移').disabled) problems.push('上移 is not disabled for the first card');
    await page.screenshot({ path: join(output, 'menu-card-open.png') });
    await page.keyboard.press('Escape');
  }, false],
  ['keyboard', 'keyboard-down-twice', '第二段正文按两次 Mod-Shift-↓', async () => {
    await placeCursor(page, '第二段');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
  }, true, 2],
  ['keyboard', 'keyboard-out-of-callout', '提示框的第一段按 Mod-Shift-↑，移到提示框之前', async () => {
    await placeCursor(page, '提示框的第一段');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  }],
  ['keyboard', 'keyboard-first-block', '导语和导语后的第一个块按 Mod-Shift-↑，文件不变', async () => {
    await placeCursor(page, '这一页用来测试');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
    await placeCursor(page, '带副标题的标题');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  }, false],
  ['keyboard', 'keyboard-list-item', '有序列表第一项按 Mod-Shift-↓', async () => {
    await placeCursor(page, '有序列表第一项');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
  }],
];

let undoSteps = 0;
let index = 0;
for (const [group, name, description, action, changes = true, history = 1] of steps) {
  index++;
  const label = `${String(index).padStart(2, '0')}-${name}`;
  const before = read();
  await perform(action, changes);
  const after = read();
  await page.screenshot({ path: join(output, `${label}.png`), fullPage: true, caret: 'initial' });
  writeFileSync(join(output, `${label}.diff`), diffText(before));
  const messages = parse(after).messages;
  const changed = after !== before;
  console.log(`${label} [${group}] ${description}: ${changed ? 'file changed' : 'file unchanged'}, parse messages ${JSON.stringify(messages)}`);
  if (changed !== changes) problems.push(`${label}: expected the file to be ${changes ? 'changed' : 'unchanged'}`);
  if (messages.length > 0) problems.push(`${label}: parse reported ${JSON.stringify(messages)}`);
  if (changed) undoSteps += history;
}

await page.locator('.milkdown .editor').focus();
let presses = 0;
while (read() !== original && presses < undoSteps + 5) {
  presses++;
  await perform(() => page.keyboard.press('ControlOrMeta+z'), true);
  const messages = parse(read()).messages;
  if (messages.length > 0) problems.push(`undo ${presses}: parse reported ${JSON.stringify(messages)}`);
}
await page.screenshot({ path: join(output, 'undo-all.png'), fullPage: true, caret: 'initial' });
const restored = read() === original;
console.log(`undo: pressed Mod-Z ${presses} times for ${undoSteps} history steps; file ${restored ? 'is' : 'is not'} byte-for-byte equal to the original blocks.md`);
if (!restored) problems.push('the file differs from the original after undoing every operation');
if (presses !== undoSteps) problems.push(`expected ${undoSteps} Mod-Z presses, used ${presses}`);

const video = page.video();
await context.close();
renameSync(await video.path(), join(output, 'session.webm'));
await browser.close();
for (const problem of problems) console.log(problem);
process.exit(problems.length === 0 ? 0 : 1);
