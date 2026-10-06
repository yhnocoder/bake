import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import builtinBlocks from '../src/blocks/index.js';
import { format, parse, stringify } from '../src/format/index.js';
import { createRegistry } from '../src/format/registry.js';
import * as bento from '../src/layouts/bento.js';
import * as essay from '../src/layouts/essay.js';
import * as paper from '../src/layouts/paper.js';

const root = join(import.meta.dirname, '..');
const layouts = { essay: essay.fields, paper: paper.fields, bento: bento.fields };
const components = {
  'demo-plot': {
    x0: { label: 'x₀ 初始值', type: 'number', default: 1.2 },
    showPath: { label: '显示路径', type: 'boolean', default: true },
  },
};
const options = { path: 'post.md', components, layouts, themes: ['blue'] };

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

function messagesOf(body, extra = {}) {
  return parse(`---\ntitle: 测试\n---\n\n${body}`, { ...options, ...extra }).messages;
}

function only(body, extra) {
  const messages = messagesOf(body, extra);
  assert.equal(messages.length, 1, JSON.stringify(messages));
  const [{ line, column, text }] = messages;
  return { line, column, text };
}

function firstBlock(source) {
  return parse(source).tree.children[0];
}

describe('往返', () => {
  const files = markdownFiles(join(root, 'examples'));

  test('examples 下至少有一个文件', () => {
    assert.ok(files.length > 0);
  });

  for (const file of files) {
    test(file.slice(root.length + 1), () => {
      const source = readFileSync(file, 'utf8');
      assert.equal(format(source), source);
    });
  }

  test('features.md 没有错误', () => {
    const file = join(root, 'examples/minimal/content/features.md');
    const { messages } = parse(readFileSync(file, 'utf8'), { ...options, path: file });
    assert.deepEqual(messages, []);
  });
});

describe('幂等', () => {
  const cases = [
    ['* 列表', '* 一\n* 二\n', '- 一\n- 二\n'],
    ['下划线强调和加粗', '_强调_ 与 __加粗__\n', '*强调* 与 **加粗**\n'],
    ['Setext 标题', '一级\n===\n\n二级\n---\n', '# 一级\n\n## 二级\n'],
    [
      '带引号和不带引号的属性',
      ':::callout{kind="tip"}\n内容\n:::\n\n## 标题 {#a toc="短 标题"}\n\n![图](./a.png){width="60%" float=left}\n\n:::card{span="2x1" title="ReLU"}\n内容\n:::\n',
      ':::callout{kind=tip}\n内容\n:::\n\n## 标题 {#a toc="短 标题"}\n\n![图](./a.png){width=60% float=left}\n\n:::card{span=2x1 title=ReLU}\n内容\n:::\n',
    ],
    ['对齐过的表格', '| 函数   | 导数 |\n|:-------|-----:|\n| ReLU   | 1    |\n', '| 函数 | 导数 |\n| :- | -: |\n| ReLU | 1 |\n'],
    [
      '放在文末的旁注定义',
      '甲[^a]。\n\n:::callout\n乙[^b]丙[^c]。\n:::\n\n丁。\n\n[^c]: 注释丙\n[^b]: 注释乙\n[^a]: 注释甲\n',
      '甲[^a]。\n\n[^a]: 注释甲\n\n:::callout\n乙[^b]丙[^c]。\n:::\n\n[^b]: 注释乙\n\n[^c]: 注释丙\n\n丁。\n',
    ],
    ['有序列表编号', '1. 一\n1. 二\n1. 三\n', '1. 一\n2. 二\n3. 三\n'],
    ['硬换行', '第一行  \n第二行\n', '第一行\\\n第二行\n'],
    ['文件末尾', '段落\n\n\n', '段落\n'],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      const once = format(input);
      assert.equal(once, expected);
      assert.equal(format(once), once);
    });
  }

  test('frontmatter 原文不变', () => {
    const source = '---\ntitle:   有空格\ntags: [a,   b]\n---\n\n正文\n';
    assert.equal(format(source), source);
  });
});

