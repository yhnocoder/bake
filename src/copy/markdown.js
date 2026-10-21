import { UI } from '../regions.js';

export const NOTE = '[data-sidenote][data-line]';
export const NOT_CONTENT = `${UI}, ${NOTE}, .component-box, .embed-source, script, template, button, input, svg`;
const SKIPPED = `${NOT_CONTENT}, .example-source`;
const EMBEDDED = '[data-markdown]';
// why: the text of these elements is not the text of their source, so a selection takes them whole
const WHOLE = 'figure.component, .embed, mjx-container, sup.sidenote-ref, a.citation, a.eqref';
// why: a part of a heading or a table row is not valid Markdown
const WHOLE_WHEN_CUT = 'h1, h2, h3, h4, h5, h6, tr';
const REFERENCE = 'sup.sidenote-ref[data-sidenote][data-src]';
const IMAGE_ADDRESS = /^(!\[[\s\S]*?\]\()(?:<[^>]*>|[^\s)]*)/;
const CHARACTER_REFERENCE = /^&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z\d]{1,31});/;
const ESCAPABLE = /^[!-/:-@[-`{-~]$/;
const WHITESPACE = /\s/;

export function sidenoteElement(article, number) {
  return [...article.querySelectorAll(NOTE)].find((note) => note.dataset.sidenote === String(number) && note.closest(UI) === null) ?? null;
}

export function isUi(element, article) {
  const ui = element.closest(UI);
  if (ui === null || !article.contains(ui)) return false;
  const note = element.closest(NOTE);
  return note === null || note.contains(ui);
}

export function sourceMarkdown(range, article, articleSource) {
  const root = sourceRoot(range, article);
  const source = sourceOf(root, articleSource);
  const start = escaped(range.startContainer, range.startOffset, 'start', range.endContainer, root);
  const end = escaped(range.endContainer, range.endOffset, 'end', range.startContainer, root);
  const from = offsetAt(start, 'start', root, source);
  const to = offsetAt(end, 'end', root, source);
  if (from >= to) return '';
  const between = document.createRange();
  between.setStart(start.node, start.offset);
  between.setEnd(end.node, end.offset);
  const common = positionedAncestor(between.commonAncestorContainer, root, source);
  let text = root.matches(EMBEDDED) ? withPublishedImages(root, source, from, to) : source.slice(from, to);
  for (const element of positionedAncestors(start.node, common, source)) text = `${markup(element, root, source).opening}${text}`;
  for (const element of positionedAncestors(end.node, common, source)) text = `${text}${markup(element, root, source).closing}`;
  if (common !== root && text.includes('\n') && positionedChildren(common, source).filter(([first, last]) => first < to && last > from).length > 1) {
    const { opening, closing } = markup(common, root, source);
    text = `${opening}${text}${closing}`;
  }
  const definitions = root.matches(EMBEDDED) ? [] : footnoteDefinitions(article, source, from, to);
  return tidy([text, ...definitions].join('\n\n'));
}

function sourceRoot(range, article) {
  const common = range.commonAncestorContainer;
  const root = (common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement).closest(`${NOTE}, ${EMBEDDED}`);
  return root !== null && article.contains(root) ? root : article;
}

function sourceOf(root, articleSource) {
  const embedded = root.matches(EMBEDDED);
  const text = embedded ? root.dataset.markdown : articleSource;
  const base = embedded ? Number(root.dataset.src.split(' ')[0]) : 0;
  let lineStarts = null;
  const range = (element) => {
    if (element.dataset.src !== undefined) return element.dataset.src.split(' ').map(Number);
    if (element.dataset.line === undefined || element.dataset.endLine === undefined) return null;
    lineStarts ??= [0, ...[...text.matchAll(/\n/g)].map((match) => match.index + 1)];
    const next = lineStarts[Number(element.dataset.endLine)];
    return [lineStarts[Number(element.dataset.line) - 1], next === undefined ? text.length : next - 1];
  };
  return {
    slice: (start, end) => text.slice(start - base, end - base),
    range: (element) => (element === root && !embedded && range(element) === null ? [0, text.length] : range(element)),
  };
}

function escaped(node, offset, side, other, root) {
  let point = { node, offset };
  for (let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; element !== root; element = element.parentElement) {
    if (element.matches(SKIPPED) || element.matches(WHOLE) || (element.matches(WHOLE_WHEN_CUT) && !element.contains(other))) {
      point = { node: element.parentNode, offset: [...element.parentNode.childNodes].indexOf(element) + (side === 'start' ? 0 : 1) };
    }
  }
  return point;
}

function positionedAncestor(node, root, source) {
  let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (element !== root && source.range(element) === null) element = element.parentElement;
  return element;
}

function positionedAncestors(node, common, source) {
  const found = [];
  for (let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; element !== common; element = element.parentElement) {
    if (source.range(element) !== null) found.push(element);
  }
  return found;
}

function positionedChildren(element, source) {
  return [...element.children].flatMap((child) => {
    if (child.matches(SKIPPED)) return [];
    return source.range(child) === null ? positionedChildren(child, source) : [source.range(child)];
  });
}

function markup(element, root, source) {
  const [, last] = source.range(element);
  // why: rows of a pipe table are no table without the header and delimiter rows, which stand before the body
  const [first] = element.matches('tbody') ? source.range(element.parentElement) : source.range(element);
  const content = { start: offsetAt({ node: element, offset: 0 }, 'start', root, source), end: offsetAt({ node: element, offset: element.childNodes.length }, 'end', root, source) };
  return { opening: source.slice(first, content.start), closing: source.slice(content.end, last) };
}

// A point maps through the closest element with a source range. Its own text covers the source between its positioned
// children, maps character by character where it matches that source, and otherwise moves the point to the nearer edge.
function offsetAt(point, side, root, source) {
  const host = positionedAncestor(point.node, root, source);
  const [first, last] = source.range(host);
  const items = [{ mark: first }];
  let at = null;
  const visit = (parent) => {
    parent.childNodes.forEach((child, index) => {
      if (parent === point.node && index === point.offset) at = items.length;
      if (child.nodeType === Node.TEXT_NODE) {
        if (child === point.node) at = items.length + point.offset;
        for (let index = 0; index < child.data.length; index += 1) items.push({ character: child.data[index] });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || child.matches(SKIPPED)) return;
      const range = source.range(child);
      if (range === null) visit(child);
      else items.push({ mark: range[0] }, { mark: range[1] });
    });
    if (parent === point.node && point.offset === parent.childNodes.length) at = items.length;
  };
  visit(host);
  items.push({ mark: last });
  alignRuns(items, source);
  if (side === 'start') {
    for (let index = at; ; index += 1) {
      const item = items[index];
      if (item.mark !== undefined) return item.mark;
      if (item.run !== undefined) return nearerEdge(item.run, item.index);
      if (!WHITESPACE.test(item.character)) return item.start;
    }
  }
  for (let index = at - 1; ; index -= 1) {
    const item = items[index];
    if (item.mark !== undefined) return item.mark;
    if (item.run !== undefined) return nearerEdge(item.run, item.index + 1);
    if (!WHITESPACE.test(item.character)) return item.end;
  }
}

function alignRuns(items, source) {
  for (let start = 1; start < items.length; start += 1) {
    if (items[start].character === undefined) continue;
    let end = start;
    while (items[end].character !== undefined) end += 1;
    const run = items.slice(start, end);
    const gap = { start: items[start - 1].mark, end: items[end].mark };
    const units = alignText(run.map((item) => item.character).join(''), source.slice(gap.start, gap.end));
    run.forEach((item, index) => {
      if (units === null) Object.assign(item, { run: { ...gap, length: run.length }, index });
      else Object.assign(item, { start: gap.start + units[index][0], end: gap.start + units[index][1] });
    });
    start = end;
  }
}

function nearerEdge(run, index) {
  return index * 2 <= run.length ? run.start : run.end;
}

function alignText(text, source) {
  const exact = source.indexOf(text);
  if (exact !== -1 && !isEscaped(source, exact)) return Array.from(text, (_, index) => [exact + index, exact + index + 1]);
  const units = [];
  let at = 0;
  for (let index = 0; index < text.length; ) {
    if (at >= source.length) return null;
    const reference = source[at] === '&' ? CHARACTER_REFERENCE.exec(source.slice(at))?.[0] : undefined;
    const decoded = reference === undefined ? null : decodeReference(reference);
    if (source[at] === '\\' && source[at + 1] === text[index] && ESCAPABLE.test(text[index])) {
      units.push([at, at + 2]);
      index += 1;
      at += 2;
    } else if (source[at] === text[index]) {
      units.push([at, at + 1]);
      index += 1;
      at += 1;
    } else if (decoded !== null && decoded !== '' && text.startsWith(decoded, index)) {
      for (let unit = 0; unit < decoded.length; unit += 1) units.push([at, at + reference.length]);
      index += decoded.length;
      at += reference.length;
    } else if (source[at] === '<') {
      return null;
    } else {
      at += 1;
    }
  }
  return units;
}

function isEscaped(text, index) {
  let backslashes = 0;
  while (text[index - 1 - backslashes] === '\\') backslashes += 1;
  return backslashes % 2 === 1;
}

function decodeReference(reference) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = reference;
  return textarea.value === reference ? null : textarea.value;
}

function withPublishedImages(root, source, from, to) {
  const images = [...root.querySelectorAll('img[data-src]')]
    .map((image) => ({ image, range: source.range(image) }))
    .filter(({ range: [first, last] }) => first >= from && last <= to)
    .reverse();
  let text = source.slice(from, to);
  for (const { image, range: [first, last] } of images) {
    const address = new URL(image.getAttribute('src'), image.baseURI).href;
    text = `${text.slice(0, first - from)}${source.slice(first, last).replace(IMAGE_ADDRESS, (written, before) => `${before}${address}`)}${text.slice(last - from)}`;
  }
  return text;
}

function footnoteDefinitions(article, source, from, to) {
  const references = [...article.querySelectorAll(REFERENCE)].map((reference) => ({ number: reference.dataset.sidenote, range: source.range(reference) }));
  const numbers = [];
  const add = (first, last) => {
    const inside = references.filter(({ range }) => range[0] >= first && range[1] <= last).sort((a, b) => a.range[0] - b.range[0]);
    for (const { number } of inside) if (!numbers.includes(number)) numbers.push(number);
  };
  add(from, to);
  const definitions = [];
  for (let index = 0; index < numbers.length; index += 1) {
    const note = sidenoteElement(article, numbers[index]);
    if (note === null) continue;
    const [first, last] = source.range(note);
    if (first >= from && last <= to) continue;
    add(first, last);
    definitions.push(dedentDefinition(source.slice(first, last)));
  }
  return definitions;
}

function dedentDefinition(definition) {
  const lines = definition.split('\n');
  const prefix = lines[0].slice(0, Math.max(0, lines[0].indexOf('[^')));
  return lines.map((line, index) => (index === 0 || line.startsWith(prefix) ? line.slice(prefix.length) : line.replace(new RegExp(`^[ \\t>]{0,${prefix.length}}`), ''))).join('\n');
}

function tidy(text) {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}
