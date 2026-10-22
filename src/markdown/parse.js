import assert from 'node:assert/strict';
import { posix } from 'node:path';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { convertAttribute, optionProblem, resolveComponent } from '../components/declarations.js';
import { WIDTHS, choiceProblem, folderFile, parseSize, sizeProblem } from '../config/rules.js';
import { percentDecode, referenceId, sidenoteId } from '../shared/fragments.js';
import { isKnownLanguage, loadLanguages } from '../render/code.js';
import { IMAGE_FORMATS, publishedImage, readImage } from '../render/images.js';
import { EQUATION_ID_PREFIX, typesetMath } from '../render/math.js';
import { listAll } from '../shared/report.js';
import { encodePath } from '../shared/urls.js';
import { HEADING_ATTRIBUTE_SUFFIX, PARAGRAPH_ANCHOR_SUFFIX, parseAttributes } from './attributes.js';
import { bakeBlocks } from './block-syntax.js';
import { citationsAndMissingFootnotes } from './bracket-syntax.js';
import { equationReferences } from './eqref-syntax.js';
import { highlight } from './highlight-syntax.js';
import { readRawHtml } from './raw-html.js';
import { REMARK_PLUGINS } from './remark-plugins.js';
import { parseWithPipesInMath } from './table-math.js';
import { walk, walkWithSidenotes } from './tree.js';

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
const HEADING_ID = { text: 'an anchor name, for example {#intro}' };
const IMAGE_FLOATS = ['left', 'right'];
const IMAGE_ATTRIBUTES = {
  width: { size: 'image width' },
  height: { size: 'image height' },
  float: { choices: IMAGE_FLOATS },
};
const BLOCK_LINE = /^([A-Za-z][\w-]*)?(\{.*\})?$/;
const STRAY_CLOSING_LINE = /^([\s>]*):{3,}\s*$/;
const IMAGE_ATTRIBUTE_TEXT = /^\{[^{}\n]*\}/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WHITESPACE = /\s/;

// The stages run in this order on the syntax tree of the article, and each one reads what the stages before it wrote.
const STAGES = [
  // reads the blocks, headings and paragraphs, the theme and the components; writes their names, attributes, components and anchors, and article.anchors
  readBlocksAndAnchors,
  // reads the link definitions; replaces each link and image reference with the link or image it defines and removes the definitions
  (article, tree) => resolveLinkReferences(tree),
  // reads the text after each image; writes the attributes of the image and turns an image that starts a paragraph into a figure
  readImageAttributes,
  // reads the footnote definitions and references; writes article.definitions and article.sidenotes, which walkWithSidenotes follows
  readFootnotes,
  // reads :::references and the citations; writes article.citations and article.references
  readCitations,
  // reads each :::list-table; writes its rows
  readListTables,
  // reads the source of each :::example; writes its source text
  readExamples,
  // reads each raw HTML node; writes its ids, the addresses it links to and its HTML without the ids
  readHtmlNodes,
  // reads the formulas, the \eqref references and the preamble; writes the rendered formulas, article.equations, article.equationIds and article.glyphs
  renderMath,
  // reads article.anchors and the ids of the sidenotes, references and equations; reports an anchor that is also one of those ids
  checkGeneratedIds,
  // reads the headings, article.anchors and the ids of the sidenotes, references and equations; writes the id of each heading
  assignHeadingIds,
  // reads the language of each code block; writes the language and article.context.highlighter
  loadCodeLanguages,
  // reads the images, their attributes, the folder, the links, the addresses of the raw HTML and the component parameters; writes article.images, article.image and the published form of each image
  readImages,
];
// why: run before the stages that write the anchors and the generated ids, the id stages read empty maps without failing, and a duplicate id would go unreported
for (const writer of [readBlocksAndAnchors, readFootnotes, readCitations, renderMath]) {
  for (const reader of [checkGeneratedIds, assignHeadingIds]) assert.ok(STAGES.indexOf(writer) < STAGES.indexOf(reader), `${writer.name} must run before ${reader.name}`);
}

export async function parseArticle(article) {
  const tree = parseWithPipesInMath(processor, article.source);
  tree.children = tree.children.filter((node) => node.type !== 'yaml');
  for (const stage of STAGES) await stage(article, tree);
  article.tree = tree;
}

