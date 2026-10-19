import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

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

function textWithoutMarkdownSources(text) {
  const { lines, blocks } = fencedBlocks(text);
  const removed = new Set();
  for (const block of blocks.filter((b) => b.lang === 'markdown')) {
    for (let i = block.start; i <= block.end; i++) removed.add(i);
  }
  return lines.filter((_, i) => !removed.has(i)).join('\n');
}

function appendixMessages(text) {
  const appendix = text.slice(text.indexOf('{#errors}'));
  return appendix
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| 写错的地方'))
    .map((line) => line.split(' | ').at(-1).replace(/ \|$/, '').replace(/^`|`$/g, ''));
}

test('every markdown source block in the syntax article is followed by the same text rendered live', () => {
  const live = textWithoutMarkdownSources(article);
  const sources = fencedBlocks(article).blocks.filter((b) => b.lang === 'markdown');
  assert.ok(sources.length >= 30);
  const missing = sources.filter((b) => !live.includes(b.body)).map((b) => `line ${b.start + 1}`);
  assert.deepEqual(missing, []);
});

test('syntax error appendix matches the error fixtures', () => {
  const expected = JSON.parse(readFileSync(new URL('expected.json', fixturesDir), 'utf8'));
  const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith('.md')).sort();
  assert.deepEqual(Object.keys(expected).sort(), fixtureFiles);
  const fixtureMessages = Object.values(expected).map((line) => line.replace(/^\S+:\d+:\d+ /, '')).sort();
  assert.deepEqual(appendixMessages(article).sort(), fixtureMessages);
});
