import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/core';
import { history } from '@milkdown/plugin-history';
import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { clipboard } from './clipboard/index.js';
import { codeBlockView } from './code-block.js';
import { directives } from './directives.js';
import { enterRules } from './enter-rules.js';
import { headingIds } from './heading-ids.js';
import { html } from './html.js';
import { math } from './math.js';
import { nodes } from './nodes.js';
import { strictParsing } from './parser.js';
import { references } from './references.js';
import { sidenotes } from './sidenotes/index.js';
import { bakeRemark, configureStringify, presets } from './remark.js';
import { tableMenu } from './table-menu.js';
import { taskList } from './task-list.js';

const links = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          click: (_, event) => {
            if (event.target.closest('a')) event.preventDefault();
            return false;
          },
        },
      },
    }),
);

function changes(onChange) {
  return $prose(
    () =>
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (view.state.doc !== previous.doc) onChange(view.state);
          },
        }),
      }),
  );
}

export async function createEditor({ root, markdown, registry, formulas, onChange }) {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      configureStringify(ctx);
    })
    .use(bakeRemark)
    .use(presets)
    .use(history)
    .use(nodes)
    .use(references)
    .use(html)
    .use(codeBlockView)
    .use(math(formulas))
    .use(directives(registry))
    .use(strictParsing)
    .use(headingIds)
    .use(enterRules)
    .use(tableMenu)
    .use(taskList)
    .use(sidenotes)
    .use(clipboard)
    .use(links)
    .use(changes(onChange))
    .create();
  return { editor, view: editor.action((ctx) => ctx.get(editorViewCtx)) };
}
