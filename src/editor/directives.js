import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $markSchema, $nodeSchema, $prose, $view } from '@milkdown/utils';
import { blockRender, isDefault, withDefaults } from '../render/block-render.js';

const svgNamespace = 'http://www.w3.org/2000/svg';

function createElement(tagName, parent) {
  const inSvg = tagName === 'svg' || (parent && parent.namespaceURI === svgNamespace && parent.localName !== 'foreignObject');
  return inSvg ? document.createElementNS(svgNamespace, tagName) : document.createElement(tagName);
}

function build(spec, parent, created) {
  if (typeof spec === 'string' || typeof spec === 'number') return document.createTextNode(String(spec));
  if (spec.type === 'text') {
    const text = document.createTextNode(spec.value);
    created.set(spec, text);
    return text;
  }
  const [tagName, properties, children] = Array.isArray(spec) ? spec : [spec.tagName, spec.properties, spec.children];
  const element = createElement(tagName, parent);
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children ?? []) element.append(build(child, element, created));
  if (!Array.isArray(spec)) created.set(spec, element);
  if (tagName === 'details') element.setAttribute('open', '');
  return element;
}

function locate(node, target) {
  const path = [];
  for (let current = target; current !== node; current = current.parentNode) path.unshift([...current.parentNode.childNodes].indexOf(current));
  return path;
}

function follow(node, path) {
  return path.reduce((current, index) => current.childNodes[index], node);
}

export function blockShape(block, attributes, hasLabel) {
  const labelText = { type: 'text', value: '' };
  const label = { type: 'element', tagName: 'p', properties: {}, children: [labelText] };
  const content = { type: 'text', value: '' };
  const contentHolder = block.form === 'container' ? { type: 'element', tagName: 'div', properties: {}, children: [content] } : content;
  const created = new Map();
  const render = blockRender(block, block.name, block.form);
  const dom = build(render({ attributes: withDefaults(attributes, block.attributes), children: hasLabel ? [label, contentHolder] : [contentHolder] }), null, created);
  const contentNode = created.get(block.form === 'container' ? contentHolder : content);
  if (!contentNode?.parentNode) throw new Error(`Block ${block.name} must place its children in one element`);
  const contentDOM = contentNode.parentNode;
  const labelWrapper = hasLabel ? created.get(labelText)?.parentNode : null;
  if (hasLabel && labelWrapper?.parentNode !== contentDOM) throw new Error(`Block ${block.name} must place its title next to its content`);
  const before = [];
  const between = [];
  const after = [];
  let region = before;
  for (const child of [...contentDOM.childNodes]) {
    if (child === labelWrapper) region = between;
    else if (child === contentNode) region = after;
    else {
      if (child.nodeType === Node.ELEMENT_NODE) child.setAttribute('contenteditable', 'false');
      region.push(child);
    }
    child.remove();
  }
  labelWrapper?.replaceChildren();
  return { dom, contentPath: locate(dom, contentDOM), label: labelWrapper, before, between, after };
}

function shapeCache(block) {
  const shapes = new Map();
  return (attributes, hasLabel) => {
    const key = `${hasLabel}:${JSON.stringify(attributes)}`;
    if (!shapes.has(key)) shapes.set(key, blockShape(block, attributes, hasLabel));
    return shapes.get(key);
  };
}

function hasLabel(node) {
  return node.firstChild?.type.name === 'directive_label';
}

class BlockView {
  constructor(node, shapeOf) {
    const shape = shapeOf(node.attrs.attributes, hasLabel(node));
    this.dom = shape.dom.cloneNode(true);
    this.contentDOM = follow(this.dom, shape.contentPath);
  }

  ignoreMutation(mutation) {
    if (mutation.type === 'selection') return false;
    if (mutation.type === 'attributes') return true;
    return !this.contentDOM.contains(mutation.target);
  }
}