export function generatedIds(article) {
  const ids = new Map();
  for (const { number } of article.sidenotes.values()) ids.set(sidenoteId(number), `sidenote ${number}`);
  for (const { key } of article.references) ids.set(referenceId(key), `the reference "${key}"`);
  const labelled = new Map([...article.equations].map(([label, { id }]) => [id, label]));
  for (const id of article.equationIds.keys()) ids.set(id, labelled.has(id) ? `the equation \\label{${labelled.get(id)}}` : `the equation (${id.slice(EQUATION_ID_PREFIX.length)})`);
  return ids;
}

function readBlocksAndAnchors(article, tree) {
  walk(tree, (node, parent) => {
    if (node.type === 'bakeBlock') readBlock(article, node, parent);
    if (node.type === 'heading') readHeading(article, node);
    if (node.type === 'paragraph') {
      readStrayClosingLines(article, node);
      readParagraphAnchor(article, node);
    }
  });
}

function readBlock(article, node, parent) {
  const start = node.position.start;
  const [, name, attributeText] = BLOCK_LINE.exec(node.info);
  node.name = name ?? '';
  node.attributes = {};
  let offsets = {};
  if (attributeText !== undefined) {
    const parsed = parseAttributes(attributeText);
    node.attributes = parsed.attributes;
    offsets = parsed.offsets;
    if (parsed.error) article.report(start, parsed.error);
  }
  const label = node.name === '' ? ':::{width=…}' : `:::${node.name}`;
  if (!node.closed) article.report(start, `${label} is not closed; end it with a line of ${node.colons} or more colons`);
  if (node.name === '') {
    const written = node.attributes;
    node.attributes = checkAttributes(article, written, WIDTH_BLOCK_ATTRIBUTES, label, start);
    if (written.width === undefined) article.report(start, 'a block without a name must set width, for example :::{width=wide}');
    if (node.children.length !== 1) article.report(start, ':::{width=…} must contain exactly one block');
    const [child] = node.children;
    const childName = child?.type === 'bakeBlock' ? BLOCK_LINE.exec(child.info)?.[1] : undefined;
    if (childName?.includes('-') && !Object.hasOwn(BUILT_IN_BLOCKS, childName)) {
      article.report(start, `write the width of a component in its own braces, such as :::${childName}{width=wide}, instead of :::{width=…} around it`);
    }
  } else if (Object.hasOwn(BUILT_IN_BLOCKS, node.name)) {
    const written = node.attributes;
    node.attributes = checkAttributes(article, written, BUILT_IN_BLOCKS[node.name], label, start);
    if (node.name === 'fold' && written.title === undefined) article.report(start, ':::fold is missing "title"');
  } else if (!node.name.includes('-')) {
    const attributeStart = start.offset + node.colons + node.name.length;
    readThemeBlock(article, node, parent, (attribute) => article.positionAt(attributeStart + offsets[attribute]));
  } else {
    const attributeStart = start.offset + node.colons + node.name.length;
    readComponent(article, node, (attribute) => (attribute === undefined ? start : article.positionAt(attributeStart + offsets[attribute])));
  }
}

function readComponent(article, node, attributePosition) {
  const component = article.components.get(node.name);
  if (component === undefined) {
    article.report(node.position.start, `unknown component "${node.name}"; there is no ${node.name}.js or ${node.name}.jsx in components/ or in the components/ folder of this article`);
    return;
  }
  if (component.article !== null && component.article !== posix.dirname(article.file)) {
    article.report(node.position.start, `component "${node.name}" belongs to ${component.article} and works only in that article; move ${component.file} to components/ to use it in other articles`);
    return;
  }
  if (!component.valid) return;
  const resolved = resolveComponent(node.name, component, node.attributes, article.folder?.files ?? []);
  for (const { attribute, message } of resolved.problems) article.report(attributePosition(attribute), message);
  node.component = resolved;
}

function readThemeBlock(article, node, parent, attributePosition) {
  const { name, blocks } = article.theme;
  const start = node.position.start;
  if (!Object.hasOwn(blocks, node.name)) {
    const names = Object.keys(blocks);
    article.report(start, `unknown block ":::${node.name}"; ${names.length === 0 ? `the ${name} theme declares no blocks` : `the blocks of the ${name} theme are ${listAll(names)}`}`);
    return;
  }
  if (parent.type !== 'root') article.report(start, `:::${node.name} of the ${name} theme stands at the top level of the article, outside other blocks, lists and quotes`);
  const declarations = blocks[node.name];
  const names = Object.keys(declarations);
  const takes = names.length === 0 ? 'takes no attributes' : `takes ${listAll(names)}`;
  node.attributes = themeAttributes(article, node.attributes, declarations, attributePosition, (attribute) => `unknown attribute "${attribute}" on :::${node.name}; :::${node.name} of the ${name} theme ${takes}`);
  node.themeBlock = true;
}

