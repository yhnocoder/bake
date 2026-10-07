import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { build } from 'vite';
import { bakeMath } from '../src/math/plugin.js';
import { bakeRuntime } from '../src/runtime/plugin.js';

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const siteJson = { pages: [{ url: '/a/', title: '文章 A' }], config: { categories: ['math'] } };
const sources = {
  'animate.html': '<div id="box" style="width:10px;height:10px"></div><script type="module" src="./animate.js"></script>',
  'animate.js': "import { animate } from 'bake/runtime';\nwindow.run = () => {\n  const box = document.getElementById('box');\n  window.animation = animate(box, { x: [0, 100] }, { duration: 10, ease: 'linear' });\n};\n",
  'layout.html': '<script type="module" src="./layout.js"></script>',
  'layout.js': "import { layoutText } from 'bake/runtime';\nwindow.layoutText = layoutText;\n",
  'math.html': '<script type="module" src="./math.js"></script>',
  'math.js': "import { renderMath } from 'bake/runtime';\nwindow.renderMath = renderMath;\n",
  'site.html': '<script type="module" src="./site-a.js"></script><script type="module" src="./site-b.js"></script>',
  'site-a.js': "import { site } from 'bake/runtime';\nwindow.siteA = site;\n",
  'site-b.js': "import { site } from 'bake/runtime';\nwindow.siteB = site;\n",
};
let root;
let browser;
const servers = [];

async function buildPages(base) {
  const outDir = join(root, `dist-${base.replaceAll('/', '')}`);
  await build({
    configFile: false,
    logLevel: 'silent',
    root,
    base,
    plugins: [bakeRuntime(), bakeMath({ getConfig: () => ({ math: { macros: { R: '\\mathbb{R}' } } }) })],
    build: {
      outDir,
      emptyOutDir: true,
      rolldownOptions: { input: Object.fromEntries(Object.keys(sources).filter((name) => name.endsWith('.html')).map((name) => [name.slice(0, -5), join(root, name)])) },
    },
  });
  writeFileSync(join(outDir, 'site.json'), JSON.stringify(siteJson));
  return outDir;
}

async function serve(directory, base) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = resolve(join(directory, path.slice(base.length - 1)));
    const body = path.startsWith(base) && file.startsWith(directory + sep) ? await readFile(file).catch(() => undefined) : undefined;
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}${base}`;
}

let origin;
let prefixedOrigin;

async function open(name, { url = origin, ...options } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`${url}${name}.html`);
  await page.waitForLoadState('networkidle');
  return { context, page, requests, errors };
}

function frames(page, count) {
  return page.evaluate((remaining) => new Promise((done) => {
    const next = () => (remaining-- === 0 ? done() : requestAnimationFrame(next));
    next();
  }), count);
}

function offsetOf(page) {
  return page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('box')).transform).e);
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'bake-runtime-'));
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(sources)) writeFileSync(join(root, name), content);
  origin = await serve(await buildPages('/'), '/');
  prefixedOrigin = await serve(await buildPages('/blog/'), '/blog/');
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('animate', () => {
  test('默认时调用后两帧内动画在进行中', async () => {
    const { context, page, errors } = await open('animate');
    await page.evaluate(() => window.run());
    await frames(page, 2);
    const offset = await offsetOf(page);
    assert.ok(offset > 0 && offset < 100, `offset ${offset}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('减少动态效果时调用后元素立即到达终点，finished 立即完成', async () => {
    const { context, page, errors } = await open('animate', { reducedMotion: 'reduce' });
    await page.evaluate(() => window.run());
    await frames(page, 2);
    assert.equal(await offsetOf(page), 100);
    assert.equal(await page.evaluate(() => Promise.race([window.animation.finished.then(() => 'finished'), new Promise((done) => setTimeout(() => done('pending'), 500))])), 'finished');
    assert.deepEqual(errors, []);
    await context.close();
  });
});

