import { eastAsianWidth } from 'get-east-asian-width';
import { toString } from 'mdast-util-to-string';
import { referenceId, sidenoteId } from '../fragments.js';
import { renderChildrenHtml, renderHtml, renderInlineHtml, resultWidths } from '../render/html.js';
import { addGlyphs } from '../render/math.js';
import { embedNodes, preview } from './link.js';
import { BUILT_IN_BLOCK_NAMES } from './parse.js';
import { walk, walkWithSidenotes } from './tree.js';

const MATH_MIN_WIDTH = /min-width: ([\d.]+ex)/;
const MATH_WIDTH = /<svg [^>]*?width="([\d.]+ex)"/;
const HAN_CHARACTER = /\p{Script=Han}/gu;
const WORD = /[\p{L}\p{N}]+/gu;

export function articleStructure(article) {
  const { tree } = article;
  article.linked.clear();
  article.borrowed.clear();
  const intro = [];
  const sections = [];
  let recapTarget = null;
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 2) {
      const section = {
        ...headingFields(article, node),
        number: String(sections.length + 1).padStart(2, '0'),
        line: node.position.start.line,
        endLine: node.position.end.line,
        titleSidenotes: referencedSidenotes(article, node),
        recapSidenotes: [],
        blocks: [],
        subsections: [],
      };
      sections.push(section);
      recapTarget = section;
      continue;
    }
    const current = sections.at(-1);
    if (node.type === 'bakeBlock' && node.name === 'recap') {
      attachRecap(article, node, recapTarget);
      continue;
    }
    const block = blockOf(article, node);
    (current?.blocks ?? intro).push(block);
    if (node.type === 'heading' && node.depth === 3 && current) {
      const subsection = { id: block.id, title: block.title, text: block.text, attributes: block.attributes, line: block.line, endLine: block.endLine, titleSidenotes: block.sidenotes, recapSidenotes: [] };
      current.subsections.push(subsection);
      recapTarget = subsection;
    }
  }
  const sidenotes = [...article.sidenotes.values()].map(({ number, definition }) => ({
    number,
    id: sidenoteId(number),
    label: definition.label,
    line: definition.position.start.line,
    endLine: definition.position.end.line,
    html: renderChildrenHtml(definition.children, article.context),
    sidenotes: referencedSidenotes(article, definition),
  }));
  const references = article.references.map((entry) => ({ key: entry.key, number: entry.number, id: referenceId(entry.key), html: renderInlineHtml(entry.children, article.context) }));
  const previews = [...article.linked.values()].filter((target) => target.page.article !== null).map((target) => preview(target.page.article, target, article));
  const toc = sections.map((section) => ({
    id: section.id,
    number: section.number,
    title: section.text,
    attributes: section.attributes,
    recap: section.recap,
    children: section.subsections.map((subsection) => ({ id: subsection.id, title: subsection.text, attributes: subsection.attributes, recap: subsection.recap })),
  }));
  const html = [...intro, ...sections.flatMap((section) => section.blocks), ...sidenotes, ...previews].map((entry) => entry.html);
  const glyphs = addGlyphs(article.glyphs, [...article.borrowed].map((source) => source.glyphs), html);
  return {
    source: article.source,
    intro,
    sections,
    sidenotes,
    references,
    toc,
    previews,
    words: countWords(tree),
    glyphs,
    images: [...article.images.values()],
    image: article.image,
    components: usedComponents(article),
  };
}

function usedComponents(article) {
  const names = new Set();
  const add = (node) => {
    if (node.type === 'bakeBlock' && node.component !== undefined) names.add(node.name);
  };
  walkWithSidenotes(article, article.tree, (node) => {
    add(node);
    for (const { address, page } of node.parts ?? []) {
      for (const embedded of embedNodes(page.article, address.anchor)) walk(embedded, add);
    }
  });
  return [...names].sort();
}

function headingFields(article, node) {
  const { id, ...attributes } = node.attributes;
  return { id: node.id, title: renderInlineHtml(node.children, article.context), text: toString(node), attributes };
}

