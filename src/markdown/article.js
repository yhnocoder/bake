import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { WIDTHS, choiceProblem } from '../config/rules.js';
import { renderChildrenHtml, renderHtml, renderInlineHtml } from '../render/html.js';
import { errorAt } from '../report.js';
import { parseAttributes } from './attributes.js';
import { bakeBlocks } from './block-syntax.js';
import { citationsAndMissingFootnotes } from './bracket-syntax.js';
import { highlight } from './highlight-syntax.js';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyStrikethrough, { singleTilde: false })
  .use(highlight)
  .use(citationsAndMissingFootnotes)
  .use(bakeBlocks)
  .freeze();

const BUILT_IN_BLOCKS = {
  aside: ['title'],
  fold: ['title'],
  recap: [],
  references: [],
  example: [],
  'list-table': [],
  embed: [],
};
const HEADING_ATTRIBUTES = ['id', 'toc', 'width'];
const BLOCK_LINE = /^([A-Za-z][\w-]*)?(\{.*\})?$/;
const HEADING_ATTRIBUTE_SUFFIX = /\s*(\{[^{}]*\})\s*$/;
const STRAY_CLOSING_LINE = /^([\s>]*):{3,}\s*$/;
const PARAGRAPH_ANCHOR_SUFFIX = /(?<![\p{L}\p{N}_])\^([A-Za-z0-9][\w-]*)\s*$/u;

export function parseArticle(file, source, errors) {
  const article = new ArticleParser(file, source, errors);
  return article.parse();
}

class ArticleParser {
  constructor(file, source, errors) {
    this.file = file;
    this.source = source;
    this.errors = errors;
    this.anchors = new Map();
    this.definitions = new Map();
    this.sidenotes = new Map();
    this.recapLines = new Map();
    this.citations = new Map();
    this.references = [];
    this.notes = {
      sidenoteNumber: (identifier) => this.sidenotes.get(identifier).number,
      citationNumber: (key) => this.citations.get(key),
      references: () => this.references,
    };
  }

  report(position, message) {
    this.errors.push(errorAt(this.file, position, message));
  }

  parse() {
    const tree = processor.parse(this.source);
    tree.children = tree.children.filter((node) => node.type !== 'yaml');
    walk(tree, (node) => {
      if (node.type === 'bakeBlock') this.readBlock(node);
      if (node.type === 'heading') this.readHeading(node);
      if (node.type === 'paragraph') {
        this.readStrayClosingLines(node);
        this.readParagraphAnchor(node);
      }
    });
    this.resolveLinkReferences(tree);
    this.readFootnotes(tree);
    this.readCitations(tree);
    this.checkGeneratedIds();
    this.assignHeadingIds(tree);
    return this.buildStructure(tree);
  }

  readBlock(node) {
    const start = node.position.start;
    const [, name, attributeText] = BLOCK_LINE.exec(node.info);
    node.name = name ?? '';
    node.attributes = {};
    if (attributeText !== undefined) {
      const { attributes, error } = parseAttributes(attributeText);
      node.attributes = attributes;
      if (error) this.report(start, error);
    }
    const label = node.name === '' ? ':::{width=…}' : `:::${node.name}`;
    if (!node.closed) this.report(start, `${label} is not closed; end it with a line of ${node.colons} or more colons`);
    if (node.name === '') {
      this.checkKnownAttributes(node.attributes, ['width'], label, start);
      if (node.attributes.width === undefined) this.report(start, 'a block without a name must set width, for example :::{width=wide}');
      else this.checkWidth(node.attributes.width, start);
      if (node.children.length !== 1) this.report(start, ':::{width=…} must contain exactly one block');
    } else if (Object.hasOwn(BUILT_IN_BLOCKS, node.name)) {
      this.checkKnownAttributes(node.attributes, BUILT_IN_BLOCKS[node.name], label, start);
      if (node.name === 'fold' && typeof node.attributes.title !== 'string') this.report(start, ':::fold is missing "title"');
    } else if (!node.name.includes('-')) {
      this.report(start, `unknown block ":::${node.name}"`);
    }
  }

