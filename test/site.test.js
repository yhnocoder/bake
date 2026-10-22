import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { createSite, updateSite } from '../src/build/site.js';
import { formatError } from '../src/shared/report.js';
import { article, createBlog, validConfig, writeFiles } from './blog.js';

const plainPage = `import { For } from 'solid-js';
import { word } from './word.js';

export default function Page(props) {
  return (
    <html lang={props.site.language}>
      <head>
        <title>{props.site.title}</title>
        <For each={props.assets.styles}>{(href) => <link rel="stylesheet" href={href} />}</For>
        <For each={props.assets.scripts}>{(src) => <script type="module" src={src} />}</For>
      </head>
      <body>
        <p>{word}</p>
        <div data-edge="start" />
        <div data-edge="end" />
        <script type="application/json" class="bk-source" data-region="source" />
        <main data-region="article" innerHTML={props.article.content.intro.map((block) => block.html).join('')} />
      </body>
    </html>
  );
}
`;

function png(width) {
  return sharp({ create: { width, height: 1, channels: 4, background: '#ffffff' } })
    .png()
    .toBuffer();
}

function customElement(text) {
  return `export const layout = { height: 100 };\n\nexport default class extends HTMLElement {\n  connectedCallback() {\n    this.textContent = ${text};\n  }\n}\n`;
}

const config = (extra = '') => `export default { title: 'Test Blog', url: 'https://example.com', language: 'en'${extra} };\n`;
const categories = ", categories: [{ id: 'ml', name: 'ML', color: '#336699' }]";
const plot = (params) => `import { scale } from '../lib/scale.js';\n\nexport const params = { ${params} };\n${customElement('String(scale)')}`;
const rope = (text) => article({ extra: 'theme: plain\n', body: `${text} In $\\R$, see [GELU](/2026-10/gelu/#rule).\n\n![Figure](figure.png)\n\n:::rope-plot{size=2}\n:::\n\n:::rope-local\n:::\n\n:::card\n:::\n\n:::embed\n/2026-10/gelu/#rule\n:::\n` });
const gelu = (heading, text) => article({ title: 'GELU', slug: 'gelu', extra: 'category: ml\n', body: `## ${heading} {#rule}\n\n${text}\n\n:::late-one\n:::\n` });

async function blogFiles() {
  return {
    'bake.config.js': config(", themes: { mine: { extra: 2 } }"),
    'preamble.sty': '\\newcommand{\\R}{\\mathbb{R}}\n',
    'content/posts/rope/index.md': rope('First.'),
    'content/posts/rope/figure.png': await png(4),
    'content/posts/rope/components/rope-local.js': customElement("'local'"),
    'content/posts/gelu/index.md': gelu('Rule', 'First rule.'),
    'components/rope-plot.js': plot("size: { label: 'Size', type: 'number', default: 1 }"),
    'lib/scale.js': 'export const scale = 2;\n',
    'themes/plain/page.jsx': plainPage,
    'themes/plain/client.jsx': "import './plain.css';\n\nexport default () => () => {};\n",
    'themes/plain/plain.css': 'main {\n  color: red;\n}\n',
    'themes/plain/word.js': "export const word = 'first';\n",
    'themes/mine/options.js': "export const options = { extra: { label: 'Extra', type: 'number', default: 1 } };\n",
  };
}

async function outputs(result) {
  const rendered = { errors: result.errors.map(formatError) };
  for (const output of [...result.pages.flatMap((page) => page.outputs), result.home, ...result.siteFiles, ...result.assetFiles]) {
    if (output?.render !== undefined) rendered[output.path] = String(await output.render());
  }
  return rendered;
}

function articleOf(result, file) {
  return result.articles.find((candidate) => candidate.file === file);
}

function pageOf(result, name) {
  return result.pages.find((page) => page.article.file === `content/posts/${name}/index.md`).outputs.find((output) => output.path.endsWith('/index.html'));
}