function themeAttributes(article, attributes, declarations, attributePosition, unknown) {
  const values = {};
  for (const [name, written] of Object.entries(attributes)) {
    if (!Object.hasOwn(declarations, name)) {
      article.report(attributePosition(name), unknown(name));
      continue;
    }
    const { value, problem } = convertAttribute(declarations[name], written);
    const message = problem ?? optionProblem(declarations[name], value);
    if (message === null) values[name] = value;
    else article.report(attributePosition(name), `${name} ${message}`);
  }
  return values;
}

function readHeading(article, node) {
  if (node.depth === 1) article.report(node.position.start, 'heading level 1 is not allowed; the article title comes from front matter, sections start at ##');
  node.attributes = {};
  const last = node.children.at(-1);
  const match = last?.type === 'text' ? HEADING_ATTRIBUTE_SUFFIX.exec(last.value) : null;
  const raw = match ? article.source.slice(last.position.start.offset, last.position.end.offset) : '';
  if (match && !isEscaped(raw, raw.lastIndexOf('{'))) {
    const position = article.positionAt(last.position.start.offset + raw.lastIndexOf('{'));
    last.value = last.value.slice(0, match.index);
    if (last.value === '') node.children.pop();
    const parsed = parseAttributes(match[1]);
    if (parsed.error) article.report(position, parsed.error);
    const { id, ...written } = parsed.attributes;
    const attributePosition = (name) => article.positionAt(position.offset + parsed.offsets[name]);
    const { name, headings } = article.theme;
    for (const [attribute, { depth }] of Object.entries(headings)) {
      if (depth === undefined || depth === node.depth || written[attribute] === undefined) continue;
      article.report(attributePosition(attribute), `${attribute} only applies to ${'#'.repeat(depth)} headings`);
      delete written[attribute];
    }
    const reads = ['#id', ...Object.keys(headings)];
    node.attributes = themeAttributes(article, written, headings, attributePosition, (attribute) => `unknown attribute "${attribute}" on heading; the ${name} theme reads ${listAll(reads)}`);
    if (id !== undefined) {
      const problem = attributeProblem('id', HEADING_ID, id);
      if (problem) article.report(position, problem);
      else {
        node.attributes = { id, ...node.attributes };
        addAnchor(article, id, position);
      }
    }
  }
}

function readStrayClosingLines(article, node) {
  const raw = article.source.slice(node.position.start.offset, node.position.end.offset);
  let offset = node.position.start.offset;
  for (const line of raw.split('\n')) {
    const colons = STRAY_CLOSING_LINE.exec(line);
    if (colons) article.report(article.positionAt(offset + colons[1].length), 'this ::: line closes no block; a block inside another block needs fewer colons than the outer block');
    offset += line.length + 1;
  }
}

function readParagraphAnchor(article, node) {
  const last = node.children.at(-1);
  const match = last?.type === 'text' ? PARAGRAPH_ANCHOR_SUFFIX.exec(last.value) : null;
  if (!match) return;
  const raw = article.source.slice(last.position.start.offset, last.position.end.offset);
  if (isEscaped(raw, raw.lastIndexOf('^'))) return;
  const position = article.positionAt(last.position.start.offset + raw.lastIndexOf('^'));
  last.value = last.value.slice(0, match.index).trimEnd();
  if (last.value === '') node.children.pop();
  node.data = { hProperties: { id: match[1] } };
  node.anchor = match[1];
  addAnchor(article, match[1], position);
}

function checkAttributes(article, attributes, rules, label, position) {
  const names = Object.keys(attributes);
  for (const name of names.filter((name) => !Object.hasOwn(rules, name))) article.report(position, `unknown attribute "${name}" on ${label}`);
  const valid = {};
  for (const name of names.filter((name) => Object.hasOwn(rules, name))) {
    const problem = attributeProblem(name, rules[name], attributes[name]);
    if (problem) article.report(position, problem);
    else valid[name] = attributes[name];
  }
  return valid;
}

function addAnchor(article, id, position) {
  const first = article.anchors.get(id);
  if (first) article.report(position, `duplicate anchor "${id}", first defined at ${first.line}:${first.column}`);
  else article.anchors.set(id, position);
}

