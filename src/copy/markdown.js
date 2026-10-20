import { fragmentOf, idOfFragment } from '../fragments.js';
import { serializeMarkdown } from '../markdown/serialize.js';

export const UI = '[data-ui]';

export const NOTE = '[data-sidenote][data-line]';
const UNIT = '[data-line][data-end-line]';
const ATOMIC = 'mjx-container, img, svg, input, .component-box';
const INLINE_LEAF = 'p, h1, h2, h3, h4, h5, h6, td, th, figcaption, summary, li, dt, dd';
const BLOCK =
  'address, article, aside, blockquote, details, dialog, div, dl, dt, dd, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, summary, table, thead, tbody, tfoot, tr, td, th, ul, mjx-container[display="true"]';
const HEADING = 'h1, h2, h3, h4, h5, h6';
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const ATTENTION = [
  ['mark', 'highlight'],
  ['strong, b', 'strong'],
  ['em, i, cite', 'emphasis'],
  ['del, s', 'delete'],
];

export function sidenoteElement(article, number) {
  return [...article.querySelectorAll(NOTE)].find((note) => note.dataset.sidenote === String(number) && note.closest(UI) === null) ?? null;
}

export function isUi(element, article) {
  const ui = element.closest(UI);
  if (ui === null || !article.contains(ui)) return false;
  const note = element.closest(NOTE);
  return note === null || note.contains(ui);
}

export class MarkdownWriter {
  constructor(range, article, lines) {
    this.range = range;
    this.article = article;
    this.lines = lines;
    this.notes = [];
    this.copied = [];
  }

  write() {
    const common = this.range.commonAncestorContainer;
    const start = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    const selection = this.selection(start);
    const footnotes = this.footnotes().map(verbatim);
    return tidy(serializeMarkdown({ type: 'root', children: [...selection, ...footnotes] }));
  }

  selection(start) {
    const unit = start.closest(UNIT);
    if (unit !== null && this.article.contains(unit) && this.isWhole(unit)) return [this.unitSource(unit)];
    const pre = start.closest('pre');
    if (pre !== null) return [verbatim(this.selectedText(pre))];
    const math = start.closest('mjx-container[data-tex]');
    if (math !== null) return [this.math(math)];
    const leaf = start.closest(INLINE_LEAF);
    if (leaf !== null && this.article.contains(leaf) && !this.hasSelectedBlock(leaf)) return paragraph(this.inline(leaf));
    return this.block(start.closest('table') ?? start);
  }

  isWhole(unit) {
    const component = unit.querySelector('figure.component');
    if (component !== null && this.leaves(unit).every((leaf) => component.contains(leaf))) return this.hasSelection(unit);
    return this.covers(unit);
  }

  unitSource(unit) {
    const line = Number(unit.dataset.line);
    const endLine = Number(unit.dataset.endLine);
    this.copied.push([line, endLine]);
    for (const reference of unit.querySelectorAll('sup.sidenote-ref[data-sidenote]')) this.addNote(reference.dataset.sidenote);
    const text = this.lines.slice(line - 1, endLine).join('\n');
    return verbatim(unit.matches(NOTE) ? noteBody(text, unit.dataset.label) : text);
  }

