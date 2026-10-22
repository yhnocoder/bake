import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { optionProblem, paramProblems } from '../components/declarations.js';
import { FRONT_MATTER_FIELDS } from '../config/front-matter.js';
import { BUILT_IN_BLOCK_NAMES } from '../markdown/parse.js';
import { describeValue, errorAt, fileStart, listAll, listChoices } from '../report.js';
import { READING_SETTINGS } from '../theme/settings.js';
import { themeFolder } from './theme.js';

export const THEME_OPTIONS_FILE = 'options.js';
const OPTION = { noun: 'option', reserved: [], written: 'as a key of bake.config.js', setter: 'bake.config.js' };
const SETTING_NAME = /^[a-z][a-z0-9]*$/;
const SETTING_FIELDS = ['values', 'default', 'control'];
const CONTROLS = ['segmented', 'switch', 'list'];
const CORE_SETTINGS = [...Object.keys(READING_SETTINGS), 'font', 'scheme', 'script'];
const ATTRIBUTE_NAME = /^[A-Za-z_][\w-]*$/;
const BLOCK_NAME = /^[a-z][a-z0-9]*$/;
const ATTRIBUTE_TYPES = ['number', 'text', 'enum', 'boolean'];
const ATTRIBUTE_FIELDS = { number: ['min', 'max', 'step'], text: [], enum: ['options'], boolean: [] };
const DEPTHS = [2, 3, 4, 5, 6];
const NOTHING_DECLARED = { options: {}, headings: {}, blocks: {} };

export async function readThemeDeclarations(root, names, errors) {
  const options = new Map();
  const markdown = new Map();
  for (const name of names) {
    const path = join(themeFolder(root, name), THEME_OPTIONS_FILE);
    const declared = existsSync(path) ? await readDeclarations(root, name, path, errors) : NOTHING_DECLARED;
    options.set(name, declared?.options ?? null);
    markdown.set(name, declared === null ? null : { name, headings: declared.headings, blocks: declared.blocks });
  }
  return { options, markdown };
}

async function readDeclarations(root, name, path, errors) {
  const file = path.startsWith(root) ? relative(root, path) : `${name} theme ${THEME_OPTIONS_FILE}`;
  const source = readFileSync(path, 'utf8');
  let options;
  let settings;
  let headings;
  let blocks;
  try {
    ({ options, settings = {}, headings = {}, blocks = {} } = await import(`${pathToFileURL(path).href}?version=${createHash('sha256').update(source).digest('hex')}`));
  } catch (error) {
    errors.push(errorAt(file, fileStart, `${name}: ${THEME_OPTIONS_FILE} cannot be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`));
    return null;
  }
  if (!isPlainObject(options)) {
    errors.push(errorAt(file, fileStart, `${name}: ${THEME_OPTIONS_FILE} must export options, an object that maps each option name to its declaration, got ${describeValue(options)}`));
    return null;
  }
  const count = errors.length;
  const report = (problem) => errors.push(errorAt(file, fileStart, `${name}: ${problem}`));
  for (const [option, declaration] of Object.entries(options)) {
    const problems = optionDeclarationProblems(option, declaration);
    problems.forEach(report);
    if (problems.length === 0 && optionProblem(declaration, declaration.default) !== null) report(`the default of option "${option}" ${optionProblem(declaration, declaration.default)}`);
  }
  if (!isPlainObject(settings)) report(`${THEME_OPTIONS_FILE} exports settings, which must be an object that maps each setting name to its declaration, got ${describeValue(settings)}`);
  else for (const [setting, declaration] of Object.entries(settings)) settingProblems(setting, declaration, options).forEach(report);
  if (!isPlainObject(headings)) report(`${THEME_OPTIONS_FILE} exports headings, which must be an object that maps each heading attribute to its declaration, got ${describeValue(headings)}`);
  else for (const [attribute, declaration] of Object.entries(headings)) attributeProblems(`heading attribute "${attribute}"`, attribute, declaration, true).forEach(report);
  if (!isPlainObject(blocks)) report(`${THEME_OPTIONS_FILE} exports blocks, which must be an object that maps each block name to the declarations of its attributes, got ${describeValue(blocks)}`);
  else for (const [block, attributes] of Object.entries(blocks)) blockProblems(block, attributes).forEach(report);
  return errors.length === count ? { options, headings, blocks } : null;
}

function blockProblems(name, attributes) {
  const subject = `block "${name}"`;
  if (!BLOCK_NAME.test(name)) return [`${subject} must be named with lowercase letters and digits, starting with a letter; a name with "-" is a component`];
  if (BUILT_IN_BLOCK_NAMES.includes(name)) return [`${subject} has the name of a block of Bake; a theme cannot declare ${listChoices(BUILT_IN_BLOCK_NAMES)}`];
  if (!isPlainObject(attributes)) return [`${subject} must be declared as an object that maps each of its attributes to its declaration, such as { cols: { type: 'number', min: 1, max: 6, step: 1 } }, got ${describeValue(attributes)}`];
  return Object.entries(attributes).flatMap(([attribute, declaration]) => attributeProblems(`attribute "${attribute}" of ${subject}`, attribute, declaration, false));
}

