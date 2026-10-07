import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const appendNote = `export default class AppendNote extends HTMLElement {
  connectedCallback() {
    const note = document.createElement('span');
    note.className = 'generated';
    note.textContent = 'v1';
    this.append(note);
  }
}
`;

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

async function until(condition, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((done) => setTimeout(done, 50));
  }
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
  writeFileSync(join(root, 'components/append-note.js'), appendNote);
  writeFileSync(join(root, 'content/append.md'), '---\ntitle: 追加\nslug: append\n---\n\n:::append-note\n图题\n:::\n');
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

  test('不存在的页面返回 404，页面列出全部文章的链接', async () => {
    const response = await fetch(`${origin}/missing/`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const html = await response.text();
    assert.match(html, /<p>No page at \/missing\/<\/p>/);
    assert.match(html, /<li><a href="\/paper\/">\/paper\/<\/a> 用梯度下降求函数的最小值 <code>content\/paper\.md<\/code><\/li>/);
    for (const url of ['/bento/', '/features/']) assert.ok(html.includes(`<a href="${url}">`));
  });

  test('图片按文章所在目录的 assets/ 提供', async () => {
    const response = await fetch(`${origin}/features/assets/neuron.svg`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(join(root, 'content/assets/neuron.svg'), 'utf8'));
  });
});