function attachRecap(article, node, target) {
  if (target === null) {
    article.report(node.position.start, ':::recap must follow a ## or ### heading');
    return;
  }
  if (target.recap !== undefined) {
    const first = article.recapLines.get(target);
    article.report(node.position.start, `this section already has a :::recap at ${first.line}:${first.column}`);
    return;
  }
  target.recap = renderChildrenHtml(node.children, article.context);
  target.recapSidenotes = referencedSidenotes(article, node);
  article.recapLines.set(target, node.position.start);
}

function referencedSidenotes(article, node) {
  const numbers = new Set();
  walk(node, (child) => {
    if (child.type === 'footnoteReference') numbers.add(article.sidenotes.get(child.identifier).number);
  });
  return [...numbers];
}

function blockOf(article, node) {
  if (node.type === 'bakeBlock' && node.name === '' && node.children.length === 1) {
    return { ...blockOf(article, node.children[0]), line: node.position.start.line, endLine: node.position.end.line, width: node.attributes.width };
  }
  if (node.themeBlock) {
    return { type: 'themeBlock', name: node.name, attributes: node.attributes, line: node.position.start.line, endLine: node.position.end.line, html: renderChildrenHtml(node.children, article.context), sidenotes: referencedSidenotes(article, node) };
  }
  const block = { type: blockType(node), line: node.position.start.line, endLine: node.position.end.line, html: renderHtml(node, article.context), sidenotes: referencedSidenotes(article, node) };
  const width = naturalWidth(node);
  if (width !== undefined) block.naturalWidth = width;
  if (node.type === 'heading') Object.assign(block, { depth: node.depth }, headingFields(article, node));
  if (node.type === 'paragraph' && node.anchor !== undefined) block.id = node.anchor;
  if (node.type === 'bakeBlock' && block.type === 'example') Object.assign(block, exampleWidths(resultWidths(node)));
  if (node.type === 'bakeBlock' && block.type === 'component') {
    Object.assign(block, { name: node.name, attributes: node.attributes, params: node.component?.params });
    if (node.component?.width !== undefined) block.width = node.component.width;
  }
  return block;
}

function blockType(node) {
  if (node.type !== 'bakeBlock') return node.type;
  if (BUILT_IN_BLOCK_NAMES.includes(node.name)) return node.name;
  return node.name.includes('-') ? 'component' : 'unknown';
}

function exampleWidths(widths) {
  if (widths.length === 0) return {};
  const fields = { resultWidths: widths };
  const pixels = widths.filter((width) => width.endsWith('px')).map((width) => Number.parseFloat(width));
  if (pixels.length > 0) fields.naturalWidth = `${Math.max(...pixels)}px`;
  const level = ['page', 'wide'].find((width) => widths.includes(width));
  if (level !== undefined) fields.width = level;
  return fields;
}

function naturalWidth(node) {
  if (node.type === 'bakeBlock') return node.component?.naturalWidth;
  if (node.type === 'math') return (MATH_MIN_WIDTH.exec(node.rendered) ?? MATH_WIDTH.exec(node.rendered))?.[1];
  if (node.type === 'code') return `${Math.max(...node.value.split('\n').map(textColumns))}ch`;
  if (node.type === 'figure') {
    const { boxWidth } = node.children[0].published;
    return boxWidth?.endsWith('px') ? boxWidth : undefined;
  }
  return undefined;
}

function countWords(tree) {
  const texts = [];
  walk(tree, (node) => {
    if (node.type === 'bakeBlock' && node.name === 'embed') return false;
    if (node.type === 'text' || node.type === 'inlineCode') texts.push(node.value);
  });
  const text = texts.join(' ');
  return (text.match(HAN_CHARACTER)?.length ?? 0) + (text.replace(HAN_CHARACTER, ' ').match(WORD)?.length ?? 0);
}

function textColumns(line) {
  return [...line].reduce((columns, character) => columns + eastAsianWidth(character.codePointAt(0)), 0);
}
