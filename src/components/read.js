import { join, posix } from 'node:path';
import { FUNCTIONS, moduleBindings, objectFields, parseModule, positionAt, readLiteral } from '../literals.js';
import { errorAt, fileStart, listAll } from '../report.js';
import { HEIGHT_FUNCTION, REMOVED_LAYOUT_FIELDS, layoutProblems, paramProblems } from './declarations.js';

export const COMPONENTS_DIR = 'components';

const COMPONENT_EXTENSIONS = ['.js', '.jsx'];
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const RESERVED_NAMES = ['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'];
const DECLARATIONS = ['params', 'layout'];
const CLASSES = ['ClassDeclaration', 'ClassExpression'];

// A component in components/ serves every article; one in the components/ folder of an article serves only that article.
export function readComponents(files, { builtInBlocks, articleDirs }, errors) {
  const components = new Map();
  const folders = [null, ...articleDirs].map((article) => ({ article, dir: article === null ? COMPONENTS_DIR : posix.join(article, COMPONENTS_DIR) }));
  for (const { name, file, article, duplicate } of componentFiles(files, folders, builtInBlocks, errors)) {
    const path = join(files.root, file);
    const source = files.read(path, 'utf8');
    const count = errors.length;
    const report = (node, message) => errors.push(errorAt(file, node === null ? fileStart : positionAt(source, node.start), `${name}: ${message}`));
    const { params, layout, solid } = readDeclarations(file, source, report);
    components.set(name, { name, file, path, article, params, layout, solid, valid: !duplicate && errors.length === count });
  }
  return components;
}

function componentFiles(files, folders, builtInBlocks, errors) {
  const found = new Map();
  for (const { article, dir } of folders) {
    for (const entry of files.list(join(files.root, dir))) {
      const extension = COMPONENT_EXTENSIONS.find((candidate) => entry.endsWith(candidate));
      if (extension === undefined || !files.stat(join(files.root, dir, entry))?.isFile()) continue;
      const file = posix.join(dir, entry);
      const name = entry.slice(0, -extension.length);
      if (!COMPONENT_NAME.test(name)) {
        errors.push(errorAt(file, fileStart, `the file name of a component is its custom element name and its block name; use lowercase letters and digits with at least one "-", such as act-fn-plot, got "${name}"`));
      } else if (RESERVED_NAMES.includes(name)) {
        errors.push(errorAt(file, fileStart, `${name}: the HTML standard reserves "${name}" and does not allow it as a custom element name; give the component another name`));
      } else if (builtInBlocks.includes(name)) {
        errors.push(errorAt(file, fileStart, `${name}: :::${name} is a built-in block; give the component another name`));
      } else {
        found.set(name, [...(found.get(name) ?? []), { name, file, article }]);
      }
    }
  }
  const unique = [];
  for (const [name, defined] of found) {
    if (defined.length === 1) {
      unique.push(defined[0]);
      continue;
    }
    // why: the name is the custom element name of the whole blog, so two files cannot share it even in different articles
    const message = `${name}: ${listAll(defined.map(({ file }) => file))} ${defined.length === 2 ? 'both' : 'all'} define the component; a component name is unique in the blog, so rename or remove all but one of them`;
    for (const { file } of defined) errors.push(errorAt(file, fileStart, message));
    // why: the first file stays as an invalid component, so that an article that uses the name reports nothing more
    unique.push({ ...defined[0], duplicate: true });
  }
  return unique;
}

function readDeclarations(file, source, report) {
  const program = parseModule(file, source, report);
  if (program === null) return { params: {}, layout: {}, solid: false };
  const { constants, classes, exported } = moduleBindings(program, DECLARATIONS, report);
  const main = exported.get('default');
  if (main === undefined) report(null, 'the default export must be a SolidJS component or a class that extends HTMLElement');
  const customElement = CLASSES.includes(main?.type) || (main?.type === 'Identifier' && classes.has(main.name));
  const fields = (name) => objectFields(exported.get(name), name, constants, report);
  const read = (name, node) => readLiteral(node, name, constants, report);
  const params = {};
  for (const { name, key, node } of fields('params')) {
    const value = read('params', node);
    if (value === undefined) continue;
    params[name] = value;
    for (const problem of paramProblems(name, value)) report(key, problem);
  }
  const layout = {};
  const keys = new Map();
  for (const { name, key, node } of fields('layout')) {
    if (Object.hasOwn(REMOVED_LAYOUT_FIELDS, name)) {
      report(key, REMOVED_LAYOUT_FIELDS[name]);
      continue;
    }
    if (name === 'height' && FUNCTIONS.includes(node.type)) {
      report(node, HEIGHT_FUNCTION);
      continue;
    }
    const value = read('layout', node);
    if (value === undefined) continue;
    layout[name] = value;
    keys.set(name, key);
  }
  for (const { field, message } of layoutProblems(layout)) report(keys.get(field) ?? exported.get('layout') ?? null, message);
  return { params, layout, solid: main !== undefined && !customElement };
}
