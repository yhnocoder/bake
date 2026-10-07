import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { build } from '../../src/build/index.js';
import { parse } from '../../src/format/index.js';
import { gotoPage, startSite } from '../editor/setup.js';
import { articleBody, clipboardContent, emptyArticle, waitForSave } from './setup.js';

const copyMarkdownLimit = 16 * 1024;
const base = '/blog/';
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const source = readFileSync(join(import.meta.dirname, '..', '..', 'examples/minimal/content/features.md'), 'utf8');
const blocks = parse(source).tree.children.filter((node) => node.type !== 'yaml');
let blog;
let dist;
let server;
let origin;
let site;
let context;
let page;

function sourceOf(node) {
  return source.slice(node.position.start.offset, node.position.end.offset);
}

function withBuiltLinks(markdown) {
  return markdown.replaceAll('](/features#', '](/features/#');
}

function referencedDefinitions(node) {
  const labels = [...sourceOf(node).matchAll(/\[\^([^\]]+)\](?!:)/g)].map((match) => match[1]);
  return labels.map((label) => blocks.find((block) => block.type === 'footnoteDefinition' && block.label === label)).filter(Boolean);
}

function expectedCopy(index) {
  const node = blocks[index];
  return withBuiltLinks([node, ...referencedDefinitions(node)].map(sourceOf).join('\n\n'));
}

function htmlBlocks(markdown) {
  return parse(markdown).tree.children.filter((node) => node.type === 'html').map((node) => markdown.slice(node.position.start.offset, node.position.end.offset));
}

async function sameRenderedHtml(actual, expected) {
  const normalize = (markdown, rendered) => htmlBlocks(markdown).reduce((text, block, index) => text.replace(block, rendered[index]), markdown);
  const render = (markdown) =>
    page.evaluate((list) => list.map((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.innerHTML;
    }), htmlBlocks(markdown));
  assert.equal(normalize(actual, await render(actual)), normalize(expected, await render(expected)));
}

async function copySelection(select, argument) {
  await page.evaluate(select, argument);
  await page.keyboard.press('Control+c');
  return clipboardContent(page);
}

function selectBlock(index) {
  const element = document.querySelector('article').children[index];
  const range = document.createRange();
  range.selectNode(element);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

before(async () => {
  blog = mkdtempSync(join(tmpdir(), 'bake-copy-page-'));
  cpSync(join(import.meta.dirname, '..', '..', 'examples/minimal'), blog, { recursive: true });
  writeFileSync(join(blog, 'bake.config.js'), "export default { title: 'bake minimal', theme: 'default', base: '/blog/', math: { macros: { R: '\\\\mathbb{R}' } } };\n");
  dist = join(blog, 'dist');
  const result = await build(blog, { out: dist });
  assert.deepEqual(result.errors, []);
  server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = path.startsWith(base) ? path.slice(base.length - 1) : null;
    const file = relative === null ? null : resolve(join(dist, relative.endsWith('/') ? `${relative}index.html` : relative));
    const body = file?.startsWith(dist + sep) ? await readFile(file).catch(() => undefined) : undefined;
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  site = await startSite('copy-paste-page');
  context = await site.browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  page = await context.newPage();
  await page.goto(`${origin}${base}features/`);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('copy-markdown')));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
});

after(async () => {
  await context?.close();
  await site?.close();
  server?.close();
  rmSync(blog, { recursive: true, force: true });
});

