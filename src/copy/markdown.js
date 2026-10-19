export const UI = '[data-ui]';

const NOTE = '[data-sidenote][data-line]';
const UNIT = '[data-line][data-end-line]';
const ATOMIC = 'mjx-container, img, svg, input, .component-box';
const INLINE_LEAF = 'p, h1, h2, h3, h4, h5, h6, td, th, figcaption, summary, li, dt, dd';
const BLOCK =
  'address, article, aside, blockquote, details, dialog, div, dl, dt, dd, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, summary, table, thead, tbody, tfoot, tr, td, th, ul, mjx-container[display="true"]';
const HEADING = 'h1, h2, h3, h4, h5, h6';
const BARE_VALUE = /^[\w.%/-]+$/;

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
    this.inCell = false;
  }

  write() {
    const common = this.range.commonAncestorContainer;
    const start = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    const markdown = tidy(this.selection(start));
    const footnotes = this.footnotes();
    return footnotes.length === 0 ? markdown : `${markdown}\n\n${footnotes.join('\n\n')}`;
  }

  selection(start) {
    const unit = start.closest(UNIT);
    if (unit !== null && this.article.contains(unit) && this.isWhole(unit)) return this.unitSource(unit);
    const pre = start.closest('pre');
    if (pre !== null) return this.selectedText(pre);
    const math = start.closest('mjx-container[data-tex]');
    if (math !== null) return this.math(math);
    const leaf = start.closest(INLINE_LEAF);
    if (leaf !== null && this.article.contains(leaf) && !this.hasSelectedBlock(leaf)) return this.inline(leaf).trim();
    return this.block(start.closest('table') ?? start);
  }

  isWhole(unit) {
    if (this.lines === null) return false;
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
    return unit.matches(NOTE) ? noteBody(text, unit.dataset.label) : text;
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
    return this.blockChunks(parent).join('\n\n');
  }

  blockChunks(parent) {
    const chunks = [];
    let run = '';
    const flush = () => {
      if (run.trim() !== '') chunks.push(run.trim());
      run = '';
    };
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        run += this.textPart(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || child.matches(UI) || child.matches(NOTE) || !this.hasSelection(child)) continue;
      if (!child.matches(BLOCK)) {
        run += this.inlineElement(child);
        continue;
      }
      flush();
      const block = this.block(child);
      if (block.trim() !== '') chunks.push(block);
    }
    flush();
    return chunks;
  }

  block(element) {
    if (element.matches(UNIT) && (this.isWhole(element) || (this.lines !== null && element.matches(HEADING)))) return this.unitSource(element);
    if (element.matches('summary, .aside-title, .embed-source')) return '';
    if (element.matches('p')) return this.inline(element).trim();
    if (element.matches(HEADING)) return [`${'#'.repeat(Number(element.tagName[1]))} ${this.inline(element).trim()}`, attributeText(writtenAttributes(element))].filter(Boolean).join(' ');
    if (element.matches('.example-source')) return this.selectedText(element).replace(/\n+$/, '');
    if (element.matches('pre')) return this.code(element);
    if (element.matches('mjx-container[data-tex]')) return this.math(element);
    if (element.matches('ul, ol')) return element.matches('.references') ? this.references(element) : this.list(element);
    if (element.matches('blockquote')) return quote(this.blocks(element));
    if (element.matches('figure.quote')) return this.quoteWithSource(element);
    if (element.matches('figure.figure')) return this.figure(element);
    if (element.matches('figure.component')) return this.component(element);
    if (element.matches('table')) return element.matches('.list-table') ? this.listTable(element) : this.table(element);
    if (element.matches('aside.aside')) return this.aside(element);
    if (element.matches('details.fold')) return this.fold(element);
    if (element.matches('.recap')) return fence('recap', {}, this.blocks(element));
    if (element.matches('div[data-width]:not([data-line])')) return fence('', { width: element.dataset.width }, this.blocks(element));
    if (element.matches('hr')) return '---';
    return this.blocks(element);
  }

  inline(element) {
    let text = '';
    for (const child of element.childNodes) {
      if (!this.range.intersectsNode(child)) continue;
      if (child.nodeType === Node.TEXT_NODE) text += this.inCell ? this.textPart(child).replaceAll('|', '\\|') : this.textPart(child);
      else if (child.nodeType === Node.ELEMENT_NODE) text += this.inlineElement(child);
    }
    return text;
  }

  inlineElement(element) {
    if (element.matches(UI) || element.matches(NOTE) || element.matches('.component-box, svg, script, template')) return '';
    if (element.matches('mjx-container[data-tex]')) return element.getAttribute('display') === 'true' ? `$$${element.dataset.tex.trim()}$$` : `$${element.dataset.tex.trim()}$`;
    if (element.matches('sup.sidenote-ref[data-sidenote]')) return `[^${this.addNote(element.dataset.sidenote)}]`;
    if (element.matches('a.citation')) return `[@${anchorOf(element.getAttribute('href')).replace(/^reference-/, '')}]`;
    if (element.matches('a.eqref')) return `\\eqref{${anchorOf(element.getAttribute('href'))}}`;
    if (element.matches('br')) return '\\\n';
    if (element.matches('img')) return `![${element.getAttribute('alt') ?? ''}](${element.getAttribute('src')})${attributeText(element.style.width === '' ? {} : { width: element.style.width })}`;
    if (element.matches('input[type="checkbox"]')) return element.checked ? '[x] ' : '[ ] ';
    if (element.matches('code')) return inlineCode(this.selectedText(element));
    const inner = this.inline(element);
    if (inner.trim() === '') return inner;
    if (element.matches('mark')) return wrap('==', inner);
    if (element.matches('strong, b')) return wrap('**', inner);
    if (element.matches('em, i, cite')) return wrap('*', inner);
    if (element.matches('del, s')) return wrap('~~', inner);
    if (element.matches('a[href]')) return `[${inner}](${element.dataset.target ?? element.getAttribute('href')})`;
    if (element.matches(BLOCK)) return `${this.blocks(element)}\n`;
    return inner;
  }

  math(element) {
    const tex = element.dataset.tex.trim();
    return element.getAttribute('display') === 'true' ? `$$\n${tex}\n$$` : `$${tex}$`;
  }

  code(pre) {
    const text = this.selectedText(pre).replace(/\n$/, '');
    const ticks = '`'.repeat(Math.max(3, longestRun(text, '`') + 1));
    return `${ticks}${pre.dataset.language ?? ''}\n${text}\n${ticks}`;
  }

  list(element) {
    const ordered = element.matches('ol');
    const first = Number(element.getAttribute('start') ?? 1);
    const items = [...element.children].filter((child) => child.matches('li'));
    const loose = items.some((item) => [...item.children].some((child) => child.matches('p')));
    return items
      .map((item, index) => {
        if (!this.hasSelection(item)) return null;
        const marker = ordered ? `${first + index}. ` : '- ';
        return indent(this.blockChunks(item).join(loose ? '\n\n' : '\n'), marker);
      })
      .filter((item) => item !== null)
      .join(loose ? '\n\n' : '\n');
  }

  references(element) {
    const items = [...element.children]
      .filter((item) => item.matches('li') && this.hasSelection(item))
      .map((item) => `- [@${(item.id || '').replace(/^reference-/, '')}] ${this.inline(item.querySelector('p') ?? item).trim()}`);
    return fence('references', {}, items.join('\n'));
  }

  quoteWithSource(figure) {
    const parts = [];
    const blockquote = figure.querySelector(':scope > blockquote');
    const caption = figure.querySelector(':scope > figcaption');
    if (blockquote !== null && this.hasSelection(blockquote)) parts.push(this.blocks(blockquote));
    if (caption !== null && this.hasSelection(caption)) parts.push(`— ${this.inline(caption).trim()}`);
    return quote(parts.join('\n\n'));
  }

  figure(figure) {
    const image = figure.querySelector('img');
    const caption = figure.querySelector(':scope > figcaption');
    if (image === null) return this.blocks(figure);
    const title = caption === null ? '' : ` "${this.whole(caption, () => this.inline(caption)).trim().replaceAll('"', '\\"')}"`;
    const attributes = {};
    if (figure.style.width !== '') attributes.width = figure.style.width;
    if (figure.dataset.float !== undefined) attributes.float = figure.dataset.float;
    return `![${image.getAttribute('alt') ?? ''}](${image.getAttribute('src')}${title})${attributeText(attributes)}`;
  }

  fold(details) {
    const summary = details.querySelector(':scope > summary');
    const body = this.blocks(details);
    if (body === '' && summary !== null && this.hasSelection(summary)) return this.inline(summary).trim();
    return fence('fold', { title: summary?.textContent ?? '' }, body);
  }

  component(figure) {
    const attributes = writtenAttributes(figure);
    const caption = figure.querySelector(':scope > figcaption');
    const body = caption === null ? '' : this.whole(caption, () => this.inline(caption)).trim();
    return fence(figure.dataset.component, attributes, body);
  }

  aside(element) {
    const title = element.querySelector(':scope > .aside-title');
    return fence('aside', title === null ? {} : { title: title.textContent }, this.blocks(element));
  }

  table(table) {
    const rows = [...table.rows];
    const header = table.tHead?.rows[0] ?? rows[0];
    if (header === undefined) return '';
    const cells = (row) => {
      this.inCell = true;
      try {
        return `| ${[...row.cells].map((cell) => this.whole(cell, () => this.inline(cell)).trim().replaceAll('\n', ' ')).join(' | ')} |`;
      } finally {
        this.inCell = false;
      }
    };
    const separator = `|${[...header.cells].map((cell) => alignment(cell.getAttribute('align') ?? cell.style.textAlign)).join('|')}|`;
    const body = rows.filter((row) => row !== header && this.hasSelection(row)).map(cells);
    return [cells(header), separator, ...body].join('\n');
  }

  listTable(table) {
    const header = table.tHead?.rows[0];
    const rows = [header, ...[...(table.tBodies[0]?.rows ?? [])].filter((row) => this.hasSelection(row))].filter((row) => row !== undefined);
    const text = rows
      .map((row) => {
        const cells = [...row.cells].map((cell) => indent(this.whole(cell, () => this.blocks(cell)), '- '));
        return indent(cells.join('\n'), '* ');
      })
      .join('\n');
    return fence('list-table', {}, text);
  }

  addNote(number) {
    if (!this.notes.includes(number)) this.notes.push(number);
    const note = this.note(number);
    return note?.dataset.label ?? number;
  }

  noteElements() {
    return [...this.article.querySelectorAll(NOTE)].filter((note) => note.closest(UI) === null || !this.article.contains(note.closest(UI)));
  }

  note(number) {
    return this.noteElements().find((note) => note.dataset.sidenote === String(number)) ?? null;
  }

  noteLines(note) {
    if (this.lines === null || note.dataset.endLine === undefined) return null;
    return this.lines.slice(Number(note.dataset.line) - 1, Number(note.dataset.endLine));
  }

  footnotes() {
    const definitions = [];
    for (let index = 0; index < this.notes.length; index += 1) {
      const number = this.notes[index];
      const note = this.note(number);
      if (note === null) continue;
      const line = Number(note.dataset.line);
      if (this.copied.some(([start, end]) => line >= start && line <= end)) continue;
      for (const reference of note.querySelectorAll('sup.sidenote-ref[data-sidenote]')) this.addNote(reference.dataset.sidenote);
      const lines = this.noteLines(note);
      if (lines === null) {
        definitions.push(`[^${number}]: ${indent(this.whole(note, () => this.blocks(note)), '    ').trimStart()}`);
        continue;
      }
      definitions.push(dedentDefinition(lines));
    }
    return definitions;
  }
}

