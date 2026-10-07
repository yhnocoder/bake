import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { toMarkdown } from 'mdast-util-to-markdown';
import { placeFootnoteDefinitions } from '../../src/format/footnotes.js';
import { parse, stringify } from '../../src/format/index.js';
import { markdownOptions, toMarkdownExtensions } from '../../src/format/to-markdown.js';

const root = join(import.meta.dirname, '..', '..');

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

describe('toMarkdownExtensions 的输出与 stringify 相同', () => {
  const files = markdownFiles(join(root, 'examples'));

  test('examples 下至少有一个文件', () => {
    assert.ok(files.length > 0);
  });

  for (const file of files) {
    test(file.slice(root.length + 1), () => {
      const { tree } = parse(readFileSync(file, 'utf8'));
      tree.children = tree.children.filter((node) => node.type !== 'yaml');
      const placed = structuredClone(tree);
      placeFootnoteDefinitions(placed);
      assert.equal(toMarkdown(placed, { ...markdownOptions, extensions: toMarkdownExtensions }), stringify(tree));
    });
  }
});

test('raw 节点原样输出', () => {
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'raw', value: ':span[*文字*]' }, { type: 'text', value: '之后*' }] }, { type: 'raw', value: ':::callout{kind=note}\n内容。\n:::' }] };
  assert.equal(toMarkdown(tree, { ...markdownOptions, extensions: toMarkdownExtensions }), ':span[*文字*]之后\\*\n\n:::callout{kind=note}\n内容。\n:::\n');
});
