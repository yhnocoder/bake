import { posix } from 'node:path';
import { WIDTHS, parseSize } from '../config/rules.js';
import { describeValue, listChoices } from '../report.js';

export const PARAM_TYPES = Object.freeze(['number', 'text', 'boolean', 'enum', 'file']);
export const SIZE_ATTRIBUTES = Object.freeze(['width', 'height']);
export const RESERVED_PARAMS = Object.freeze([...SIZE_ATTRIBUTES, 'id', 'class']);

const PARAM_NAME = /^[A-Za-z_][\w-]*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const PIXELS = /^\d+(?:\.\d+)?$/;
const COMMON_FIELDS = ['label', 'type', 'default'];
const TYPE_FIELDS = { number: ['min', 'max', 'step'], text: [], boolean: [], enum: ['options'], file: [] };
const LAYOUT_FIELDS = ['width', 'height', 'narrowHeight', 'frame'];
const LAYOUT_WIDTH_CHOICES = 'body, wide, page, a size in pixels such as 560px or a percentage of the body column up to 100% such as 70%';
const HEIGHT_FORMS = 'a number of pixels, { ratio: width / height } or a function of the parameters that returns one of them';

export function checkDeclarations(module) {
  const problems = [];
  const params = isPlainObject(module.params) ? module.params : {};
  if (module.params !== undefined && !isPlainObject(module.params)) problems.push(`params must be an object that maps each parameter name to its declaration, got ${describeValue(module.params)}`);
  for (const [name, declaration] of Object.entries(params)) problems.push(...paramProblems(name, declaration));
  const layout = isPlainObject(module.layout) ? module.layout : null;
  if (layout === null) problems.push(`layout must be an object with at least height, for example export const layout = { height: 360 }, got ${describeValue(module.layout)}`);
  else problems.push(...layoutProblems(layout));
  if (typeof module.default !== 'function') problems.push('the default export must be a SolidJS component or a class that extends HTMLElement');
  return { params, layout: layout ?? {}, problems };
}

function paramProblems(name, declaration) {
  const subject = `parameter "${name}"`;
  if (RESERVED_PARAMS.includes(name)) return [`${subject} uses a name reserved for Bake; a component cannot declare ${listChoices(RESERVED_PARAMS)}`];
  if (!PARAM_NAME.test(name)) return [`${subject} cannot be written as a Markdown attribute; use letters, digits, "_" and "-", starting with a letter or "_"`];
  if (!isPlainObject(declaration)) return [`${subject} must be declared as an object such as { label: 'Range', type: 'number', default: 4 }, got ${describeValue(declaration)}`];
  if (!PARAM_TYPES.includes(declaration.type)) return [`${subject} has the type ${describeValue(declaration.type)}; use ${listChoices(PARAM_TYPES)}`];
  const problems = [];
  const known = [...COMMON_FIELDS, ...TYPE_FIELDS[declaration.type]];
  for (const field of Object.keys(declaration)) {
    if (!known.includes(field)) problems.push(`${subject} has the unknown field "${field}"; the fields of a ${declaration.type} parameter are ${listAll(known)}`);
  }
  if (declaration.label === undefined) problems.push(`${subject} needs a label, the text shown next to its control`);
  else if (typeof declaration.label !== 'string') problems.push(`the label of ${subject} must be text, got ${describeValue(declaration.label)}`);
  if (declaration.type === 'number') {
    for (const field of ['min', 'max', 'step']) {
      const value = declaration[field];
      if (value !== undefined && !Number.isFinite(value)) problems.push(`${subject} has ${field} ${describeValue(value)}; it must be a number`);
    }
    if (declaration.step !== undefined && !(declaration.step > 0)) problems.push(`${subject} has step ${describeValue(declaration.step)}; it must be greater than 0`);
    if (declaration.min > declaration.max) problems.push(`${subject} has min ${declaration.min} above max ${declaration.max}`);
  }
  if (declaration.type === 'enum') {
    const { options } = declaration;
    if (!Array.isArray(options) || options.length === 0 || options.some((option) => typeof option !== 'string')) {
      problems.push(`${subject} is an enum without options; list them as strings, for example options: ['gelu', 'silu']`);
      return problems;
    }
  }
  if (problems.length > 0) return problems;
  if (!Object.hasOwn(declaration, 'default')) return [`${subject} needs a default, the value used when the article does not set it`];
  const problem = valueProblem(declaration, declaration.default);
  return problem === null ? [] : [`the default of ${subject} ${problem}`];
}

function layoutProblems(layout) {
  const problems = [];
  for (const field of Object.keys(layout)) {
    if (!LAYOUT_FIELDS.includes(field)) problems.push(`layout has the unknown field "${field}"; the fields of layout are ${listAll(LAYOUT_FIELDS)}`);
  }
  if (layout.width !== undefined && readWidth(layout.width) === null) problems.push(`layout.width must be ${LAYOUT_WIDTH_CHOICES}, got ${describeValue(layout.width)}`);
  if (layout.height === undefined) problems.push('layout.height is missing; it is the height of the placeholder before the component loads, for example 360 or { ratio: 16 / 9 }');
  for (const field of ['height', 'narrowHeight']) {
    const value = layout[field];
    if (value !== undefined && typeof value !== 'function' && readHeight(value) === null) problems.push(`layout.${field} must be ${HEIGHT_FORMS}, got ${describeValue(value)}`);
  }
  if (layout.frame !== undefined && typeof layout.frame !== 'boolean') problems.push(`layout.frame must be true or false, got ${describeValue(layout.frame)}`);
  return problems;
}

