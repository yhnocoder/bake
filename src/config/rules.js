import { join, posix } from 'node:path';
import { describeValue, listChoices } from '../report.js';

export const BUILT_IN_THEMES = Object.freeze(['essay', 'bento']);
export const WIDTHS = Object.freeze(['body', 'wide', 'page']);

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SIZE_PATTERN = /^(\d+(?:\.\d+)?)(px|%)$/;
const NOT_IN_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]/u;

export function slugProblem(label, value) {
  if (typeof value !== 'string') return `${label} must be a string, got ${describeValue(value)}`;
  if (!SLUG_PATTERN.test(value)) return `${label} ${JSON.stringify(value)} may only contain lowercase letters, digits and "-"`;
  return null;
}

export function characterProblem(label, value) {
  const found = typeof value === 'string' ? NOT_IN_XML.exec(value) : null;
  if (found === null) return null;
  return `${label} contains the character U+${found[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, which the RSS feed and the sitemap cannot hold`;
}

export function choiceProblem(label, choices, value) {
  return choices.includes(value) ? null : `${label} must be ${listChoices(choices)}, got ${describeValue(value)}`;
}

export function parseSize(value) {
  const match = SIZE_PATTERN.exec(typeof value === 'string' ? value : '');
  if (match === null || Number(match[1]) === 0) return null;
  return { number: Number(match[1]), unit: match[2] };
}

export function sizeProblem(label, value, subject) {
  if (parseSize(value) !== null) return null;
  const hint = WIDTHS.includes(value) ? `; use :::{width=${value}} around the ${subject}` : ', for example 560px or 70%';
  return `${label} must be a positive number of pixels or a percentage, got ${describeValue(value)}${hint}`;
}

export function folderPath(path) {
  const normal = posix.normalize(path);
  return normal === '.' || normal === '..' || normal.startsWith('../') || normal.startsWith('/') ? null : normal;
}

export function folderFile(path, files) {
  const normal = folderPath(path);
  return normal !== null && files.includes(normal) ? normal : null;
}

export function availableThemes(files) {
  const themesDir = join(files.root, 'themes');
  const custom = files.list(themesDir).filter((name) => files.stat(join(themesDir, name))?.isDirectory() && !BUILT_IN_THEMES.includes(name));
  return Object.freeze([...BUILT_IN_THEMES, ...custom]);
}
