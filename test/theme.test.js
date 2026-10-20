import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, bake, createBlog, validConfig } from './blog.js';

const SHARED_DIR = new URL('../src/theme/', import.meta.url).pathname;
const BUILT_IN_DIR = new URL('../src/themes/', import.meta.url).pathname;

const plainPage = `import { For } from 'solid-js';

export default function Page(props) {
  return (
    <html lang={props.site.language}>
      <head>
        <title>{props.article.title}</title>
        <For each={props.assets.styles}>{(href) => <link rel="stylesheet" href={href} />}</For>
      </head>
      <body>
        <main innerHTML={props.article.content.intro.map((block) => block.html).join('')} />
      </body>
    </html>
  );
}
`;

describe('themes', () => {
  test("a file in the blog's themes/essay/ replaces the built-in file of the same name", (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ title: 'Rope' }),
      'themes/essay/header.jsx': `import { Show } from 'solid-js';\n\nexport function Header(props) {\n  return <header class="custom-header"><Show when={props.article.title}>Custom {props.article.title}</Show></header>;\n}\n`,
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const page = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(page, /<header class="custom-header">Custom (<!--!\$-->)?Rope<\/header>/);
    assert.doesNotMatch(page, /bk-header/);
    assert.match(page, /<article class="bk-article" data-region="article">/);
  });

  test('a folder in themes/ adds a theme that articles can choose', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: 'Plain *text*.\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu' }),
      'themes/plain/page.jsx': plainPage,
      'themes/plain/client.jsx': "import './plain.css';\n",
      'themes/plain/plain.css': 'main {\n  color: red;\n}\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const page = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const plainStyles = assets.filter((name) => /^plain-[\w-]+\.css$/.test(name));
    assert.equal(plainStyles.length, 1);
    assert.equal(page, `<!doctype html>\n<html lang="en"><head><title>Rope</title><link rel="stylesheet" href="../../assets/${plainStyles[0]}"></head><body><main><p>Plain <em>text</em>.</p></main></body></html>\n`);
    assert.match(readFileSync(join(dir, 'dist/assets', plainStyles[0]), 'utf8'), /main\{color:red\}/);
    assert.match(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /<article class="bk-article" data-region="article">/);
    assert.ok(assets.some((name) => /^essay-[\w-]+\.css$/.test(name)));
  });

  test('a theme page script imports the copy module as bake/copy', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': plainPage.replace('<For each={props.assets.styles}>', '<For each={props.assets.scripts}>{(src) => <script defer src={src} />}</For>\n        <For each={props.assets.styles}>'),
      'themes/plain/client.jsx': "import { startCopy } from 'bake/copy';\n\nstartCopy(document.querySelector('main'), { copied: () => {} });\n",
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const script = readdirSync(join(dir, 'dist/assets')).find((name) => /^plain-[\w-]+\.js$/.test(name));
    assert.match(readFileSync(join(dir, 'dist/assets', script), 'utf8'), /text\/plain/);
  });

  test("a file in the blog's themes/bento/ replaces the file of the shared theme module that bento uses", (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: bento\n', body: '## One\n\nText.\n' }),
      'themes/bento/header.jsx': 'export function Header(props) {\n  return <header class="bento-header">{props.article.title}</header>;\n}\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const page = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(page, /<header class="bento-header">Rope<\/header>/);
    assert.match(page, /<section class="bt-card"/);
  });

  test('a theme of the blog builds its pages from the shared theme module bake/theme', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: '## One\n\nText.\n' }),
      'themes/plain/page.jsx': [
        "import { ArticleDocument, Block, Header, SITE_SETTINGS, labelsFor } from 'bake/theme';",
        '',
        'export default function Page(props) {',
        '  const labels = labelsFor(props.site.language);',
        '  return (',
        '    <ArticleDocument site={props.site} article={props.article} assets={props.assets} labels={labels} settings={SITE_SETTINGS} bodyClass="plain">',
        '      <Header site={props.site} article={props.article} home={props.assets.root} labels={labels} />',
        '      <main class="bk-article">{props.article.content.sections[0].blocks.map((block) => <Block block={block} labels={labels} />)}</main>',
        '    </ArticleDocument>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/plain/client.jsx': "import 'bake/theme/styles/tokens.css';\nimport { startFolds } from 'bake/theme/client';\n\nstartFolds(document.querySelector('.bk-article'));\n",
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const page = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(page, /<html lang="en" data-theme="system" data-font="sans">/);
    assert.match(page, /<body class="plain"/);
    assert.match(page, /<header class="bk-header"/);
    assert.match(page, /<div class="bk-block" data-type="paragraph" data-line="10" data-end-line="10"><p>Text.<\/p><\/div>/);
    assert.match(page, /<script type="application\/json" class="bk-source" data-region="source">/);
    const styles = readdirSync(join(dir, 'dist/assets')).filter((name) => /^plain-[\w-]+\.css$/.test(name));
    assert.match(readFileSync(join(dir, 'dist/assets', styles[0]), 'utf8'), /--bg:/);
  });

  test('no file of the shared theme module has the path of a file in a built-in theme', () => {
    const files = (folder) => readdirSync(folder, { recursive: true }).filter((path) => path.includes('.'));
    const shared = new Set(files(SHARED_DIR));
    for (const theme of readdirSync(BUILT_IN_DIR)) {
      assert.deepEqual(files(join(BUILT_IN_DIR, theme)).filter((path) => shared.has(path)), [], theme);
    }
  });

  test('reports a theme folder without page.jsx or client.jsx', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/plain.css': 'main {}\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, ['themes/plain:1:1 theme "plain" has no page.jsx', 'themes/plain:1:1 theme "plain" has no client.jsx', '2 errors, dist/ was not written', ''].join('\n'));
  });

  test('reports a syntax error in a theme file of the blog at its position', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'themes/essay/header.jsx': 'export function Header(props) {\n  return <header>{props.article.title</header>;\n}\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, 'themes/essay/header.jsx:2:40 Unterminated regular expression.\n1 error, dist/ was not written\n');
  });

  test('reports an article that the theme cannot render', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'themes/essay/header.jsx': "export function Header() {\n  throw new Error('no header');\n}\n",
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, 'content/posts/rope/index.md:1:1 the essay theme cannot render this article: no header\n1 error, dist/ was not written\n');
  });

  test('leaves no build cache in the blog', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    assert.equal(bake(dir, 'build').stderr, '');
    assert.deepEqual(readdirSync(dir, { recursive: true }).filter((path) => !path.startsWith('dist')).sort(), ['bake.config.js', 'content', 'content/posts', 'content/posts/rope', 'content/posts/rope/index.md']);
  });
});
