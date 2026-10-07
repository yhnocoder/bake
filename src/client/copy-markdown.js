import { toMarkdown } from 'mdast-util-to-markdown';
import { markdownOptions, toMarkdownExtensions } from '../format/to-markdown.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const skipped = 'a.anchor, .card-title, .sidenote-number, .callout-label, details[data-md] > summary, input';
const phrasingTags = new Set(['A', 'ABBR', 'B', 'BR', 'CODE', 'DEL', 'EM', 'I', 'KBD', 'MARK', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'U']);
const phrasingTypes = new Set(['text', 'emphasis', 'strong', 'inlineCode', 'mark', 'delete', 'link', 'inlineMath', 'footnoteReference', 'break']);
const wrappers = { STRONG: 'strong', EM: 'emphasis', MARK: 'mark', DEL: 'delete' };
const sidenoteLabel = /^\[\^([^\]]+)\]:/;

function isComponent(element) {
  return element.localName.includes('-');
}

function wholeElement(node) {
  for (let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; element; element = element.parentElement) {
    if (element.matches('[data-tex], aside.sidenote') || isComponent(element)) return element;
  }
  return null;
}

function expand(range) {
  const start = wholeElement(range.startContainer);
  const end = wholeElement(range.endContainer);
  if (start) range.setStartBefore(start);
  if (end) range.setEndAfter(end);
}

function isPhrasing(node) {
  return phrasingTypes.has(node.type) || node.data?.phrasing === true;
}

function trimEdges(children) {
  const nodes = children.filter((node) => node.type !== 'text' || node.value !== '');
  const first = nodes[0];
  const last = nodes.at(-1);
  if (first?.type === 'text') first.value = first.value.replace(/^\s+/, '');
  if (last?.type === 'text') last.value = last.value.replace(/\s+$/, '');
  return nodes.filter((node) => node.type !== 'text' || node.value !== '');
}

function stripBase(href) {
  const base = import.meta.env.BASE_URL;
  return base !== '/' && href.startsWith(base) ? `/${href.slice(base.length)}` : href;
}