describe('updating a site', () => {
  // why: bake dev updates the site after every save, and a value that a cached page, article or bundle reads without recording it keeps that part at its old version
  test('gives after each change of a file of the blog the same pages, assets and problems as a build from scratch', async (t) => {
    const dir = createBlog(t, await blogFiles());
    const site = createSite(dir);
    await updateSite(site);
    const changes = [
      ['bake.config.js', config(`${categories}, themes: { mine: { extra: 2 } }`)],
      ['bake.config.js', config(`${categories}, themes: { mine: { extra: 2 } }`).replace('Test Blog', 'Renamed Blog')],
      ['themes/plain/options.js', 'export const options = {};\nexport const blocks = { card: {} };\n'],
      ['components/late-one.js', customElement("'late'")],
      ['content/posts/gelu/index.md', gelu('Rule', 'Second rule, see [Fresh](/2026-10/fresh/).')],
      ['content/posts/fresh', { 'content/posts/fresh/index.md': article({ title: 'Fresh', slug: 'fresh', body: ':::fresh-local\n:::\n' }), 'content/posts/fresh/components/fresh-local.js': customElement("'fresh'") }],
      ['content/posts/gelu/index.md', gelu('Product rule', 'Third rule.')],
      ['content/posts/gelu/index.md', gelu('Rule', 'Fourth rule.')],
      ['content/posts/rope/index.md', rope('Second.')],
      ['content/posts/rope/inner/index.md', article({ title: 'Inner', slug: 'inner', body: 'Inner.\n' })],
      ['content/posts/rope/figure.png', await png(2)],
      ['preamble.sty', '\\newcommand{\\R}{\\mathbb{Z}}\n'],
      ['components/rope-plot.js', plot("size: { label: 'Size', type: 'number', default: 3 }")],
      ['components/rope-plot.js', plot("scale: { label: 'Scale', type: 'number', default: 1 }")],
      ['lib/scale.js', 'export const scale = 5;\n'],
      ['content/posts/rope/components/rope-local.js', customElement("'changed'")],
      ['content/posts/rope/components/rope-local.js', "export const layout = { height: 100, frame: 'no' };\n\nexport default class extends HTMLElement {}\n"],
      ['themes/plain/plain.css', 'main {\n  color: blue;\n}\n'],
      ['themes/plain/word.js', "export const word = 'second';\n"],
      ['themes/mine', null],
      ['content/posts/fresh', null],
      ['bake.config.js', config(`${categories}, theme: 'plain'`)],
    ];
    for (const [path, content] of changes) {
      if (content === null) rmSync(join(dir, path), { recursive: true });
      else writeFiles(dir, typeof content === 'object' && !Buffer.isBuffer(content) ? content : { [path]: content });
      const updated = await outputs(await updateSite(site, [path]));
      assert.deepEqual(updated, await outputs(await updateSite(createSite(dir))), `after the change of ${path}`);
    }
  });

  test('keeps the articles that a change does not affect', async (t) => {
    const dir = createBlog(t, await blogFiles());
    const site = createSite(dir);
    let result = await updateSite(site);
    const unrelated = 'content/posts/rope/index.md';
    for (const [path, content] of [
      ['preamble.sty', '\\newcommand{\\R}{\\mathbb{Z}}\n'],
      ['content/posts/gelu/index.md', gelu('Rule', 'Second rule.')],
      ['themes/plain/plain.css', 'main {\n  color: blue;\n}\n'],
      ['lib/scale.js', 'export const scale = 5;\n'],
    ]) {
      const before = articleOf(result, unrelated);
      writeFiles(dir, { [path]: content });
      result = await updateSite(site, [path]);
      assert.equal(articleOf(result, unrelated) === before, path !== 'preamble.sty', `${path} reread ${unrelated}`);
    }
  });

  test('renders again only the changed article and the articles that show a part of it or link to an address it now has', async (t) => {
    const names = ['gelu', 'rope', 'swish', 'silu'];
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', body: '## Intro {#intro}\n\nGELU text.\n' }),
      'content/posts/rope/index.md': article({ body: 'See [GELU](/2026-10/gelu/#intro) and [SiLU](/2026-10/silu/).\n' }),
      'content/posts/swish/index.md': article({ title: 'Swish', slug: 'swish', body: 'Unrelated.\n' }),
    });
    const site = createSite(dir);
    let result = await updateSite(site);
    assert.deepEqual(result.errors.map((error) => error.message), ['link target /2026-10/silu/ does not exist']);
    const update = async (path, content) => {
      const before = new Map(names.filter((name) => result.pages.some((page) => page.article.file.includes(`/${name}/`))).map((name) => [name, pageOf(result, name)]));
      writeFiles(dir, { [path]: content });
      result = await updateSite(site, [path]);
      return [...before].filter(([name, output]) => pageOf(result, name) !== output).map(([name]) => name);
    };
    assert.deepEqual(await update('content/posts/gelu/index.md', article({ title: 'GELU', slug: 'gelu', body: '## Introduction {#intro}\n\nGELU text.\n' })), ['gelu', 'rope']);
    assert.deepEqual(await update('content/posts/rope/index.md', article({ body: 'See [GELU](/2026-10/gelu/#intro), and [SiLU](/2026-10/silu/).\n' })), ['rope']);
    assert.deepEqual(await update('content/posts/silu/index.md', article({ title: 'SiLU', slug: 'silu', body: 'SiLU text.\n' })), ['rope']);
    assert.deepEqual(result.errors, []);
  });
});
