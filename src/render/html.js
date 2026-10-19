import { toHtml } from 'hast-util-to-html';
import { defaultHandlers, toHast } from 'mdast-util-to-hast';
import { highlightCode } from './code.js';
import { equationHref } from './math.js';

const ATTRIBUTION_PREFIX = '— ';

export function renderHtml(node, context) {
  const tree = toHast(node, { allowDangerousHtml: true, handlers: handlers(context) });
  return toHtml(tree, { allowDangerousHtml: true });
}

export function renderChildrenHtml(children, context) {
  return renderHtml({ type: 'root', children }, context);
}

export function renderInlineHtml(children, context) {
  const paragraph = toHast({ type: 'paragraph', children }, { allowDangerousHtml: true, handlers: handlers(context) });
  return toHtml({ type: 'root', children: paragraph.children }, { allowDangerousHtml: true });
}

function handlers(context) {
  return {
    highlight: (state, node) => element('mark', {}, state.all(node)),
    footnoteReference(state, node) {
      const number = context.sidenoteNumber(node.identifier);
      const link = element('a', { href: `#sidenote-${number}` }, [text(String(number))]);
      return element('sup', { className: ['sidenote-ref'], dataSidenote: number }, [link]);
    },
    missingFootnote: (state, node) => text(`[^${node.label}]`),
    citation(state, node) {
      const number = context.citationNumber(node.key);
      if (number === undefined) return text(`[@${node.key}]`);
      return element('a', { className: ['citation'], href: `#reference-${node.key}` }, [text(`[${number}]`)]);
    },
    eqref(state, node) {
      const equation = context.equation(node.label);
      if (equation === undefined) return text(node.value);
      return element('a', { className: ['eqref'], href: equationHref(equation.id) }, [text(`(${equation.tag})`)]);
    },
    inlineMath: (state, node) => raw(node.rendered),
    math: (state, node) => raw(node.rendered),
    code: (state, node) => highlightCode(context.highlighter, node.value, node.lang ?? undefined),
    table: (state, node) => element('div', { className: ['table-scroll'] }, [defaultHandlers.table(state, node)]),
    image: (state, node) => imageElement(node),
    figure(state, node) {
      const [image, caption] = node.children;
      const float = image.attributes.float === undefined ? {} : { dataFloat: image.attributes.float };
      const figcaption = caption === undefined ? [] : [element('figcaption', {}, state.all(caption))];
      return element('figure', { className: ['figure'], ...float }, [imageElement(image), ...figcaption]);
    },
    blockquote(state, node) {
      const last = node.children.at(-1);
      const first = last?.type === 'paragraph' ? last.children[0] : undefined;
      if (node.children.length < 2 || first?.type !== 'text' || !first.value.startsWith(ATTRIBUTION_PREFIX)) {
        return element('blockquote', {}, state.wrap(state.all(node), true));
      }
      const quote = { ...node, children: node.children.slice(0, -1) };
      const source = { type: 'paragraph', children: [{ ...first, value: first.value.slice(ATTRIBUTION_PREFIX.length) }, ...last.children.slice(1)] };
      return element('figure', { className: ['quote'] }, [
        element('blockquote', {}, state.wrap(state.all(quote), true)),
        element('figcaption', {}, state.all(source)),
      ]);
    },
    bakeBlock: (state, node) => blockElement(state, node, context),
  };
}

function blockElement(state, node, context) {
  const children = () => state.wrap(state.all(node), true);
  switch (node.name) {
    case 'aside': {
      const title = node.attributes.title === undefined ? [] : [element('p', { className: ['aside-title'] }, [text(node.attributes.title)])];
      return element('aside', { className: ['aside'] }, [...title, ...children()]);
    }
    case 'fold':
      return element('details', { className: ['fold'] }, [element('summary', {}, [text(node.attributes.title ?? '')]), ...children()]);
    case 'recap':
      return element('div', { className: ['recap'] }, children());
    case 'references':
      return element(
        'ol',
        { className: ['references'] },
        context.references().map((entry) => element('li', { id: `reference-${entry.key}`, value: entry.number }, state.all({ type: 'paragraph', children: entry.children }))),
      );
    case 'example':
      return element('div', { className: ['example'] }, [
        element('div', { className: ['example-source'] }, [highlightCode(context.highlighter, node.sourceText, 'markdown')]),
        element('div', { className: ['example-result'] }, children()),
      ]);
    case 'list-table':
      if (node.rows === undefined) return element('div', { dataBlock: node.name }, children());
      return element('div', { className: ['table-scroll'] }, [listTable(state, node.rows)]);
    case '':
      return element('div', { dataWidth: node.attributes.width }, children());
    default:
      return element('div', { dataBlock: node.name }, children());
  }
}

function listTable(state, [header, ...rows]) {
  const row = (cells, tagName) => element('tr', {}, cells.map((cell) => element(tagName, {}, cellContent(state, cell))));
  return element('table', { className: ['list-table'] }, [
    element('thead', {}, [row(header, 'th')]),
    element('tbody', {}, rows.map((cells) => row(cells, 'td'))),
  ]);
}

function cellContent(state, cell) {
  const [only] = cell.children;
  if (cell.children.length === 1 && only.type === 'paragraph') return state.all(only);
  return state.wrap(state.all(cell), true);
}

function imageElement(node) {
  const { src, width, height, style } = node.published;
  return element('img', { src, alt: node.alt ?? '', width, height, loading: 'lazy', decoding: 'async', ...(style === undefined ? {} : { style }) }, []);
}

function element(tagName, properties, children) {
  return { type: 'element', tagName, properties, children };
}

function text(value) {
  return { type: 'text', value };
}

function raw(value) {
  return { type: 'raw', value };
}
