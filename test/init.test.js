import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { openCommand } from '../src/dev/open.js';
import { bake, createBlog, validConfig } from './blog.js';

describe('bake init', () => {
  test('creates a blog in a new folder that bake build publishes with its first post', (t) => {
    const dir = createBlog(t, {});
    const result = bake(dir, 'init', 'my-blog');
    assert.equal(result.status, 0, result.stderr);
    const root = join(dir, 'my-blog');
    const date = /^date: (.+)$/m.exec(readFileSync(join(root, 'content/posts/hello/index.md'), 'utf8'))[1];
    assert.equal(
      result.stdout,
      [`Created a blog in ${root}:`, '  bake.config.js', '  content/posts/hello/index.md', '  .gitignore', `The first post is at /${date.slice(0, 7)}/hello/. Next: cd my-blog && bake dev`, ''].join('\n'),
    );
    assert.equal(readFileSync(join(root, 'bake.config.js'), 'utf8'), ['export default {', '  title: "my-blog",', "  url: 'https://example.github.io',", "  language: 'zh-CN',", '};', ''].join('\n'));
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.dist-staging/\n.dist-previous/\n');
    const build = bake(root, 'build');
    assert.equal(build.stderr, '');
    assert.equal(build.stdout, '1 page\ndist/ written\n');
    assert.ok(existsSync(join(root, 'dist', date.slice(0, 7), 'hello/index.html')));
  });

  test('writes a folder name with quotes and a line break as the site title', (t) => {
    const dir = createBlog(t, {});
    const name = 'it\'s "a"\nblog';
    const result = bake(dir, 'init', name);
    assert.equal(result.status, 0, result.stderr);
    const build = bake(join(dir, name), 'build');
    assert.equal(build.stderr, '');
    assert.match(readFileSync(join(dir, name, 'dist/feed.xml'), 'utf8'), /<title>it&#x27;s &quot;a&quot;\nblog<\/title>/);
  });

  test('creates a blog in the current folder when no folder is given', (t) => {
    const dir = createBlog(t, { 'notes.txt': 'kept\n' });
    const result = bake(dir, 'init');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: bake dev\n$/);
    assert.deepEqual(readdirSync(dir).sort(), ['.gitignore', 'bake.config.js', 'content', 'notes.txt']);
  });

  test('refuses a folder that already holds a file it would write and writes nothing', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, '.gitignore': 'dist/\n' });
    const result = bake(dir, 'init');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake init: bake.config.js, .gitignore already exist; run bake init in a new or empty folder\n');
    assert.equal(existsSync(join(dir, 'content')), false);
    assert.equal(readFileSync(join(dir, 'bake.config.js'), 'utf8'), validConfig);
  });

  test('reports a folder argument that names a file, or a file where it needs a folder, and writes nothing', (t) => {
    const dir = createBlog(t, { afile: 'x\n', 'blocked/content/posts/hello': 'x\n' });
    for (const [folder, path] of [
      ['afile', 'afile'],
      ['afile/sub', 'afile'],
      ['blocked', 'blocked/content/posts/hello'],
    ]) {
      const result = bake(dir, 'init', folder);
      assert.equal(result.status, 1, folder);
      assert.equal(result.stderr, `bake init: ${path} already exists; run bake init in a new or empty folder\n`, folder);
    }
    assert.deepEqual(readdirSync(join(dir, 'blocked')), ['content']);
  });

  test('quotes a folder with spaces in the next command', (t) => {
    const dir = createBlog(t, {});
    const result = bake(dir, 'init', "my blog's");
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.endsWith("Next: cd 'my blog'\\''s' && bake dev\n"), result.stdout);
  });

  test('rejects options and a second folder with the usage line', (t) => {
    const dir = createBlog(t, {});
    for (const args of [['a', 'b'], ['--force']]) {
      const result = bake(dir, 'init', ...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stderr, 'Usage: bake init [folder]\n', args.join(' '));
    }
  });
});

describe('opening bake dev in the browser', () => {
  test('uses the command of each platform that opens an address in the default browser', () => {
    const url = 'http://localhost:4321/';
    assert.deepEqual(openCommand('darwin', url), ['open', [url]]);
    assert.deepEqual(openCommand('linux', url), ['xdg-open', [url]]);
    assert.deepEqual(openCommand('win32', url), ['cmd', ['/c', 'start', '""', url]]);
  });
});
