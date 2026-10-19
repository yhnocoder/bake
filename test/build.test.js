import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, bake, createBlog, readTree, validConfig } from './blog.js';

const exampleBlog = join(import.meta.dirname, '../examples/blog');
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

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
    assert.deepEqual(Object.keys(tree), [
      'CNAME',
      '2026-08/demo/demo.js',
      '2026-08/demo/index.html',
      '2026-09/part-1/index.html',
      '2026-09/part-1/plot.svg',
      '2026-09/series/index.html',
      '2026-10/rope/data/angles.json',
      '2026-10/rope/figure.png',
      '2026-10/rope/index.html',
      'icons/favicon.svg',
    ].sort());
    assert.equal(
      tree['2026-10/rope/index.html'].toString(),
      [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>RoPE &#60;&#38;&#62; &#34;quotes&#34;</title>',
        '</head>',
        '<body>',
        '<h1>RoPE &#60;&#38;&#62; &#34;quotes&#34;</h1>',
        '<p>Rotary &#38; &#39;position&#39; &#60;embeddings&#62;</p>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );
    assert.doesNotMatch(tree['2026-09/series/index.html'].toString(), /<p>/);
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
    assert.deepEqual(Object.keys(readTree(join(dir, 'dist'))), ['2026-08/demo/index.html']);
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
        'public/2026-10/d/index.html:1:1 dist/2026-10/d/index.html is also written by content/posts/d/index.md',
        '7 errors, dist/ was not written',
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
    assert.equal(result.stdout, '2 pages\ndist/ written\n');
    assert.match(readFileSync(join(dir, 'dist/2026-10/syntax/index.html'), 'utf8'), /<h1>Bake 写法一览<\/h1>/);
    assert.ok(existsSync(join(dir, 'dist/2026-10/syntax/relu.svg')));
    assert.ok(existsSync(join(dir, 'dist/2026-10/syntax-linked/index.html')));
  });
});
