import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

export const cli = join(import.meta.dirname, '../src/cli.js');
export const exampleBlog = join(import.meta.dirname, '../examples/blog');

const EXAMPLE_OUTPUTS = new Set(['dist', '.dist-staging', '.dist-previous', 'node_modules']);
let builtExample = null;

export const validConfig = "export default { title: 'Test Blog', url: 'https://example.com', language: 'en' };\n";

export function createBlog(t, files) {
  // why: a process started in the folder sees it with symbolic links resolved, as macOS resolves /var to /private/var
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bake-blog-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, files);
  return dir;
}

export function copyExample(t) {
  const dir = createBlog(t, {});
  copyExampleTo(dir);
  return dir;
}

function copyExampleTo(dir) {
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => !EXAMPLE_OUTPUTS.has(relative(exampleBlog, source)) });
}

export function exampleBuild() {
  if (builtExample === null) {
    const dir = mkdtempSync(join(tmpdir(), 'bake-example-'));
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
    copyExampleTo(dir);
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
    builtExample = dir;
  }
  return builtExample;
}

export function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export function bake(dir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
}

export function article({ title = 'Rope', slug = 'rope', date = '2026-10-19', extra = '', body = 'Text.\n' } = {}) {
  return `---\ntitle: ${title}\nslug: ${slug}\ndate: ${date}\n${extra}---\n\n${body}`;
}

export function readTree(dir) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .filter((path) => statSync(join(dir, path)).isFile())
      .sort()
      .map((path) => [path, readFileSync(join(dir, path))]),
  );
}
