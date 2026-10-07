import { NodeSelection, Plugin, PluginKey } from '@milkdown/prose/state';

export const propertiesKey = new PluginKey('bake-properties');

export function selectTarget(view, target) {
  view.dispatch(view.state.tr.setMeta(propertiesKey, { open: true, target }));
}

export function toggleProperties(view) {
  const { open } = propertiesKey.getState(view.state);
  view.dispatch(view.state.tr.setMeta(propertiesKey, { open: !open }));
}

export function closeProperties(view) {
  view.dispatch(view.state.tr.setMeta(propertiesKey, { open: false }));
}

function markRange($pos, mark) {
  let from = null;
  let to = null;
  let start = $pos.start();
  for (let index = 0; index < $pos.parent.childCount; index++) {
    const child = $pos.parent.child(index);
    const end = start + child.nodeSize;
    if (mark.isInSet(child.marks)) {
      from ??= start;
      to = end;
    } else if (to !== null && from <= $pos.pos && $pos.pos <= to) {
      break;
    } else {
      from = null;
      to = null;
    }
    start = end;
  }
  return from !== null && from <= $pos.pos && $pos.pos <= to ? { from, to, type: mark.type.name } : null;
}

export function propertiesState(definitions) {
  function innermost(state) {
    const { selection } = state;
    if (selection instanceof NodeSelection && definitions.node(selection.node)) return { pos: selection.from };
    const { $from } = selection;
    for (const mark of $from.marks()) {
      if (definitions.mark(mark)) return markRange($from, mark);
    }
    for (let depth = $from.depth; depth > 0; depth--) {
      if (definitions.node($from.node(depth))) return { pos: $from.before(depth) };
    }
    return null;
  }

  function mapTarget(target, tr, doc) {
    if (target.pos !== undefined) {
      const { pos, deleted } = tr.mapping.mapResult(target.pos, 1);
      const node = deleted ? null : doc.nodeAt(pos);
      if (!node || !definitions.node(node)) return null;
      return pos === target.pos ? target : { pos };
    }
    const from = tr.mapping.map(target.from, 1);
    const to = tr.mapping.map(target.to, -1);
    if (from >= to) return null;
    return from === target.from && to === target.to ? target : { ...target, from, to };
  }

  function contains(target, selection, doc) {
    if (target.pos !== undefined) return selection.from >= target.pos && selection.to <= target.pos + doc.nodeAt(target.pos).nodeSize;
    return selection.from >= target.from && selection.to <= target.to;
  }

  function insideContent(view, node, nodePos, element) {
    if (node.isTextblock) return view.domAtPos(nodePos + 1).node.contains(element);
    let inside = false;
    node.forEach((child, offset) => {
      if (view.nodeDOM(nodePos + 1 + offset)?.contains(element)) inside = true;
    });
    return inside;
  }

  return new Plugin({
    key: propertiesKey,
    state: {
      init: () => ({ open: false, target: null }),
      apply(tr, value, previous, state) {
        const meta = tr.getMeta(propertiesKey);
        if (meta) {
          if (!meta.open) return { open: false, target: null };
          return { open: true, target: meta.target === undefined ? innermost(state) : meta.target };
        }
        if (!value.open) return value;
        let target = value.target && mapTarget(value.target, tr, state.doc);
        if (tr.selectionSet && !(target && contains(target, state.selection, state.doc))) target = innermost(state);
        return target === value.target ? value : { open: true, target };
      },
    },
    props: {
      handleClickOn(view, pos, node, nodePos, event, direct) {
        if (!direct || node.type.name === 'heading' || node.type.name === 'component' || !definitions.node(node)) return false;
        if (!node.isLeaf && insideContent(view, node, nodePos, event.target)) return false;
        selectTarget(view, { pos: nodePos });
        return true;
      },
    },
  });
}
