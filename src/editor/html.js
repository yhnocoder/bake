import { $nodeSchema, $view } from '@milkdown/utils';

const htmlSchema = $nodeSchema('html', () => ({
  group: 'block',
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [],
  toDOM: (node) => ['div', { class: 'bake-html', 'data-value': node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === 'html',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs.value);
    },
  },
}));

class HtmlView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'bake-html';
    this.preview = document.createElement('div');
    this.preview.className = 'bake-html-preview';
    this.preview.innerHTML = node.attrs.value;
    this.dom.append(this.preview);
    this.dom.addEventListener('click', () => this.open());
  }

  open() {
    if (this.source) return;
    const source = document.createElement('textarea');
    source.className = 'bake-html-source';
    source.value = this.node.attrs.value;
    source.spellcheck = false;
    source.rows = source.value.split('\n').length;
    source.addEventListener('input', () => {
      source.rows = source.value.split('\n').length;
    });
    source.addEventListener('blur', () => this.close());
    this.dom.append(source);
    this.source = source;
    source.focus();
  }

  close() {
    const value = this.source.value;
    this.source.remove();
    this.source = null;
    if (value !== this.node.attrs.value) this.view.dispatch(this.view.state.tr.setNodeAttribute(this.getPos(), 'value', value));
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    if (node.attrs.value !== this.node.attrs.value) this.preview.innerHTML = node.attrs.value;
    this.node = node;
    return true;
  }

  stopEvent(event) {
    return this.source?.contains(event.target) ?? false;
  }

  ignoreMutation() {
    return true;
  }
}

export const html = [htmlSchema, $view(htmlSchema.node, () => (node, view, getPos) => new HtmlView(node, view, getPos))].flat();
