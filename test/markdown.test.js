import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseArticle } from '../src/markdown/article.js';
import { formatError, sortErrors } from '../src/report.js';

const fixturesDir = new URL('./fixtures/syntax-errors/', import.meta.url);
const markdownFixtures = ['duplicate-anchor.md', 'unknown-heading-attribute.md', 'unknown-block.md', 'invalid-width.md', 'undefined-footnote.md', 'missing-citation.md'];
const frontMatter = '---\ntitle: T\nslug: t\ndate: 2026-10-19\n---\n\n';

function parse(body) {
  const errors = [];
  const article = parseArticle('index.md', frontMatter + body, errors);
  return { article, errors: sortErrors(errors).map(formatError) };
}

function parsed(body) {
  const { article, errors } = parse(body);
  assert.deepEqual(errors, []);
  return article;
}

function html(body) {
  return parsed(body).intro.map((block) => block.html).join('\n');
}

describe('markdown fixtures', () => {
  test('syntax error fixtures for text syntax report the lines in expected.json', () => {
    const expected = JSON.parse(readFileSync(new URL('expected.json', fixturesDir), 'utf8'));
    for (const name of markdownFixtures) {
      const errors = [];
      parseArticle(name, readFileSync(new URL(name, fixturesDir), 'utf8'), errors);
      assert.deepEqual(errors.map(formatError), [expected[name]], name);
    }
  });

  test('the syntax article parses without errors into its sections, sidenotes and references', () => {
    const source = readFileSync(new URL('../examples/blog/content/posts/syntax/index.md', import.meta.url), 'utf8');
    const errors = [];
    const article = parseArticle('index.md', source, errors);
    assert.deepEqual(errors.map(formatError), []);
    assert.deepEqual(
      article.toc.map((entry) => `${entry.number} ${entry.id} ${entry.title}`),
      [
        '01 front-matter front matter',
        '02 headings 标题',
        '03 inline 段落内的写法',
        '04 lists 列表与引用',
        '05 aside-fold 提示框与折叠块',
        '06 sidenotes 旁注',
        '07 citations 参考文献',
        '08 math 公式与公式宏',
        '09 code 代码',
        '10 tables 表格与 list-table',
        '11 images 图片与浮动',
        '12 width 宽度写法',
        '13 components 交互组件',
        '14 links 站内链接与嵌入',
        '15 errors 附录：构建报错的写法',
      ],
    );
    assert.deepEqual(article.toc[1].children, [{ id: 'recap', title: '小节要点', recap: undefined }]);
    assert.equal(article.sections[11].width, 'wide');
    assert.deepEqual(article.sidenotes.map((note) => note.number), [1, 2]);
    assert.deepEqual(article.references.map((entry) => `${entry.number} ${entry.key}`), ['1 shazeer2020', '2 gelu']);
  });
});