function readListTables(article, tree) {
  walk(tree, (node) => {
    if (node.type !== 'bakeBlock' || node.name !== 'list-table') return;
    const [list] = node.children;
    if (node.children.length !== 1 || list.type !== 'list') {
      article.report(node.position.start, ':::list-table must contain one list whose items are the rows of the table');
      return;
    }
    const rows = [];
    for (const item of list.children) {
      const [cells] = item.children;
      if (item.children.length !== 1 || cells.type !== 'list') {
        article.report(item.position.start, 'each :::list-table item is a row that holds a list of its cells');
        return;
      }
      rows.push(cells.children);
    }
    rows.forEach((cells, index) => {
      if (cells.length !== rows[0].length) article.report(list.children[index].position.start, `list-table row ${index + 1} has ${cells.length} ${cells.length === 1 ? 'cell' : 'cells'}, the header row has ${rows[0].length}`);
    });
    node.rows = rows;
  });
}

function readHtmlNodes(article, tree) {
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'html') node.rawHtml = readRawHtml(node.value);
  });
}

function readExamples(article, tree) {
  walk(tree, (node) => {
    if (node.type === 'bakeBlock' && node.name === 'example') node.sourceText = blockSource(article, node);
  });
}

function blockSource(article, node) {
  const { source } = article;
  const start = source.indexOf('\n', node.position.start.offset) + 1;
  const end = node.closed ? source.lastIndexOf('\n', node.position.end.offset - 1) : node.position.end.offset;
  if (start === 0 || end < start) return '';
  const indent = node.position.start.column - 1;
  return source
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/\r$/, '').slice(Math.min(indent, /^[ \t]*/.exec(line)[0].length)))
    .join('\n');
}

async function renderMath(article, tree) {
  const formulas = [];
  const references = [];
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'math' || node.type === 'inlineMath') formulas.push(node);
    if (node.type === 'eqref') references.push(node);
  });
  if (formulas.length === 0 && references.length === 0) return;
  const { results, labels, glyphs } = await typesetMath(
    article.preamble,
    formulas.map((node) => ({ tex: node.value, display: node.type === 'math' })),
  );
  article.equations = labels;
  article.glyphs = glyphs;
  const equationIds = new Map();
  formulas.forEach((node, index) => {
    const result = results[index];
    node.rendered = result.html;
    node.ids = result.ids;
    const position = node.position.start;
    if (result.error !== undefined) article.report(position, `MathJax cannot typeset this formula: ${result.error}`);
    for (const { name: label, afterEnvironment } of result.labels) {
      if (label.trim() === '') article.report(position, '\\label{} needs a name, for example \\label{eq:ffn}');
      else if (WHITESPACE.test(label)) article.report(position, `\\label{${label}} has a space; a label name has no spaces, for example \\label{eq:ffn}`);
      else if (node.type === 'inlineMath') article.report(position, `\\label{${label}} only works in a display formula between $$ lines`);
      else if (labels.get(label)?.tag === '???' && afterEnvironment) article.report(position, `\\label{${label}} is outside the environment of its equation; write it inside \\begin{…} and \\end{…}, on the line it labels`);
      else if (labels.get(label)?.tag === '???') article.report(position, `\\label{${label}} is not on a numbered equation; it is inside a starred environment or on a \\notag line`);
    }
    for (const reference of result.references) {
      if (!labels.has(reference.label)) article.report(position, `${reference.text} refers to an unknown \\label`);
    }
    for (const id of result.ids) {
      if (equationIds.has(id)) article.report(position, `two equations have the id "${id}"; the first is at ${equationIds.get(id).line}:${equationIds.get(id).column}`);
      else equationIds.set(id, position);
    }
  });
  article.equationIds = equationIds;
  for (const node of references) {
    if (WHITESPACE.test(node.label)) article.report(node.position.start, `${node.value} has a space; a label name has no spaces, for example \\eqref{eq:ffn}`);
    else if (!labels.has(node.label)) article.report(node.position.start, `${node.value} refers to an unknown \\label`);
  }
}

async function loadCodeLanguages(article, tree) {
  const languages = new Set();
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'bakeBlock' && node.name === 'example') languages.add('markdown');
    if (node.type !== 'code') return;
    if (node.lang && !isKnownLanguage(node.lang)) {
      article.report(node.position.start, `unknown code language "${node.lang}"`);
      node.lang = null;
    }
    languages.add(node.lang ?? 'text');
  });
  if (languages.size > 0) article.context.highlighter = await loadLanguages([...languages]);
}

