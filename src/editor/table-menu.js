import { commandsCtx, editorViewCtx } from '@milkdown/core';
import { Plugin, TextSelection } from '@milkdown/prose/state';
import { deleteColumn, deleteRow, isInTable, selectedRect } from '@milkdown/prose/tables';
import { addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand } from '@milkdown/preset-gfm';
import { $prose } from '@milkdown/utils';

function menuItems(ctx, inHeader) {
  const commands = ctx.get(commandsCtx);
  const run = (key) => () => commands.call(key);
  const runProse = (command) => () => {
    const view = ctx.get(editorViewCtx);
    return command(view.state, view.dispatch);
  };
  return [
    { label: '在上方插入行', run: run(addRowBeforeCommand.key), disabled: inHeader },
    { label: '在下方插入行', run: run(addRowAfterCommand.key) },
    { label: '在左侧插入列', run: run(addColBeforeCommand.key) },
    { label: '在右侧插入列', run: run(addColAfterCommand.key) },
    { label: '删除行', run: runProse(deleteRow), disabled: inHeader },
    { label: '删除列', run: runProse(deleteColumn) },
  ];
}

function showMenu(items, event, view) {
  const menu = document.createElement('div');
  menu.className = 'bake-table-menu';
  menu.setAttribute('role', 'menu');
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
  };
  const onOutside = (outside) => {
    if (!menu.contains(outside.target)) close();
  };
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.disabled = item.disabled ?? false;
    button.addEventListener('click', () => {
      close();
      item.run();
      view.focus();
    });
    menu.append(button);
  }
  Object.assign(menu.style, { left: `${event.pageX}px`, top: `${event.pageY}px` });
  document.body.append(menu);
  document.addEventListener('pointerdown', onOutside, true);
}

export const tableMenu = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleDOMEvents: {
          contextmenu: (view, event) => {
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!position) return false;
            const $pos = view.state.doc.resolve(position.pos);
            const cellDepth = [...Array($pos.depth + 1).keys()].reverse().find((depth) => $pos.node(depth).type.spec.tableRole?.includes('cell'));
            if (cellDepth === undefined) return false;
            const selection = TextSelection.near(view.state.doc.resolve($pos.start(cellDepth)));
            view.dispatch(view.state.tr.setSelection(selection));
            if (!isInTable(view.state)) return false;
            event.preventDefault();
            const rect = selectedRect(view.state);
            showMenu(menuItems(ctx, rect.top === 0), event, view);
            return true;
          },
        },
      },
    }),
);