function createConverter(range) {
  const document = range.commonAncestorContainer.ownerDocument;
  const pendingNotes = [];

  function contains(node) {
    const nodeRange = document.createRange();
    nodeRange.selectNode(node);
    return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0;
  }

  function selectedText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      const start = node === range.startContainer ? range.startOffset : 0;
      return node.data.slice(start, end);
    }
    return [...node.childNodes].filter((child) => range.intersectsNode(child)).map(selectedText).join('');
  }

  function children(element) {
    return [...element.childNodes].filter((child) => range.intersectsNode(child)).flatMap(convert);
  }

  function phrasing(element) {
    const nodes = [];
    for (const node of children(element)) {
      const previous = nodes.at(-1);
      if (node.type === 'text' && previous?.type === 'break') node.value = node.value.replace(/^\n/, '');
      nodes.push(node);
    }
    return trimEdges(nodes);
  }

  function flow(nodes) {
    const blocks = [];
    let run = [];
    const flush = () => {
      const content = trimEdges(run);
      if (content.length > 0) blocks.push({ type: 'paragraph', children: content });
      run = [];
    };
    for (const node of nodes) {
      if (isPhrasing(node)) run.push(node);
      else {
        flush();
        blocks.push(node);
      }
    }
    flush();
    return blocks;
  }

  function source(element, type, value) {
    return { type, value, data: { phrasing: phrasingTags.has(element.tagName) } };
  }

  function sidenoteReference(element) {
    const aside = document.getElementById(`sn-${element.id.slice('sn-ref-'.length)}`);
    const label = sidenoteLabel.exec(aside?.dataset.md ?? '')?.[1];
    if (!label) return [];
    if (!range.intersectsNode(aside)) pendingNotes.push(aside);
    return [{ type: 'footnoteReference', identifier: label.toLowerCase(), label }];
  }

  function list(element) {
    const items = [...element.children]
      .filter((item) => item.tagName === 'LI' && range.intersectsNode(item))
      .map((item) => {
        const checkbox = item.querySelector(':scope > input[type="checkbox"]');
        return { type: 'listItem', spread: item.querySelector(':scope > p') !== null, checked: checkbox ? checkbox.checked : null, children: flow(children(item)) };
      });
    const start = element.tagName === 'OL' ? Number(element.getAttribute('start') ?? 1) : null;
    return { type: 'list', ordered: element.tagName === 'OL', start, spread: items.some((item) => item.spread), children: items };
  }

  function table(element) {
    const rows = [...element.querySelectorAll('tr')].filter((row) => range.intersectsNode(row));
    const align = [...(element.querySelector('tr')?.cells ?? [])].map((cell) => cell.getAttribute('align'));
    return {
      type: 'table',
      align,
      children: rows.map((row) => ({ type: 'tableRow', children: [...row.cells].map((cell) => ({ type: 'tableCell', children: range.intersectsNode(cell) ? phrasing(cell) : [] })) })),
    };
  }

  function code(element) {
    const value = (contains(element) ? element.textContent : selectedText(element)).replace(/\n$/, '');
    const lang = [...(element.querySelector('code')?.classList ?? [])].find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? null;
    return { type: 'code', lang, meta: null, value };
  }

  function convertElement(element) {
    if (element.matches(skipped)) return [];
    if (element.matches('[data-tex]')) {
      return [{ type: element.classList.contains('display') ? 'math' : 'inlineMath', value: element.dataset.tex }];
    }
    const heading = /^H[2-6]$/.test(element.tagName);
    if (element.hasAttribute('data-md')) {
      if (contains(element) || isComponent(element) || element.matches('aside.sidenote')) return [source(element, 'raw', element.dataset.md)];
      if (!heading) return children(element);
    }
    if (heading) return [{ type: 'heading', depth: Number(element.tagName[1]), children: phrasing(element) }];
    if (wrappers[element.tagName]) return [{ type: wrappers[element.tagName], children: phrasing(element) }];
    if (element.matches('sup.sidenote-ref')) return sidenoteReference(element);
    switch (element.tagName) {
      case 'P':
        return [{ type: 'paragraph', children: phrasing(element), ...(element.id ? { data: { blockId: element.id } } : {}) }];
      case 'CODE':
        return [{ type: 'inlineCode', value: selectedText(element) }];
      case 'A':
        return [{ type: 'link', url: stripBase(element.getAttribute('href') ?? ''), title: element.getAttribute('title'), children: phrasing(element) }];
      case 'UL':
      case 'OL':
        return [list(element)];
      case 'BLOCKQUOTE':
        return [{ type: 'blockquote', children: flow(children(element)) }];
      case 'PRE':
        return [code(element)];
      case 'TABLE':
        return [table(element)];
      case 'HR':
        return [{ type: 'thematicBreak' }];
      case 'BR':
        return [{ type: 'break' }];
    }
    if (element.matches('figure.quote')) return [{ type: 'blockquote', children: flow(children(element).flatMap((node) => (node.type === 'blockquote' ? node.children : [node]))) }];
    if (element.matches('.table-scroll') || !contains(element)) return children(element);
    return [source(element, 'html', element.outerHTML)];
  }

  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return [{ type: 'text', value: selectedText(node) }];
    if (node.nodeType === Node.ELEMENT_NODE) return convertElement(node);
    return [];
  }

  function root(container) {
    const blocks = [];
    for (const child of container.childNodes) {
      if (!range.intersectsNode(child)) continue;
      blocks.push(...convert(child));
      for (const aside of pendingNotes.splice(0)) blocks.push({ type: 'raw', value: aside.dataset.md });
    }
    return { type: 'root', children: flow(blocks) };
  }

  return { root };
}

export function rangeToMarkdown(range, container) {
  const tree = createConverter(range).root(container);
  return toMarkdown(tree, { ...markdownOptions, extensions: toMarkdownExtensions }).replace(/\n$/, '');
}

export function toClipboardHtml(dom) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-bake-markdown', '');
  const ids = new Set([...dom.querySelectorAll('use')].map((use) => (use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').slice(1)));
  const defs = document.getElementById('math-defs');
  const glyphs = defs ? [...ids].map((id) => defs.querySelector(`[id="${CSS.escape(id)}"]`)).filter(Boolean) : [];
  if (glyphs.length > 0) {
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('style', 'display:none');
    const glyphDefs = document.createElementNS(svgNamespace, 'defs');
    glyphDefs.append(...glyphs.map((glyph) => glyph.cloneNode(true)));
    svg.append(glyphDefs);
    wrapper.append(svg);
  }
  wrapper.append(...dom.cloneNode(true).childNodes);
  return wrapper.outerHTML;
}

export function installCopy(document) {
  document.addEventListener('copy', (event) => {
    const selection = document.getSelection();
    if (event.defaultPrevented || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0).cloneRange();
    const ancestor = range.commonAncestorContainer;
    const article = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement).closest('article');
    if (!article) return;
    const pre = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement).closest('pre');
    expand(range);
    const holder = document.createElement('div');
    holder.append(range.cloneContents());
    event.clipboardData.setData('text/plain', pre ? range.toString() : rangeToMarkdown(range, article));
    event.clipboardData.setData('text/html', toClipboardHtml(holder));
    event.preventDefault();
  });
}
