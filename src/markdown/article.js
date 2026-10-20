import { join } from 'node:path';
import { eastAsianWidth } from 'get-east-asian-width';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { resolveComponent } from '../components/declarations.js';
import { WIDTHS, choiceProblem, folderFile, parseSize, sizeProblem } from '../config/rules.js';
import { INVALID_PERCENT_ENCODING, addressHref, encodePath, pageRoot, parseAddress } from '../urls.js';
import { idOfFragment, percentDecode, referenceId, sidenoteId } from '../fragments.js';
import { errorAt } from '../report.js';
import { isKnownLanguage, loadLanguages } from '../render/code.js';
import { renderChildrenHtml, renderHast, renderHtml, renderInlineHtml, resultWidths } from '../render/html.js';
import { IMAGE_FORMATS, publishedImage, readImage } from '../render/images.js';
import { EQUATION_ID_PREFIX, addGlyphs, typesetMath } from '../render/math.js';
import { parseAttributes } from './attributes.js';
import { bakeBlocks } from './block-syntax.js';
import { citationsAndMissingFootnotes } from './bracket-syntax.js';
import { equationReferences } from './eqref-syntax.js';
import { highlight } from './highlight-syntax.js';
import { readRawHtml } from './raw-html.js';
import { REMARK_PLUGINS } from './remark-plugins.js';
import { protectPipesInMath, restorePipesInMath } from './table-math.js';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(REMARK_PLUGINS)
  .use(highlight)
  .use(citationsAndMissingFootnotes)
  .use(equationReferences)
  .use(bakeBlocks)
  .freeze();

const TITLE = { text: 'text in quotes, for example title="Notes"' };
const WIDTH = { choices: WIDTHS };
const BUILT_IN_BLOCKS = {
  aside: { title: TITLE },
  fold: { title: TITLE },
  recap: {},
  references: {},
  example: {},
  'list-table': {},
  embed: {},
};
export const BUILT_IN_BLOCK_NAMES = Object.freeze(Object.keys(BUILT_IN_BLOCKS));
const WIDTH_BLOCK_ATTRIBUTES = { width: WIDTH };
const HEADING_ATTRIBUTES = {
  id: { text: 'an anchor name, for example {#intro}' },
  toc: { text: 'a short title in quotes, for example toc="Short title"' },
  width: WIDTH,
  cols: { count: 'a whole number of card columns from 1 up, for example cols=2' },
  rows: { count: 'a whole number of card rows from 1 up, for example rows=12' },
};
const SECTION_ATTRIBUTES = ['width', 'cols', 'rows'];
const COUNT = /^[1-9]\d*$/;
const IMAGE_FLOATS = ['left', 'right'];
const IMAGE_ATTRIBUTES = {
  width: { size: 'image width' },
  height: { size: 'image height' },
  float: { choices: IMAGE_FLOATS },
};
const BLOCK_LINE = /^([A-Za-z][\w-]*)?(\{.*\})?$/;
const HEADING_ATTRIBUTE_SUFFIX = /\s*(\{[^{}]*\})\s*$/;
const STRAY_CLOSING_LINE = /^([\s>]*):{3,}\s*$/;
const PARAGRAPH_ANCHOR_SUFFIX = /(?<![\p{L}\p{N}_])\^([A-Za-z0-9][\w-]*)\s*$/u;
const IMAGE_ATTRIBUTE_TEXT = /^\{[^{}\n]*\}/;
const MATH_MIN_WIDTH = /min-width: ([\d.]+ex)/;
const MATH_WIDTH = /<svg [^>]*?width="([\d.]+ex)"/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HAN_CHARACTER = /\p{Script=Han}/gu;
const WORD = /[\p{L}\p{N}]+/gu;
const PREVIEW_BLOCKS = 3;
const EMBEDDABLE = new Set(['heading', 'paragraph']);
const EMBED_EXAMPLE = 'such as /2026-10/slug/#anchor';
const UNREAD_TABLE_MATH = '| inside $…$ cannot be read on this line, because the article uses every private-use character from U+E000 to U+F8FF and Bake needs one that it does not use';

export async function readArticle(file, source, errors, { folder = null, preamble = [], url = null, components = new Map() } = {}) {
  const article = new ArticleParser(file, source, errors, folder, preamble, url, components);
  await article.parse();
  return article;
}

