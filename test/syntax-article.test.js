import assert from 'node:assert/strict';
import { cpSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bake, copyExample, writeFiles } from './blog.js';

const articlePath = new URL('../examples/blog/content/posts/syntax/index.md', import.meta.url);
const fixturesDir = new URL('./fixtures/syntax-errors/', import.meta.url);
const article = readFileSync(articlePath, 'utf8');

function fencedBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let open = null;
  lines.forEach((line, index) => {
    if (open) {
      if (new RegExp(`^${open.fence}\`*\\s*$`).test(line)) {
        blocks.push({ lang: open.lang, start: open.start, end: index, body: lines.slice(open.start + 1, index).join('\n') });
        open = null;
      }
      return;
    }
    const match = /^(`{3,})(\S*)/.exec(line);
    if (match) open = { fence: match[1], lang: match[2], start: index };
  });
  assert.equal(open, null, 'every code fence in the syntax article is closed');
  return { lines, blocks };
}

function exampleBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  lines.forEach((line, index) => {
    const match = /^(:{3,})example$/.exec(line);
    if (!match) return;
    const close = lines.findIndex((other, i) => i > index && other === match[1]);
    blocks.push({ start: index, close });
  });
  return blocks;
}

function appendixMessages(text) {
  const appendix = text.slice(text.indexOf('{#errors}'));
  return appendix
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| 写错的地方'))
    .map((line) => line.split(' | ').at(-1).replace(/ \|$/, '').replace(/^`|`$/g, ''));
}

test('the front matter shown in the syntax article is its own front matter', () => {
  const frontMatter = /^---\n[\s\S]*?\n---$/m.exec(article)[0];
  const shown = fencedBlocks(article).blocks.find((b) => b.lang === 'markdown' && b.body.startsWith('---'));
  assert.equal(shown.body, frontMatter);
});

test('every example block in the syntax article is closed by the same number of colons', () => {
  const blocks = exampleBlocks(article);
  assert.ok(blocks.length >= 30);
  assert.deepEqual(blocks.filter((b) => b.close === -1).map((b) => `line ${b.start + 1}`), []);
});

test('syntax error appendix matches the error fixtures', () => {
  const expected = JSON.parse(readFileSync(new URL('expected.json', fixturesDir), 'utf8'));
  const fixtureFiles = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(Object.keys(expected).sort(), fixtureFiles);
  const fixtureMessages = Object.values(expected).map((line) => line.replace(/^\S+:\d+:\d+ /, '')).sort();
  assert.deepEqual(appendixMessages(article).sort(), fixtureMessages);
});

test('bake build reports every syntax error fixture at the position in expected.json', (t) => {
  const expected = JSON.parse(readFileSync(new URL('expected.json', fixturesDir), 'utf8'));
  const fixtures = fileURLToPath(fixturesDir);
  const dir = copyExample(t);
  const articles = Object.keys(expected).filter((name) => name.endsWith('.md'));
  for (const name of articles) {
    const folder = `content/posts/fixtures/${name.replace('.md', '')}`;
    writeFiles(dir, { [`${folder}/index.md`]: readFileSync(join(fixtures, name), 'utf8') });
    cpSync(join(fixtures, 'relu.svg'), join(dir, folder, 'relu.svg'));
  }
  cpSync(join(fixtures, 'component-browser-api'), dir, { recursive: true });
  const result = bake(dir, 'build');
  const lines = result.stderr.trimEnd().split('\n');
  assert.equal(lines.pop(), `${Object.keys(expected).length} errors, dist/ was not written`);
  assert.deepEqual(lines.map((line) => line.replace(/^content\/posts\/fixtures\/([\w-]+)\/index\.md/, '$1.md')).sort(), Object.values(expected).sort());
});
