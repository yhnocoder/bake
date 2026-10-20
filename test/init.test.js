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
    assert.equal(readFileSync(join(root, 'bake.config.js'), 'utf8'), "export default {\n  title: 'my-blog',\n  url: 'https://example.github.io',\n  language: 'zh-CN',\n};\n");
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.dist-staging/\n.dist-previous/\n');
    const build = bake(root, 'build');
    assert.equal(build.stderr, '');
    assert.equal(build.stdout, '1 page\ndist/ written\n');
    assert.ok(existsSync(join(root, 'dist', date.slice(0, 7), 'hello/index.html')));
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
