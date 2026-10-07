import { footnoteKey, nextFootnoteLabel } from '../footnote-labels.js';

const blockInfo = new WeakMap();

function isSpan(node) {
  return node.marks.some((mark) => mark.type.name === 'directive_span');
}

function collectSpans(textblock, start, spans) {
  let spanStart = null;
  textblock.forEach((child, offset) => {
    const pos = start + offset;
    if (isSpan(child)) {
      spanStart ??= pos;
      return;
    }
    if (spanStart !== null && child.type.name === 'footnote_reference') spans.push({ from: spanStart, to: pos, reference: pos });
    spanStart = null;
  });
}

function scanBlock(block) {
  let info = blockInfo.get(block);
  if (info) return info;
  info = { references: [], spans: [], definitions: [] };
  if (block.inlineContent) collectSpans(block, 1, info.spans);
  block.descendants((node, pos) => {
    const offset = pos + 1;
    if (node.type.name === 'footnote_definition') {
      info.definitions.push({ offset, node, key: footnoteKey(node.attrs.label) });
      return false;
    }
    if (node.type.name === 'footnote_reference') info.references.push({ offset, label: node.attrs.label, key: footnoteKey(node.attrs.label) });
    if (node.inlineContent) collectSpans(node, offset + 1, info.spans);
    return true;
  });
  blockInfo.set(block, info);
  return info;
}

export function numberSidenotes(doc) {
  const references = [];
  const definitions = [];
  const spans = [];
  doc.forEach((block, offset, index) => {
    if (block.type.name === 'footnote_definition') {
      definitions.push({ pos: offset, node: block, key: footnoteKey(block.attrs.label), index, nested: false, number: null });
      return;
    }
    const info = scanBlock(block);
    const numbers = new Map();
    for (const reference of info.references) {
      const number = references.length + 1;
      numbers.set(reference.offset, number);
      references.push({ pos: offset + reference.offset, label: reference.label, key: reference.key, index, number });
    }
    for (const span of info.spans) spans.push({ from: offset + span.from, to: offset + span.to, number: numbers.get(span.reference) });
    for (const definition of info.definitions) definitions.push({ pos: offset + definition.offset, node: definition.node, key: definition.key, index, nested: true, number: null });
  });
  const numberOfKey = new Map();
  for (const reference of references) if (!numberOfKey.has(reference.key)) numberOfKey.set(reference.key, reference.number);
  for (const definition of definitions) {
    if (definition.nested || !numberOfKey.has(definition.key)) continue;
    definition.number = numberOfKey.get(definition.key);
    numberOfKey.delete(definition.key);
  }
  return { references, definitions, spans };
}

function survivors(tr, entries, typeName) {
  const positions = new Set();
  for (const entry of entries) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    const node = tr.doc.nodeAt(result.pos);
    if (!result.deletedAfter && node?.type.name === typeName && footnoteKey(node.attrs.label) === entry.key) positions.add(result.pos);
  }
  return positions;
}

function groupByKey(entries) {
  const groups = new Map();
  for (const entry of entries) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry]);
  return groups;
}

function renameDuplicates(current, survivingReferences) {
  const used = new Set([...current.references, ...current.definitions].map((entry) => entry.key));
  const kept = new Map();
  for (const [key, group] of groupByKey(current.references)) kept.set(key, group.find((reference) => survivingReferences.has(reference.pos)) ?? group[0]);
  return current.references.map((reference) => {
    if (kept.get(reference.key) === reference) return { reference, label: reference.label, kept: true };
    const label = nextFootnoteLabel(used);
    used.add(footnoteKey(label));
    return { reference, label, kept: false };
  });
}

