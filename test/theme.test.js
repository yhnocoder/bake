import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog, validConfig } from './blog.js';
import { serve } from './browser/server.js';

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
    assert.match(styles, /--bg:#f5f6f4/);
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
    assert.match(styles, /--bg:#f5f6f4/);
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
