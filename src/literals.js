import { parseSync } from 'vite';
import { describeValue } from './report.js';

const LITERALS = 'strings, numbers, true, false, null, lists, objects, template strings without ${…} and names of constants of this file with such a value';
export const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionExpression'];

class NotLiteral extends Error {
  constructor(node) {
    super('not a literal');
    this.node = node;
  }
}

// The build reads declarations from the syntax tree of a module, without running it.
export function parseModule(file, source, report) {
  const { program, errors } = parseSync(file, source);
  for (const error of errors) report({ start: error.labels[0]?.start ?? 0 }, error.message);
  return errors.length > 0 ? null : program;
}

// names lists the named exports that must be constants, so that their value can be read.
export function moduleBindings(program, names, report) {
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
      if (!names.includes(id.name)) continue;
      if (declaration.kind === 'const' && init !== null) exported.set(id.name, init);
      else report(id, `declare ${id.name} as export const ${id.name} = { … }, which the build reads without running the file`);
    }
    for (const specifier of statement.specifiers) {
      const name = specifier.exported.name ?? specifier.exported.value;
      if (name === 'default') exported.set('default', specifier.local);
      else if (names.includes(name)) report(specifier, `declare ${name} as export const ${name} = { … }, which the build reads without running the file`);
    }
  }
  return { constants, classes, exported };
}

export function objectFields(node, name, constants, report) {
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
    fields.push({ name: propertyName(property.key), key: property.key, node: property.value });
  }
  return fields;
}

export function readLiteral(node, name, constants, report) {
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

export function positionAt(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}