export function resolveComponent(name, component, attributes, files) {
  const problems = [];
  const report = (attribute, message) => problems.push({ attribute, message });
  const params = {};
  for (const [param, declaration] of Object.entries(component.params)) params[param] = declaration.default;
  for (const [attribute, raw] of Object.entries(attributes)) {
    if (SIZE_ATTRIBUTES.includes(attribute)) continue;
    if (attribute === 'id' || attribute === 'class') {
      report(attribute, `components take no id or class; remove the ${attribute} from :::${name}`);
      continue;
    }
    const declaration = component.params[attribute];
    if (declaration === undefined) {
      report(attribute, attribute === 'float' ? `float does not apply to components; ${name} is centred in its column` : `unknown parameter "${attribute}" for ${name}`);
      continue;
    }
    const { value, problem } = convertAttribute(declaration, raw);
    if (problem !== undefined) report(attribute, `parameter "${attribute}" of ${name} ${problem}`);
    else params[attribute] = value;
  }
  for (const [param, declaration] of Object.entries(component.params)) {
    if (declaration.type !== 'file' || params[param] === '' || isFolderFile(params[param], files)) continue;
    if (Object.hasOwn(attributes, param)) report(param, `parameter "${param}" of ${name} must be a file in the article folder, got ${describeValue(params[param])}`);
    else report(undefined, `parameter "${param}" of ${name} defaults to ${describeValue(params[param])}, which is not a file in the article folder`);
  }
  const width = componentWidth(name, component.layout, attributes.width, report);
  const heights = componentHeights(name, component.layout, attributes.height, params, report);
  return { params, ...width, ...heights, frame: component.layout.frame !== false, problems };
}

function componentWidth(name, layout, written, report) {
  if (written !== undefined && written !== 'auto') {
    const width = readWidth(written);
    if (width !== null) return width;
    const size = parseSize(written);
    report('width', size?.unit === '%' ? `width of ${name} is ${written}; a percentage width is at most 100% of the body column` : `width of ${name} must be body, wide, page, auto, a size in pixels such as 560px or a percentage such as 70%, got ${describeValue(written)}`);
  }
  return readWidth(layout.width ?? 'body');
}

function readWidth(value) {
  if (WIDTHS.includes(value)) return { width: value };
  const size = parseSize(value);
  if (size === null || (size.unit === '%' && size.number > 100)) return null;
  return size.unit === 'px' ? { naturalWidth: value, frameWidth: value } : { width: 'body', frameWidth: value };
}

function componentHeights(name, layout, written, params, report) {
  if (written !== undefined) {
    if (typeof written === 'string' && PIXELS.test(written) && Number(written) > 0) {
      const height = readHeight(Number(written));
      return { height, narrowHeight: height };
    }
    report('height', `height of ${name} must be a positive number of pixels such as 420, got ${describeAttribute(written)}`);
  }
  const height = declaredHeight(name, 'height', layout.height, params, report);
  const narrowHeight = layout.narrowHeight === undefined ? height : declaredHeight(name, 'narrowHeight', layout.narrowHeight, params, report);
  return { height, narrowHeight };
}

function declaredHeight(name, field, declared, params, report) {
  const fallback = { height: 'auto', ratio: 'auto' };
  if (typeof declared !== 'function') return readHeight(declared) ?? fallback;
  let value;
  try {
    value = declared(Object.freeze({ ...params }));
  } catch (error) {
    report(undefined, `${name}: layout.${field} throws for these parameters: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
  const height = readHeight(value);
  if (height === null) report(undefined, `${name}: layout.${field} returns ${describeValue(value)} for these parameters; it must return a number of pixels or { ratio: width / height }`);
  return height ?? fallback;
}

function readHeight(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? { height: `${round(value, 2)}px`, ratio: 'auto' } : null;
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Number.isFinite(value.ratio) || !(value.ratio > 0)) return null;
  return { height: 'auto', ratio: String(round(value.ratio, 4)) };
}

function convertAttribute(declaration, raw) {
  let value = raw;
  if (declaration.type === 'number') {
    if (typeof raw !== 'string' || !NUMBER.test(raw)) return { problem: `must be a number, got ${describeAttribute(raw)}` };
    value = Number(raw);
  } else if (declaration.type === 'boolean') {
    if (raw !== true && raw !== 'true' && raw !== 'false') return { problem: `must be true or false, got ${describeAttribute(raw)}` };
    value = raw !== 'false';
  } else if (raw === true) {
    return { problem: `needs a value, got ${describeAttribute(raw)}` };
  }
  const problem = valueProblem(declaration, value);
  return problem === null ? { value } : { problem };
}

function valueProblem(declaration, value) {
  switch (declaration.type) {
    case 'number': {
      if (!Number.isFinite(value)) return `must be a number, got ${describeValue(value)}`;
      const { min, max } = declaration;
      if (min !== undefined && max !== undefined && (value < min || value > max)) return `must be between ${min} and ${max}, got ${value}`;
      if (min !== undefined && value < min) return `must be at least ${min}, got ${value}`;
      if (max !== undefined && value > max) return `must be at most ${max}, got ${value}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `must be true or false, got ${describeValue(value)}`;
    case 'enum':
      return declaration.options.includes(value) ? null : `must be ${declaration.options.length === 1 ? declaration.options[0] : `one of ${listChoices(declaration.options)}`}, got ${describeValue(value)}`;
    default:
      return typeof value === 'string' ? null : `must be text, got ${describeValue(value)}`;
  }
}

function isFolderFile(value, files) {
  if (value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return files.includes(posix.normalize(value));
}

function listAll(items) {
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function describeAttribute(value) {
  return value === true ? 'no value' : describeValue(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
