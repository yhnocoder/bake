import assert from 'node:assert/strict';
import { readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { components as declare, parse, parsed } from './article.js';
import { article, bake, createBlog, validConfig } from './blog.js';

const component = "export default function Component() {\n  return null;\n}\n";
const height = 'export const layout = { height: 100 };\n';

const plot = {
  fn: { label: 'Function', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
  range: { label: 'Range', type: 'number', min: 1, max: 10, default: 4 },
  beta: { label: 'Beta', type: 'number', min: 0, default: 1 },
  gamma: { label: 'Gamma', type: 'number', max: 4, default: 1 },
  toggle: { label: 'Toggle', type: 'boolean', default: false },
  title: { label: 'Title', type: 'text', default: '' },
  data: { label: 'Data', type: 'file', default: '' },
};
const components = declare({ 'act-fn-plot': { params: plot }, 'glu-heatmap': {} });

describe('component files', () => {
  test('reports every problem of the component files together with the problems of the articles and writes nothing', (t) => {
    const reserved = ['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'];
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/lib/size.js': 'export const unit = 8;\n\nexport const screen = window.innerWidth;\n',
      'components/lib-plot.js': `import { screen } from './lib/size.js';\n\n${height}export default function LibPlot() {\n  return screen;\n}\n`,
      'components/top-plot.js': `${height}const dark = matchMedia('(prefers-color-scheme: dark)');\n${component}`,
      'components/agent-plot.js': `${height}export const agent = navigator.userAgent;\n${component}`,
      'components/store-plot.js': `${height}  const saved = localStorage.getItem('x');\n${component}`,
      'components/syntax-plot.jsx': `${height}export default function SyntaxPlot() {\n  return <div>{</div>;\n}\n`,
      'components/import-plot.js': `import missing from 'not-a-package';\n${height}${component}`,
      'components/throw-plot.js': `${height}throw new Error('no data');\n${component}`,
      ...Object.fromEntries(reserved.map((name) => [`components/${name}.js`, `${height}${component}`])),
      'components/bad-type.js': `export const params = { n: { label: 'N', type: 'integer', default: 1 } };\n${height}${component}`,
      'components/reserved-name.js': `export const params = { width: { label: 'W', type: 'number', default: 1 } };\n${height}${component}`,
      'components/empty-enum.js': `export const params = { fn: { label: 'F', type: 'enum', default: 'a' } };\n${height}${component}`,
      'components/bad-default.js': `export const params = { n: { label: 'N', type: 'number', min: 1, max: 10, default: 20 }, on: { label: 'On', type: 'boolean', default: 'yes' }, fn: { label: 'F', type: 'enum', options: ['a', 'b'], default: 'c' }, t: { label: 'T', type: 'text', default: 3 } };\n${height}${component}`,
      'components/bad-field.js': `export const params = { n: { label: 'N', type: 'text', default: '', optons: [] }, m: { type: 'number', default: 1 }, k: { label: 'K', type: 'number' } };\n${height}${component}`,
      'components/bad-layout.js': `export const layout = { width: 'full', height: '300px', narrowHeight: { ratio: -1 }, frame: 'no', autoHeight: 1, heigth: 3 };\n${component}`,
      'components/no-height.js': `export const layout = { width: '120%' };\n${component}`,
      'components/no-default-export.js': height,
      'components/Plot_Name.js': component,
      'components/list-table.js': component,
      'components/grid-view.js': `export const params = { size: { label: 'Size', type: 'number', min: 1, max: 9, default: 3 } };\n${height}${component}`,
      'components/README.md': 'Not a component.\n',
      'content/posts/rope/index.md': article({ body: ':::top-plot\n:::\n\n:::grid-view{size=12}\n:::\n\n:::other-view\n:::\n' }),
    });
    const result = bake(dir, 'build');
    const lines = result.stderr.trimEnd().split('\n');
    const reason = 'at the top level; the build reads params and layout in Node, so use it inside the component code';
    const expected = [
      `components/agent-plot.js:2:22 agent-plot: components/agent-plot.js uses the browser API navigator ${reason}`,
      `components/lib/size.js:3:23 lib-plot: components/lib-plot.js uses the browser API window ${reason}`,
      `components/store-plot.js:2:17 store-plot: components/store-plot.js uses the browser API localStorage ${reason}`,
      `components/top-plot.js:2:14 top-plot: components/top-plot.js uses the browser API matchMedia ${reason}`,
      "components/import-plot.js:1:1 import-plot: components/import-plot.js cannot be read in Node: Cannot find module 'not-a-package' imported from 'components/import-plot.js'",
      'components/syntax-plot.jsx:3:17 syntax-plot: Unexpected token',
      'components/throw-plot.js:2:7 throw-plot: components/throw-plot.js cannot be read in Node: no data',
      ...reserved.map((name) => `components/${name}.js:1:1 ${name}: the HTML standard reserves "${name}" and does not allow it as a custom element name; give the component another name`),
      'components/Plot_Name.js:1:1 the file name of a component is its custom element name and its block name; use lowercase letters and digits with at least one "-", such as act-fn-plot, got "Plot_Name"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "n" must be between 1 and 10, got 20',
      'components/bad-default.js:1:1 bad-default: the default of parameter "on" must be true or false, got "yes"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "fn" must be one of a or b, got "c"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "t" must be text, got 3',
      'components/bad-field.js:1:1 bad-field: parameter "n" has the unknown field "optons"; the fields of a text parameter are label, type and default',
      'components/bad-field.js:1:1 bad-field: parameter "m" needs a label, the text shown next to its control',
      'components/bad-field.js:1:1 bad-field: parameter "k" needs a default, the value used when the article does not set it',
      'components/bad-layout.js:1:1 bad-layout: layout has the unknown field "heigth"; the fields of layout are width, height, narrowHeight, autoHeight and frame',
      'components/bad-layout.js:1:1 bad-layout: layout.width must be body, wide, page, a size in pixels such as 560px or a percentage of the body column up to 100% such as 70%, got "full"',
      'components/bad-layout.js:1:1 bad-layout: layout.height must be a number of pixels, { ratio: width / height } or a function of the parameters that returns one of them, got "300px"',
      'components/bad-layout.js:1:1 bad-layout: layout.narrowHeight must be a number of pixels, { ratio: width / height } or a function of the parameters that returns one of them, got an object',
      'components/bad-layout.js:1:1 bad-layout: layout.autoHeight must be true or false, got 1',
      'components/bad-layout.js:1:1 bad-layout: layout.frame must be true or false, got "no"',
      'components/bad-type.js:1:1 bad-type: parameter "n" has the type "integer"; use number, text, boolean, enum or file',
      "components/empty-enum.js:1:1 empty-enum: parameter \"fn\" is an enum without options; list them as strings, for example options: ['gelu', 'silu']",
      'components/list-table.js:1:1 list-table: :::list-table is a built-in block; give the component another name',
      'components/no-default-export.js:1:1 no-default-export: the default export must be a SolidJS component or a class that extends HTMLElement',
      'components/no-height.js:1:1 no-height: layout.width must be body, wide, page, a size in pixels such as 560px or a percentage of the body column up to 100% such as 70%, got "120%"',
      'components/no-height.js:1:1 no-height: layout.height is missing; it is the height of the placeholder before the component loads, for example 360 or { ratio: 16 / 9 }',
      'components/reserved-name.js:1:1 reserved-name: parameter "width" uses a name reserved for Bake; a component cannot declare width, height, id or class',
      'content/posts/rope/index.md:10:14 parameter "size" of grid-view must be between 1 and 9, got 12',
      'content/posts/rope/index.md:13:1 unknown component "other-view"; components/ has no other-view.js or other-view.jsx',
    ];
    assert.equal(lines.pop(), `${expected.length} errors, dist/ was not written`);
    assert.deepEqual(lines.toSorted(), expected.toSorted());
    assert.equal(result.status, 1);
  });
});

