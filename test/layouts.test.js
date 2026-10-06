import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import bento from '../src/layouts/bento.js';
import essay from '../src/layouts/essay.js';
import { renderDocument } from '../src/layouts/head.js';
import paper from '../src/layouts/paper.js';
import { loadSite, renderPage } from '../src/site/index.js';
import { themeVariables } from '../src/styles/variables.js';

const root = join(import.meta.dirname, '..');
const site = await loadSite(join(root, 'examples/minimal'));
const assets = { styles: ['/src/styles/base.css', '/examples/minimal/themes/default.css'], scripts: ['/src/client/page.js'] };
const toc = [
  { id: 'a', html: '第一节', depth: 2 },
  { id: 'b', html: '小节 &lt;b&gt;', depth: 3 },
];
const layouts = { essay, paper, bento };

function withoutSvg(html) {
  return html
    .replace(/<svg id="math-defs" style="display:none"><defs>[\s\S]*?<\/defs><\/svg>/, '<svg style="display:none"/>')
    .replace(/(class="math[^>]*>)<svg[\s\S]*?<\/svg><\/(span|div)>/g, '$1<svg/></$2>');
}

function articleCount(html) {
  return html.match(/<article[\s>]/g)?.length ?? 0;
}

describe('examples/minimal 的整页 HTML', () => {
  for (const name of ['features', 'paper', 'bento']) {
    test(`${name}.md`, async (t) => {
      const { html, messages } = await renderPage(site, `content/${name}.md`, { assets });
      assert.deepEqual(messages, []);
      assert.equal(articleCount(html), 1);
      t.assert.snapshot(withoutSvg(html), { serializers: [(value) => value] });
    });
  }
});

test('标题含公式时目录项放入公式的 HTML', async () => {
  const { html } = await renderPage(site, 'content/paper.md', { assets });
  const entry = html.match(/<li class="toc-h3"><a href="#multivariate">(.*?)<\/a><\/li>/)[1];
  assert.match(entry, /^推广到 <span class="math" data-tex="\\mathbb\{R\}\^n"><svg[\s\S]*<\/svg><\/span>$/);
});

describe('版式', () => {
  const page = { title: '标题', url: '/post/', path: 'content/post.md', width: 'normal' };

  for (const [name, render] of Object.entries(layouts)) {
    test(`${name} 只输出一个 <article>`, () => {
      assert.equal(articleCount(render({ page: { ...page, toc: true, numbered: true }, html: '<p>正文</p>', toc, site: {} })), 1);
    });
  }

  test('numbered 为 true 时 <article> 带 numbered', () => {
    assert.match(essay({ page: { ...page, toc: false, numbered: true }, html: '', toc, site: {} }), /<article class="numbered">/);
    assert.match(paper({ page: { ...page, toc: false, numbered: true }, html: '', toc, site: {} }), /<article class="numbered">/);
    assert.match(essay({ page: { ...page, toc: false, numbered: false }, html: '', toc, site: {} }), /<article>/);
  });

  test('toc 为 false 时不输出目录', () => {
    assert.doesNotMatch(essay({ page: { ...page, toc: false }, html: '', toc, site: {} }), /nav/);
    assert.doesNotMatch(paper({ page: { ...page, toc: false }, html: '', toc, site: {} }), /nav/);
    assert.match(essay({ page: { ...page, toc: true }, html: '', toc, site: {} }), /<nav class="toc"><details><summary>目录<\/summary><ol>/);
    assert.match(paper({ page: { ...page, toc: true }, html: '', toc, site: {} }), /<nav class="toc"><ol>/);
  });

  test('width 为 wide 时 <body> 带 wide', () => {
    const document = (width) => renderDocument({ page: { ...page, width }, config: { title: '站点' }, body: '', mathDefs: '', assets });
    assert.match(document('wide'), /<body class="wide">/);
    assert.match(document('normal'), /<body>/);
  });

  test('用户内容做 HTML 转义', () => {
    const unsafe = { ...page, title: '<script>', eyebrow: 'a & b', authors: ['"甲"'], abstract: '<i>摘要</i>', toc: true };
    const essayHtml = essay({ page: unsafe, html: '', toc, site: {} });
    const paperHtml = paper({ page: unsafe, html: '', toc, site: {} });
    assert.match(essayHtml, /<p class="eyebrow">a &amp; b<\/p><h1>&lt;script&gt;<\/h1>/);
    assert.match(essayHtml, /<a href="#b">小节 &lt;b&gt;<\/a>/);
    assert.match(paperHtml, /<p class="authors"><span>&quot;甲&quot;<\/span><\/p><p class="abstract">&lt;i&gt;摘要&lt;\/i&gt;<\/p>/);
    assert.match(bento({ page: unsafe, html: '', toc, site: {} }), /<h1>&lt;script&gt;<\/h1>/);
    const document = renderDocument({ page: unsafe, config: { title: 'A & B' }, body: '', mathDefs: '', assets });
    assert.match(document, /<title>&lt;script&gt; · A &amp; B<\/title>/);
  });
});

describe('样式', () => {
  const styles = ['base', 'blocks', 'layouts'].map((name) => readFileSync(join(root, `src/styles/${name}.css`), 'utf8'));

  const cardVariables = ['--card-columns', '--card-rows'];

  test('只使用主题变量和卡片的尺寸变量，不写具体颜色', () => {
    for (const css of styles) {
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i);
      const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
      for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) {
        assert.ok(themeVariables.includes(name) || cardVariables.includes(name) || defined.has(name), `${name} is not a theme variable`);
      }
    }
  });

  test('示例主题设定了全部主题变量', () => {
    const theme = readFileSync(join(root, 'examples/minimal/themes/default.css'), 'utf8');
    const defined = [...theme.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);
    assert.deepEqual(defined, themeVariables);
  });
});
