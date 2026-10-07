import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [scenario, origin, blog, output] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
const path = join(blog, 'content/features.md');

async function open(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}/features/`);
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function startEditing(page) {
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function notes() {
  const body = (document.querySelector('.milkdown .editor') ?? document.querySelector('article')).getBoundingClientRect();
  return [...document.querySelectorAll('article .sidenote')].map((note) => {
    const box = note.getBoundingClientRect();
    const id = note.id.slice('sn-'.length);
    const reference = id ? document.getElementById(`sn-ref-${id}`) : null;
    let block = note.previousElementSibling;
    while (block?.classList.contains('sidenote')) block = block.previousElementSibling;
    return {
      label: note.id || '边注',
      text: note.querySelector('.sidenote-body').textContent.slice(0, 16),
      number: note.querySelector('.sidenote-number')?.textContent ?? '',
      top: Math.round((box.top + scrollY) * 100) / 100,
      bottom: Math.round((box.bottom + scrollY) * 100) / 100,
      anchorTop: Math.round(((reference ?? block).getBoundingClientRect().top + scrollY) * 100) / 100,
      left: Math.round(box.left * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      inSideColumn: box.left >= body.right,
      afterOwnBlock: reference ? Boolean(block?.contains(reference)) : true,
    };
  });
}

function overflow() {
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth };
}

function checkAligned(name, list) {
  let bottom = -Infinity;
  for (const note of list) {
    const expected = Math.max(note.anchorTop, bottom + 12);
    if (Math.abs(note.top - expected) > 1) problems.push(`${name}: note ${note.label} top ${note.top}, expected ${expected}`);
    bottom = note.bottom;
  }
}

function table(rows) {
  for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
}

async function layout() {
  const { context, page } = await open(1440);
  await page.screenshot({ path: join(output, 'read.png'), fullPage: true });
  const read = await page.evaluate(notes);
  await startEditing(page);
  await page.screenshot({ path: join(output, 'edit.png'), fullPage: true, caret: 'initial' });
  const edit = await page.evaluate(notes);
  await context.close();
  console.log('compared for each note: number, left edge and width, and the distance from the top of its anchor (the reference number, or for the margin note the block before it); absolute tops differ when the body above is laid out differently in edit mode, for example the fold block is open while editing');
  console.log('read mode:');
  table(read);
  console.log('edit mode:');
  table(edit);
  if (read.length !== edit.length) problems.push('read and edit mode show a different number of notes');
  read.forEach((note, index) => {
    const other = edit[index];
    if (!other || other.label !== note.label || other.number !== note.number) problems.push(`note ${note.label} differs between read and edit mode`);
    else if (Math.abs(other.top - other.anchorTop - (note.top - note.anchorTop)) > 1) problems.push(`note ${note.label} offset from its anchor differs: read ${note.top - note.anchorTop}, edit ${other.top - other.anchorTop}`);
    else if (Math.abs(other.left - note.left) > 1 || Math.abs(other.width - note.width) > 1) problems.push(`note ${note.label} column differs: read ${note.left}+${note.width}, edit ${other.left}+${other.width}`);
    if (!other?.inSideColumn) problems.push(`note ${note.label} is not in the side column in edit mode`);
  });
  checkAligned('read mode', read);
  checkAligned('edit mode', edit);
}

async function renumber() {
  const { context, page } = await open(1440);
  await startEditing(page);
  const before = await page.evaluate(notes);
  await page.locator('.milkdown p', { hasText: '反向传播从损失函数开始' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'before.png'), fullPage: true, caret: 'initial' });
  await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.milkdown p')].find((element) => element.textContent.startsWith('反向传播从损失函数开始'));
    document.querySelector('.milkdown .editor').focus();
    getSelection().collapse(paragraph.firstChild, paragraph.firstChild.length);
  });
  await page.waitForTimeout(50);
  const saved = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await page.keyboard.press('ControlOrMeta+Alt+f');
  await page.keyboard.type('插在第一条旁注之前');
  await saved;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(output, 'after.png'), fullPage: true, caret: 'initial' });
  const after = await page.evaluate(notes);
  await context.close();
  console.log('before:');
  table(before);
  console.log('after:');
  table(after);
  const lines = readFileSync(path, 'utf8').split('\n');
  console.log(`file lines around the insertion: ${JSON.stringify(lines.slice(lines.findIndex((line) => line.startsWith('反向传播从损失函数开始')), lines.findIndex((line) => line.startsWith('反向传播从损失函数开始')) + 4))}`);
  const numbered = (list) => list.filter((note) => note.number !== '');
  numbered(before).forEach((note) => {
    const moved = after.find((other) => other.text === note.text);
    if (moved?.number !== String(Number(note.number) + 1)) problems.push(`note ${note.text} was ${note.number}, now ${moved?.number}`);
  });
  checkAligned('after renumbering', after);
  if (!after.every((note) => note.inSideColumn)) problems.push('a note is not in the side column after renumbering');
}

async function narrow() {
  for (const width of [1100, 1099, 375]) {
    const { context, page } = await open(width);
    await startEditing(page);
    await page.screenshot({ path: join(output, `edit-${width}.png`), fullPage: true, caret: 'initial' });
    const shown = await page.evaluate(notes);
    const size = await page.evaluate(overflow);
    await context.close();
    console.log(`${width}px: scrollWidth ${size.scrollWidth}, innerWidth ${size.innerWidth}`);
    table(shown);
    if (size.scrollWidth > size.innerWidth) problems.push(`${width}px has a horizontal scroll bar`);
    if (width >= 1100 && !shown.every((note) => note.inSideColumn)) problems.push(`${width}px: notes should be in the side column`);
    if (width < 1100 && !shown.every((note) => !note.inSideColumn && note.afterOwnBlock)) problems.push(`${width}px: notes should follow their block`);
  }
}

mkdirSync(output, { recursive: true });
await { layout, renumber, narrow }[scenario]();
await browser.close();
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