class LabelView {
  constructor(node, view, getPos, shapes) {
    const parent = view.state.doc.resolve(getPos()).parent;
    const shape = shapes.get(parent.type.name)?.(parent.attrs.attributes, true);
    this.dom = shape?.label ? shape.label.cloneNode(false) : document.createElement('p');
    this.contentDOM = this.dom;
  }

  ignoreMutation(mutation) {
    return mutation.type === 'attributes';
  }
}

function staticWidgets(doc, shapes) {
  const decorations = [];
  doc.descendants((node, pos) => {
    const shapeOf = shapes.get(node.type.name);
    if (!shapeOf || node.isInline) return;
    const shape = shapeOf(node.attrs.attributes, hasLabel(node));
    const key = `${node.type.name}:${JSON.stringify(node.attrs.attributes)}`;
    const add = (place, nodes, side, region) => {
      nodes.forEach((child, index) => {
        decorations.push(Decoration.widget(place, () => child.cloneNode(true), { side, ignoreSelection: true, key: `${key}:${region}:${index}` }));
      });
    };
    add(pos + 1, shape.before, -1, 'before');
    if (hasLabel(node)) add(pos + 1 + node.firstChild.nodeSize, shape.between, -1, 'between');
    add(pos + node.nodeSize - 1, shape.after, 1, 'after');
  });
  return DecorationSet.create(doc, decorations);
}

