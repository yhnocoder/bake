import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'src/cli.js');

function bake(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('bake format', () => {
  let blog;
  const unformatted = '---\ntitle: 未统一\n---\n\n* 一\n* 二\n\n_强调_\n';
  const formatted = '---\ntitle: 未统一\n---\n\n- 一\n- 二\n\n*强调*\n';

  before(() => {
    blog = mkdtempSync(join(tmpdir(), 'bake-cli-'));
    cpSync(join(root, 'examples/minimal'), blog, { recursive: true });
    mkdirSync(join(blog, 'content/topic/notes'), { recursive: true });
    writeFileSync(join(blog, 'content/topic/post.md'), unformatted);
    writeFileSync(join(blog, 'content/topic/notes/draft.md'), unformatted);
  });

  after(() => {
    rmSync(blog, { recursive: true, force: true });
  });

  test('改写不符合输出格式的文件，跳过 notes/', () => {
    const result = bake(blog, 'format');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'content/topic/post.md\nRewrote 1 file\n');
    assert.equal(readFileSync(join(blog, 'content/topic/post.md'), 'utf8'), formatted);
    assert.equal(readFileSync(join(blog, 'content/topic/notes/draft.md'), 'utf8'), unformatted);
  });

  test('第二次运行没有需要改写的文件，输出 No files to rewrite', () => {
    const result = bake(blog, 'format');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'No files to rewrite\n');
  });

  test('指定路径', () => {
    const result = bake(blog, 'format', 'content/topic/notes/draft.md');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'content/topic/notes/draft.md\nRewrote 1 file\n');
  });

  test('有解析错误的文件不写回，退出码为 1', () => {
    const broken = '---\ntitle: [未闭合\n---\n\n:::callot\n内容\n:::\n\n* 列表\n';
    const path = join(blog, 'content/broken.md');
    writeFileSync(path, broken);
    const result = bake(blog, 'format');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^content\/broken\.md:2:\d+ Invalid YAML in frontmatter: /);
    assert.doesNotMatch(result.stderr, /callot/);
    assert.equal(result.stdout, 'No files to rewrite\n');
    assert.equal(readFileSync(path, 'utf8'), broken);
    rmSync(path);
  });

  test('改写多个文件时摘要使用复数', () => {
    writeFileSync(join(blog, 'content/one.md'), unformatted);
    writeFileSync(join(blog, 'content/two.md'), unformatted);
    const result = bake(blog, 'format', 'content/one.md', 'content/two.md');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'content/one.md\ncontent/two.md\nRewrote 2 files\n');
    rmSync(join(blog, 'content/one.md'));
    rmSync(join(blog, 'content/two.md'));
  });

  test('路径不存在', () => {
    const result = bake(blog, 'format', 'content/missing.md');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Cannot find content/missing.md\n');
  });
});

describe('其他子命令', () => {
  test('输出用法说明，退出码为 1', () => {
    const result = bake(root, 'build');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage:\n[\s\S]*bake format \[path\.\.\.\]/);
  });
});