describe('headings and anchors', () => {
  test('numbers ## sections and lists ### headings under them in the table of contents', () => {
    const article = parsed('Intro.\n\n## First {#one toc="1st"}\n\nA.\n\n### Inner\n\nB.\n\n## Second {width=page}\n\nC.\n');
    assert.deepEqual(article.intro.map((block) => block.html), ['<p>Intro.</p>']);
    assert.deepEqual(
      article.sections.map(({ id, number, title, text, toc, width, line }) => ({ id, number, title, text, toc, width, line })),
      [
        { id: 'one', number: '01', title: 'First', text: 'First', toc: '1st', width: undefined, line: 9 },
        { id: 'second', number: '02', title: 'Second', text: 'Second', toc: 'Second', width: 'page', line: 17 },
      ],
    );
    assert.deepEqual(article.sections[0].blocks.map((block) => block.html), ['<p>A.</p>', '<h3 id="inner">Inner</h3>', '<p>B.</p>']);
    assert.deepEqual(article.sections[0].blocks[1], { type: 'heading', line: 13, endLine: 13, html: '<h3 id="inner">Inner</h3>', depth: 3, id: 'inner', title: 'Inner', text: 'Inner', toc: 'Inner' });
    assert.deepEqual(article.toc, [
      { id: 'one', number: '01', title: '1st', recap: undefined, children: [{ id: 'inner', title: 'Inner', recap: undefined }] },
      { id: 'second', number: '02', title: 'Second', recap: undefined, children: [] },
    ]);
  });

  test('keeps inline markup in section titles', () => {
    assert.equal(parsed('## The **bold** $x$ title\n').sections[0].title, 'The <strong>bold</strong> <code class="language-math math-inline">x</code> title');
  });

  test('generates ids from the heading text and avoids ids written elsewhere', () => {
    const article = parsed('## 激活函数 GELU\n\n## Intro\n\n## Other {#intro}\n\n## Intro\n');
    assert.deepEqual(article.sections.map((section) => section.id), ['激活函数-gelu', 'intro-1', 'intro', 'intro-2']);
  });

  test('gives a paragraph ending in ^name that anchor and removes it from the text', () => {
    const article = parsed('每一层的梯度都由局部导数得到。^local-grad\n\nTwo to the 2^10\n');
    assert.deepEqual(article.intro.map((block) => [block.id, block.html]), [
      ['local-grad', '<p id="local-grad">每一层的梯度都由局部导数得到。</p>'],
      [undefined, '<p>Two to the 2^10</p>'],
    ]);
  });

  test('reports an anchor that is also the id of a sidenote or a reference', () => {
    assert.deepEqual(parse('## A {#sidenote-1}\n\nText[^a] [@k]. ^reference-k\n\n[^a]: Note.\n\n:::references\n- [@k] K.\n:::\n').errors, [
      'index.md:7:6 anchor "sidenote-1" is also the id of sidenote 1',
      'index.md:9:16 anchor "reference-k" is also the id of the reference "k"',
    ]);
  });

  test('gives a heading another id when its text makes the id of a sidenote', () => {
    assert.equal(parsed('## Sidenote 1\n\nText[^a].\n\n[^a]: Note.\n').sections[0].id, 'sidenote-1-1');
  });

  test('reports a duplicate anchor between a heading and a paragraph at the later one', () => {
    assert.deepEqual(parse('## A {#chain}\n\nText. ^chain\n').errors, ['index.md:9:7 duplicate anchor "chain", first defined at 7:6']);
  });

  const headingErrors = [
    ['## A {width=full}', 'index.md:7:6 width must be body, wide or page, got "full"'],
    ['### A {width=wide}', 'index.md:7:7 width only applies to ## headings'],
    ['## A {toc}', 'index.md:7:6 toc must be a short title in quotes, for example toc="Short title"'],
    ['## A {.red}', 'index.md:7:6 unknown attribute "class" on heading'],
    ['## A {toc="a" toc="b"}', 'index.md:7:6 attribute "toc" is written twice'],
    ['## A {toc="unclosed}', 'index.md:7:6 cannot read the attributes {toc="unclosed}; write them as {#id key=value key="text with spaces"}'],
    ['# Title', 'index.md:7:1 heading level 1 is not allowed; the article title comes from front matter, sections start at ##'],
  ];
  for (const [line, message] of headingErrors) {
    test(`reports ${message.slice(message.indexOf(' ') + 1)}`, () => {
      assert.deepEqual(parse(`${line}\n`).errors, [message]);
    });
  }
});

describe('inline syntax', () => {
  test('renders highlight, emphasis, strikethrough, code, links and math', () => {
    assert.equal(
      html('激活函数 $\\phi$ ==逐元素==作用，见 [epilogue](https://example.com)，`act_fn`。**粗体**、*斜体* 和 ~~删除线~~。'),
      '<p>激活函数 <code class="language-math math-inline">\\phi</code> <mark>逐元素</mark>作用，见 <a href="https://example.com">epilogue</a>，<code>act_fn</code>。<strong>粗体</strong>、<em>斜体</em> 和 <del>删除线</del>。</p>',
    );
  });

  test('closes emphasis and highlight next to Chinese punctuation', () => {
    assert.equal(html('这是**“引号”**后面，==“重点”==后面。'), '<p>这是<strong>“引号”</strong>后面，<mark>“重点”</mark>后面。</p>');
  });

  test('keeps highlight markers that are surrounded by spaces and single tildes as text', () => {
    assert.equal(html('a == b == c，范围 1~2 和 3~4'), '<p>a == b == c，范围 1~2 和 3~4</p>');
  });

  test('keeps \\eqref as text for the math renderer', () => {
    assert.equal(html('由式 \\eqref{eq:ffn} 可知'), '<p>由式 \\eqref{eq:ffn} 可知</p>');
  });
});

