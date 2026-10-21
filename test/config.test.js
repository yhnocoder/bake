import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, bake, createBlog } from './blog.js';

const base = "title: 'Test', url: 'https://example.com', language: 'en'";

function problems(t, files) {
  const result = bake(createBlog(t, { 'themes/mine/style.css': '', 'themes/essay/style.css': '', ...files }), 'build');
  assert.equal(result.status, 1, result.stdout);
  return result.stderr.trimEnd().split('\n').slice(0, -1);
}

function config(...lines) {
  return ['export default {', ...lines, '};', ''].join('\n');
}

describe('bake.config.js', () => {
  test('reports each wrong value at the value', (t) => {
    const rounds = [
      [
        ["title: @''", 'title must be a non-empty string, got ""'],
        ["description: @''", 'description must be a non-empty string, got ""'],
        ["language: @' '", 'language must be a non-empty string, got " "'],
        ["url: @'example.com'", 'url must be an absolute http or https URL, got "example.com"'],
        ["theme: @'paper'", 'theme must be essay, bento or mine, got "paper"'],
        ["@toc: 'dots'", `unknown config field "toc"; toc is an option of the essay theme, written as themes.essay.toc, such as themes: { essay: { toc: 'notes' } }`],
        ['themes: @4', 'themes must be an object, got 4'],
        ["home: @'grid'", 'home must be an object, got "grid"'],
        ["categories: @{ ml: 'ML' }", 'categories must be a list, got an object'],
      ],
      [
        ['title: @3', 'title must be a non-empty string, got 3'],
        ['description: @3', 'description must be a non-empty string, got 3'],
        ["url: @'ftp://example.com'", 'url must be an absolute http or https URL, got "ftp://example.com"'],
        ['themes: { bento: @4 }', 'themes.bento must be an object, got 4'],
        ['home: { columns: @6 }', 'home.columns must be 3, 4 or 5, got 6'],
        ["categories: [@'ml']", 'categories[0] must be an object, got "ml"'],
      ],
      [
        ["title: @'a\\x01b'", 'title contains the character U+0001, which the RSS feed and the sitemap cannot hold'],
        ["description: @'a\\uFFFEb'", 'description contains the character U+FFFE, which the RSS feed and the sitemap cannot hold'],
        ['themes: { bento: { columns: @0 } }', 'themes.bento.columns must be between 1 and 6, got 0'],
        ["home: { groupBy: @'year' }", 'home.groupBy must be category or month, got "year"'],
        ["categories: [{ id: @'Machine_Learning', name: 'ML', color: '#000000' }]", 'categories[0].id "Machine_Learning" may only contain lowercase letters, digits and "-"'],
      ],
      [
        ['themes: { bento: { columns: @7 } }', 'themes.bento.columns must be between 1 and 6, got 7'],
        ["categories: [{ id: @7, name: 'ML', color: '#000000' }]", 'categories[0].id must be a string, got 7'],
      ],
      [
        ['themes: { bento: { columns: @100 } }', 'themes.bento.columns must be between 1 and 6, got 100'],
        ["categories: [{ id: 'ml', name: @'', color: '#000000' }]", 'categories[0].name must be a non-empty string, got ""'],
      ],
      [
        ['themes: { bento: { columns: @2.5 } }', 'themes.bento.columns must be a whole number from 1 to 6, got 2.5'],
        ["categories: [{ id: 'ml', name: 'ML', color: @'red' }]", 'categories[0].color must be a hex color in the form #rrggbb, got "red"'],
      ],
      [
        ["themes: { bento: { columns: @'4' } }", 'themes.bento.columns must be a number, got "4"'],
        ["categories: [{ id: 'ml', name: 'ML', color: '#000000', desc: @3 }]", 'categories[0].desc must be a string, got 3'],
      ],
      [
        ["themes: { essay: { toc: @'sidebar' } }", 'themes.essay.toc must be one of notes, tabs, dots or ticks, got "sidebar"'],
        ["home: { groupBy: @'category' }", 'home.groupBy is "category" but bake.config.js defines no categories'],
      ],
    ];
    for (const round of rounds) {
      const lines = problems(t, { 'bake.config.js': config(`  ${base},`, ...round.map(([marked]) => `  ${marked.replace('@', '')},`)) });
      assert.deepEqual(
        lines,
        round.map(([marked, message], index) => `bake.config.js:${index + 3}:${marked.indexOf('@') + 3} ${message}`),
      );
    }
  });

  test('reports a syntax error, an error thrown while importing, a package.json that is CommonJS or has no type, and a default export that is not an object', (t) => {
    assert.deepEqual(problems(t, { 'bake.config.js': 'export default {\n  title: ,\n};\n' }), ['bake.config.js:2:10 Unexpected token']);
    assert.deepEqual(problems(t, { 'bake.config.js': 'export default { title: missingName };\n' }), ['bake.config.js:1:1 missingName is not defined']);
    assert.deepEqual(problems(t, { 'package.json': '{ "type": "commonjs" }\n', 'bake.config.js': `export default { ${base} };\n` }), [
      'bake.config.js:1:1 bake.config.js is an ES module, but package.json sets "type": "commonjs", so Node reads it as CommonJS; set "type": "module" there',
    ]);
    assert.deepEqual(problems(t, { 'package.json': '{ "private": true }\n', 'bake.config.js': `export default { ${base} };\n` }), [
      'bake.config.js:1:1 bake.config.js is an ES module, but package.json has no "type" field, so Node prints a warning while it detects that the file is an ES module; set "type": "module" there',
    ]);
    assert.deepEqual(problems(t, { 'bake.config.js': "const name = 'blog';\nexport default name;\n" }), ['bake.config.js:2:1 the default export of bake.config.js must be an object, got "blog"']);
    assert.deepEqual(problems(t, { 'bake.config.js': 'export const title = 1;\n' }), ['bake.config.js:1:1 the default export of bake.config.js must be an object, got undefined']);
  });

  test('reads bake.config.js next to a package.json with "type": "module" and prints nothing to stderr', (t) => {
    const result = bake(createBlog(t, { 'package.json': '{ "type": "module" }\n', 'bake.config.js': `export default { ${base} };\n` }), 'build');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '0 pages\ndist/ written\n');
  });

  test('reports missing fields, nested values, unknown fields and reused category ids at their own position', (t) => {
    assert.deepEqual(problems(t, { 'bake.config.js': "export default {\n  url: 'https://example.com',\n};\n" }), ['bake.config.js:1:16 config is missing "title"', 'bake.config.js:1:16 config is missing "language"']);
    const nested = config(`  ${base},`, '  home: { columns: 6 },', "  categories: [{ id: 'ml', name: 'ML', color: 'red' }, 'x'],");
    assert.deepEqual(problems(t, { 'bake.config.js': nested }), [
      'bake.config.js:3:20 home.columns must be 3, 4 or 5, got 6',
      'bake.config.js:4:47 categories[0].color must be a hex color in the form #rrggbb, got "red"',
      'bake.config.js:4:56 categories[1] must be an object, got "x"',
    ]);
    const unknown = config(`  ${base},`, '  colour: 1,', '  themes: { bento: { columns: 4, rows: 2 }, paper: {} },', "  categories: [{ id: 'ml', name: 'ML', color: '#000000', icon: 'x' }],");
    assert.deepEqual(problems(t, { 'bake.config.js': unknown }), [
      'bake.config.js:3:3 unknown config field "colour"',
      'bake.config.js:4:34 unknown config field "themes.bento.rows"',
      'bake.config.js:4:45 themes.paper names no theme; the themes are essay, bento, mine',
      'bake.config.js:5:58 unknown config field "categories[0].icon"',
    ]);
    assert.deepEqual(problems(t, { 'bake.config.js': config(`  ${base},`, '  bento: { columns: 4 },') }), ['bake.config.js:3:3 unknown config field "bento"; theme options are written under themes, such as themes: { bento: { columns: 4 } }']);
    const reused = config(`  ${base},`, '  categories: [', "    { id: 'ml', name: 'ML', color: '#000000' },", "    { id: 'ml', name: 'ML again', color: '#ffffff' },", "    { name: 'No id', color: '#ffffff' },", '  ],');
    assert.deepEqual(problems(t, { 'bake.config.js': reused }), ['bake.config.js:5:11 categories[1].id "ml" is already used by categories[0]', 'bake.config.js:6:5 config is missing "categories[2].id"']);
    assert.deepEqual(problems(t, { 'bake.config.js': `const home = { columns: 9 };\nexport default {\n  ${base},\n  home,\n};\n` }), ['bake.config.js:4:3 home.columns must be 3, 4 or 5, got 9']);
  });

  test('gives a theme of the blog the options it declares, with their defaults, and reports wrong values and wrong declarations', (t) => {
    const options = "export const options = { density: { label: 'Density', type: 'enum', options: ['loose', 'tight'], default: 'loose' }, rule: { label: 'Rule', type: 'boolean', default: true } };\n";
    const dir = createBlog(t, {
      'bake.config.js': `export default { ${base}, themes: { mine: { density: 'tight' } } };\n`,
      'themes/mine/options.js': options,
      'themes/mine/page.jsx': 'export default function Page(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props.options)} /></body></html>;\n}\n',
      'themes/mine/client.jsx': '',
      'content/posts/rope/index.md': article({ extra: 'theme: mine\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', extra: 'theme: mine\nrule: false\n' }),
    });
    assert.equal(bake(dir, 'build').stderr, '');
    assert.match(readFileSync(join(dir, 'dist/2026-10/rope/index.html'), 'utf8'), /<script type="application\/json">{"density":"tight","rule":true}<\/script>/);
    assert.match(readFileSync(join(dir, 'dist/2026-10/gelu/index.html'), 'utf8'), /<script type="application\/json">{"density":"tight","rule":false}<\/script>/);
    assert.deepEqual(problems(t, { 'bake.config.js': config(`  ${base},`, "  themes: { mine: { density: 'dense' } },"), 'themes/mine/options.js': options }), [
      'bake.config.js:3:30 themes.mine.density must be one of loose or tight, got "dense"',
    ]);
    const broken = [
      "export const options = { size: { label: 'Size', type: 'number', min: 1, max: 3, default: 5 }, data: { label: 'Data', type: 'file', default: 'a.json' }, plain: { type: 'text', default: '' }, tags: { label: 'Tags', type: 'text', default: '' }, rule: { label: 'Rule', type: 'boolean', default: true } };",
      "export const settings = { font: { values: ['a'], default: 'a', control: 'list' }, Mode: { values: ['a'], default: 'a', control: 'list' }, ink: { values: ['a', 'b', 'c'], default: 'd', control: 'switch' }, rule: { values: ['on'], default: { option: 'rule' }, control: 'list', label: 'Rule' } };",
      '',
    ].join('\n');
    assert.deepEqual(problems(t, { 'bake.config.js': `export default { ${base} };\n`, 'themes/mine/options.js': broken }), [
      'themes/mine/options.js:1:1 mine: the default of option "size" must be between 1 and 3, got 5',
      'themes/mine/options.js:1:1 mine: option "data" has the type "file"; a theme option is set in bake.config.js and cannot name a file of an article',
      'themes/mine/options.js:1:1 mine: option "plain" needs a label, the text shown next to its control',
      'themes/mine/options.js:1:1 mine: option "tags" has the name of the front matter field "tags", so an article could not set it',
      'themes/mine/options.js:1:1 mine: setting "font" uses a name reserved for Bake; a theme cannot declare theme, font, size, weight, spacing, scheme or script',
      'themes/mine/options.js:1:1 mine: setting "Mode" becomes the attribute data-Mode; use lowercase letters and digits, starting with a letter',
      'themes/mine/options.js:1:1 mine: setting "ink" is a switch and needs two values, the value when it is on and the value when it is off',
      'themes/mine/options.js:1:1 mine: the default of setting "ink" must be one of its values, a, b or c, got "d"',
      'themes/mine/options.js:1:1 mine: setting "rule" has the unknown field "label"; the fields of a setting are values, default and control',
      'themes/mine/options.js:1:1 mine: the default of setting "rule" names the option "rule", which must be an enum whose options are values of the setting',
    ]);
  });
});
