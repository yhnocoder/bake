import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { parse } from '../../src/format/index.js';

const root = join(import.meta.dirname, '..', '..');
const fixtures = join(root, 'test/fixtures/clipboard');
const userSamples = ['vscode-python', 'vscode-markdown', 'markdown-text', 'excel', 'numbers', 'google-sheets', 'screenshot', 'finder-png', 'finder-svg', 'svg-source', 'browser-image', 'safari-bake-page'];
const emptyArticle = { path: 'content/empty.md', url: '/empty/', frontmatter: '---\ntitle: 空白\nslug: empty\n---\n' };
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const base = '/blog/';
const problems = [];
const [scenario, ...args] = process.argv.slice(2);

function watch(page) {
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return page;
}

function body(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
}

function diff(before, after, output, name) {
  const beforeFile = join(output, `${name}.before.md`);
  const afterFile = join(output, `${name}.after.md`);
  writeFileSync(beforeFile, before);
  writeFileSync(afterFile, after);
  const result = spawnSync('diff', ['-u', '--label', `${name} 之前`, '--label', `${name} 之后`, beforeFile, afterFile], { encoding: 'utf8' });
  writeFileSync(join(output, `${name}.diff`), result.stdout);
  return result.stdout;
}

async function serve(dist) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = path.startsWith(base) ? path.slice(base.length - 1) : null;
    const file = relative === null ? null : resolve(join(dist, relative.endsWith('/') ? `${relative}index.html` : relative));
    const content = file?.startsWith(dist + sep) ? await readFile(file).catch(() => undefined) : undefined;
    if (content === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(content);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function openEditor(context, origin, url) {
  const page = watch(await context.newPage());
  while ((await page.goto(`${origin}${url}`)).status() === 404) await page.waitForTimeout(50);
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  return page;
}

async function waitForSave(page, action) {
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await action();
  await response;
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
}

async function readClipboard(page) {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read({ unsanitized: ['text/html'] });
    const read = async (type) => (item.types.includes(type) ? (await item.getType(type)).text() : '');
    return { types: item.types, text: await read('text/plain'), html: await read('text/html') };
  });
}

async function openBuiltPage(context, origin) {
  const page = watch(await context.newPage());
  await page.goto(`${origin}${base}features/`);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('copy-markdown')));
  return page;
}

function selectText(points) {
  const place = ([selector, value, edge]) => {
    const element = document.querySelector(selector);
    if (value === undefined) return [element, 0];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const index = walker.currentNode.data.indexOf(value);
      if (index !== -1) return [walker.currentNode, edge === 'before' ? index : index + value.length];
    }
    throw new Error(`Text not found: ${value}`);
  };
  const range = document.createRange();
  if (points === 'article') range.selectNodeContents(document.querySelector('article'));
  else {
    range.setStart(...place(points.start));
    range.setEnd(...place(points.end));
  }
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

async function newContext(browser, origins) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const origin of origins) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  return context;
}

async function samples(browser, origin, blog, output) {
  const context = await newContext(browser, [origin]);
  const names = readdirSync(fixtures).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort();
  for (const name of names) {
    const sample = JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'));
    const expectedFile = join(fixtures, `${name}.expected.md`);
    const before = `${emptyArticle.frontmatter}`;
    writeFileSync(join(blog, emptyArticle.path), before);
    const page = await openEditor(context, origin, emptyArticle.url);
    await page.evaluate(() => document.querySelector('.milkdown .editor').focus());
    await waitForSave(page, () =>
      page.evaluate(({ types, files }) => {
        const data = new DataTransfer();
        for (const [type, value] of Object.entries(types)) data.setData(type, value);
        for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))], file.name, { type: file.type }));
        document.querySelector('.milkdown .editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, { types: sample.types ?? {}, files: sample.files ?? [] }),
    );
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    const after = readFileSync(join(blog, emptyArticle.path), 'utf8');
    await page.close();
    console.log(`## ${name}`);
    console.log(`source: ${sample.source}`);
    console.log(`clipboard types: ${[...Object.keys(sample.types ?? {}), ...(sample.files ?? []).map((file) => `file ${file.type}`)].join(', ')}`);
    console.log(diff(before, after, output, name));
    if (!existsSync(expectedFile)) problems.push(`${name}: no ${name}.expected.md`);
    else if (body(after) !== readFileSync(expectedFile, 'utf8')) problems.push(`${name}: the saved body differs from ${name}.expected.md`);
  }
  const missing = userSamples.filter((name) => !names.includes(name));
  console.log(`user samples not committed yet, not executed: ${missing.join(', ') || 'none'}`);
  writeFileSync(join(output, 'missing.txt'), missing.join('\n'));
}