describe('lists and quotes', () => {
  test('renders nested lists with a highlighted lead', () => {
    assert.equal(
      html('- ==$f(0)$ 是多少==：输入为零时。\n  - 嵌套。\n\n1. 一\n2. 二\n'),
      '<ul>\n<li><mark><code class="language-math math-inline">f(0)</code> 是多少</mark>：输入为零时。\n<ul>\n<li>嵌套。</li>\n</ul>\n</li>\n</ul>\n<ol>\n<li>一</li>\n<li>二</li>\n</ol>',
    );
  });

  test('shows a last quote paragraph that starts with an em dash as the source', () => {
    assert.equal(
      html('> Quote.\n>\n> — Shazeer, *GLU Variants*, 2020\n'),
      '<figure class="quote"><blockquote>\n<p>Quote.</p>\n</blockquote><figcaption>Shazeer, <em>GLU Variants</em>, 2020</figcaption></figure>',
    );
  });

  test('keeps a quote without a source as a plain blockquote', () => {
    assert.equal(html('> — only a dash line\n'), '<blockquote>\n<p>— only a dash line</p>\n</blockquote>');
  });
});

describe('aside and fold', () => {
  test('renders an aside with and without a title', () => {
    assert.equal(html(':::aside{title="阅读约定"}\n本文的 $x$。\n:::\n'), '<aside class="aside"><p class="aside-title">阅读约定</p>\n<p>本文的 <code class="language-math math-inline">x</code>。</p>\n</aside>');
    assert.equal(html(':::aside\n没有小标题。\n:::\n'), '<aside class="aside">\n<p>没有小标题。</p>\n</aside>');
  });

  test('renders a fold inside which another block is nested with fewer colons', () => {
    const article = parsed('::::fold{title="实现细节"}\n:::aside{title="注意"}\n融合。\n:::\n::::\n');
    assert.deepEqual(article.intro.map((block) => [block.type, block.line, block.endLine]), [['fold', 7, 11]]);
    assert.equal(article.intro[0].html, '<details class="fold"><summary>实现细节</summary>\n<aside class="aside"><p class="aside-title">注意</p>\n<p>融合。</p>\n</aside>\n</details>');
  });

  test('reports a block without a closing line and keeps the sections after it', () => {
    const { article, errors } = parse('## A\n\n:::aside\nText.\n\n## B\n');
    assert.deepEqual(errors, ['index.md:9:1 :::aside is not closed; end it with a line of 3 or more colons']);
    assert.equal(article.sections.length, 1);
  });

  test('reports a nested block with as many colons as its outer block and the ::: line left over', () => {
    assert.deepEqual(parse(':::aside\n:::fold{title=x}\nhi\n:::\n:::\n').errors, [
      'index.md:8:1 :::fold is not closed; end it with a line of 3 or more colons',
      'index.md:11:1 this ::: line closes no block; a block inside another block needs fewer colons than the outer block',
    ]);
  });

  test('keeps ::: lines inside a fenced code block from closing the block around it', () => {
    const article = parsed(':::aside\n```markdown\n:::\n```\n~~~~\n:::\n~~~\n:::\n~~~~\n:::\n\n## After\n');
    assert.equal(article.intro[0].html, '<aside class="aside">\n<pre><code class="language-markdown">:::\n</code></pre>\n<pre><code>:::\n~~~\n:::\n</code></pre>\n</aside>');
    assert.deepEqual(article.sections.map((section) => section.id), ['after']);
  });

  test('treats a line that starts with ::: followed by prose as text', () => {
    assert.equal(html(':::example 块的写法是：\n'), '<p>:::example 块的写法是：</p>');
  });

  const blockErrors = [
    [':::fold\nText.\n:::', 'index.md:9:1 :::fold is missing "title"'],
    [':::aside{color=red}\nText.\n:::', 'index.md:9:1 unknown attribute "color" on :::aside'],
    [':::recap{x=1}\nText.\n:::', 'index.md:9:1 unknown attribute "x" on :::recap'],
  ];
  for (const [source, message] of blockErrors) {
    test(`reports ${message.slice(message.indexOf(' ') + 1)}`, () => {
      assert.deepEqual(parse(`## A\n\n${source}\n`).errors, [message]);
    });
  }
});