function attributeProblems(subject, name, declaration, heading) {
  if (!ATTRIBUTE_NAME.test(name)) return [`${subject} cannot be written as a Markdown attribute; use letters, digits, "_" and "-", starting with a letter or "_"`];
  if (heading && name === 'id') return [`${subject} is the anchor of a heading, which Bake reads itself`];
  if (!isPlainObject(declaration)) return [`${subject} must be declared as an object such as { type: 'number', min: 1, max: 6, step: 1 }, got ${describeValue(declaration)}`];
  if (!ATTRIBUTE_TYPES.includes(declaration.type)) return [`${subject} has the type ${describeValue(declaration.type)}; use ${listChoices(ATTRIBUTE_TYPES)}`];
  const known = ['type', ...ATTRIBUTE_FIELDS[declaration.type], ...(heading ? ['depth'] : ['required'])];
  const problems = Object.keys(declaration)
    .filter((field) => !known.includes(field))
    .map((field) => `${subject} has the unknown field "${field}"; the fields of a ${declaration.type} attribute are ${listAll(known)}`);
  if (declaration.type === 'number') {
    for (const field of ['min', 'max', 'step']) {
      if (declaration[field] !== undefined && !Number.isFinite(declaration[field])) problems.push(`${subject} has ${field} ${describeValue(declaration[field])}; it must be a number`);
    }
    if (declaration.step !== undefined && !(declaration.step > 0)) problems.push(`${subject} has step ${describeValue(declaration.step)}; it must be greater than 0`);
    if (declaration.min > declaration.max) problems.push(`${subject} has min ${declaration.min} above max ${declaration.max}`);
  }
  const { options } = declaration;
  if (declaration.type === 'enum' && (!Array.isArray(options) || options.length === 0 || options.some((option) => typeof option !== 'string'))) {
    problems.push(`${subject} is an enum without options; list them as strings, for example options: ['body', 'wide']`);
  }
  if (declaration.depth !== undefined && !DEPTHS.includes(declaration.depth)) problems.push(`${subject} has depth ${describeValue(declaration.depth)}; it must be the level of a heading from 2 to 6`);
  if (declaration.required !== undefined && typeof declaration.required !== 'boolean') problems.push(`${subject} has required ${describeValue(declaration.required)}; it must be true or false`);
  return problems;
}

function optionDeclarationProblems(option, declaration) {
  if (FRONT_MATTER_FIELDS.includes(option)) return [`option "${option}" has the name of the front matter field "${option}", so an article could not set it`];
  if (declaration?.type === 'file') return [`option "${option}" has the type "file"; a theme option is set in bake.config.js and cannot name a file of an article`];
  return paramProblems(option, declaration, OPTION);
}

function settingProblems(name, setting, options) {
  const subject = `setting "${name}"`;
  if (!SETTING_NAME.test(name)) return [`${subject} becomes the attribute data-${name}; use lowercase letters and digits, starting with a letter`];
  if (CORE_SETTINGS.includes(name)) return [`${subject} uses a name reserved for Bake; a theme cannot declare ${listChoices(CORE_SETTINGS)}`];
  if (!isPlainObject(setting)) return [`${subject} must be declared as an object such as { values: ['on', 'off'], default: 'on', control: 'switch' }, got ${describeValue(setting)}`];
  const problems = Object.keys(setting)
    .filter((field) => !SETTING_FIELDS.includes(field))
    .map((field) => `${subject} has the unknown field "${field}"; the fields of a setting are values, default and control`);
  const { values, control } = setting;
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string') || new Set(values).size < values.length) {
    return [...problems, `${subject} needs values, a list of different strings`];
  }
  if (!CONTROLS.includes(control)) problems.push(`${subject} has the control ${describeValue(control)}; use ${listChoices(CONTROLS)}`);
  else if (control === 'switch' && values.length !== 2) problems.push(`${subject} is a switch and needs two values, the value when it is on and the value when it is off`);
  const problem = defaultProblem(setting.default, values, options);
  if (problem !== null) problems.push(`the default of ${subject} ${problem}`);
  return problems;
}

function defaultProblem(value, values, options) {
  if (typeof value === 'string') return values.includes(value) ? null : `must be one of its values, ${listChoices(values)}, got ${describeValue(value)}`;
  if (!isPlainObject(value) || Object.keys(value).join() !== 'option') return `must be one of its values or { option: 'name' }, the value of a theme option, got ${describeValue(value)}`;
  const option = Object.hasOwn(options, value.option) ? options[value.option] : undefined;
  if (option === undefined) return `names the option ${describeValue(value.option)}, which ${THEME_OPTIONS_FILE} does not declare`;
  if (option?.type !== 'enum' || !Array.isArray(option.options) || option.options.some((choice) => !values.includes(choice))) return `names the option "${value.option}", which must be an enum whose options are values of the setting`;
  return null;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
