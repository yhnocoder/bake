import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { bake, createBlog, validConfig } from './blog.js';

function localDate(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe('bake new', () => {
  test('creates a draft index.md dated today and prints its URL', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const before = localDate(new Date());
    const result = bake(dir, 'new', '2026-10/rope');
    const after = localDate(new Date());
    const content = readFileSync(join(dir, 'content/posts/2026-10/rope/index.md'), 'utf8');
    const date = /^date: (.+)$/m.exec(content)[1];
    assert.ok([before, after].includes(date), date);
    assert.equal(content, `---\ntitle: rope\nslug: rope\ndate: ${date}\ndraft: true\n---\n\n`);
    assert.equal(result.stdout, `Created content/posts/2026-10/rope/index.md (URL: /${date.slice(0, 7)}/rope/)\n`);
    assert.equal(result.status, 0);
  });

  test('creates an article that bake build accepts as a draft', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    assert.equal(bake(dir, 'new', 'llm/rope').status, 0);
    const result = bake(dir, 'build');
    assert.equal(result.stdout, '0 pages\ndist/ written\n');
    assert.equal(result.stderr, '');
  });

  test('reports an existing index.md and leaves it unchanged', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/2026-10/rope/index.md': 'mine\n' });
    const result = bake(dir, 'new', '2026-10/rope');
    assert.equal(result.stderr, 'content/posts/2026-10/rope/index.md:1:1 already exists\n');
    assert.equal(result.status, 1);
    assert.equal(readFileSync(join(dir, 'content/posts/2026-10/rope/index.md'), 'utf8'), 'mine\n');
  });

  test('reports a last folder name that is not a valid slug', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const result = bake(dir, 'new', '2026-10/Rope_Scaling');
    assert.equal(result.stderr, 'bake new: slug "Rope_Scaling" may only contain lowercase letters, digits and "-"; the slug is the last folder name of the path\n');
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(dir, 'content')), false);
  });

  test('reports a path that leaves content/posts/', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const result = bake(dir, 'new', '../rope');
    assert.equal(result.stderr, 'bake new: the path must be relative to content/posts/ and stay inside it, got "../rope"\n');
    assert.equal(result.status, 1);
  });

  test('prints its usage without a path', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const result = bake(dir, 'new');
    assert.equal(result.stderr, 'Usage: bake new <path>\n');
    assert.equal(result.status, 1);
  });

  test('requires bake.config.js in the current folder', (t) => {
    const dir = createBlog(t, {});
    const result = bake(dir, 'new', '2026-10/rope');
    assert.equal(result.stderr, 'bake.config.js:1:1 bake.config.js not found, run bake from the blog root or create a blog with bake init\n');
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(dir, 'content')), false);
  });
  for (const slug of ['2026', 'true', 'null', '1e3']) {
    test(`writes the slug ${slug} so that bake build reads it as text`, (t) => {
      const dir = createBlog(t, { 'bake.config.js': validConfig });
      assert.equal(bake(dir, 'new', `notes/${slug}`).status, 0);
      const result = bake(dir, 'build');
      assert.equal(result.stderr, '');
      assert.equal(result.status, 0);
    });
  }
});
