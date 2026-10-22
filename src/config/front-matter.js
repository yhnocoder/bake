import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { describeValue, errorAt, fileStart } from '../report.js';
import { characterProblem, choiceProblem, folderFile, folderPath, slugProblem } from './rules.js';
import { CONFIG_FILE } from './bake-config.js';

const REQUIRED = ['title', 'slug', 'date'];
export const FRONT_MATTER_FIELDS = Object.freeze(['title', 'slug', 'date', 'summary', 'tags', 'category', 'preview', 'theme', 'draft', 'cover', 'page']);
const DATE_FORM = /^(\d{4})-(\d{2})-(\d{2})$/;

export function readFrontMatter(file, source, rules, errors) {
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines[0] !== '---') {
    errors.push(errorAt(file, fileStart, 'index.md must start with front matter between two --- lines'));
    return null;
  }
  const close = lines.indexOf('---', 1);
  if (close === -1) {
    errors.push(errorAt(file, fileStart, 'front matter has no closing --- line'));
    return null;
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(lines.slice(1, close).join('\n'), { lineCounter, prettyErrors: false });
  const positionOf = (offset) => {
    const { line, col } = lineCounter.linePos(offset);
    return { line: line + 1, column: col };
  };
  if (document.errors.length > 0) {
    for (const error of document.errors) errors.push(errorAt(file, positionOf(error.pos[0]), error.message));
    return null;
  }
  if (document.contents !== null && !isMap(document.contents)) {
    errors.push(errorAt(file, positionOf(document.contents.range[0]), 'front matter must be a mapping of fields'));
    return null;
  }
  const report = (node, message) => errors.push(errorAt(file, positionOf(node.range[0]), message));
  const items = document.contents?.items ?? [];
  const written = items.find((pair) => keyName(pair) === 'theme')?.value?.toJS(document);
  const theme = written ?? rules.theme;
  const declarations = rules.options.get(theme);
  const fields = {};
  const options = {};
  const positions = {};
  for (const pair of items) {
    const name = keyName(pair);
    const node = pair.value ?? pair.key;
    const value = pair.value === null ? null : pair.value.toJS(document);
    if (!FRONT_MATTER_FIELDS.includes(name)) {
      // why: an article whose theme is wrong is reported at its theme, and its options are known only once the theme is
      if (declarations === undefined) continue;
      if (!Object.hasOwn(declarations, name)) report(pair.key, unknownField(name, theme, rules.options));
      else if (rules.optionProblem(declarations[name], value) !== null) report(node, `${name} ${rules.optionProblem(declarations[name], value)}`);
      else options[name] = value;
      continue;
    }
    const problem = fieldProblem(name, value, pair.value, rules);
    if (problem) {
      report(problem.node ?? node, problem.message);
      continue;
    }
    fields[name] = name === 'preview' || name === 'cover' || name === 'page' ? folderPath(value) : value;
    positions[name] = positionOf(node.range[0]);
  }
  for (const name of REQUIRED) {
    if (!document.contents?.has(name)) errors.push(errorAt(file, fileStart, `front matter is missing "${name}"`));
  }
  if (rules.categories.length > 0 && !document.contents?.has('category')) fields.category = 'default';
  if ('page' in fields) {
    const body = lines.findIndex((line, index) => index > close && line.trim() !== '');
    if (body !== -1) {
      errors.push(errorAt(file, { line: body + 1, column: lines[body].search(/\S/) + 1 }, 'index.md with "page" must have no body'));
    }
  }
  return { fields, options, positions };
}

function keyName(pair) {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

function unknownField(name, theme, options) {
  const owner = [...options].find(([, declarations]) => declarations !== null && Object.hasOwn(declarations, name))?.[0];
  const field = `unknown front matter field ${JSON.stringify(name)}`;
  return owner === undefined ? field : `${field}; it is an option of the ${owner} theme, and this article uses the ${theme} theme`;
}

function fieldProblem(name, value, node, rules) {
  const message = fieldMessage(name, value, rules);
  if (message) return { message };
  if (name !== 'tags') {
    const problem = name === 'title' || name === 'summary' ? characterProblem(name, value) : null;
    return problem === null ? null : { message: problem };
  }
  const item = value.findIndex((tag) => typeof tag !== 'string' || characterProblem('tag', tag) !== null);
  if (item === -1) return null;
  return { node: isSeq(node) ? node.items[item] : node, message: typeof value[item] === 'string' ? characterProblem('tags', value[item]) : 'tags must be a list of strings' };
}

function fieldMessage(name, value, rules) {
  switch (name) {
    case 'title':
      return typeof value === 'string' && value.trim() !== '' ? null : `title must be a non-empty string, got ${describeValue(value)}`;
    case 'slug':
      return slugProblem('slug', value);
    case 'date':
      return isCalendarDate(value) ? null : `date must be a date in the form YYYY-MM-DD, got ${describeValue(value)}`;
    case 'summary':
      return typeof value === 'string' ? null : `summary must be a string, got ${describeValue(value)}`;
    case 'tags':
      return Array.isArray(value) ? null : 'tags must be a list of strings';
    case 'category':
      if (rules.categories.length === 0) return `category is set but ${CONFIG_FILE} defines no categories`;
      return rules.categories.includes(value) ? null : `category ${describeValue(value)} is not one of the categories in ${CONFIG_FILE}`;
    case 'theme':
      return choiceProblem('theme', rules.themes, value);
    case 'draft':
      return typeof value === 'boolean' ? null : `draft must be true or false, got ${describeValue(value)}`;
    case 'preview':
    case 'cover':
      return articleFileProblem(name, value, 'a file', rules.files);
    case 'page':
      return articleFileProblem(name, value, 'an .html file', rules.files, '.html');
  }
}

function articleFileProblem(name, value, kind, files, extension = '') {
  const path = typeof value === 'string' ? folderPath(value) : null;
  if (path === null || !path.endsWith(extension)) return `${name} must be the relative path of ${kind} in the article folder, got ${describeValue(value)}`;
  return folderFile(path, files) === null ? `${name} file ${JSON.stringify(value)} does not exist` : null;
}

function isCalendarDate(value) {
  const match = typeof value === 'string' ? DATE_FORM.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
