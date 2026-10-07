import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';

function caretFitsAtEnd(node) {
  return node.type.name === 'paragraph' && node.lastChild?.type.name !== 'image';
}

export function trailingParagraphTransaction(state) {
  if (caretFitsAtEnd(state.doc.lastChild)) return null;
  return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
}

export const trailingParagraph = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, _, state) => (transactions.some((tr) => tr.docChanged) ? trailingParagraphTransaction(state) : null),
    }),
);
