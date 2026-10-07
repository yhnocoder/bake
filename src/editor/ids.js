import { Fragment } from '@milkdown/prose/model';
import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { equationId, labelNames, labelPattern } from '../render/equation-labels.js';

function collectIds(doc, equationIds) {
  const ids = new Set();
  doc.descendants((node) => {
    if (blockId(node)) ids.add(blockId(node));
    if (node.type.name === 'math_block') for (const id of equationIds(node.attrs.value)) ids.add(id);
  });
  return ids;
}

export function documentIds(doc) {
  return collectIds(doc, (tex) => labelNames(tex).map(equationId));
}

export function renderedIds(doc) {
  return collectIds(doc, (tex) => labelNames(tex).slice(0, 1).map(equationId));
}

function withoutId(attributes) {
  const { id, ...rest } = attributes;
  return Object.keys(rest).length > 0 ? rest : null;
}

const labelLine = new RegExp(String.raw`^[ \t]*${labelPattern.source}[ \t]*\n`, 'gm');

function withoutLabels(tex, ids) {
  const drop = (label, name) => (ids.has(equationId(name)) ? '' : label);
  return tex.replace(labelLine, drop).replace(labelPattern, drop);
}

function blockId(node) {
  if (node.type.name === 'paragraph') return node.attrs.blockId;
  if (node.type.name === 'heading') return node.attrs.attributes?.id ?? null;
  return null;
}

function attrsWithoutId(node) {
  if (node.type.name === 'paragraph') return { ...node.attrs, blockId: null };
  return { ...node.attrs, attributes: withoutId(node.attrs.attributes) };
}

function dropFromNode(node, ids) {
  if (node.isText) return node;
  let attrs = ids.has(blockId(node)) ? attrsWithoutId(node) : node.attrs;
  if (node.type.name === 'math_block') attrs = { ...attrs, value: withoutLabels(attrs.value, ids) };
  return node.type.create(attrs, dropDuplicateIds(node.content, ids), node.marks);
}

export function dropDuplicateIds(fragment, ids) {
  const nodes = [];
  fragment.forEach((node) => nodes.push(dropFromNode(node, ids)));
  return Fragment.from(nodes);
}

function changedRanges(transactions) {
  let ranges = [];
  for (const tr of transactions) {
    for (const map of tr.mapping.maps) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
      map.forEach((_oldStart, _oldEnd, from, to) => ranges.push([from, to]));
    }
  }
  return ranges;
}

export const emptyBlocksDropIds = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, _, state) => {
        const tr = state.tr;
        const size = state.doc.content.size;
        for (const [from, to] of changedRanges(transactions)) {
          state.doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
            if (node.content.size === 0 && blockId(node)) tr.setNodeMarkup(pos, undefined, attrsWithoutId(node));
          });
        }
        return tr.docChanged ? tr : null;
      },
    }),
);