async function pageCopy(browser, dist, output) {
  const { server, origin } = await serve(dist);
  const context = await newContext(browser, [origin]);
  const page = await openBuiltPage(context, origin);
  const selections = {
    all: 'article',
    'formula-part': { start: ['[data-tex="E = mc^2"] svg'], end: ['article p:has([data-tex="E = mc^2"])', '写在', 'after'] },
    'component-part': { start: ['demo-plot figcaption', '从', 'before'], end: ['demo-plot figcaption', '出发', 'after'] },
    'sidenote-paragraph': { start: ['article p:has(#sn-ref-2)', '激活', 'before'], end: ['article p:has(#sn-ref-2)', '的层。', 'after'] },
  };
  for (const [name, points] of Object.entries(selections)) {
    await page.evaluate(selectText, points);
    await page.keyboard.press('Control+c');
    const content = await readClipboard(page);
    writeFileSync(join(output, `${name}.md`), content.text);
    writeFileSync(join(output, `${name}.html`), content.html);
    await page.evaluate(() => getSelection().getRangeAt(0).startContainer.parentElement.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: join(output, `${name}.png`) });
    console.log(`## ${name}`);
    console.log(`clipboard types: ${content.types.join(', ')}`);
    console.log('text/plain:');
    console.log(name === 'all' ? `${content.text.split('\n').slice(0, 12).join('\n')}\n…（全文见 page-copy/all.md）` : content.text);
    console.log(`text/html (first 200 characters): ${content.html.slice(0, 200)}`);
    console.log('');
    if (!content.html.startsWith('<div data-bake-markdown="">')) problems.push(`${name}: the HTML does not start with the data-bake-markdown marker`);
  }
  await context.close();
  server.close();
}

function htmlBlocks(markdown) {
  return parse(markdown).tree.children.filter((node) => node.type === 'html').map((node) => markdown.slice(node.position.start.offset, node.position.end.offset));
}

async function normalizeHtmlBlocks(page, markdown) {
  const blocks = htmlBlocks(markdown);
  const rendered = await page.evaluate((list) => list.map((html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.innerHTML;
  }), blocks);
  return blocks.reduce((text, block, index) => text.replace(block, rendered[index]), markdown);
}

async function pagePaste(browser, dist, origin, blog, output) {
  const { server, origin: builtOrigin } = await serve(dist);
  const context = await newContext(browser, [builtOrigin, origin]);
  const page = await openBuiltPage(context, builtOrigin);
  await page.evaluate(selectText, 'article');
  await page.keyboard.press('Control+c');
  writeFileSync(join(blog, emptyArticle.path), emptyArticle.frontmatter);
  const editor = await openEditor(context, origin, emptyArticle.url);
  await editor.evaluate(() => document.querySelector('.milkdown .editor').focus());
  await waitForSave(editor, () => editor.keyboard.press('Control+v'));
  await editor.screenshot({ path: join(output, 'pasted.png'), fullPage: true });
  const pasted = body(readFileSync(join(blog, emptyArticle.path), 'utf8'));
  const source = body(readFileSync(join(blog, 'content/features.md'), 'utf8'));
  console.log('raw diff between features.md and the pasted article (written to page-paste/raw.diff):');
  console.log(diff(source, pasted, output, 'raw') || '(empty)');
  const builtLinks = source.replaceAll('](/features#', '](/features/#');
  const normalized = diff(await normalizeHtmlBlocks(editor, builtLinks), await normalizeHtmlBlocks(editor, pasted), output, 'normalized');
  console.log('diff with HTML blocks compared as the DOM serialization, and the link /features#chain-rule written in the form the build outputs, /features/#chain-rule (written to page-paste/normalized.diff):');
  console.log(normalized || '(empty)');
  if (normalized !== '') problems.push('the pasted article differs from features.md');
  await context.close();
  server.close();
}

async function selectInEditor(page, startText, endText, { collapse = false } = {}) {
  await page.evaluate(async ({ startText, endText, collapse }) => {
    const editor = document.querySelector('.milkdown .editor');
    const find = (text) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(text);
        if (index !== -1) return [walker.currentNode, index];
      }
      throw new Error(`Text not found: ${text}`);
    };
    const [startNode, startIndex] = find(startText);
    const [endNode, endIndex] = find(endText);
    editor.focus();
    const range = document.createRange();
    range.setStart(startNode, startIndex);
    range.setEnd(endNode, endIndex + endText.length);
    if (collapse) range.collapse(false);
    const changed = new Promise((resolve) => document.addEventListener('selectionchange', resolve, { once: true }));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    await changed;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, { startText, endText, collapse });
}

