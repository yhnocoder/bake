import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paramProblems, valueProblem } from '../components/declarations.js';
import { FRONT_MATTER_FIELDS } from '../config/front-matter.js';
import { describeValue, errorAt, fileStart, listChoices } from '../report.js';
import { READING_SETTINGS } from '../theme/settings.js';
import { themeFolder } from './theme.js';

export const THEME_OPTIONS_FILE = 'options.js';
const OPTION = { noun: 'option', reserved: [], written: 'as a key of bake.config.js', setter: 'bake.config.js' };
const SETTING_NAME = /^[a-z][a-z0-9]*$/;
const SETTING_FIELDS = ['values', 'default', 'control'];
const CONTROLS = ['segmented', 'switch', 'list'];
const CORE_SETTINGS = [...Object.keys(READING_SETTINGS), 'scheme', 'script'];

export async function readThemeOptions(root, names, errors) {
  const themes = new Map();
  for (const name of names) {
    const path = join(themeFolder(root, name), THEME_OPTIONS_FILE);
    themes.set(name, existsSync(path) ? await readOptions(root, name, path, errors) : {});
  }
  return themes;
}

export function optionProblem(declaration, value) {
  const problem = valueProblem(declaration, value);
  if (problem !== null || declaration.type !== 'number' || declaration.step === undefined) return problem;
  const steps = (value - (declaration.min ?? 0)) / declaration.step;
  if (Math.abs(steps - Math.round(steps)) < 1e-9) return null;
  const range = declaration.min !== undefined && declaration.max !== undefined ? ` from ${declaration.min} to ${declaration.max}` : '';
  if (declaration.step === 1 && Number.isInteger(declaration.min ?? 0)) return `must be a whole number${range}, got ${describeValue(value)}`;
  return `must be ${declaration.min ?? 0} plus a multiple of ${declaration.step}, got ${describeValue(value)}`;
}

async function readOptions(root, name, path, errors) {
  const file = path.startsWith(root) ? relative(root, path) : `${name} theme ${THEME_OPTIONS_FILE}`;
  const source = readFileSync(path, 'utf8');
  let options;
  let settings;
  try {
    ({ options, settings = {} } = await import(`${pathToFileURL(path).href}?version=${createHash('sha256').update(source).digest('hex')}`));
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
  return errors.length === count ? options : null;
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