describe('layoutText', () => {
  test('返回每行的文字和宽度，height 等于行数乘 lineHeight', async () => {
    const { context, page, errors } = await open('layout');
    const text = '组件可以从 bake/runtime 导入工具函数，在 SVG 和 canvas 里排版文字。';
    const result = await page.evaluate((value) => window.layoutText({ text: value, font: '16px sans-serif', width: 120, lineHeight: 20 }), text);
    assert.ok(result.lines.length > 1, `${result.lines.length} lines`);
    assert.equal(result.lines.map((line) => line.text).join(''), text);
    assert.ok(result.lines.every((line) => typeof line.width === 'number' && line.width > 0 && line.width <= 120));
    assert.deepEqual(Object.keys(result.lines[0]).sort(), ['text', 'width']);
    assert.equal(result.height, result.lines.length * 20);
    assert.deepEqual(errors, []);
    await context.close();
  });
});

describe('renderMath', () => {
  test('调用前不请求 MathJax 的文件，返回带自己 <defs> 的 SVGSVGElement', async () => {
    const { context, page, requests, errors } = await open('math');
    const loaded = requests.length;
    const result = await page.evaluate(async () => {
      const svg = await window.renderMath('x^2');
      document.body.append(svg);
      return { isSvg: svg instanceof SVGSVGElement, defs: svg.querySelectorAll('defs path').length, uses: svg.querySelectorAll('use').length, width: svg.getBoundingClientRect().width };
    });
    assert.deepEqual({ ...result, width: result.width > 0 }, { isSvg: true, defs: result.uses, uses: result.uses, width: true });
    assert.ok(result.uses > 0);
    const mathjaxRequests = requests.slice(loaded);
    assert.ok(mathjaxRequests.length > 0);
    assert.ok(mathjaxRequests.every((path) => !requests.slice(0, loaded).includes(path)));
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('站点的宏生效，同一公式第二次调用得到新元素且不再请求文件', async () => {
    const { context, page, requests } = await open('math');
    const html = (tex) => page.evaluate(async (value) => (await window.renderMath(value, { display: true })).outerHTML, tex);
    const macro = await html('\\R');
    const afterFirst = requests.length;
    assert.equal(await html('\\R'), macro);
    assert.equal(requests.length, afterFirst);
    const withoutIds = (svg) => svg.replace(/MJX-\d+-/g, 'MJX-');
    assert.equal(withoutIds(macro), withoutIds(await html('\\mathbb{R}')));
    assert.ok(await page.evaluate(async () => (await window.renderMath('\\R')) !== (await window.renderMath('\\R'))));
    await context.close();
  });

  test('TeX 错误时以 Error 拒绝', async () => {
    const { context, page } = await open('math');
    const result = await page.evaluate(() => window.renderMath('\\frac{').then(() => 'resolved', (error) => ({ isError: error instanceof Error, message: error.message })));
    assert.equal(result.isError, true);
    assert.ok(result.message.length > 0);
    await context.close();
  });
});

describe('site', () => {
  test('导入 site 的页面只请求一次 site.json，没有导入的页面不请求', async () => {
    const withSite = await open('site');
    assert.deepEqual(await withSite.page.evaluate(() => [window.siteA, window.siteA === window.siteB]), [siteJson, true]);
    assert.deepEqual(withSite.requests.filter((path) => path.endsWith('site.json')), ['/site.json']);
    await withSite.context.close();
    for (const name of ['animate', 'layout', 'math']) {
      const { context, requests } = await open(name);
      assert.deepEqual(requests.filter((path) => path.endsWith('site.json')), [], name);
      await context.close();
    }
  });

  test('base 不是 / 时请求地址带前缀', async () => {
    const { context, page, requests } = await open('site', { url: prefixedOrigin });
    assert.deepEqual(await page.evaluate(() => window.siteA), siteJson);
    assert.deepEqual(requests.filter((path) => path.endsWith('site.json')), ['/blog/site.json']);
    await context.close();
  });

  test('site.json 请求失败时模块报错', async () => {
    rmSync(join(root, 'dist-', 'site.json'));
    const { context, errors } = await open('site');
    assert.ok(errors.some((error) => error.includes('Cannot load site.json: 404')), errors.join('\n'));
    await context.close();
    writeFileSync(join(root, 'dist-', 'site.json'), JSON.stringify(siteJson));
  });
});
