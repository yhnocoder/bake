import { toHtml } from 'hast-util-to-html';
import { defaultHandlers, toHast } from 'mdast-util-to-hast';
import { addressHref, percentDecode } from '../build/urls.js';
import { highlightCode } from './code.js';
import { equationHref, relocateMath } from './math.js';

const ATTRIBUTION_PREFIX = '— ';
const RELATIVE_URL = /^(?![A-Za-z][A-Za-z0-9+.-]*:|\/|\?)/;

export function resultWidths(example) {
  const widths = new Set();
  const visit = (node) => {
    if (node.component !== undefined) widths.add(node.component.width ?? node.component.naturalWidth);
    if (node.type === 'figure' && node.children[0].published?.boxWidth?.endsWith('px')) widths.add(node.children[0].published.boxWidth);
    if (node.type === 'bakeBlock' && node.name === 'example') return;
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of example.children) visit(child);
  return [...widths];
}

export function renderHtml(node, context) {
  const tree = toHast(node, { allowDangerousHtml: true, handlers: handlers(context) });
  return toHtml(tree, { allowDangerousHtml: true });
}

export function renderChildrenHtml(children, context) {
  return renderHtml({ type: 'root', children }, context);
}

export function renderHast(children, context) {
  return toHast({ type: 'root', children }, { allowDangerousHtml: true, handlers: handlers(context) });
}

export function renderInlineHtml(children, context) {
  const paragraph = toHast({ type: 'paragraph', children }, { allowDangerousHtml: true, handlers: handlers(context) });
  return toHtml({ type: 'root', children: paragraph.children }, { allowDangerousHtml: true });
}

