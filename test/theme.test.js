import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, build, createBlog, validConfig } from './blog.js';
import { withoutCopySource } from './article.js';

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

const scriptPage = plainPage.replace('<For each={props.assets.styles}>', '<For each={props.assets.scripts}>{(src) => <script type="module" src={src} />}</For>\n        <For each={props.assets.styles}>');

describe('themes', () => {
  test('a theme of the blog reuses the essay theme through bake/themes/essay and replaces its header', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: mine\ntoc: dots\n', body: '## One\n\nText.\n' }),
      'themes/mine/options.js': "export const options = { toc: { label: 'Table of contents style', type: 'enum', options: ['notes', 'dots', 'ticks'], default: 'notes' } };\n",
      'themes/mine/page.jsx': [
        "import { ArticleDocument, labelsFor } from 'bake/theme';",
        "import { Article, Toc, essayLabels } from 'bake/themes/essay';",
        "import { settings } from 'bake/themes/essay/options';",
        '',
        'export default function Page(props) {',
        '  const { site, article, assets, options } = props;',
        '  const labels = labelsFor(site.language);',
        '  return (',
        '    <ArticleDocument site={site} article={article} assets={assets} labels={labels} settings={settings} options={options} bodyClass="bk-page">',
        '      <div class="bk-shell">',
        '        <header class="custom-header">Custom {article.title}</header>',
        '        <main class="bk-main">',
        '          <Toc toc={article.content.toc} labels={essayLabels(site.language)} />',
        '          <Article content={article.content} labels={labels} />',
        '        </main>',
        '      </div>',
        '    </ArticleDocument>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/mine/client.jsx': "export { default } from 'bake/themes/essay/client';\n",
    });
    assert.deepEqual(await build(dir), []);
    const page = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'));
    assert.match(page, /<header class="custom-header">Custom (<!--!\$-->)?Rope<\/header>/);
    assert.doesNotMatch(page, /bk-header/);
    assert.match(page, /<html lang="en" [^>]*data-toc="dots"/);
    assert.match(page, /<nav class="bk-toc"/);
    assert.match(page, /<article class="bk-article"/);
    const assets = readdirSync(join(dir, 'dist/assets'));
    assert.match(readFileSync(join(dir, 'dist/assets', assets.find((name) => /^mine-[\w-]+\.css$/.test(name))), 'utf8'), /\.bk-toc-handle\{/);
    assert.match(readFileSync(join(dir, 'dist/assets', assets.find((name) => /^mine-[\w-]+\.js$/.test(name))), 'utf8'), /bk-toc-ui/);
  });

  test('a folder in themes/ adds a theme that articles can choose', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: 'Plain *text*.\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu' }),
      'themes/plain/page.jsx': plainPage,
      'themes/plain/client.jsx': "import './plain.css';\n\nexport default () => () => {};\n",
      'themes/plain/plain.css': 'main {\n  color: red;\n}\n',
    });
    assert.deepEqual(await build(dir), []);
    const page = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'));
    const assets = readdirSync(join(dir, 'dist/assets'));
    const plainStyles = assets.filter((name) => /^plain-[\w-]+\.css$/.test(name));
    assert.equal(plainStyles.length, 1);
    assert.equal(page, `<!doctype html>\n<html lang="en"><head><title>Rope</title><link rel="stylesheet" href="../../assets/${plainStyles[0]}"></head><body><main><p>Plain <em>text</em>.</p></main></body></html>\n`);
    assert.match(readFileSync(join(dir, 'dist/assets', plainStyles[0]), 'utf8'), /main\{color:red\}/);
    assert.match(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /<article class="bk-article"/);
    assert.ok(assets.some((name) => /^essay-[\w-]+\.css$/.test(name)));
  });

  test('a theme page script imports the copy module as bake/copy', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': scriptPage,
      'themes/plain/client.jsx': "import { startCopy } from 'bake/copy';\n\nexport default function start(document) {\n  startCopy(document.querySelector('main'), { copied: () => {} });\n  return () => {};\n}\n",
    });
    assert.deepEqual(await build(dir), []);
    const script = readdirSync(join(dir, 'dist/assets')).find((name) => /^plain-[\w-]+\.js$/.test(name));
    assert.match(readFileSync(join(dir, 'dist/assets', script), 'utf8'), /text\/plain/);
  });

  test('a theme of the blog builds its pages from the shared theme module bake/theme', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: '## One\n\nText.\n' }),
      'themes/plain/page.jsx': [
        "import { ArticleDocument, Block, Header, labelsFor } from 'bake/theme';",
        '',
        'export default function Page(props) {',
        '  const labels = labelsFor(props.site.language);',
        '  return (',
        '    <ArticleDocument site={props.site} article={props.article} assets={props.assets} labels={labels} bodyClass="plain">',
        '      <Header site={props.site} article={props.article} home={props.assets.root} labels={labels} />',
        '      <main class="bk-article">{props.article.content.sections[0].blocks.map((block) => <Block block={block} labels={labels} />)}</main>',
        '    </ArticleDocument>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/plain/client.jsx': "import 'bake/theme/styles/tokens.css';\nimport { startFolds } from 'bake/theme/client';\n\nexport default function start(document) {\n  return startFolds(document.querySelector('.bk-article'));\n}\n",
    });
    assert.deepEqual(await build(dir), []);
    const page = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'));
    assert.match(page, /<html lang="en"/);
    assert.match(page, /<body class="plain"/);
    assert.match(page, /<header class="bk-header"/);
    assert.match(page, /<p>Text.<\/p>/);
    const styles = readdirSync(join(dir, 'dist/assets')).filter((name) => /^plain-[\w-]+\.css$/.test(name));
    assert.match(readFileSync(join(dir, 'dist/assets', styles[0]), 'utf8'), /--bg:/);
  });

  test('a theme of the blog adds a reader setting whose default is the value of a theme option that the article sets', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\nink: dark\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', extra: 'theme: plain\n' }),
      'themes/plain/options.js': [
        "export const options = { ink: { label: 'Ink', type: 'enum', options: ['light', 'dark'], default: 'light' } };",
        "export const settings = { ink: { values: ['light', 'dark'], default: { option: 'ink' }, control: 'segmented' } };",
        '',
      ].join('\n'),
      'themes/plain/page.jsx': [
        "import { ArticleDocument, labelsFor } from 'bake/theme';",
        "import { settings } from './options.js';",
        '',
        'export default function Page(props) {',
        '  return <ArticleDocument site={props.site} article={props.article} assets={props.assets} labels={labelsFor(props.site.language)} settings={settings} options={props.options} />;',
        '}',
        '',
      ].join('\n'),
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    assert.deepEqual(await build(dir), []);
    const html = (slug) => readFileSync(join(dir, `dist/2026-10/${slug}/index.html`), 'utf8');
    assert.match(html('rope'), /<html lang="en" data-theme="system" data-size="medium" data-weight="regular" data-spacing="normal" data-ink="dark">/);
    assert.match(html('rope'), /"ink":\["light","dark"\]/);
    assert.match(html('gelu'), /<html lang="en" [^>]*data-ink="light">/);
  });

  test('a theme of the blog declares the heading attributes and the blocks that its articles write, and renders the blocks into the page', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: '## One {tone=loud}\n\n:::card{tint=blue}\nSee [one](#one) and $x$.\n:::\n' }),
      'themes/plain/options.js': [
        'export const options = {};',
        "export const headings = { tone: { type: 'enum', options: ['calm', 'loud'], depth: 2 } };",
        "export const blocks = { card: { tint: { type: 'enum', options: ['red', 'blue'] } } };",
        '',
      ].join('\n'),
      'themes/plain/page.jsx': [
        'export default function Page(props) {',
        '  return (',
        '    <html>',
        '      <body>',
        '        {props.article.content.sections.map((section) => (',
        '          <section data-tone={section.attributes.tone}>',
        "            {section.blocks.map((block) => (block.type === 'themeBlock' ? <aside data-block={block.name} data-tint={block.attributes.tint} innerHTML={block.html} /> : null))}",
        '          </section>',
        '        ))}',
        '      </body>',
        '    </html>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    assert.deepEqual(await build(dir), []);
    const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'));
    assert.match(html, /<section data-tone="loud"><aside data-block="card" data-tint="blue"><p>See <a href="#one">one<\/a> and <mjx-container[^>]*>.*<\/mjx-container>\.<\/p><\/aside><\/section>/s);
    assert.doesNotMatch(html, /<script/);
  });

  test('a module that the page script imports dynamically is a separate chunk with its own stylesheet', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: 'Plain text.\n' }),
      'themes/plain/page.jsx': scriptPage,
      'themes/plain/client.jsx': "import './plain.css';\n\nconst main = document.querySelector('main');\nmain.dataset.entry = 'started';\nimport('./lazy.js').then(({ mark }) => mark(main));\n\nexport default () => () => {};\n",
      'themes/plain/plain.css': 'main {\n  color: rgb(1, 2, 3);\n}\n',
      'themes/plain/lazy.js': "import './lazy.css';\n\nexport function mark(main) {\n  main.dataset.lazy = 'loaded-on-demand';\n}\n",
      'themes/plain/lazy.css': 'main {\n  background-color: rgb(4, 5, 6);\n}\n',
    });
    assert.deepEqual(await build(dir), []);
    const assets = readdirSync(join(dir, 'dist/assets'));
    const named = (pattern) => assets.filter((name) => pattern.test(name));
    assert.equal(named(/^plain-[\w-]+\.js$/).length, 1);
    assert.equal(named(/^lazy-[\w-]+\.js$/).length, 1);
    assert.equal(named(/^lazy-[\w-]+\.css$/).length, 1);
    const [entry] = named(/^plain-[\w-]+\.js$/);
    const [chunk] = named(/^lazy-[\w-]+\.js$/);
    assert.doesNotMatch(readFileSync(join(dir, 'dist/assets', entry), 'utf8'), /loaded-on-demand/);
    assert.match(readFileSync(join(dir, 'dist/assets', chunk), 'utf8'), /loaded-on-demand/);
    const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'));
    const scripts = [...html.matchAll(/<script[^>]*>/g)].map(([tag]) => tag);
    assert.deepEqual(scripts.slice(0, 1), [`<script type="module" src="../../assets/${entry}">`]);
    assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(([, href]) => href), [`../../assets/${named(/^plain-[\w-]+\.css$/)[0]}`]);
  });

  test('reports a theme folder without page.jsx or client.jsx', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/plain.css': 'main {}\n',
    });
    assert.deepEqual(await build(dir), ['themes/plain:1:1 theme "plain" has no page.jsx', 'themes/plain:1:1 theme "plain" has no client.jsx']);
  });

  test('reports a syntax error in a theme file of the blog at its position', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': 'export default function Page(props) {\n  return <header>{props.article.title</header>;\n}\n',
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    assert.deepEqual(await build(dir), ['themes/plain/page.jsx:2:40 Unterminated regular expression.']);
  });

  test('reports a theme folder of the blog named after a built-in theme, and a client.jsx without a default export', async (t) => {
    const named = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article(), 'themes/essay/page.jsx': 'export default function Page() {\n  return <html />;\n}\n' });
    assert.deepEqual(await build(named), ['themes/essay:1:1 a theme folder of the blog cannot have the name of the built-in theme "essay"; to change essay, name the folder differently and import the parts it keeps from bake/themes/essay']);
    const silent = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': plainPage,
      'themes/plain/client.jsx': "document.body.dataset.started = 'yes';\n",
    });
    assert.deepEqual(await build(silent), ['themes/plain/client.jsx:1:1 client.jsx has no default export; export the function start(document), which starts the page script and returns a function that stops it']);
  });

  test('reports a name that a file of a theme of the blog imports from another file of the theme that does not export it at the importing file', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': `import { missing } from './a.js';\n${plainPage}`.replace('<main ', '<main data-missing={missing} '),
      'themes/plain/a.js': 'export const other = 1;\n',
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    const [error] = await build(dir);
    assert.match(error, /^themes\/plain\/page\.jsx:\d+:\d+ .*"missing" is not exported by "themes\/plain\/a\.js"/);
  });

  test('reports an article that the theme cannot render', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': "export default function Page() {\n  throw new Error('no header');\n}\n",
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    assert.deepEqual(await build(dir), ['content/posts/rope/index.md:1:1 the plain theme cannot render this article: no header']);
  });

  test('leaves no build cache in the blog', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    assert.deepEqual(await build(dir), []);
    assert.deepEqual(readdirSync(dir, { recursive: true }).filter((path) => !path.startsWith('dist')).sort(), ['bake.config.js', 'content', 'content/posts', 'content/posts/rope', 'content/posts/rope/index.md']);
  });
});
