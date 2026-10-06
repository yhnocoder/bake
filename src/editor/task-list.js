import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';

function checkbox(itemPos, checked) {
  return (view) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.contentEditable = 'false';
    input.addEventListener('change', () => {
      view.dispatch(view.state.tr.setNodeAttribute(itemPos, 'checked', input.checked));
    });
    return input;
  };
}

function taskDecorations(doc) {
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      let tasks = false;
      node.forEach((item) => {
        tasks ||= item.attrs.checked != null;
      });
      if (tasks) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'contains-task-list' }));
    }
    if (node.type.name !== 'list_item' || node.attrs.checked == null) return;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'task-list-item' }));
    decorations.push(Decoration.widget(pos + 2, checkbox(pos, node.attrs.checked), { side: -1, ignoreSelection: true, key: `task:${pos}:${node.attrs.checked}` }));
  });
  return DecorationSet.create(doc, decorations);
}

const taskListKey = new PluginKey('bake-task-list');

export const taskList = $prose(
  () =>
    new Plugin({
      key: taskListKey,
      state: {
        init: (_, state) => taskDecorations(state.doc),
        apply: (tr, decorations) => (tr.docChanged ? taskDecorations(tr.doc) : decorations),
      },
      props: {
        decorations: (state) => taskListKey.getState(state),
      },
    }),
);