describe('component blocks', () => {
  test('converts attributes to the declared types and fills in the defaults', async () => {
    const [block] = (await parsed(':::act-fn-plot{fn=silu range=2.5 toggle title="Two words"}\n:::\n', { components })).intro;
    assert.deepEqual(block.params, { fn: 'silu', range: 2.5, beta: 1, gamma: 1, toggle: true, title: 'Two words', data: '' });
    const [off] = (await parsed(':::act-fn-plot{toggle=false beta=1e-1 gamma=-.5}\n:::\n', { components })).intro;
    assert.deepEqual([off.params.toggle, off.params.beta, off.params.gamma], [false, 0.1, -0.5]);
  });

  test('reports each parameter error at the column of its attribute', async () => {
    const { errors } = await parse(':::act-fn-plot{fn=tanh range=20 beta=-1 gamma=5 toggle=yes title bta=2 float=left}\n:::\n\n:::act-fn-plot{range=abc beta}\n:::\n', { components });
    assert.deepEqual(errors, [
      'index.md:7:16 parameter "fn" of act-fn-plot must be one of relu, gelu or silu, got "tanh"',
      'index.md:7:24 parameter "range" of act-fn-plot must be between 1 and 10, got 20',
      'index.md:7:33 parameter "beta" of act-fn-plot must be at least 0, got -1',
      'index.md:7:41 parameter "gamma" of act-fn-plot must be at most 4, got 5',
      'index.md:7:49 parameter "toggle" of act-fn-plot must be true or false, got "yes"',
      'index.md:7:60 parameter "title" of act-fn-plot needs a value, got no value',
      'index.md:7:66 unknown parameter "bta" for act-fn-plot',
      'index.md:7:72 float does not apply to components; act-fn-plot is centred in its column',
      'index.md:10:16 parameter "range" of act-fn-plot must be a number, got "abc"',
      'index.md:10:26 parameter "beta" of act-fn-plot must be a number, got no value',
    ]);
  });

  test('reports width and height errors at their attributes', async () => {
    const { errors } = await parse(':::act-fn-plot{width=full height=40px}\n:::\n\n:::act-fn-plot{width=120% height=0}\n:::\n\n> :::glu-heatmap{width=wide height}\n> :::\n', { components });
    assert.deepEqual(errors, [
      'index.md:7:16 width of act-fn-plot must be body, wide, page, auto, a size in pixels such as 560px or a percentage such as 70%, got "full"',
      'index.md:7:27 height of act-fn-plot must be a positive number of pixels such as 420, got "40px"',
      'index.md:10:16 width of act-fn-plot is 120%; a percentage width is at most 100% of the body column',
      'index.md:10:27 height of act-fn-plot must be a positive number of pixels such as 420, got "0"',
      'index.md:13:29 height of glu-heatmap must be a positive number of pixels such as 420, got no value',
    ]);
  });

  test('checks that a file parameter names a file in the article folder', async () => {
    const withDefault = declare({ 'act-fn-plot': { params: { data: { label: 'Data', type: 'file', default: 'data.csv' } } } });
    const options = { components: withDefault, folder: { path: '/blog/post', files: ['grid.json', 'data/angles.csv'] } };
    const [block] = (await parsed(':::act-fn-plot{data=./data/angles.csv}\n:::\n', options)).intro;
    assert.equal(block.params.data, './data/angles.csv');
    assert.deepEqual((await parse(':::act-fn-plot{data=missing.csv}\n:::\n\n:::act-fn-plot\n:::\n\n:::act-fn-plot{data=../grid.json}\n:::\n', options)).errors, [
      'index.md:7:16 parameter "data" of act-fn-plot must be a file in the article folder, got "missing.csv"',
      'index.md:10:1 parameter "data" of act-fn-plot defaults to "data.csv", which is not a file in the article folder',
      'index.md:13:16 parameter "data" of act-fn-plot must be a file in the article folder, got "../grid.json"',
    ]);
  });

  test('reports layout height functions that throw or return an invalid height at the block', async () => {
    const broken = (heightOf) => declare({ 'act-fn-plot': { params: plot, layout: { height: heightOf } } });
    assert.deepEqual((await parse(':::act-fn-plot{range=3}\n:::\n', { components: broken(() => '300px') })).errors, [
      'index.md:7:1 act-fn-plot: layout.height returns "300px" for these parameters; it must return a number of pixels or { ratio: width / height }',
    ]);
    const throwing = () => {
      throw new Error('unknown range');
    };
    assert.deepEqual((await parse(':::act-fn-plot\n:::\n', { components: broken(throwing) })).errors, ['index.md:7:1 act-fn-plot: layout.height throws for these parameters: unknown range']);
  });

  test('reports unknown components, :::{width=…} around a component and keeps the component of a broken file silent', async () => {
    const all = new Map([...components, ...declare({ 'broken-plot': { valid: false } })]);
    assert.deepEqual((await parse(':::fn-plot\n:::\n\n::::{width=wide}\n:::glu-heatmap\n:::\n::::\n\n:::broken-plot{bta=1}\n:::\n', { components: all })).errors, [
      'index.md:7:1 unknown component "fn-plot"; components/ has no fn-plot.js or fn-plot.jsx',
      'index.md:10:1 write the width of a component in its own braces, such as :::glu-heatmap{width=wide}, instead of :::{width=…} around it',
    ]);
  });

  test('shows the caption of a component with its inline and block Markdown below the component', async () => {
    const [inline, blocks] = (await parsed(':::act-fn-plot{fn=silu}\nThe *curve* of SiLU.\n:::\n\n:::act-fn-plot{width=page}\nOne.\n\nTwo.\n:::\n', { components })).intro;
    assert.match(inline.html, /<\/div><figcaption>The <em>curve<\/em> of SiLU\.<\/figcaption><\/figure>$/);
    assert.match(blocks.html, /<figcaption>\n<p>One.<\/p>\n<p>Two.<\/p>\n<\/figcaption><\/figure>$/);
  });

  test('validates and renders components inside other blocks', async () => {
    const { errors } = await parse('::::example\n:::act-fn-plot{range=20}\n:::\n::::\n', { components });
    assert.deepEqual(errors, ['index.md:8:16 parameter "range" of act-fn-plot must be between 1 and 10, got 20']);
    const article = await parsed('::::fold{title=Plot}\n:::glu-heatmap\nCells.\n:::\n::::\n', { components });
    assert.match(article.intro[0].html, /^<details class="fold"><summary>Plot<\/summary>\n<figure class="component" data-component="glu-heatmap"/);
  });
});

