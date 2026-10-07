import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { applyBlockTransaction } from './apply.js';
import { blockElement, blockRect } from './geometry.js';
import { blockPositions, isDropBlock, planMove, unitAt } from './transactions.js';

const dragKey = new PluginKey('bake-block-drag');
const drags = new WeakMap();
const lineThickness = 2;

function flowsHorizontally(element) {
  const style = getComputedStyle(element);
  if (style.display === 'grid' || style.display === 'inline-grid') return true;
  return (style.display === 'flex' || style.display === 'inline-flex') && style.flexDirection.startsWith('row');
}

function dropUnit(state, pos) {
  const node = state.doc.nodeAt(pos);
  const $pos = state.doc.resolve(pos);
  if (node.type.name === 'directive_subtitle' && $pos.nodeBefore?.type.name === 'heading') return unitAt(state, pos - $pos.nodeBefore.nodeSize);
  return unitAt(state, pos);
}

function candidateAt(view, unit, event) {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const { state } = view;
  const pointer = found.inside >= 0 ? found.inside : found.pos;
  if (pointer > unit.from && pointer < unit.to) return null;
  if (found.inside === unit.from) return null;
  for (const pos of blockPositions(state.doc, found.inside, found.pos)) {
    if (!isDropBlock(state.doc, pos)) continue;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof Element) || !dom.parentElement) continue;
    const block = dropUnit(state, pos);
    const horizontal = flowsHorizontally(dom.parentElement);
    const rect = blockRect(dom);
    const after = horizontal ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
    const target = after ? block.to : block.from;
    if (planMove(state, unit, target)) return { target, block: block.from, horizontal, after };
  }
  return null;
}

function contentBox(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const left = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const right = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
  const top = rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
  const bottom = rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
  return { left, right, top, bottom };
}

function visibleSibling(view, $target, direction) {
  const parent = $target.parent;
  let pos = $target.pos;
  for (let index = $target.index() + (direction < 0 ? -1 : 0); index >= 0 && index < parent.childCount; index += direction) {
    const child = parent.child(index);
    if (direction < 0) pos -= child.nodeSize;
    if (child.type.name !== 'footnote_definition') return view.nodeDOM(pos);
    if (direction > 0) pos += child.nodeSize;
  }
  return null;
}

export function dropLine(view, candidate) {
  if (candidate.horizontal) {
    const dom = view.nodeDOM(candidate.block);
    const rect = blockRect(dom);
    const gap = parseFloat(getComputedStyle(dom.parentElement).columnGap) || 0;
    const x = candidate.after ? rect.right + gap / 2 : rect.left - gap / 2;
    return { left: x - lineThickness / 2, top: rect.top, width: lineThickness, height: rect.height };
  }
  const $target = view.state.doc.resolve(candidate.target);
  const before = visibleSibling(view, $target, -1);
  const after = visibleSibling(view, $target, 1);
  const box = contentBox((before ?? after).parentElement);
  const above = before ? blockRect(before).bottom : box.top;
  const below = after ? blockRect(after).top : box.bottom;
  return { left: box.left, top: (above + below) / 2 - lineThickness / 2, width: box.right - box.left, height: lineThickness };
}

function lineElement(view) {
  const drag = drags.get(view);
  if (!drag.line) {
    drag.line = document.createElement('div');
    drag.line.className = 'bake-drop-line';
    document.body.append(drag.line);
  }
  return drag.line;
}

function showCandidate(view, candidate) {
  const drag = drags.get(view);
  if (drag.candidate?.target === candidate?.target && drag.candidate?.horizontal === candidate?.horizontal) return;
  drag.candidate = candidate;
  const line = lineElement(view);
  line.hidden = candidate === null;
  if (candidate === null) return;
  const { left, top, width, height } = dropLine(view, candidate);
  line.dataset.direction = candidate.horizontal ? 'vertical' : 'horizontal';
  Object.assign(line.style, { left: `${left + scrollX}px`, top: `${top + scrollY}px`, width: `${width}px`, height: `${height}px` });
}

export function isDragging(view) {
  return drags.has(view);
}

function discardDrag(view) {
  const drag = drags.get(view);
  if (!drag) return;
  drags.delete(view);
  clearTimeout(drag.timer);
  drag.line?.remove();
  document.removeEventListener('dragleave', drag.onLeave);
  view.dragging = null;
}

export function endDrag(view) {
  discardDrag(view);
  if (dragKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(dragKey, null));
}

export function startDrag(view, pos, event) {
  endDrag(view);
  const unit = unitAt(view.state, pos);
  const slice = view.state.doc.slice(unit.from, unit.to);
  const { dom, text } = view.serializeForClipboard(slice);
  event.dataTransfer.clearData();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/html', dom.innerHTML);
  event.dataTransfer.setData('text/plain', text);
  const image = blockElement(view.nodeDOM(unit.from));
  const rect = image.getBoundingClientRect();
  event.dataTransfer.setDragImage(image, Math.max(0, event.clientX - rect.left), Math.max(0, event.clientY - rect.top));
  view.dragging = { slice, move: true };
  const onLeave = (leave) => {
    if (leave.relatedTarget === null && drags.has(view)) showCandidate(view, null);
  };
  document.addEventListener('dragleave', onLeave);
  const drag = { unit, candidate: null, line: null, onLeave };
  drag.timer = setTimeout(() => {
    if (drags.get(view) === drag) view.dispatch(view.state.tr.setMeta(dragKey, unit));
  });
  drags.set(view, drag);
}

function draggedDecorations(doc, unit) {
  const decorations = [];
  for (let pos = unit.from; pos < unit.to; pos += doc.nodeAt(pos).nodeSize) {
    decorations.push(Decoration.node(pos, pos + doc.nodeAt(pos).nodeSize, { class: 'bake-dragging' }));
  }
  return DecorationSet.create(doc, decorations);
}

export const dropPlugin = $prose(
  () =>
    new Plugin({
      key: dragKey,
      state: {
        init: () => null,
        apply: (tr, unit) => {
          const meta = tr.getMeta(dragKey);
          if (meta !== undefined) return meta;
          return tr.docChanged ? null : unit;
        },
      },
      props: {
        decorations: (state) => {
          const unit = dragKey.getState(state);
          return unit ? draggedDecorations(state.doc, unit) : null;
        },
        handleDOMEvents: {
          dragover: (view, event) => {
            const drag = drags.get(view);
            if (drag) showCandidate(view, candidateAt(view, drag.unit, event));
            return false;
          },
          drop: (view, event) => {
            if (!drags.has(view) || view.posAtCoords({ left: event.clientX, top: event.clientY })) return false;
            event.preventDefault();
            endDrag(view);
            return true;
          },
        },
        handleDrop: (view) => {
          const drag = drags.get(view);
          if (!drag) return false;
          const tr = drag.candidate && planMove(view.state, drag.unit, drag.candidate.target);
          endDrag(view);
          if (tr) {
            applyBlockTransaction(view, tr);
            view.focus();
          }
          return true;
        },
      },
      view: (view) => ({
        update: (current, previous) => {
          if (current.state.doc !== previous.doc) discardDrag(current);
        },
        destroy: () => discardDrag(view),
      }),
    }),
);
