import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import postcss from 'postcss';
import builtinBlocks from '../blocks/index.js';
import { commonFieldNames } from '../format/frontmatter.js';
import renderBento, { fields as bentoFields } from '../layouts/bento.js';
import renderEssay, { fields as essayFields } from '../layouts/essay.js';
import renderPaper, { fields as paperFields } from '../layouts/paper.js';
import { themeVariables } from '../styles/variables.js';
import { checkFields } from './fields.js';

const builtinLayouts = {
  essay: { render: renderEssay, fields: essayFields, path: null },
  paper: { render: renderPaper, fields: paperFields, path: null },
  bento: { render: renderBento, fields: bentoFields, path: null },
};
const componentName = /^[a-z][a-z0-9-]*$/;
const reservedComponentNames = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);
const blockName = /^[a-z][a-z0-9]*$/;
const blockForms = ['text', 'leaf', 'container'];
const builtinBlockNames = new Set(builtinBlocks.map((block) => block.name));
const extensionPaths = /^(components|blocks|layouts|themes|content\/[^/]+\/components)\/[^/]+$/;

export function isExtensionPath(path) {
  return extensionPaths.test(path);
}

async function entriesOf(root, directory) {
  try {
    return await readdir(join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listFiles(root, directory, extension) {
  const entries = await entriesOf(root, directory);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

export function loadError(path, error) {
  const { line = 1, column = 0 } = error.loc ?? {};
  return { path, line, column: column + 1, text: `Cannot load ${path}: ${error.message.split('\n')[0]}` };
}

function fileError(path, text) {
  return { path, line: 1, column: 1, text };
}

async function importModule(loader, path, messages) {
  globalThis.HTMLElement ??= class {};
  try {
    return await loader.import(path);
  } catch (error) {
    messages.push(loadError(path, error));
    return null;
  }
}

function isComponentName(name) {
  return componentName.test(name) && name.includes('-');
}

async function componentSources(root) {
  const sources = (await listFiles(root, 'components', '.js')).map((path) => ({ path, topic: null }));
  const topics = (await entriesOf(root, 'content')).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const topic of topics.sort()) {
    for (const path of await listFiles(root, `content/${topic}/components`, '.js')) sources.push({ path, topic });
  }
  return sources;
}

async function loadComponent(loader, { path, topic }, messages) {
  const name = basename(path, '.js');
  if (!isComponentName(name)) {
    messages.push(fileError(path, 'Component file name must be lowercase letters, digits and "-", and contain at least one "-"'));
    return null;
  }
  if (reservedComponentNames.has(name)) {
    messages.push(fileError(path, `Component name ${name} is reserved by HTML`));
    return null;
  }
  const module = await importModule(loader, path, messages);
  if (!module) return null;
  const component = module.default;
  if (typeof component !== 'function' || !(component.prototype instanceof globalThis.HTMLElement)) {
    messages.push(fileError(path, `Component ${name} must default-export a class that extends HTMLElement`));
    return null;
  }
  const properties = component.properties ?? {};
  const errors = checkFields(properties);
  if (errors.length > 0) {
    messages.push(...errors.map((text) => fileError(path, text)));
    return null;
  }
  return { name, path, topic, properties };
}

async function loadComponents(root, loader, messages) {
  const loaded = [];
  for (const source of await componentSources(root)) {
    const component = await loadComponent(loader, source, messages);
    if (component) loaded.push(component);
  }
  const components = {};
  for (const { name, path, topic, properties } of loaded) {
    const others = loaded.filter((other) => other.name === name && other.path !== path);
    if (others.length > 0) messages.push(...others.map((other) => fileError(path, `Component ${name} is also defined in ${other.path}`)));
    else components[name] = { path, topic, properties };
  }
  return components;
}

function blockErrors(block, name) {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return [`Block type ${name} must default-export an object`];
  if (block.name !== name) return [`Block type name ${block.name} must be the same as the file name ${name}`];
  const errors = [];
  if (!blockForms.includes(block.form)) errors.push(`Block type ${name} form must be one of ${blockForms.join(', ')}`);
  if (block.label !== undefined && typeof block.label !== 'string') errors.push(`Block type ${name} label must be a string`);
  if (block.render !== undefined && typeof block.render !== 'function') errors.push(`Block type ${name} render must be a function`);
  if (block.attributes !== undefined) errors.push(...checkFields(block.attributes));
  return errors;
}

async function loadBlocks(root, loader, messages) {
  const blocks = [];
  for (const path of await listFiles(root, 'blocks', '.js')) {
    const name = basename(path, '.js');
    if (name.includes('-')) {
      messages.push(fileError(path, 'Block type name must not contain "-", names with "-" are components'));
      continue;
    }
    if (!blockName.test(name)) {
      messages.push(fileError(path, 'Block type name must be lowercase letters and digits and start with a letter'));
      continue;
    }
    if (builtinBlockNames.has(name)) {
      messages.push(fileError(path, `Block type ${name} conflicts with a built-in block type`));
      continue;
    }
    const module = await importModule(loader, path, messages);
    if (!module) continue;
    const errors = blockErrors(module.default, name);
    if (errors.length > 0) messages.push(...errors.map((text) => fileError(path, text)));
    else blocks.push(module.default);
  }
  return blocks;
}

function layoutErrors(module, name) {
  if (typeof module.default !== 'function') return [`Layout ${name} must default-export a function`];
  if (module.fields === undefined) return [];
  const errors = checkFields(module.fields, { allowList: true });
  if (errors.length > 0) return errors;
  return Object.keys(module.fields)
    .filter((field) => commonFieldNames.includes(field))
    .map((field) => `Layout ${name} field ${field} conflicts with a common field`);
}

async function loadLayouts(root, loader, messages) {
  const layouts = { ...builtinLayouts };
  for (const path of await listFiles(root, 'layouts', '.js')) {
    const name = basename(path, '.js');
    const module = await importModule(loader, path, messages);
    if (!module) continue;
    const errors = layoutErrors(module, name);
    if (errors.length > 0) messages.push(...errors.map((text) => fileError(path, text)));
    else layouts[name] = { render: module.default, fields: module.fields ?? {}, path };
  }
  return layouts;
}

function declaredVariables(css) {
  const declared = new Set();
  postcss.parse(css).walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) declared.add(declaration.prop);
  });
  return declared;
}

export async function loadThemes(root) {
  const themes = {};
  const messages = [];
  for (const path of await listFiles(root, 'themes', '.css')) {
    const name = basename(path, '.css');
    let declared;
    try {
      declared = declaredVariables(await readFile(join(root, path), 'utf8'));
    } catch (error) {
      messages.push({ path, line: error.line ?? 1, column: error.column ?? 1, text: `Cannot load ${path}: ${error.reason ?? error.message}` });
      continue;
    }
    const missing = themeVariables.filter((variable) => !declared.has(variable));
    if (missing.length > 0) messages.push(fileError(path, `Theme ${name} is missing variables ${missing.join(', ')}`));
    else themes[name] = path;
  }
  return { themes, messages };
}

export async function loadExtensions(root, loader) {
  const messages = [];
  const components = await loadComponents(root, loader, messages);
  const blocks = await loadBlocks(root, loader, messages);
  const layouts = await loadLayouts(root, loader, messages);
  const { themes, messages: themeMessages } = await loadThemes(root);
  messages.push(...themeMessages);
  return { components, blocks, layouts, themes, messages };
}