function assignDefinitions(doc, current, references, survivingDefinitions) {
  const { footnote_definition: definitionType, paragraph } = doc.type.schema.nodes;
  const available = new Map();
  for (const [key, group] of groupByKey(current.definitions)) {
    available.set(key, [...group.filter((definition) => survivingDefinitions.has(definition.pos)), ...group.filter((definition) => !survivingDefinitions.has(definition.pos))]);
  }
  const assigned = new Map();
  const nodeOfKey = new Map();
  const place = (entry) => {
    const source = available.get(entry.reference.key)?.shift() ?? null;
    let node;
    if (source) node = entry.kept ? source.node : definitionType.create({ ...source.node.attrs, label: entry.label }, source.node.content);
    else node = definitionType.create({ label: entry.label }, nodeOfKey.get(entry.reference.key)?.content ?? paragraph.create());
    if (entry.kept) nodeOfKey.set(entry.reference.key, node);
    assigned.set(entry, { source, node });
  };
  for (const entry of references) if (entry.kept) place(entry);
  for (const entry of references) if (!entry.kept) place(entry);
  const unassigned = [...available.values()].flat().sort((a, b) => a.pos - b.pos);
  return { assigned, unassigned };
}

function removeDefinition(tr, definition) {
  const $pos = tr.doc.resolve(definition.pos);
  if (definition.nested && $pos.parent.childCount === 1) tr.replaceWith(definition.pos, definition.pos + definition.node.nodeSize, tr.doc.type.schema.nodes.paragraph.create());
  else tr.delete(definition.pos, definition.pos + definition.node.nodeSize);
}

export function fixSidenotes(tr, oldDoc) {
  const doc = tr.doc;
  const current = numberSidenotes(doc);
  const previous = numberSidenotes(oldDoc);
  const bodyIndexes = [];
  const ends = new Map([[-1, 0]]);
  const anchors = new Map();
  doc.forEach((block, offset, index) => {
    if (block.type.name === 'footnote_definition') {
      anchors.set(index, bodyIndexes.at(-1) ?? -1);
      return;
    }
    bodyIndexes.push(index);
    ends.set(index, offset + block.nodeSize);
  });
  if (bodyIndexes.length === 0) return tr;
  const references = renameDuplicates(current, survivors(tr, previous.references, 'footnote_reference'));
  const { assigned, unassigned } = assignDefinitions(doc, current, references, survivors(tr, previous.definitions, 'footnote_definition'));
  const referencedBefore = new Set(previous.references.map((reference) => reference.key));
  const referencedNow = new Set(current.references.map((reference) => reference.key));
  const orphans = unassigned.filter((definition) => !referencedBefore.has(definition.key) || referencedNow.has(definition.key));

  const desired = new Map([-1, ...bodyIndexes].map((index) => [index, []]));
  for (const entry of references) desired.get(entry.reference.index).push(assigned.get(entry));
  const lastIsEmptyParagraph = doc.lastChild.type.name === 'paragraph' && doc.lastChild.childCount === 0;
  const orphanAnchor = lastIsEmptyParagraph ? (bodyIndexes.at(-2) ?? -1) : bodyIndexes.at(-1);
  desired.get(orphanAnchor).push(...orphans.map((definition) => ({ source: definition, node: definition.node })));

  const placed = new Map();
  for (const definition of current.definitions) {
    if (definition.nested) continue;
    const anchor = anchors.get(definition.index);
    placed.set(anchor, [...(placed.get(anchor) ?? []), definition]);
  }
  const kept = new Set();
  for (const [index, wanted] of desired) {
    const existing = placed.get(index) ?? [];
    let last = -1;
    for (const item of wanted) {
      const at = existing.indexOf(item.source);
      if (at > last && item.node === item.source.node) {
        kept.add(item);
        last = at;
      }
    }
  }
  const keptSources = new Set([...kept].map((item) => item.source));
  for (const entry of references) {
    if (entry.label !== entry.reference.label) tr.setNodeAttribute(entry.reference.pos, 'label', entry.label);
  }
  const deletionStart = tr.steps.length;
  for (const definition of [...current.definitions].reverse()) if (!keptSources.has(definition)) removeDefinition(tr, definition);
  const deletions = tr.mapping.slice(deletionStart);
  for (const index of [-1, ...bodyIndexes].reverse()) {
    let cursor = deletions.map(ends.get(index), -1);
    for (const item of desired.get(index)) {
      if (!kept.has(item)) tr.insert(cursor, item.node);
      cursor += item.node.nodeSize;
    }
  }
  return tr;
}
