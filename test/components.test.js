import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { readComponents } from '../src/components/read.js';
import { BUILT_IN_BLOCK_NAMES } from '../src/markdown/article.js';
import { formatError, sortErrors } from '../src/report.js';
import { folder, parse, parsed } from './article.js';
import { article, bake, createBlog, validConfig } from './blog.js';

const component = "export default function Component() {\n  return null;\n}\n";
const height = 'export const layout = { height: 100 };\n';

async function read(t, files) {
  const dir = createBlog(t, files);
  const errors = [];
  const components = await readComponents(dir, { builtInBlocks: BUILT_IN_BLOCK_NAMES }, errors);
  return { components, errors: sortErrors(errors).map(formatError) };
}

const plot = {
  name: 'act-fn-plot',
  valid: true,
  params: {
    fn: { label: 'Function', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
    range: { label: 'Range', type: 'number', min: 1, max: 10, default: 4 },
    beta: { label: 'Beta', type: 'number', min: 0, default: 1 },
    gamma: { label: 'Gamma', type: 'number', max: 4, default: 1 },
    toggle: { label: 'Toggle', type: 'boolean', default: false },
    title: { label: 'Title', type: 'text', default: '' },
    data: { label: 'Data', type: 'file', default: '' },
  },
  layout: { height: 360, narrowHeight: (params) => (params.toggle ? 520 : 480) },
};
const heatmap = { name: 'glu-heatmap', valid: true, params: {}, layout: { width: 'wide', height: { ratio: 16 / 9 }, frame: false } };
const components = new Map([
  ['act-fn-plot', plot],
  ['glu-heatmap', heatmap],
]);

describe('reading components', () => {
  test('reads params and layout of a SolidJS component and of a class that extends HTMLElement at the top level', async (t) => {
    const { components: read_, errors } = await read(t, {
      'components/lib/shared.js': 'export const initial = 4;\nexport const guard = typeof window === "undefined" ? "node" : "browser";\n',
      'components/lib/plot.css': '.plot-line { stroke: red; }\n',
      'components/fn-plot.jsx':
        "import { initial } from './lib/shared.js';\nimport './lib/plot.css';\n\nexport const params = { range: { label: 'Range', type: 'number', min: 1, max: 10, default: initial } };\nexport const layout = { width: 'wide', height: (params) => params.range * 100 };\n\nexport default function FnPlot(props) {\n  return <svg class=\"plot-line\">{props.range}</svg>;\n}\n",
      'components/glu-heatmap.js':
        "import { guard } from './lib/shared.js';\n\nexport const layout = { height: { ratio: 2 }, frame: false };\n\nexport default class GluHeatmap extends HTMLElement {\n  connectedCallback() {\n    this.textContent = guard;\n  }\n}\n",
      'components/README.md': 'Not a component.\n',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual([...read_.keys()], ['fn-plot', 'glu-heatmap']);
    const fnPlot = read_.get('fn-plot');
    assert.deepEqual([fnPlot.file, fnPlot.valid, fnPlot.params], ['components/fn-plot.jsx', true, { range: { label: 'Range', type: 'number', min: 1, max: 10, default: 4 } }]);
    assert.equal(fnPlot.layout.height({ range: 3 }), 300);
    assert.deepEqual([read_.get('glu-heatmap').params, read_.get('glu-heatmap').layout], [{}, { height: { ratio: 2 }, frame: false }]);
    assert.equal(typeof navigator, 'object');
    assert.equal(globalThis.HTMLElement, undefined);
  });

  test('reads a component that imports bake/kit in Node', async (t) => {
    const { components: read_, errors } = await read(t, {
      'components/kit-plot.jsx':
        "import { Axes, Curve, Plot, niceTicks } from 'bake/kit';\n\nexport const layout = { height: niceTicks(0, 4, 4).length * 100 };\n\nexport default function KitPlot() {\n  return <Plot x={[0, 1]} y={[0, 1]}><Axes /><Curve f={(x) => x} color=\"var(--series-1)\" /></Plot>;\n}\n",
    });
    assert.deepEqual(errors, []);
    assert.deepEqual([read_.get('kit-plot').valid, read_.get('kit-plot').layout], [true, { height: 500 }]);
  });

  test('reports a browser API used at the top level at its position, also inside components/lib/', async (t) => {
    const { errors } = await read(t, {
      'components/lib/size.js': 'export const unit = 8;\n\nexport const screen = window.innerWidth;\n',
      'components/lib-plot.js': `import { screen } from './lib/size.js';\n\n${height}export default function LibPlot() {\n  return screen;\n}\n`,
      'components/top-plot.js': `${height}const dark = matchMedia('(prefers-color-scheme: dark)');\n${component}`,
      'components/agent-plot.js': `${height}export const agent = navigator.userAgent;\n${component}`,
      'components/store-plot.js': `${height}  const saved = localStorage.getItem('x');\n${component}`,
    });
    const reason = 'at the top level; the build reads params and layout in Node, so use it inside the component code';
    assert.deepEqual(errors, [
      `components/agent-plot.js:2:22 agent-plot: components/agent-plot.js uses the browser API navigator ${reason}`,
      `components/lib/size.js:3:23 lib-plot: components/lib-plot.js uses the browser API window ${reason}`,
      `components/store-plot.js:2:17 store-plot: components/store-plot.js uses the browser API localStorage ${reason}`,
      `components/top-plot.js:2:14 top-plot: components/top-plot.js uses the browser API matchMedia ${reason}`,
    ]);
    assert.equal(typeof navigator, 'object');
  });

  test('the browser API fixture in test/fixtures/syntax-errors/ reports the line in expected.json', async () => {
    const fixtures = new URL('./fixtures/syntax-errors/', import.meta.url);
    const expected = JSON.parse(readFileSync(new URL('expected.json', fixtures), 'utf8'));
    const errors = [];
    await readComponents(fileURLToPath(new URL('component-browser-api/', fixtures)), { builtInBlocks: BUILT_IN_BLOCK_NAMES }, errors);
    assert.deepEqual(errors.map(formatError), [expected['component-browser-api']]);
  });

  test('reports syntax errors, failing imports and errors thrown at the top level', async (t) => {
    const { errors } = await read(t, {
      'components/syntax-plot.jsx': `${height}export default function SyntaxPlot() {\n  return <div>{</div>;\n}\n`,
      'components/import-plot.js': `import missing from 'not-a-package';\n${height}${component}`,
      'components/throw-plot.js': `${height}throw new Error('no data');\n${component}`,
    });
    assert.deepEqual(errors, [
      "components/import-plot.js:1:1 import-plot: components/import-plot.js cannot be read in Node: Cannot find module 'not-a-package' imported from 'components/import-plot.js'",
      'components/syntax-plot.jsx:3:17 syntax-plot: Unexpected token',
      'components/throw-plot.js:2:7 throw-plot: components/throw-plot.js cannot be read in Node: no data',
    ]);
  });

  test('reports problems in params and layout declarations at the start of the component file', async (t) => {
    const { errors, components: read_ } = await read(t, {
      'components/bad-type.js': `export const params = { n: { label: 'N', type: 'integer', default: 1 } };\n${height}${component}`,
      'components/reserved-name.js': `export const params = { width: { label: 'W', type: 'number', default: 1 } };\n${height}${component}`,
      'components/empty-enum.js': `export const params = { fn: { label: 'F', type: 'enum', default: 'a' } };\n${height}${component}`,
      'components/bad-default.js': `export const params = { n: { label: 'N', type: 'number', min: 1, max: 10, default: 20 }, on: { label: 'On', type: 'boolean', default: 'yes' }, fn: { label: 'F', type: 'enum', options: ['a', 'b'], default: 'c' }, t: { label: 'T', type: 'text', default: 3 } };\n${height}${component}`,
      'components/bad-field.js': `export const params = { n: { label: 'N', type: 'text', default: '', optons: [] }, m: { type: 'number', default: 1 }, k: { label: 'K', type: 'number' } };\n${height}${component}`,
      'components/bad-layout.js': `export const layout = { width: 'full', height: '300px', narrowHeight: { ratio: -1 }, frame: 'no', heigth: 3 };\n${component}`,
      'components/no-height.js': `export const layout = { width: '120%' };\n${component}`,
      'components/no-default-export.js': height,
      'components/Plot_Name.js': component,
      'components/list-table.js': component,
    });
    assert.deepEqual(errors, [
      'components/Plot_Name.js:1:1 the file name of a component is its custom element name and its block name; use lowercase letters and digits with at least one "-", such as act-fn-plot, got "Plot_Name"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "n" must be between 1 and 10, got 20',
      'components/bad-default.js:1:1 bad-default: the default of parameter "on" must be true or false, got "yes"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "fn" must be one of a or b, got "c"',
      'components/bad-default.js:1:1 bad-default: the default of parameter "t" must be text, got 3',
      'components/bad-field.js:1:1 bad-field: parameter "n" has the unknown field "optons"; the fields of a text parameter are label, type and default',
      'components/bad-field.js:1:1 bad-field: parameter "m" needs a label, the text shown next to its control',
      'components/bad-field.js:1:1 bad-field: parameter "k" needs a default, the value used when the article does not set it',
      'components/bad-layout.js:1:1 bad-layout: layout has the unknown field "heigth"; the fields of layout are width, height, narrowHeight and frame',
      'components/bad-layout.js:1:1 bad-layout: layout.width must be body, wide, page, a size in pixels such as 560px or a percentage of the body column up to 100% such as 70%, got "full"',
      'components/bad-layout.js:1:1 bad-layout: layout.height must be a number of pixels, { ratio: width / height } or a function of the parameters that returns one of them, got "300px"',
      'components/bad-layout.js:1:1 bad-layout: layout.narrowHeight must be a number of pixels, { ratio: width / height } or a function of the parameters that returns one of them, got an object',
      'components/bad-layout.js:1:1 bad-layout: layout.frame must be true or false, got "no"',
      'components/bad-type.js:1:1 bad-type: parameter "n" has the type "integer"; use number, text, boolean, enum or file',
      "components/empty-enum.js:1:1 empty-enum: parameter \"fn\" is an enum without options; list them as strings, for example options: ['gelu', 'silu']",
      'components/list-table.js:1:1 list-table: :::list-table is a built-in block; give the component another name',
      'components/no-default-export.js:1:1 no-default-export: the default export must be a SolidJS component or a class that extends HTMLElement',
      'components/no-height.js:1:1 no-height: layout.width must be body, wide, page, a size in pixels such as 560px or a percentage of the body column up to 100% such as 70%, got "120%"',
      'components/no-height.js:1:1 no-height: layout.height is missing; it is the height of the placeholder before the component loads, for example 360 or { ratio: 16 / 9 }',
      'components/reserved-name.js:1:1 reserved-name: parameter "width" uses a name reserved for Bake; a component cannot declare width, height, id or class',
    ]);
    assert.equal(read_.get('bad-type').valid, false);
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

  test('checks that a file parameter names a file in the article folder', async (t) => {
    const withDefault = { ...plot, params: { data: { label: 'Data', type: 'file', default: 'data.csv' } } };
    const options = { components: new Map([['act-fn-plot', withDefault]]), folder: { path: '/blog/post', files: ['grid.json', 'data/angles.csv'] } };
    const [block] = (await parsed(':::act-fn-plot{data=./data/angles.csv}\n:::\n', options)).intro;
    assert.equal(block.params.data, './data/angles.csv');
    assert.deepEqual((await parse(':::act-fn-plot{data=missing.csv}\n:::\n\n:::act-fn-plot\n:::\n\n:::act-fn-plot{data=../grid.json}\n:::\n', options)).errors, [
      'index.md:7:16 parameter "data" of act-fn-plot must be a file in the article folder, got "missing.csv"',
      'index.md:10:1 parameter "data" of act-fn-plot defaults to "data.csv", which is not a file in the article folder',
      'index.md:13:16 parameter "data" of act-fn-plot must be a file in the article folder, got "../grid.json"',
    ]);
    const image = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const dir = createBlog(t, { 'plot.png': image });
    const linked = await parsed('![](plot.png)\n\n:::act-fn-plot{data=plot.png}\n:::\n', { components: options.components, folder: folder(dir) });
    assert.deepEqual(linked.images.map((entry) => [entry.source, entry.keepSource]), [['plot.png', true]]);
  });

  test('reports layout height functions that throw or return an invalid height at the block', async () => {
    const broken = (heightOf) => new Map([['act-fn-plot', { ...plot, layout: { height: heightOf } }]]);
    assert.deepEqual((await parse(':::act-fn-plot{range=3}\n:::\n', { components: broken(() => '300px') })).errors, [
      'index.md:7:1 act-fn-plot: layout.height returns "300px" for these parameters; it must return a number of pixels or { ratio: width / height }',
    ]);
    const throwing = () => {
      throw new Error('unknown range');
    };
    assert.deepEqual((await parse(':::act-fn-plot\n:::\n', { components: broken(throwing) })).errors, ['index.md:7:1 act-fn-plot: layout.height throws for these parameters: unknown range']);
  });

  test('reports unknown components, :::{width=…} around a component and keeps the component of a broken file silent', async () => {
    const broken = new Map([['act-fn-plot', { name: 'act-fn-plot', valid: false }]]);
    assert.deepEqual((await parse(':::fn-plot\n:::\n\n::::{width=wide}\n:::glu-heatmap\n:::\n::::\n\n:::act-fn-plot{bta=1}\n:::\n', { components: new Map([...components, ...broken]) })).errors, [
      'index.md:7:1 unknown component "fn-plot"; components/ has no fn-plot.js or fn-plot.jsx',
      'index.md:10:1 write the width of a component in its own braces, such as :::glu-heatmap{width=wide}, instead of :::{width=…} around it',
    ]);
  });

  test('outputs the frame, the placeholder box and the caption', async () => {
    const article = await parsed(':::act-fn-plot{fn=silu toggle width=560px}\nThe *curve* of SiLU.\n:::\n\n:::glu-heatmap{width=70%}\n:::\n\n:::glu-heatmap{width=auto height=420}\n:::\n\n:::act-fn-plot{width=page}\nOne.\n\nTwo.\n:::\n', { components });
    const [first, second, third, fourth] = article.intro;
    assert.equal(
      first.html,
      '<figure class="component" data-component="act-fn-plot" data-params="{&#x22;fn&#x22;:&#x22;silu&#x22;,&#x22;range&#x22;:4,&#x22;beta&#x22;:1,&#x22;gamma&#x22;:1,&#x22;toggle&#x22;:true,&#x22;title&#x22;:&#x22;&#x22;,&#x22;data&#x22;:&#x22;&#x22;}" style="width:560px">' +
        '<div class="component-box" style="--component-height:360px;--component-ratio:auto;--component-narrow-height:520px;--component-narrow-ratio:auto"></div>' +
        '<figcaption>The <em>curve</em> of SiLU.</figcaption></figure>',
    );
    assert.deepEqual([first.type, first.width, first.naturalWidth, first.name, first.attributes], ['component', undefined, '560px', 'act-fn-plot', { fn: 'silu', toggle: true, width: '560px' }]);
    assert.equal(
      second.html,
      '<figure class="component" data-component="glu-heatmap" data-params="{}" data-frame="none" style="width:70%"><div class="component-box" style="--component-height:auto;--component-ratio:1.7778;--component-narrow-height:auto;--component-narrow-ratio:1.7778"></div></figure>',
    );
    assert.deepEqual([second.width, second.naturalWidth], ['body', undefined]);
    assert.match(third.html, /style="--component-height:420px;--component-ratio:auto;--component-narrow-height:420px;--component-narrow-ratio:auto"/);
    assert.equal(third.width, 'wide');
    assert.match(fourth.html, /<figcaption>\n<p>One.<\/p>\n<p>Two.<\/p>\n<\/figcaption>/);
    assert.equal(fourth.width, 'page');
    assert.deepEqual(article.components, ['act-fn-plot', 'glu-heatmap']);
  });

  test('marks an example whose result holds a component or a figure with a pixel width with those widths', async () => {
    const options = { components, folder: folder(join(import.meta.dirname, 'fixtures/syntax-errors')) };
    const article = await parsed(
      [
        '::::example\n:::act-fn-plot{width=560px}\n:::\n\n:::act-fn-plot\n:::\n::::',
        '::::example\n:::glu-heatmap\n:::\n\n![Graph](relu.svg){width=900px}\n::::',
        ':::example\nText with **bold**.\n:::',
      ].join('\n\n'),
      options,
    );
    const fields = article.intro.map(({ resultWidths, naturalWidth, width, html }) => ({ resultWidths, naturalWidth, width, marked: /^<div class="example"( data-result-widths="[^"]*")?>/.exec(html)[1] }));
    assert.deepEqual(fields, [
      { resultWidths: ['560px', 'body'], naturalWidth: '560px', width: undefined, marked: ' data-result-widths="560px body"' },
      { resultWidths: ['wide', '900px'], naturalWidth: '900px', width: 'wide', marked: ' data-result-widths="wide 900px"' },
      { resultWidths: undefined, naturalWidth: undefined, width: undefined, marked: undefined },
    ]);
  });

  test('validates and renders components inside other blocks', async () => {
    const { errors } = await parse('::::example\n:::act-fn-plot{range=20}\n:::\n::::\n', { components });
    assert.deepEqual(errors, ['index.md:8:16 parameter "range" of act-fn-plot must be between 1 and 10, got 20']);
    const article = await parsed('::::fold{title=Plot}\n:::glu-heatmap\nCells.\n:::\n::::\n', { components });
    assert.match(article.intro[0].html, /^<details class="fold"><summary>Plot<\/summary>\n<figure class="component" data-component="glu-heatmap"/);
    assert.deepEqual(article.components, ['glu-heatmap']);
  });
});

describe('building components', () => {
  test('bundles only the components that published articles use and loads the runtime only on pages with components', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/lib/shared.js': 'export const scale = 2;\n',
      'components/lib/plot.css': '.plot-line { stroke: rgb(1, 2, 3); }\n',
      'components/fn-plot.jsx':
        "import { createSignal } from 'solid-js';\nimport { scale } from './lib/shared.js';\nimport './lib/plot.css';\n\nexport const params = { range: { label: 'Range', type: 'number', default: 4 } };\nexport const layout = { height: 300 };\n\nexport default function FnPlot(props) {\n  const [count] = createSignal(scale);\n  return <svg class=\"plot-line\">{props.range * count()}</svg>;\n}\n",
      'components/grid-view.js': "import { scale } from './lib/shared.js';\n\nexport const layout = { height: 200 };\n\nexport default class GridView extends HTMLElement {\n  connectedCallback() {\n    this.textContent = String(scale);\n  }\n}\n",
      'components/unused-view.js': `${height}export default class UnusedView extends HTMLElement {}\n`,
      'content/posts/rope/index.md': article({ body: ':::fn-plot{range=3}\nA plot.\n:::\n\n:::grid-view\n:::\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'No components.\n' }),
      'content/posts/draft/index.md': article({ slug: 'draft', extra: 'draft: true\n', body: ':::unused-view\n:::\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const runtime = assets.find((name) => /^components-[\w-]+\.js$/.test(name));
    const rope = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(rope, new RegExp(`<script type="module" src="../../assets/${runtime}"></script>`));
    assert.doesNotMatch(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /type="module"/);
    assert.ok(assets.some((name) => /^fn-plot-[\w-]+\.js$/.test(name)));
    assert.ok(assets.some((name) => /^fn-plot-[\w-]+\.css$/.test(name)));
    assert.ok(assets.some((name) => /^grid-view-[\w-]+\.js$/.test(name)));
    assert.ok(!assets.some((name) => name.startsWith('unused-view')));
    const runtimeSource = readFileSync(join(dir, 'dist/assets', runtime), 'utf8');
    assert.match(runtimeSource, /fn-plot-[\w-]+\.js/);
    assert.doesNotMatch(runtimeSource, /unused-view/);
    const scripts = assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(join(dir, 'dist/assets', name), 'utf8'));
    assert.ok(!scripts.some((source) => source.includes('computations created outside')), 'no script contains the development build of Solid');
    assert.ok(!assets.some((name) => name.startsWith('kit-')), assets.join(', '));
    const sources = assets.filter((name) => /\.(js|css)$/.test(name)).map((name) => readFileSync(join(dir, 'dist/assets', name), 'utf8'));
    assert.ok(!sources.some((source) => source.includes('bk-kit-')), 'no asset contains code of bake/kit');
  });

  test('bundles bake/kit in its own chunk with its stylesheet when a component imports it', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/line-plot.jsx':
        "import { Axes, Plot, Slider } from 'bake/kit';\n\nexport const layout = { height: 300 };\n\nexport default function LinePlot() {\n  return <><Slider label=\"a\" min={0} max={1} value={0} onInput={() => {}} /><Plot x={[0, 1]} y={[0, 1]}><Axes /></Plot></>;\n}\n",
      'components/tick-list.js': "import { niceTicks } from 'bake/kit';\n\nexport const layout = { height: 100 };\n\nexport default class TickList extends HTMLElement {\n  connectedCallback() {\n    this.textContent = niceTicks(0, 1, 2).length;\n  }\n}\n",
      'content/posts/rope/index.md': article({ body: ':::line-plot\n:::\n\n:::tick-list\n:::\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const kit = assets.filter((name) => name.startsWith('kit-')).map((name) => name.replace(/-[\w-]{8}\./, '.'));
    assert.deepEqual(kit.sort(), ['kit.css', 'kit.js']);
    const source = (pattern) => readFileSync(join(dir, 'dist/assets', assets.find((name) => pattern.test(name))), 'utf8');
    assert.match(source(/^kit-[\w-]+\.css$/), /\.bk-kit-slider/);
    assert.match(source(/^line-plot-[\w-]+\.js$/), /\.\/kit-[\w-]+\.js/);
    assert.match(source(/^tick-list-[\w-]+\.js$/), /\.\/kit-[\w-]+\.js/);
  });

  test('reports component errors with the article errors and writes nothing', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/fn-plot.js': `${height}const width = window.innerWidth;\n${component}`,
      'components/grid-view.js': `export const params = { size: { label: 'Size', type: 'number', min: 1, max: 9, default: 3 } };\n${height}${component}`,
      'content/posts/rope/index.md': article({ body: ':::fn-plot\n:::\n\n:::grid-view{size=12}\n:::\n\n:::other-view\n:::\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(
      result.stderr,
      [
        'components/fn-plot.js:2:15 fn-plot: components/fn-plot.js uses the browser API window at the top level; the build reads params and layout in Node, so use it inside the component code',
        'content/posts/rope/index.md:10:14 parameter "size" of grid-view must be between 1 and 9, got 12',
        'content/posts/rope/index.md:13:1 unknown component "other-view"; components/ has no other-view.js or other-view.jsx',
        '3 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
  });
});