class ArticleParser {
  constructor(file, source, errors, folder, preamble, url, components) {
    this.file = file;
    this.source = source;
    this.errors = errors;
    this.folder = folder;
    this.preamble = preamble;
    this.components = components;
    this.url = url;
    this.tree = null;
    this.targets = new Map();
    this.places = new Map();
    this.linked = new Map();
    this.borrowed = new Set();
    this.equations = new Map();
    this.equationIds = new Map();
    this.glyphs = undefined;
    this.images = new Map();
    this.image = undefined;
    this.anchors = new Map();
    this.definitions = new Map();
    this.sidenotes = new Map();
    this.recapLines = new Map();
    this.citations = new Map();
    this.references = [];
    this.context = {
      sidenoteNumber: (identifier) => this.sidenotes.get(identifier).number,
      citationNumber: (key) => this.citations.get(key),
      references: () => this.references,
      equation: (label) => this.equations.get(label),
      highlighter: null,
      root: url === null ? '' : pageRoot(url),
      excerpt: undefined,
      linked: (target) => this.linked.set(target.address.text, target),
      embed: (node) => this.embedParts(node),
    };
  }

  report(position, message) {
    this.errors.push(errorAt(this.file, position, message));
  }

  async parse() {
    const pipes = protectPipesInMath(this.source);
    if (pipes.unreadLine !== undefined) this.report({ line: pipes.unreadLine, column: 1 }, UNREAD_TABLE_MATH);
    const tree = restorePipesInMath(processor.parse(pipes.text), pipes.sentinel);
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
    this.readImageAttributes(tree);
    this.readFootnotes(tree);
    this.readCitations(tree);
    this.readListTables(tree);
    this.readExamples(tree);
    this.readRawHtml(tree);
    await this.renderMath(tree);
    this.checkGeneratedIds();
    this.assignHeadingIds(tree);
    await this.loadCodeLanguages(tree);
    await this.readImages(tree);
    this.tree = tree;
    this.indexTargets(tree);
  }

  structure() {
    return this.buildStructure(this.tree);
  }

  indexTargets(tree) {
    let section = null;
    let subsection = null;
    let sections = 0;
    let subsections = 0;
    for (const top of tree.children) {
      if (top.type === 'heading' && top.depth === 2) {
        section = { number: String(++sections), heading: top };
        subsection = null;
        subsections = 0;
      } else if (top.type === 'heading' && top.depth === 3 && section !== null) {
        subsection = { number: `${section.number}.${++subsections}`, heading: top };
      }
      this.places.set(top, subsection ?? section);
      walk(
        top,
        (node, parent) => {
          const add = (id, kind, target = node) => {
            if (!this.targets.has(id)) this.targets.set(id, { kind, node: target, parent, top });
          };
          if (node.type === 'heading') add(node.id, 'heading');
          if (node.type === 'paragraph' && node.anchor !== undefined) add(node.anchor, 'paragraph');
          if (node.type === 'math') for (const id of node.ids ?? []) add(id, 'equation');
          const sidenote = node.type === 'footnoteReference' ? this.sidenotes.get(node.identifier) : undefined;
          if (sidenote?.definition !== undefined) add(sidenoteId(sidenote.number), 'sidenote', sidenote.definition);
          if (node.type === 'bakeBlock' && node.name === 'references') {
            for (const entry of this.references) add(referenceId(entry.key), 'reference', entry);
          }
        },
        tree,
      );
    }
    for (const { number, definition } of this.sidenotes.values()) {
      if (definition !== undefined && !this.targets.has(sidenoteId(number))) this.targets.set(sidenoteId(number), { kind: 'sidenote', node: definition, parent: null, top: null });
    }
  }

  hasTarget(anchor) {
    return this.targets.has(anchor);
  }

  pageIds() {
    const ids = new Set([...this.targets.keys(), ...this.generatedIds().keys()]);
    this.walkWithSidenotes(this.tree, (node) => {
      if (node.type === 'html') for (const id of node.rawHtml.ids) ids.add(id);
    });
    return ids;
  }

  link(site, errors) {
    this.errors = errors;
    this.linked.clear();
    this.borrowed.clear();
    const ids = this.pageIds();
    this.walkWithSidenotes(this.tree, (node) => {
      if (node.type === 'link') {
        delete node.target;
        this.checkLink(node, site, ids);
      }
      if (node.type === 'bakeBlock' && node.name === 'embed') {
        this.readEmbed(node, site);
        return false;
      }
    });
  }

