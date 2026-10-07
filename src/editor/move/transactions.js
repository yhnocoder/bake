import { closeHistory } from '@milkdown/prose/history';
import { Slice } from '@milkdown/prose/model';
import { Selection } from '@milkdown/prose/state';
import { ReplaceStep } from '@milkdown/prose/transform';
import { documentIds, dropDuplicateIds } from '../ids.js';
import { checkOrder } from '../structure.js';

const fixedTypes = new Set(['directive_label', 'directive_subtitle', 'directive_source', 'directive_lede', 'footnote_definition']);
const skippedSiblings = new Set(['footnote_definition', 'directive_label', 'directive_source']);

function insideTableOrNote($pos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const ancestor = $pos.node(depth);
    if (ancestor.type.spec.tableRole || ancestor.type.name === 'footnote_definition') return true;
  }
  return false;
}

export function blockPositions(doc, inside, pos) {
  const positions = inside >= 0 && doc.nodeAt(inside)?.isBlock ? [inside] : [];
  const $pos = doc.resolve(inside >= 0 ? inside : pos);
  for (let depth = $pos.depth; depth > 0; depth--) positions.push($pos.before(depth));
  return positions;
}

export function isDropBlock(doc, pos) {
  const node = doc.nodeAt(pos);
  return Boolean(node?.isBlock) && !insideTableOrNote(doc.resolve(pos));
}

export function isDraggable(doc, pos) {
  const node = doc.nodeAt(pos);
  if (!node?.isBlock || fixedTypes.has(node.type.name)) return false;
  const $pos = doc.resolve(pos);
  if (insideTableOrNote($pos)) return false;
  const index = $pos.index();
  return $pos.parent.canReplace(index, index + 1);
}

export function draggableBlocks(doc, inside, pos) {
  return blockPositions(doc, inside, pos).filter((position) => isDraggable(doc, position));
}

export function unitAt(state, pos) {
  const node = state.doc.nodeAt(pos);
  let to = pos + node.nodeSize;
  const next = state.doc.resolve(to).nodeAfter;
  if (node.type.name === 'heading' && next?.type.name === 'directive_subtitle') to += next.nodeSize;
  return { from: pos, to };
}

function finish(tr, cursor) {
  tr.setSelection(Selection.near(tr.doc.resolve(cursor), 1));
  return closeHistory(tr.scrollIntoView());
}

function ordered(doc, pos) {
  return checkOrder(doc.resolve(pos).parent);
}

export function planMove(state, unit, target) {
  if (target >= unit.from && target <= unit.to) return null;
  const tr = state.tr;
  if (tr.maybeStep(new ReplaceStep(unit.from, unit.to, Slice.empty)).failed) return null;
  const at = tr.mapping.map(target);
  if (tr.maybeStep(new ReplaceStep(at, at, state.doc.slice(unit.from, unit.to))).failed) return null;
  const source = tr.mapping.slice(1).map(unit.from);
  if (!ordered(tr.doc, source) || !ordered(tr.doc, at)) return null;
  return finish(tr, at);
}

export function planDelete(state, unit) {
  const tr = state.tr;
  if (tr.maybeStep(new ReplaceStep(unit.from, unit.to, Slice.empty)).failed) return null;
  if (!ordered(tr.doc, unit.from)) return null;
  return finish(tr, unit.from);
}

export function planCopy(state, unit) {
  const content = dropDuplicateIds(state.doc.slice(unit.from, unit.to).content, documentIds(state.doc));
  const tr = state.tr;
  if (tr.maybeStep(new ReplaceStep(unit.to, unit.to, new Slice(content, 0, 0))).failed) return null;
  if (!ordered(tr.doc, unit.to)) return null;
  return finish(tr, unit.to);
}

function siblingUnit(state, $pos, index, direction) {
  const parent = $pos.parent;
  const start = $pos.start();
  const offsetOf = (childIndex) => {
    let offset = start;
    for (let child = 0; child < childIndex; child++) offset += parent.child(child).nodeSize;
    return offset;
  };
  let child = index;
  while (child >= 0 && child < parent.childCount && skippedSiblings.has(parent.child(child).type.name)) child += direction;
  if (child < 0 || child >= parent.childCount) return null;
  if (direction < 0 && parent.child(child).type.name === 'directive_subtitle' && child > 0 && parent.child(child - 1).type.name === 'heading') child -= 1;
  return unitAt(state, offsetOf(child));
}

export function planStep(state, unit, direction) {
  const $from = state.doc.resolve(unit.from);
  const $to = state.doc.resolve(unit.to);
  const neighbour = direction < 0 ? siblingUnit(state, $from, $from.index() - 1, -1) : siblingUnit(state, $to, $to.index(), 1);
  let target;
  if (neighbour) {
    if (direction < 0) target = neighbour.from;
    else {
      const $after = state.doc.resolve(neighbour.to);
      let end = neighbour.to;
      for (let child = $after.index(); child < $after.parent.childCount && $after.parent.child(child).type.name === 'footnote_definition'; child++) end += $after.parent.child(child).nodeSize;
      target = end;
    }
  } else {
    if ($from.depth === 0) return null;
    target = direction < 0 ? $from.before() : $from.after();
  }
  return planMove(state, unit, target);
}