function handlers(context) {
  const { excerpt } = context;
  const relocate = (href) => (excerpt === undefined ? href : `${excerpt.base}${href}`);
  return {
    highlight: (state, node) => element('mark', {}, state.all(node)),
    heading(state, node) {
      if (excerpt !== undefined) return element(`h${node.depth}`, writtenAttributes(node.attributes), state.all(node));
      const result = defaultHandlers.heading(state, node);
      return { ...result, properties: { ...result.properties, ...writtenAttributes(node.attributes) } };
    },
    paragraph(state, node) {
      if (excerpt === undefined) return defaultHandlers.paragraph(state, node);
      return element('p', {}, state.all(node));
    },
    html: (state, node) => raw(excerpt === undefined ? node.value : node.rawHtml.withoutIds),
    link(state, node) {
      const result = defaultHandlers.link(state, node);
      const anchor = excerpt !== undefined && node.url.startsWith('#') ? percentDecode(node.url.slice(1)) : null;
      const target = node.target ?? (anchor === null ? undefined : excerpt.target(anchor));
      if (target !== undefined) {
        const { address, page } = target;
        result.properties = { className: ['internal-link'], ...result.properties, href: addressHref(context.root, address.path, address.anchor, address.query) };
        if (page.article !== null) {
          result.properties.dataTarget = address.text;
          context.linked(target);
        }
      } else if (excerpt !== undefined && RELATIVE_URL.test(node.url)) {
        result.properties.href = relocate(result.properties.href);
      }
      return result;
    },
    footnoteReference(state, node) {
      if (excerpt !== undefined) return undefined;
      const number = context.sidenoteNumber(node.identifier);
      const link = element('a', { href: `#sidenote-${number}` }, [text(String(number))]);
      return element('sup', { className: ['sidenote-ref'], dataSidenote: number }, [link]);
    },
    missingFootnote: (state, node) => text(`[^${node.label}]`),
    citation(state, node) {
      const number = context.citationNumber(node.key);
      if (number === undefined) return text(`[@${node.key}]`);
      const target = excerpt?.target(`reference-${node.key}`);
      const properties = target === undefined ? {} : { dataTarget: target.address.text };
      return element('a', { className: ['citation'], href: relocate(`#reference-${node.key}`), ...properties }, [text(`[${number}]`)]);
    },
    eqref(state, node) {
      const equation = context.equation(node.label);
      if (equation === undefined) return text(node.value);
      return element('a', { className: ['eqref'], href: relocate(equationHref(equation.id)) }, [text(`(${equation.tag})`)]);
    },
    inlineMath: (state, node) => raw(excerpt === undefined ? node.rendered : relocateMath(node.rendered, excerpt.base)),
    math: (state, node) => raw(excerpt === undefined ? node.rendered : relocateMath(node.rendered, excerpt.base)),
    code: (state, node) => highlightCode(context.highlighter, node.value, node.lang ?? undefined),
    table: (state, node) => element('div', { className: ['table-scroll'] }, [defaultHandlers.table(state, node)]),
    image: (state, node) => imageElement(node, true, relocate),
    figure(state, node) {
      const [image, caption] = node.children;
      const float = image.attributes.float === undefined ? {} : { dataFloat: image.attributes.float };
      const figcaption = caption === undefined ? [] : [element('figcaption', {}, state.all(caption))];
      const { boxWidth } = image.published;
      const style = boxWidth === undefined ? {} : { style: `width:${boxWidth}` };
      return element('figure', { className: ['figure'], ...float, ...style }, [imageElement(image, false, relocate), ...figcaption]);
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
    case 'references': {
      const id = (entry) => (context.excerpt === undefined ? { id: `reference-${entry.key}` } : {});
      const item = (entry) => element('li', { ...id(entry), value: entry.number }, state.all({ type: 'paragraph', children: entry.children }));
      const cited = context.references().filter((entry) => entry.number !== undefined);
      const uncited = context.references().filter((entry) => entry.number === undefined);
      return [
        ...(cited.length === 0 ? [] : [element('ol', { className: ['references'] }, cited.map(item))]),
        ...(uncited.length === 0 ? [] : [element('ul', { className: ['references', 'uncited'] }, uncited.map(item))]),
      ];
    }
    case 'example': {
      const widths = resultWidths(node);
      return element('div', { className: ['example'], ...(widths.length === 0 ? {} : { dataResultWidths: widths.join(' ') }) }, [
        element('div', { className: ['example-source'] }, [highlightCode(context.highlighter, node.sourceText, 'markdown')]),
        element('div', { className: ['example-result'] }, children()),
      ]);
    }
    case 'list-table':
      if (node.rows === undefined) return element('div', { dataBlock: node.name }, children());
      return element('div', { className: ['table-scroll'] }, [listTable(state, node.rows)]);
    case 'embed':
      return context.excerpt === undefined ? embedElement(context.embed(node)) : embedLinks(context.embedLinks(node));
    case '':
      return element('div', { dataWidth: node.attributes.width }, children());
    default:
      if (node.component !== undefined) {
        if (context.excerpt?.mode === 'preview') return node.children.length === 0 ? [] : element('div', { className: ['component-caption'] }, children());
        return componentElement(state, node, context);
      }
      return element('div', { dataBlock: node.name }, children());
  }
}

function componentElement(state, node, context) {
  const { frame, frameWidth, height, narrowHeight } = node.component;
  const properties = { className: ['component'], dataComponent: node.name, dataParams: JSON.stringify(componentParams(node.component, context.excerpt)), ...writtenAttributes(node.attributes) };
  if (!frame) properties.dataFrame = 'none';
  if (frameWidth !== undefined) properties.style = `width:${frameWidth}`;
  const boxStyle = [
    `--component-height:${height.height}`,
    `--component-ratio:${height.ratio}`,
    `--component-narrow-height:${narrowHeight.height}`,
    `--component-narrow-ratio:${narrowHeight.ratio}`,
  ].join(';');
  const box = element('div', { className: ['component-box'], style: boxStyle }, []);
  const caption = node.children.length === 0 ? [] : [element('figcaption', {}, cellContent(state, node))];
  return element('figure', properties, [box, ...caption]);
}

function writtenAttributes(attributes) {
  return attributes === undefined || Object.keys(attributes).length === 0 ? {} : { dataAttributes: JSON.stringify(attributes) };
}

function componentParams({ params, fileParams }, excerpt) {
  if (excerpt === undefined) return params;
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name, fileParams.includes(name) && value !== '' ? `${excerpt.base}${value}` : value]));
}

function embedElement(parts) {
  return element(
    'div',
    { className: ['embed'] },
    parts.map((part) => {
      const number = part.number === undefined ? [] : [element('span', { className: ['embed-number'] }, [text(part.number)])];
      const source = element('p', { className: ['embed-source'] }, [element('a', { href: part.href }, [element('cite', {}, [text(part.article)]), ...number])]);
      return element('div', { className: ['embed-part'] }, [...part.children, source]);
    }),
  );
}

function embedLinks(links) {
  return links.map((link) => element('p', { className: ['embed-link'] }, [element('a', { className: ['internal-link'], href: link.href, dataTarget: link.target }, [text(link.text)])]));
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

function imageElement(node, sized, relocate) {
  const { width, height, boxWidth } = node.published;
  const src = RELATIVE_URL.test(node.published.src) ? relocate(node.published.src) : node.published.src;
  const style = sized && boxWidth !== undefined ? { style: `width:${boxWidth};height:auto` } : {};
  return element('img', { src, alt: node.alt ?? '', width, height, loading: 'lazy', decoding: 'async', ...style }, []);
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
