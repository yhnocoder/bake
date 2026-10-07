import { slashFactory, SlashProvider } from '@milkdown/plugin-slash';
import { closeHistory } from '@milkdown/prose/history';
import { Fragment } from '@milkdown/prose/model';
import { TextSelection } from '@milkdown/prose/state';
import { createTable } from '@milkdown/preset-gfm';
import { $ctx } from '@milkdown/utils';
import { labelShown } from './directives.js';
import { checkOrder, labelRequired } from './structure.js';

const insertMenuItems = $ctx([], 'insertMenuItems');
export const insertMenuItemsCtx = insertMenuItems.key;
const slash = slashFactory('bake-insert');

function queryOf(state) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const paragraph = $from.parent;
  if (paragraph.type.name !== 'paragraph' || $from.parentOffset !== paragraph.content.size) return null;
  let text = '';
  for (let index = 0; index < paragraph.childCount; index++) {
    if (!paragraph.child(index).isText) return null;
    text += paragraph.child(index).text;
  }
  const match = /^\/(\S*)$/.exec(text);
  if (!match) return null;
  return { query: match[1], range: { from: $from.before(), to: $from.after() }, parent: $from.node(-1), index: $from.index(-1) };
}

function fits({ parent, index }, node) {
  return parent.canReplaceWith(index, index + 1, node.type) && checkOrder(parent.copy(parent.content.replaceChild(index, node)));
}

function startTransaction(view) {
  return closeHistory(view.state.tr);
}

