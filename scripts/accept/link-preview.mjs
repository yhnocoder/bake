import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const [scenario, origin, blog, output] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function expect(name, condition) {
  if (!condition) problems.push(`${name}: unexpected result`);
}

async function serveDist() {
  const directory = join(blog, 'dist');
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = join(directory, normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname));
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  console.log(`static server: http://127.0.0.1:${server.address().port}/ serving ${directory}`);
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

async function open(base, url, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${base}${url}`);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, requests };
}

function link(page, href, scope = 'article') {
  return page.locator(`${scope} a[href="${href}"]:not(.anchor)`).first();
}

async function moveAway(page) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
}

async function showCard(page, locator, name) {
  await moveAway(page);
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await page.waitForSelector('.link-preview', { timeout: 5000 }).catch(() => problems.push(`${name}: no card`));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, `${name}.png`), caret: 'initial' });
  const card = await page.evaluate(() => {
    const element = document.querySelector('.link-preview');
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      title: element.querySelector('.link-preview-title')?.textContent ?? null,
      text: element.querySelector('.link-preview-body').textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
      box: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
    };
  });
  console.log(`${name}: ${JSON.stringify(card)}`);
  return card;
}

async function kinds() {
  const server = await serveDist();
  const { context, page, requests } = await open(server.origin, '/features/');
  const article = await showCard(page, link(page, '/paper/'), 'card-article');
  expect('article card', article?.title === '用梯度下降求函数的最小值');
  const heading = await showCard(page, link(page, '/paper/#step-size'), 'card-heading');
  expect('heading card', heading?.title === null && heading.text.includes('步长的选择'));
  const block = await showCard(page, link(page, '#chain-rule-def'), 'card-block');
  expect('block card', block?.text === '链式法则把复合函数的导数写成各层导数的乘积。');
  const samePage = await showCard(page, link(page, '#components'), 'card-same-page');
  expect('same page card', samePage?.text.startsWith('#组件'));
  const counts = Object.fromEntries(['/features/sections.json', '/paper/sections.json'].map((path) => [path, requests.filter((request) => request === path).length]));
  console.log(`sections.json requests: ${JSON.stringify(counts)}`);
  expect('sections.json once per page', counts['/features/sections.json'] === 1 && counts['/paper/sections.json'] === 1);
  await context.close();
  server.close();
}

async function crossPage() {
  const server = await serveDist();
  const { context, page, requests } = await open(server.origin, '/bento/');
  const componentRequests = () => requests.filter((request) => request.startsWith('/assets/components/'));
  console.log(`component scripts before hover: ${JSON.stringify(componentRequests())}`);
  expect('no component script before hover', componentRequests().length === 0);
  const before = await page.evaluate(() => document.querySelectorAll('#math-defs path').length);
  await showCard(page, link(page, '/features/#math'), 'card-math');
  const math = await page.evaluate(() => {
    const card = document.querySelector('.link-preview');
    const used = [...card.querySelectorAll('use')].map((use) => use.getAttribute('href').slice(1));
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    return {
      glyphs: document.querySelectorAll('#math-defs path').length,
      missing: used.filter((id) => !document.querySelector(`#math-defs [id="${id}"]`)),
      widths: [...card.querySelectorAll('.math > svg')].map((svg) => Math.round(svg.getBBox().width)),
      duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
    };
  });
  console.log(`glyphs in #math-defs: ${before} before, ${math.glyphs} after; missing ${JSON.stringify(math.missing)}; formula widths ${JSON.stringify(math.widths)}; duplicate ids ${JSON.stringify(math.duplicates)}`);
  expect('math glyphs', math.glyphs > before && math.missing.length === 0 && math.widths.every((width) => width > 0) && math.duplicates.length === 0);
  await showCard(page, link(page, '/features/#components'), 'card-components');
  await page.waitForFunction(() => customElements.get('demo-plot') !== undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, 'card-components.png'), caret: 'initial' });
  const drawn = await page.locator('.link-preview demo-plot > svg').count();
  console.log(`component scripts after hover: ${JSON.stringify(componentRequests())}; drawn demo-plot: ${drawn}`);
  expect('component loaded', componentRequests().length === 1 && drawn === 2);
  await context.close();
  server.close();
}

