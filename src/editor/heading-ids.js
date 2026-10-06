import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { equationId, labelNames } from '../render/equation-labels.js';
import { createHeadingIds } from '../render/heading-ids.js';

function explicitIds(doc) {
  const ids = new Set();
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.attributes?.id) ids.add(node.attrs.attributes.id);
    if (node.type.name === 'paragraph' && node.attrs.blockId) ids.add(node.attrs.blockId);
    if (node.type.name === 'math_block') {
      const [name] = labelNames(node.attrs.value);
      if (name !== undefined) ids.add(equationId(name));
    }
  });
  return ids;
}

function idLabel(id) {
  const label = document.createElement('span');
  label.className = 'bake-heading-id';
  label.contentEditable = 'false';
  label.textContent = `#${id}`;
  return label;
}

function headingDecorations(doc) {
  const explicit = explicitIds(doc);
  const headingId = createHeadingIds(explicit);
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const id = node.attrs.attributes?.id ?? headingId(node.textContent);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id }));
    decorations.push(Decoration.widget(pos + 1, () => idLabel(id), { side: -1, ignoreSelection: true, key: `heading-id:${id}` }));
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
