import { toHtml } from 'hast-util-to-html';
import { toHast } from 'mdast-util-to-hast';

const ATTRIBUTION_PREFIX = '— ';

export function renderHtml(node, notes) {
  const tree = toHast(node, { allowDangerousHtml: true, handlers: handlers(notes) });
  return toHtml(tree, { allowDangerousHtml: true });
}

export function renderChildrenHtml(children, notes) {
  return renderHtml({ type: 'root', children }, notes);
}

export function renderInlineHtml(children, notes) {
  const paragraph = toHast({ type: 'paragraph', children }, { allowDangerousHtml: true, handlers: handlers(notes) });
  return toHtml({ type: 'root', children: paragraph.children }, { allowDangerousHtml: true });
}

function handlers(notes) {
  return {
    highlight: (state, node) => element('mark', {}, state.all(node)),
    footnoteReference(state, node) {
      const number = notes.sidenoteNumber(node.identifier);
      const link = element('a', { href: `#sidenote-${number}` }, [text(String(number))]);
      return element('sup', { className: ['sidenote-ref'], dataSidenote: number }, [link]);
    },
    missingFootnote: (state, node) => text(`[^${node.label}]`),
    citation(state, node) {
      const number = notes.citationNumber(node.key);
      if (number === undefined) return text(`[@${node.key}]`);
      return element('a', { className: ['citation'], href: `#reference-${node.key}` }, [text(`[${number}]`)]);
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
    bakeBlock: (state, node) => blockElement(state, node, notes),
  };
}

function blockElement(state, node, notes) {
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
        notes.references().map((entry) => element('li', { id: `reference-${entry.key}`, value: entry.number }, state.all({ type: 'paragraph', children: entry.children }))),
      );
    case '':
      return element('div', { dataWidth: node.attributes.width }, children());
    default:
      return element('div', { dataBlock: node.name }, children());
  }
}

function element(tagName, properties, children) {
  return { type: 'element', tagName, properties, children };
}

function text(value) {
  return { type: 'text', value };
}
