import { toHtml } from 'hast-util-to-html';
import { h } from 'hastscript';
import { defaultHandlers } from 'mdast-util-to-hast';
import { contentChildren } from '../format/validate.js';
import { blockRender, isDefault, withDefaults } from './block-render.js';
import { imageAppearance } from './image.js';

function element(tagName, properties, children = []) {
  return { type: 'element', tagName, properties, children };
}

function fromArray([tagName, properties, children = []]) {
  return h(tagName, properties, children.map((child) => (Array.isArray(child) && typeof child[0] === 'string' ? fromArray(child) : child)));
}

export function createHandlers({ source, registry, components }) {
  const sourceOf = (node) => source.slice(node.position.start.offset, node.position.end.offset);

  function heading(state, node) {
    const { id } = node.data;
    const content = state.all(node);
    const tocText = node.data.attributes?.toc;
    const tocContent = tocText === undefined ? content.filter((child) => !child.properties?.className?.includes('sidenote-ref')) : [{ type: 'text', value: tocText }];
    node.data.tocHtml = toHtml(tocContent, { allowDangerousHtml: true });
    const anchor = element('a', { className: ['anchor'], href: `#${id}`, ariaHidden: 'true' }, [{ type: 'text', value: '#' }]);
    return element(`h${node.depth}`, { id }, [anchor, ...content]);
  }

  function paragraph(state, node) {
    const properties = node.data?.blockId ? { id: node.data.blockId } : {};
    if (node.children.length === 1 && node.children[0].type === 'image') {
      const figure = state.one(node.children[0], node);
      Object.assign(figure.properties, properties);
      return figure;
    }
    return element('p', properties, state.all(node));
  }

  function image(_, node) {
    const { className, style } = imageAppearance(node.data?.attributes);
    const properties = { src: node.url, alt: node.alt ?? '' };
    if (style) properties.style = style;
    const children = [element('img', properties)];
    if (node.alt) children.push(element('figcaption', {}, [{ type: 'text', value: node.alt }]));
    return element('figure', { className }, children);
  }

  function mark(state, node) {
    return element('mark', {}, state.all(node));
  }

  function table(state, node) {
    return element('div', { className: ['table-scroll'] }, [defaultHandlers.table(state, node)]);
  }

  function blockquote(state, node) {
    const last = node.children.at(-1);
    if (last?.type !== 'leafDirective' || last.name !== 'source') return defaultHandlers.blockquote(state, node);
    const quote = element('blockquote', {}, state.wrap(state.all({ ...node, children: node.children.slice(0, -1) }), true));
    return element('figure', { className: ['quote'] }, [quote, state.one(last, node)]);
  }

  function math(node, tagName, className) {
    if (node.data?.eqref) {
      const { id, number } = node.data.eqref;
      return element('a', { className: ['eqref'], href: `#${id}` }, [{ type: 'text', value: `(${number})` }]);
    }
    const properties = { className, dataTex: node.value };
    if (node.data?.equationId) properties.id = node.data.equationId;
    const content = node.data?.svg ? { type: 'raw', value: node.data.svg } : { type: 'text', value: node.value };
    return element(tagName, properties, [content]);
  }

  function footnoteReference(_, node) {
    const number = node.data.sidenote;
    const link = element('a', { href: `#sn-${number}` }, [{ type: 'text', value: String(number) }]);
    return element('sup', { className: ['sidenote-ref'], id: `sn-ref-${number}` }, [link]);
  }

  function sidenote(state, node) {
    const number = element('span', { className: ['sidenote-number'] }, [{ type: 'text', value: String(node.number) }]);
    return element('aside', { className: ['sidenote'], id: `sn-${node.number}`, dataMd: sourceOf(node) }, [number, ...state.all(node)]);
  }

  function component(state, node) {
    const properties = components?.[node.name] ?? {};
    const attributes = {};
    for (const [key, value] of Object.entries(node.attributes ?? {})) {
      if (!isDefault(value ?? '', properties[key])) attributes[key] = value ?? '';
    }
    const children = [];
    if (node.type === 'containerDirective') {
      const content = contentChildren(node);
      const caption = content.length === 1 && content[0].type === 'paragraph' ? state.all(content[0]) : state.all({ ...node, children: content });
      if (caption.length > 0) children.push(element('figcaption', {}, caption));
    }
    return element(node.name, { ...attributes, className: ['component'], dataMd: sourceOf(node) }, children);
  }

  function directive(state, node) {
    if (node.name.includes('-')) return component(state, node);
    const block = registry.get(node.name);
    const attributes = withDefaults(node.attributes, block?.attributes);
    const labelParagraph = node.children.find((child) => child.data?.directiveLabel);
    const label = labelParagraph ? state.all(labelParagraph) : undefined;
    const children = state.all({ ...node, children: contentChildren(node) });
    const form = { textDirective: 'text', leafDirective: 'leaf', containerDirective: 'container' }[node.type];
    const result = fromArray(blockRender(block, node.name, form)({ attributes, label, children }));
    result.properties.dataMd = sourceOf(node);
    return state.applyData(node, result);
  }

  return {
    heading,
    paragraph,
    image,
    mark,
    table,
    blockquote,
    math: (_, node) => math(node, 'div', ['math', 'display']),
    inlineMath: (_, node) => math(node, 'span', ['math']),
    footnoteReference,
    sidenote,
    containerDirective: directive,
    leafDirective: directive,
    textDirective: directive,
  };
}
