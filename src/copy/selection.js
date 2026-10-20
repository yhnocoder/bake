import { MarkdownWriter, NOT_CONTENT, isUi, sidenoteElement } from './markdown.js';

const KEPT_ELEMENTS = new Set(
  'p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tfoot tr th td figure figcaption img a strong b em i mark del s sup sub br hr cite kbd'.split(' '),
);
const KEPT_ATTRIBUTES = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  ol: ['start'],
  li: ['value'],
  th: ['align', 'colspan', 'rowspan'],
  td: ['align', 'colspan', 'rowspan'],
};

export function copiedSelection(range, article, source) {
  const clamped = clampTo(range, article);
  if (clamped === null) return null;
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''));
  const markdown = new MarkdownWriter(clamped, article, lines).write();
  if (markdown.trim() === '') return null;
  return { markdown, html: selectionHtml(clamped, article) };
}

function withAncestors(range, article) {
  let content = range.cloneContents();
  const common = range.commonAncestorContainer;
  for (let element = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement; element !== article && !element.matches('[data-line][data-end-line]'); element = element.parentElement) {
    const shell = element.cloneNode(false);
    shell.append(content);
    content = shell;
  }
  return content;
}

function clampTo(range, article) {
  if (!range.intersectsNode(article)) return null;
  const whole = document.createRange();
  whole.selectNodeContents(article);
  const clamped = range.cloneRange();
  if (clamped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clamped.setStart(whole.startContainer, whole.startOffset);
  if (clamped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clamped.setEnd(whole.endContainer, whole.endOffset);
  const start = clamped.commonAncestorContainer;
  if (clamped.collapsed || isUi(start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement, article)) return null;
  return clamped;
}

function selectionHtml(range, article) {
  const container = document.createElement('div');
  container.append(withAncestors(range, article));
  const numbers = [];
  cleanHtml(container, numbers);
  const items = [];
  for (let index = 0; index < numbers.length; index += 1) {
    const note = sidenoteElement(article, numbers[index]);
    if (note === null) continue;
    const item = document.createElement('li');
    item.value = Number(numbers[index]);
    item.append(...note.cloneNode(true).childNodes);
    cleanHtml(item, numbers);
    item.id = `footnote-${numbers[index]}`;
    items.push(item);
  }
  if (items.length > 0) {
    const list = document.createElement('ol');
    list.append(...items);
    container.append(document.createElement('hr'), list);
  }
  return container.innerHTML;
}

function cleanHtml(root, numbers) {
  for (const math of root.querySelectorAll('mjx-container[data-tex]')) {
    const tex = math.dataset.tex.trim();
    if (math.getAttribute('display') !== 'true') {
      math.replaceWith(`$${tex}$`);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = `$$${tex}$$`;
    math.replaceWith(paragraph);
  }
  for (const element of root.querySelectorAll(NOT_CONTENT)) element.remove();
  for (const reference of root.querySelectorAll('sup.sidenote-ref[data-sidenote]')) {
    const number = reference.dataset.sidenote;
    if (!numbers.includes(number)) numbers.push(number);
    reference.querySelector('a')?.setAttribute('href', `#footnote-${number}`);
  }
  for (const element of root.querySelectorAll('[href], [src]')) {
    for (const name of ['href', 'src']) {
      const value = element.getAttribute(name);
      if (value !== null && !value.startsWith('#footnote-')) element.setAttribute(name, new URL(value, location.href).href);
    }
  }
  for (const element of [...root.querySelectorAll('*')].reverse()) {
    if (element.matches('summary')) {
      const paragraph = document.createElement('p');
      paragraph.append(...element.childNodes);
      element.replaceWith(paragraph);
      continue;
    }
    if (!KEPT_ELEMENTS.has(element.localName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const kept = KEPT_ATTRIBUTES[element.localName] ?? [];
    for (const name of element.getAttributeNames()) {
      if (!kept.includes(name)) element.removeAttribute(name);
    }
  }
}
