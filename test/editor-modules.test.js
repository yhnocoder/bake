import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@milkdown/prose/model';
import { footnoteKey, nextFootnoteLabel } from '../src/editor/footnote-labels.js';
import { documentIds, dropDuplicateIds } from '../src/editor/ids.js';
import { checkOrder } from '../src/editor/structure.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', attrs: { blockId: { default: null } } },
    heading: { group: 'block', content: 'text*', attrs: { level: { default: 2 }, attributes: { default: null } } },
    math_block: { group: 'block', atom: true, attrs: { value: { default: '' } } },
    directive_subtitle: { group: 'block', content: 'text*', attrs: { attributes: { default: {} } } },
    text: {},
  },
});

const { doc, paragraph, heading, math_block: math, directive_subtitle: subtitle } = schema.nodes;
const text = (value) => schema.text(value);

test('footnoteKey 与 mdast 的 identifier 相同，大小写不同视为同名', () => {
  assert.equal(footnoteKey('D'), 'd');
  assert.equal(footnoteKey(' Two  words '), 'two words');
});

test('nextFootnoteLabel 跳过已用的名字', () => {
  assert.equal(nextFootnoteLabel(new Set()), 'n1');
  assert.equal(nextFootnoteLabel(new Set(['n1', 'n2'])), 'n3');
  assert.equal(nextFootnoteLabel(new Set([footnoteKey('N1')])), 'n2');
});

const page = doc.create(null, [
  heading.create({ attributes: { id: 'intro', class: 'wide' } }, text('标题')),
  paragraph.create({ blockId: 'claim' }, text('段落')),
  math.create({ value: 'a \\label{eq:a} \\\\ b \\label{eq:b}' }),
]);

test('documentIds 收集标题 id、段落 blockId 和公式的全部 label', () => {
  assert.deepEqual([...documentIds(page)].sort(), ['claim', 'eq-a', 'eq-b', 'intro']);
});

test('dropDuplicateIds 去掉重复的 id，保留不重复的 id', () => {
  const pasted = doc.create(null, [
    heading.create({ attributes: { id: 'intro', class: 'wide' } }, text('标题')),
    heading.create({ attributes: { id: 'intro' } }, text('标题')),
    heading.create({ attributes: { id: 'other' } }, text('标题')),
    paragraph.create({ blockId: 'claim' }, text('段落')),
    paragraph.create({ blockId: 'fresh' }, text('段落')),
    math.create({ value: 'c \\label{eq:a} \\\\ d \\label{eq:c}' }),
  ]);
  const result = dropDuplicateIds(pasted.content, documentIds(page));
  const nodes = [];
  result.forEach((node) => nodes.push({ ...node.attrs }));
  assert.deepEqual(nodes, [
    { level: 2, attributes: { class: 'wide' } },
    { level: 2, attributes: null },
    { level: 2, attributes: { id: 'other' } },
    { blockId: null },
    { blockId: 'fresh' },
    { value: 'c  \\\\ d \\label{eq:c}' },
  ]);
  assert.equal(result.child(0).textContent, '标题');
});

test('dropDuplicateIds 去掉独占一行的 \\label 时同时去掉这一行', () => {
  const pasted = doc.create(null, [math.create({ value: '\\label{eq:a}\ny = x \\label{eq:c}' })]);
  assert.equal(dropDuplicateIds(pasted.content, documentIds(page)).child(0).attrs.value, 'y = x \\label{eq:c}');
});

test('checkOrder 要求副标题紧跟标题', () => {
  assert.equal(checkOrder(doc.create(null, [heading.create(null, text('标题')), subtitle.create(null, text('副标题'))])), true);
  assert.equal(checkOrder(doc.create(null, [paragraph.create(null, text('段落')), subtitle.create(null, text('副标题'))])), false);
  assert.equal(checkOrder(doc.create(null, [subtitle.create(null, text('副标题'))])), false);
  assert.equal(checkOrder(doc.create(null, [paragraph.create(null, text('段落'))])), true);
});
