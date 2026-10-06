import { defaultHandlers } from 'mdast-util-to-markdown';
import { visit } from 'unist-util-visit';
import { location } from 'vfile-location';

const unquotedValue = /^[^\t\n\r "'<=>`}]+$/;
const headingAttributes = / \{([^{}]*)\}$/;
const imageAttributes = /^\{([^{}]*)\}/;
const attributeToken = /\s*(?:#([^\s"=}]+)|\.([^\s"=}]+)|([A-Za-z][\w-]*)=(?:"([^"]*)"|([^\s"]+)))/y;
const identifier = /^[A-Za-z][\w-]*$/;
const size = /^\d+(?:\.\d+)?(?:px|%|em)?$/;

const rules = {
  heading: {
    id: (value) => identifier.test(value),
    toc: () => true,
  },
  image: {
    width: (value) => size.test(value),
    height: (value) => size.test(value),
    float: (value) => ['none', 'left', 'right'].includes(value),
  },
};

const allowedValues = {
  id: 'start with a letter and contain only letters, digits, - and _',
  toc: 'be a string',
  width: 'be a number with optional px, %, or em',
  height: 'be a number with optional px, %, or em',
  float: 'be one of none, left, right',
};

function readAttributes(content) {
  const attributes = {};
  const errors = [];
  attributeToken.lastIndex = 0;
  let index = 0;
  while (index < content.length) {
    attributeToken.lastIndex = index;
    const match = attributeToken.exec(content);
    if (!match) {
      if (content.slice(index).trim() === '') break;
      errors.push(`Cannot parse attributes {${content}}`);
      return { attributes, errors };
    }
    const [, id, className, key, quoted, unquoted] = match;
    if (id !== undefined) attributes.id = id;
    else if (className !== undefined) errors.push(`Unsupported class attribute .${className}`);
    else attributes[key] = quoted ?? unquoted;
    index = attributeToken.lastIndex;
  }
  return { attributes, errors };
}

function checkAttributes(kind, attributes) {
  const errors = [];
  const label = kind === 'heading' ? 'heading' : 'image';
  for (const [key, value] of Object.entries(attributes)) {
    const rule = rules[kind][key];
    if (!rule) errors.push(`Unknown ${label} attribute ${key}`);
    else if (!rule(value)) errors.push(`${capitalize(label)} attribute ${key} must ${allowedValues[key]}, got ${value}`);
  }
  return errors;
}

function capitalize(text) {
  return text[0].toUpperCase() + text.slice(1);
}

function serializeValue(value) {
  return unquotedValue.test(value) ? value : `"${value}"`;
}

function serializeAttributes(kind, attributes) {
  const order = Object.keys(rules[kind]);
  const keys = Object.keys(attributes).sort((a, b) => rank(order, a) - rank(order, b));
  const parts = keys.map((key) => (key === 'id' ? `#${attributes.id}` : `${key}=${serializeValue(attributes[key])}`));
  return `{${parts.join(' ')}}`;
}

function rank(order, key) {
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

function apply(file, place, kind, content, onRead) {
  const { attributes, errors } = readAttributes(content);
  errors.push(...checkAttributes(kind, attributes));
  for (const error of errors) file.message(error, place);
  onRead(attributes);
}

function transformAttributes(tree, file) {
  const source = String(file.value);
  const points = location(file);
  visit(tree, 'heading', (heading) => {
    const last = heading.children.at(-1);
    if (last?.type !== 'text' || !last.position) return;
    const match = headingAttributes.exec(last.value);
    if (!match || !source.slice(last.position.start.offset, last.position.end.offset).endsWith(match[0])) return;
    const place = points.toPoint(last.position.end.offset - match[0].length + 1);
    apply(file, place, 'heading', match[1], (attributes) => {
      last.value = last.value.slice(0, -match[0].length);
      if (last.value === '') heading.children.pop();
      heading.data = { ...heading.data, attributes };
    });
  });
  visit(tree, 'image', (image, index, parent) => {
    const next = parent?.children[index + 1];
    if (next?.type !== 'text' || !next.position) return;
    const match = imageAttributes.exec(next.value);
    if (!match || !source.slice(next.position.start.offset).startsWith(match[0])) return;
    apply(file, points.toPoint(next.position.start.offset), 'image', match[1], (attributes) => {
      next.value = next.value.slice(match[0].length);
      if (next.value === '') parent.children.splice(index + 1, 1);
      image.data = { ...image.data, attributes };
    });
  });
}

function handleHeading(node, parent, state, info) {
  const value = defaultHandlers.heading(node, parent, state, info);
  const attributes = node.data?.attributes;
  return attributes ? `${value} ${serializeAttributes('heading', attributes)}` : value;
}

function handleImage(node, parent, state, info) {
  const value = defaultHandlers.image(node, parent, state, info);
  const attributes = node.data?.attributes;
  return attributes ? value + serializeAttributes('image', attributes) : value;
}

handleImage.peek = defaultHandlers.image.peek;

export default function remarkAttributes() {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push({ handlers: { heading: handleHeading, image: handleImage } });
  return transformAttributes;
}
