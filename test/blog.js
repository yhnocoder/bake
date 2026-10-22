import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import sharp from 'sharp';
import { formatError } from '../src/report.js';

export const cli = join(import.meta.dirname, '../src/cli.js');
export const exampleBlog = join(import.meta.dirname, '../examples/blog');

const EXAMPLE_OUTPUTS = new Set(['dist', '.dist-staging', '.dist-previous', 'node_modules']);
const BUILT_SITES = join(tmpdir(), 'bake-test-sites');
const SITE_INPUTS = ['src', 'package-lock.json'].map((path) => join(import.meta.dirname, '..', path));
const DAY = 24 * 60 * 60 * 1000;

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

// why: a build takes seconds, and building the example blog about ten, so a build is kept in the temporary folder under the hash of everything it is built from and shared by every test file and every run until the code or the blog changes
export function builtExample(files = {}) {
  return cachedBuild(exampleBlog, files);
}

export function builtBlog(files) {
  return cachedBuild(null, files);
}

async function cachedBuild(base, files) {
  const hash = createHash('sha256');
  for (const input of [...SITE_INPUTS, ...(base === null ? [] : [base])]) hashTree(hash, input);
  hash.update(JSON.stringify(Object.entries(files).map(([path, content]) => [path, Buffer.isBuffer(content) ? content.toString('base64') : content])));
  const dir = join(BUILT_SITES, hash.digest('hex').slice(0, 16));
  if (existsSync(dir)) return dir;
  mkdirSync(BUILT_SITES, { recursive: true });
  for (const name of readdirSync(BUILT_SITES)) {
    if (Date.now() - statSync(join(BUILT_SITES, name)).mtimeMs > DAY) rmSync(join(BUILT_SITES, name), { recursive: true, force: true });
  }
  const staging = realpathSync(mkdtempSync(join(BUILT_SITES, 'staging-')));
  if (base !== null) copyExampleTo(staging);
  writeFiles(staging, files);
  assert.deepEqual(await build(staging), []);
  try {
    renameSync(staging, dir);
  } catch {
    // why: another test process built the same site first
    rmSync(staging, { recursive: true, force: true });
  }
  return dir;
}

function hashTree(hash, path) {
  if (statSync(path).isFile()) {
    hash.update(path);
    hash.update(readFileSync(path));
    return;
  }
  for (const name of readdirSync(path).sort()) if (!EXAMPLE_OUTPUTS.has(name)) hashTree(hash, join(path, name));
}

export async function build(dir) {
  // why: loading the build takes a second, which a test process that finds its blogs already built does not spend
  const { build: buildBlog } = await import('../src/build/build.js');
  return (await buildBlog(dir)).errors.map(formatError);
}

export function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export async function decodeImage(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export function bake(dir, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
}

export function article({ title = 'Rope', slug = 'rope', date = '2026-10-19', extra = '', body = 'Text.\n' } = {}) {
  return `---\ntitle: ${title}\nslug: ${slug}\ndate: ${date}\n${extra}---\n\n${body}`;
}

export function filler(topic, count = 4) {
  return Array.from({ length: count }, (_, index) => `Paragraph ${index + 1} about ${topic}. ${'It fills the page so that the reader has to scroll. '.repeat(6)}`).join('\n\n');
}

export function readTree(dir) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .filter((path) => statSync(join(dir, path)).isFile())
      .sort()
      .map((path) => [path, readFileSync(join(dir, path))]),
  );
}
