import { $markSchema, $nodeSchema, $view } from '@milkdown/utils';

const referenceAttrs = { identifier: { default: '' }, label: { default: null }, referenceType: { default: 'full' } };

function referenceFields(node) {
  return { identifier: node.attrs.identifier, label: node.attrs.label, referenceType: node.attrs.referenceType };
}

function definitionSource({ label, url, title }) {
  return `[${label}]: ${url}${title ? ` "${title}"` : ''}`;
}

const definitionSchema = $nodeSchema('definition', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { identifier: { default: '' }, label: { default: null }, url: { default: '' }, title: { default: null } },
  toDOM: (node) => ['div', { class: 'bake-link-definition', contenteditable: 'false' }, definitionSource(node.attrs)],
  parseMarkdown: {
    match: (node) => node.type === 'definition',
    runner: (state, node, type) => {
      state.addNode(type, { identifier: node.identifier, label: node.label ?? null, url: node.url, title: node.title ?? null });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'definition',
    runner: (state, node) => {
      const { identifier, label, url, title } = node.attrs;
      state.addNode('definition', undefined, undefined, { identifier, label, url, title });
    },
  },
}));

const linkReferenceSchema = $markSchema('link_reference', () => ({
  attrs: referenceAttrs,
  inclusive: false,
  toDOM: (mark) => ['a', { class: 'link-reference', 'data-reference': mark.attrs.label ?? mark.attrs.identifier }],
  parseMarkdown: {
    match: (node) => node.type === 'linkReference',
    runner: (state, node, markType) => {
      state.openMark(markType, { identifier: node.identifier, label: node.label ?? null, referenceType: node.referenceType });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'link_reference',
    runner: (state, mark) => {
      state.withMark(mark, 'linkReference', undefined, referenceFields(mark));
    },
  },
}));

const imageReferenceSchema = $nodeSchema('image_reference', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { ...referenceAttrs, alt: { default: '' } },
  toDOM: (node) => ['img', { alt: node.attrs.alt }],
  parseMarkdown: {
    match: (node) => node.type === 'imageReference',
    runner: (state, node, type) => {
      state.addNode(type, { identifier: node.identifier, label: node.label ?? null, referenceType: node.referenceType, alt: node.alt ?? '' });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'image_reference',
    runner: (state, node) => {
      state.addNode('imageReference', undefined, undefined, { ...referenceFields(node), alt: node.attrs.alt });
    },
  },
}));

function definitionUrl(doc, identifier) {
  let url = '';
  doc.forEach((child) => {
    if (url === '' && child.type.name === 'definition' && child.attrs.identifier === identifier) url = child.attrs.url;
  });
  return url;
}

class ImageReferenceView {
  constructor(node, view) {
    this.view = view;
    this.dom = document.createElement('img');
    this.update(node);
  }

  update(node) {
    if (node.type.name !== 'image_reference') return false;
    this.dom.alt = node.attrs.alt;
    const url = definitionUrl(this.view.state.doc, node.attrs.identifier);
    if (this.dom.getAttribute('src') !== url) this.dom.setAttribute('src', url);
    return true;
  }
}

export const references = [
  definitionSchema,
  linkReferenceSchema,
  imageReferenceSchema,
  $view(imageReferenceSchema.node, () => (node, view) => new ImageReferenceView(node, view)),
].flat();