async function readImages(article, tree) {
  const nodes = [];
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'image') nodes.push(node);
  });
  const sources = new Map();
  for (const node of nodes) {
    node.published = { src: node.url };
    if (node.attributes.float !== undefined && !node.inFigure) article.report(node.attributesPosition, 'float only applies to an image that starts a paragraph');
    const source = addressFile(article, node.url);
    if (source === null) {
      article.report(node.position.start, `image ${node.url} is not a file in the article folder`);
      continue;
    }
    if (!sources.has(source)) sources.set(source, { image: await readImage(article.folder.read(source)), nodes: [] });
    const entry = sources.get(source);
    if (entry.image.error !== undefined) article.report(node.position.start, `image ${source} cannot be read: ${entry.image.error}`);
    else if (entry.image.format === null) article.report(node.position.start, `image ${source} is not a ${IMAGE_FORMATS} file`);
    else entry.nodes.push(node);
  }
  const linked = linkedFiles(article, tree);
  const owners = new Map();
  const publishedPaths = new Map();
  for (const [source, { image, nodes: uses }] of sources) {
    if (uses.length === 0) continue;
    const published = publishedImage(source, image, uses.map((node) => displayWidth(node, image)));
    const position = uses[0].position.start;
    if (published.path !== source && article.folder.files.includes(published.path)) {
      article.report(position, `image ${source} is published as ${published.path}, which is also a file in the article folder`);
    } else if (owners.has(published.path)) {
      article.report(position, `images ${owners.get(published.path)} and ${source} are both published as ${published.path}`);
    }
    owners.set(published.path, source);
    if (published.convert !== null) article.images.set(source, { source, path: published.path, ...published.convert, keepSource: linked.has(source) });
    for (const node of uses) {
      node.published = imageProperties(node.attributes, published);
      publishedPaths.set(node, published.path);
    }
  }
  article.image = publishedPaths.get(nodes.find((node) => publishedPaths.has(node)));
}

function linkedFiles(article, tree) {
  const files = new Set();
  if (article.folder === null) return files;
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'link') files.add(addressFile(article, node.url));
    if (node.type === 'html') for (const address of node.rawHtml.addresses) files.add(addressFile(article, address));
    if (node.component === undefined) return;
    for (const value of Object.values(node.component.params)) if (typeof value === 'string') files.add(folderFile(value, article.folder.files));
  });
  return files;
}

function addressFile(article, address) {
  if (article.folder === null || URL_SCHEME.test(address)) return null;
  const path = percentDecode(address.split(/[?#]/)[0]);
  return path === null ? null : folderFile(path, article.folder.files);
}

function checkGeneratedIds(article) {
  const generated = generatedIds(article);
  for (const [id, position] of article.anchors) {
    if (generated.has(id)) article.report(position, `anchor "${id}" is also the id of ${generated.get(id)}`);
  }
}

function assignHeadingIds(article, tree) {
  const generated = generatedIds(article);
  const taken = (id) => article.anchors.has(id) || generated.has(id);
  const slugger = new GithubSlugger();
  walk(tree, (node) => {
    if (node.type !== 'heading') return;
    let id = node.attributes.id;
    while (id === undefined || (node.attributes.id === undefined && taken(id))) id = slugger.slug(toString(node));
    node.id = id;
    node.data = { hProperties: { id } };
  });
}

function resolveLinkReferences(tree) {
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

function readImageAttributes(article, tree) {
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
    next.position = { ...next.position, start: article.positionAt(position.offset + match[0].length) };
    if (next.value === '') parent.children.splice(parent.children.indexOf(next), 1);
    const { attributes, error } = parseAttributes(match[0]);
    if (error) article.report(position, error);
    node.attributes = checkAttributes(article, attributes, IMAGE_ATTRIBUTES, 'image', position);
    node.attributesPosition = position;
    const width = parseSize(node.attributes.width);
    const height = parseSize(node.attributes.height);
    if (width !== null && height !== null && width.unit !== height.unit) article.report(position, 'image width and height must use the same unit');
  });
  for (const { paragraph, parent } of paragraphs) splitFigure(article, paragraph, parent);
}

function splitFigure(article, paragraph, parent) {
  const [image, after, ...others] = paragraph.children;
  const startsLine = after === undefined || after.type === 'break' || (after.type === 'text' && after.value.startsWith('\n'));
  if (!startsLine) return;
  image.inFigure = true;
  const figure = { type: 'figure', children: [image, ...caption(image)], position: { start: image.position.start, end: paragraph.position.end } };
  const nodes = [figure];
  const rest = after?.type === 'text' ? [{ ...after, value: after.value.slice(1), position: { ...after.position, start: article.positionAt(after.position.start.offset + 1) } }, ...others] : others;
  if (rest.length > 0) {
    figure.position.end = after.position.start;
    nodes.push({ ...paragraph, children: rest, position: { start: rest[0].position.start, end: paragraph.position.end } });
  }
  parent.children.splice(parent.children.indexOf(paragraph), 1, ...nodes);
}

function caption(image) {
  if (!image.title) return [];
  const children = processor.parse(image.title).children.flatMap((node) => (node.type === 'paragraph' ? node.children : [node]));
  walk({ children }, (node) => {
    node.position = image.position;
  });
  return [{ type: 'figcaption', children, position: image.position }];
}

function readFootnotes(article, tree) {
  walk(tree, (node, parent) => {
    if (node.type !== 'footnoteDefinition') return;
    const first = article.definitions.get(node.identifier);
    if (first) article.report(node.position.start, `footnote "${node.label}" is defined twice, first at ${first.position.start.line}:${first.position.start.column}`);
    else article.definitions.set(node.identifier, node);
    parent.children = parent.children.filter((child) => child !== node);
    return false;
  });
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'missingFootnote') article.report(node.position.start, `footnote "${node.label}" has no definition`);
    if (node.type === 'footnoteReference' && !article.sidenotes.has(node.identifier)) {
      article.sidenotes.set(node.identifier, { number: article.sidenotes.size + 1, definition: article.definitions.get(node.identifier) });
    }
  });
  for (const [identifier, definition] of article.definitions) {
    if (!article.sidenotes.has(identifier)) article.report(definition.position.start, `footnote "${definition.label}" is defined but never used`);
  }
}

