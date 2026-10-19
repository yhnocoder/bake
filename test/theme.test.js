import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, bake, createBlog, validConfig } from './blog.js';

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
    assert.match(page, /<article class="bk-article">/);
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
    assert.match(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /<article class="bk-article">/);
    assert.ok(assets.some((name) => /^essay-[\w-]+\.css$/.test(name)));
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
