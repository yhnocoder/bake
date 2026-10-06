import { VFile } from 'vfile';
import { location } from 'vfile-location';
import { isMap, parseDocument } from 'yaml';
import { createProcessor } from './processor.js';

const slugPattern = /^(?:\/|[a-z0-9-]+(?:\/[a-z0-9-]+)*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isSlug(value) {
  return typeof value === 'string' && slugPattern.test(value);
}

const commonFields = {
  title: { type: 'string' },
  slug: { type: 'slug' },
  date: { type: 'date' },
  layout: { type: 'string', default: 'essay' },
  theme: { type: 'string' },
  width: { type: 'enum', options: ['normal', 'wide'], default: 'normal' },
  draft: { type: 'boolean', default: false },
};

function findYamlNode(tree) {
  return tree.children.find((child) => child.type === 'yaml');
}

export function readYaml(tree, file) {
  const node = findYamlNode(tree);
  if (!node) return null;
  const source = String(file.value);
  const contentOffset = source.indexOf('\n', node.position.start.offset) + 1;
  const document = parseDocument(node.value, { prettyErrors: true });
  for (const error of document.errors) {
    const [start] = error.linePos ?? [{ line: 1, col: 1 }];
    const reason = error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
    file.message(`Invalid YAML in frontmatter: ${reason}`, {
      line: node.position.start.line + start.line,
      column: start.col,
    });
  }
  return { node, document, contentOffset };
}

function typeError(name, value, field) {
  switch (field.type) {
    case 'string':
      return typeof value === 'string' ? null : `Frontmatter field ${name} must be a string`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `Frontmatter field ${name} must be true or false`;
    case 'number':
      if (typeof value !== 'number') return `Frontmatter field ${name} must be a number`;
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        return `Frontmatter field ${name} must be between ${field.min ?? '-∞'} and ${field.max ?? '∞'}, got ${value}`;
      }
      return null;
    case 'enum':
      return field.options.includes(value)
        ? null
        : `Frontmatter field ${name} must be one of ${field.options.join(', ')}, got ${value}`;
    case 'list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? null
        : `Frontmatter field ${name} must be a list of strings`;
    case 'slug':
      return isSlug(value)
        ? null
        : `Frontmatter field slug must be / or segments of lowercase letters, digits and - separated by /, got ${value}`;
    case 'date':
      return typeof value === 'string' && datePattern.test(value) ? null : `Frontmatter field date must be YYYY-MM-DD, got ${value}`;
    default:
      return null;
  }
}

function withDefaults(values, fields) {
  const result = { ...values };
  for (const [name, field] of Object.entries(fields)) {
    if (result[name] === undefined && field.default !== undefined) result[name] = field.default;
  }
  return result;
}

function keyPlacesOf(file, yaml) {
  const points = location(file);
  const places = new Map();
  for (const pair of yaml?.document.contents?.items ?? []) {
    places.set(String(pair.key?.value), points.toPoint(yaml.contentOffset + (pair.key?.range?.[0] ?? 0)));
  }
  return places;
}

const frontmatterParser = createProcessor();

function* fenceLineEnds(source) {
  let start = source.indexOf('\n') + 1;
  while (start > 0 && start < source.length) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    if (source.slice(start, end).trim() === '---') yield end;
    start = end;
  }
}

export function readFrontmatter(source) {
  for (const end of fenceLineEnds(source)) {
    const file = new VFile(source.slice(0, end));
    const yaml = readYaml(frontmatterParser.parse(file), file);
    if (!yaml) continue;
    if (yaml.document.errors.length > 0 || !isMap(yaml.document.contents)) break;
    return { values: yaml.document.toJS(), keyPlaces: keyPlacesOf(file, yaml) };
  }
  return { values: {}, keyPlaces: new Map() };
}

export function checkFrontmatter(file, yaml, { layouts, themes }) {
  const start = yaml ? yaml.node.position.start : { line: 1, column: 1 };
  if (yaml && yaml.document.errors.length > 0) return withDefaults({}, commonFields);
  if (yaml && yaml.document.contents !== null && !isMap(yaml.document.contents)) {
    file.message('Frontmatter must be a mapping', start);
    return withDefaults({}, commonFields);
  }
  const values = yaml?.document.toJS() ?? {};
  const keyPlaces = keyPlacesOf(file, yaml);
  const placeOf = (name) => keyPlaces.get(name) ?? start;
  if (values.title === undefined) file.message('Frontmatter is missing title', start);
  if (values.slug === undefined) file.message('Frontmatter is missing slug', start);
  const layout = values.layout ?? commonFields.layout.default;
  let layoutFields = {};
  if (layouts) {
    if (typeof layout === 'string' && !Object.hasOwn(layouts, layout)) {
      file.message(`Unknown layout ${layout}`, placeOf('layout'));
    }
    layoutFields = layouts[layout] ?? {};
    for (const name of Object.keys(layoutFields)) {
      if (Object.hasOwn(commonFields, name)) file.message(`Layout ${layout} field ${name} conflicts with a common field`, start);
    }
  }
  if (themes && typeof values.theme === 'string' && !themes.includes(values.theme)) {
    file.message(`Unknown theme ${values.theme}`, placeOf('theme'));
  }
  const fields = { ...layoutFields, ...commonFields };
  for (const [name, value] of Object.entries(values)) {
    const field = fields[name];
    if (field) {
      const error = typeError(name, value, field);
      if (error) file.message(error, placeOf(name));
      continue;
    }
    if (!layouts) continue;
    const owner = Object.keys(layouts).find((other) => other !== layout && Object.hasOwn(layouts[other], name));
    if (owner) file.message(`Frontmatter field ${name} belongs to layout ${owner}, current layout is ${layout}`, placeOf(name));
  }
  return withDefaults(values, fields);
}
