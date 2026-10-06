import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';
import { AbstractMathDocument } from '@mathjax/src/js/core/MathDocument.js';
import { visit } from 'unist-util-visit';
import { parse } from '../src/format/index.js';
import * as bento from '../src/layouts/bento.js';
import * as essay from '../src/layouts/essay.js';
import * as paper from '../src/layouts/paper.js';
import { render } from '../src/render/index.js';

globalThis.HTMLElement ??= class {};
const root = join(import.meta.dirname, '..');
const minimal = join(root, 'examples/minimal');
const { default: config } = await import(join(minimal, 'bake.config.js'));
const { default: DemoPlot } = await import(join(minimal, 'components/demo-plot.js'));
const components = { 'demo-plot': DemoPlot.properties };
const layouts = { essay: essay.fields, paper: paper.fields, bento: bento.fields };
const options = { path: 'post.md', config, components, layouts, themes: ['default'] };
const header = '---\ntitle: 测试\nslug: test\n---\n\n';
const headerLines = 5;

function renderBody(body, extra = {}) {
  return render(`${header}${body}`, { ...options, ...extra });
}

async function htmlOf(body, extra) {
  const { html, messages } = await renderBody(body, extra);
  assert.deepEqual(messages, []);
  return html;
}

async function messagesOf(body, extra) {
  const { messages } = await renderBody(body, extra);
  return messages.map(({ line, column, text }) => ({ line: line - headerLines, column, text }));
}