describe('从页面复制', () => {
  test('文章的顶层元素与源文件的顶层块一一对应', async () => {
    assert.equal(await page.evaluate(() => document.querySelector('article').children.length), blocks.length);
  });

  test('全选文章复制，得到 features.md 的正文', async () => {
    const { text, html } = await copySelection(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('article'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    site.record('page-copy-all.md', text);
    site.record('page-copy-all.html', html);
    await site.screenshot(page, 'page-copy-all');
    await sameRenderedHtml(text, withBuiltLinks(articleBody(source)).replace(/\n$/, ''));
    assert.match(html, /^<div data-bake-markdown=""><svg style="display:none"><defs><path id="MJX-/);
  });

  test('每个顶层块单独复制，得到源文件中的那一段', async () => {
    for (let index = 0; index < blocks.length; index++) {
      const { text } = await copySelection(selectBlock, index);
      await sameRenderedHtml(text, expectedCopy(index));
    }
  });

  const partial = [
    ['公式的一部分', { start: ['[data-tex="E = mc^2"] svg'], end: ['article p:has([data-tex="E = mc^2"])', '写在', 'after'] }, '$E = mc^2$ 写在'],
    ['组件的一部分', { start: ['demo-plot figcaption', '从', 'before'], end: ['demo-plot figcaption', '出发', 'after'] }, ':::demo-plot{x0=1.2}\n从 $x_0$ 出发沿负梯度方向下降。\n:::'],
    ['提示框中的一句', { start: ['aside.callout.note', '本文', 'before'], end: ['aside.callout.note', '列向量', 'after'] }, '本文的向量都是列向量'],
    ['代码块中的几行', { start: ['pre code', 'const', 'before'], end: ['pre code', '42', 'after'] }, 'const answer = 42'],
    ['带 base 的站内链接', { start: ['article p:has(a[href^="/blog/features/"])', '这里', 'before'], end: ['article p:has(a[href^="/blog/features/"])', '。', 'after'] }, '这里用到的是[链式法则](/features/#chain-rule)。'],
    ['只选带旁注引用的段落', { start: ['article p:has(#sn-ref-2)', '激活', 'before'], end: ['article p:has(#sn-ref-2)', '的层。', 'after'] }, ':span[激活函数的导数][^act]决定了梯度能否顺利传回前面的层。\n\n[^act]: ReLU 在正半轴的导数是 1。'],
  ];

  for (const [name, points, expected] of partial) {
    test(`部分选中：${name}`, async () => {
      const { text } = await copySelection((points) => {
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
        range.setStart(...place(points.start));
        range.setEnd(...place(points.end));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }, points);
      site.record(`page-copy-${name}.md`, text);
      await site.screenshot(page, `page-copy-${name}`);
      assert.equal(text, expected);
    });
  }

  test('部分选中：表格的一行', async () => {
    const { text } = await copySelection(() => {
      const row = [...document.querySelectorAll('article > .table-scroll tr')].find((element) => element.textContent.includes('GELU'));
      const range = document.createRange();
      range.selectNodeContents(row);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.equal(text, '| GELU | 0.5 |\n| - | -: |');
  });

  test('copy-markdown.js 在 load 之后请求，gzip 大小不超过上限', async () => {
    const timing = await page.evaluate(() => ({
      load: performance.getEntriesByType('navigation')[0].loadEventStart,
      request: performance.getEntriesByType('resource').find((entry) => entry.name.includes('copy-markdown')).startTime,
    }));
    assert.ok(timing.request >= timing.load, JSON.stringify(timing));
    const [chunk] = readdirSync(join(dist, 'assets/chunks')).filter((name) => name.startsWith('copy-markdown.'));
    const size = gzipSync(readFileSync(join(dist, 'assets/chunks', chunk)), { level: 9 }).length;
    site.record('copy-markdown-size.txt', `${chunk} ${size}\n`);
    assert.ok(size <= copyMarkdownLimit, `${chunk} is ${size} bytes after gzip`);
  });
});

describe('从页面复制后粘贴进编辑器', () => {
  test('每个顶层块复制后粘贴，保存的正文等于源文件中的那一段', async () => {
    const errors = [];
    for (const [index, node] of blocks.entries()) {
      const withHeading = node.type === 'leafDirective' && node.name === 'subtitle';
      const first = withHeading ? index - 1 : index;
      await page.bringToFront();
      await page.evaluate(({ first, last }) => {
        const children = document.querySelector('article').children;
        const range = document.createRange();
        range.setStartBefore(children[first]);
        range.setEndAfter(children[last]);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }, { first, last: index });
      await page.keyboard.press('Control+c');
      site.write(emptyArticle.path, emptyArticle.frontmatter);
      const opened = await context.newPage();
      opened.on('pageerror', (error) => errors.push(error.message));
      await gotoPage(opened, `${site.origin}${emptyArticle.url}`);
      await opened.click('.bake-edit-toggle');
      await opened.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
      await opened.evaluate(() => document.querySelector('.milkdown .editor').focus());
      await waitForSave(opened, () => opened.keyboard.press('Control+v'));
      if (index === 0 || index === blocks.length - 1) await site.screenshot(opened, `page-paste-block-${index}`);
      const expected = withHeading ? withBuiltLinks(`${sourceOf(blocks[first])}\n\n${sourceOf(node)}`) : expectedCopy(index);
      await sameRenderedHtml(articleBody(site.read(emptyArticle.path)).replace(/\n$/, ''), expected);
      await opened.close();
    }
    assert.deepEqual(errors, []);
  });
});
