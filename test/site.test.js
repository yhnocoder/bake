import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { createServer } from 'vite';
import { layoutFrame, loadSite, renderArticle, renderDocumentFor, renderPage, siteData } from '../src/site/index.js';
import { createModuleLoader } from '../src/site/modules.js';

const blogs = [];
const config = "export default { title: '测试站点', theme: 'plain' };\n";
const plot = `export default class extends HTMLElement {
  static properties = { x0: { label: 'x₀', type: 'number', default: 1 } };
}
`;

function blog(files) {
  const root = mkdtempSync(join(tmpdir(), 'bake-site-'));
  blogs.push(root);
  for (const [path, content] of Object.entries({ 'bake.config.js': config, 'themes/plain.css': ':root {}\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function article(slug, extra = '') {
  return `---\ntitle: 文章 ${slug}\nslug: ${slug}\n${extra}---\n\n正文。\n`;
}

async function load(root) {
  const loader = await createModuleLoader(root);
  try {
    return await loadSite(root, { loader });
  } finally {
    await loader.close();
  }
}

after(() => {
  for (const root of blogs) rmSync(root, { recursive: true, force: true });
});

describe('配置', () => {
  test('填入默认值', async () => {
    const site = await load(blog({}));
    assert.deepEqual(site.config, { title: '测试站点', theme: 'plain', base: '/', site: {}, math: { macros: {} } });
    assert.deepEqual(site.messages, []);
  });

  test('保留配置里的值', async () => {
    const root = blog({ 'bake.config.js': "export default { title: 't', theme: 'plain', base: '/blog/', math: { macros: { R: 'x' } }, site: { a: 1 } };\n" });
    const { config: loaded } = await load(root);
    assert.deepEqual(loaded, { title: 't', theme: 'plain', base: '/blog/', site: { a: 1 }, math: { macros: { R: 'x' } } });
  });

  test('缺少 title 和 theme', async () => {
    const site = await load(blog({ 'bake.config.js': 'export default {};\n' }));
    assert.deepEqual(site.messages, [
      { path: 'bake.config.js', line: 1, column: 1, text: 'Config is missing title' },
      { path: 'bake.config.js', line: 1, column: 1, text: 'Config is missing theme' },
    ]);
  });

  test('配置文件载入失败时报错，使用默认值', async () => {
    const site = await load(blog({ 'bake.config.js': "throw new Error('broken config');\n" }));
    assert.deepEqual(site.messages, [{ path: 'bake.config.js', line: 1, column: 1, text: 'Cannot load bake.config.js: broken config' }]);
    assert.deepEqual(site.config, { base: '/', site: {}, math: { macros: {} } });
  });

  test('配置文件有语法错误时报错，位置取自 Vite 的 loc', async () => {
    const site = await load(blog({ 'bake.config.js': 'export default { {\n' }));
    assert.equal(site.messages.length, 1);
    assert.deepEqual({ ...site.messages[0], text: undefined }, { path: 'bake.config.js', line: 1, column: 1, text: undefined });
    assert.match(site.messages[0].text, /^Cannot load bake\.config\.js: Failed to parse source/);
  });
});

describe('页面', () => {
  test('发现页面，跳过 notes、components、assets 和以 _ 开头的文件，按路径排序', async () => {
    const root = blog({
      'content/index.md': article('/'),
      'content/b/deep.md': article('b/deep'),
      'content/a.md': article('a'),
      'content/b/_draft.md': article('b/draft'),
      'content/b/notes/note.md': article('b/note'),
      'content/b/components/x.md': article('b/x'),
      'content/b/assets/y.md': article('b/y'),
    });
    const { pages, messages } = await load(root);
    assert.deepEqual(messages, []);
    assert.deepEqual(
      pages.map(({ path, url }) => ({ path, url })),
      [
        { path: 'content/a.md', url: '/a/' },
        { path: 'content/b/deep.md', url: '/b/deep/' },
        { path: 'content/index.md', url: '/' },
      ],
    );
    assert.deepEqual(pages[0].frontmatter, { title: '文章 a', slug: 'a' });
  });

  test('地址由 slug 决定，移动文件后地址不变', async () => {
    const before = await load(blog({ 'content/matrix/deep-learning.md': article('matrix-calculus/deep-learning') }));
    const moved = await load(blog({ 'content/other/place.md': article('matrix-calculus/deep-learning') }));
    assert.equal(before.pages[0].url, '/matrix-calculus/deep-learning/');
    assert.equal(moved.pages[0].url, '/matrix-calculus/deep-learning/');
  });

  test('slug 缺失或不合法时没有地址', async () => {
    const { pages, messages } = await load(blog({ 'content/a.md': '---\ntitle: 无 slug\n---\n', 'content/b.md': article('B') }));
    assert.deepEqual(messages, []);
    assert.deepEqual(
      pages.map(({ url }) => url),
      [null, null],
    );
  });

  test('slug 重复时报错，列出两个文件', async () => {
    const root = blog({ 'content/a.md': article('same'), 'content/z/b.md': `---\ntitle: 重复\ndraft: true\nslug: same\n---\n` });
    const { messages } = await load(root);
    assert.deepEqual(messages, [{ path: 'content/z/b.md', line: 4, column: 1, text: 'Slug same is already used by content/a.md' }]);
  });
});

describe('组件和主题', () => {
  test('发现全局组件和主题目录的组件，不发现 lib/，读取 properties', async () => {
    const root = blog({
      'components/demo-plot.js': plot,
      'components/lib/helper.js': 'throw new Error("lib must not be imported");\n',
      'content/topic/components/topic-figure.js': 'export default class extends HTMLElement {}\n',
      'content/topic/post.md': article('topic/post'),
    });
    const site = await load(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.components, {
      'demo-plot': { path: 'components/demo-plot.js', topic: null, properties: { x0: { label: 'x₀', type: 'number', default: 1 } } },
      'topic-figure': { path: 'content/topic/components/topic-figure.js', topic: 'topic', properties: {} },
    });
  });

  test('读取失败时报错，说明包含组件文件路径', async () => {
    const site = await load(blog({ 'components/broken-plot.js': 'export default class extends HTMLElement {\n' }));
    assert.equal(site.messages.length, 1);
    assert.equal(site.messages[0].path, 'components/broken-plot.js');
    assert.match(site.messages[0].text, /^Cannot read static properties of component components\/broken-plot\.js: /);
    assert.deepEqual(site.components, {});
  });

  test('发现主题', async () => {
    const site = await load(blog({ 'themes/plain.css': ':root {}\n', 'themes/blue.css': ':root {}\n', 'themes/readme.md': '' }));
    assert.deepEqual(site.themes, { blue: 'themes/blue.css', plain: 'themes/plain.css' });
  });

  test('配置的 theme 不在 themes 中时报错', async () => {
    const site = await load(blog({ 'bake.config.js': "export default { title: 't', theme: 'red' };\n" }));
    assert.deepEqual(site.messages, [{ path: 'bake.config.js', line: 1, column: 1, text: 'Unknown theme red' }]);
    assert.deepEqual(Object.keys(site.layouts), ['essay', 'paper', 'bento']);
  });
});

describe('siteData', () => {
  test('跳过草稿和 slug 不合法的页面，保留其他字段，按路径排序', async () => {
    const root = blog({
      'bake.config.js': "export default { title: 't', theme: 'plain', site: { categories: ['math'] } };\n",
      'content/b.md': article('b', 'category: math\ntags: [x]\n'),
      'content/a.md': article('a', 'date: 2026-10-06\n'),
      'content/c.md': article('c', 'draft: true\n'),
      'content/d.md': '---\ntitle: 文章 d\nslug: Not_Valid\n---\n\n正文。\n',
    });
    assert.deepEqual(siteData(await load(root)), {
      pages: [
        { url: '/a/', title: '文章 a', slug: 'a', date: '2026-10-06' },
        { url: '/b/', title: '文章 b', slug: 'b', category: 'math', tags: ['x'] },
      ],
      config: { categories: ['math'] },
    });
  });
});

describe('renderPage', () => {
  const assets = { styles: ['/bake.css', '/theme.css'], scripts: ['/sidenotes.js'] };

  test('生成整页 HTML', async () => {
    const root = blog({ 'themes/plain.css': '', 'content/post.md': article('post'), 'content/index.md': article('/') });
    const site = await load(root);
    const { html, rendered, messages } = await renderPage(site, 'content/post.md', { assets });
    assert.deepEqual(messages, []);
    assert.equal(rendered.page.title, '文章 post');
    assert.match(html, /^<!doctype html>\n<html lang="zh-CN">/);
    assert.match(html, /<title>文章 post · 测试站点<\/title>/);
    assert.match(html, /<link rel="stylesheet" href="\/bake.css">\n<link rel="stylesheet" href="\/theme.css">\n<script type="module" src="\/sidenotes.js"><\/script>/);
    const home = await renderPage(site, 'content/index.md', { assets });
    assert.match(home.html, /<title>测试站点<\/title>/);
  });

  test('返回渲染错误', async () => {
    const root = blog({ 'themes/plain.css': '', 'content/post.md': article('post', 'theme: red\n') });
    const site = await load(root);
    const { messages } = await renderPage(site, 'content/post.md', { assets });
    assert.deepEqual(messages, [{ path: 'content/post.md', line: 4, column: 1, text: 'Unknown theme red' }]);
  });

  test('不认识的版式时不生成 HTML', async () => {
    const root = blog({ 'content/post.md': article('post', 'layout: slides\n') });
    const site = await load(root);
    const { html, messages } = await renderPage(site, 'content/post.md', { assets });
    assert.equal(html, null);
    assert.deepEqual(messages, [{ path: 'content/post.md', line: 4, column: 1, text: 'Unknown layout slides' }]);
  });

  test('分两步渲染时使用传入的源文件，资源由渲染结果决定', async () => {
    const root = blog({ 'themes/plain.css': '', 'components/demo-plot.js': plot, 'content/post.md': article('post') });
    const site = await load(root);
    const source = '---\ntitle: 新标题\nslug: moved\n---\n\n::demo-plot\n';
    const rendered = await renderArticle(site, 'content/post.md', source);
    assert.deepEqual(rendered.components, ['demo-plot']);
    const { frame } = layoutFrame(site, 'content/post.md', rendered);
    const html = renderDocumentFor(site, 'content/post.md', rendered, {
      frame,
      assets: { styles: [], scripts: rendered.components.map((name) => `/${name}.js`) },
    });
    assert.match(html, /<title>新标题 · 测试站点<\/title>/);
    assert.match(html, /<script type="module" src="\/demo-plot.js"><\/script>/);
  });
});

describe('createModuleLoader', () => {
  const component = (value) => `import './plot.css';\nimport { scale } from './lib/scale.js';\nexport default class extends HTMLElement {\n  static properties = { k: { label: 'k', type: 'number', default: ${value} }, scale: { label: 's', type: 'number', default: scale } };\n}\n`;

  test('载入导入 lib/ 文件和 CSS 文件的组件', async () => {
    const root = blog({
      'components/demo-plot.js': component(1),
      'components/plot.css': 'p {}\n',
      'components/lib/scale.js': 'export const scale = 2;\n',
    });
    const site = await load(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.components['demo-plot'].properties, {
      k: { label: 'k', type: 'number', default: 1 },
      scale: { label: 's', type: 'number', default: 2 },
    });
  });

  test('传入开发服务器时，修改 lib/ 文件后再次载入得到新值', async () => {
    const root = blog({
      'components/demo-plot.js': component(1),
      'components/plot.css': 'p {}\n',
      'components/lib/scale.js': 'export const scale = 2;\n',
    });
    const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, ws: false } });
    const loader = await createModuleLoader(root, { server });
    try {
      const before = await loadSite(root, { loader });
      assert.equal(before.components['demo-plot'].properties.scale.default, 2);
      const changed = new Promise((resolve) => server.watcher.once('change', resolve));
      writeFileSync(join(root, 'components/lib/scale.js'), 'export const scale = 3;\n');
      await changed;
      const after = await loadSite(root, { loader });
      assert.equal(after.components['demo-plot'].properties.scale.default, 3);
    } finally {
      await loader.close();
      await server.close();
    }
  });

  test('close 关闭自己创建的服务器', async () => {
    const loader = await createModuleLoader(blog({}));
    await loader.close();
    await assert.rejects(loader.import('bake.config.js'));
  });
});