function decodeAttribute(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function withoutSvg(html) {
  return html.replace(/(class="math[^>]*>)<svg[\s\S]*?<\/svg><\/(span|div)>/g, '$1<svg/></$2>');
}

function glyphIds(text) {
  return new Set([...text.matchAll(/href="#(MJX-[^"]+)"/g)].map((match) => match[1]));
}

function definedGlyphIds(mathDefs) {
  return new Set([...mathDefs.matchAll(/<path id="(MJX-[^"]+)"/g)].map((match) => match[1]));
}

describe('features.md', () => {
  const path = join(minimal, 'content/features.md');
  const source = readFileSync(path, 'utf8');

  test('快照', async (t) => {
    const result = await render(source, { ...options, path: 'content/features.md' });
    assert.deepEqual(result.messages, []);
    const { html, toc, ids, links, components: used } = result;
    t.assert.snapshot({ toc, ids, links, components: used });
    t.assert.snapshot(html, { serializers: [(value) => value] });
  });

  test('data-md 与源文件中的原文逐字相同', async () => {
    const { html } = await render(source, { ...options, path: 'content/features.md' });
    const rendered = [...html.matchAll(/data-md="([^"]*)"/g)].map((match) => decodeAttribute(match[1])).sort();
    const expected = [];
    visit(parse(source).tree, (node) => {
      if (['containerDirective', 'leafDirective', 'textDirective', 'footnoteDefinition'].includes(node.type)) {
        expected.push(source.slice(node.position.start.offset, node.position.end.offset));
      }
    });
    assert.deepEqual(rendered, expected.sort());
    assert.ok(rendered.length > 10);
  });

  test('page 填入版式字段的默认值', async () => {
    const { page } = await render(source, { ...options, path: 'content/features.md' });
    assert.equal(page.numbered, false);
    assert.equal(page.draft, false);
    assert.equal(page.category, 'demo');
  });
});

describe('每种内容的 HTML', () => {
  const cases = [
    ['标题', '## 链式法则 {#chain-rule}\n', '<h2 id="chain-rule"><a class="anchor" href="#chain-rule" aria-hidden="true">#</a>链式法则</h2>'],
    ['带块引用 id 的段落', '链式法则把导数写成乘积。 ^chain-rule-def\n', '<p id="chain-rule-def">链式法则把导数写成乘积。</p>'],
    ['高亮', '梯度指向==增长最快==的方向。\n', '<p>梯度指向<mark>增长最快</mark>的方向。</p>'],
    ['导语', ':::lede\n导语。\n:::\n', '<div class="lede" data-md=":::lede\n导语。\n:::"><p>导语。</p></div>'],
    [
      '副标题',
      '## 链式法则 {#a}\n\n::subtitle[从标量推广到矩阵]\n',
      '<p class="subtitle" data-md="::subtitle[从标量推广到矩阵]">从标量推广到矩阵</p>',
    ],
    [
      '引用和出处',
      '> 引文。\n>\n> ::source[出处]\n',
      '<figure class="quote"><blockquote>\n<p>引文。</p>\n</blockquote><figcaption data-md="::source[出处]">出处</figcaption></figure>',
    ],
    ['没有出处的引用', '> 引文。\n', '<blockquote>\n<p>引文。</p>\n</blockquote>'],
    [
      '折叠',
      ':::fold[推导细节]\n内容。\n:::\n',
      '<details class="fold" data-md=":::fold[推导细节]\n内容。\n:::"><summary>推导细节</summary><p>内容。</p></details>',
    ],
    [
      '提示框',
      ':::callout{kind=warning}\n内容。\n:::\n',
      '<aside class="callout warning" data-md=":::callout{kind=warning}\n内容。\n:::"><p class="callout-label">注意</p><p>内容。</p></aside>',
    ],
    [
      '提示框默认类型',
      ':::callout\n内容。\n:::\n',
      '<aside class="callout note" data-md=":::callout\n内容。\n:::"><p class="callout-label">说明</p><p>内容。</p></aside>',
    ],
    ['加宽', ':::wide\n内容。\n:::\n', '<div class="wide" data-md=":::wide\n内容。\n:::"><p>内容。</p></div>'],
    [
      '边注',
      '正文。\n\n:::margin\n边注。\n:::\n',
      '<aside class="sidenote unnumbered" data-md=":::margin\n边注。\n:::"><p>边注。</p></aside>',
    ],
    [
      '卡片网格',
      '::::bento\n:::card{span=2x1 title=ReLU}\n内容。\n:::\n\n:::card\n无标题。\n:::\n::::\n',
      '<div class="bento" data-md="::::bento\n:::card{span=2x1 title=ReLU}\n内容。\n:::\n\n:::card\n无标题。\n:::\n::::">' +
        '<section class="card" style="--card-columns: 2; --card-rows: 1" data-md=":::card{span=2x1 title=ReLU}\n内容。\n:::"><p class="card-title">ReLU</p><p>内容。</p></section>' +
        '<section class="card" style="--card-columns: 1; --card-rows: 1" data-md=":::card\n无标题。\n:::"><p>无标题。</p></section></div>',
    ],
    [
      '参考文献',
      ':::references\n- 甲。\n- 乙。\n:::\n',
      '<ol class="references" data-md=":::references\n- 甲。\n- 乙。\n:::">\n<li>甲。</li>\n<li>乙。</li>\n</ol>',
    ],
    [
      '表格',
      '| 函数 | 导数 |\n| - | -: |\n| ReLU | 1 |\n',
      '<div class="table-scroll"><table>\n<thead>\n<tr>\n<th>函数</th>\n<th align="right">导数</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>ReLU</td>\n<td align="right">1</td>\n</tr>\n</tbody>\n</table></div>',
    ],
    [
      '居中的图片',
      '![一个神经元](./assets/neuron.svg){width=60%}\n',
      '<figure class="image"><img src="./assets/neuron.svg" alt="一个神经元" style="width: 60%"><figcaption>一个神经元</figcaption></figure>',
    ],
    [
      '浮动的图片',
      '![说明](./assets/neuron.svg){width=160 height=2em float=left}\n',
      '<figure class="image float-left"><img src="./assets/neuron.svg" alt="说明" style="width: 160px; height: 2em"><figcaption>说明</figcaption></figure>',
    ],
    [
      '只写高度的图片',
      '![说明](./assets/neuron.svg){height=100}\n',
      '<figure class="image"><img src="./assets/neuron.svg" alt="说明" style="height: 100px; width: auto"><figcaption>说明</figcaption></figure>',
    ],
    [
      'float 为 none 的图片',
      '![说明](./assets/neuron.svg){float=none}\n',
      '<figure class="image"><img src="./assets/neuron.svg" alt="说明"><figcaption>说明</figcaption></figure>',
    ],
    [
      '有图题的组件',
      ':::demo-plot{x0=1.5 showPath=true}\n图题。\n:::\n',
      '<demo-plot x0="1.5" class="component" data-md=":::demo-plot{x0=1.5 showPath=true}\n图题。\n:::"><figcaption>图题。</figcaption></demo-plot>',
    ],
    [
      '没有图题的组件',
      '::demo-plot{x0=1.20 curve=quartic}\n',
      '<demo-plot curve="quartic" class="component" data-md="::demo-plot{x0=1.20 curve=quartic}"></demo-plot>',
    ],
    ['独立的 HTML 块', '<svg viewBox="0 0 1 1">\n  <rect/>\n</svg>\n', '<svg viewBox="0 0 1 1">\n  <rect/>\n</svg>'],
    ['代码块', '```python\nprint(1 < 2)\n```\n', '<pre><code class="language-python">print(1 &#x3C; 2)\n</code></pre>'],
  ];

  for (const [name, body, expected] of cases) {
    test(name, async () => {
      assert.ok((await htmlOf(body)).includes(expected), await htmlOf(body));
    });
  }

  test('博客的块类型：有 render', async () => {
    const shape = {
      name: 'shape',
      form: 'text',
      attributes: { kind: { type: 'enum', options: ['scalar', 'matrix'], default: 'scalar' } },
      render: ({ attributes, children }) => ['span', { class: `math-shape ${attributes.kind}` }, children],
    };
    const html = await htmlOf('形状是 :shape[矩阵]{kind=matrix}。\n', { blocks: [shape] });
    assert.ok(html.includes('<span class="math-shape matrix" data-md=":shape[矩阵]{kind=matrix}">矩阵</span>'), html);
  });

  test('博客的块类型：没有 render', async () => {
    const blocks = [
      { name: 'theorem', form: 'container', attributes: { title: { type: 'string' }, kind: { type: 'string', default: 'plain' } } },
      { name: 'tag', form: 'text', attributes: {} },
    ];
    const html = await htmlOf(':::theorem{title=链式法则}\n内容 :tag[标签]。\n:::\n', { blocks });
    assert.ok(
      html.includes(
        '<div class="theorem" data-kind="plain" data-title="链式法则" data-md=":::theorem{title=链式法则}\n内容 :tag[标签]。\n:::"><p>内容 <span class="tag" data-md=":tag[标签]">标签</span>。</p></div>',
      ),
      html,
    );
  });
});

describe('公式', () => {
  test('同一个公式的多个 label 都指向这个公式', async () => {
    const html = await htmlOf('$$\n\\begin{align} a &= 1 \\label{eq:a} \\\\ b &= 2 \\label{eq:b} \\end{align}\n$$\n\n$\\eqref{eq:b}$\n');
    assert.ok(html.includes('id="eq-a"'), html);
    assert.ok(html.includes('<a class="eqref" href="#eq-a">(2)</a>'), html);
  });

  test('同名的 label 作为公式的第一个 label 时只报一条错误', async () => {
    assert.deepEqual(await messagesOf('$$\nx \\label{eq:a}\n$$\n\n$$\ny \\label{eq:a}\n$$\n'), [
      { line: 5, column: 1, text: 'Duplicate equation label eq:a' },
    ]);
  });

  test('同名的 label 报错', async () => {
    assert.deepEqual(await messagesOf('$$\nx \\label{eq:a}\n$$\n\n$$\n\\begin{align} y \\label{eq:b} \\\\ z \\label{eq:a} \\end{align}\n$$\n'), [
      { line: 5, column: 1, text: 'Duplicate equation label eq:a' },
    ]);
  });

  test('行内公式和独立公式的外层元素', async () => {
    const html = withoutSvg(await htmlOf('行内 $a+b$。\n\n$$\nc\n$$\n'));
    assert.ok(html.includes('<span class="math" data-tex="a+b"><svg/></span>'), html);
    assert.ok(html.includes('<div class="math display" data-tex="c"><svg/></div>'), html);
    assert.ok(!html.includes('mjx-container'));
  });

  test('行内公式输出为一个完整的 svg', async () => {
    const html = await htmlOf('质能方程 $E = mc^2 + \\alpha \\beta \\gamma \\delta$ 写在段落里。\n');
    assert.equal(html.match(/<svg/g).length, 1);
    assert.equal(glyphIds(html).size, 10);
  });

  test('同一个公式出现两次时 MathJax 只调用一次', async () => {
    await htmlOf('预热 $w$。\n');
    const convert = mock.method(AbstractMathDocument.prototype, 'convertPromise');
    try {
      await htmlOf('$\\alpha_{17} + \\beta$ 与 $\\alpha_{17} + \\beta$。\n');
      assert.equal(convert.mock.callCount(), 1);
      await htmlOf('另一页 $\\alpha_{17} + \\beta$。\n');
      assert.equal(convert.mock.callCount(), 1);
    } finally {
      convert.mock.restore();
    }
  });

  test('mathDefs 只包含这一页用到的字形', async () => {
    await htmlOf('$\\Omega \\cdot \\Psi$\n');
    const { html, mathDefs } = await renderBody('$x$\n');
    assert.ok(mathDefs.startsWith('<svg style="display:none"><defs>'));
    assert.ok(mathDefs.endsWith('</defs></svg>'));
    assert.deepEqual(definedGlyphIds(mathDefs), glyphIds(html));
    assert.equal(glyphIds(html).size, 1);
  });

  test('没有公式时 mathDefs 为空字符串', async () => {
    const { mathDefs } = await renderBody('正文。\n');
    assert.equal(mathDefs, '');
  });

  test('编号和 \\eqref', async () => {
    const body = '见式 $\\eqref{eq:b}$ 和 $\\eqref{eq:a}$。\n\n$$\n\\label{eq:a}\na = 1\n$$\n\n$$\nc = 3\n$$\n\n$$\n\\label{eq:b}\nb = 2\n$$\n';
    const { html, ids, messages } = await renderBody(body);
    assert.deepEqual(messages, []);
    assert.ok(html.includes('见式 <a class="eqref" href="#eq-b">(2)</a> 和 <a class="eqref" href="#eq-a">(1)</a>。'), html);
    const plain = withoutSvg(html);
    assert.ok(plain.includes('<div class="math display" data-tex="\\label{eq:a}\na = 1" id="eq-a"><svg/></div>'), plain);
    assert.ok(plain.includes('<div class="math display" data-tex="c = 3"><svg/></div>'), plain);
    assert.ok(plain.includes('id="eq-b"'));
    assert.deepEqual(ids, ['eq-a', 'eq-b']);
    const tagged = await htmlOf('$$\na = 1 \\tag{1}\n$$\n');
    const equationA = html.match(/id="eq-a">(<svg[\s\S]*?<\/svg>)/)[1];
    assert.equal(equationA, tagged.match(/data-tex="a = 1 \\tag\{1\}">(<svg[\s\S]*?<\/svg>)/)[1]);
  });

  test('\\eqref 指向不存在的 \\label', async () => {
    assert.deepEqual(await messagesOf('见 $\\eqref{eq:grad}$。\n'), [
      { line: 1, column: 3, text: '\\eqref target eq:grad is not defined' },
    ]);
  });

  test('\\eqref 不能和其他内容写在同一个公式里', async () => {
    assert.deepEqual(await messagesOf('$$\n\\label{eq:a}\na\n$$\n\n见 $x = \\eqref{eq:a}$。\n'), [
      { line: 6, column: 3, text: '\\eqref must be the only content of its formula' },
    ]);
  });

  test('宏', async () => {
    const macro = withoutSvg(await htmlOf('$\\R^n$\n'));
    assert.ok(macro.includes('data-tex="\\R^n"'));
    const [withMacro] = (await htmlOf('$\\R^n$\n')).match(/<svg[\s\S]*<\/svg>/);
    const [expanded] = (await htmlOf('$\\mathbb{R}^n$\n')).match(/<svg[\s\S]*<\/svg>/);
    assert.equal(withMacro, expanded);
    assert.deepEqual(await messagesOf('$\\R$\n', { config: {} }), [
      { line: 1, column: 1, text: 'Invalid TeX: Undefined control sequence \\R' },
    ]);
  });

  test('TeX 语法错误的行列', async () => {
    assert.deepEqual(await messagesOf('第一行。\n\n文字 $\\frac{a$ 文字。\n'), [
      { line: 3, column: 4, text: 'Invalid TeX: Missing close brace' },
    ]);
  });
});

describe('旁注', () => {
  test('注释里有脚注引用时报错', async () => {
    assert.deepEqual(await messagesOf('正文[^a]。\n\n[^a]: 注释[^b]\n\n[^b]: 嵌套\n'), [
      { line: 3, column: 9, text: 'A sidenote cannot contain a footnote reference' },
    ]);
  });

  test('编号按引用的顺序', async () => {
    const html = await htmlOf('甲[^b]乙[^a]。\n\n[^a]: 注释 A\n\n[^b]: 注释 B\n');
    assert.ok(
      html.includes(
        '<p>甲<sup class="sidenote-ref" id="sn-ref-1"><a href="#sn-1">1</a></sup>乙<sup class="sidenote-ref" id="sn-ref-2"><a href="#sn-2">2</a></sup>。</p>\n' +
          '<aside class="sidenote" id="sn-1" data-md="[^b]: 注释 B"><span class="sidenote-number">1</span><p>注释 B</p></aside>\n' +
          '<aside class="sidenote" id="sn-2" data-md="[^a]: 注释 A"><span class="sidenote-number">2</span><p>注释 A</p></aside>',
      ),
      html,
    );
  });

  test('注释放在包含引用的段落之后', async () => {
    const html = await htmlOf('第一段[^a]。\n\n第二段。\n\n[^a]: 注释\n');
    assert.match(html, /^<p>第一段<sup[^\n]*<\/sup>。<\/p>\n<aside class="sidenote" id="sn-1"[^\n]*<\/aside>\n<p>第二段。<\/p>$/);
  });

  test('引用在标题里时注释放在标题之后', async () => {
    const html = await htmlOf('## 标题[^a] {#t}\n\n正文。\n\n[^a]: 注释\n');
    assert.match(html, /<\/h2>\n<aside class="sidenote" id="sn-1"[^\n]*<\/aside>\n<p>正文。<\/p>/);
  });

  test('引用在表格里时注释放在表格之后', async () => {
    const html = await htmlOf('| 函数 | 导数 |\n| - | - |\n| ReLU[^a] | 1 |\n\n[^a]: 注释\n');
    assert.match(html, /<\/table><\/div>\n<aside class="sidenote" id="sn-1"/);
  });

  test('引用在列表项的段落里时注释放在该段落之后', async () => {
    const html = await htmlOf('- 第一项[^a]\n- 第二项\n\n[^a]: 注释\n');
    assert.match(html, /<li>第一项<sup[^\n]*<\/sup>\n<aside class="sidenote" id="sn-1"[^\n]*<\/aside>\n<\/li>\n<li>第二项<\/li>/);
    const loose = await htmlOf('- 第一段[^a]\n\n  第二段\n\n[^a]: 注释\n');
    assert.match(loose, /<li>\n<p>第一段<sup[^\n]*<\/sup><\/p>\n<aside class="sidenote" id="sn-1"[^\n]*<\/aside>\n<p>第二段<\/p>\n<\/li>/);
  });

  test(':span', async () => {
    const html = await htmlOf('甲[^a]。:span[激活函数的导数][^b]决定了梯度。\n\n[^a]: 注释 A\n\n[^b]: 注释 B\n');
    assert.ok(
      html.includes(
        '<span class="sidenote-span" data-md=":span[激活函数的导数]" data-sidenote="2">激活函数的导数</span><sup class="sidenote-ref" id="sn-ref-2"><a href="#sn-2">2</a></sup>',
      ),
      html,
    );
  });
});

describe('id 和目录', () => {
  test('去掉公式后合并空白再生成 id', async () => {
    const { ids } = await renderBody('## $x$ 公式  $y$  标题 $z$\n');
    assert.deepEqual(ids, ['公式-标题']);
  });

  test('标题文字生成不出 id 时报错', async () => {
    assert.deepEqual(await messagesOf('## ？！\n'), [{ line: 1, column: 1, text: 'Cannot generate an id from this heading, add {#id}' }]);
  });

  test('从标题文字生成 id', async () => {
    const { ids, html } = await renderBody('## 链式 法则\n\n## 链式 法则\n\n## Back Propagation!\n');
    assert.deepEqual(ids, ['链式-法则', '链式-法则-1', 'back-propagation']);
    assert.ok(html.includes('<h2 id="链式-法则-1"><a class="anchor" href="#链式-法则-1" aria-hidden="true">#</a>链式 法则</h2>'));
  });

  test('显式 id 与生成的 id 冲突时生成的 id 加后缀', async () => {
    const { ids, messages } = await renderBody('## Intro\n\n## 别的标题 {#intro}\n');
    assert.deepEqual(messages, []);
    assert.deepEqual(ids, ['intro-1', 'intro']);
  });

  test('重复的 id 报错', async () => {
    assert.deepEqual(await messagesOf('## 一 {#a}\n\n## 二 {#a}\n\n段落。 ^a\n\n$$\n\\label{a}\nx\n$$\n'), [
      { line: 3, column: 1, text: 'Duplicate id a' },
      { line: 5, column: 1, text: 'Duplicate id a' },
      { line: 7, column: 1, text: 'Duplicate id a' },
    ]);
  });

  test('目录包含 h2 和 h3，优先使用 toc 属性', async () => {
    const { toc } = await renderBody('# 一级\n\n## 链式法则 {#chain toc=链式}\n\n### 小节\n\n#### 四级\n');
    assert.deepEqual(toc, [
      { id: 'chain', html: '链式', depth: 2 },
      { id: '小节', html: '小节', depth: 3 },
    ]);
  });

  test('标题里的公式在目录中显示为 SVG，不进入生成的 id', async () => {
    const { toc, ids } = await renderBody('## 公式 $\\alpha$ 标题[^a]\n\n[^a]: 注释\n');
    assert.deepEqual(ids, ['公式-标题']);
    assert.match(toc[0].html, /^公式 <span class="math" data-tex="\\alpha"><svg[\s\S]*<\/svg><\/span> 标题$/);
  });

  test('只含图片的段落把 ^block-id 放在 figure 上', async () => {
    const html = await htmlOf('![图](./assets/neuron.svg) ^fig\n');
    assert.ok(html.startsWith('<figure class="image" id="fig">'), html);
  });
});

describe('站内链接和组件', () => {
  test('指向文件的链接不改写也不收集，查询参数保留在末尾 / 之后', async () => {
    const { html, links } = await renderBody('[pdf](/assets/a.pdf) [feed](/feed.xml) [q](/a?x=1) [h](/a?x=1#b)\n');
    assert.ok(html.includes('href="/assets/a.pdf"') && html.includes('href="/feed.xml"'), html);
    assert.deepEqual(links.map((link) => link.href), ['/a/?x=1', '/a/?x=1#b']);
  });

  test('收集站内链接并统一为带末尾 / 的形式', async () => {
    const { links, html } = await renderBody('[a](/topic/page) [b](/topic/page#x) [c](#y) [d](/topic/) [e](https://example.com/a)\n');
    assert.deepEqual(links, [
      { href: '/topic/page/', line: headerLines + 1, column: 1 },
      { href: '/topic/page/#x', line: headerLines + 1, column: 18 },
      { href: '#y', line: headerLines + 1, column: 37 },
      { href: '/topic/', line: headerLines + 1, column: 45 },
    ]);
    assert.ok(html.includes('<a href="/topic/page/#x">b</a>'));
    assert.ok(html.includes('<a href="https://example.com/a">e</a>'));
  });

  test('按文档顺序收集图片地址和位置', async () => {
    const { images } = await renderBody('![a](./a.png)\n\n文字 ![b](https://example.com/b.png){width=10}\n');
    assert.deepEqual(images, [
      { src: './a.png', line: headerLines + 1, column: 1 },
      { src: 'https://example.com/b.png', line: headerLines + 3, column: 4 },
    ]);
  });

  test('正文用到的组件名', async () => {
    const { components: used } = await renderBody('::demo-plot\n\n:::demo-plot\n图题\n:::\n');
    assert.deepEqual(used, ['demo-plot']);
  });

  test('messages 包含 parse 的错误', async () => {
    assert.deepEqual(await messagesOf(':::callot\n内容\n:::\n'), [{ line: 1, column: 1, text: 'Unknown directive :::callot' }]);
  });
});
