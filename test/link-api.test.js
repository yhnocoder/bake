import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDevServer } from '../src/dev/index.js';

const example = join(import.meta.dirname, '..', 'examples', 'minimal');
let root;
let server;
let origin;

async function get(path) {
  const response = await fetch(origin + path);
  return { status: response.status, body: await response.json() };
}

const preview = (href) => get(`/__bake/preview?href=${encodeURIComponent(href)}`);

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'bake-link-api-'));
  cpSync(example, root, { recursive: true });
  writeFileSync(join(root, 'content/draft.md'), '---\ntitle: 草稿\nslug: draft\ndraft: true\n---\n\n## 草稿小节 {#todo}\n\n还没写完。\n');
  server = await createDevServer({ root, port: 0 });
  origin = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /__bake/sections', () => {
  test('列出全部非草稿页面的标题和段落，页面按文件路径排序', async () => {
    const { status, body } = await get('/__bake/sections');
    assert.equal(status, 200);
    assert.deepEqual(
      body.pages.map(({ url, title }) => ({ url, title })),
      [
        { url: '/bento/', title: '激活函数一览' },
        { url: '/features/', title: 'bake 的全部写法' },
        { url: '/paper/', title: '用梯度下降求函数的最小值' },
      ],
    );
    const features = body.pages[1].sections;
    assert.deepEqual(features[0], { id: 'chain-rule', kind: 'heading', text: '反向传播中的链式法则' });
    assert.ok(features.some((item) => item.id === 'chain-rule-def' && item.kind === 'block' && item.text === '链式法则把复合函数的导数写成各层导数的乘积。'));
    assert.deepEqual(
      features.filter((item) => item.kind === 'heading').map((item) => item.id),
      ['chain-rule', 'images', 'components', 'blocks', 'sidenotes', 'bento', 'table', 'math', '配置文件中的宏', 'links', 'lists'],
    );
    const paper = body.pages[2].sections;
    assert.deepEqual(
      paper.find((item) => item.id === 'multivariate'),
      { id: 'multivariate', kind: 'heading', text: '推广到 \\mathbb{R}^n' },
    );
  });
});

describe('GET /__bake/preview', () => {
  test('整篇文章返回标题和导语', async () => {
    const { status, body } = await preview('/features/');
    assert.equal(status, 200);
    assert.equal(body.title, 'bake 的全部写法');
    assert.match(body.html, /^<div class="lede"/);
    assert.deepEqual(body.components, []);
  });

  test('标题返回整节，组件脚本地址是开发服务器的组件入口', async () => {
    const { status, body } = await preview('/features/#components');
    assert.equal(status, 200);
    assert.equal(body.title, null);
    assert.match(body.html, /^<h2><a class="anchor" href="\/features\/#components"/);
    assert.deepEqual(body.components, ['demo-plot']);
    assert.deepEqual(body.scripts, { 'demo-plot': '/@id/__x00__bake:component/demo-plot' });
  });

  test('公式的字形随卡片返回', async () => {
    const { body } = await preview('/features/#math');
    const referenced = new Set([...body.html.matchAll(/href="#(MJX-[^"]+)"/g)].map(([, id]) => id));
    assert.ok(referenced.size > 0);
    assert.deepEqual(Object.keys(body.glyphs).sort(), [...referenced].sort());
  });

  test('段落', async () => {
    const { status, body } = await preview('/features/#chain-rule-def');
    assert.equal(status, 200);
    assert.equal(body.html, '<p>链式法则把复合函数的导数写成各层导数的乘积。</p>');
  });

  test('地址带或不带末尾 / 的结果相同', async () => {
    assert.deepEqual(await preview('/paper#step-size'), await preview('/paper/#step-size'));
    assert.deepEqual(await preview('/paper'), await preview('/paper/'));
  });

  test('草稿可以预览', async () => {
    const { status, body } = await preview('/draft#todo');
    assert.equal(status, 200);
    assert.match(body.html, /草稿小节/);
  });

  test('页面不存在和 id 不存在时返回 404', async () => {
    assert.deepEqual(await preview('/missing#x'), { status: 404, body: { error: 'No page at /missing/' } });
    assert.deepEqual(await preview('/paper#missing'), { status: 404, body: { error: 'No heading or paragraph #missing on /paper/' } });
  });

  test('缺少 href 时返回 400', async () => {
    assert.deepEqual(await get('/__bake/preview'), { status: 400, body: { error: 'Missing query parameter href' } });
  });

  test('修改 .md 后返回新内容', async () => {
    const file = join(root, 'content/paper.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('梯度下降只需要计算梯度', '梯度下降只需要计算一阶梯度'));
    const { body } = await preview('/paper#conclusion');
    assert.match(body.html, /一阶梯度/);
    const { body: list } = await get('/__bake/sections');
    assert.ok(list.pages[2].sections.length > 0);
  });
});