  readHeading(node) {
    if (node.depth === 1) this.report(node.position.start, 'heading level 1 is not allowed; the article title comes from front matter, sections start at ##');
    node.attributes = {};
    const last = node.children.at(-1);
    const match = last?.type === 'text' ? HEADING_ATTRIBUTE_SUFFIX.exec(last.value) : null;
    if (match) {
      const raw = this.source.slice(last.position.start.offset, last.position.end.offset);
      const position = this.positionAt(last.position.start.offset + raw.lastIndexOf('{'));
      last.value = last.value.slice(0, match.index);
      if (last.value === '') node.children.pop();
      const { attributes, error } = parseAttributes(match[1]);
      node.attributes = attributes;
      if (error) this.report(position, error);
      this.checkKnownAttributes(attributes, HEADING_ATTRIBUTES, 'heading', position);
      if (attributes.toc !== undefined && typeof attributes.toc !== 'string') this.report(position, 'toc must be a short title in quotes, for example toc="Short title"');
      if (attributes.width !== undefined) {
        if (node.depth !== 2) this.report(position, 'width only applies to ## headings');
        else this.checkWidth(attributes.width, position);
      }
      if (attributes.id !== undefined) this.addAnchor(String(attributes.id), position);
    }
  }

  readStrayClosingLines(node) {
    const raw = this.source.slice(node.position.start.offset, node.position.end.offset);
    let offset = node.position.start.offset;
    for (const line of raw.split('\n')) {
      const colons = STRAY_CLOSING_LINE.exec(line);
      if (colons) this.report(this.positionAt(offset + colons[1].length), 'this ::: line closes no block; a block inside another block needs fewer colons than the outer block');
      offset += line.length + 1;
    }
  }

  readParagraphAnchor(node) {
    const last = node.children.at(-1);
    const match = last?.type === 'text' ? PARAGRAPH_ANCHOR_SUFFIX.exec(last.value) : null;
    if (!match) return;
    const raw = this.source.slice(last.position.start.offset, last.position.end.offset);
    const position = this.positionAt(last.position.start.offset + raw.lastIndexOf('^'));
    last.value = last.value.slice(0, match.index).trimEnd();
    if (last.value === '') node.children.pop();
    node.data = { hProperties: { id: match[1] } };
    node.anchor = match[1];
    this.addAnchor(match[1], position);
  }

  checkKnownAttributes(attributes, known, label, position) {
    for (const name of Object.keys(attributes)) {
      if (!known.includes(name)) this.report(position, `unknown attribute "${name}" on ${label}`);
    }
  }

  checkWidth(value, position) {
    const problem = choiceProblem('width', WIDTHS, value);
    if (problem) this.report(position, problem);
  }

  addAnchor(id, position) {
    const first = this.anchors.get(id);
    if (first) this.report(position, `duplicate anchor "${id}", first defined at ${first.line}:${first.column}`);
    else this.anchors.set(id, position);
  }

  generatedIds() {
    const ids = new Map();
    for (const { number } of this.sidenotes.values()) ids.set(`sidenote-${number}`, `sidenote ${number}`);
    for (const { key } of this.references) ids.set(`reference-${key}`, `the reference "${key}"`);
    return ids;
  }

  checkGeneratedIds() {
    const generated = this.generatedIds();
    for (const [id, position] of this.anchors) {
      if (generated.has(id)) this.report(position, `anchor "${id}" is also the id of ${generated.get(id)}`);
    }
  }