describe(':::recap', () => {
  test('stores the recap of a ### or ## heading in the table of contents and not in the body', () => {
    const article = parsed('## A\n\n:::recap\n要点 $x$。\n:::\n\n### B\n\nText.\n\n:::recap\n$$\ny\n$$\n:::\n');
    assert.equal(article.toc[0].recap, '<p>要点 <code class="language-math math-inline">x</code>。</p>');
    assert.equal(article.toc[0].children[0].recap, '<pre><code class="language-math math-display">y</code></pre>');
    assert.deepEqual(article.sections[0].blocks.map((block) => block.type), ['heading', 'paragraph']);
  });

  test('keeps a recap nested in another block in place', () => {
    assert.equal(parsed('## A\n\n::::aside\n:::recap\nB.\n:::\n::::\n').sections[0].blocks[0].html, '<aside class="aside">\n<div class="recap">\n<p>B.</p>\n</div>\n</aside>');
  });

  test('reports a recap before the first heading and a second recap in one section', () => {
    assert.deepEqual(parse(':::recap\nA.\n:::\n\n## B\n\n:::recap\nB.\n:::\n\n:::recap\nC.\n:::\n').errors, [
      'index.md:7:1 :::recap must follow a ## or ### heading',
      'index.md:17:1 this section already has a :::recap at 13:1',
    ]);
  });
});

describe('sidenotes', () => {
  test('numbers footnotes by first reference and renders their definitions as sidenotes', () => {
    const article = parsed('B[^b] and A[^a], B again[^b].\n\n[^a]: Note *a* with $x$.\n[^b]: Note b.\n');
    assert.equal(
      article.intro[0].html,
      '<p>B<sup class="sidenote-ref" data-sidenote="1"><a href="#sidenote-1">1</a></sup> and A<sup class="sidenote-ref" data-sidenote="2"><a href="#sidenote-2">2</a></sup>, B again<sup class="sidenote-ref" data-sidenote="1"><a href="#sidenote-1">1</a></sup>.</p>',
    );
    assert.deepEqual(article.intro.length, 1);
    assert.deepEqual(article.sidenotes, [
      { number: 1, id: 'sidenote-1', line: 10, html: '<p>Note b.</p>' },
      { number: 2, id: 'sidenote-2', line: 9, html: '<p>Note <em>a</em> with <code class="language-math math-inline">x</code>.</p>' },
    ]);
  });

  test('reports an undefined footnote at its position inside a list item and keeps it as text', () => {
    const { article, errors } = parse('- item\n  continued[^gemm]\n');
    assert.deepEqual(errors, ['index.md:8:12 footnote "gemm" has no definition']);
    assert.match(article.intro[0].html, /continued\[\^gemm\]/);
  });

  test('reports a footnote that is defined twice or never used', () => {
    assert.deepEqual(parse('A[^a].\n\n[^a]: One.\n[^a]: Two.\n[^b]: Unused.\n').errors, [
      'index.md:10:1 footnote "a" is defined twice, first at 9:1',
      'index.md:11:1 footnote "b" is defined but never used',
    ]);
  });
});