async function recording() {
  const server = await serveDist();
  const { context, page } = await open(server.origin, '/features/', { recordVideo: { dir: output, size: { width: 1280, height: 800 } } });
  const target = link(page, '/paper/#step-size');
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await target.boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y - 80, { steps: 5 });
  await page.mouse.move(centre.x, centre.y, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.move(centre.x, centre.y - 80, { steps: 5 });
  await page.waitForTimeout(800);
  const quick = await page.locator('.link-preview').count();
  console.log(`after passing over the link for about 150ms: ${quick} card`);
  expect('quick pass shows no card', quick === 0);
  await page.mouse.move(centre.x, centre.y, { steps: 5 });
  await page.waitForTimeout(900);
  const shown = await page.locator('.link-preview').count();
  console.log(`after staying on the link: ${shown} card`);
  expect('card after stay', shown === 1);
  const card = await page.locator('.link-preview').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + Math.min(card.height / 2, 60), { steps: 6 });
  await page.waitForTimeout(1200);
  const kept = await page.locator('.link-preview').count();
  console.log(`after moving into the card: ${kept} card`);
  expect('card kept', kept === 1);
  await page.mouse.move(card.x + card.width + 200, card.y + card.height + 100, { steps: 6 });
  await page.waitForTimeout(800);
  const closed = await page.locator('.link-preview').count();
  console.log(`after leaving the card: ${closed} card`);
  expect('card closed', closed === 0);
  const video = await page.video().path();
  await context.close();
  renameSync(video, join(output, 'hover.webm'));
  console.log(`video: ${join(output, 'hover.webm')}`);
  server.close();
}

async function dev() {
  const reading = await open(origin, '/features/');
  await showCard(reading.page, link(reading.page, '/paper/#step-size'), 'dev-reading');
  expect('reading mode preview request', reading.requests.some((request) => request === '/__bake/preview'));
  await reading.context.close();
  const editing = await open(origin, '/features/');
  await editing.page.click('.bake-edit-toggle');
  await editing.page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
  const card = await showCard(editing.page, link(editing.page, '/paper#step-size', '.milkdown'), 'dev-editing');
  expect('editing mode card', card?.text.includes('步长的选择'));
  await editing.context.close();
}

async function placeCursor(page, text, { select = false } = {}) {
  await page.evaluate(
    ({ text, select }) => {
      const editor = document.querySelector('.milkdown .editor');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(text);
        if (index === -1) continue;
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

async function pick(page, name, { anchor, select, query }) {
  const file = join(blog, 'content/features.md');
  const before = readFileSync(file, 'utf8');
  await placeCursor(page, anchor, { select });
  const sections = page.waitForResponse((response) => response.url().endsWith('/__bake/sections'));
  await page.keyboard.press('ControlOrMeta+k');
  await sections;
  await page.fill('.link-picker input', query);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(output, `${name}.png`), caret: 'initial' });
  const first = await page.locator('.link-picker li').first().textContent().catch(() => '');
  console.log(`${name}: query ${JSON.stringify(query)}, first candidate ${JSON.stringify(first)}`);
  const saved = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await page.keyboard.press('Enter');
  await saved;
  await page.waitForTimeout(300);
  const diff = changedLines(before, readFileSync(file, 'utf8'));
  writeFileSync(join(output, `${name}.diff`), `${diff}\n`);
  console.log(diff.split('\n').map((line) => `  ${line}`).join('\n'));
  return diff;
}

async function picker() {
  const { context, page } = await open(origin, '/features/');
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
  const site = await pick(page, 'picker-site', { anchor: '最后得到的是损失对每个参数的梯度。', query: '更新规则' });
  expect('site link', site.includes('+ 最后得到的是损失对每个参数的梯度。[更新规则](/paper#update)') && site.split('\n').length === 2);
  const same = await pick(page, 'picker-same-page', { anchor: '反向传播从损失函数开始', select: true, query: '链式法则把' });
  expect('same page link', same.includes('+ [反向传播从损失函数开始](#chain-rule-def)') && same.split('\n').length === 2);
  const external = await pick(page, 'picker-external', { anchor: '正文段落。', query: 'https://example.com/docs' });
  expect('external link', external.includes('+ 正文段落。<https://example.com/docs>') && external.split('\n').length === 2);
  await context.close();
}

mkdirSync(output, { recursive: true });
await { kinds, cross: crossPage, recording, dev, picker }[scenario]();
await browser.close();
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
