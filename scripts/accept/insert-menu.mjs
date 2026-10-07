import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [scenario, origin, blog, output] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
const path = join(blog, 'content/features.md');
const plainPath = join(blog, 'content/positions.md');

async function open(url = '/features/', options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}${url}`);
  await page.evaluate(() => document.fonts.ready);
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
  await page.waitForTimeout(300);
  return { context, page };
}

async function placeCursor(page, text, { select = false } = {}) {
  await page.evaluate(
    ({ text, select }) => {
      const editor = document.querySelector('.milkdown .editor');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(text);
        if (index === -1 || walker.currentNode.parentElement.closest('[contenteditable="false"]')) continue;
        editor.focus();
        const range = document.createRange();
        range.setStart(walker.currentNode, select ? index : index + text.length);
        range.setEnd(walker.currentNode, index + text.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        walker.currentNode.parentElement.scrollIntoView({ block: 'center' });
        return;
      }
      throw new Error(`Text not found: ${text}`);
    },
    { text, select },
  );
  await page.waitForTimeout(100);
}

function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [...a.slice(start, endA).map((line) => `- ${line}`), ...b.slice(start, endB).map((line) => `+ ${line}`)].join('\n');
}

async function saved(page, file, name, action) {
  const before = readFileSync(file, 'utf8');
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await action();
  const status = (await response).status();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, `${name}.png`), caret: 'initial' });
  const diff = changedLines(before, readFileSync(file, 'utf8'));
  writeFileSync(join(output, `${name}.diff`), `${diff}\n`);
  console.log(`${name}: save status ${status}, address ${new URL(page.url()).pathname}`);
  console.log(diff.split('\n').map((line) => `  ${line}`).join('\n'));
  return { status, diff };
}

function expect(name, condition) {
  if (!condition) problems.push(`${name}: unexpected result`);
}

async function showMenu(page, query) {
  await page.keyboard.type(`/${query}`);
  await page.waitForFunction(() => document.querySelector('.bake-insert-menu')?.dataset.show === 'true');
  await page.waitForTimeout(100);
}

async function menu() {
  const { context, page } = await open();
  await placeCursor(page, '第二行。');
  await page.keyboard.press('Enter');
  await showMenu(page, '');
  await page.screenshot({ path: join(output, 'menu.png'), caret: 'initial' });
  const all = await page.$$eval('.bake-insert-item', (items) => items.map((item) => item.textContent));
  console.log(`menu items for /: ${all.join(', ')}`);
  await page.keyboard.type('cal');
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(output, 'menu-cal.png'), caret: 'initial' });
  const filtered = await page.$$eval('.bake-insert-item', (items) => items.map((item) => item.textContent));
  console.log(`menu items for /cal: ${filtered.join(', ')}`);
  expect('menu /cal', filtered.length === 1 && filtered[0] === '提示框 callout');
  await page.keyboard.press('Escape');
  for (let index = 0; index < 5; index++) await page.keyboard.press('Backspace');
  await page.waitForTimeout(1200);
  await context.close();
}

async function insertAt(page, file, name, { anchor, select = false, query, item }) {
  await placeCursor(page, anchor, { select });
  if (!select) await page.keyboard.press('Enter');
  await showMenu(page, query);
  const items = await page.$$eval('.bake-insert-item', (elements) => elements.map((element) => element.textContent));
  expect(`${name} listed`, items.includes(item));
  return saved(page, file, `insert-${name}`, () => page.locator('.bake-insert-item').filter({ hasText: new RegExp(`^${item}$`) }).click());
}

async function insert() {
  const { context, page } = await open();
  for (const [name, item] of [['fold', '折叠 fold'], ['callout', '提示框 callout'], ['wide', '加宽 wide'], ['margin', '边注 margin'], ['bento', '卡片网格 bento'], ['references', '参考文献 references'], ['table', '表格'], ['demo-plot', 'demo-plot']]) {
    const { diff } = await insertAt(page, path, name, { anchor: '第二行。', query: name === 'table' ? '表格' : name.slice(0, 4), item });
    expect(`insert ${name}`, !diff.split('\n').some((line) => line.startsWith('- ')));
  }
  await context.close();
  writeFileSync(plainPath, '---\ntitle: 插入位置\nslug: positions\n---\n\n第一段。\n\n## 小节 {#section}\n\n> 引文。\n>\n> 出处占位\n\n::::bento\n:::card\n卡片。\n:::\n::::\n\n最后一段。\n');
  await new Promise((resolve) => setTimeout(resolve, 800));
  const positions = await open('/positions/');
  const other = positions.page;
  await other.keyboard.press('ControlOrMeta+Home');
  await placeCursor(other, '第一段。', { select: true });
  await showMenu(other, 'lede');
  const lede = await saved(other, plainPath, 'insert-lede', () => other.keyboard.press('Enter'));
  expect('insert lede', lede.diff.includes('+ :::lede'));
  const subtitle = await insertAt(other, plainPath, 'subtitle', { anchor: '小节', query: 'sub', item: '章节副标题 subtitle' });
  expect('insert subtitle', subtitle.diff.includes('+ ::subtitle'));
  const source = await insertAt(other, plainPath, 'source', { anchor: '出处占位', select: true, query: 'so', item: '出处 source' });
  expect('insert source', source.diff.includes('+ > ::source'));
  const card = await insertAt(other, plainPath, 'card', { anchor: '卡片。', query: 'card', item: '卡片 card' });
  expect('insert card', card.diff.includes('+ :::card') && !card.diff.split('\n').some((line) => line.startsWith('- ')));
  await positions.context.close();
}

async function slider() {
  const { context, page } = await open('/features/', { recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  const saves = [];
  page.on('request', (request) => request.url().endsWith('/__bake/save') && saves.push(request.postData()));
  const plot = page.locator('.milkdown demo-plot').first();
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  await plot.click({ position: { x: box.width / 2, y: 40 } });
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === 'demo-plot');
  const range = page.locator('.bake-properties input[type="range"]');
  const track = await range.boundingBox();
  const at = (value) => track.x + 8 + ((value + 2) / 4) * (track.width - 16);
  const y = track.y + track.height / 2;
  const before = readFileSync(path, 'utf8');
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await page.mouse.move(at(1.2), y);
  await page.mouse.down();
  for (const value of [0.8, 0.2, -0.4, -1]) {
    await page.mouse.move(at(value), y, { steps: 8 });
    await page.waitForTimeout(400);
  }
  const savesWhileDragging = saves.length;
  await page.mouse.up();
  await response;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(output, 'slider.png'), caret: 'initial' });
  const diff = changedLines(before, readFileSync(path, 'utf8'));
  writeFileSync(join(output, 'slider.diff'), `${diff}\n`);
  console.log(`saves while dragging: ${savesWhileDragging}, saves after release: ${saves.length}`);
  console.log(diff.split('\n').map((line) => `  ${line}`).join('\n'));
  expect('slider saves', savesWhileDragging === 0 && saves.length === 1);
  const video = await page.video().path();
  await context.close();
  renameSync(video, join(output, 'slider.webm'));
  console.log(`video: ${join(output, 'slider.webm')}`);
}

async function enter(page) {
  await page.keyboard.press('Enter');
}

async function blocks() {
  const { context, page } = await open();
  const callout = page.locator('.milkdown aside.callout.note').first();
  await callout.scrollIntoViewIfNeeded();
  await callout.click({ position: { x: 4, y: 4 } });
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '提示框');
  const kind = await saved(page, path, 'callout-kind', () => page.selectOption('.bake-properties select', 'warning'));
  expect('callout kind', kind.diff.includes('+ :::callout{kind=warning}'));
  const card = page.locator('.milkdown .card').first();
  await card.scrollIntoViewIfNeeded();
  await card.click({ position: { x: 4, y: 4 } });
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '卡片');
  await page.fill('.bake-field[data-key="span"] input', '5x1');
  await enter(page);
  await page.waitForTimeout(300);
  const error = await page.textContent('.bake-field[data-key="span"] .bake-field-error');
  console.log(`card span 5x1: ${error}`);
  await page.screenshot({ path: join(output, 'card-span-error.png'), caret: 'initial' });
  expect('card span error', error.includes('5x1'));
  const span = await saved(page, path, 'card-span', async () => {
    await page.fill('.bake-field[data-key="span"] input', '3x1');
    await enter(page);
  });
  expect('card span', span.diff.includes('+ :::card{span=3x1 title=ReLU}'));
  await page.locator('.milkdown .bake-heading-id', { hasText: '#chain-rule' }).click();
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '标题');
  const id = await saved(page, path, 'heading-id', async () => {
    await page.fill('.bake-field[data-key="id"] input', 'chain');
    await enter(page);
  });
  expect('heading id', id.diff.includes('{#chain toc=链式法则}'));
  await page.click('.milkdown figure.image img[alt="神经元"]');
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '图片');
  const float = await saved(page, path, 'image-float', () => page.selectOption('.bake-field[data-key="float"] select', 'right'));
  expect('image float', float.diff.includes('{width=160px float=right}'));
  await context.close();
}

async function pageProperties() {
  const { context, page } = await open();
  const heading = page.locator('header.mast > h1');
  const title = await saved(page, path, 'title-area', async () => {
    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.type('（修订）');
    await enter(page);
  });
  expect('title area', title.diff === '- title: bake 的全部写法\n+ title: bake 的全部写法（修订）');
  await page.waitForTimeout(1000);
  await placeCursor(page, '正文段落。');
  await page.click('.bake-properties-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '页面属性');
  const updated = () => page.evaluate(() => new Promise((resolve) => window.addEventListener('bake:page-updated', resolve, { once: true })));
  let next = updated();
  const pageTitle = await saved(page, path, 'page-title', async () => {
    await page.fill('.bake-field[data-key="title"] input', 'bake 写法一览');
    await enter(page);
  });
  await next;
  expect('page title', pageTitle.diff.includes('+ title: bake 写法一览') && (await heading.textContent()) === 'bake 写法一览');
  next = updated();
  const toc = await saved(page, path, 'page-toc', () => page.click('.bake-field[data-key="toc"] input'));
  await next;
  expect('page toc', toc.diff.includes('+ toc: false') && (await page.locator('nav.toc').count()) === 0);
  next = updated();
  const layout = await saved(page, path, 'page-layout', () => page.selectOption('.bake-field[data-key="layout"] select', 'paper'));
  await next;
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'page-layout-after-update.png'), caret: 'initial' });
  expect('page layout', layout.diff.includes('+ layout: paper') && layout.diff.includes('- eyebrow:') && (await page.locator('main.layout-paper').count()) === 1);
  const slug = await saved(page, path, 'page-slug', async () => {
    await page.fill('.bake-field[data-key="slug"] input', 'all-features');
    await enter(page);
  });
  await page.waitForFunction(() => location.pathname === '/all-features/');
  console.log(`address after slug change: ${new URL(page.url()).pathname}`);
  expect('page slug', slug.diff.includes('+ slug: all-features'));
  await context.close();
}

mkdirSync(output, { recursive: true });
await { menu, insert, slider, blocks, page: pageProperties }[scenario]();
await browser.close();
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