async function editorCopy(browser, origin, blog, output) {
  const context = await newContext(browser, [origin]);
  const path = join(blog, 'content/features.md');
  const before = readFileSync(path, 'utf8');
  const page = await openEditor(context, origin, '/features/');
  await selectInEditor(page, '每一层的梯度都由', '再按顺序连乘起来。');
  await page.keyboard.press('Control+c');
  const content = await readClipboard(page);
  writeFileSync(join(output, 'clipboard.md'), content.text);
  console.log('clipboard text/plain:');
  console.log(content.text);
  console.log('');
  await selectInEditor(page, '优化器用这些梯度更新参数，进入下一轮前向传播。', '优化器用这些梯度更新参数，进入下一轮前向传播。', { collapse: true });
  await waitForSave(page, () => page.keyboard.press('Control+v'));
  await page.screenshot({ path: join(output, 'pasted.png'), fullPage: true });
  const after = readFileSync(path, 'utf8');
  console.log('file diff (written to editor-copy/features.diff):');
  console.log(diff(before, after, output, 'features'));
  if (!content.text.includes('$\\partial y / \\partial x$')) problems.push('the copied text does not contain the formula of the sidenote');
  if (!/\[\^d\]:/.test(content.text)) problems.push('the copied text does not contain the sidenote definition');
  writeFileSync(path, before);
  await context.close();
}

async function imageTwice(browser, origin, blog, output) {
  const context = await newContext(browser, [origin]);
  const assets = join(blog, 'content/assets');
  const listAssets = () => readdirSync(assets).sort();
  const beforeAssets = listAssets();
  writeFileSync(join(blog, emptyArticle.path), `${emptyArticle.frontmatter}\n第一段。\n\n第二段。\n`);
  const before = readFileSync(join(blog, emptyArticle.path), 'utf8');
  const page = await openEditor(context, origin, emptyArticle.url);
  const screenshot = (await page.screenshot({ clip: { x: 340, y: 40, width: 320, height: 130 } })).toString('base64');
  await selectInEditor(page, '第二段。', '第二段。', { collapse: true });
  for (let time = 0; time < 2; time++) {
    await page.evaluate(async (base64) => {
      const blob = new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], { type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, screenshot);
    await waitForSave(page, () => page.keyboard.press('Control+v'));
  }
  await page.screenshot({ path: join(output, 'pasted.png'), fullPage: true });
  const after = readFileSync(join(blog, emptyArticle.path), 'utf8');
  const added = listAssets().filter((name) => !beforeAssets.includes(name));
  console.log(`assets/ before: ${beforeAssets.join(', ')}`);
  console.log(`assets/ after: ${listAssets().join(', ')}`);
  console.log(`added: ${added.join(', ') || 'none'}`);
  console.log('file diff (written to image-twice/empty.diff):');
  console.log(diff(before, after, output, 'empty'));
  if (added.length !== 1) problems.push(`expected one new file in assets/, found ${added.length}`);
  else if (body(after) !== `第一段。\n\n第二段。\n\n![](./assets/${added[0]})\n\n![](./assets/${added[0]})\n`) problems.push('the article does not reference the saved image twice');
  await context.close();
}

function size(dist, limit) {
  const chunks = join(dist, 'assets/chunks');
  const [chunk] = readdirSync(chunks).filter((name) => name.startsWith('copy-markdown.'));
  const content = readFileSync(join(chunks, chunk));
  const compressed = gzipSync(content, { level: 9 }).length;
  console.log(`assets/chunks/${chunk}: ${content.length} bytes, ${compressed} bytes after gzip -9 (limit ${limit} bytes)`);
  if (compressed > limit) problems.push(`copy-markdown.js is ${compressed} bytes after gzip, above the limit of ${limit} bytes`);
}

if (scenario === 'size') size(args[0], Number(args[1]));
else {
  const output = args.at(-1);
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  const run = { samples, 'page-copy': pageCopy, 'page-paste': pagePaste, 'editor-copy': editorCopy, 'image-twice': imageTwice }[scenario];
  await run(browser, ...args);
  await browser.close();
}
for (const problem of problems) console.log(problem);
process.exitCode = problems.length > 0 ? 1 : 0;