describe('插件 api', () => {
  const api = () => server.config.plugins.find((plugin) => plugin.name === 'bake-dev').api;

  test('renderedPage 返回渲染结果，地址不存在时返回 null', async () => {
    const rendered = await api().renderedPage('/features/');
    assert.deepEqual(Object.keys(rendered).sort(), ['components', 'html', 'mathDefs', 'messages', 'page', 'path', 'toc']);
    assert.equal(rendered.path, 'content/features.md');
    assert.deepEqual(rendered.components, ['demo-plot']);
    assert.equal(await api().renderedPage('/missing/'), null);
  });

  test('componentEntry 与页面中组件入口的地址相同', async () => {
    const html = await (await fetch(`${origin}/features/`)).text();
    assert.ok(html.includes(`<script type="module" src="${api().componentEntry('demo-plot')}"></script>`));
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
    assert.deepEqual(saved, { status: 200, body: { hash: sha256(changed), url: '/paper/' } });
    assert.equal(readFileSync(file, 'utf8'), changed);

    const conflict = await post('/__bake/save', { page: '/paper/', markdown: original, hash: sha256(original) });
    assert.deepEqual(conflict, { status: 409, body: { markdown: changed, hash: sha256(changed) } });
    assert.equal(readFileSync(file, 'utf8'), changed);
  });

  test('/__bake/save 修改 slug 后返回新地址，新地址立即可以访问，旧地址返回 404', async () => {
    const markdown = '---\ntitle: 搬家\nslug: move-a\n---\n\n正文。\n';
    writeFileSync(join(root, 'content/move.md'), markdown);
    await until(async () => (await fetch(`${origin}/move-a/`)).status === 200);
    const changed = markdown.replace('move-a', 'move-b');
    const saved = await post('/__bake/save', { page: '/move-a/', markdown: changed, hash: sha256(markdown) });
    assert.deepEqual(saved, { status: 200, body: { hash: sha256(changed), url: '/move-b/' } });
    assert.equal((await fetch(`${origin}/move-b/`)).status, 200);
    assert.equal((await fetch(`${origin}/move-a/`)).status, 404);
  });

  test('/__bake/save 遇到另一篇文章已使用的 slug 时返回 400，文件不变', async () => {
    const file = join(root, 'content/bento.md');
    const original = readFileSync(file, 'utf8');
    const changed = original.replace(/^slug: .*$/m, 'slug: paper');
    const response = await post('/__bake/save', { page: '/bento/', markdown: changed, hash: sha256(original) });
    assert.deepEqual(response, { status: 400, body: { error: 'Slug paper is already used by content/paper.md' } });
    assert.equal(readFileSync(file, 'utf8'), original);
  });

  test('/__bake/save 写入不合法的 slug 后原地址仍然可以访问，渲染报告错误，下一次保存成功', async () => {
    const markdown = '---\ntitle: 格式\nslug: valid-slug\n---\n\n正文。\n';
    writeFileSync(join(root, 'content/invalid.md'), markdown);
    await until(async () => (await fetch(`${origin}/valid-slug/`)).status === 200);
    const invalid = markdown.replace('valid-slug', 'Invalid Slug');
    const saved = await post('/__bake/save', { page: '/valid-slug/', markdown: invalid, hash: sha256(markdown) });
    assert.deepEqual(saved, { status: 200, body: { hash: sha256(invalid), url: '/valid-slug/' } });
    const api = server.config.plugins.find((plugin) => plugin.name === 'bake-dev').api;
    const rendered = await api.renderedPage('/valid-slug/');
    assert.ok(rendered.messages.some(({ text }) => text.startsWith('Frontmatter field slug must be')));
    assert.equal((await fetch(`${origin}/valid-slug/`)).status, 200);
    const fixed = invalid.replace('Invalid Slug', 'fixed-slug');
    const next = await post('/__bake/save', { page: '/valid-slug/', markdown: fixed, hash: sha256(invalid) });
    assert.deepEqual(next, { status: 200, body: { hash: sha256(fixed), url: '/fixed-slug/' } });
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

  test('修改标题文字时目录随 <article> 以外的结构一起替换，<article> 是同一个元素', async () => {
    const { page } = await open('/features/');
    await page.evaluate(() => {
      window.article = document.querySelector('article');
      window.addEventListener('bake:page-update', (event) => (window.chrome = event.detail.chrome));
    });
    edit('content/features.md', (source) => source.replace('## 图片 {#images}', '## 图片与图注 {#images}'));
    await page.waitForFunction(() => document.querySelector('nav.toc').textContent.includes('图片与图注'));
    assert.equal(await page.evaluate(() => window.chrome), true);
    assert.equal(await page.evaluate(() => document.querySelector('article') === window.article), true);
    assert.equal(await page.evaluate(() => window.marker), 'kept');
    await page.close();
  });

  test('新增文章后可以访问，修改 slug 后旧地址返回 404', async () => {
    writeFileSync(join(root, 'content/new.md'), '---\ntitle: 新文章\nslug: fresh\n---\n\n正文。\n');
    const reachable = async (url) => (await fetch(origin + url)).status;
    await until(async () => (await reachable('/fresh/')) === 200);
    edit('content/new.md', (source) => source.replace('slug: fresh', 'slug: renamed'));
    await until(async () => (await reachable('/renamed/')) === 200);
    assert.equal(await reachable('/fresh/'), 404);
  });

  test('跨页链接指向不存在的 id 时显示在状态栏', async () => {
    writeFileSync(join(root, 'content/links.md'), '---\ntitle: 链接\nslug: links\n---\n\n[有](/paper/#update)和[无](/paper/#missing)。\n');
    await until(async () => (await fetch(`${origin}/links/`)).status === 200);
    const { page } = await open('/links/');
    await page.waitForFunction(() => document.querySelector('.bake-status-problems').textContent === '1 个断开的站内链接');
    await page.click('.bake-status-problems');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.bake-status-list li')].map((item) => item.textContent)), [
      'content/links.md:6:21 Link points to a missing id /paper/#missing',
    ]);
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

  test('组件在 connectedCallback 中追加的内容在热更新后只有一份', async () => {
    const { page } = await open('/append/');
    await page.waitForFunction(() => document.querySelector('append-note .generated'));
    edit('components/append-note.js', (source) => source.replace("'v1'", "'v2'"));
    await page.waitForFunction(() => document.querySelector('append-note .generated')?.textContent === 'v2');
    assert.equal(await page.evaluate(() => document.querySelectorAll('append-note .generated').length), 1);
    assert.equal(await page.evaluate(() => document.querySelector('append-note figcaption')?.textContent), '图题');
    await page.close();
  });

  test('页面只有一个字形容器，更新后原有字形仍在', async () => {
    const { page } = await open('/paper/');
    const before = await page.evaluate(() => [...document.querySelectorAll('#math-defs path')].map((path) => path.id));
    edit('content/paper.md', (source) => source.replace('第 $k$ 步的更新是', '第 $k$ 步的更新是 $\\Omega$'));
    await page.waitForFunction((count) => document.querySelectorAll('#math-defs path').length > count, before.length);
    const after = await page.evaluate(() => [...document.querySelectorAll('#math-defs path')].map((path) => path.id));
    assert.equal(await page.evaluate(() => document.querySelectorAll('svg[style="display:none"]').length), 1);
    assert.ok(before.every((id) => after.includes(id)));
    assert.equal(new Set(after).size, after.length);
    await page.close();
  });
});

describe('状态栏', () => {
  test('showMessage 显示消息，再次调用时替换，点击关闭后移除', async () => {
    const { page, errors } = await open('/paper/');
    const status = `/@fs${join(import.meta.dirname, '..', 'src/dev/status.js')}`;
    const shown = () => page.evaluate(() => {
      const message = document.querySelector('.bake-status-message');
      return message.hidden ? null : message.querySelector('span').textContent;
    });
    assert.equal(await shown(), null);
    await page.evaluate(async (url) => (await import(url)).showMessage('图片保存失败'), status);
    assert.equal(await shown(), '图片保存失败');
    await page.evaluate(async (url) => (await import(url)).showMessage('代码高亮加载失败'), status);
    assert.equal(await shown(), '代码高亮加载失败');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.bake-status-message').length), 1);
    await page.click('.bake-status-message button');
    assert.equal(await shown(), null);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

describe('站点模块', () => {
  const api = () => server.config.plugins.find((plugin) => plugin.name === 'bake-dev').api;

  test('修改 bake.config.js 后已打开的页面不刷新整页就换成新的配置', async () => {
    const { page, errors } = await open('/paper/');
    edit('bake.config.js', (source) => source.replace("title: 'bake minimal'", "title: 'bake changed'"));
    await page.waitForFunction(() => document.title.endsWith('bake changed'));
    assert.equal(await page.evaluate(() => window.marker), 'kept');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('新增组件和修改组件导入的文件后重新读取 static properties', async () => {
    writeFileSync(join(root, 'content/sized.md'), '---\ntitle: 尺寸\nslug: sized\n---\n\n::sized-box{size=3}\n');
    await until(async () => (await fetch(`${origin}/sized/`)).status === 200);
    const texts = async () => (await api().renderedPage('/sized/')).messages.map(({ text }) => text);
    assert.match((await texts()).join('\n'), /Unknown component/);
    mkdirSync(join(root, 'components/lib'));
    writeFileSync(join(root, 'components/lib/sized-properties.js'), 'export default {};\n');
    writeFileSync(join(root, 'components/sized-box.js'), "import properties from './lib/sized-properties.js';\nexport default class SizedBox extends HTMLElement {\n  static properties = properties;\n}\n");
    await until(async () => (await texts()).some((text) => text.startsWith('Unknown attribute size')));
    edit('components/lib/sized-properties.js', () => "export default { size: { label: '尺寸', type: 'number', default: 1 } };\n");
    await until(async () => (await texts()).length === 0);
  });
});

describe('启动', () => {
  test('站点有错误时不启动，抛出带 messages 的错误', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'bake-dev-empty-'));
    try {
      await assert.rejects(createDevServer({ root: empty, port: 0 }), (error) => {
        assert.deepEqual(error.messages.map(({ text }) => text), [`bake.config.js not found in ${empty}`]);
        return true;
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

