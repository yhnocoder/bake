import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { article, bake, createBlog, readTree, validConfig } from './blog.js';

const exampleBlog = join(import.meta.dirname, '../examples/blog');
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const siteFiles = ['404.html', '_bake/articles.json', '_bake/preamble.json', '_bake/theme.css', 'feed.xml', 'sitemap.xml'];

function articleFiles(tree) {
  return Object.keys(tree).filter((path) => !path.startsWith('assets/') && !path.startsWith('og/') && !siteFiles.includes(path));
}

function stagingFolders(dir) {
  return readdirSync(dir).filter((name) => name.startsWith('.dist-'));
}

describe('bake build', () => {
  test('writes published articles, their files and public/ into a fresh dist/', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/2026-10/rope/index.md': article({ title: 'RoPE <&> "quotes"', extra: "summary: Rotary & 'position' <embeddings>\n" }),
      'content/posts/2026-10/rope/figure.png': pngBytes,
      'content/posts/2026-10/rope/data/angles.json': '[1, 2]\n',
      'content/posts/drafts/gelu/index.md': article({ slug: 'gelu', extra: 'draft: true\n' }),
      'content/posts/series/index.md': article({ title: 'Series', slug: 'series', date: '2026-09-01' }),
      'content/posts/series/part-1/index.md': article({ title: 'Part 1', slug: 'part-1', date: '2026-09-02' }),
      'content/posts/series/part-1/plot.svg': '<svg/>\n',
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<!doctype html><p>demo</p>\n',
      'content/posts/demo/demo.js': 'export {};\n',
      'public/CNAME': 'example.com\n',
      'public/icons/favicon.svg': '<svg/>\n',
      'dist/stale.html': 'stale\n',
      'dist/2026-10/rope/old.png': pngBytes,
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '4 pages\ndist/ written\n');
    assert.equal(result.status, 0);
    const tree = readTree(join(dir, 'dist'));
    assert.ok(siteFiles.every((path) => Object.hasOwn(tree, path)));
    assert.deepEqual(
      Object.keys(tree)
        .filter((path) => path.startsWith('og/'))
        .map((path) => path.replace(/-[0-9a-f]{12}\.png$/, '')),
      ['og/2026-09/part-1', 'og/2026-09/series', 'og/2026-10/rope'],
    );
    assert.deepEqual(articleFiles(tree), [
      'CNAME',
      'index.html',
      '2026-08/demo/demo.js',
      '2026-08/demo/index.html',
      '2026-09/part-1/index.html',
      '2026-09/part-1/index.md',
      '2026-09/part-1/plot.svg',
      '2026-09/series/index.html',
      '2026-09/series/index.md',
      '2026-10/rope/data/angles.json',
      '2026-10/rope/figure.png',
      '2026-10/rope/index.html',
      '2026-10/rope/index.md',
      'icons/favicon.svg',
    ].sort());
    const page = tree['2026-10/rope/index.html'].toString();
    assert.match(page, /^<!doctype html>\n<html lang="en"/);
    assert.match(page, /<title>RoPE &lt;&amp;> "quotes" · Test Blog<\/title>/);
    assert.match(page, /<meta name="description" content="Rotary &amp; 'position' <embeddings>">/);
    assert.match(page, /<h1 class="bk-title">RoPE &lt;&amp;> "quotes"<\/h1>/);
    assert.match(page, /<p class="bk-summary">Rotary &amp; 'position' &lt;embeddings><\/p>/);
    assert.match(page, /<p>Text\.<\/p>/);
    assert.match(tree['2026-09/series/index.html'].toString(), /<h1 class="bk-title">Series<\/h1>/);
    const assets = Object.keys(tree).filter((path) => path.startsWith('assets/'));
    assert.equal(assets.filter((path) => /^assets\/essay-[\w-]+\.js$/.test(path)).length, 1);
    assert.equal(assets.filter((path) => /^assets\/essay-[\w-]+\.css$/.test(path)).length, 1);
    assert.equal(assets.filter((path) => /^assets\/chat-[\w-]+\.js$/.test(path)).length, 1);
    for (const path of assets.filter((asset) => /^assets\/(essay|chat)-[\w-]+\.(js|css)$/.test(asset))) assert.ok(page.includes(`../../${path}`), `the page links ${path}`);
    assert.equal(tree['2026-10/rope/index.md'].toString(), readFileSync(join(dir, 'content/posts/2026-10/rope/index.md'), 'utf8'));
    assert.deepEqual(tree['2026-10/rope/figure.png'], pngBytes);
    assert.equal(tree['2026-08/demo/index.html'].toString(), '<!doctype html><p>demo</p>\n');
    assert.equal(tree.CNAME.toString(), 'example.com\n');
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('prints 1 page for a single article', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    assert.equal(bake(dir, 'build').stdout, '1 page\ndist/ written\n');
  });

  test('keeps a page file already named index.html', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: index.html\n---\n',
      'content/posts/demo/index.html': '<p>demo</p>\n',
    });
    assert.equal(bake(dir, 'build').status, 0);
    assert.deepEqual(articleFiles(readTree(join(dir, 'dist'))), ['2026-08/demo/index.html', 'index.html']);
  });

  test('reports a URL that another article already uses at the later slug', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/2026-10/rope/index.md': article({ date: '2026-10-01' }),
      'content/posts/llm/rope/index.md': article({ date: '2026-10-19' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, 'content/posts/llm/rope/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/2026-10/rope/index.md\n1 error, dist/ was not written\n');
    assert.equal(result.status, 1);
  });

  test('checks drafts for duplicate URLs', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/a/index.md': article({ extra: 'draft: true\n' }),
      'content/posts/b/index.md': article(),
    });
    assert.equal(bake(dir, 'build').stderr, 'content/posts/b/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/a/index.md\n1 error, dist/ was not written\n');
  });

  test('reports every error sorted by file and position and leaves dist/ unchanged', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/b/index.md': '---\ntitle: B\nslug: B\ndate: 2026-10-19\ntoc: sidebar\nlayout: wide\n---\n',
      'content/posts/a/index.md': '---\ntitle: A\ndate: 2026-10-32\n---\n',
      'content/posts/c/index.md': '# No front matter\n',
      'content/posts/d/index.md': article({ slug: 'd' }),
      'public/2026-10/d/index.html': 'shadow\n',
      'dist/index.html': 'previous build\n',
    });
    const before = readTree(join(dir, 'dist'));
    const result = bake(dir, 'build');
    assert.equal(
      result.stderr,
      [
        'content/posts/a/index.md:1:1 front matter is missing "slug"',
        'content/posts/a/index.md:3:7 date must be a date in the form YYYY-MM-DD, got "2026-10-32"',
        'content/posts/b/index.md:3:7 slug "B" may only contain lowercase letters, digits and "-"',
        'content/posts/b/index.md:5:6 toc must be notes, tabs, dots or ticks, got "sidebar"',
        'content/posts/b/index.md:6:1 unknown front matter field "layout"',
        'content/posts/c/index.md:1:1 index.md must start with front matter between two --- lines',
        'content/posts/c/index.md:1:1 heading level 1 is not allowed; the article title comes from front matter, sections start at ##',
        'public/2026-10/d/index.html:1:1 dist/2026-10/d/index.html is also written by content/posts/d/index.md',
        '8 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
    assert.equal(result.stdout, '');
    assert.equal(result.status, 1);
    assert.deepEqual(readTree(join(dir, 'dist')), before);
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('does not create dist/ when there are errors', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/a/index.md': '---\ntitle: A\n---\n' });
    assert.equal(bake(dir, 'build').status, 1);
    assert.equal(existsSync(join(dir, 'dist')), false);
  });

  test('reports a public file that needs a folder where an article writes a file', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'public/2026-10/rope/index.html/extra.txt': 'x\n',
    });
    assert.equal(
      bake(dir, 'build').stderr,
      'public/2026-10/rope/index.html/extra.txt:1:1 dist/2026-10/rope/index.html/extra.txt conflicts with dist/2026-10/rope/index.html written by content/posts/rope/index.md\n1 error, dist/ was not written\n',
    );
  });

  test('reports an index.html next to a Markdown article', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/rope/index.html': '<p>x</p>\n',
    });
    assert.equal(bake(dir, 'build').stderr, 'content/posts/rope/index.md:1:1 index.html in the article folder conflicts with the page generated from index.md\n1 error, dist/ was not written\n');
  });

  test('reports an index.html next to a page article whose page has another name', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/demo/index.html': '<p>other</p>\n',
    });
    assert.equal(
      bake(dir, 'build').stderr,
      'content/posts/demo/index.md:5:7 page "demo.html" is published as index.html, which conflicts with index.html in the article folder\n1 error, dist/ was not written\n',
    );
  });

  test('reports a missing bake.config.js with the error count', (t) => {
    const dir = createBlog(t, { 'content/posts/rope/index.md': article() });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, 'bake.config.js:1:1 bake.config.js not found, run bake from the blog root\n1 error, dist/ was not written\n');
    assert.equal(result.status, 1);
  });

  test('checks articles against the categories in bake.config.js', (t) => {
    const config = "export default {\n  title: 'T',\n  url: 'https://example.com',\n  language: 'en',\n  categories: [{ id: 'ml', name: 'ML', color: '#336699' }],\n};\n";
    const dir = createBlog(t, {
      'bake.config.js': config,
      'content/posts/a/index.md': article({ slug: 'a', extra: 'category: ml\n' }),
      'content/posts/b/index.md': article({ slug: 'b', extra: 'category: math\n' }),
      'content/posts/c/index.md': article({ slug: 'c' }),
    });
    assert.equal(
      bake(dir, 'build').stderr,
      [
        'content/posts/b/index.md:5:11 category "math" is not one of the categories in bake.config.js',
        'content/posts/c/index.md:1:1 front matter is missing "category"',
        '2 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
  });

  test('rejects arguments', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const result = bake(dir, 'build', 'now');
    assert.equal(result.stderr, 'bake build: unexpected argument "now"\n');
    assert.equal(result.status, 1);
  });

  test('builds the example blog', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'bake-example-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '5 pages\ndist/ written\n');
    const page = readFileSync(join(dir, 'dist/2026-10/syntax/index.html'), 'utf8');
    assert.match(page, /<h1 class="bk-title">Bake 写法一览<\/h1>/);
    assert.match(page, /<mjx-container class="MathJax" jax="SVG"[^>]*data-tex="x \\in \\R\^d">/);
    assert.match(page, /<pre class="shiki bake"[^>]*data-language="python">/);
    assert.match(page, /<a class="internal-link" href="\.\.\/\.\.\/2026-10\/syntax-linked\/#chain-rule" data-target="\/2026-10\/syntax-linked\/#chain-rule">/);
    assert.match(page, /<template class="bk-preview-template" data-target="\/2026-10\/syntax-linked\/#chain-rule" data-kind="link">/);
    assert.match(page, /<div class="embed"><div class="embed-part"><h2 data-attributes="{&#x22;id&#x22;:&#x22;chain-rule&#x22;}">链式法则<\/h2>/);
    assert.ok(existsSync(join(dir, 'dist/2026-10/syntax/relu.svg')));
    assert.ok(existsSync(join(dir, 'dist/2026-10/syntax-linked/index.html')));
    assert.ok(existsSync(join(dir, 'dist/2026-10/jacobian/index.html')));
    const bento = readFileSync(join(dir, 'dist/2026-10/activations/index.html'), 'utf8');
    assert.match(bento, /<section class="bt-card" data-span="2" aria-labelledby="relu">/);
  });
  test('publishes raster images as WebP and copies the original only when a link points to it', async (t) => {
    const photo = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#985b57' } }).png().toBuffer();
    const small = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).jpeg().toBuffer();
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: '![Angles](angles.png)\n\n![Small](small.jpg)\n\n[Full size](small.jpg)\n' }),
      'content/posts/rope/angles.png': photo,
      'content/posts/rope/small.jpg': small,
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const tree = readTree(join(dir, 'dist'));
    assert.deepEqual(articleFiles(tree), ['2026-10/rope/angles.webp', '2026-10/rope/index.html', '2026-10/rope/index.md', '2026-10/rope/small.jpg', '2026-10/rope/small.webp', 'index.html']);
    assert.deepEqual(tree['2026-10/rope/small.jpg'], small);
    assert.deepEqual(await sharp(tree['2026-10/rope/angles.webp']).metadata().then(({ format, width, height }) => [format, width, height]), ['webp', 2680, 893]);
    assert.match(tree['2026-10/rope/index.html'].toString(), /<img src="angles.webp" alt="Angles" width="2680" height="893" loading="lazy" decoding="async">/);
    assert.doesNotMatch(tree['2026-10/rope/index.html'].toString(), /mjx/i);
  });

  test('reports preamble.sty errors and does not check the articles', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'preamble.sty': '\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\bad}[x]{y}\n\\usepackage{tikz}\n',
      'content/posts/rope/index.md': article({ body: '$\\undefined$\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(
      result.stderr,
      [
        'preamble.sty:2:1 MathJax cannot read this definition: Illegal number of parameters specified in \\newcommand',
        'preamble.sty:3:1 \\usepackage cannot be used in preamble.sty, which accepts \\newcommand, \\renewcommand, \\DeclareMathOperator, \\def, \\let, \\newenvironment, \\renewenvironment, \\ProvidesPackage and \\RequirePackage',
        '2 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
  });

  test('removes staging folders left by an interrupted build', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      '.dist-staging/2026-10/rope/index.html': 'half written\n',
      '.dist-previous/old.html': 'old\n',
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('skips dotfiles in article folders, keeps dotfiles in public/ except .DS_Store, and does not follow symlinked folders', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/rope/.DS_Store': 'finder\n',
      'content/posts/rope/.cache/data.json': '{}\n',
      'content/posts/rope/figure.svg': '<svg/>\n',
      'public/.DS_Store': 'finder\n',
      'public/.nojekyll': '',
      'public/.well-known/security.txt': 'Contact: mailto:a@example.com\n',
      'outside.txt': 'outside\n',
    });
    symlinkSync('..', join(dir, 'content/posts/rope/loop'));
    symlinkSync('../outside.txt', join(dir, 'public/linked.txt'));
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
    assert.deepEqual(articleFiles(readTree(join(dir, 'dist'))), [
      '.nojekyll',
      '.well-known/security.txt',
      '2026-10/rope/figure.svg',
      '2026-10/rope/index.html',
      '2026-10/rope/index.md',
      'index.html',
      'linked.txt',
    ].sort());
    assert.equal(readFileSync(join(dir, 'dist/linked.txt'), 'utf8'), 'outside\n');
  });
});