  assignHeadingIds(tree) {
    const generated = this.generatedIds();
    const taken = (id) => this.anchors.has(id) || generated.has(id);
    const slugger = new GithubSlugger();
    walk(tree, (node) => {
      if (node.type !== 'heading') return;
      let id = node.attributes.id === undefined ? undefined : String(node.attributes.id);
      while (id === undefined || (node.attributes.id === undefined && taken(id))) id = slugger.slug(toString(node));
      node.id = id;
      node.data = { hProperties: { id } };
    });
  }

  resolveLinkReferences(tree) {
    const definitions = new Map();
    walk(tree, (node, parent) => {
      if (node.type !== 'definition') return;
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
      parent.children = parent.children.filter((child) => child !== node);
    });
    walk(tree, (node) => {
      if (node.type !== 'linkReference' && node.type !== 'imageReference') return;
      const { url, title } = definitions.get(node.identifier);
      Object.assign(node, node.type === 'linkReference' ? { type: 'link', url, title } : { type: 'image', url, title });
    });
  }

  readFootnotes(tree) {
    walk(tree, (node, parent) => {
      if (node.type !== 'footnoteDefinition') return;
      const first = this.definitions.get(node.identifier);
      if (first) this.report(node.position.start, `footnote "${node.label}" is defined twice, first at ${first.position.start.line}:${first.position.start.column}`);
      else this.definitions.set(node.identifier, node);
      parent.children = parent.children.filter((child) => child !== node);
      return false;
    });
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'missingFootnote') this.report(node.position.start, `footnote "${node.label}" has no definition`);
      if (node.type === 'footnoteReference' && !this.sidenotes.has(node.identifier)) {
        this.sidenotes.set(node.identifier, { number: this.sidenotes.size + 1, definition: this.definitions.get(node.identifier) });
      }
    });
    for (const [identifier, definition] of this.definitions) {
      if (!this.sidenotes.has(identifier)) this.report(definition.position.start, `footnote "${definition.label}" is defined but never used`);
    }
  }

  walkWithSidenotes(tree, visit) {
    const entered = new Set();
    const step = (node) => {
      const result = visit(node);
      if (node.type === 'footnoteReference' && !entered.has(node.identifier)) {
        entered.add(node.identifier);
        walk(this.definitions.get(node.identifier), step);
      }
      return result;
    };
    walk(tree, step);
  }

  readCitations(tree) {
    const blocks = [];
    walk(tree, (node) => {
      if (node.type === 'bakeBlock' && node.name === 'references') blocks.push(node);
    });
    for (const extra of blocks.slice(1)) {
      const first = blocks[0].position.start;
      this.report(extra.position.start, `an article has one :::references block, the first is at ${first.line}:${first.column}`);
    }
    const entries = new Map();
    if (blocks.length > 0) this.readReferenceEntries(blocks[0], entries);
    const cited = [];
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'bakeBlock' && node.name === 'references') return false;
      if (node.type !== 'citation') return;
      if (!entries.has(node.key)) this.report(node.position.start, `citation "${node.key}" is not in :::references`);
      else if (!this.citations.has(node.key)) {
        this.citations.set(node.key, this.citations.size + 1);
        cited.push(entries.get(node.key));
      }
    });
    const uncited = [...entries.values()].filter((entry) => !this.citations.has(entry.key));
    for (const entry of uncited) this.citations.set(entry.key, this.citations.size + 1);
    this.references = [...cited, ...uncited].map((entry) => ({ ...entry, number: this.citations.get(entry.key) }));
  }

  readReferenceEntries(block, entries) {
    const items = block.children.length === 1 && block.children[0].type === 'list' ? block.children[0].children : null;
    if (items === null) {
      this.report(block.position.start, ':::references must contain one list whose items start with [@key]');
      return;
    }
    for (const item of items) {
      const paragraph = item.children[0];
      const citation = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
      if (item.children.length !== 1 || citation?.type !== 'citation') {
        this.report(item.position.start, 'each :::references item is one paragraph that starts with [@key]');
        continue;
      }
      const first = entries.get(citation.key);
      if (first) {
        this.report(citation.position.start, `reference "${citation.key}" is listed twice, first at ${first.position.line}:${first.position.column}`);
        continue;
      }
      const children = paragraph.children.slice(1);
      if (children[0]?.type === 'text') children[0] = { ...children[0], value: children[0].value.trimStart() };
      entries.set(citation.key, { key: citation.key, children, position: citation.position.start });
    }
  }

  buildStructure(tree) {
    const intro = [];
    const sections = [];
    let recapTarget = null;
    for (const node of tree.children) {
      if (node.type === 'heading' && node.depth === 2) {
        const section = { ...this.headingFields(node), number: String(sections.length + 1).padStart(2, '0'), width: node.attributes.width, line: node.position.start.line, blocks: [], subsections: [] };
        sections.push(section);
        recapTarget = section;
        continue;
      }
      const current = sections.at(-1);
      if (node.type === 'bakeBlock' && node.name === 'recap') {
        this.attachRecap(node, recapTarget);
        continue;
      }
      const block = this.block(node);
      (current?.blocks ?? intro).push(block);
      if (node.type === 'heading' && node.depth === 3 && current) {
        const subsection = { id: block.id, title: block.title, text: block.text, toc: block.toc, line: block.line };
        current.subsections.push(subsection);
        recapTarget = subsection;
      }
    }
    const sidenotes = [...this.sidenotes.values()].map(({ number, definition }) => ({
      number,
      id: `sidenote-${number}`,
      line: definition.position.start.line,
      html: renderChildrenHtml(definition.children, this.notes),
    }));
    const references = this.references.map((entry) => ({ key: entry.key, number: entry.number, id: `reference-${entry.key}`, html: renderInlineHtml(entry.children, this.notes) }));
    const toc = sections.map((section) => ({
      id: section.id,
      number: section.number,
      title: section.toc,
      recap: section.recap,
      children: section.subsections.map((subsection) => ({ id: subsection.id, title: subsection.toc, recap: subsection.recap })),
    }));
    return { intro, sections, sidenotes, references, toc };
  }

  headingFields(node) {
    const text = toString(node);
    return { id: node.id, title: renderInlineHtml(node.children, this.notes), text, toc: typeof node.attributes.toc === 'string' ? node.attributes.toc : text };
  }

  attachRecap(node, target) {
    if (target === null) {
      this.report(node.position.start, ':::recap must follow a ## or ### heading');
      return;
    }
    if (target.recap !== undefined) {
      const first = this.recapLines.get(target);
      this.report(node.position.start, `this section already has a :::recap at ${first.line}:${first.column}`);
      return;
    }
    target.recap = renderChildrenHtml(node.children, this.notes);
    this.recapLines.set(target, node.position.start);
  }

  block(node) {
    if (node.type === 'bakeBlock' && node.name === '' && node.children.length === 1) {
      return { ...this.block(node.children[0]), line: node.position.start.line, endLine: node.position.end.line, width: node.attributes.width };
    }
    const block = { type: blockType(node), line: node.position.start.line, endLine: node.position.end.line, html: renderHtml(node, this.notes) };
    if (node.type === 'heading') Object.assign(block, { depth: node.depth }, this.headingFields(node));
    if (node.type === 'paragraph' && node.anchor !== undefined) block.id = node.anchor;
    if (node.type === 'bakeBlock' && block.type === 'component') Object.assign(block, { name: node.name, attributes: node.attributes });
    return block;
  }

  positionAt(offset) {
    const before = this.source.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length, column: offset - lineStart + 1 };
  }
}

function blockType(node) {
  if (node.type !== 'bakeBlock') return node.type;
  if (Object.hasOwn(BUILT_IN_BLOCKS, node.name)) return node.name;
  return node.name.includes('-') ? 'component' : 'unknown';
}

function walk(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  for (const child of [...(node.children ?? [])]) walk(child, visit, node);
}