describe('中文标点旁边的标记', () => {
  test('加粗后面是中文冒号', () => {
    const [, strong] = firstBlock('中文**加粗：**后面\n').children;
    assert.equal(strong.type, 'strong');
    assert.equal(strong.children[0].value, '加粗：');
  });

  test('加粗以引号开头', () => {
    const [strong] = firstBlock('**「引号」**测试\n').children;
    assert.equal(strong.type, 'strong');
    assert.equal(strong.children[0].value, '「引号」');
  });

  test('高亮后面是中文冒号', () => {
    const [, mark] = firstBlock('中文==重点：==后面\n').children;
    assert.equal(mark.type, 'mark');
    assert.equal(mark.children[0].value, '重点：');
  });
});

describe('高亮', () => {
  test('解析为 mark 节点', () => {
    const paragraph = firstBlock('梯度指向==增长最快==的方向。\n');
    assert.deepEqual(
      paragraph.children.map((child) => child.type),
      ['text', 'mark', 'text'],
    );
  });

  test('输出两个等号', () => {
    const source = '梯度指向==增长最快==的方向。\n';
    assert.equal(format(source), source);
  });

  test('三个等号和两侧有空格的等号不是高亮', () => {
    const paragraph = firstBlock('a === b，c == d\n');
    assert.deepEqual(
      paragraph.children.map((child) => child.type),
      ['text'],
    );
  });

  test('单个等号不转义', () => {
    const source = 'x=1，k = v\n';
    assert.equal(format(source), source);
  });

  test('从语法树输出', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'mark', children: [{ type: 'text', value: '重点' }] }] }],
    };
    assert.equal(stringify(tree), '==重点==\n');
  });
});

describe('属性', () => {
  test('标题属性', () => {
    const heading = firstBlock('## 链式法则 {#chain-rule toc=链式}\n');
    assert.deepEqual(heading.data.attributes, { id: 'chain-rule', toc: '链式' });
    assert.equal(heading.children[0].value, '链式法则');
  });

  test('图片属性', () => {
    const paragraph = firstBlock('![图](./a.svg){width=60% float=right}\n');
    assert.equal(paragraph.children.length, 1);
    assert.deepEqual(paragraph.children[0].data.attributes, { width: '60%', float: 'right' });
  });

  test('输出顺序：#id 在前，其余按定义顺序', () => {
    assert.equal(format('## 标题 {toc=短 #a}\n'), '## 标题 {#a toc=短}\n');
    assert.equal(format('![图](./a.svg){float=left height=2em width=10}\n'), '![图](./a.svg){width=10 height=2em float=left}\n');
  });

  test('值含空格时加引号', () => {
    const source = '## 标题 {toc="两个 词"}\n';
    assert.equal(format(source), source);
  });

  test('从语法树输出', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'heading', depth: 2, children: [{ type: 'text', value: '标题' }], data: { attributes: { id: 'x' } } },
      ],
    };
    assert.equal(stringify(tree), '## 标题 {#x}\n');
  });
});

describe('块引用 id', () => {
  test('解析', () => {
    const paragraph = firstBlock('链式法则把导数写成乘积。 ^chain-rule-def\n');
    assert.equal(paragraph.data.blockId, 'chain-rule-def');
    assert.equal(paragraph.children[0].value, '链式法则把导数写成乘积。');
  });

  test('输出', () => {
    const source = '链式法则把导数写成乘积。 ^chain-rule-def\n';
    assert.equal(format(source), source);
  });

  test('id 含其他字符时不解析', () => {
    const paragraph = firstBlock('文字 ^a_b\n');
    assert.equal(paragraph.data?.blockId, undefined);
  });
});