describe('building components', () => {
  test('publishes only the components that published articles use and loads the component runtime only on pages with components', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/lib/shared.js': 'export const scale = 2;\n',
      'components/lib/plot.css': '.plot-line { stroke: rgb(1, 2, 3); }\n',
      'components/fn-plot.jsx':
        "import { createSignal } from 'solid-js';\nimport { scale } from './lib/shared.js';\nimport './lib/plot.css';\n\nexport const params = { range: { label: 'Range', type: 'number', default: 4 } };\nexport const layout = { height: 300 };\n\nexport default function FnPlot(props) {\n  const [count] = createSignal(scale);\n  return <svg class=\"plot-line\">{props.range * count()}</svg>;\n}\n",
      'components/grid-view.js': "import { scale } from './lib/shared.js';\n\nexport const layout = { height: 200 };\n\nexport default class GridView extends HTMLElement {\n  connectedCallback() {\n    this.textContent = String(scale);\n  }\n}\n",
      'components/unused-view.js': `${height}export default class UnusedView extends HTMLElement {}\n`,
      'components/lib/base-view.js': 'export class BaseView extends HTMLElement {}\n',
      'components/left-view.js': `import { BaseView } from './lib/base-view.js';\n\n${height}export default class LeftView extends BaseView {}\n`,
      'components/right-view.js': `import { BaseView } from './lib/base-view.js';\n\n${height}export default class RightView extends BaseView {}\n`,
      'content/posts/rope/index.md': article({ body: ':::fn-plot{range=3}\nA plot.\n:::\n\n:::grid-view\n:::\n\n:::left-view\n:::\n\n:::right-view\n:::\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'No components.\n' }),
      'content/posts/draft/index.md': article({ slug: 'draft', extra: 'draft: true\n', body: ':::unused-view\n:::\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const runtime = assets.find((name) => /^components-[\w-]+\.js$/.test(name));
    const rope = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(rope, new RegExp(`<script type="module" src="../../assets/${runtime}"></script>`));
    assert.doesNotMatch(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /components-[\w-]+\.js/);
    assert.ok(assets.some((name) => /^fn-plot-[\w-]+\.js$/.test(name)));
    assert.ok(assets.some((name) => /^fn-plot-[\w-]+\.css$/.test(name)));
    assert.ok(assets.some((name) => /^grid-view-[\w-]+\.js$/.test(name)));
    assert.ok(!assets.some((name) => name.startsWith('unused-view')));
    assert.doesNotMatch(readFileSync(join(dir, 'dist/assets', runtime), 'utf8'), /unused-view/);
    const scripts = assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(join(dir, 'dist/assets', name), 'utf8'));
    assert.ok(!scripts.some((source) => source.includes('computations created outside')), 'no script contains the development build of Solid');
    const sources = assets.filter((name) => /\.(js|css)$/.test(name) && !name.startsWith('essay-')).map((name) => readFileSync(join(dir, 'dist/assets', name), 'utf8'));
    assert.ok(!sources.some((source) => source.includes('bk-kit-')), 'no component asset contains code of bake/kit');
  });

  test('bundles the parts of bake/kit and their styles with the components that use them, and the plain helpers without the styles', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/line-plot.jsx':
        "import { Axes, Plot, Slider } from 'bake/kit';\n\nexport const layout = { height: 300 };\n\nexport default function LinePlot() {\n  return <><Slider label=\"a\" min={0} max={1} value={0} onInput={() => {}} /><Plot x={[0, 1]} y={[0, 1]}><Axes /></Plot></>;\n}\n",
      'components/tick-list.js': "import { niceTicks } from 'bake/kit';\n\nexport const layout = { height: 100 };\n\nexport default class TickList extends HTMLElement {\n  connectedCallback() {\n    this.textContent = niceTicks(0, 1, 2).length;\n  }\n}\n",
      'content/posts/rope/index.md': article({ body: ':::line-plot\n:::\n\n:::tick-list\n:::\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets')).filter((name) => /\.(js|css)$/.test(name) && !name.startsWith('essay-'));
    const withKit = assets.filter((name) => readFileSync(join(dir, 'dist/assets', name), 'utf8').includes('bk-kit-')).map((name) => name.replace(/-[\w-]{8}\./, '.'));
    assert.deepEqual(withKit.sort(), ['line-plot.css', 'line-plot.js']);
    assert.match(readFileSync(join(dir, 'dist/assets', assets.find((name) => /^line-plot-[\w-]+\.css$/.test(name))), 'utf8'), /\.bk-kit-slider/);
    assert.ok(!assets.some((name) => name.startsWith('tick-list') && name.endsWith('.css')), assets.join(', '));
  });

  test('builds formulas after reading a component library that replaces the module loader of MathJax, also with an empty preamble.sty', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'preamble.sty': '',
      'components/lib/tex.js': "import { mathjax } from '@mathjax/src/js/mathjax.js';\n\nmathjax.asyncLoad = (name) => import(name);\n\nexport const ready = 'ready';\n",
      'components/tex-box.js': `import { ready } from './lib/tex.js';\n\n${height}export default class TexBox extends HTMLElement {\n  connectedCallback() {\n    this.textContent = ready;\n  }\n}\n`,
      'content/posts/rope/index.md': article({ body: '$$\nx \\in \\mathbb{R}\n$$\n\n:::tex-box\n:::\n' }),
    });
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'), 'dir');
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.match(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'), /<mjx-container class="MathJax" jax="SVG"[^>]*data-tex="x \\in \\mathbb{R}">/);
  });
});
