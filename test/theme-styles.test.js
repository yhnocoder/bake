import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;
const PHONE_SCREEN_WIDTH = 600;
const MAX_WIDTH_OFFSET = 0.02;

function cssFiles(folder) {
  return readdirSync(folder, { recursive: true })
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(folder, name));
}

test('every width media query in the styles uses a breakpoint of screens.js or the phone screen width', () => {
  const screens = readFileSync(join(SRC, 'theme/scripts/screens.js'), 'utf8');
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

test('every stacking layer variable that the styles use is defined', () => {
  const code = readdirSync(SRC, { recursive: true })
    .filter((name) => /\.(css|jsx?)$/.test(name))
    .map((name) => readFileSync(join(SRC, name), 'utf8'))
    .join('\n');
  const defined = new Set([...code.matchAll(/(--layer-[a-z-]+)\s*:/g)].map(([, name]) => name));
  const used = new Set([...code.matchAll(/var\((--layer-[a-z-]+)\)/g)].map(([, name]) => name));
  assert.deepEqual([...used].filter((name) => !defined.has(name)).sort(), []);
});

test('no rule tests the root element with :has() on its descendants', () => {
  const problems = [];
  for (const file of cssFiles(SRC)) {
    const css = readFileSync(file, 'utf8');
    for (const match of css.matchAll(/(?:html|:root)[^\s,{]*:has\(\s*([^)]*)\)/g)) {
      if (!match[1].startsWith('>')) problems.push(`${relative(SRC, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the essay fonts use an installed LXGW WenKai before the files of lxgw-wenkai-webfont, in both weights', () => {
  const css = readFileSync(join(SRC, 'theme/styles/fonts.css'), 'utf8');
  const lastImport = css.lastIndexOf('@import');
  const localFaces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .filter((match) => match[1].includes("'LXGW WenKai'"))
    .map((match) => ({ after: match.index > lastImport, weight: match[1].match(/font-weight:\s*(\d+)/)[1], sources: match[1].match(/src:\s*([^;]*);/)[1].split(/,\s*/) }));
  assert.deepEqual(localFaces.map(({ after, weight }) => [after, weight]), [[true, '400'], [true, '700']]);
  for (const { sources } of localFaces) assert.ok(sources.every((source) => source.startsWith('local(')), sources.join());
});