describe('校验：指令', () => {
  test('不认识的指令名', () => {
    assert.deepEqual(only(':::callot\n内容\n:::\n'), { line: 5, column: 1, text: 'Unknown directive :::callot' });
  });

  test('组件名不在 components 中', () => {
    assert.deepEqual(only('::demo-plt\n'), { line: 5, column: 1, text: 'Unknown component ::demo-plt' });
  });

  test('没有传入 components 时不检查组件', () => {
    assert.deepEqual(messagesOf('::demo-plt\n', { components: undefined }), []);
  });

  test('组件不能写成行内形式', () => {
    assert.deepEqual(only('文字 :demo-plot 文字\n'), {
      line: 5,
      column: 4,
      text: 'Component :demo-plot must be written as ::demo-plot or :::demo-plot',
    });
  });

  test('指令形式与定义不符', () => {
    assert.deepEqual(only('::callout\n'), { line: 5, column: 1, text: '::callout must be written as :::callout' });
  });

  test('属性不在定义中', () => {
    assert.deepEqual(only(':::callout{color=red}\n内容\n:::\n'), {
      line: 5,
      column: 1,
      text: 'Unknown attribute color on :::callout',
    });
  });

  test('enum 取值不在 options 中', () => {
    assert.deepEqual(only(':::callout{kind=info}\n内容\n:::\n'), {
      line: 5,
      column: 1,
      text: 'Attribute kind must be one of note, tip, warning, got info',
    });
  });

  test('数字类型不符', () => {
    assert.deepEqual(only('::demo-plot{x0=abc}\n'), { line: 5, column: 1, text: 'Attribute x0 must be a number, got abc' });
  });

  test('布尔类型不符', () => {
    assert.deepEqual(only('::demo-plot{showPath=yes}\n'), {
      line: 5,
      column: 1,
      text: 'Attribute showPath must be true or false, got yes',
    });
  });

  test('组件属性不在定义中', () => {
    assert.deepEqual(only('::demo-plot{size=3}\n'), { line: 5, column: 1, text: 'Unknown attribute size on ::demo-plot' });
  });
});

describe('校验：结构规则', () => {
  test('导语只能是正文第一个块', () => {
    assert.deepEqual(only('第一段。\n\n:::lede\n导语\n:::\n'), { line: 7, column: 1, text: ':::lede must be the first block' });
    assert.deepEqual(messagesOf(':::lede\n导语\n:::\n'), []);
  });

  test('::subtitle must directly follow a heading', () => {
    assert.deepEqual(only('段落。\n\n::subtitle[说明]\n'), { line: 7, column: 1, text: '::subtitle must directly follow a heading' });
    assert.deepEqual(messagesOf('## 标题\n\n::subtitle[说明]\n'), []);
  });

  test('::source must be the last child of a blockquote', () => {
    assert.deepEqual(only('> ::source[出处]\n>\n> 引文\n'), {
      line: 5,
      column: 3,
      text: '::source must be the last child of a blockquote',
    });
    assert.deepEqual(only('::source[出处]\n'), { line: 5, column: 1, text: '::source must be the last child of a blockquote' });
  });

  test('折叠块必须写标题', () => {
    assert.deepEqual(only(':::fold\n内容\n:::\n'), { line: 5, column: 1, text: ':::fold requires a title in brackets' });
  });

  test(':::bento can only contain :::card', () => {
    assert.deepEqual(only('::::bento\n段落\n::::\n'), { line: 5, column: 1, text: ':::bento can only contain :::card' });
  });

  test(':::card must be inside :::bento', () => {
    assert.deepEqual(only(':::card\n内容\n:::\n'), { line: 5, column: 1, text: ':::card must be inside :::bento' });
  });

  test('卡片的 span 格式', () => {
    assert.deepEqual(only('::::bento\n:::card{span=5x1}\n内容\n:::\n::::\n'), {
      line: 6,
      column: 1,
      text: ':::card span must be COLUMNSxROWS with 1 to 4 columns, got 5x1',
    });
  });

  test(':::references must contain exactly one list', () => {
    assert.deepEqual(only(':::references\n段落\n:::\n'), { line: 5, column: 1, text: ':::references must contain exactly one list' });
  });

  test('注释范围后面必须紧跟脚注引用', () => {
    assert.deepEqual(only('文字 :span[范围] 后面\n'), { line: 5, column: 4, text: ':span must be directly followed by a footnote reference' });
  });
});

