import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, test } from 'node:test';
import { parse } from 'yaml';
import { openCommand } from '../src/dev/open.js';
import { article, bake, build, cli, createBlog, validConfig, writeFiles } from './blog.js';

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

  test('writes a workflow that builds the blog in the Playwright container of the version Bake installs, with the address of its GitHub Pages site, and publishes dist/', async (t) => {
    const dir = createBlog(t, {});
    assert.equal(init(dir, 'my-blog').status, 0);
    const text = readFileSync(join(dir, 'my-blog/.github/workflows/deploy.yml'), 'utf8');
    assert.ok(readFileSync(join(import.meta.dirname, '../README.md'), 'utf8').includes(`\`\`\`yaml\n${text}\`\`\``), 'the README shows the workflow that bake init writes');
    const workflow = parse(text);
    assert.deepEqual(workflow.on.push.branches, ['main']);
    assert.deepEqual(workflow.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
    const { playwright, build, deploy } = workflow.jobs;
    assert.match(playwright.steps.at(-1).run, /^echo "version=\$\(jq -r '\.packages\["node_modules\/@yhnocoder\/bake"\]\.dependencies\.playwright' package-lock\.json\)" >> "\$GITHUB_OUTPUT"$/);
    assert.equal(build.container, 'mcr.microsoft.com/playwright:v${{ needs.playwright.outputs.version }}-noble');
    const runs = build.steps.map((step) => step.run).filter(Boolean);
    assert.deepEqual(runs, ['npm ci', 'npx bake build --url "${{ steps.pages.outputs.base_url }}"']);
    assert.equal(build.steps.find((step) => step.id === 'pages').uses, 'actions/configure-pages@v5');
    assert.deepEqual(build.steps.at(-1), { uses: 'actions/upload-pages-artifact@v3', with: { path: 'dist' } });
    assert.equal(deploy.needs, 'build');
    assert.equal(deploy.steps.at(-1).uses, 'actions/deploy-pages@v4');
  });

  test('pins the version of Playwright, which names the container of the workflow', () => {
    const { dependencies } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));
    assert.match(dependencies.playwright, /^\d+\.\d+\.\d+$/);
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

  test('keeps the files of an existing folder, writes the missing ones and adds the missing lines to .gitignore', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, '.gitignore': '/node_modules\n.DS_Store\ndist', 'content/posts/hello/index.md': article() });
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        `Created a blog in ${dir}:`,
        '  public/favicon.svg',
        '  .gitignore',
        '  .github/workflows/deploy.yml',
        '  package.json',
        'Kept the existing files:',
        '  bake.config.js',
        '  content/posts/hello/index.md',
        'Next: npm install && npm run dev',
        'To publish the blog on GitHub Pages, push it to a GitHub repository and choose GitHub Actions as the source under Settings > Pages;',
        '.github/workflows/deploy.yml then publishes every push to main.',
        '',
      ].join('\n'),
    );
    assert.equal(readFileSync(join(dir, 'bake.config.js'), 'utf8'), validConfig);
    assert.equal(readFileSync(join(dir, 'content/posts/hello/index.md'), 'utf8'), article());
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '/node_modules\n.DS_Store\ndist\n.dist-staging/\n.dist-previous/\n');
    assert.equal(init(dir).stdout.split('\n')[1], '  package.json');
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
      assert.equal(result.stderr, `bake init: ${path} is a file, and bake init needs a folder there\n`, folder);
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
