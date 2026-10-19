import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const cli = join(import.meta.dirname, '../src/cli.js');

export const validConfig = "export default { title: 'Test Blog', url: 'https://example.com', language: 'en' };\n";

export function createBlog(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-blog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, files);
  return dir;
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