describe('校验：HTML', () => {
  test('段落里的 HTML 标签', () => {
    assert.deepEqual(only('文字 <b>加粗</b>\n'), { line: 5, column: 4, text: 'HTML tag <b> is not allowed in a paragraph' });
  });

  test('标题里的 HTML 标签', () => {
    assert.deepEqual(only('## 标题 <em>x</em>\n'), { line: 5, column: 7, text: 'HTML tag <em> is not allowed in a heading' });
  });

  test('列表里的 HTML 标签', () => {
    assert.deepEqual(only('- <div>块</div>\n'), { line: 5, column: 3, text: 'HTML tag <div>块</div> is not allowed in a list' });
  });

  test('表格单元格里的 HTML 标签', () => {
    assert.deepEqual(only('| a |\n| - |\n| <br> |\n'), { line: 7, column: 3, text: 'HTML tag <br> is not allowed in a table cell' });
  });

  test('独立的 HTML 块不报错', () => {
    assert.deepEqual(messagesOf('<div>\n  <p>内容</p>\n</div>\n'), []);
  });
});

describe('校验：属性语法', () => {
  test('未知属性', () => {
    assert.deepEqual(only('## 标题 {#a color=red}\n'), { line: 5, column: 7, text: 'Unknown heading attribute color' });
  });

  test('取值不合法', () => {
    assert.deepEqual(only('## 标题 {#1a}\n'), {
      line: 5,
      column: 7,
      text: 'Heading attribute id must start with a letter and contain only letters, digits, - and _, got 1a',
    });
    assert.deepEqual(only('![图](./a.png){float=center}\n'), {
      line: 5,
      column: 14,
      text: 'Image attribute float must be one of none, left, right, got center',
    });
    assert.deepEqual(only('![图](./a.png){width=wide}\n'), {
      line: 5,
      column: 14,
      text: 'Image attribute width must be a number with optional px, %, or em, got wide',
    });
  });

  test('.class', () => {
    assert.deepEqual(only('## 标题 {.note}\n'), { line: 5, column: 7, text: 'Unsupported class attribute .note' });
  });
});

describe('校验：图片', () => {
  test('扩展名不支持', () => {
    assert.deepEqual(only('![图](./a.bmp)\n'), { line: 5, column: 1, text: 'Unsupported image format ./a.bmp' });
  });

  test('每种支持的扩展名', () => {
    for (const extension of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'PNG']) {
      assert.deepEqual(messagesOf(`![图](./a.${extension})\n`), []);
    }
  });

  test('Image must be the only content of its paragraph', () => {
    assert.deepEqual(only('文字 ![图](./a.png)\n'), { line: 5, column: 4, text: 'Image must be the only content of its paragraph' });
  });
});

describe('校验：旁注', () => {
  test('定义了没有被引用', () => {
    assert.deepEqual(only('正文。\n\n[^a]: 注释\n'), { line: 7, column: 1, text: 'Footnote [^a] is defined but never referenced' });
  });

  test('引用了没有定义', () => {
    assert.deepEqual(only('正文[^b]。\n'), { line: 5, column: 3, text: 'Footnote [^b] is not defined' });
  });

  test('同一条注释被引用超过一次', () => {
    assert.deepEqual(only('甲[^a]，乙[^a]。\n\n[^a]: 注释\n'), {
      line: 5,
      column: 8,
      text: 'Footnote [^a] is referenced more than once',
    });
  });
});

