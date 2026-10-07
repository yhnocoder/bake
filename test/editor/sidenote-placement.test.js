import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Schema } from '@milkdown/prose/model';
import { EditorState } from '@milkdown/prose/state';
import { Transform } from '@milkdown/prose/transform';
import { fixSidenotes, numberSidenotes } from '../../src/editor/sidenotes/placement.js';
import { trailingParagraphTransaction } from '../../src/editor/trailing-paragraph.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    text: { group: 'inline' },
    footnote_reference: { group: 'inline', inline: true, atom: true, attrs: { label: { default: '' } } },
    footnote_definition: { group: 'block', content: 'block+', attrs: { label: { default: '' } } },
  },
  marks: { directive_span: {} },
});

const { doc, paragraph, blockquote } = Object.fromEntries(Object.entries(schema.nodes).map(([name, type]) => [name, (...content) => type.create(null, content)]));
const text = (value) => schema.text(value);
const ref = (label) => schema.nodes.footnote_reference.create({ label });
const def = (label, ...content) => schema.nodes.footnote_definition.create({ label }, content.length > 0 ? content : [paragraph(text(`注释 ${label}`))]);

function describeDoc(node) {
  const parts = [];
  node.forEach((child) => {
    if (child.type.name === 'footnote_definition') parts.push(`[^${child.attrs.label}]: ${child.textContent}`);
    else if (child.type.name === 'blockquote') parts.push(`> ${describeDoc(child).join(' | ')}`);
    else {
      let line = '';
      child.forEach((inline) => {
        line += inline.isText ? inline.text : `[^${inline.attrs.label}]`;
      });
      parts.push(line);
    }
  });
  return parts;
}

function fix(oldDoc, change) {
  const tr = new Transform(oldDoc);
  change?.(tr);
  const count = tr.steps.length;
  fixSidenotes(tr, oldDoc);
  return { tr, added: tr.steps.slice(count), result: describeDoc(tr.doc) };
}

function topLevelPos(node, index) {
  let pos = 0;
  for (let child = 0; child < index; child++) pos += node.child(child).nodeSize;
  return pos;
}