  leaves(element) {
    const found = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.data.trim() !== '') found.push(child);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE || child.matches(UI) || child.matches(NOTE)) continue;
        if (child.matches(ATOMIC)) found.push(child);
        else visit(child);
      }
    };
    visit(element);
    return found;
  }

  covers(element) {
    const leaves = this.leaves(element);
    if (leaves.length === 0) return this.range.intersectsNode(element);
    const first = leaves[0];
    const last = leaves.at(-1);
    const [startNode, startOffset] = first.nodeType === Node.TEXT_NODE ? [first, first.data.search(/\S/)] : [first.parentNode, indexOf(first)];
    const [endNode, endOffset] = last.nodeType === Node.TEXT_NODE ? [last, last.data.trimEnd().length] : [last.parentNode, indexOf(last) + 1];
    return this.range.comparePoint(startNode, startOffset) === 0 && this.range.comparePoint(endNode, endOffset) === 0;
  }

  hasSelection(element) {
    if (!this.range.intersectsNode(element)) return false;
    if (element.nodeType === Node.TEXT_NODE) return this.textPart(element).trim() !== '';
    if (element.matches(ATOMIC)) return true;
    return this.leaves(element).some((leaf) => (leaf.nodeType === Node.TEXT_NODE ? this.textPart(leaf).trim() !== '' : this.range.intersectsNode(leaf)));
  }

  hasSelectedBlock(element) {
    return [...element.children].some((child) => child.matches(BLOCK) && !child.matches(UI) && this.hasSelection(child));
  }

  textPart(text) {
    if (!this.range.intersectsNode(text)) return '';
    const start = this.range.startContainer === text ? this.range.startOffset : 0;
    const end = this.range.endContainer === text ? this.range.endOffset : text.data.length;
    return text.data.slice(start, end);
  }

  selectedText(element) {
    let text = '';
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += this.textPart(child);
        else if (child.nodeType === Node.ELEMENT_NODE && !child.matches(UI)) visit(child);
      }
    };
    visit(element);
    return text;
  }

  whole(element, write) {
    const saved = this.range;
    this.range = document.createRange();
    this.range.selectNodeContents(element);
    try {
      return write();
    } finally {
      this.range = saved;
    }
  }

  blocks(parent) {
    const nodes = [];
    let run = [];
    const flush = () => {
      nodes.push(...paragraph(run));
      run = [];
    };
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        run.push(text(this.textPart(child)));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || child.matches(UI) || child.matches(NOTE) || !this.hasSelection(child)) continue;
      if (!child.matches(BLOCK)) {
        run.push(...this.inlineElement(child));
        continue;
      }
      flush();
      nodes.push(...this.block(child));
    }
    flush();
    return nodes;
  }

  block(element) {
    if (element.matches(UNIT) && (this.isWhole(element) || element.matches(HEADING))) return [this.unitSource(element)];
    if (element.matches('summary, .aside-title, .embed-source')) return [];
    if (element.matches('p')) return paragraph(this.inline(element));
    if (element.matches(HEADING)) return [{ type: 'heading', depth: Number(element.tagName[1]), children: trimPhrasing(this.inline(element)), attributes: writtenAttributes(element) }];
    if (element.matches('.example-source')) return [verbatim(this.selectedText(element).replace(/\n+$/, ''))];
    if (element.matches('pre')) return [this.code(element)];
    if (element.matches('mjx-container[data-tex]')) return [this.math(element)];
    if (element.matches('ul, ol')) return element.matches('.references') ? [this.references(element)] : this.list(element);
    if (element.matches('blockquote')) return [{ type: 'blockquote', children: this.blocks(element) }];
    if (element.matches('figure.quote')) return [this.quoteWithSource(element)];
    if (element.matches('figure.figure')) return this.figure(element);
    if (element.matches('figure.component')) return [this.component(element)];
    if (element.matches('table')) return element.matches('.list-table') ? [this.listTable(element)] : this.table(element);
    if (element.matches('aside.aside')) return [this.aside(element)];
    if (element.matches('details.fold')) return this.fold(element);
    if (element.matches('.recap')) return [bakeBlock('recap', {}, this.blocks(element))];
    if (element.matches('div[data-width]:not([data-line])')) return [bakeBlock('', { width: element.dataset.width }, this.blocks(element))];
    if (element.matches('hr')) return [{ type: 'thematicBreak' }];
    return this.blocks(element);
  }

  inline(element) {
    const nodes = [];
    for (const child of element.childNodes) {
      if (!this.range.intersectsNode(child)) continue;
      if (child.nodeType === Node.TEXT_NODE) nodes.push(text(this.textPart(child)));
      else if (child.nodeType === Node.ELEMENT_NODE) nodes.push(...this.inlineElement(child));
    }
    return nodes;
  }

  inlineElement(element) {
    if (element.matches(UI) || element.matches(NOTE) || element.matches('.component-box, svg, script, template, input')) return [];
    if (element.matches('mjx-container[data-tex]')) return [{ type: 'inlineMath', value: element.dataset.tex.trim() }];
    if (element.matches('sup.sidenote-ref[data-sidenote]')) {
      const label = this.addNote(element.dataset.sidenote);
      return [{ type: 'footnoteReference', identifier: label, label }];
    }
    if (element.matches('a.citation')) return [{ type: 'citation', key: element.dataset.key }];
    if (element.matches('a.eqref')) return [{ type: 'eqref', label: idOfFragment(hashOf(element.getAttribute('href'))) }];
    if (element.matches('br')) return [{ type: 'break' }];
    if (element.matches('img')) return [image(element, element.style.width === '' ? {} : { width: element.style.width })];
    if (element.matches('code')) return [{ type: 'inlineCode', value: this.selectedText(element) }];
    const inner = this.inline(element);
    if (inner.every(isBlank)) return inner;
    const attention = ATTENTION.find(([selector]) => element.matches(selector));
    if (attention !== undefined) return hoistWhitespace(inner, (children) => ({ type: attention[1], children }));
    if (element.matches('a[href]')) return [{ type: 'link', url: element.dataset.target === undefined ? element.getAttribute('href') : siteAddress(element.dataset.target), children: inner }];
    return inner;
  }

  math(element) {
    const value = element.dataset.tex.trim();
    return element.getAttribute('display') === 'true' ? { type: 'math', value } : { type: 'paragraph', children: [{ type: 'inlineMath', value }] };
  }

  code(pre) {
    return { type: 'code', lang: pre.dataset.language ?? null, value: this.selectedText(pre).replace(/\n$/, '') };
  }

  list(element) {
    const ordered = element.matches('ol');
    const first = Number(element.getAttribute('start') ?? 1);
    const items = [...element.children].filter((child) => child.matches('li'));
    const spread = items.some((item) => [...item.children].some((child) => child.matches('p')));
    const selected = items.filter((item) => this.hasSelection(item));
    if (selected.length === 0) return [];
    const children = selected.map((item) => ({ type: 'listItem', spread, checked: checkedOf(item), children: this.blocks(item) }));
    return [{ type: 'list', ordered, start: first + items.indexOf(selected[0]), spread, children }];
  }

  references(element) {
    const items = [...element.children]
      .filter((item) => item.matches('li') && this.hasSelection(item))
      .map((item) => listItem([{ type: 'paragraph', children: [{ type: 'citation', key: item.dataset.key }, text(' '), ...trimPhrasing(this.inline(item.querySelector('p') ?? item))] }]));
    return bakeBlock('references', {}, [tightList(items)]);
  }

  quoteWithSource(figure) {
    const children = [];
    const blockquote = figure.querySelector(':scope > blockquote');
    const caption = figure.querySelector(':scope > figcaption');
    if (blockquote !== null && this.hasSelection(blockquote)) children.push(...this.blocks(blockquote));
    if (caption !== null && this.hasSelection(caption)) children.push(...paragraph([text('— '), ...trimPhrasing(this.inline(caption))]));
    return { type: 'blockquote', children };
  }

  figure(figure) {
    const element = figure.querySelector('img');
    const caption = figure.querySelector(':scope > figcaption');
    if (element === null) return this.blocks(figure);
    const attributes = {};
    if (figure.style.width !== '') attributes.width = figure.style.width;
    if (figure.dataset.float !== undefined) attributes.float = figure.dataset.float;
    const title = caption === null ? null : tidy(serializeMarkdown({ type: 'root', children: paragraph(this.whole(caption, () => this.inline(caption))) }));
    return [{ type: 'paragraph', children: [{ ...image(element, attributes), title }] }];
  }

  fold(details) {
    const summary = details.querySelector(':scope > summary');
    const body = this.blocks(details);
    if (body.length === 0 && summary !== null && this.hasSelection(summary)) return paragraph(this.inline(summary));
    return [bakeBlock('fold', { title: summary?.textContent ?? '' }, body)];
  }

  component(figure) {
    const caption = figure.querySelector(':scope > figcaption');
    return bakeBlock(figure.dataset.component, writtenAttributes(figure), caption === null ? [] : this.whole(caption, () => this.blocks(caption)));
  }

  aside(element) {
    const title = element.querySelector(':scope > .aside-title');
    return bakeBlock('aside', title === null ? {} : { title: title.textContent }, this.blocks(element));
  }

  table(table) {
    const rows = [...table.rows];
    const header = table.tHead?.rows[0] ?? rows[0];
    if (header === undefined) return [];
    const tableRow = (row) => ({ type: 'tableRow', children: [...row.cells].map((cell) => ({ type: 'tableCell', children: singleLine(trimPhrasing(this.whole(cell, () => this.inline(cell)))) })) });
    const align = [...header.cells].map((cell) => alignmentOf(cell.getAttribute('align') ?? cell.style.textAlign));
    return [{ type: 'table', align, children: [tableRow(header), ...rows.filter((row) => row !== header && this.hasSelection(row)).map(tableRow)] }];
  }

  listTable(table) {
    const header = table.tHead?.rows[0];
    const rows = [header, ...[...(table.tBodies[0]?.rows ?? [])].filter((row) => this.hasSelection(row))].filter((row) => row !== undefined);
    const cells = (row) => tightList([...row.cells].map((cell) => listItem(this.whole(cell, () => this.blocks(cell)))));
    return bakeBlock('list-table', {}, [tightList(rows.map((row) => listItem([cells(row)])))]);
  }

  addNote(number) {
    if (!this.notes.includes(number)) this.notes.push(number);
    return sidenoteElement(this.article, number)?.dataset.label ?? number;
  }

  footnotes() {
    const definitions = [];
    for (let index = 0; index < this.notes.length; index += 1) {
      const number = this.notes[index];
      const note = sidenoteElement(this.article, number);
      if (note === null) continue;
      const line = Number(note.dataset.line);
      if (this.copied.some(([start, end]) => line >= start && line <= end)) continue;
      for (const reference of note.querySelectorAll('sup.sidenote-ref[data-sidenote]')) this.addNote(reference.dataset.sidenote);
      definitions.push(dedentDefinition(this.lines.slice(line - 1, Number(note.dataset.endLine))));
    }
    return definitions;
  }
}