describe('frontmatter', () => {
  test('填入默认值并保留其他字段', () => {
    const { frontmatter, messages } = parse('---\ntitle: 标题\ncategory: arch\n---\n\n正文\n', options);
    assert.deepEqual(messages, []);
    assert.deepEqual(frontmatter, {
      title: '标题',
      category: 'arch',
      layout: 'essay',
      width: 'normal',
      draft: false,
      toc: true,
      numbered: false,
    });
  });

  test('当前版式的默认值', () => {
    const { frontmatter } = parse('---\ntitle: 论文\nlayout: paper\nauthors: [甲, 乙]\n---\n', options);
    assert.deepEqual(frontmatter, {
      title: '论文',
      layout: 'paper',
      authors: ['甲', '乙'],
      width: 'normal',
      draft: false,
      toc: false,
      numbered: true,
    });
  });

  test('YAML 语法错误', () => {
    const { messages } = parse('---\ntitle: 标题\ntags: [a, b\n---\n', options);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].line, 3);
    assert.match(messages[0].text, /^Invalid YAML in frontmatter: /);
  });

  test('title 缺失', () => {
    assert.deepEqual(parse('---\nlayout: essay\n---\n', options).messages, [
      { path: 'post.md', line: 1, column: 1, text: 'Frontmatter is missing title' },
    ]);
    assert.deepEqual(parse('正文\n', options).messages, [
      { path: 'post.md', line: 1, column: 1, text: 'Frontmatter is missing title' },
    ]);
  });

  const fieldCases = [
    ['通用字段类型不符', 'draft: yes', 'Frontmatter field draft must be true or false'],
    ['通用字段取值不在范围内', 'width: huge', 'Frontmatter field width must be one of normal, wide, got huge'],
    ['字符串字段类型不符', 'theme: 3', 'Frontmatter field theme must be a string'],
    ['版式字段类型不符', 'toc: 1', 'Frontmatter field toc must be true or false'],
    ['layout 不在 layouts 中', 'layout: slides', 'Unknown layout slides'],
    ['theme 不在 themes 中', 'theme: red', 'Unknown theme red'],
    ['使用了其他版式的字段', 'authors: [甲]', 'Frontmatter field authors belongs to layout paper, current layout is essay'],
  ];

  for (const [name, line, text] of fieldCases) {
    test(name, () => {
      const { messages } = parse(`---\ntitle: 标题\n${line}\n---\n`, options);
      assert.deepEqual(messages, [{ path: 'post.md', line: 3, column: 1, text }]);
    });
  }

  test('列表字段类型不符', () => {
    const { messages } = parse('---\ntitle: 标题\nlayout: paper\nauthors: 甲\n---\n', options);
    assert.deepEqual(messages, [{ path: 'post.md', line: 4, column: 1, text: 'Frontmatter field authors must be a list of strings' }]);
  });

  test('版式字段与通用字段同名', () => {
    const { messages } = parse('---\ntitle: 标题\nlayout: custom\n---\n', {
      ...options,
      layouts: { ...layouts, custom: { width: { type: 'string' } } },
    });
    assert.deepEqual(messages, [{ path: 'post.md', line: 1, column: 1, text: 'Layout custom field width conflicts with a common field' }]);
  });

  test('没有传入 layouts 和 themes 时跳过对应检查', () => {
    const { messages } = parse('---\ntitle: 标题\nlayout: slides\ntheme: red\nauthors: [甲]\n---\n', { path: 'post.md' });
    assert.deepEqual(messages, []);
  });
});

describe('块类型登记表', () => {
  test('合并内置和博客的块类型', () => {
    const registry = createRegistry(builtinBlocks, [{ name: 'shape', form: 'text', attributes: {} }]);
    assert.equal(registry.get('shape').form, 'text');
    assert.equal(registry.get('callout').label, '提示框');
  });

  test('重名时报错', () => {
    assert.throws(() => createRegistry(builtinBlocks, [{ name: 'callout', form: 'container' }]), /Duplicate block type callout/);
  });

  test('博客的块类型可以在文章中使用', () => {
    const blocks = [{ name: 'shape', form: 'text', attributes: { kind: { type: 'enum', options: ['row'] } } }];
    assert.deepEqual(messagesOf('文字 :shape[x]{kind=row}\n', { blocks }), []);
  });
});
