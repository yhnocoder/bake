import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;
const ESSAY_STYLES = join(SRC, 'themes/essay/styles');
const PHONE_SCREEN_WIDTH = 600;
const MAX_WIDTH_OFFSET = 0.02;

function cssFiles(folder) {
  return readdirSync(folder, { recursive: true })
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(folder, name));
}

function blockBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `tokens.css has no block ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function declarations(body) {
  return body
    .split(';')
    .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

test('every width media query in the styles uses a breakpoint of screens.js or the phone screen width', () => {
  const screens = readFileSync(join(SRC, 'themes/essay/scripts/screens.js'), 'utf8');
  const screenWidths = [...screens.matchAll(/min-width: (\d+)px/g)].map((match) => Number(match[1]));
  assert.deepEqual(screenWidths, [1340, 1000]);
  const breakpoints = new Set([...screenWidths, PHONE_SCREEN_WIDTH]);
  const problems = [];
  for (const file of cssFiles(SRC)) {
    const css = readFileSync(file, 'utf8');
    for (const match of css.matchAll(/(min|max)-width:\s*([\d.]+)px/g)) {
      if (!css.slice(0, match.index).trimEnd().match(/@media[^{;]*$/)) continue;
      const width = Number(match[2]) + (match[1] === 'max' ? MAX_WIDTH_OFFSET : 0);
      const rounded = Math.round(width * 100) / 100;
      if (!breakpoints.has(rounded)) problems.push(`${relative(SRC, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the dark tokens for data-theme and for the system color scheme are the same', () => {
  const css = readFileSync(join(ESSAY_STYLES, 'tokens.css'), 'utf8');
  const chosen = declarations(blockBody(css, ":root[data-theme='dark']"));
  const system = declarations(blockBody(css, ":root:not([data-theme='light'])"));
  assert.ok(chosen.length > 10);
  assert.deepEqual(system, chosen);
});