  checkLink(node, site, ids) {
    if (node.url.startsWith('#')) {
      if (node.url === '#') return;
      const id = idOfFragment(node.url);
      if (id === null) this.report(node.position.start, `link target ${node.url} ${INVALID_PERCENT_ENCODING}`);
      else if (!ids.has(id)) this.report(node.position.start, `link target #${id} does not exist`);
      return;
    }
    const address = parseAddress(node.url);
    if (address === null) return;
    if (address.problem !== undefined) {
      this.report(node.position.start, `link target ${address.written} ${address.problem}`);
      return;
    }
    const found = site.find(address, this);
    if (found.problem !== undefined) this.report(node.position.start, `link target ${address.written} ${found.problem}`);
    else node.target = { address, page: found.page };
  }

  readEmbed(node, site) {
    const start = node.position.start;
    const lines = this.embedLines(node);
    if (node.children.length === 0) this.report(start, `:::embed lists no address; write one site address per line, ${EMBED_EXAMPLE}`);
    const parts = [];
    const seen = new Set();
    for (const { text, position } of lines) {
      const address = parseAddress(text);
      if (address === null) {
        this.report(position, `:::embed line "${text}" is not a site address ${EMBED_EXAMPLE}`);
        continue;
      }
      if (address.problem !== undefined) {
        this.report(position, `:::embed address ${address.written} ${address.problem}`);
        continue;
      }
      if (address.path === this.url) {
        this.report(position, ':::embed cannot embed the article itself');
        continue;
      }
      if (seen.has(address.text)) {
        this.report(position, `:::embed lists ${address.text} twice`);
        continue;
      }
      seen.add(address.text);
      if (address.anchor === undefined) {
        this.report(position, `:::embed address ${address.written} has no anchor; it must point to a heading or a paragraph ${EMBED_EXAMPLE}`);
        continue;
      }
      const found = site.find(address, this);
      if (found.problem !== undefined) {
        this.report(position, `:::embed target ${address.written} ${found.problem}`);
        continue;
      }
      if (!EMBEDDABLE.has(found.page.article.targets.get(address.anchor).kind)) {
        this.report(position, `:::embed target ${address.written} is not a heading or a paragraph`);
        continue;
      }
      parts.forEach((earlier) => {
        if (earlier.page !== found.page) return;
        const source = found.page.article;
        if (source.contains(earlier.address.anchor, address.anchor)) this.report(position, `:::embed address ${earlier.address.text} contains ${address.text}`);
        else if (source.contains(address.anchor, earlier.address.anchor)) this.report(position, `:::embed address ${address.text} contains ${earlier.address.text}`);
      });
      parts.push({ address, page: found.page });
    }
    node.parts = parts;
  }

  embedLines(node) {
    const sourceLines = this.source.split('\n');
    const lines = [];
    for (const child of node.children) {
      if (child.type !== 'paragraph') {
        this.report(child.position.start, `:::embed holds only site addresses, one per line, ${EMBED_EXAMPLE}`);
        continue;
      }
      toString(child)
        .split('\n')
        .forEach((value, index) => {
          const text = value.trim();
          if (text === '') return;
          const line = child.position.start.line + index;
          lines.push({ text, position: { line, column: Math.max(0, sourceLines[line - 1].indexOf(text)) + 1 } });
        });
    }
    return lines;
  }

  contains(anchor, other) {
    const inner = this.targets.get(other).node;
    let found = false;
    for (const node of this.embedNodes(anchor)) {
      walk(node, (candidate) => {
        if (candidate === inner) found = true;
      });
    }
    return found;
  }

  embedNodes(anchor) {
    const { node, parent } = this.targets.get(anchor);
    if (node.type === 'paragraph') return [node];
    return [node, ...this.followingNodes(parent.children, node, (next) => next.type === 'heading' && next.depth <= node.depth)];
  }

  previewHtml(anchor, context) {
    const atHeading = (next) => next.type === 'heading';
    if (anchor === undefined) return renderChildrenHtml(this.followingNodes(this.tree.children, null, atHeading).slice(0, PREVIEW_BLOCKS), context);
    const { kind, node, parent } = this.targets.get(anchor);
    if (kind === 'heading') return renderChildrenHtml(this.followingNodes(parent.children, node, atHeading).slice(0, PREVIEW_BLOCKS), context);
    if (kind === 'sidenote') return renderChildrenHtml(node.children, context);
    if (kind === 'reference') return renderInlineHtml(node.children, context);
    return renderChildrenHtml([node], context);
  }

