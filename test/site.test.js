import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { loadSite, renderPage, siteData } from '../src/site/index.js';

const blogs = [];
const config = "export default { title: '测试站点', theme: 'plain' };\n";
const plot = `export default class extends HTMLElement {
  static properties = { x0: { label: 'x₀', type: 'number', default: 1 } };
}
`;

function blog(files) {
  const root = mkdtempSync(join(tmpdir(), 'bake-site-'));
  blogs.push(root);
  for (const [path, content] of Object.entries({ 'bake.config.js': config, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function article(slug, extra = '') {
  return `---\ntitle: 文章 ${slug}\nslug: ${slug}\n${extra}---\n\n正文。\n`;
}

after(() => {
  for (const root of blogs) rmSync(root, { recursive: true, force: true });
});

describe('配置', () => {
  test('填入默认值', async () => {
    const site = await loadSite(blog({}));
    assert.deepEqual(site.config, { title: '测试站点', theme: 'plain', base: '/', site: {}, math: { macros: {} } });
    assert.deepEqual(site.messages, []);
  });

  test('保留配置里的值', async () => {
    const root = blog({ 'bake.config.js': "export default { title: 't', theme: 'plain', base: '/blog/', math: { macros: { R: 'x' } }, site: { a: 1 } };\n" });
    const { config: loaded } = await loadSite(root);
    assert.deepEqual(loaded, { title: 't', theme: 'plain', base: '/blog/', site: { a: 1 }, math: { macros: { R: 'x' } } });
  });

  test('缺少 title 和 theme', async () => {
    const site = await loadSite(blog({ 'bake.config.js': 'export default {};\n' }));
    assert.deepEqual(site.messages, [
      { path: 'bake.config.js', line: 1, column: 1, text: 'Config is missing title' },
      { path: 'bake.config.js', line: 1, column: 1, text: 'Config is missing theme' },
    ]);
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
    const { pages, messages } = await loadSite(root);
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
    const before = await loadSite(blog({ 'content/matrix/deep-learning.md': article('matrix-calculus/deep-learning') }));
    const moved = await loadSite(blog({ 'content/other/place.md': article('matrix-calculus/deep-learning') }));
    assert.equal(before.pages[0].url, '/matrix-calculus/deep-learning/');
    assert.equal(moved.pages[0].url, '/matrix-calculus/deep-learning/');
  });

  test('slug 缺失或不合法时没有地址', async () => {
    const { pages, messages } = await loadSite(blog({ 'content/a.md': '---\ntitle: 无 slug\n---\n', 'content/b.md': article('B') }));
    assert.deepEqual(messages, []);
    assert.deepEqual(
      pages.map(({ url }) => url),
      [null, null],
    );
  });

  test('slug 重复时报错，列出两个文件', async () => {
    const root = blog({ 'content/a.md': article('same'), 'content/z/b.md': `---\ntitle: 重复\ndraft: true\nslug: same\n---\n` });
    const { messages } = await loadSite(root);
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
    const site = await loadSite(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.components, {
      'demo-plot': { path: 'components/demo-plot.js', topic: null, properties: { x0: { label: 'x₀', type: 'number', default: 1 } } },
      'topic-figure': { path: 'content/topic/components/topic-figure.js', topic: 'topic', properties: {} },
    });
  });

  test('读取失败时报错，说明包含组件文件路径', async () => {
    const site = await loadSite(blog({ 'components/broken-plot.js': 'export default class extends HTMLElement {\n' }));
    assert.equal(site.messages.length, 1);
    assert.equal(site.messages[0].path, 'components/broken-plot.js');
    assert.match(site.messages[0].text, /^Cannot read static properties of component components\/broken-plot\.js: /);
    assert.deepEqual(site.components, {});
  });

  test('发现主题', async () => {
    const site = await loadSite(blog({ 'themes/plain.css': ':root {}\n', 'themes/blue.css': ':root {}\n', 'themes/readme.md': '' }));
    assert.deepEqual(site.themes, { blue: 'themes/blue.css', plain: 'themes/plain.css' });
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
    assert.deepEqual(siteData(await loadSite(root)), {
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
    const site = await loadSite(root);
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
    const site = await loadSite(root);
    const { messages } = await renderPage(site, 'content/post.md', { assets });
    assert.deepEqual(messages, [{ path: 'content/post.md', line: 4, column: 1, text: 'Unknown theme red' }]);
  });

  test('不认识的版式时不生成 HTML', async () => {
    const root = blog({ 'content/post.md': article('post', 'layout: slides\n') });
    const site = await loadSite(root);
    const { html, messages } = await renderPage(site, 'content/post.md', { assets });
    assert.equal(html, null);
    assert.deepEqual(messages, [{ path: 'content/post.md', line: 4, column: 1, text: 'Unknown layout slides' }]);
  });
});