function readCitations(article, tree) {
  const blocks = [];
  walk(tree, (node) => {
    if (node.type === 'bakeBlock' && node.name === 'references') blocks.push(node);
  });
  for (const extra of blocks.slice(1)) {
    const first = blocks[0].position.start;
    article.report(extra.position.start, `an article has one :::references block, the first is at ${first.line}:${first.column}`);
  }
  const entries = new Map();
  if (blocks.length > 0) readReferenceEntries(article, blocks[0], entries);
  const cited = [];
  walkWithSidenotes(article, tree, (node) => {
    if (node.type === 'bakeBlock' && node.name === 'references') return false;
    if (node.type !== 'citation') return;
    if (!entries.has(node.key)) article.report(node.position.start, `citation "${node.key}" is not in :::references`);
    else if (!article.citations.has(node.key)) {
      article.citations.set(node.key, article.citations.size + 1);
      cited.push(entries.get(node.key));
    }
  });
  const uncited = [...entries.values()].filter((entry) => !article.citations.has(entry.key));
  article.references = [...cited.map((entry) => ({ ...entry, number: article.citations.get(entry.key) })), ...uncited];
}

function readReferenceEntries(article, block, entries) {
  const items = block.children.length === 1 && block.children[0].type === 'list' ? block.children[0].children : null;
  if (items === null) {
    article.report(block.position.start, ':::references must contain one list whose items start with [@key]');
    return;
  }
  for (const item of items) {
    const paragraph = item.children[0];
    const citation = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined;
    if (item.children.length !== 1 || citation?.type !== 'citation') {
      article.report(item.position.start, 'each :::references item is one paragraph that starts with [@key]');
      continue;
    }
    const first = entries.get(citation.key);
    if (first) {
      article.report(citation.position.start, `reference "${citation.key}" is listed twice, first at ${first.position.line}:${first.position.column}`);
      continue;
    }
    const children = paragraph.children.slice(1);
    if (children[0]?.type === 'text') children[0] = { ...children[0], value: children[0].value.trimStart() };
    entries.set(citation.key, { key: citation.key, children, position: citation.position.start });
  }
}

function attributeProblem(name, rule, value) {
  if (rule.choices !== undefined) return choiceProblem(name, rule.choices, value);
  if (rule.size !== undefined) return sizeProblem(rule.size, value, 'image');
  return typeof value === 'string' ? null : `${name} must be ${rule.text}`;
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

function isEscaped(text, index) {
  let backslashes = 0;
  while (text[index - 1 - backslashes] === '\\') backslashes++;
  return backslashes % 2 === 1;
}
