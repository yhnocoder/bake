import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { readFrontMatter } from '../src/config/front-matter.js';
import { formatError, sortErrors } from '../src/report.js';

const fixturesDir = new URL('./fixtures/syntax-errors/', import.meta.url);
const frontMatterFixtures = ['missing-slug.md', 'invalid-slug.md', 'unknown-front-matter-field.md', 'invalid-toc.md'];
const defaultRules = { themes: ['essay', 'bento'], categories: [], files: [] };

function check(source, rules = {}) {
  const errors = [];
  const result = readFrontMatter('index.md', source, { ...defaultRules, ...rules }, errors);
  return { result, lines: sortErrors(errors).map(formatError) };
}

function withField(line) {
  const required = ['title: Rope', 'slug: rope', 'date: 2026-10-19'].filter((field) => field.split(':')[0] !== line.split(':')[0]);
  return `---\n${[line, ...required].join('\n')}\n---\n\nText.\n`;
}

describe('front matter', () => {
  test('front matter fixtures report the lines in expected.json', () => {
    const expected = JSON.parse(readFileSync(new URL('expected.json', fixturesDir), 'utf8'));
    for (const name of frontMatterFixtures) {
      const errors = [];
      readFrontMatter(name, readFileSync(new URL(name, fixturesDir), 'utf8'), defaultRules, errors);
      assert.deepEqual(errors.map(formatError), [expected[name]], name);
    }
  });

  test('returns the fields with normalized file paths and the slug position', () => {
    const source = '---\ntitle: Rope\nslug: rope\ndate: 2026-10-19\nsummary: Rotary embeddings.\ntags: [LLM, attention]\ncategory: ml\npreview: ./preview.js\ncover: images/cover.png\ntheme: bento\ntoc: dots\ndraft: false\n---\n\nText.\n';
    const { result, lines } = check(source, { categories: ['ml'], files: ['preview.js', 'images/cover.png'] });
    assert.deepEqual(lines, []);
    assert.deepEqual(result.fields, {
      title: 'Rope',
      slug: 'rope',
      date: '2026-10-19',
      summary: 'Rotary embeddings.',
      tags: ['LLM', 'attention'],
      category: 'ml',
      preview: 'preview.js',
      cover: 'images/cover.png',
      theme: 'bento',
      toc: 'dots',
      draft: false,
    });
    assert.deepEqual(result.positions.slug, { line: 3, column: 7 });
  });

  test('accepts CRLF line endings', () => {
    const { lines } = check('---\r\ntitle: Rope\r\nslug: rope\r\ndate: 2026-10-19\r\n---\r\n\r\nText.\r\n');
    assert.deepEqual(lines, []);
  });

  test('reports a file without front matter at 1:1', () => {
    assert.deepEqual(check('# Rope\n').lines, ['index.md:1:1 index.md must start with front matter between two --- lines']);
  });

  test('reports front matter without a closing line at 1:1', () => {
    assert.deepEqual(check('---\ntitle: Rope\n').lines, ['index.md:1:1 front matter has no closing --- line']);
  });

  test('reports a YAML syntax error at its position', () => {
    assert.deepEqual(check(withField('summary: a: b')).lines, ['index.md:2:10 Nested mappings are not allowed in compact mappings']);
  });

  test('reports a repeated field as a YAML error at the second key', () => {
    assert.deepEqual(check('---\ntitle: Rope\nslug: rope\ndate: 2026-10-19\nslug: rope\n---\n').lines, ['index.md:5:1 Map keys must be unique']);
  });

  test('reports front matter that is not a mapping', () => {
    assert.deepEqual(check('---\n- title\n---\n').lines, ['index.md:2:1 front matter must be a mapping of fields']);
  });

  test('reports every missing required field at 1:1', () => {
    assert.deepEqual(check('---\n---\n').lines, [
      'index.md:1:1 front matter is missing "title"',
      'index.md:1:1 front matter is missing "slug"',
      'index.md:1:1 front matter is missing "date"',
    ]);
  });

  test('requires category when bake.config.js defines categories', () => {
    assert.deepEqual(check(withField('summary: x'), { categories: ['ml'] }).lines, ['index.md:1:1 front matter is missing "category"']);
  });

  const valueCases = [
    ['title: @""', [], 'title must be a non-empty string, got ""'],
    ['title: @3', [], 'title must be a non-empty string, got 3'],
    ['slug: @2026', [], 'slug must be a string, got 2026'],
    ['date: @2026-13-01', [], 'date must be a date in the form YYYY-MM-DD, got "2026-13-01"'],
    ['date: @2026-02-30', [], 'date must be a date in the form YYYY-MM-DD, got "2026-02-30"'],
    ['date: @2026-1-5', [], 'date must be a date in the form YYYY-MM-DD, got "2026-1-5"'],
    ['summary: @[a]', [], 'summary must be a string, got a list'],
    ['tags: @LLM', [], 'tags must be a list of strings'],
    ['tags: [LLM, @3]', [], 'tags must be a list of strings'],
    ['category: @ml', [], 'category is set but bake.config.js defines no categories'],
    ['category: @x', ['ml'], 'category "x" is not one of the categories in bake.config.js'],
    ['theme: @paper', [], 'theme must be essay or bento, got "paper"'],
    ['toc: @sidebar', [], 'toc must be notes, tabs, dots or ticks, got "sidebar"'],
    ['draft: @yes', [], 'draft must be true or false, got "yes"'],
    ['draft:@', [], 'draft must be true or false, got an empty value'],
    ['preview: @preview.js', [], 'preview file "preview.js" does not exist'],
    ['preview: @../shared/preview.js', [], 'preview must be the relative path of a file in the article folder, got "../shared/preview.js"'],
    ['cover: @/cover.png', [], 'cover must be the relative path of a file in the article folder, got "/cover.png"'],
    ['cover: @cover.png', [], 'cover file "cover.png" does not exist'],
    ['page: @demo.htm', [], 'page must be the relative path of an .html file in the article folder, got "demo.htm"'],
  ];

  for (const [marked, categories, message] of valueCases) {
    test(`reports ${message} at the value`, () => {
      const field = marked.replace('@', '');
      assert.deepEqual(check(withField(field), { categories }).lines, [`index.md:2:${marked.indexOf('@') + 1} ${message}`]);
    });
  }

  test('reports a page file that does not exist', () => {
    const source = '---\ntitle: Demo\nslug: demo\ndate: 2026-10-19\npage: demo.html\n---\n';
    assert.deepEqual(check(source).lines, ['index.md:5:7 page file "demo.html" does not exist']);
  });

  test('reports a body after front matter with "page" at its first line', () => {
    const source = '---\ntitle: Demo\nslug: demo\ndate: 2026-10-19\npage: demo.html\n---\n\n  Leftover text.\n';
    assert.deepEqual(check(source, { files: ['demo.html'] }).lines, ['index.md:8:3 index.md with "page" must have no body']);
  });

  test('reports an unknown field at its key and keeps checking the others', () => {
    const { lines } = check('---\ntitle: Rope\nslug: Rope\ndate: 2026-10-19\nlayout: wide\n---\n');
    assert.deepEqual(lines, ['index.md:3:7 slug "Rope" may only contain lowercase letters, digits and "-"', 'index.md:5:1 unknown front matter field "layout"']);
  });

  test('lists custom themes in the theme message', () => {
    assert.deepEqual(check(withField('theme: paper'), { themes: ['essay', 'bento', 'mine'] }).lines, ['index.md:2:8 theme must be essay, bento or mine, got "paper"']);
  });
});