function containerSchema(block) {
  const id = `directive_${block.name}`;
  return $nodeSchema(id, () => ({
    group: 'block',
    content: block.name === 'fold' ? 'directive_label block+' : 'directive_label? block+',
    defining: true,
    attrs: { attributes: { default: {} } },
    parseDOM: [],
    toDOM: () => ['div', { class: block.name }, 0],
    parseMarkdown: {
      match: (node) => node.type === 'containerDirective' && node.name === block.name,
      runner: (state, node, type) => {
        state.openNode(type, { attributes: { ...node.attributes } });
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === id,
      runner: (state, node) => {
        state.openNode('containerDirective', undefined, { name: block.name, attributes: node.attrs.attributes });
        state.next(node.content);
        state.closeNode();
      },
    },
  }));
}

function leafSchema(block) {
  const id = `directive_${block.name}`;
  return $nodeSchema(id, () => ({
    group: 'block',
    content: 'inline*',
    attrs: { attributes: { default: {} } },
    parseDOM: [],
    toDOM: () => ['p', { class: block.name }, 0],
    parseMarkdown: {
      match: (node) => node.type === 'leafDirective' && node.name === block.name,
      runner: (state, node, type) => {
        state.openNode(type, { attributes: { ...node.attributes } });
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === id,
      runner: (state, node) => {
        state.openNode('leafDirective', undefined, { name: block.name, attributes: node.attrs.attributes });
        state.next(node.content);
        state.closeNode();
      },
    },
  }));
}

function textSchema(block, shapeOf) {
  const id = `directive_${block.name}`;
  return $markSchema(id, () => ({
    attrs: { attributes: { default: {} } },
    parseDOM: [],
    toDOM: (mark) => {
      const shape = shapeOf(mark.attrs.attributes, false);
      const dom = shape.dom.cloneNode(true);
      return { dom, contentDOM: follow(dom, shape.contentPath) };
    },
    parseMarkdown: {
      match: (node) => node.type === 'textDirective' && node.name === block.name,
      runner: (state, node, type) => {
        state.openMark(type, { attributes: { ...node.attributes } });
        state.next(node.children);
        state.closeMark(type);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, 'textDirective', undefined, { name: block.name, attributes: mark.attrs.attributes });
      },
    },
  }));
}

const labelSchema = $nodeSchema('directive_label', () => ({
  content: 'inline*',
  defining: true,
  parseDOM: [],
  toDOM: () => ['p', 0],
  parseMarkdown: {
    match: (node) => node.type === 'paragraph' && node.data?.directiveLabel === true,
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'directive_label',
    runner: (state, node) => {
      state.openNode('paragraph', undefined, { data: { directiveLabel: true } });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

class ComponentView {
  constructor(node, properties) {
    this.properties = properties;
    this.dom = document.createElement('div');
    this.dom.className = 'bake-component';
    const element = document.createElement(node.attrs.name);
    element.className = 'component';
    if (node.attrs.container) {
      this.contentDOM = document.createElement('figcaption');
      element.append(this.contentDOM);
    }
    this.dom.append(element);
    this.node = node;
    this.syncAttributes(node.attrs.attributes);
  }

  element() {
    return this.dom.firstElementChild;
  }

  syncAttributes(attributes) {
    const element = this.element();
    const definitions = this.properties[this.node.attrs.name] ?? {};
    const shown = Object.entries(attributes).filter(([key, value]) => !isDefault(value ?? '', definitions[key]));
    const names = new Set(shown.map(([key]) => key));
    for (const { name } of [...element.attributes]) if (name !== 'class' && !names.has(name)) element.removeAttribute(name);
    for (const [key, value] of shown) if (element.getAttribute(key) !== (value ?? '')) element.setAttribute(key, value ?? '');
  }

  update(node) {
    if (node.type !== this.node.type || node.attrs.name !== this.node.attrs.name || node.attrs.container !== this.node.attrs.container) return false;
    this.node = node;
    this.syncAttributes(node.attrs.attributes);
    return true;
  }

  stopEvent(event) {
    return !this.contentDOM?.contains(event.target);
  }

  ignoreMutation(mutation) {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM?.contains(mutation.target) || mutation.target === this.contentDOM && mutation.type === 'attributes';
  }
}

function rejectLabel(node) {
  if (node.children?.[0]?.data?.directiveLabel || (node.type === 'leafDirective' && node.children.length > 0)) {
    throw new Error(`Component ${node.name} cannot have text in brackets`);
  }
}

const componentSchema = $nodeSchema('component', () => ({
  group: 'block',
  content: 'block*',
  atom: false,
  attrs: { name: { default: '' }, attributes: { default: {} }, container: { default: false } },
  parseDOM: [],
  toDOM: (node) => [node.attrs.name, { class: 'component' }, ['figcaption', 0]],
  parseMarkdown: {
    match: (node) => (node.type === 'containerDirective' || node.type === 'leafDirective') && node.name.includes('-'),
    runner: (state, node, type) => {
      rejectLabel(node);
      state.openNode(type, { name: node.name, attributes: { ...node.attributes }, container: node.type === 'containerDirective' });
      if (node.type === 'containerDirective') state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'component',
    runner: (state, node) => {
      state.openNode(node.attrs.container ? 'containerDirective' : 'leafDirective', undefined, { name: node.attrs.name, attributes: node.attrs.attributes });
      if (node.attrs.container) state.next(node.content);
      state.closeNode();
    },
  },
}));

const shapesKey = new PluginKey('bake-block-statics');

export function directives({ blocks, components }) {
  const shapes = new Map(blocks.map((block) => [`directive_${block.name}`, shapeCache(block)]));
  const schemas = blocks.map((block) => {
    if (block.form === 'container') return containerSchema(block);
    if (block.form === 'leaf') return leafSchema(block);
    return textSchema(block, shapes.get(`directive_${block.name}`));
  });
  const views = blocks
    .filter((block) => block.form !== 'text')
    .map((block) => $view(schemas[blocks.indexOf(block)].node, () => (node) => new BlockView(node, shapes.get(`directive_${block.name}`))));
  const statics = $prose(
    () =>
      new Plugin({
        key: shapesKey,
        state: {
          init: (_, state) => staticWidgets(state.doc, shapes),
          apply: (tr, decorations) => (tr.docChanged ? staticWidgets(tr.doc, shapes) : decorations),
        },
        props: {
          decorations: (state) => shapesKey.getState(state),
        },
      }),
  );
  return [
    labelSchema,
    $view(labelSchema.node, () => (node, view, getPos) => new LabelView(node, view, getPos, shapes)),
    componentSchema,
    $view(componentSchema.node, () => (node) => new ComponentView(node, components)),
    ...schemas,
    ...views,
    statics,
  ].flat();
}
