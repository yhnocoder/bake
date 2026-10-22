import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { DEFAULT_PET, petSourceProblem } from './pet.js';
import { describeValue, errorAt, fileStart } from '../report.js';
import { HOME_COLUMNS } from '../choices.js';
import { labelsFor } from '../theme/labels.js';
import { characterProblem, choiceProblem, slugProblem } from './rules.js';

export const CONFIG_FILE = 'bake.config.js';

const FIELDS = ['title', 'description', 'url', 'language', 'theme', 'themes', 'home', 'categories', 'chat'];
const CHAT_FIELDS = ['pet'];
const HOME_FIELDS = ['columns', 'groupBy'];
const CATEGORY_FIELDS = ['id', 'name', 'color', 'desc'];
const GROUP_BY = ['category', 'month'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_CATEGORY = { id: 'default', color: '#7d7f84', desc: '' };

export function configNotFoundError() {
  return errorAt(CONFIG_FILE, fileStart, `${CONFIG_FILE} not found, run bake from the blog root or create a blog with bake init`);
}

export function hasConfig(root) {
  return statSync(join(root, CONFIG_FILE), { throwIfNoEntry: false })?.isFile() ?? false;
}

export async function loadBakeConfig(files, themes, optionProblem, errors) {
  const { root } = files;
  const path = join(root, CONFIG_FILE);
  const source = files.read(path, 'utf8');
  if (source === null) {
    errors.push(configNotFoundError());
    return null;
  }
  let program;
  try {
    program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    errors.push(errorAt(CONFIG_FILE, { line: error.loc.line, column: error.loc.column + 1 }, error.message.replace(/ \(\d+:\d+\)$/, '')));
    return null;
  }
  const packageFile = nearestPackageFile(files, root);
  const type = packageFile === null ? 'module' : packageType(files, packageFile);
  if (type !== 'module') {
    const reason = type === undefined ? 'has no "type" field, so Node prints a warning while it detects that the file is an ES module' : `sets "type": ${JSON.stringify(type)}, so Node reads it as CommonJS`;
    errors.push(errorAt(CONFIG_FILE, fileStart, `${CONFIG_FILE} is an ES module, but ${relative(root, packageFile)} ${reason}; set "type": "module" there`));
    return null;
  }
  let exported;
  try {
    exported = (await import(`${pathToFileURL(path).href}?version=${createHash('sha256').update(source).digest('hex')}`)).default;
  } catch (error) {
    errors.push(errorAt(CONFIG_FILE, fileStart, firstLine(error instanceof Error ? error.message : String(error))));
    return null;
  }
  const locate = sourceLocator(program);
  const count = errors.length;
  const config = validateConfig(exported, themes, optionProblem, (path, part, message) => errors.push(errorAt(CONFIG_FILE, locate(path, part), message)));
  return errors.length === count ? deepFreeze(config) : null;
}

function nearestPackageFile(files, folder) {
  const file = join(folder, 'package.json');
  if (files.stat(file)?.isFile()) return file;
  const parent = dirname(folder);
  return parent === folder ? null : nearestPackageFile(files, parent);
}

function packageType(files, file) {
  try {
    return JSON.parse(files.read(file, 'utf8')).type;
  } catch {
    return undefined;
  }
}

export function configPosition(root, path) {
  const program = parse(readFileSync(join(root, CONFIG_FILE), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  return sourceLocator(program)(path, 'value');
}

function validateConfig(value, themes, optionProblem, report) {
  if (!isPlainObject(value)) {
    report([], 'value', `the default export of ${CONFIG_FILE} must be an object, got ${describeValue(value)}`);
    return null;
  }
  reportUnknownFields(value, FIELDS, [], report, { bento: 'theme options are written under themes, such as themes: { bento: { columns: 4 } }', ...optionHints(themes) });
  const field = (path, problem) => {
    if (problem) report(path, 'value', problem);
  };
  const required = (name, problem) => {
    if (value[name] === undefined) report([name], 'key', `config is missing "${name}"`);
    else field([name], problem(value[name]));
  };
  required('title', (title) => textProblem('title', title));
  if (value.description !== undefined) field(['description'], textProblem('description', value.description));
  required('url', urlProblem);
  required('language', (language) => textProblem('language', language));
  const theme = value.theme ?? 'essay';
  field(['theme'], choiceProblem('theme', [...themes.keys()], theme));
  const categories = withDefaultCategory(validateCategories(value.categories ?? [], report), typeof value.language === 'string' ? value.language : '');
  const options = validateThemeOptions(value, themes, optionProblem, report);
  const chat = section(value, 'chat', CHAT_FIELDS, report);
  const pet = chat.pet ?? DEFAULT_PET;
  field(['chat', 'pet'], petSourceProblem(pet));
  const home = section(value, 'home', HOME_FIELDS, report);
  const homeColumns = home.columns ?? 3;
  field(['home', 'columns'], choiceProblem('home.columns', HOME_COLUMNS, homeColumns));
  const groupBy = home.groupBy ?? (categories.length > 0 ? 'category' : 'month');
  field(['home', 'groupBy'], choiceProblem('home.groupBy', GROUP_BY, groupBy));
  if (groupBy === 'category' && categories.length === 0) {
    report(['home', 'groupBy'], 'value', `home.groupBy is "category" but ${CONFIG_FILE} defines no categories`);
  }
  return {
    title: value.title,
    description: value.description,
    url: value.url,
    language: value.language,
    theme,
    themes: options,
    home: { columns: homeColumns, groupBy },
    categories,
    chat: { pet },
  };
}

function validateThemeOptions(config, themes, optionProblem, report) {
  const written = section(config, 'themes', [...themes.keys()], report, (name) => `themes.${name} names no theme; the themes are ${[...themes.keys()].join(', ')}`);
  return Object.fromEntries(
    [...themes].map(([name, declarations]) => {
      if (declarations === null) return [name, {}];
      const values = isPlainObject(written[name]) ? written[name] : {};
      if (written[name] !== undefined && !isPlainObject(written[name])) report(['themes', name], 'value', `themes.${name} must be an object, got ${describeValue(written[name])}`);
      else reportUnknownFields(values, Object.keys(declarations), ['themes', name], report);
      const options = Object.fromEntries(
        Object.entries(declarations).map(([option, declaration]) => {
          if (!Object.hasOwn(values, option)) return [option, declaration.default];
          const problem = optionProblem(declaration, values[option]);
          if (problem !== null) report(['themes', name, option], 'value', `themes.${name}.${option} ${problem}`);
          return [option, values[option]];
        }),
      );
      return [name, options];
    }),
  );
}

function optionHints(themes) {
  const hints = {};
  for (const [name, declarations] of themes) {
    for (const [option, declaration] of Object.entries(declarations ?? {})) {
      const example = typeof declaration.default === 'string' ? `'${declaration.default}'` : JSON.stringify(declaration.default);
      hints[option] ??= `${option} is an option of the ${name} theme, written as themes.${name}.${option}, such as themes: { ${name}: { ${option}: ${example} } }`;
    }
  }
  return hints;
}

function section(config, name, fields, report, unknown) {
  const value = config[name] ?? {};
  if (!isPlainObject(value)) {
    report([name], 'value', `${name} must be an object, got ${describeValue(value)}`);
    return {};
  }
  if (unknown === undefined) reportUnknownFields(value, fields, [name], report);
  else for (const key of Object.keys(value).filter((key) => !fields.includes(key))) report([name, key], 'key', unknown(key));
  return value;
}

function validateCategories(categories, report) {
  if (!Array.isArray(categories)) {
    report(['categories'], 'value', `categories must be a list, got ${describeValue(categories)}`);
    return [];
  }
  const firstIndex = new Map();
  return categories.map((category, index) => {
    const path = ['categories', index];
    const label = `categories[${index}]`;
    if (!isPlainObject(category)) {
      report(path, 'value', `${label} must be an object, got ${describeValue(category)}`);
      return null;
    }
    reportUnknownFields(category, CATEGORY_FIELDS, path, report);
    const check = (name, problem) => {
      if (category[name] === undefined) report([...path, name], 'key', `config is missing "${label}.${name}"`);
      else if (problem) report([...path, name], 'value', problem);
    };
    const { id, name, color, desc = '' } = category;
    check('id', slugProblem(`${label}.id`, id));
    if (typeof id === 'string' && firstIndex.has(id)) {
      report([...path, 'id'], 'value', `${label}.id ${JSON.stringify(id)} is already used by categories[${firstIndex.get(id)}]`);
    } else if (typeof id === 'string') {
      firstIndex.set(id, index);
    }
    check('name', textProblem(`${label}.name`, name));
    check('color', typeof color === 'string' && HEX_COLOR.test(color) ? null : `${label}.color must be a hex color in the form #rrggbb, got ${describeValue(color)}`);
    const descProblem = typeof desc === 'string' ? characterProblem(`${label}.desc`, desc) : `${label}.desc must be a string, got ${describeValue(desc)}`;
    if (descProblem !== null) report([...path, 'desc'], 'value', descProblem);
    return { id, name, color, desc };
  });
}

// The articles that name no category belong to the category "default", which the config may define itself to choose its name, colour, description and place.
function withDefaultCategory(categories, language) {
  if (categories.length === 0 || categories.some((category) => category?.id === DEFAULT_CATEGORY.id)) return categories;
  return [...categories, { ...DEFAULT_CATEGORY, name: labelsFor(language).defaultCategory }];
}

function reportUnknownFields(object, fields, path, report, hints = {}) {
  for (const name of Object.keys(object)) {
    if (!fields.includes(name)) report([...path, name], 'key', `unknown config field "${[...labelPath(path), name].join('.')}"${Object.hasOwn(hints, name) ? `; ${hints[name]}` : ''}`);
  }
}

function labelPath(path) {
  return path.reduce((parts, segment) => (typeof segment === 'number' ? [...parts.slice(0, -1), `${parts.at(-1)}[${segment}]`] : [...parts, segment]), []);
}

function textProblem(label, value) {
  return typeof value === 'string' && value.trim() !== '' ? characterProblem(label, value) : `${label} must be a non-empty string, got ${describeValue(value)}`;
}

function urlProblem(value) {
  const problem = `url must be an absolute http or https URL, got ${describeValue(value)}`;
  if (typeof value !== 'string' || !URL.canParse(value)) return problem;
  return ['http:', 'https:'].includes(new URL(value).protocol) ? null : problem;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function firstLine(text) {
  return text.split('\n')[0];
}

function sourceLocator(program) {
  const statement = program.body.find((node) => node.type === 'ExportDefaultDeclaration');
  return (path, part) => {
    if (!statement) return fileStart;
    if (statement.declaration.type !== 'ObjectExpression') return startOf(statement);
    let node = statement.declaration;
    let key = null;
    for (const segment of path) {
      const child = childNode(node, segment);
      if (!child) return startOf(node);
      ({ node, key } = child);
    }
    return startOf(part === 'key' && key ? key : node);
  };
}

function childNode(node, segment) {
  if (node.type === 'ObjectExpression') {
    const index = node.properties.findLastIndex((property) => property.type === 'Property' && !property.computed && propertyName(property.key) === segment);
    if (index === -1 || node.properties.slice(index + 1).some((property) => property.type === 'SpreadElement')) return null;
    return { node: node.properties[index].value, key: node.properties[index].key };
  }
  if (node.type === 'ArrayExpression' && typeof segment === 'number') {
    const elements = node.elements.slice(0, segment + 1);
    if (elements.length <= segment || elements.some((element) => element === null || element.type === 'SpreadElement')) return null;
    return { node: elements[segment], key: null };
  }
  return null;
}

function propertyName(key) {
  return key.type === 'Identifier' ? key.name : String(key.value);
}

function startOf(node) {
  return { line: node.loc.start.line, column: node.loc.start.column + 1 };
}
