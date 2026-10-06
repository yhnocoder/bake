import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { createDevServer } from '../src/dev/index.js';

const example = join(import.meta.dirname, '..', 'examples', 'minimal');
let root;
let server;
let origin;
let browser;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function listing(directory) {
  return readdirSync(directory, { recursive: true }).sort();
}

async function post(path, body) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

function edit(path, replace) {
  const file = join(root, path);
  writeFileSync(file, replace(readFileSync(file, 'utf8')));
}

async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(origin + url);
  await page.waitForFunction(() => document.querySelector('.bake-status-problems')?.textContent);
  await page.evaluate(() => {
    window.marker = 'kept';
    window.updates = 0;
    window.addEventListener('bake:page-update', () => window.updates++);
  });
  return { page, errors };
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'bake-dev-'));
  cpSync(example, root, { recursive: true });
  server = await createDevServer({ root, port: 0 });
  origin = `http://localhost:${server.httpServer.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('页面', () => {
  test('页面地址返回整页 HTML，包含 Vite 客户端和组件入口', async () => {
    const response = await fetch(`${origin}/features/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<script type="module" src="\/@vite\/client"><\/script>/);
    assert.match(html, /<script type="module" src="\/@id\/__x00__bake:component\/demo-plot"><\/script>/);
    assert.match(html, /<script type="application\/json" id="bake-status">\{"errors":\[\],"links":\[\]\}<\/script>/);
    assert.match(html, /<article>/);
  });

  test('只引用正文用到的组件', async () => {
    const html = await (await fetch(`${origin}/bento/`)).text();
    assert.doesNotMatch(html, /bake:component/);
  });

  test('不存在的页面返回 404 和一行说明', async () => {
    const response = await fetch(`${origin}/missing/`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'No page at /missing/\n');
  });

  test('图片按文章所在目录的 assets/ 提供', async () => {
    const response = await fetch(`${origin}/features/assets/neuron.svg`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(join(root, 'content/assets/neuron.svg'), 'utf8'));
  });
});

describe('接口', () => {
  test('/__bake/source 返回原文和哈希', async () => {
    const response = await fetch(`${origin}/__bake/source?page=/paper/`);
    const markdown = readFileSync(join(root, 'content/paper.md'), 'utf8');
    assert.deepEqual(await response.json(), { path: 'content/paper.md', markdown, hash: sha256(markdown) });
  });

  test('/__bake/source 对不存在的页面返回 404', async () => {
    const response = await fetch(`${origin}/__bake/source?page=/missing/`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'No page at /missing/' });
  });

  test('/__bake/save 在哈希相同时写入，不同时返回 409 和磁盘上的版本', async () => {
    const file = join(root, 'content/paper.md');
    const original = readFileSync(file, 'utf8');
    const changed = original.replace('本文从一元函数出发', '本文从一元函数开始');
    const saved = await post('/__bake/save', { page: '/paper/', markdown: changed, hash: sha256(original) });
    assert.deepEqual(saved, { status: 200, body: { hash: sha256(changed) } });
    assert.equal(readFileSync(file, 'utf8'), changed);

    const conflict = await post('/__bake/save', { page: '/paper/', markdown: original, hash: sha256(original) });
    assert.deepEqual(conflict, { status: 409, body: { markdown: changed, hash: sha256(changed) } });
    assert.equal(readFileSync(file, 'utf8'), changed);
  });

  test('/__bake/save 对缺少字段的请求返回 400', async () => {
    const response = await post('/__bake/save', { page: '/paper/' });
    assert.deepEqual(response, { status: 400, body: { error: 'Missing string field markdown' } });
  });

  test('/__bake/asset 写入文章所在目录的 assets/，重复写入不产生新文件', async () => {
    const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const name = `${createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex').slice(0, 8)}.svg`;
    const first = await post('/__bake/asset', { page: '/features/', data, ext: 'svg' });
    assert.deepEqual(first, { status: 200, body: { path: `./assets/${name}` } });
    assert.equal(readFileSync(join(root, 'content/assets', name), 'base64'), data);
    const files = listing(join(root, 'content/assets'));
    const second = await post('/__bake/asset', { page: '/features/', data, ext: 'svg' });
    assert.deepEqual(second, first);
    assert.deepEqual(listing(join(root, 'content/assets')), files);
  });

  test('/__bake/asset 拒绝图片以外的扩展名', async () => {
    const files = listing(join(root, 'content'));
    const response = await post('/__bake/asset', { page: '/features/', data: 'AAAA', ext: 'js' });
    assert.deepEqual(response, { status: 400, body: { error: 'Unsupported image extension js' } });
    assert.deepEqual(listing(join(root, 'content')), files);
  });

  test('page 指向 content/ 之外时返回 403，文件系统不变', async () => {
    const files = listing(root);
    const save = await post('/__bake/save', { page: '/../../outside/', markdown: 'x', hash: sha256('') });
    const asset = await post('/__bake/asset', { page: '/../', data: 'AAAA', ext: 'png' });
    assert.deepEqual(save, { status: 403, body: { error: 'Path is outside content/' } });
    assert.deepEqual(asset, { status: 403, body: { error: 'Path is outside content/' } });
    assert.deepEqual(listing(root), files);
    assert.equal(existsSync(join(root, 'outside')), false);
  });
});

