import { VFile } from 'vfile';
import { location } from 'vfile-location';
import { isMap, parseDocument, stringify } from 'yaml';
import { createProcessor } from './processor.js';

const slugPattern = /^(?:\/|[a-z0-9-]+(?:\/[a-z0-9-]+)*)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isSlug(value) {
  return typeof value === 'string' && slugPattern.test(value);
}

export const commonFields = {
  title: { label: '标题', type: 'string' },
  slug: { label: '地址', type: 'slug' },
  date: { label: '日期', type: 'date' },
  layout: { label: '版式', type: 'string', default: 'essay' },
  theme: { label: '主题', type: 'string' },
  width: { label: '正文宽度', type: 'enum', options: ['normal', 'wide'], default: 'normal' },
  draft: { label: '草稿', type: 'boolean', default: false },
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

export function fieldError(name, value, field) {
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
  if (source.slice(0, start).trim() !== '---') return;
  while (start > 0 && start < source.length) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    if (source.slice(start, end).trim() === '---') yield end;
    start = end;
  }
}

export function frontmatterLength(source) {
  for (const end of fenceLineEnds(source)) {
    if (findYamlNode(frontmatterParser.parse(source.slice(0, end)))) return end;
  }
  return 0;
}

export function readFrontmatter(source) {
  const file = new VFile(source.slice(0, frontmatterLength(source)));
  const yaml = readYaml(frontmatterParser.parse(file), file);
  if (!yaml || yaml.document.errors.length > 0 || !isMap(yaml.document.contents)) return { values: {}, keyPlaces: new Map() };
  return { values: yaml.document.toJS(), keyPlaces: keyPlacesOf(file, yaml) };
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
      const error = fieldError(name, value, field);
      if (error) file.message(error, placeOf(name));
      continue;
    }
    if (!layouts) continue;
    const owner = Object.keys(layouts).find((other) => other !== layout && Object.hasOwn(layouts[other], name));
    if (owner) file.message(`Frontmatter field ${name} belongs to layout ${owner}, current layout is ${layout}`, placeOf(name));
  }
  return withDefaults(values, fields);
}

function fieldLines(raw, name) {
  const contents = parseDocument(raw).contents;
  const pair = isMap(contents) ? contents.items.find((item) => String(item.key?.value) === name) : undefined;
  if (!pair) return null;
  const keyStart = pair.key.range[0];
  const valueEnd = pair.value?.range?.[1] ?? pair.key.range[1];
  const start = raw.lastIndexOf('\n', keyStart - 1) + 1;
  const newline = raw.indexOf('\n', Math.max(valueEnd - 1, keyStart));
  return { start, end: newline === -1 ? raw.length : newline + 1 };
}

function fieldText(name, value) {
  return stringify({ [name]: value }, { lineWidth: 0 });
}

export function setFrontmatterField(raw, name, value) {
  const lines = fieldLines(raw, name);
  const text = fieldText(name, value);
  if (!lines) {
    if (raw === '') return text.slice(0, -1);
    return raw.endsWith('\n') ? raw + text : `${raw}\n${text.slice(0, -1)}`;
  }
  const replacement = raw.slice(lines.start, lines.end).endsWith('\n') ? text : text.slice(0, -1);
  return raw.slice(0, lines.start) + replacement + raw.slice(lines.end);
}

export function deleteFrontmatterField(raw, name) {
  const lines = fieldLines(raw, name);
  if (!lines) return raw;
  const start = lines.end === raw.length && !raw.endsWith('\n') && lines.start > 0 ? lines.start - 1 : lines.start;
  return raw.slice(0, start) + raw.slice(lines.end);
}