function indexOf(node) {
  return [...node.parentNode.childNodes].indexOf(node);
}

function hashOf(href) {
  return href.slice(href.indexOf('#'));
}

function siteAddress(target) {
  const hash = target.indexOf('#');
  return hash === -1 ? target : `${target.slice(0, hash)}${fragmentOf(target.slice(hash + 1))}`;
}

function text(value) {
  return { type: 'text', value };
}

function verbatim(value) {
  return { type: 'verbatim', value };
}

function bakeBlock(name, attributes, children) {
  return { type: 'bakeBlock', name, attributes, children };
}

function listItem(children) {
  return { type: 'listItem', spread: false, children };
}

function tightList(children) {
  return { type: 'list', ordered: false, spread: false, children };
}

function image(element, attributes) {
  return { type: 'image', url: element.getAttribute('src'), alt: element.getAttribute('alt') ?? '', attributes };
}

function paragraph(nodes) {
  const children = trimPhrasing(nodes);
  return children.length === 0 ? [] : [{ type: 'paragraph', children }];
}

function isBlank(node) {
  return node.type === 'text' && node.value.trim() === '';
}

function trimPhrasing(nodes) {
  const children = nodes.filter((node) => node.type !== 'text' || node.value !== '');
  while (children[0]?.type === 'text') {
    const value = children[0].value.trimStart();
    if (value !== '') {
      children[0] = text(value);
      break;
    }
    children.shift();
  }
  while (children.at(-1)?.type === 'text') {
    const value = children.at(-1).value.trimEnd();
    if (value !== '') {
      children[children.length - 1] = text(value);
      break;
    }
    children.pop();
  }
  return children;
}

