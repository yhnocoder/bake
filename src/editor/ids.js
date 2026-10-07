import { Fragment } from '@milkdown/prose/model';
import { equationId, labelNames, labelPattern } from '../render/equation-labels.js';

function collectIds(doc, equationIds) {
  const ids = new Set();
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.attributes?.id) ids.add(node.attrs.attributes.id);
    if (node.type.name === 'paragraph' && node.attrs.blockId) ids.add(node.attrs.blockId);
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

function dropFromNode(node, ids) {
  if (node.isText) return node;
  let attrs = node.attrs;
  if (node.type.name === 'heading' && ids.has(attrs.attributes?.id)) attrs = { ...attrs, attributes: withoutId(attrs.attributes) };
  if (node.type.name === 'paragraph' && ids.has(attrs.blockId)) attrs = { ...attrs, blockId: null };
  if (node.type.name === 'math_block') attrs = { ...attrs, value: withoutLabels(attrs.value, ids) };
  return node.type.create(attrs, dropDuplicateIds(node.content, ids), node.marks);
}

export function dropDuplicateIds(fragment, ids) {
  const nodes = [];
  fragment.forEach((node) => nodes.push(dropFromNode(node, ids)));
  return Fragment.from(nodes);
}