describe('fixSidenotes', () => {
  test('规则已经满足时不追加步骤', () => {
    const start = doc(paragraph(text('甲'), ref('a'), text('乙'), ref('b')), def('a'), def('b'), paragraph(text('丙')));
    const { added } = fix(start, (tr) => tr.insert(2, text('丁')));
    assert.equal(added.length, 0);
  });

  test('引用所在的段落移动后，注释移到段落之后，正文块是同一个对象', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const second = start.child(2);
    const { result, tr } = fix(start, (tr) => {
      const moved = start.child(0);
      tr.insert(start.content.size, moved);
      tr.delete(0, moved.nodeSize);
    });
    assert.deepEqual(result, ['乙', '甲[^a]', '[^a]: 注释 a']);
    assert.equal(tr.doc.child(0), second);
    assert.equal(tr.doc.child(1).type.name, 'paragraph');
  });

  test('在段落和注释之间按 Enter 产生的新段落移到注释之后，新段落是同一个对象', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const { result, tr, added } = fix(start, (tr) => tr.insert(start.child(0).nodeSize, paragraph(text('新'))));
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注释 a', '新', '乙']);
    assert.equal(tr.doc.child(0), start.child(0));
    assert.equal(tr.doc.child(3), start.child(2));
    assert.equal(added.every((step) => step.slice.content.childCount <= 1), true);
  });

  test('粘贴的内容带有注释时把注释移到引用所在的块之后', () => {
    const start = doc(paragraph(text('甲')), paragraph(text('乙')));
    const { result } = fix(start, (tr) => {
      tr.insert(topLevelPos(start, 1) + 2, ref('a'));
      tr.insert(topLevelPos(start, 1), def('a'));
    });
    assert.deepEqual(result, ['甲', '乙[^a]', '[^a]: 注释 a']);
  });

  test('删除编号时删除注释', () => {
    const start = doc(paragraph(text('甲'), ref('a'), text('乙')), def('a'), paragraph(text('丙')));
    const { result } = fix(start, (tr) => tr.delete(2, 3));
    assert.deepEqual(result, ['甲乙', '丙']);
  });

  test('删除带编号的块时删除注释', () => {
    const start = doc(paragraph(text('甲')), paragraph(text('乙'), ref('a')), def('a'), paragraph(text('丙')));
    const from = start.child(0).nodeSize;
    const { result } = fix(start, (tr) => tr.delete(from, from + start.child(1).nodeSize));
    assert.deepEqual(result, ['甲', '丙']);
  });

  test('引用没有注释时插入一条空注释', () => {
    const start = doc(paragraph(text('甲')), paragraph(text('乙')));
    const { result, tr } = fix(start, (tr) => tr.insert(2, ref('n1')));
    assert.deepEqual(result, ['甲[^n1]', '[^n1]: ', '乙']);
    assert.equal(tr.doc.child(1).childCount, 1);
    assert.equal(tr.doc.child(1).firstChild.content.size, 0);
  });

  test('同一个块的多条注释按引用顺序排列', () => {
    const start = doc(paragraph(text('甲'), ref('a'), text('乙'), ref('b')), def('b'), def('a'));
    const { result } = fix(start);
    assert.deepEqual(result, ['甲[^a]乙[^b]', '[^a]: 注释 a', '[^b]: 注释 b']);
  });

  test('复制粘贴带注释的段落后，新引用和它的注释改用新名字', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const end = start.content.size;
    const { result } = fix(start, (tr) => tr.insert(end, [paragraph(text('甲'), ref('a')), def('a', paragraph(text('复制的注释')))]));
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注释 a', '乙', '甲[^n1]', '[^n1]: 复制的注释']);
  });

  test('新引用出现在已有引用之前时，已有的引用保留名字', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const { result } = fix(start, (tr) => tr.insert(0, [paragraph(text('复制'), ref('a')), def('a', paragraph(text('复制的注释')))]));
    assert.deepEqual(result, ['复制[^n1]', '[^n1]: 复制的注释', '甲[^a]', '[^a]: 注释 a', '乙']);
  });

  test('重名而没有多余的注释时复制已有注释的内容', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const pos = topLevelPos(start, 2) + 2;
    const { result } = fix(start, (tr) => tr.insert(pos, ref('a')));
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注释 a', '乙[^n1]', '[^n1]: 注释 a']);
  });

  test('新名字跳过文档中已经使用的名字', () => {
    const start = doc(paragraph(text('甲'), ref('a'), ref('n1')), def('a'), def('n1'));
    const { result } = fix(start, (tr) => tr.insert(start.content.size, paragraph(ref('a'))));
    assert.deepEqual(result, ['甲[^a][^n1]', '[^a]: 注释 a', '[^n1]: 注释 n1', '[^n2]', '[^n2]: 注释 a']);
  });

  test('嵌套在其他块里的注释移到顶层', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a'), paragraph(text('乙')));
    const defEnd = topLevelPos(start, 2);
    const { result } = fix(start, (tr) => {
      tr.delete(start.child(0).nodeSize, defEnd);
      tr.insert(tr.doc.content.size, blockquote(paragraph(text('引')), def('a')));
    });
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注释 a', '乙', '> 引']);
  });

  test('只含注释的嵌套块留下一个空段落', () => {
    const start = doc(paragraph(text('甲'), ref('a')), paragraph(text('乙')));
    const { result } = fix(start, (tr) => tr.insert(tr.doc.content.size, blockquote(def('a'))));
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注释 a', '乙', '> ']);
  });

  test('引用在嵌套块里时注释放在整个顶层块之后', () => {
    const start = doc(blockquote(paragraph(text('甲'))), paragraph(text('乙')));
    const { result } = fix(start, (tr) => tr.insert(3, ref('a')));
    assert.deepEqual(result, ['> 甲[^a]', '[^a]: ', '乙']);
  });

  test('文件里本来就没有被引用的注释保留在文末', () => {
    const start = doc(paragraph(text('甲')), def('x'), paragraph(text('乙')));
    const { result } = fix(start, (tr) => tr.insert(2, text('丙')));
    assert.deepEqual(result, ['甲丙', '乙', '[^x]: 注释 x']);
    const { added } = fix(doc(paragraph(text('甲')), paragraph(text('乙')), def('x')), (tr) => tr.insert(2, text('丙')));
    assert.equal(added.length, 0);
  });

  test('没有被引用的注释放在文末的空段落之前', () => {
    const start = doc(paragraph(text('甲')), def('x'), paragraph(text('乙')), paragraph());
    const { result } = fix(start, (tr) => tr.insert(2, text('丙')));
    assert.deepEqual(result, ['甲丙', '乙', '[^x]: 注释 x', '']);
    const { added } = fix(doc(paragraph(text('甲')), def('x'), paragraph()), (tr) => tr.insert(2, text('丙')));
    assert.equal(added.length, 0);
  });

  test('与文末补空段落的规则交替运行时一轮后不再修改文档', () => {
    const starts = [
      doc(paragraph(text('甲'), ref('a')), def('a')),
      doc(paragraph(text('甲')), def('x')),
      doc(paragraph(text('甲'), ref('a')), def('a'), def('x')),
      doc(paragraph(text('甲')), paragraph(), def('x')),
    ];
    for (const start of starts) {
      let current = start;
      const rounds = [];
      for (let round = 0; round < 3; round++) {
        const trailing = trailingParagraphTransaction(EditorState.create({ doc: current }));
        const tr = new Transform(trailing?.doc ?? current);
        fixSidenotes(tr, current);
        rounds.push(Boolean(trailing) || tr.steps.length > 0);
        current = tr.doc;
      }
      assert.deepEqual(rounds.slice(1), [false, false], describeDoc(start).join(' / '));
      assert.equal(current.lastChild.type.name, 'paragraph');
    }
  });

  test('注释里的引用不参与修正', () => {
    const start = doc(paragraph(text('甲'), ref('a')), def('a', paragraph(text('注'))), paragraph(text('乙')));
    const { result, added } = fix(start, (tr) => tr.insert(topLevelPos(start, 1) + 3, ref('b')));
    assert.equal(added.length, 0);
    assert.deepEqual(result, ['甲[^a]', '[^a]: 注', '乙']);
  });

  test('名字按比较值配对', () => {
    const start = doc(paragraph(text('甲'), ref('Note')), def('note'));
    const { added } = fix(start, (tr) => tr.insert(1, text('乙')));
    assert.equal(added.length, 0);
  });
});

describe('numberSidenotes', () => {
  test('按正文中引用出现的顺序编号，注释里的引用和没有被引用的注释不编号', () => {
    const start = doc(paragraph(text('甲'), ref('b')), def('b', paragraph(text('注'), ref('c'))), blockquote(paragraph(ref('a'))), def('a'), def('x'));
    const { references, definitions } = numberSidenotes(start);
    assert.deepEqual(references.map(({ label, number }) => [label, number]), [['b', 1], ['a', 2]]);
    assert.deepEqual(definitions.map(({ key, number }) => [key, number]), [['b', 1], ['a', 2], ['x', null]]);
  });

  test(':span 的范围使用紧跟在它后面的引用的编号', () => {
    const span = schema.marks.directive_span.create();
    const start = doc(paragraph(schema.text('甲', [span]), ref('a')), def('a'), blockquote(paragraph(schema.text('乙丙', [span]), ref('b'), schema.text('丁', [span]))), def('b'));
    const quote = start.child(0).nodeSize + start.child(1).nodeSize;
    assert.deepEqual(numberSidenotes(start).spans, [
      { from: 1, to: 2, number: 1 },
      { from: quote + 2, to: quote + 4, number: 2 },
    ]);
  });
});
