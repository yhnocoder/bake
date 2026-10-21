import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseSync } from 'vite';
import { describeValue, errorAt, fileStart } from '../report.js';
import { layoutProblems, paramProblems } from './declarations.js';

export const COMPONENTS_DIR = 'components';

const COMPONENT_EXTENSIONS = ['.js', '.jsx'];
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const RESERVED_NAMES = ['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'];
const DECLARATIONS = ['params', 'layout'];
const LITERALS = 'strings, numbers, true, false, null, lists, objects, template strings without ${…} and names of constants of this file with such a value';
const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionExpression'];
const CLASSES = ['ClassDeclaration', 'ClassExpression'];

class NotLiteral extends Error {
  constructor(node) {
    super('not a literal');
    this.node = node;
  }
}

export function readComponents(root, { builtInBlocks }, errors) {
  const components = new Map();
  for (const [name, file] of componentFiles(root, builtInBlocks, errors)) {
    const path = join(root, file);
    const source = readFileSync(path, 'utf8');
    const count = errors.length;
    const report = (node, message) => errors.push(errorAt(file, node === null ? fileStart : positionAt(source, node.start), `${name}: ${message}`));
    const { params, layout, solid } = readDeclarations(file, source, report);
    components.set(name, { name, file, path, params, layout, solid, valid: errors.length === count });
  }
  return components;
}

function componentFiles(root, builtInBlocks, errors) {
  const dir = join(root, COMPONENTS_DIR);
  const entries = statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).sort() : [];
  const files = new Map();
  for (const entry of entries) {
    const extension = COMPONENT_EXTENSIONS.find((candidate) => entry.endsWith(candidate));
    if (extension === undefined || !statSync(join(dir, entry)).isFile()) continue;
    const file = posix.join(COMPONENTS_DIR, entry);
    const name = entry.slice(0, -extension.length);
    if (!COMPONENT_NAME.test(name)) {
      errors.push(errorAt(file, fileStart, `the file name of a component is its custom element name and its block name; use lowercase letters and digits with at least one "-", such as act-fn-plot, got "${name}"`));
    } else if (RESERVED_NAMES.includes(name)) {
      errors.push(errorAt(file, fileStart, `${name}: the HTML standard reserves "${name}" and does not allow it as a custom element name; give the component another name`));
    } else if (builtInBlocks.includes(name)) {
      errors.push(errorAt(file, fileStart, `${name}: :::${name} is a built-in block; give the component another name`));
    } else if (files.has(name)) {
      errors.push(errorAt(file, fileStart, `${name}: ${files.get(name)} and ${file} both define the component; keep one of them`));
    } else {
      files.set(name, file);
    }
  }
  return files;
}

function readDeclarations(file, source, report) {
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0) {
    for (const error of errors) report({ start: error.labels[0]?.start ?? 0 }, error.message);
    return { params: {}, layout: {}, solid: false };
  }
  const constants = new Map();
  const classes = new Set();
  const exported = new Map();
  for (const statement of program.body) {
    const declaration = ['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(statement.type) ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration' && declaration.kind === 'const') {
      for (const { id, init } of declaration.declarations) if (id.type === 'Identifier' && init !== null) constants.set(id.name, init);
    }
    if (declaration?.type === 'ClassDeclaration' && declaration.id !== null) classes.add(declaration.id.name);
    if (statement.type === 'ExportDefaultDeclaration') exported.set('default', statement.declaration);
    if (statement.type !== 'ExportNamedDeclaration') continue;
    for (const { id, init } of declaration?.type === 'VariableDeclaration' ? declaration.declarations : []) {
      if (!DECLARATIONS.includes(id.name)) continue;
      if (declaration.kind === 'const' && init !== null) exported.set(id.name, init);
      else report(id, `declare ${id.name} as export const ${id.name} = { … }, which the build reads without running the file`);
    }
    for (const specifier of statement.specifiers) {
      const name = specifier.exported.name ?? specifier.exported.value;
      if (name === 'default') exported.set('default', specifier.local);
      else if (DECLARATIONS.includes(name)) report(specifier, `declare ${name} as export const ${name} = { … }, which the build reads without running the file`);
    }
  }
  const main = exported.get('default');
  if (main === undefined) report(null, 'the default export must be a SolidJS component or a class that extends HTMLElement');
  const customElement = CLASSES.includes(main?.type) || (main?.type === 'Identifier' && classes.has(main.name));
  const fields = (name) => objectFields(exported.get(name), name, constants, report);
  const params = {};
  for (const { name, key, value } of fields('params')) {
    params[name] = value;
    for (const problem of paramProblems(name, value)) report(key, problem);
  }
  const layout = {};
  const keys = new Map();
  for (const { name, key, value } of fields('layout')) {
    layout[name] = value;
    keys.set(name, key);
  }
  for (const { field, message } of layoutProblems(layout)) report(keys.get(field) ?? exported.get('layout') ?? null, message);
  return { params, layout, solid: main !== undefined && !customElement };
}