function hoistWhitespace(nodes, wrap) {
  const children = [...nodes];
  const before = [];
  const after = [];
  const [leading] = children[0]?.type === 'text' ? /^\s*/.exec(children[0].value) : [''];
  if (leading !== '') {
    before.push(text(leading));
    children[0] = text(children[0].value.slice(leading.length));
  }
  const [trailing] = children.at(-1)?.type === 'text' ? /\s*$/.exec(children.at(-1).value) : [''];
  if (trailing !== '') {
    after.push(text(trailing));
    children[children.length - 1] = text(children.at(-1).value.slice(0, -trailing.length));
  }
  return [...before, wrap(children.filter((node) => node.type !== 'text' || node.value !== '')), ...after];
}

function singleLine(nodes) {
  return nodes.map((node) => (node.type === 'text' ? text(node.value.replaceAll('\n', ' ')) : node));
}

function checkedOf(item) {
  const box = item.querySelector(':scope > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]');
  return box === null ? null : box.checked;
}

function alignmentOf(align) {
  return ALIGNMENTS.has(align) ? align : null;
}

function writtenAttributes(element) {
  return JSON.parse(element.dataset.attributes ?? '{}');
}

function dedentDefinition(lines) {
  const prefix = lines[0].slice(0, Math.max(0, lines[0].indexOf('[^')));
  return lines
    .map((line, index) => {
      if (index === 0 || line.startsWith(prefix)) return line.slice(prefix.length);
      return line.replace(new RegExp(`^[ \\t>]{0,${prefix.length}}`), '');
    })
    .join('\n');
}

function noteBody(definition, label) {
  const [first, ...rest] = dedentDefinition(definition.split('\n')).split('\n');
  const body = first.slice(`[^${label}]:`.length).replace(/^[ \t]/, '');
  const indents = rest.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)[0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return [body, ...rest.map((line) => line.slice(common))].join('\n');
}

function tidy(text) {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}
