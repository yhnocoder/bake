import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, test } from 'node:test';
import { parse } from 'yaml';
import { openCommand } from '../src/dev/open.js';
import { bake, build, cli, createBlog, validConfig, writeFiles } from './blog.js';

function init(dir, ...args) {
  return bake(dir, 'init', ...args, '--no-install');
}

describe('bake init', () => {
  test('creates a blog in a new folder that bake build publishes with its first post at the address bake build --url names', async (t) => {
    const dir = createBlog(t, {});
    const result = init(dir, 'my-blog', '--language', 'en');
    assert.equal(result.status, 0, result.stderr);
    const root = join(dir, 'my-blog');
    const date = /^date: (.+)$/m.exec(readFileSync(join(root, 'content/posts/hello/index.md'), 'utf8'))[1];
    assert.equal(
      result.stdout,
      [
        `Created a blog in ${root}:`,
        '  bake.config.js',
        '  content/posts/hello/index.md',
        '  public/favicon.svg',
        '  .gitignore',
        '  .github/workflows/deploy.yml',
        '  package.json',
        `The first post is at /${date.slice(0, 7)}/hello/. Next: cd my-blog && npm install && npm run dev`,
        'To publish the blog on GitHub Pages, push it to a GitHub repository and choose GitHub Actions as the source under Settings > Pages;',
        '.github/workflows/deploy.yml then publishes every push to main.',
        '',
      ].join('\n'),
    );
    assert.equal(readFileSync(join(root, 'bake.config.js'), 'utf8'), ['export default {', '  title: "my-blog",', '  language: "en",', '};', ''].join('\n'));
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.dist-staging/\n.dist-previous/\n');
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), { type: 'module', scripts: { dev: 'bake dev', build: 'bake build' }, devDependencies: { '@yhnocoder/bake': `^${version}` } });
    const built = bake(root, 'build', '--url', 'https://linda.github.io/my-blog');
    assert.equal(built.status, 0, built.stderr);
    const page = readFileSync(join(root, 'dist', date.slice(0, 7), 'hello/index.html'), 'utf8');
    assert.match(page, /<link rel="canonical" href="https:\/\/linda\.github\.io\/my-blog\/\d{4}-\d{2}\/hello\/">/);
    assert.match(page, /<link rel="icon" href="\.\.\/\.\.\/favicon\.svg">/);
    assert.match(page, /<h1 class="bk-title">Hello<\/h1>/);
  });

  test('writes the first post in Chinese for a Chinese blog', async (t) => {
    const dir = createBlog(t, {});
    assert.equal(init(dir, 'notes', '--language', 'zh-CN').status, 0);
    assert.match(readFileSync(join(dir, 'notes/content/posts/hello/index.md'), 'utf8'), /^---\ntitle: 你好\n[\s\S]*## 数学\n/);
    assert.match(readFileSync(join(dir, 'notes/bake.config.js'), 'utf8'), /language: "zh-CN"/);
  });

  test('writes a workflow that builds the blog with the address of its GitHub Pages site and publishes dist/', async (t) => {
    const dir = createBlog(t, {});
    assert.equal(init(dir, 'my-blog').status, 0);
    const workflow = parse(readFileSync(join(dir, 'my-blog/.github/workflows/deploy.yml'), 'utf8'));
    assert.deepEqual(workflow.on.push.branches, ['main']);
    assert.deepEqual(workflow.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
    const steps = workflow.jobs.deploy.steps;
    const runs = steps.map((step) => step.run).filter(Boolean);
    assert.deepEqual(runs, ['npm ci', 'npx playwright install --with-deps --only-shell chromium', 'npx bake build --url "${{ steps.pages.outputs.base_url }}"']);
    assert.equal(steps.find((step) => step.id === 'pages').uses, 'actions/configure-pages@v5');
    assert.deepEqual(steps.find((step) => step.uses?.startsWith('actions/upload-pages-artifact')).with, { path: 'dist' });
    assert.equal(steps.at(-1).uses, 'actions/deploy-pages@v4');
  });

  test('keeps the fields of an existing package.json, sets its type to module and adds the scripts and Bake', async (t) => {
    const dir = createBlog(t, { 'package.json': `${JSON.stringify({ name: 'notes', type: 'commonjs', scripts: { dev: 'vite', test: 'node --test' } }, null, 2)}\n` });
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(written.name, 'notes');
    assert.equal(written.type, 'module');
    assert.deepEqual(written.scripts, { dev: 'vite', build: 'bake build', test: 'node --test' });
    assert.deepEqual(Object.keys(written.devDependencies), ['@yhnocoder/bake']);
  });

  test('installs the packages and Chromium with npm, and reports a failed step', async (t) => {
    const dir = createBlog(t, {});
    const bin = join(dir, 'bin');
    const log = join(dir, 'npm.log');
    writeFiles(dir, { 'bin/npm': `#!/bin/sh\necho "$*" >> '${log}'\n[ "$1" = exec ] && exit 3\nexit 0\n` });
    chmodSync(join(bin, 'npm'), 0o755);
    const run = (folder) => spawnSync(process.execPath, [cli, 'init', folder], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    const result = run('my-blog');
    assert.equal(result.status, 1);
    assert.equal(readFileSync(log, 'utf8'), 'install\nexec --no -- playwright install chromium\n');
    assert.match(result.stderr, /^bake init: npm exec --no -- playwright install chromium failed; the blog files are written, run it again in .*my-blog\n$/);
    assert.ok(existsSync(join(dir, 'my-blog/bake.config.js')));
  });

  test('writes a folder name with quotes and a line break as the site title', async (t) => {
    const dir = createBlog(t, {});
    const name = 'it\'s "a"\nblog';
    const result = init(dir, name);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await build(join(dir, name), { url: 'https://example.com' }), []);
    assert.match(readFileSync(join(dir, name, 'dist/feed.xml'), 'utf8'), /<title>it&#x27;s &quot;a&quot;\nblog<\/title>/);
  });

  test('creates a blog in the current folder when no folder is given', async (t) => {
    const dir = createBlog(t, { 'notes.txt': 'kept\n' });
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: npm install && npm run dev\n/);
    assert.deepEqual(readdirSync(dir).sort(), ['.github', '.gitignore', 'bake.config.js', 'content', 'notes.txt', 'package.json', 'public']);
  });

  test('refuses a folder that already holds a file it would write and writes nothing', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, '.gitignore': 'dist/\n' });
    const result = init(dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake init: bake.config.js, .gitignore already exist; run bake init in a new or empty folder\n');
    assert.equal(existsSync(join(dir, 'content')), false);
    assert.equal(existsSync(join(dir, 'package.json')), false);
    assert.equal(readFileSync(join(dir, 'bake.config.js'), 'utf8'), validConfig);
  });

  test('reports a folder argument that names a file, or a file where it needs a folder, and writes nothing', async (t) => {
    const dir = createBlog(t, { afile: 'x\n', 'blocked/content/posts/hello': 'x\n' });
    for (const [folder, path] of [
      ['afile', 'afile'],
      ['afile/sub', 'afile'],
      ['blocked', 'blocked/content/posts/hello'],
    ]) {
      const result = init(dir, folder);
      assert.equal(result.status, 1, folder);
      assert.equal(result.stderr, `bake init: ${path} already exists; run bake init in a new or empty folder\n`, folder);
    }
    assert.deepEqual(readdirSync(join(dir, 'blocked')), ['content']);
  });

  test('quotes a folder with spaces in the next command', async (t) => {
    const dir = createBlog(t, {});
    const result = init(dir, "my blog's");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: cd 'my blog'\\''s' && npm install && npm run dev\n/);
  });

  test('rejects unknown options and a second folder with the usage line', async (t) => {
    const dir = createBlog(t, {});
    for (const args of [['a', 'b'], ['--force'], ['--language']]) {
      const result = bake(dir, 'init', ...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stderr, 'Usage: bake init [folder] [--language <code>] [--no-install]\n', args.join(' '));
    }
  });
});

describe('opening bake dev in the browser', () => {
  test('uses the command of each platform that opens an address in the default browser', async () => {
    const url = 'http://localhost:4321/';
    assert.deepEqual(openCommand('darwin', url), ['open', [url]]);
    assert.deepEqual(openCommand('linux', url), ['xdg-open', [url]]);
    assert.deepEqual(openCommand('win32', url), ['cmd', ['/c', 'start', '""', url]]);
  });
});