function indexOf(node) {
  return [...node.parentNode.childNodes].indexOf(node);
}

function anchorOf(href) {
  const anchor = href.slice(href.indexOf('#') + 1);
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function wrap(marker, text) {
  const [, before, core, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return `${before}${marker}${core}${marker}${after}`;
}

function inlineCode(text) {
  const ticks = '`'.repeat(longestRun(text, '`') + 1);
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${padding}${text}${padding}${ticks}`;
}

function longestRun(text, character) {
  let longest = 0;
  let current = 0;
  for (const next of text) {
    current = next === character ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function indent(text, marker) {
  const space = ' '.repeat(marker.length);
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? `${marker}${line}` : line === '' ? '' : `${space}${line}`))
    .join('\n');
}

function quote(text) {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function fence(name, attributes, body) {
  const inner = body.match(/^:{3,}/gm) ?? [];
  const colons = ':'.repeat(Math.max(3, ...inner.map((line) => line.length + 1)));
  return `${colons}${name}${attributeText(attributes)}\n${body === '' ? '' : `${body}\n`}${colons}`;
}

function writtenAttributes(element) {
  return JSON.parse(element.dataset.attributes ?? '{}');
}

function attributeText(attributes) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return '';
  return `{${entries.map(([name, value]) => attribute(name, value)).join(' ')}}`;
}

function attribute(name, value) {
  if (value === true) return name;
  if (name === 'id') return `#${value}`;
  if (name === 'class') return `.${value}`;
  return `${name}=${attributeValue(String(value))}`;
}

function attributeValue(value) {
  if (BARE_VALUE.test(value)) return value;
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

function alignment(align) {
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  if (align === 'left') return ':---';
  return '---';
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
