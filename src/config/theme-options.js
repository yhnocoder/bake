import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paramProblems, valueProblem } from '../components/declarations.js';
import { describeValue, errorAt, fileStart } from '../report.js';
import { BUILT_IN_THEMES } from './rules.js';

const OPTIONS_FILE = 'options.js';
const OPTION = { noun: 'option', reserved: [], written: 'as a key of bake.config.js', setter: 'bake.config.js' };
const BUILT_IN_DIR = join(import.meta.dirname, '../themes');

export async function readThemeOptions(root, names, errors) {
  const themes = new Map();
  for (const name of names) {
    const path = [join(root, 'themes', name, OPTIONS_FILE), ...(BUILT_IN_THEMES.includes(name) ? [join(BUILT_IN_DIR, name, OPTIONS_FILE)] : [])].find((candidate) => existsSync(candidate));
    themes.set(name, path === undefined ? {} : await readOptions(root, name, path, errors));
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
  const file = path.startsWith(root) ? relative(root, path) : `${name} theme ${OPTIONS_FILE}`;
  const source = readFileSync(path, 'utf8');
  let options;
  try {
    ({ options } = await import(`${pathToFileURL(path).href}?version=${createHash('sha256').update(source).digest('hex')}`));
  } catch (error) {
    errors.push(errorAt(file, fileStart, `${name}: ${OPTIONS_FILE} cannot be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`));
    return {};
  }
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    errors.push(errorAt(file, fileStart, `${name}: ${OPTIONS_FILE} must export options, an object that maps each option name to its declaration, got ${describeValue(options)}`));
    return {};
  }
  const count = errors.length;
  for (const [option, declaration] of Object.entries(options)) {
    const problems = declaration?.type === 'file' ? [`option "${option}" has the type "file"; a theme option is set in bake.config.js and cannot name a file of an article`] : paramProblems(option, declaration, OPTION);
    for (const problem of problems) errors.push(errorAt(file, fileStart, `${name}: ${problem}`));
    if (problems.length === 0 && optionProblem(declaration, declaration.default) !== null) {
      errors.push(errorAt(file, fileStart, `${name}: the default of option "${option}" ${optionProblem(declaration, declaration.default)}`));
    }
  }
  return errors.length === count ? options : {};
}
