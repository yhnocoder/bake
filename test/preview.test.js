import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { build } from '../src/build/index.js';

const example = join(import.meta.dirname, '..', 'examples', 'minimal');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
let root;
let server;
let origin;
let browser;
let page;
let requests;
let errors;

async function serve(directory) {
  const http = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = join(directory, normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname));
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => http.listen(0, '127.0.0.1', done));
  return http;
}

async function open(url) {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10000);
  requests = [];
  errors = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(origin + url);
  await page.evaluate(() => document.fonts.ready);
}

function link(href) {
  return page.locator(`article a[href="${href}"]:not(.anchor)`).first();
}

async function hoverAndWait(locator, wait = 600) {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await page.waitForTimeout(wait);
}

async function moveAway() {
  await page.mouse.move(2, 2);
}

const cards = () => page.locator('.link-preview');
const sectionRequests = (path) => requests.filter((request) => request === path).length;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'bake-preview-'));
  cpSync(example, root, { recursive: true });
  writeFileSync(join(root, 'content/extra.md'), '---\ntitle: 补充\nslug: extra\n---\n\n见[站内引用](/features#links)。\n');
  const result = await build(root, { out: 'dist' });
  assert.deepEqual(result.errors, []);
  server = await serve(join(root, 'dist'));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
});

describe('悬停时间', () => {
  test('停留不足 300ms 就离开时不请求 sections.json，没有卡片', async () => {
    await open('/features/');
    const target = link('/paper/');
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    await page.waitForTimeout(100);
    await moveAway();
    await page.waitForTimeout(600);
    assert.equal(sectionRequests('/paper/sections.json'), 0);
    assert.equal(await cards().count(), 0);
  });

  test('停留 300ms 后出现卡片，同一页的另一个链接不再请求 sections.json', async () => {
    await open('/features/');
    await hoverAndWait(link('/paper/'));
    assert.equal(await cards().count(), 1);
    await moveAway();
    await hoverAndWait(link('/paper/#step-size'));
    assert.equal(await cards().count(), 1);
    assert.match(await cards().textContent(), /步长的选择/);
    assert.equal(sectionRequests('/paper/sections.json'), 1);
    assert.deepEqual(errors, []);
  });

  test('离开链接后进入卡片，卡片保持；离开卡片 200ms 后关闭', async () => {
    await open('/features/');
    await hoverAndWait(link('#components'));
    const box = await cards().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(500);
    assert.equal(await cards().count(), 1);
    await moveAway();
    await page.waitForTimeout(80);
    assert.equal(await cards().count(), 1);
    await page.waitForTimeout(520);
    assert.equal(await cards().count(), 0);
  });
});

describe('卡片内容', () => {
  test('整篇文章、标题、段落、同页 #id', async () => {
    await open('/features/');
    await hoverAndWait(link('/paper/'));
    assert.equal(await page.locator('.link-preview-title').textContent(), '用梯度下降求函数的最小值');
    assert.equal(await page.locator('.link-preview-body').innerHTML(), '');
    await moveAway();
    await hoverAndWait(link('/paper/#step-size'));
    assert.equal(await page.locator('.link-preview-title').count(), 0);
    assert.equal(await page.locator('.link-preview-body > h3').textContent(), '#步长的选择');
    assert.equal(await page.locator('.link-preview-body > h2').count(), 0);
    await moveAway();
    await hoverAndWait(link('#chain-rule-def'));
    assert.equal(await page.locator('.link-preview-body').innerHTML(), '<p>链式法则把复合函数的导数写成各层导数的乘积。</p>');
    await moveAway();
    await hoverAndWait(link('#components'));
    assert.match(await page.locator('.link-preview-body > h2').textContent(), /组件/);
    assert.equal(await page.locator('.link-preview demo-plot').count(), 2);
    assert.equal(sectionRequests('/features/sections.json'), 1);
    assert.deepEqual(errors, []);
  });

  test('卡片中的链接不触发预览', async () => {
    await open('/extra/');
    await hoverAndWait(link('/features/#links'));
    const inner = page.locator('.link-preview a[href="/paper/"]');
    await inner.hover();
    await page.waitForTimeout(600);
    assert.equal(await cards().count(), 1);
    assert.match(await cards().textContent(), /站内引用/);
    assert.equal(sectionRequests('/paper/sections.json'), 0);
  });

  test('旁注编号、标题锚点、\\eqref 链接不触发预览', async () => {
    await open('/features/');
    for (const selector of ['sup.sidenote-ref a', 'h2#math a.anchor', 'a.eqref']) {
      await hoverAndWait(page.locator(`article ${selector}`).first());
      assert.equal(await cards().count(), 0, selector);
    }
    assert.equal(sectionRequests('/features/sections.json'), 0);
  });
});

describe('跨页面的公式和组件', () => {
  test('在 bento.md 上预览 /features#math：字形加入 #math-defs，公式有宽度，没有重复 id', async () => {
    await open('/bento/');
    const before = await page.evaluate(() => [...document.querySelectorAll('#math-defs path')].map((path) => path.id));
    await hoverAndWait(link('/features/#math'));
    const result = await page.evaluate(() => {
      const card = document.querySelector('.link-preview');
      const used = [...card.querySelectorAll('use')].map((use) => use.getAttribute('href').slice(1));
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      return {
        used,
        missing: used.filter((id) => !document.querySelector(`#math-defs [id="${id}"]`)),
        widths: [...card.querySelectorAll('.math > svg')].map((svg) => svg.getBBox().width),
        duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
      };
    });
    assert.ok(result.used.some((id) => !before.includes(id)));
    assert.deepEqual(result.missing, []);
    assert.ok(result.widths.length > 0);
    assert.ok(result.widths.every((width) => width > 0));
    assert.deepEqual(result.duplicates, []);
    assert.deepEqual(errors, []);
  });

  test('在 bento.md 上预览 /features#components：悬停后才加载组件脚本，卡片里的组件画出 SVG', async () => {
    await open('/bento/');
    const isComponentScript = (request) => request.startsWith('/assets/components/demo-plot.');
    assert.equal(requests.filter(isComponentScript).length, 0);
    assert.equal(await page.evaluate(() => customElements.get('demo-plot') === undefined), true);
    await hoverAndWait(link('/features/#components'));
    await page.waitForFunction(() => customElements.get('demo-plot') !== undefined);
    assert.equal(requests.filter(isComponentScript).length, 1);
    assert.ok(await page.locator('.link-preview demo-plot > svg').count() >= 1);
    assert.deepEqual(errors, []);
  });
});

describe('预览脚本', () => {
  test('没有站内链接的页面不加载预览脚本', async () => {
    await open('/paper/');
    assert.equal(requests.filter((request) => request.includes('preview-static')).length, 0);
    await page.close();
    await open('/features/');
    assert.equal(requests.filter((request) => request.includes('preview-static')).length, 1);
    assert.deepEqual(errors, []);
  });
});
