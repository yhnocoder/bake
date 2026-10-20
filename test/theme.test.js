import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from './blog.js';
import { serve } from './browser/server.js';

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

const scriptPage = plainPage.replace('<For each={props.assets.styles}>', '<For each={props.assets.scripts}>{(src) => <script type="module" src={src} />}</For>\n        <For each={props.assets.styles}>');

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
      'themes/plain/page.jsx': scriptPage,
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

  test('files of a theme of the blog never take the place of the files of bake/theme that have the same path', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: '## One\n\nText.\n' }),
      'themes/plain/page.jsx': [
        "import { ArticleDocument, Header, SITE_SETTINGS, labelsFor } from 'bake/theme';",
        "import { mark } from './header.jsx';",
        '',
        'export default function Page(props) {',
        '  const labels = labelsFor(props.site.language);',
        '  return (',
        '    <ArticleDocument site={props.site} article={props.article} assets={props.assets} labels={labels} settings={SITE_SETTINGS} bodyClass={mark}>',
        '      <Header site={props.site} article={props.article} home={props.assets.root} labels={labels} />',
        '    </ArticleDocument>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/plain/header.jsx': "export const mark = 'plain-own-header';\n",
      'themes/plain/index.jsx': "export const ArticleDocument = 'shadowed';\n",
      'themes/plain/client.js': "throw new Error('shadowed');\n",
      'themes/plain/styles/tokens.css': '@import "bake/theme/styles/tokens.css";\n:root { --plain-own: 1; }\n',
      'themes/plain/client.jsx': "import './styles/tokens.css';\nimport { startFolds } from 'bake/theme/client';\n\nstartFolds(document.querySelector('.bk-article'));\n",
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const page = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    assert.match(page, /<body class="plain-own-header"/);
    assert.match(page, /<header class="bk-header"/);
    const styles = readdirSync(join(dir, 'dist/assets')).filter((name) => /^plain-[\w-]+\.css$/.test(name));
    const css = readFileSync(join(dir, 'dist/assets', styles[0]), 'utf8');
    assert.match(css, /--bg:/);
    assert.match(css, /--plain-own:/);
    const scripts = readdirSync(join(dir, 'dist/assets')).filter((name) => /^plain-[\w-]+\.js$/.test(name));
    assert.doesNotMatch(readFileSync(join(dir, 'dist/assets', scripts[0]), 'utf8'), /shadowed/);
  });

  test('no file of the shared theme module has the path of a file in a built-in theme', () => {
    const files = (folder) => readdirSync(folder, { recursive: true }).filter((path) => path.includes('.'));
    const shared = new Set(files(SHARED_DIR));
    for (const theme of readdirSync(BUILT_IN_DIR)) {
      assert.deepEqual(files(join(BUILT_IN_DIR, theme)).filter((path) => shared.has(path)), [], theme);
    }
  });

  test('the essay and bento page scripts import the Markdown serializer of bake/copy from a separate chunk', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/gelu/index.md': article({ slug: 'gelu', extra: 'theme: bento\n' }),
    });
    assert.equal(bake(dir, 'build').stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const read = (name) => readFileSync(join(dir, 'dist/assets', name), 'utf8');
    for (const theme of ['essay', 'bento']) {
      const entry = read(assets.find((name) => new RegExp(`^${theme}-[\\w-]+\\.js$`).test(name)));
      const chunks = [...new Set(entry.match(/selection-[\w-]+\.js/g))];
      assert.equal(chunks.length, 1, `the ${theme} page script imports one selection chunk`);
      assert.doesNotMatch(entry, /Cannot handle unknown node/, `the ${theme} page script holds the serializer`);
      assert.match(entry, /text\/plain/);
      assert.match(read(chunks[0]), /Cannot handle unknown node/);
    }
  });

  test('a module that the page script imports dynamically is a separate chunk with its own stylesheet, which the page loads when the import runs', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n', body: 'Plain text.\n' }),
      'themes/plain/page.jsx': scriptPage,
      'themes/plain/client.jsx': "import './plain.css';\n\nconst main = document.querySelector('main');\nmain.dataset.entry = 'started';\nimport('./lazy.js').then(({ mark }) => mark(main));\n",
      'themes/plain/plain.css': 'main {\n  color: rgb(1, 2, 3);\n}\n',
      'themes/plain/lazy.js': "import './lazy.css';\n\nexport function mark(main) {\n  main.dataset.lazy = 'loaded-on-demand';\n}\n",
      'themes/plain/lazy.css': 'main {\n  background-color: rgb(4, 5, 6);\n}\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const assets = readdirSync(join(dir, 'dist/assets'));
    const named = (pattern) => assets.filter((name) => pattern.test(name));
    assert.equal(named(/^plain-[\w-]+\.js$/).length, 1);
    assert.equal(named(/^lazy-[\w-]+\.js$/).length, 1);
    assert.equal(named(/^lazy-[\w-]+\.css$/).length, 1);
    const [entry] = named(/^plain-[\w-]+\.js$/);
    const [chunk] = named(/^lazy-[\w-]+\.js$/);
    assert.doesNotMatch(readFileSync(join(dir, 'dist/assets', entry), 'utf8'), /loaded-on-demand/);
    assert.match(readFileSync(join(dir, 'dist/assets', chunk), 'utf8'), /loaded-on-demand/);
    const html = readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*>/g)].map(([tag]) => tag);
    assert.deepEqual(scripts.slice(0, 1), [`<script type="module" src="../../assets/${entry}">`]);
    assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(([, href]) => href), [`../../assets/${named(/^plain-[\w-]+\.css$/)[0]}`]);

    const origin = await serve(t, join(dir, 'dist'));
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    const requested = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await page.goto(`${origin}/2026-10/rope/`);
    await page.waitForSelector('main[data-lazy="loaded-on-demand"]');
    assert.deepEqual(errors, []);
    assert.ok(requested.includes(`/assets/${chunk}`), requested.join('\n'));
    const styles = await page.evaluate(() => {
      const main = getComputedStyle(document.querySelector('main'));
      return { entry: document.querySelector('main').dataset.entry, color: main.color, background: main.backgroundColor };
    });
    assert.deepEqual(styles, { entry: 'started', color: 'rgb(1, 2, 3)', background: 'rgb(4, 5, 6)' });
  });

  test('an @import url() without ./ in a theme folder finds the file in the blog folder first and in the built-in folder second', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'themes/essay/theme.css': '@import url(styles/tokens.css);\n@import url(styles/c.css);\n',
      'themes/essay/styles/c.css': '.bk-custom {\n  color: red;\n}\n',
    });
    assert.equal(bake(dir, 'build').stderr, '');
    const styles = readFileSync(join(dir, 'dist/_bake/theme.css'), 'utf8');
    assert.doesNotMatch(styles, /@import/i);
    assert.match(styles, /--bg:[^;]*#f5f6f4/);
    assert.match(styles, /\.bk-custom\{color:red\}/);
  });

  test('a stylesheet pulled in by an @import line looks up its own @import lines in the blog folder first and in the built-in folder second', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'themes/essay/theme.css': "@import './styles/group.css';\n",
      'themes/essay/styles/group.css': "@import './tokens.css';\n@import './c.css';\n",
      'themes/essay/styles/c.css': '.bk-custom {\n  color: red;\n}\n',
    });
    assert.equal(bake(dir, 'build').stderr, '');
    const styles = readFileSync(join(dir, 'dist/_bake/theme.css'), 'utf8');
    assert.doesNotMatch(styles, /@import/i);
    assert.match(styles, /--bg:[^;]*#f5f6f4/);
    assert.match(styles, /\.bk-custom\{color:red\}/);
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

  test('reports a file of the blog that replaces a file of bake/theme without an export the theme imports at that file', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'themes/essay/labels.js': 'export const nothing = 1;\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, 'themes/essay/labels.js:1:1 the theme imports "labelsFor" from this file, which does not export it\n1 error, dist/ was not written\n');
  });

  test('reports a name that a file of a theme of the blog imports from another file of the theme that does not export it at the importing file', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': `import { missing } from './a.js';\n${plainPage}`.replace('<main ', '<main data-missing={missing} '),
      'themes/plain/a.js': 'export const other = 1;\n',
      'themes/plain/client.jsx': '',
    });
    const result = bake(dir, 'build');
    assert.match(result.stderr, /^themes\/plain\/page\.jsx:\d+:\d+ .*"missing" is not exported by "themes\/plain\/a\.js"/);
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
