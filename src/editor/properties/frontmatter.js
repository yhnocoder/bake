import { closeHistory } from '@milkdown/prose/history';
import { isMap, parseDocument } from 'yaml';
import { commonFields, deleteFrontmatterField, fieldError, setFrontmatterField } from '../../format/frontmatter.js';
import { parse } from '../../format/index.js';

const defaultLayout = commonFields.layout.default;

export function readPage(raw) {
  const document = parseDocument(raw ?? '');
  if (document.errors.length > 0 || (document.contents !== null && !isMap(document.contents))) {
    return { errors: parse(`---\n${raw}\n---\n`).messages.map((message) => message.text) };
  }
  return { values: document.toJS() ?? {} };
}

function controlOf(name, field, site) {
  if (name === 'layout') return { ...field, type: 'enum', options: Object.keys(site.layouts) };
  if (name === 'theme') return { ...field, type: 'enum', options: site.themes, default: site.defaultTheme ?? undefined };
  if (field.type === 'slug' || field.type === 'date') return { ...field, type: 'string' };
  return field;
}

function entry(name, field, values, site) {
  const control = controlOf(name, field, site);
  const value = values[name];
  const error = value === undefined ? null : fieldError(name, value, field);
  const shown = value !== undefined && !error && (!control.options || control.options.includes(value));
  return { name, field, control, value: shown ? value : control.default, error };
}

export function pageEntries(values, site) {
  const layoutFields = site.layouts[values.layout ?? defaultLayout] ?? {};
  return {
    common: Object.entries(commonFields).map(([name, field]) => entry(name, field, values, site)),
    layout: Object.entries(layoutFields).map(([name, field]) => entry(name, field, values, site)),
  };
}

function valueOf(field, raw) {
  if (field.type === 'boolean') return raw;
  if (field.type === 'list') return raw.length === 0 ? undefined : raw;
  if (raw.trim() === '') return undefined;
  return field.type === 'number' ? Number(raw) : raw;
}

function isDefaultValue(value, defaultValue) {
  return defaultValue !== undefined && value === defaultValue;
}

function switchLayout(raw, values, next, site) {
  const previousFields = site.layouts[values.layout ?? defaultLayout] ?? {};
  const nextFields = site.layouts[next] ?? {};
  let result = raw;
  for (const name of Object.keys(previousFields)) {
    if (values[name] === undefined) continue;
    const field = nextFields[name];
    if (!field || fieldError(name, values[name], field) || isDefaultValue(values[name], field.default)) result = deleteFrontmatterField(result, name);
  }
  return result;
}

export function writePageField(view, site, { name, field, control }, raw) {
  const current = view.state.doc.attrs.frontmatter ?? '';
  const { values } = readPage(current);
  let value = valueOf(field, raw);
  if (value !== undefined) {
    const error = fieldError(name, value, field);
    if (error) return error;
  }
  if (isDefaultValue(value, control.default)) value = undefined;
  if (JSON.stringify(value) === JSON.stringify(values[name])) return null;
  let next = value === undefined ? deleteFrontmatterField(current, name) : setFrontmatterField(current, name, value);
  if (name === 'layout') next = switchLayout(next, values, value ?? defaultLayout, site);
  const tr = view.state.tr.setDocAttribute('frontmatter', next);
  view.dispatch(closeHistory(tr));
  return null;
}

export function writeTitle(view, title) {
  const current = view.state.doc.attrs.frontmatter ?? '';
  view.dispatch(closeHistory(view.state.tr.setDocAttribute('frontmatter', setFrontmatterField(current, 'title', title))));
}
