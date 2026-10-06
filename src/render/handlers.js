import { h } from 'hastscript';
import { defaultHandlers } from 'mdast-util-to-hast';
import { contentChildren } from '../format/validate.js';

function element(tagName, properties, children = []) {
  return { type: 'element', tagName, properties, children };
}

function fromArray([tagName, properties, children = []]) {
  return h(tagName, properties, children.map((child) => (Array.isArray(child) && typeof child[0] === 'string' ? fromArray(child) : child)));
}

function cssSize(value) {
  return /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
}

function isDefault(value, property) {
  if (property?.default === undefined) return false;
  if (property.type === 'number') return Number(value) === property.default;
  return value === String(property.default);
}

function withDefaults(attributes, definitions) {
  const result = {};
  for (const [key, property] of Object.entries(definitions ?? {})) {
    if (property.default !== undefined) result[key] = String(property.default);
  }
  return { ...result, ...attributes };
}

export function createHandlers({ source, registry, components }) {
  const sourceOf = (node) => source.slice(node.position.start.offset, node.position.end.offset);

  function heading(state, node) {
    const { id } = node.data;
    const anchor = element('a', { className: ['anchor'], href: `#${id}`, ariaHidden: 'true' }, [{ type: 'text', value: '#' }]);
    return element(`h${node.depth}`, { id }, [anchor, ...state.all(node)]);
  }

  function paragraph(state, node) {
    if (node.children.length === 1 && node.children[0].type === 'image') return state.one(node.children[0], node);
    const properties = node.data?.blockId ? { id: node.data.blockId } : {};
    return element('p', properties, state.all(node));
  }

  function image(_, node) {
    const attributes = node.data?.attributes ?? {};
    const style = [];
    if (attributes.width) style.push(`width: ${cssSize(attributes.width)}`);
    if (attributes.height) style.push(`height: ${cssSize(attributes.height)}`);
    const properties = { src: node.url, alt: node.alt ?? '' };
    if (style.length > 0) properties.style = style.join('; ');
    const className = ['image'];
    if (attributes.float && attributes.float !== 'none') className.push(`float-${attributes.float}`);
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
    return element(node.name, { ...attributes, dataMd: sourceOf(node) }, children);
  }

  function directive(state, node) {
    if (node.name.includes('-')) return component(state, node);
    const block = registry.get(node.name);
    const attributes = withDefaults(node.attributes, block?.attributes);
    const children = state.all(node);
    const result = block?.render
      ? fromArray(block.render({ attributes, children }))
      : h(
          node.type === 'textDirective' ? 'span' : 'div',
          { class: node.name, ...Object.fromEntries(Object.entries(attributes).map(([key, value]) => [`data-${key}`, value])) },
          children,
        );
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
