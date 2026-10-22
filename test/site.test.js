import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { createSite, updateSite } from '../src/build/site.js';
import { article, createBlog, validConfig, writeFiles } from './blog.js';

const plainPage = `import { For } from 'solid-js';

export default function Page(props) {
  return (
    <html lang={props.site.language}>
      <head>
        <title>{props.site.title}</title>
        <For each={props.assets.styles}>{(href) => <link rel="stylesheet" href={href} />}</For>
        <For each={props.assets.scripts}>{(src) => <script type="module" src={src} />}</For>
      </head>
      <body>
        <main innerHTML={props.article.content.intro.map((block) => block.html).join('')} />
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

async function blogFiles() {
  return {
    'bake.config.js': validConfig,
    'preamble.sty': '\\newcommand{\\R}{\\mathbb{R}}\n',
    'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: 'In $\\R$.\n\n![Figure](figure.png)\n\n:::rope-plot\n:::\n\n:::rope-local\n:::\n' }),
    'content/posts/rope/figure.png': await png(4),
    'content/posts/rope/components/rope-local.js': customElement("'local'"),
    'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', body: 'Plain text.\n' }),
    'components/rope-plot.js': `import { scale } from '../lib/scale.js';\n\n${customElement('String(scale)')}`,
    'lib/scale.js': 'export const scale = 2;\n',
    'themes/plain/page.jsx': plainPage,
    'themes/plain/client.jsx': "import './plain.css';\n\nexport default () => () => {};\n",
    'themes/plain/plain.css': 'main {\n  color: red;\n}\n',
  };
}

async function outputs(result) {
  const rendered = new Map();
  for (const output of [...result.pages.flatMap((page) => page.outputs), result.home, ...result.siteFiles, ...result.assetFiles]) {
    if (output.render !== undefined) rendered.set(output.path, String(await output.render()));
  }
  return rendered;
}

function changedOutputs(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
}

function articleOf(result, file) {
  return result.articles.find((candidate) => candidate.file === file);
}

describe('updating a site', () => {
  test('rereads what a changed file affects and keeps the other articles', async (t) => {
    const dir = createBlog(t, await blogFiles());
    const site = createSite(dir);
    let result = await updateSite(site);
    assert.deepEqual(result.errors, []);
    const changes = [
      ['bake.config.js', validConfig.replace('Test Blog', 'Renamed Blog'), (paths) => paths.includes('index.html')],
      ['preamble.sty', '\\newcommand{\\R}{\\mathbb{Z}}\n', (paths) => paths.includes('2026-10/rope/index.html')],
      ['content/posts/rope/index.md', article({ extra: 'theme: plain\n', body: 'In $\\R$, changed.\n\n![Figure](figure.png)\n\n:::rope-plot\n:::\n\n:::rope-local\n:::\n' }), (paths) => paths.includes('2026-10/rope/index.html')],
      ['content/posts/rope/figure.png', await png(2), (paths) => paths.includes('2026-10/rope/index.html') && paths.includes('2026-10/rope/figure.webp')],
      ['components/rope-plot.js', `import { scale } from '../lib/scale.js';\n\n${customElement('String(scale * 3)')}`, (paths) => paths.some((path) => path.startsWith('assets/'))],
      ['content/posts/rope/components/rope-local.js', customElement("'changed'"), (paths) => paths.some((path) => path.startsWith('assets/'))],
      ['themes/plain/plain.css', 'main {\n  color: blue;\n}\n', (paths) => paths.some((path) => path.startsWith('assets/plain-'))],
      ['lib/scale.js', 'export const scale = 5;\n', (paths) => paths.some((path) => path.startsWith('assets/'))],
    ];
    for (const [path, content, affected] of changes) {
      const before = await outputs(result);
      const gelu = articleOf(result, 'content/posts/gelu/index.md');
      writeFiles(dir, { [path]: content });
      result = await updateSite(site, [path]);
      assert.deepEqual(result.errors, [], path);
      const changed = changedOutputs(before, await outputs(result));
      assert.ok(affected(changed), `${path} changed ${changed.join(', ')}`);
      assert.equal(articleOf(result, 'content/posts/gelu/index.md'), gelu, `${path} reread the unrelated article`);
    }
  });
});
