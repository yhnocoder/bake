import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { checkFields } from '../src/site/fields.js';
import { loadSite, pageComponents, renderPage } from '../src/site/index.js';
import { createModuleLoader } from '../src/site/modules.js';
import { optionalVariables, themeVariables } from '../src/styles/variables.js';

const blogs = [];
const config = "export default { title: '测试站点', theme: 'plain' };\n";
const assets = { styles: [], scripts: [] };

function theme(variables = themeVariables) {
  return `:root {\n${variables.map((variable) => `  ${variable}: 0;\n`).join('')}}\n`;
}

function component(properties = '{}') {
  return `export default class extends HTMLElement {\n  static properties = ${properties};\n}\n`;
}

function blog(files) {
  const root = mkdtempSync(join(tmpdir(), 'bake-extending-'));
  blogs.push(root);
  for (const [path, content] of Object.entries({ 'bake.config.js': config, 'themes/plain.css': theme(), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function article(slug, body = '正文。', extra = '') {
  return `---\ntitle: 文章 ${slug}\nslug: ${slug}\n${extra}---\n\n${body}\n`;
}

async function load(root) {
  const loader = await createModuleLoader(root);
  try {
    return await loadSite(root, { loader });
  } finally {
    await loader.close();
  }
}

async function messagesOf(files) {
  return (await load(blog(files))).messages;
}

function at(path, text) {
  return { path, line: 1, column: 1, text };
}

after(() => {
  for (const root of blogs) rmSync(root, { recursive: true, force: true });
});

describe('发现', () => {
  test('全局组件和主题组件，不发现 lib/ 子目录', async () => {
    const site = await load(
      blog({
        'components/demo-plot.js': component("{ x0: { type: 'number', default: 1 } }"),
        'components/lib/helper.js': 'throw new Error("lib is not a component");\n',
        'content/topic/components/topic-figure.js': component(),
        'content/topic/components/lib/other-helper.js': 'throw new Error("lib is not a component");\n',
      }),
    );
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.components, {
      'demo-plot': { path: 'components/demo-plot.js', topic: null, properties: { x0: { type: 'number', default: 1 } } },
      'topic-figure': { path: 'content/topic/components/topic-figure.js', topic: 'topic', properties: {} },
    });
  });

  test('博客块类型进入 parse 和 render，不发现 blocks/lib/', async () => {
    const root = blog({
      'blocks/shape.js': "import { className } from './lib/class-name.js';\nexport default { name: 'shape', form: 'text', attributes: { kind: { type: 'enum', options: ['row', 'column'], default: 'row' } }, render: ({ attributes, children }) => ['span', { class: className(attributes.kind) }, children] };\n",
      'blocks/lib/class-name.js': "export const className = (kind) => `math-shape ${kind}`;\n",
      'content/post.md': article('post', '向量 :shape[x]{kind=column} 和 :shape[y]。'),
    });
    const site = await load(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.blocks.map((block) => block.name), ['shape']);
    const { html, messages } = await renderPage(site, 'content/post.md', { assets });
    assert.deepEqual(messages, []);
    assert.match(html, /<span class="math-shape column" data-md=":shape\[x\]\{kind=column\}">x<\/span>/);
    assert.match(html, /<span class="math-shape row" data-md=":shape\[y\]">y<\/span>/);
  });

  test('没有 render 的块类型输出默认结构，属性写成 data-*，容器的标题放在第一个段落', async () => {
    const root = blog({
      'blocks/theorem.js': "export default { name: 'theorem', form: 'container', attributes: { name: { type: 'string', default: '定理' } } };\n",
      'content/post.md': article('post', ':::theorem[链式法则]\n内容。\n:::'),
    });
    const site = await load(root);
    const { html, messages } = await renderPage(site, 'content/post.md', { assets });
    assert.deepEqual(messages, []);
    assert.match(html, /<div class="theorem" data-name="定理" data-md="[^"]*"><p>链式法则<\/p><p>内容。<\/p><\/div>/);
  });

  test('博客版式新增版式，同名文件覆盖内置版式的函数和 fields', async () => {
    const root = blog({
      'layouts/note.js': "export const fields = { series: { type: 'string' } };\nexport default ({ page, html }) => `<main><p class=\"series\">${page.series}</p><article>${html}</article></main>`;\n",
      'layouts/essay.js': "export const fields = { mood: { type: 'enum', options: ['calm'], default: 'calm' } };\nexport default ({ page, html }) => `<main class=\"own-essay ${page.mood}\"><article>${html}</article></main>`;\n",
      'layouts/lib/helper.js': 'throw new Error("lib is not a layout");\n',
      'content/note.md': article('note', '正文。', 'layout: note\nseries: 系列一\n'),
      'content/essay.md': article('essay'),
    });
    const site = await load(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(Object.keys(site.layouts), ['essay', 'paper', 'bento', 'note']);
    assert.deepEqual({ ...site.layouts.essay, render: undefined }, { render: undefined, fields: { mood: { type: 'enum', options: ['calm'], default: 'calm' } }, path: 'layouts/essay.js' });
    assert.equal(site.layouts.paper.path, null);
    assert.match((await renderPage(site, 'content/note.md', { assets })).html, /<p class="series">系列一<\/p><article>/);
    assert.match((await renderPage(site, 'content/essay.md', { assets })).html, /<main class="own-essay calm"><article>/);
  });

  test('主题，不发现 themes/lib/', async () => {
    const site = await load(blog({ 'themes/warm.css': `@import './lib/blocks.css';\n${theme()}`, 'themes/lib/blocks.css': '.x {}\n' }));
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.themes, { plain: 'themes/plain.css', warm: 'themes/warm.css' });
  });
});

describe('属性定义', () => {
  const cases = [
    [{ x: { type: 'number', unit: 'px' } }, 'Property x: unknown key unit'],
    [{ x: { type: 'color' } }, 'Property x: type must be one of number, string, boolean, enum'],
    [{ x: { type: 'string', label: 1 } }, 'Property x: label must be a string'],
    [{ x: { type: 'enum' } }, 'Property x: enum requires options, a non-empty list of strings'],
    [{ x: { type: 'enum', options: [] } }, 'Property x: enum requires options, a non-empty list of strings'],
    [{ x: { type: 'string', options: ['a'] } }, 'Property x: options is only allowed for enum'],
    [{ x: { type: 'string', min: 0 } }, 'Property x: min is only allowed for number'],
    [{ x: { type: 'number', step: '1' } }, 'Property x: step must be a number'],
    [{ x: { type: 'number', min: 2, max: 1 } }, 'Property x: min must not be greater than max'],
    [{ x: { type: 'number', default: '1' } }, 'Property x: default must be a number'],
    [{ x: { type: 'number', min: 0, max: 1, default: 2 } }, 'Property x: default must be between min and max'],
    [{ x: { type: 'string', default: 1 } }, 'Property x: default must be a string'],
    [{ x: { type: 'boolean', default: 'true' } }, 'Property x: default must be true or false'],
    [{ x: { type: 'enum', options: ['a', 'b'], default: 'c' } }, 'Property x: default must be one of a, b'],
    [{ x: 'number' }, 'Property x: definition must be an object'],
    [[], 'Property definitions must be an object'],
  ];

  for (const [fields, message] of cases) {
    test(message, () => {
      assert.deepEqual(checkFields(fields), [message]);
    });
  }

  test('合法的定义没有错误', () => {
    const fields = {
      x0: { label: 'x₀', type: 'number', min: -2, max: 2, step: 0.01, default: 1.2 },
      show: { type: 'boolean', default: true },
      curve: { type: 'enum', options: ['a', 'b'], default: 'b' },
      name: { type: 'string' },
    };
    assert.deepEqual(checkFields(fields), []);
  });

  test('版式字段允许 list，错误说明以 Field 开头', () => {
    assert.deepEqual(checkFields({ authors: { type: 'list', default: ['a'] } }, { allowList: true }), []);
    assert.deepEqual(checkFields({ authors: { type: 'list', default: 'a' } }, { allowList: true }), ['Field authors: default must be a list of strings']);
    assert.deepEqual(checkFields({ authors: { type: 'list' } }), ['Property authors: type must be one of number, string, boolean, enum']);
  });
});

describe('组件的校验', () => {
  const nameError = 'Component file name must be lowercase letters, digits and "-", and contain at least one "-"';

  test('文件名不含 - 或含大写字母时报错', async () => {
    const messages = await messagesOf({ 'components/plot.js': component(), 'components/Demo-plot.js': component(), 'components/1-plot.js': component() });
    assert.deepEqual(messages, [at('components/1-plot.js', nameError), at('components/Demo-plot.js', nameError), at('components/plot.js', nameError)]);
  });

  test('HTML 保留的名字报错', async () => {
    assert.deepEqual(await messagesOf({ 'components/font-face.js': component() }), [at('components/font-face.js', 'Component name font-face is reserved by HTML')]);
  });

  test('默认导出不是继承 HTMLElement 的类时报错', async () => {
    const messages = await messagesOf({ 'components/demo-plot.js': 'export default class {}\n', 'components/demo-table.js': 'export default {};\n' });
    assert.deepEqual(messages, [
      at('components/demo-plot.js', 'Component demo-plot must default-export a class that extends HTMLElement'),
      at('components/demo-table.js', 'Component demo-table must default-export a class that extends HTMLElement'),
    ]);
  });

  test('static properties 的错误带组件文件路径', async () => {
    const messages = await messagesOf({ 'components/demo-plot.js': component("{ x0: { type: 'number', min: 2, max: 1 } }") });
    assert.deepEqual(messages, [at('components/demo-plot.js', 'Property x0: min must not be greater than max')]);
  });

  test('主题组件与全局组件重名时两个文件各报一条，两个都不使用', async () => {
    const site = await load(blog({ 'components/demo-plot.js': component(), 'content/topic/components/demo-plot.js': component() }));
    assert.deepEqual(site.messages, [
      at('components/demo-plot.js', 'Component demo-plot is also defined in content/topic/components/demo-plot.js'),
      at('content/topic/components/demo-plot.js', 'Component demo-plot is also defined in components/demo-plot.js'),
    ]);
    assert.deepEqual(site.components, {});
  });

  test('两个主题的组件重名时报错', async () => {
    const messages = await messagesOf({ 'content/a/components/demo-plot.js': component(), 'content/b/components/demo-plot.js': component() });
    assert.deepEqual(messages, [
      at('content/a/components/demo-plot.js', 'Component demo-plot is also defined in content/b/components/demo-plot.js'),
      at('content/b/components/demo-plot.js', 'Component demo-plot is also defined in content/a/components/demo-plot.js'),
    ]);
  });
});

describe('块类型的校验', () => {
  const block = (fields) => `export default { name: 'shape', form: 'text', ${fields} };\n`;

  test('名字含 - 时报错', async () => {
    assert.deepEqual(await messagesOf({ 'blocks/my-shape.js': "export default { name: 'my-shape', form: 'text' };\n" }), [
      at('blocks/my-shape.js', 'Block type name must not contain "-", names with "-" are components'),
    ]);
  });

  test('名字不是小写字母和数字时报错', async () => {
    assert.deepEqual(await messagesOf({ 'blocks/Shape.js': "export default { name: 'Shape', form: 'text' };\n" }), [
      at('blocks/Shape.js', 'Block type name must be lowercase letters and digits and start with a letter'),
    ]);
  });

  test('name 与文件名不同时报错', async () => {
    assert.deepEqual(await messagesOf({ 'blocks/shape.js': "export default { name: 'form', form: 'text' };\n" }), [
      at('blocks/shape.js', 'Block type name form must be the same as the file name shape'),
    ]);
  });

  test('默认导出不是对象时报错', async () => {
    assert.deepEqual(await messagesOf({ 'blocks/shape.js': 'export default 1;\n' }), [at('blocks/shape.js', 'Block type shape must default-export an object')]);
  });

  test('form、label、render 和 attributes 的错误', async () => {
    const messages = await messagesOf({
      'blocks/shape.js': "export default { name: 'shape', form: 'inline', label: 1, render: 'span', attributes: { kind: { type: 'enum' } } };\n",
    });
    assert.deepEqual(messages, [
      at('blocks/shape.js', 'Block type shape form must be one of text, leaf, container'),
      at('blocks/shape.js', 'Block type shape label must be a string'),
      at('blocks/shape.js', 'Block type shape render must be a function'),
      at('blocks/shape.js', 'Property kind: enum requires options, a non-empty list of strings'),
    ]);
    assert.deepEqual(await messagesOf({ 'blocks/shape.js': block("label: '形状', render: () => ['span', {}, []]") }), []);
  });

  test('与内置块类型重名时报错，构建不中断', async () => {
    const site = await load(blog({ 'blocks/callout.js': "export default { name: 'callout', form: 'container' };\n", 'content/post.md': article('post') }));
    assert.deepEqual(site.messages, [at('blocks/callout.js', 'Block type callout conflicts with a built-in block type')]);
    assert.deepEqual(site.blocks, []);
    assert.deepEqual((await renderPage(site, 'content/post.md', { assets })).messages, []);
  });
});

describe('版式的校验', () => {
  test('默认导出不是函数时报错', async () => {
    const site = await load(blog({ 'layouts/note.js': "export default '<article></article>';\n" }));
    assert.deepEqual(site.messages, [at('layouts/note.js', 'Layout note must default-export a function')]);
    assert.equal(site.layouts.note, undefined);
  });

  test('字段与通用字段同名时报错', async () => {
    const messages = await messagesOf({ 'layouts/note.js': "export const fields = { title: { type: 'string' }, draft: { type: 'boolean' } };\nexport default () => '';\n" });
    assert.deepEqual(messages, [
      at('layouts/note.js', 'Layout note field title conflicts with a common field'),
      at('layouts/note.js', 'Layout note field draft conflicts with a common field'),
    ]);
  });

  test('字段定义的错误以 Field 开头', async () => {
    const messages = await messagesOf({ 'layouts/note.js': "export const fields = { authors: { type: 'list', default: 1 } };\nexport default () => '';\n" });
    assert.deepEqual(messages, [at('layouts/note.js', 'Field authors: default must be a list of strings')]);
  });

  test('覆盖内置版式的文件出错时保留内置版式', async () => {
    const site = await load(blog({ 'layouts/essay.js': 'export default 1;\n' }));
    assert.deepEqual(site.messages, [at('layouts/essay.js', 'Layout essay must default-export a function')]);
    assert.equal(site.layouts.essay.path, null);
  });

  test('博客版式输出两个 <article> 时报错', async () => {
    const root = blog({
      'layouts/note.js': 'export default ({ html }) => `<article>${html}</article><article></article>`;\n',
      'content/post.md': article('post', '正文。', 'layout: note\n'),
    });
    const { html, messages } = await renderPage(await load(root), 'content/post.md', { assets });
    assert.equal(html, null);
    assert.deepEqual(messages, [at('content/post.md', 'Layout note must output exactly one <article> that contains the page content')]);
  });
});

describe('主题的校验', () => {
  test('缺少变量时按 themeVariables 的顺序列出，不使用这个主题', async () => {
    const site = await load(blog({ 'themes/warm.css': theme(themeVariables.filter((variable) => variable !== '--measure' && variable !== '--color-mark')) }));
    assert.deepEqual(site.messages, [at('themes/warm.css', 'Theme warm is missing variables --color-mark, --measure')]);
    assert.deepEqual(Object.keys(site.themes), ['plain']);
  });

  test('任意选择器下的声明都计入，可选变量不要求', async () => {
    const [first, ...rest] = themeVariables;
    const css = `${theme(rest)}@media (prefers-color-scheme: dark) {\n  body { ${first}: 1; }\n}\n`;
    assert.deepEqual(await messagesOf({ 'themes/warm.css': css }), []);
    assert.ok(optionalVariables.length > 0);
  });

  test('被导入的文件里声明的变量不算', async () => {
    const messages = await messagesOf({
      'themes/warm.css': `@import './lib/variables.css';\n${theme(themeVariables.slice(1))}`,
      'themes/lib/variables.css': theme(),
    });
    assert.deepEqual(messages, [at('themes/warm.css', `Theme warm is missing variables ${themeVariables[0]}`)]);
  });

  test('配置的主题缺少变量时只报主题的错误', async () => {
    assert.deepEqual(await messagesOf({ 'themes/plain.css': ':root {}\n' }), [at('themes/plain.css', `Theme plain is missing variables ${themeVariables.join(', ')}`)]);
  });
});

describe('模块载入失败', () => {
  test('语法错误、导入失败和顶层异常都报告 Cannot load', async () => {
    const site = await load(
      blog({
        'blocks/shape.js': 'export default {\n',
        'layouts/note.js': "import './missing.js';\nexport default () => '';\n",
        'components/demo-plot.js': "throw new Error('broken component');\n",
      }),
    );
    const texts = site.messages.map(({ path, text }) => `${path} ${text}`);
    assert.equal(texts.length, 3);
    assert.equal(texts[0], 'components/demo-plot.js Cannot load components/demo-plot.js: broken component');
    assert.match(texts[1], /^blocks\/shape\.js Cannot load blocks\/shape\.js: /);
    assert.match(texts[2], /^layouts\/note\.js Cannot load layouts\/note\.js: /);
    assert.deepEqual(site.components, {});
    assert.deepEqual(site.blocks, []);
    assert.equal(site.layouts.note, undefined);
  });
});

describe('跨主题使用组件', () => {
  const files = {
    'components/demo-plot.js': component(),
    'content/a/components/wave-figure.js': component(),
    'content/b/components/other-figure.js': component(),
    'content/a/post.md': article('a/post', '::wave-figure\n'),
    'content/b/post.md': article('b/post', '正文。\n\n::wave-figure\n'),
    'content/top.md': article('top', '::wave-figure\n'),
  };

  test('pageComponents 返回全局组件、本主题的组件和其他主题的组件', async () => {
    const site = await load(blog(files));
    assert.deepEqual(pageComponents(site, 'content/a/post.md'), { components: { 'demo-plot': {}, 'wave-figure': {} }, otherTopicComponents: { 'other-figure': 'b' } });
    assert.deepEqual(pageComponents(site, 'content/top.md'), { components: { 'demo-plot': {} }, otherTopicComponents: { 'wave-figure': 'a', 'other-figure': 'b' } });
  });

  test('其他主题的文章和 content/ 下第一层的页面使用主题组件时报错', async () => {
    const site = await load(blog(files));
    assert.deepEqual((await renderPage(site, 'content/a/post.md', { assets })).messages, []);
    const text = 'Component ::wave-figure belongs to topic a, move it to components/ to use it in other topics';
    assert.deepEqual((await renderPage(site, 'content/b/post.md', { assets })).messages, [{ path: 'content/b/post.md', line: 8, column: 1, text }]);
    assert.deepEqual((await renderPage(site, 'content/top.md', { assets })).messages, [{ path: 'content/top.md', line: 6, column: 1, text }]);
  });

  test('不属于任何主题的组件名仍报 Unknown component', async () => {
    const site = await load(blog({ 'content/post.md': article('post', '::missing-figure\n') }));
    assert.deepEqual((await renderPage(site, 'content/post.md', { assets })).messages.map(({ text }) => text), ['Unknown component ::missing-figure']);
  });
});

describe('createModuleLoader 与 bake/runtime', () => {
  test('导入 bake/runtime 的组件可以载入，Node 中的 site 为空，其他函数调用时报错', async () => {
    const root = blog({
      'components/page-list.js': "import { site, animate } from 'bake/runtime';\nexport const pages = site.pages;\nexport const run = () => animate();\nexport default class extends HTMLElement {\n  static properties = { limit: { type: 'number', default: 3 } };\n}\n",
    });
    const site = await load(root);
    assert.deepEqual(site.messages, []);
    assert.deepEqual(site.components['page-list'].properties, { limit: { type: 'number', default: 3 } });
    const loader = await createModuleLoader(root);
    try {
      const module = await loader.import('components/page-list.js');
      assert.deepEqual(module.pages, []);
      assert.throws(module.run, { message: 'bake/runtime animate is only available in the browser' });
    } finally {
      await loader.close();
    }
  });
});