  followingNodes(siblings, start, ends) {
    const nodes = [];
    for (const next of siblings.slice(siblings.indexOf(start) + 1)) {
      if (ends(next)) break;
      if (next.type === 'bakeBlock' && next.name === 'recap') continue;
      nodes.push(next);
    }
    return nodes;
  }

  targetHeading(anchor, context) {
    if (anchor === undefined) return {};
    const { kind, node, top } = this.targets.get(anchor);
    const place = this.places.get(top);
    const heading = kind === 'heading' ? node : place?.heading;
    return { number: place?.number, title: heading === undefined ? undefined : renderInlineHtml(heading.children, context), text: heading === undefined ? undefined : toString(heading) };
  }

  excerptContext(mode, host, page) {
    const { root } = host.context;
    const linked = mode === 'embed' ? host.context.linked : () => {};
    return {
      ...this.context,
      root,
      excerpt: {
        mode,
        base: addressHref(root, this.url),
        target: (anchor) => {
          if (!this.targets.has(anchor)) return undefined;
          const target = { address: { path: this.url, anchor, query: '', text: `${this.url}#${anchor}` }, page };
          linked(target);
          return target;
        },
      },
      linked,
      embedLinks: (node) => this.embedLinks(node, root, mode === 'embed' ? host.context.linked : null),
    };
  }

  embedParts(node) {
    return (node.parts ?? []).map(({ address, page }) => {
      const source = page.article;
      const context = source.excerptContext('embed', this, page);
      this.borrowed.add(source);
      return {
        children: renderHast(source.embedNodes(address.anchor), context).children,
        href: addressHref(this.context.root, address.path, address.anchor),
        article: page.title,
        number: source.targetHeading(address.anchor, context).number,
      };
    });
  }

  embedLinks(node, root, linked) {
    return (node.parts ?? []).map((target) => {
      linked?.(target);
      const { address, page } = target;
      return { href: addressHref(root, address.path, address.anchor), target: address.text, text: page.article.targetHeading(address.anchor, this.context).text ?? page.title };
    });
  }

  preview(target, host) {
    const { address, page } = target;
    const context = this.excerptContext('preview', host, page);
    host.borrowed.add(this);
    const shared = { target: address.text, href: addressHref(host.context.root, address.path, address.anchor), article: page.title, html: this.previewHtml(address.anchor, context) };
    const found = address.anchor === undefined ? undefined : this.targets.get(address.anchor);
    if (found?.kind === 'reference') return { ...shared, kind: 'reference', number: found.node.number === undefined ? undefined : String(found.node.number) };
    const { number, title } = this.targetHeading(address.anchor, context);
    return { ...shared, kind: 'section', number, title };
  }

  readBlock(node) {
    const start = node.position.start;
    const [, name, attributeText] = BLOCK_LINE.exec(node.info);
    node.name = name ?? '';
    node.attributes = {};
    let offsets = {};
    if (attributeText !== undefined) {
      const parsed = parseAttributes(attributeText);
      node.attributes = parsed.attributes;
      offsets = parsed.offsets;
      if (parsed.error) this.report(start, parsed.error);
    }
    const label = node.name === '' ? ':::{width=…}' : `:::${node.name}`;
    if (!node.closed) this.report(start, `${label} is not closed; end it with a line of ${node.colons} or more colons`);
    if (node.name === '') {
      const written = node.attributes;
      node.attributes = this.checkAttributes(written, WIDTH_BLOCK_ATTRIBUTES, label, start);
      if (written.width === undefined) this.report(start, 'a block without a name must set width, for example :::{width=wide}');
      if (node.children.length !== 1) this.report(start, ':::{width=…} must contain exactly one block');
      const [child] = node.children;
      const childName = child?.type === 'bakeBlock' ? BLOCK_LINE.exec(child.info)?.[1] : undefined;
      if (childName?.includes('-') && !Object.hasOwn(BUILT_IN_BLOCKS, childName)) {
        this.report(start, `write the width of a component in its own braces, such as :::${childName}{width=wide}, instead of :::{width=…} around it`);
      }
    } else if (Object.hasOwn(BUILT_IN_BLOCKS, node.name)) {
      const written = node.attributes;
      node.attributes = this.checkAttributes(written, BUILT_IN_BLOCKS[node.name], label, start);
      if (node.name === 'fold' && written.title === undefined) this.report(start, ':::fold is missing "title"');
    } else if (!node.name.includes('-')) {
      this.report(start, `unknown block ":::${node.name}"`);
    } else {
      const attributeStart = start.offset + node.colons + node.name.length;
      this.readComponent(node, (attribute) => (attribute === undefined ? start : this.positionAt(attributeStart + offsets[attribute])));
    }
  }