function finish(view, tr) {
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function replaceParagraph(view, range, node, cursorFrom) {
  const tr = startTransaction(view).replaceWith(range.from, range.to, node);
  tr.setSelection(TextSelection.findFrom(tr.doc.resolve(cursorFrom), 1) ?? TextSelection.near(tr.doc.resolve(range.from)));
  finish(view, tr);
}

function blockNode(schema, block) {
  const type = schema.nodes[`directive_${block.name}`];
  const content = labelShown(block) ? Fragment.from(schema.nodes.directive_label.create()) : Fragment.empty;
  return type.createAndFill({ attributes: {} }, content);
}

function blockItem(schema, block, match) {
  const base = { label: `${block.label} ${block.name}`, name: block.name, keywords: [block.name, block.label] };
  if (block.form === 'text') {
    const markType = schema.marks[`directive_${block.name}`];
    if (!schema.nodes.paragraph.allowsMarkType(markType)) return null;
    return {
      ...base,
      run(view, range) {
        const tr = startTransaction(view).replaceWith(range.from + 1, range.to - 1, schema.text(block.label, [markType.create({ attributes: {} })]));
        tr.setSelection(TextSelection.create(tr.doc, range.from + 1, range.from + 1 + block.label.length));
        finish(view, tr);
      },
    };
  }
  const node = blockNode(schema, block);
  if (!node || !fits(match, node)) return null;
  return {
    ...base,
    run(view, range) {
      const created = blockNode(schema, block);
      const skipLabel = created.firstChild?.type.name === 'directive_label' && !labelRequired(created.type.name);
      replaceParagraph(view, range, created, range.from + 1 + (skipLabel ? created.firstChild.nodeSize : 0));
    },
  };
}

function componentItem(schema, name, match) {
  const create = () => schema.nodes.component.create({ name, attributes: {}, container: true }, schema.nodes.paragraph.create());
  if (!fits(match, create())) return null;
  return { label: name, keywords: [name], run: (view, range) => replaceParagraph(view, range, create(), range.from + 1) };
}

function tableItem(ctx, schema, match) {
  if (!fits(match, createTable(ctx, 3, 3))) return null;
  return { label: '表格', keywords: ['table'], run: (view, range) => replaceParagraph(view, range, createTable(ctx, 3, 3), range.from + 1) };
}

function matches(item, query) {
  const lower = query.toLowerCase();
  return [item.label, ...(item.keywords ?? [])].some((text) => text.toLowerCase().includes(lower));
}

class InsertMenuView {
  constructor(ctx, view, registry) {
    this.ctx = ctx;
    this.registry = registry;
    this.dismissed = false;
    this.highlighted = 0;
    this.query = null;
    this.element = document.createElement('div');
    this.element.className = 'bake-insert-menu';
    this.element.dataset.bakeDev = '';
    this.element.setAttribute('role', 'listbox');
    this.element.addEventListener('mousedown', (event) => event.preventDefault());
    this.provider = new SlashProvider({
      content: this.element,
      debounce: 0,
      root: document.body,
      shouldShow: (current) => this.isOpen(current),
    });
    this.provider.onShow = () => this.render(this.view);
    this.view = view;
  }

  isOpen(view) {
    return !this.dismissed && view.editable && view.hasFocus() && queryOf(view.state) !== null;
  }

  groups(state) {
    const match = queryOf(state);
    if (!match) return null;
    const { schema } = state;
    const blocks = this.registry.blocks.filter((block) => block.name !== 'span').map((block) => blockItem(schema, block, match));
    const table = tableItem(this.ctx, schema, match);
    const extra = this.ctx.get(insertMenuItemsCtx);
    const components = Object.keys(this.registry.components)
      .sort()
      .map((name) => componentItem(schema, name, match));
    const pick = (items) => items.filter((item) => item && matches(item, match.query));
    return { match, blocks: pick([...blocks, table, ...extra]), components: pick(components) };
  }

  items(state) {
    const groups = this.groups(state);
    return groups ? [...groups.blocks, ...groups.components] : [];
  }

  render(view) {
    const groups = this.groups(view.state);
    if (!groups) return;
    if (groups.match.query !== this.query) {
      this.query = groups.match.query;
      this.highlighted = 0;
    }
    const all = [...groups.blocks, ...groups.components];
    const children = [];
    for (const [title, items] of [['块', groups.blocks], ['组件', groups.components]]) {
      if (items.length === 0) continue;
      const heading = document.createElement('div');
      heading.className = 'bake-insert-group';
      heading.textContent = title;
      children.push(heading);
      for (const item of items) {
        const option = document.createElement('div');
        option.className = 'bake-insert-item';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(all.indexOf(item) === this.highlighted));
        if (item.name) {
          const name = document.createElement('span');
          name.className = 'bake-insert-name';
          name.textContent = item.name;
          option.append(item.label.slice(0, -item.name.length), name);
        } else {
          option.textContent = item.label;
        }
        option.addEventListener('click', () => this.run(view, item));
        children.push(option);
      }
    }
    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bake-insert-empty';
      empty.textContent = '没有匹配的项';
      children.push(empty);
    }
    this.element.replaceChildren(...children);
  }

  run(view, item) {
    const match = queryOf(view.state);
    if (!match) return;
    this.provider.hide();
    item.run(view, match.range);
  }

  handleKeyDown(view, event) {
    if (!this.isOpen(view)) return false;
    if (event.key === 'Escape') {
      this.dismissed = true;
      this.provider.hide();
      return true;
    }
    const items = this.items(view.state);
    if (items.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.highlighted = (this.highlighted + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      this.render(view);
      return true;
    }
    if (event.key === 'Enter') {
      this.run(view, items[Math.min(this.highlighted, items.length - 1)]);
      return true;
    }
    return false;
  }

  update(view, previous) {
    this.view = view;
    if (!previous.doc.eq(view.state.doc)) this.dismissed = false;
    this.provider.update(view, previous);
  }

  destroy() {
    this.provider.destroy();
    this.element.remove();
  }
}

export function insertMenu(registry) {
  let menu = null;
  const configure = (ctx) => {
    ctx.set(slash.key, {
      view: (view) => {
        menu = new InsertMenuView(ctx, view, registry);
        return menu;
      },
      props: {
        handleKeyDown: (view, event) => menu?.handleKeyDown(view, event) ?? false,
      },
    });
  };
  return { plugins: [insertMenuItems, slash].flat(), configure };
}
