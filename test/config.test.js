import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadBakeConfig } from '../src/config/bake-config.js';
import { availableThemes } from '../src/config/rules.js';
import { formatError, sortErrors } from '../src/report.js';
import { createBlog } from './blog.js';

async function load(t, files) {
  const dir = createBlog(t, files);
  const errors = [];
  const config = await loadBakeConfig(dir, availableThemes(dir), errors);
  return { config, lines: sortErrors(errors).map(formatError) };
}

const base = "title: 'Test', url: 'https://example.com', language: 'en'";

describe('bake.config.js', () => {
  test('applies defaults and returns a frozen config', async (t) => {
    const { config, lines } = await load(t, { 'bake.config.js': `export default { ${base} };\n` });
    assert.deepEqual(lines, []);
    assert.deepEqual(config, {
      title: 'Test',
      description: undefined,
      url: 'https://example.com',
      language: 'en',
      theme: 'essay',
      toc: 'notes',
      bento: { columns: 4 },
      home: { columns: 3, groupBy: 'month' },
      categories: [],
      chat: { pet: 'crt-monitor' },
    });
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.home));
  });

  test('groups the homepage by category when categories are configured', async (t) => {
    const source = `export default {\n  ${base},\n  theme: 'mine',\n  categories: [{ id: 'ml', name: 'Machine learning', color: '#1a2B3c' }],\n};\n`;
    const { config, lines } = await load(t, { 'bake.config.js': source, 'themes/mine/style.css': '' });
    assert.deepEqual(lines, []);
    assert.equal(config.theme, 'mine');
    assert.equal(config.home.groupBy, 'category');
    assert.deepEqual(config.categories, [{ id: 'ml', name: 'Machine learning', color: '#1a2B3c', desc: '' }]);
    assert.ok(Object.isFrozen(config.categories[0]));
  });

  test('reports a missing bake.config.js at 1:1', async (t) => {
    const { config, lines } = await load(t, {});
    assert.equal(config, null);
    assert.deepEqual(lines, ['bake.config.js:1:1 bake.config.js not found, run bake from the blog root']);
  });

  test('reports a JavaScript syntax error at its position', async (t) => {
    const { lines } = await load(t, { 'bake.config.js': 'export default {\n  title: ,\n};\n' });
    assert.deepEqual(lines, ['bake.config.js:2:10 Unexpected token']);
  });

  test('reports an error thrown while importing at 1:1', async (t) => {
    const { lines } = await load(t, { 'bake.config.js': 'export default { title: missingName };\n' });
    assert.deepEqual(lines, ['bake.config.js:1:1 missingName is not defined']);
  });

  test('reports a default export that is not an object at the export statement', async (t) => {
    const { lines } = await load(t, { 'bake.config.js': "const name = 'blog';\nexport default name;\n" });
    assert.deepEqual(lines, ['bake.config.js:2:1 the default export of bake.config.js must be an object, got "blog"']);
  });

  test('reports a module without a default export at 1:1', async (t) => {
    const { lines } = await load(t, { 'bake.config.js': 'export const title = 1;\n' });
    assert.deepEqual(lines, ['bake.config.js:1:1 the default export of bake.config.js must be an object, got undefined']);
  });

  test('reports missing required fields at the exported object', async (t) => {
    const { lines } = await load(t, { 'bake.config.js': "export default {\n  url: 'https://example.com',\n};\n" });
    assert.deepEqual(lines, ['bake.config.js:1:16 config is missing "title"', 'bake.config.js:1:16 config is missing "language"']);
  });

  const valueCases = [
    ["title: @''", 'title must be a non-empty string, got ""'],
    ["description: @''", 'description must be a non-empty string, got ""'],
    ['description: @3', 'description must be a non-empty string, got 3'],
    ['title: @3', 'title must be a non-empty string, got 3'],
    ["language: @' '", 'language must be a non-empty string, got " "'],
    ["url: @'example.com'", 'url must be an absolute http or https URL, got "example.com"'],
    ["url: @'ftp://example.com'", 'url must be an absolute http or https URL, got "ftp://example.com"'],
    ["theme: @'paper'", 'theme must be essay or bento, got "paper"'],
    ["toc: @'sidebar'", 'toc must be notes, tabs, dots or ticks, got "sidebar"'],
    ['bento: @4', 'bento must be an object, got 4'],
    ['bento: { columns: @0 }', 'bento.columns must be an integer from 1 to 6, got 0'],
    ['bento: { columns: @7 }', 'bento.columns must be an integer from 1 to 6, got 7'],
    ['bento: { columns: @100 }', 'bento.columns must be an integer from 1 to 6, got 100'],
    ['bento: { columns: @2.5 }', 'bento.columns must be an integer from 1 to 6, got 2.5'],
    ["home: @'grid'", 'home must be an object, got "grid"'],
    ['home: { columns: @6 }', 'home.columns must be 3, 4 or 5, got 6'],
    ["home: { groupBy: @'year' }", 'home.groupBy must be category or month, got "year"'],
    ["home: { groupBy: @'category' }", 'home.groupBy is "category" but bake.config.js defines no categories'],
    ["categories: @{ ml: 'ML' }", 'categories must be a list, got an object'],
    ["categories: [@'ml']", 'categories[0] must be an object, got "ml"'],
    ["categories: [{ id: @'Machine_Learning', name: 'ML', color: '#000000' }]", 'categories[0].id "Machine_Learning" may only contain lowercase letters, digits and "-"'],
    ["categories: [{ id: @7, name: 'ML', color: '#000000' }]", 'categories[0].id must be a string, got 7'],
    ["categories: [{ id: 'ml', name: @'', color: '#000000' }]", 'categories[0].name must be a non-empty string, got ""'],
    ["categories: [{ id: 'ml', name: 'ML', color: @'red' }]", 'categories[0].color must be a hex color in the form #rrggbb, got "red"'],
    ["categories: [{ id: 'ml', name: 'ML', color: '#000000', desc: @3 }]", 'categories[0].desc must be a string, got 3'],
  ];

  for (const [marked, message] of valueCases) {
    test(`reports ${message} at the value`, async (t) => {
      const field = marked.replace('@', '');
      const { lines } = await load(t, { 'bake.config.js': `export default {\n  ${base},\n  ${field},\n};\n` });
      assert.deepEqual(lines, [`bake.config.js:3:${marked.indexOf('@') + 3} ${message}`]);
    });
  }

  test('reports nested values at their own position', async (t) => {
    const source = [
      'export default {',
      `  ${base},`,
      '  home: { columns: 6 },',
      "  categories: [{ id: 'ml', name: 'ML', color: 'red' }, 'x'],",
      '};',
      '',
    ].join('\n');
    const { lines } = await load(t, { 'bake.config.js': source });
    assert.deepEqual(lines, [
      'bake.config.js:3:20 home.columns must be 3, 4 or 5, got 6',
      'bake.config.js:4:47 categories[0].color must be a hex color in the form #rrggbb, got "red"',
      'bake.config.js:4:56 categories[1] must be an object, got "x"',
    ]);
  });

  test('reports unknown fields at their keys', async (t) => {
    const source = [
      'export default {',
      `  ${base},`,
      '  colour: 1,',
      '  bento: { columns: 4, rows: 2 },',
      "  categories: [{ id: 'ml', name: 'ML', color: '#000000', icon: 'x' }],",
      '};',
      '',
    ].join('\n');
    const { lines } = await load(t, { 'bake.config.js': source });
    assert.deepEqual(lines, [
      'bake.config.js:3:3 unknown config field "colour"',
      'bake.config.js:4:24 unknown config field "bento.rows"',
      'bake.config.js:5:58 unknown config field "categories[0].icon"',
    ]);
  });

  test('reports a missing category field at the category object and a reused id at its value', async (t) => {
    const source = [
      'export default {',
      `  ${base},`,
      '  categories: [',
      "    { id: 'ml', name: 'ML', color: '#000000' },",
      "    { id: 'ml', name: 'ML again', color: '#ffffff' },",
      "    { name: 'No id', color: '#ffffff' },",
      '  ],',
      '};',
      '',
    ].join('\n');
    const { lines } = await load(t, { 'bake.config.js': source });
    assert.deepEqual(lines, [
      'bake.config.js:5:11 categories[1].id "ml" is already used by categories[0]',
      'bake.config.js:6:5 config is missing "categories[2].id"',
    ]);
  });

  test('lists custom theme folders in the theme message', async (t) => {
    const { lines } = await load(t, {
      'bake.config.js': `export default { ${base}, theme: 'paper' };\n`,
      'themes/mine/style.css': '',
      'themes/essay/style.css': '',
    });
    assert.deepEqual(lines, ['bake.config.js:1:84 theme must be essay, bento or mine, got "paper"']);
  });

  test('reports a value that is not written as a literal at the nearest literal', async (t) => {
    const source = `const home = { columns: 9 };\nexport default {\n  ${base},\n  home,\n};\n`;
    const { lines } = await load(t, { 'bake.config.js': source });
    assert.deepEqual(lines, ['bake.config.js:4:3 home.columns must be 3, 4 or 5, got 9']);
  });
});