  readComponent(node, attributePosition) {
    const component = this.components.get(node.name);
    if (component === undefined) {
      this.report(node.position.start, `unknown component "${node.name}"; components/ has no ${node.name}.js or ${node.name}.jsx`);
      return;
    }
    if (!component.valid) return;
    const resolved = resolveComponent(node.name, component, node.attributes, this.folder?.files ?? []);
    for (const { attribute, message } of resolved.problems) this.report(attributePosition(attribute), message);
    node.component = resolved;
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
      const parsed = parseAttributes(match[1]);
      if (parsed.error) this.report(position, parsed.error);
      const attributes = this.checkAttributes(parsed.attributes, HEADING_ATTRIBUTES, 'heading', position);
      node.attributes = attributes;
      for (const name of SECTION_ATTRIBUTES) if (attributes[name] !== undefined && node.depth !== 2) this.report(position, `${name} only applies to ## headings`);
      if (attributes.id !== undefined) this.addAnchor(attributes.id, position);
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

  checkAttributes(attributes, rules, label, position) {
    const names = Object.keys(attributes);
    for (const name of names.filter((name) => !Object.hasOwn(rules, name))) this.report(position, `unknown attribute "${name}" on ${label}`);
    const valid = {};
    for (const name of names.filter((name) => Object.hasOwn(rules, name))) {
      const problem = attributeProblem(name, rules[name], attributes[name]);
      if (problem) this.report(position, problem);
      else valid[name] = attributes[name];
    }
    return valid;
  }

  addAnchor(id, position) {
    const first = this.anchors.get(id);
    if (first) this.report(position, `duplicate anchor "${id}", first defined at ${first.line}:${first.column}`);
    else this.anchors.set(id, position);
  }

  generatedIds() {
    const ids = new Map();
    for (const { number } of this.sidenotes.values()) ids.set(sidenoteId(number), `sidenote ${number}`);
    for (const { key } of this.references) ids.set(referenceId(key), `the reference "${key}"`);
    const labelled = new Map([...this.equations].map(([label, { id }]) => [id, label]));
    for (const id of this.equationIds.keys()) ids.set(id, labelled.has(id) ? `the equation \\label{${labelled.get(id)}}` : `the equation (${id.slice(EQUATION_ID_PREFIX.length)})`);
    return ids;
  }

  readListTables(tree) {
    walk(tree, (node) => {
      if (node.type !== 'bakeBlock' || node.name !== 'list-table') return;
      const [list] = node.children;
      if (node.children.length !== 1 || list.type !== 'list') {
        this.report(node.position.start, ':::list-table must contain one list whose items are the rows of the table');
        return;
      }
      const rows = [];
      for (const item of list.children) {
        const [cells] = item.children;
        if (item.children.length !== 1 || cells.type !== 'list') {
          this.report(item.position.start, 'each :::list-table item is a row that holds a list of its cells');
          return;
        }
        rows.push(cells.children);
      }
      rows.forEach((cells, index) => {
        if (cells.length !== rows[0].length) this.report(list.children[index].position.start, `list-table row ${index + 1} has ${cells.length} ${cells.length === 1 ? 'cell' : 'cells'}, the header row has ${rows[0].length}`);
      });
      node.rows = rows;
    });
  }

  readRawHtml(tree) {
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'html') node.rawHtml = readRawHtml(node.value);
    });
  }

  readExamples(tree) {
    walk(tree, (node) => {
      if (node.type === 'bakeBlock' && node.name === 'example') node.sourceText = this.blockSource(node);
    });
  }

  blockSource(node) {
    const start = this.source.indexOf('\n', node.position.start.offset) + 1;
    const end = node.closed ? this.source.lastIndexOf('\n', node.position.end.offset - 1) : node.position.end.offset;
    if (start === 0 || end < start) return '';
    const indent = node.position.start.column - 1;
    return this.source
      .slice(start, end)
      .split('\n')
      .map((line) => line.replace(/\r$/, '').slice(Math.min(indent, /^[ \t]*/.exec(line)[0].length)))
      .join('\n');
  }

  async renderMath(tree) {
    const formulas = [];
    const references = [];
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') formulas.push(node);
      if (node.type === 'eqref') references.push(node);
    });
    if (formulas.length === 0 && references.length === 0) return;
    const { results, labels, glyphs } = await typesetMath(
      this.preamble,
      formulas.map((node) => ({ tex: node.value, display: node.type === 'math' })),
    );
    this.equations = labels;
    this.glyphs = glyphs;
    const equationIds = new Map();
    formulas.forEach((node, index) => {
      const result = results[index];
      node.rendered = result.html;
      node.ids = result.ids;
      const position = node.position.start;
      if (result.error !== undefined) this.report(position, `MathJax cannot typeset this formula: ${result.error}`);
      for (const label of result.labels) {
        if (label.trim() === '') this.report(position, '\\label{} needs a name, for example \\label{eq:ffn}');
        else if (node.type === 'inlineMath') this.report(position, `\\label{${label}} only works in a display formula between $$ lines`);
        else if (labels.get(label)?.tag === '???') this.report(position, `\\label{${label}} is not on a numbered equation; it is inside a starred environment or on a \\notag line`);
      }
      for (const reference of result.references) {
        if (!labels.has(reference.label)) this.report(position, `${reference.text} refers to an unknown \\label`);
      }
      for (const id of result.ids) {
        if (equationIds.has(id)) this.report(position, `two equations have the id "${id}"; the first is at ${equationIds.get(id).line}:${equationIds.get(id).column}`);
        else equationIds.set(id, position);
      }
    });
    this.equationIds = equationIds;
    for (const node of references) {
      if (!labels.has(node.label)) this.report(node.position.start, `${node.value} refers to an unknown \\label`);
    }
  }

  async loadCodeLanguages(tree) {
    const languages = new Set();
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'bakeBlock' && node.name === 'example') languages.add('markdown');
      if (node.type !== 'code') return;
      if (node.lang && !isKnownLanguage(node.lang)) {
        this.report(node.position.start, `unknown code language "${node.lang}"`);
        node.lang = null;
      }
      languages.add(node.lang ?? 'text');
    });
    if (languages.size > 0) this.context.highlighter = await loadLanguages([...languages]);
  }

  async readImages(tree) {
    const nodes = [];
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'image') nodes.push(node);
    });
    const sources = new Map();
    for (const node of nodes) {
      node.published = { src: node.url };
      if (node.attributes.float !== undefined && !node.inFigure) this.report(node.attributesPosition, 'float only applies to an image that starts a paragraph');
      const source = this.addressFile(node.url);
      if (source === null) {
        this.report(node.position.start, `image ${node.url} is not a file in the article folder`);
        continue;
      }
      if (!sources.has(source)) sources.set(source, { image: await readImage(join(this.folder.path, source)), nodes: [] });
      const entry = sources.get(source);
      if (entry.image.error !== undefined) this.report(node.position.start, `image ${source} cannot be read: ${entry.image.error}`);
      else if (entry.image.format === null) this.report(node.position.start, `image ${source} is not a ${IMAGE_FORMATS} file`);
      else entry.nodes.push(node);
    }
    const linked = this.linkedFiles(tree);
    const owners = new Map();
    const publishedPaths = new Map();
    for (const [source, { image, nodes: uses }] of sources) {
      if (uses.length === 0) continue;
      const published = publishedImage(source, image, uses.map((node) => displayWidth(node, image)));
      const position = uses[0].position.start;
      if (published.path !== source && this.folder.files.includes(published.path)) {
        this.report(position, `image ${source} is published as ${published.path}, which is also a file in the article folder`);
      } else if (owners.has(published.path)) {
        this.report(position, `images ${owners.get(published.path)} and ${source} are both published as ${published.path}`);
      }
      owners.set(published.path, source);
      if (published.convert !== null) this.images.set(source, { source, path: published.path, ...published.convert, keepSource: linked.has(source) });
      for (const node of uses) {
        node.published = imageProperties(node.attributes, published);
        publishedPaths.set(node, published.path);
      }
    }
    this.image = publishedPaths.get(nodes.find((node) => publishedPaths.has(node)));
  }

  linkedFiles(tree) {
    const files = new Set();
    if (this.folder === null) return files;
    this.walkWithSidenotes(tree, (node) => {
      if (node.type === 'link') files.add(this.addressFile(node.url));
      if (node.type === 'html') for (const address of node.rawHtml.addresses) files.add(this.addressFile(address));
      if (node.component === undefined) return;
      for (const value of Object.values(node.component.params)) if (typeof value === 'string') files.add(folderFile(value, this.folder.files));
    });
    return files;
  }

  addressFile(address) {
    if (this.folder === null || URL_SCHEME.test(address)) return null;
    const path = percentDecode(address.split(/[?#]/)[0]);
    return path === null ? null : folderFile(path, this.folder.files);
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
      let id = node.attributes.id;
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

  readImageAttributes(tree) {
    const paragraphs = [];
    walk(tree, (node, parent) => {
      if (node.type === 'paragraph' && node.children[0]?.type === 'image' && (parent.type === 'root' || parent.type === 'bakeBlock')) paragraphs.push({ paragraph: node, parent });
      if (node.type !== 'image') return;
      node.attributes = {};
      const next = parent.children[parent.children.indexOf(node) + 1];
      const match = next?.type === 'text' ? IMAGE_ATTRIBUTE_TEXT.exec(next.value) : null;
      if (!match) return;
      const position = next.position.start;
      next.value = next.value.slice(match[0].length);
      next.position = { ...next.position, start: this.positionAt(position.offset + match[0].length) };
      if (next.value === '') parent.children.splice(parent.children.indexOf(next), 1);
      const { attributes, error } = parseAttributes(match[0]);
      if (error) this.report(position, error);
      node.attributes = this.checkAttributes(attributes, IMAGE_ATTRIBUTES, 'image', position);
      node.attributesPosition = position;
      const width = parseSize(node.attributes.width);
      const height = parseSize(node.attributes.height);
      if (width !== null && height !== null && width.unit !== height.unit) this.report(position, 'image width and height must use the same unit');
    });
    for (const { paragraph, parent } of paragraphs) this.splitFigure(paragraph, parent);
  }

  splitFigure(paragraph, parent) {
    const [image, after, ...others] = paragraph.children;
    const startsLine = after === undefined || after.type === 'break' || (after.type === 'text' && after.value.startsWith('\n'));
    if (!startsLine) return;
    image.inFigure = true;
    const figure = { type: 'figure', children: [image, ...this.caption(image)], position: { start: image.position.start, end: paragraph.position.end } };
    const nodes = [figure];
    const rest = after?.type === 'text' ? [{ ...after, value: after.value.slice(1), position: { ...after.position, start: this.positionAt(after.position.start.offset + 1) } }, ...others] : others;
    if (rest.length > 0) {
      figure.position.end = after.position.start;
      nodes.push({ ...paragraph, children: rest, position: { start: rest[0].position.start, end: paragraph.position.end } });
    }
    parent.children.splice(parent.children.indexOf(paragraph), 1, ...nodes);
  }

  caption(image) {
    if (!image.title) return [];
    const children = processor.parse(image.title).children.flatMap((node) => (node.type === 'paragraph' ? node.children : [node]));
    walk({ children }, (node) => {
      node.position = image.position;
    });
    return [{ type: 'figcaption', children, position: image.position }];
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
    this.references = [...cited.map((entry) => ({ ...entry, number: this.citations.get(entry.key) })), ...uncited];
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
        const section = {
          ...this.headingFields(node),
          number: String(sections.length + 1).padStart(2, '0'),
          width: node.attributes.width,
          cols: count(node.attributes.cols),
          rows: count(node.attributes.rows),
          line: node.position.start.line,
          endLine: node.position.end.line,
          titleSidenotes: this.referencedSidenotes(node),
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
        this.attachRecap(node, recapTarget);
        continue;
      }
      const block = this.block(node);
      (current?.blocks ?? intro).push(block);
      if (node.type === 'heading' && node.depth === 3 && current) {
        const subsection = { id: block.id, title: block.title, text: block.text, toc: block.toc, line: block.line, endLine: block.endLine, titleSidenotes: block.sidenotes, recapSidenotes: [] };
        current.subsections.push(subsection);
        recapTarget = subsection;
      }
    }
    const sidenotes = [...this.sidenotes.values()].map(({ number, definition }) => ({
      number,
      id: sidenoteId(number),
      label: definition.label,
      line: definition.position.start.line,
      endLine: definition.position.end.line,
      html: renderChildrenHtml(definition.children, this.context),
      sidenotes: this.referencedSidenotes(definition),
    }));
    const references = this.references.map((entry) => ({ key: entry.key, number: entry.number, id: referenceId(entry.key), html: renderInlineHtml(entry.children, this.context) }));
    const previews = [...this.linked.values()].filter((target) => target.page.article !== null).map((target) => target.page.article.preview(target, this));
    const toc = sections.map((section) => ({
      id: section.id,
      number: section.number,
      title: section.toc,
      recap: section.recap,
      children: section.subsections.map((subsection) => ({ id: subsection.id, title: subsection.toc, recap: subsection.recap })),
    }));
    const html = [...intro, ...sections.flatMap((section) => section.blocks), ...sidenotes, ...previews].map((entry) => entry.html);
    const glyphs = addGlyphs(this.glyphs, [...this.borrowed].map((source) => source.glyphs), html);
    return {
      source: this.source,
      intro,
      sections,
      sidenotes,
      references,
      toc,
      previews,
      words: countWords(tree),
      glyphs,
      images: [...this.images.values()],
      image: this.image,
      components: this.usedComponents(tree),
    };
  }

  usedComponents(tree) {
    const names = new Set();
    const add = (node) => {
      if (node.type === 'bakeBlock' && node.component !== undefined) names.add(node.name);
    };
    this.walkWithSidenotes(tree, (node) => {
      add(node);
      for (const { address, page } of node.parts ?? []) {
        for (const embedded of page.article.embedNodes(address.anchor)) walk(embedded, add);
      }
    });
    return [...names].sort();
  }

  headingFields(node) {
    const text = toString(node);
    return { id: node.id, title: renderInlineHtml(node.children, this.context), text, toc: node.attributes.toc ?? text };
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
    target.recap = renderChildrenHtml(node.children, this.context);
    target.recapSidenotes = this.referencedSidenotes(node);
    this.recapLines.set(target, node.position.start);
  }

  referencedSidenotes(node) {
    const numbers = new Set();
    walk(node, (child) => {
      if (child.type === 'footnoteReference') numbers.add(this.sidenotes.get(child.identifier).number);
    });
    return [...numbers];
  }

  block(node) {
    if (node.type === 'bakeBlock' && node.name === '' && node.children.length === 1) {
      return { ...this.block(node.children[0]), line: node.position.start.line, endLine: node.position.end.line, width: node.attributes.width };
    }
    const block = { type: blockType(node), line: node.position.start.line, endLine: node.position.end.line, html: renderHtml(node, this.context), sidenotes: this.referencedSidenotes(node) };
    const width = naturalWidth(node);
    if (width !== undefined) block.naturalWidth = width;
    if (node.type === 'heading') Object.assign(block, { depth: node.depth }, this.headingFields(node));
    if (node.type === 'paragraph' && node.anchor !== undefined) block.id = node.anchor;
    if (node.type === 'bakeBlock' && block.type === 'example') Object.assign(block, exampleWidths(resultWidths(node)));
    if (node.type === 'bakeBlock' && block.type === 'component') {
      Object.assign(block, { name: node.name, attributes: node.attributes, params: node.component?.params });
      if (node.component?.width !== undefined) block.width = node.component.width;
    }
    return block;
  }

  positionAt(offset) {
    const before = this.source.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length, column: offset - lineStart + 1, offset };
  }
}

function attributeProblem(name, rule, value) {
  if (rule.choices !== undefined) return choiceProblem(name, rule.choices, value);
  if (rule.size !== undefined) return sizeProblem(rule.size, value, 'image');
  if (rule.count !== undefined) return typeof value === 'string' && COUNT.test(value) ? null : `${name} must be ${rule.count}`;
  return typeof value === 'string' ? null : `${name} must be ${rule.text}`;
}

function count(value) {
  return value === undefined ? undefined : Number(value);
}

function blockType(node) {
  if (node.type !== 'bakeBlock') return node.type;
  if (Object.hasOwn(BUILT_IN_BLOCKS, node.name)) return node.name;
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

function displayWidth(node, image) {
  const width = parseSize(node.attributes.width);
  const height = parseSize(node.attributes.height);
  if (width?.unit === 'px') return width.number;
  if (width === null && height?.unit === 'px') return (height.number * image.width) / image.height;
  return undefined;
}

function imageProperties(attributes, published) {
  const width = parseSize(attributes.width);
  const height = parseSize(attributes.height);
  const properties = { src: encodePath(published.path), width: published.width, height: published.height };
  if (width !== null && height !== null) return { ...properties, height: Math.round((published.width * height.number) / width.number), boxWidth: attributes.width };
  if (width !== null) return { ...properties, boxWidth: attributes.width };
  if (height !== null) return { ...properties, boxWidth: `${Number(((height.number * published.width) / published.height).toFixed(2))}${height.unit}` };
  return properties;
}

function walk(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  for (const child of [...(node.children ?? [])]) walk(child, visit, node);
}
