import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { createHeadingIds } from '../render/heading-ids.js';
import { renderedIds } from './ids.js';
import { selectTarget } from './properties/state.js';

function idLabel(id, view, getPos) {
  const label = document.createElement('span');
  label.className = 'bake-heading-id';
  label.contentEditable = 'false';
  label.textContent = `#${id}`;
  label.addEventListener('mousedown', (event) => {
    event.preventDefault();
    selectTarget(view, { pos: getPos() - 1 });
  });
  return label;
}

function headingDecorations(doc) {
  const headingId = createHeadingIds(renderedIds(doc));
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const id = node.attrs.attributes?.id ?? headingId(node.textContent);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id }));
    decorations.push(Decoration.widget(pos + 1, (view, getPos) => idLabel(id, view, getPos), { side: -1, ignoreSelection: true, key: `heading-id:${id}` }));
  });
  return DecorationSet.create(doc, decorations);
}

const headingIdsKey = new PluginKey('bake-heading-ids');

export const headingIds = $prose(
  () =>
    new Plugin({
      key: headingIdsKey,
      state: {
        init: (_, state) => headingDecorations(state.doc),
        apply: (tr, decorations) => (tr.docChanged ? headingDecorations(tr.doc) : decorations),
      },
      props: {
        decorations: (state) => headingIdsKey.getState(state),
      },
    }),
);