describe('文件变化', () => {
  test('在编辑器之外修改 .md 后正文就地更新，不刷新整页，滚动位置不变', async () => {
    const { page, errors } = await open('/features/');
    await page.evaluate(() => window.scrollTo(0, 600));
    const glyphs = await page.evaluate(() => document.querySelectorAll('svg defs path[id]').length);
    edit('content/features.md', (source) => source.replace('梯度指向函数值', '梯度给出函数值 $\\gamma$ '));
    await page.waitForFunction(() => document.querySelector('article').textContent.includes('梯度给出函数值'));
    assert.equal(await page.evaluate(() => window.marker), 'kept');
    assert.equal(await page.evaluate(() => window.scrollY), 600);
    assert.ok(await page.evaluate(() => document.querySelectorAll('svg defs path[id]').length) > glyphs);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('通过 /__bake/save 写入后页面不收到 bake:page', async () => {
    const { page } = await open('/paper/');
    const source = await (await fetch(`${origin}/__bake/source?page=/paper/`)).json();
    await post('/__bake/save', { page: '/paper/', markdown: source.markdown.replace('沿负梯度方向移动', '沿负梯度方向前进'), hash: source.hash });
    edit('content/paper.md', (source) => source.replace('方向前进', '方向走一步'));
    await page.waitForFunction(() => document.querySelector('article').textContent.includes('方向走一步'));
    assert.equal(await page.evaluate(() => window.updates), 1);
    await page.close();
  });

  test('可以取消 bake:page-update，正文不被替换', async () => {
    const { page } = await open('/paper/');
    await page.evaluate(() => {
      window.addEventListener('bake:page-update', (event) => event.preventDefault());
      window.addEventListener('bake:page-updated', () => (window.updated = true));
    });
    const before = await page.evaluate(() => document.querySelector('article').innerHTML);
    edit('content/paper.md', (source) => source.replace('方向走一步', '方向移动'));
    await page.waitForFunction(() => window.updated);
    assert.equal(await page.evaluate(() => document.querySelector('article').innerHTML), before);
    await page.close();
  });

  test('修改 layout 后页面结构就地替换，<article> 是同一个元素', async () => {
    const { page, errors } = await open('/features/');
    await page.evaluate(() => (window.article = document.querySelector('article')));
    edit('content/features.md', (source) => source.replace('layout: essay', 'layout: paper'));
    await page.waitForFunction(() => document.querySelector('main.layout-paper'));
    assert.equal(await page.evaluate(() => window.marker), 'kept');
    assert.equal(await page.evaluate(() => document.querySelector('article') === window.article), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('article').length), 1);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.bake-status').length), 1);
    assert.deepEqual(errors, []);
    edit('content/features.md', (source) => source.replace('layout: paper', 'layout: essay'));
    await page.waitForFunction(() => document.querySelector('main.layout-essay'));
    await page.close();
  });

  test('渲染错误和断开的站内链接显示在状态栏', async () => {
    const { page } = await open('/features/');
    edit('content/features.md', (source) => `${source}\n[断开](/missing/)\n\n:::callot\n内容\n:::\n`);
    await page.waitForFunction(() => document.querySelector('.bake-status-problems').textContent !== '没有错误');
    assert.equal(await page.evaluate(() => document.querySelector('.bake-status-problems').textContent), '1 个渲染错误，1 个断开的站内链接');
    await page.click('.bake-status-problems');
    const items = await page.evaluate(() => [...document.querySelectorAll('.bake-status-list li')].map((item) => item.textContent));
    assert.equal(items.length, 2);
    assert.match(items[0], /^content\/features\.md:\d+:1 Unknown directive :::callot$/);
    assert.match(items[1], /^content\/features\.md:\d+:1 Link points to a missing page \/missing\/$/);
    await page.close();
  });

  test('修改组件 .js 后实例被替换，属性不变，没有刷新整页', async () => {
    const { page, errors } = await open('/features/');
    const attributes = () => [...document.querySelectorAll('demo-plot')].map((element) => [...element.attributes].map(({ name, value }) => `${name}=${value}`).join(' '));
    await page.waitForFunction(() => customElements.get('demo-plot'));
    const before = await page.evaluate(attributes);
    await page.evaluate(() => (window.plots = [...document.querySelectorAll('demo-plot')]));
    edit('components/demo-plot.js', (source) => source.replace("'#2f6fb3'", "'#c0392b'"));
    await page.waitForFunction(() => document.querySelector('demo-plot polyline[stroke="#c0392b"]'));
    assert.equal(await page.evaluate(() => window.marker), 'kept');
    assert.deepEqual(await page.evaluate(attributes), before);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('demo-plot')].some((element) => window.plots.includes(element))), false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('demo-plot > svg').length), before.length);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
