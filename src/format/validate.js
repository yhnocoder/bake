import { location } from 'vfile-location';

export const imageExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'];
const footnoteCall = /\[\^([^\]\s]+)\]/g;
const cardSpan = /^([1-4])x([1-9]\d*)$/;
const markers = { textDirective: ':', leafDirective: '::', containerDirective: ':::' };
const forms = { textDirective: 'text', leafDirective: 'leaf', containerDirective: 'container' };
const formMarkers = { text: ':', leaf: '::', container: ':::' };
const htmlContexts = { paragraph: 'a paragraph', heading: 'a heading', listItem: 'a list', tableCell: 'a table cell' };

function directiveLabel(node) {
  return `${markers[node.type]}${node.name}`;
}

function isDirective(node) {
  return node.type in markers;
}

export function contentChildren(node) {
  return node.children.filter((child) => !child.data?.directiveLabel);
}

export function directiveAttributeError(name, key, value, properties) {
  const property = properties[key];
  if (property?.type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) {
    return `Attribute ${key} must be a number, got ${value}`;
  }
  if (property?.type === 'boolean' && value !== 'true' && value !== 'false') {
    return `Attribute ${key} must be true or false, got ${value}`;
  }
  if (property?.type === 'enum' && !property.options.includes(value)) {
    return `Attribute ${key} must be one of ${property.options.join(', ')}, got ${value}`;
  }
  if (name === 'card' && key === 'span' && !cardSpan.test(value)) {
    return `:::card span must be COLUMNSxROWS with 1 to 4 columns, got ${value}`;
  }
  return null;
}

function checkDirectiveAttributes(node, properties, report) {
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    const property = properties[key];
    if (!property) {
      report(node, `Unknown attribute ${key} on ${directiveLabel(node)}`);
      continue;
    }
    const error = directiveAttributeError(node.name, key, value ?? '', properties);
    if (error) report(node, error);
  }
}

function checkComponent(node, components, report) {
  if (node.type === 'textDirective') {
    report(node, `Component ${directiveLabel(node)} must be written as ::${node.name} or :::${node.name}`);
    return;
  }
  if (!components) return;
  if (!Object.hasOwn(components, node.name)) {
    report(node, `Unknown component ${directiveLabel(node)}`);
    return;
  }
  checkDirectiveAttributes(node, components[node.name], report);
}

function checkStructure(node, parent, index, report) {
  const siblings = parent.children;
  switch (node.name) {
    case 'lede': {
      const firstBlock = siblings.find((child) => child.type !== 'yaml');
      if (parent.type !== 'root' || firstBlock !== node) report(node, `${directiveLabel(node)} must be the first block`);
      break;
    }
    case 'subtitle':
      if (siblings[index - 1]?.type !== 'heading') report(node, `${directiveLabel(node)} must directly follow a heading`);
      break;
    case 'source':
      if (parent.type !== 'blockquote' || index !== siblings.length - 1) report(node, `${directiveLabel(node)} must be the last child of a blockquote`);
      break;
    case 'fold': {
      const label = node.children[0];
      if (!label?.data?.directiveLabel || label.children.length === 0) report(node, `${directiveLabel(node)} requires a title in brackets`);
      break;
    }
    case 'bento':
      if (!node.children.every((child) => child.type === 'containerDirective' && child.name === 'card')) {
        report(node, `${directiveLabel(node)} can only contain :::card`);
      }
      break;
    case 'card': {
      if (parent.type !== 'containerDirective' || parent.name !== 'bento') report(node, `${directiveLabel(node)} must be inside :::bento`);
      break;
    }
    case 'references': {
      const content = contentChildren(node);
      if (content.length !== 1 || content[0].type !== 'list') report(node, `${directiveLabel(node)} must contain exactly one list`);
      break;
    }
    case 'span':
      if (siblings[index + 1]?.type !== 'footnoteReference') report(node, `${directiveLabel(node)} must be directly followed by a footnote reference`);
      break;
  }
}

function checkDirective(node, parent, index, { registry, components }, report) {
  if (node.name.includes('-')) {
    checkComponent(node, components, report);
    return;
  }
  const block = registry.get(node.name);
  if (!block) {
    report(node, `Unknown directive ${directiveLabel(node)}`);
    return;
  }
  if (block.form !== forms[node.type]) {
    report(node, `${directiveLabel(node)} must be written as ${formMarkers[block.form]}${node.name}`);
    return;
  }
  checkDirectiveAttributes(node, block.attributes ?? {}, report);
  checkStructure(node, parent, index, report);
}

function checkImage(node, parent, report) {
  const path = node.url.split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (path.lastIndexOf('.') === -1 || !imageExtensions.includes(extension)) {
    report(node, `Unsupported image format ${node.url}`);
  }
  if (parent.type === 'paragraph' && parent.children.length !== 1) report(node, 'Image must be the only content of its paragraph');
}

function checkHtml(node, ancestors, report) {
  const context = ancestors.findLast((ancestor) => ancestor.type in htmlContexts);
  if (context) report(node, `HTML tag ${node.value} is not allowed in ${htmlContexts[context.type]}`);
}

function checkFootnotes(source, points, footnotes, report, reportAt) {
  const referenceCounts = new Map();
  for (const reference of footnotes.references) {
    const count = (referenceCounts.get(reference.identifier) ?? 0) + 1;
    referenceCounts.set(reference.identifier, count);
    if (count === 2) report(reference, `Footnote [^${reference.label}] is referenced more than once`);
  }
  for (const definition of footnotes.definitions) {
    if (!referenceCounts.has(definition.identifier)) report(definition, `Footnote [^${definition.label}] is defined but never referenced`);
  }
  for (const text of footnotes.texts) {
    const raw = source.slice(text.position.start.offset, text.position.end.offset);
    for (const match of raw.matchAll(footnoteCall)) {
      if (raw[match.index - 1] === '\\') continue;
      reportAt(points.toPoint(text.position.start.offset + match.index), `Footnote [^${match[1]}] is not defined`);
    }
  }
}

export function validateContent(tree, file, { registry, components }) {
  const source = String(file.value);
  const points = location(file);
  const report = (node, text) => file.message(text, node.position);
  const reportAt = (point, text) => file.message(text, point);
  const footnotes = { references: [], definitions: [], texts: [] };
  const walk = (node, ancestors) => {
    const parent = ancestors.at(-1);
    const index = parent ? parent.children.indexOf(node) : -1;
    if (isDirective(node)) checkDirective(node, parent, index, { registry, components }, report);
    else if (node.type === 'image') checkImage(node, parent, report);
    else if (node.type === 'html' && !node.value.startsWith('</')) checkHtml(node, ancestors, report);
    else if (node.type === 'footnoteReference') footnotes.references.push(node);
    else if (node.type === 'footnoteDefinition') footnotes.definitions.push(node);
    else if (node.type === 'text' && node.position) footnotes.texts.push(node);
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  };
  walk(tree, []);
  checkFootnotes(source, points, footnotes, report, reportAt);
}