function objectFields(node, name, constants, report) {
  if (node === undefined) return [];
  const object = resolved(node, constants);
  if (object.type !== 'ObjectExpression') {
    const value = readLiteral(node, name, constants, report);
    if (value !== undefined) report(node, `${name} must be an object that maps each name to its declaration, got ${describeValue(value)}`);
    return [];
  }
  const fields = [];
  for (const property of object.properties) {
    if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method) {
      report(property, notLiteral(name, property));
      continue;
    }
    const value = readLiteral(property.value, name, constants, report);
    if (value !== undefined) fields.push({ name: propertyName(property.key), key: property.key, value });
  }
  return fields;
}

function readLiteral(node, name, constants, report) {
  try {
    return literal(node, constants, new Set());
  } catch (error) {
    if (!(error instanceof NotLiteral)) throw error;
    report(error.node, notLiteral(name, error.node));
    return undefined;
  }
}

function literal(node, constants, seen) {
  switch (node.type) {
    case 'Literal':
      if (node.regex !== undefined || typeof node.value === 'bigint') throw new NotLiteral(node);
      return node.value;
    case 'TemplateLiteral':
      if (node.expressions.length > 0) throw new NotLiteral(node);
      return node.quasis[0].value.cooked;
    case 'UnaryExpression':
      if (!['-', '+'].includes(node.operator) || node.argument.type !== 'Literal' || typeof node.argument.value !== 'number') throw new NotLiteral(node);
      return node.operator === '-' ? -node.argument.value : node.argument.value;
    case 'ParenthesizedExpression':
      return literal(node.expression, constants, seen);
    case 'ArrayExpression':
      return node.elements.map((element) => {
        if (element === null || element.type === 'SpreadElement') throw new NotLiteral(element ?? node);
        return literal(element, constants, seen);
      });
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.map((property) => {
          if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method) throw new NotLiteral(property);
          return [propertyName(property.key), literal(property.value, constants, seen)];
        }),
      );
    case 'Identifier':
      if (!constants.has(node.name) || seen.has(node.name)) throw new NotLiteral(node);
      return literal(constants.get(node.name), constants, new Set([...seen, node.name]));
    default:
      throw new NotLiteral(node);
  }
}

function resolved(node, constants, seen = new Set()) {
  if (node.type !== 'Identifier' || !constants.has(node.name) || seen.has(node.name)) return node;
  return resolved(constants.get(node.name), constants, new Set([...seen, node.name]));
}

function notLiteral(name, node) {
  return `the build reads ${name} without running the file, so write it with ${LITERALS}; got ${describeNode(node)}`;
}

function describeNode(node) {
  if (FUNCTIONS.includes(node.type) || node.method || ['get', 'set'].includes(node.kind)) return 'a function';
  if (['CallExpression', 'NewExpression'].includes(node.type)) return 'a call';
  if (node.type === 'Identifier') return `"${node.name}", which is not a constant of this file with such a value`;
  if (node.type === 'TemplateLiteral') return 'a template string with ${…}';
  if (node.type === 'SpreadElement') return 'a spread';
  if (node.computed) return 'a computed key';
  return 'an expression';
}

function propertyName(key) {
  return key.type === 'Identifier' ? key.name : String(key.value);
}

function positionAt(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}