describe('citations', () => {
  const references = ':::references\n- [@a] Author A. *Title A*. 2020.\n- [@b] Author B. 2021.\n- [@c] Author C. 2022.\n:::\n';

  test('numbers citations by first occurrence and lists uncited entries after them', () => {
    const article = parsed(`See [@b], then [@a] and [@b].[^n]\n\n[^n]: Also [@c].\n\n${references}`);
    assert.equal(
      article.intro[0].html,
      '<p>See <a class="citation" href="#reference-b">[1]</a>, then <a class="citation" href="#reference-a">[2]</a> and <a class="citation" href="#reference-b">[1]</a>.<sup class="sidenote-ref" data-sidenote="1"><a href="#sidenote-1">1</a></sup></p>',
    );
    assert.deepEqual(article.references.map(({ number, key, id, html }) => [number, key, id, html]), [
      [1, 'b', 'reference-b', 'Author B. 2021.'],
      [2, 'a', 'reference-a', 'Author A. <em>Title A</em>. 2020.'],
      [3, 'c', 'reference-c', 'Author C. 2022.'],
    ]);
    assert.equal(article.intro[1].html, '<ol class="references"><li id="reference-b" value="1">Author B. 2021.</li><li id="reference-a" value="2">Author A. <em>Title A</em>. 2020.</li><li id="reference-c" value="3">Author C. 2022.</li></ol>');
  });

  test('reports citations missing from :::references and malformed reference lists', () => {
    assert.deepEqual(parse('See [@x].\n').errors, ['index.md:7:5 citation "x" is not in :::references']);
    assert.deepEqual(parse(':::references\n- [@a] One.\n- Two.\n- [@a] Three.\n:::\n\n:::references\nText.\n:::\n').errors, [
      'index.md:9:1 each :::references item is one paragraph that starts with [@key]',
      'index.md:10:3 reference "a" is listed twice, first at 8:3',
      'index.md:13:1 an article has one :::references block, the first is at 7:1',
    ]);
  });

  test('keeps links whose text starts with @ or ^ as links', () => {
    assert.equal(
      html('By [@yhnocoder](https://github.com/yhnocoder), see [@ref][r] and [^x](https://example.com).\n\n[r]: https://example.org\n'),
      '<p>By <a href="https://github.com/yhnocoder">@yhnocoder</a>, see <a href="https://example.org">@ref</a> and <a href="https://example.com">^x</a>.</p>',
    );
  });

  test('keeps a shortcut reference link whose label starts with @ as a link', () => {
    assert.equal(html('See [@home].\n\n[@home]: https://example.com\n'), '<p>See <a href="https://example.com">@home</a>.</p>');
  });

  test('keeps an escaped citation as text', () => {
    assert.equal(html('Write \\[@key] for a citation.'), '<p>Write [@key] for a citation.</p>');
  });
});

describe('blocks', () => {
  test('reports an unknown block and keeps components with their attributes', () => {
    assert.deepEqual(parse(':::warning\nText.\n:::\n').errors, ['index.md:7:1 unknown block ":::warning"']);
    const [block] = parsed(':::act-fn-plot{fn=gelu range=6}\nCaption.\n:::\n').intro;
    assert.deepEqual({ type: block.type, name: block.name, attributes: block.attributes }, { type: 'component', name: 'act-fn-plot', attributes: { fn: 'gelu', range: '6' } });
  });

  test('gives the block inside :::{width=…} that width', () => {
    const [block] = parsed('::::{width=page}\n:::aside\nWide.\n:::\n::::\n').intro;
    assert.deepEqual([block.type, block.width, block.line, block.endLine], ['aside', 'page', 7, 11]);
  });

  test('reports :::{…} without width, with other attributes or around several blocks', () => {
    assert.deepEqual(parse(':::{size=2}\nA.\n:::\n\n:::{width=wide}\nA.\n\nB.\n:::\n').errors, [
      'index.md:7:1 unknown attribute "size" on :::{width=…}',
      'index.md:7:1 a block without a name must set width, for example :::{width=wide}',
      'index.md:11:1 :::{width=…} must contain exactly one block',
    ]);
  });

  test('reports positions in files with CRLF line endings', () => {
    const errors = [];
    parseArticle('index.md', frontMatter.replaceAll('\n', '\r\n') + 'Text.\r\n\r\n## A {#a}\r\n\r\nB[^x] ^a\r\n', errors);
    assert.deepEqual(sortErrors(errors).map(formatError), ['index.md:11:2 footnote "x" has no definition', 'index.md:11:7 duplicate anchor "a", first defined at 9:6']);
  });
});
