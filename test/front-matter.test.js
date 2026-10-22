import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bake, createBlog, validConfig } from './blog.js';

const categoriesConfig = validConfig.replace("language: 'en'", "language: 'en', categories: [{ id: 'ml', name: 'ML', color: '#2a78d6' }]");

function withField(line, slug) {
  const required = ['title: Rope', `slug: ${slug}`, 'date: 2026-10-19'].filter((field) => field.split(':')[0] !== line.split(':')[0]);
  return `---\n${[line, ...required].join('\n')}\n---\n\nText.\n`;
}

function problems(t, files) {
  const result = bake(createBlog(t, files), 'build');
  assert.equal(result.status, 1);
  return result.stderr.trimEnd().split('\n').slice(0, -1);
}

function articles(sources) {
  return Object.fromEntries(Object.entries(sources).map(([name, source]) => [`content/posts/${name}/index.md`, source]));
}

describe('front matter', () => {
  test('reports each problem of a front matter field at its value', (t) => {
    const cases = [
      ['title: @""', 'title must be a non-empty string, got ""'],
      ['title: @3', 'title must be a non-empty string, got 3'],
      ['slug: @2026', 'slug must be a string, got 2026'],
      ['slug: @Rope', 'slug "Rope" may only contain lowercase letters, digits and "-"'],
      ['date: @2026-13-01', 'date must be a date in the form YYYY-MM-DD, got "2026-13-01"'],
      ['date: @2026-02-30', 'date must be a date in the form YYYY-MM-DD, got "2026-02-30"'],
      ['date: @2026-1-5', 'date must be a date in the form YYYY-MM-DD, got "2026-1-5"'],
      ['summary: @[a]', 'summary must be a string, got a list'],
      ['summary: @a: b', 'Nested mappings are not allowed in compact mappings'],
      ['title: @"a\\x01b"', 'title contains the character U+0001, which the RSS feed and the sitemap cannot hold'],
      ['summary: @"a\\x1Fb"', 'summary contains the character U+001F, which the RSS feed and the sitemap cannot hold'],
      ['tags: [LLM, @"a\\x0Bb"]', 'tags contains the character U+000B, which the RSS feed and the sitemap cannot hold'],
      ['tags: @LLM', 'tags must be a list of strings'],
      ['tags: [LLM, @3]', 'tags must be a list of strings'],
      ['category: @ml', 'category is set but bake.config.js defines no categories'],
      ['theme: @paper', 'theme must be essay, bento or mine, got "paper"'],
      ['toc: @sidebar', 'toc must be one of notes, dots or ticks, got "sidebar"'],
      ['draft: @yes', 'draft must be true or false, got "yes"'],
      ['draft:@', 'draft must be true or false, got an empty value'],
      ['preview: @preview.js', 'preview file "preview.js" does not exist'],
      ['preview: @../shared/preview.js', 'preview must be the relative path of a file in the article folder, got "../shared/preview.js"'],
      ['cover: @/cover.png', 'cover must be the relative path of a file in the article folder, got "/cover.png"'],
      ['cover: @cover.png', 'cover file "cover.png" does not exist'],
      ['page: @demo.htm', 'page must be the relative path of an .html file in the article folder, got "demo.htm"'],
      ['page: @demo.html', 'page file "demo.html" does not exist'],
      ['@layout: wide', 'unknown front matter field "layout"'],
    ];
    const lines = problems(t, {
      'bake.config.js': validConfig,
      'themes/mine/page.jsx': 'export default function Page() {\n  return <html />;\n}\n',
      'themes/mine/client.jsx': 'export default () => () => {};\n',
      ...articles(Object.fromEntries(cases.map(([marked], index) => [`case-${index}`, withField(marked.replace('@', ''), `case-${index}`)]))),
    });
    assert.deepEqual(
      lines,
      cases.map(([marked, message], index) => `content/posts/case-${index}/index.md:2:${marked.indexOf('@') + 1} ${message}`).sort(),
    );
  });

  test('reports a file without front matter or a closing line, a repeated field, a list, missing fields and a body next to "page"', (t) => {
    const lines = problems(t, {
      'bake.config.js': validConfig,
      ...articles({
        heading: 'Rope\n',
        open: '---\ntitle: Rope\n',
        repeated: '---\ntitle: Rope\nslug: repeated\ndate: 2026-10-19\nslug: repeated\n---\n',
        list: '---\n- title\n---\n',
        empty: '---\n---\n',
        page: '---\ntitle: Demo\nslug: demo\ndate: 2026-10-19\npage: demo.html\n---\n\n  Leftover text.\n',
        crlf: '---\r\ntitle: Rope\r\nslug: crlf\r\ndate: 2026-10-19\r\n---\r\n\r\nText.\r\n',
      }),
      'content/posts/page/demo.html': '<p>demo</p>\n',
    });
    assert.deepEqual(lines, [
      'content/posts/empty/index.md:1:1 front matter is missing "title"',
      'content/posts/empty/index.md:1:1 front matter is missing "slug"',
      'content/posts/empty/index.md:1:1 front matter is missing "date"',
      'content/posts/heading/index.md:1:1 index.md must start with front matter between two --- lines',
      'content/posts/list/index.md:2:1 front matter must be a mapping of fields',
      'content/posts/open/index.md:1:1 front matter has no closing --- line',
      'content/posts/page/index.md:8:3 index.md with "page" must have no body',
      'content/posts/repeated/index.md:5:1 Map keys must be unique',
    ]);
  });

  test('accepts every field and checks the category against bake.config.js', (t) => {
    const every = '---\ntitle: Rope\nslug: rope\ndate: 2026-10-19\nsummary: Rotary embeddings.\ntags: [LLM, attention]\ncategory: ml\npreview: ./preview.js\ncover: images/cover.svg\ntheme: bento\ncolumns: 4\ndraft: false\n---\n\nText.\n';
    const lines = problems(t, {
      'bake.config.js': categoriesConfig,
      ...articles({ every, missing: withField('summary: x', 'missing'), other: withField('category: x', 'other'), bento: withField('category: ml\ntheme: bento\ntoc: dots', 'bento') }),
      'content/posts/every/preview.js': 'export default () => ({ start() {}, stop() {} });\n',
      'content/posts/every/images/cover.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>\n',
    });
    assert.deepEqual(lines, [
      'content/posts/bento/index.md:4:1 unknown front matter field "toc"; it is an option of the essay theme, and this article uses the bento theme',
      'content/posts/other/index.md:2:11 category "x" is not one of the categories in bake.config.js',
    ]);
  });
});
