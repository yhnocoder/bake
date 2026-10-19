import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeValue, listChoices } from '../report.js';

export const BUILT_IN_THEMES = Object.freeze(['essay', 'bento']);
export const TOC_STYLES = Object.freeze(['notes', 'tabs', 'dots', 'ticks']);

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function slugProblem(label, value) {
  if (typeof value !== 'string') return `${label} must be a string, got ${describeValue(value)}`;
  if (!SLUG_PATTERN.test(value)) return `${label} ${JSON.stringify(value)} may only contain lowercase letters, digits and "-"`;
  return null;
}

export function choiceProblem(label, choices, value) {
  return choices.includes(value) ? null : `${label} must be ${listChoices(choices)}, got ${describeValue(value)}`;
}

export function availableThemes(root) {
  const themesDir = join(root, 'themes');
  const custom = isDirectory(themesDir)
    ? readdirSync(themesDir)
        .filter((name) => isDirectory(join(themesDir, name)) && !BUILT_IN_THEMES.includes(name))
        .sort()
    : [];
  return Object.freeze([...BUILT_IN_THEMES, ...custom]);
}

function isDirectory(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}
