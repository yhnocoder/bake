import { TextSelection } from '@milkdown/prose/state';
import { codeBlockSchema } from '@milkdown/preset-commonmark';
import { $useKeymap } from '@milkdown/utils';
import { mathBlockSchema, openFormulaEditor } from './math.js';

const codeFence = /^```([^`\s]*)$/;

function replaceParagraph(state, dispatch, node, select) {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'paragraph' || !state.selection.empty) return false;
  const start = $from.before();
  const tr = state.tr.replaceWith(start, $from.after(), node);
  dispatch?.(select(tr, start));
  return true;
}

export const enterRules = $useKeymap('bakeEnterRules', {
  FenceToBlock: {
    shortcuts: 'Enter',
    priority: 100,
    command: (ctx) => (state, dispatch, view) => {
      const text = state.selection.$from.parent.textContent;
      if (text === '$$') {
        const created = replaceParagraph(state, dispatch, mathBlockSchema.type(ctx).create(), (tr) => tr);
        if (created && dispatch) openFormulaEditor(view, state.selection.$from.before());
        return created;
      }
      const fence = codeFence.exec(text);
      if (!fence) return false;
      return replaceParagraph(state, dispatch, codeBlockSchema.type(ctx).create({ language: fence[1] }), (tr, start) => tr.setSelection(TextSelection.create(tr.doc, start + 1)));
    },
  },
});
