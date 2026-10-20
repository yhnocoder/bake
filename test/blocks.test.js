import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { html, outline, parse, parsed } from './article.js';

describe('tables', () => {
  test('wraps a table in a horizontally scrolling box', async () => {
    assert.equal(
      await html('| a | b |\n|---|--:|\n| 1 | 2 |\n'),
      '<div class="table-scroll"><table>\n<thead>\n<tr>\n<th>a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td align="right">2</td>\n</tr>\n</tbody>\n</table></div>',
    );
  });

  test('renders :::list-table rows with a header row and cells that hold blocks', async () => {
    const article = await parsed('::::{width=page}\n:::list-table\n* - Name\n  - Notes\n* - ReLU\n  - - one\n    - two\n* - GELU\n  - Smooth $x$.\n\n    Second paragraph.\n:::\n::::\n');
    assert.deepEqual([article.intro[0].type, article.intro[0].width], ['list-table', 'page']);
    assert.equal(
      outline(article.intro[0].html),
      '<div class="table-scroll"><table class="list-table"><thead><tr><th>Name</th><th>Notes</th></tr></thead><tbody><tr><td>ReLU</td><td>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n</td></tr><tr><td>GELU</td><td>\n<p>Smooth $x$.</p>\n<p>Second paragraph.</p>\n</td></tr></tbody></table></div>',
    );
  });

  test('reports a :::list-table without one list, a row without cells and a row with another number of cells', async () => {
    assert.deepEqual((await parse(':::list-table\nText.\n:::\n\n:::list-table\n* - a\n* b\n:::\n\n:::list-table\n* - a\n  - b\n* - c\n* - d\n  - e\n  - f\n:::\n')).errors, [
      'index.md:7:1 :::list-table must contain one list whose items are the rows of the table',
      'index.md:13:1 each :::list-table item is a row that holds a list of its cells',
      'index.md:19:1 list-table row 2 has 1 cell, the header row has 2',
      'index.md:20:1 list-table row 3 has 3 cells, the header row has 2',
    ]);
  });
});

describe(':::example', () => {
  test('shows the Markdown source next to the result', async () => {
    const [block] = (await parsed('::::example\n:::aside\n**Bold** and $x$.\n:::\n::::\n')).intro;
    assert.equal(block.type, 'example');
    assert.equal(
      outline(block.html),
      '<div class="example"><div class="example-source">```markdown\n:::aside\n**Bold** and $x$.\n:::\n```</div><div class="example-result">\n<aside class="aside">\n<p><strong>Bold</strong> and $x$.</p>\n</aside>\n</div></div>',
    );
  });

  test('keeps example headings out of the sections, shows recaps in place and numbers notes with the article', async () => {
    const article = await parsed('Body[^a] and \\eqref{eq:b}.\n\n## A\n\n::::example\n### Inner\n\n:::recap\nPoint.\n:::\n\nNote[^b] and\n\n$$\nx \\label{eq:b}\n$$\n\n[^b]: B.\n::::\n\n[^a]: A.\n');
    assert.deepEqual(article.toc, [{ id: 'a', number: '01', title: 'A', recap: undefined, children: [] }]);
    assert.deepEqual(article.sidenotes.map((note) => [note.number, note.html]), [[1, '<p>A.</p>'], [2, '<p>B.</p>']]);
    const example = outline(article.sections[0].blocks[0].html);
    assert.match(example, /<div class="example-result">\n<h3 id="inner">Inner<\/h3>\n<div class="recap">\n<p>Point.<\/p>\n<\/div>\n<p>Note<sup class="sidenote-ref" data-sidenote="2">/);
    assert.match(example, /```markdown\n### Inner\n\n:::recap\nPoint.\n:::\n\nNote\[\^b\] and\n\n\$\$\nx \\label\{eq:b\}\n\$\$\n\n\[\^b\]: B.\n```/);
    assert.match(article.intro[0].html, /<a class="eqref" href="#eq%3Ab">\(1\)<\/a>/);
  });
});

describe('natural width', () => {
  test('gives math and code blocks the natural width a theme needs to pick their width automatically', async () => {
    const source = '$$\nx = y + z\n$$\n\n$$\na \\label{eq:a}\n$$\n\n```python\nprint(1)\n# 注释\n```\n\n:::{width=page}\n```\nx\n```\n:::\n\n| a |\n|---|\n| b |\n';
    const blocks = (await parsed(source)).intro;
    assert.deepEqual(
      blocks.map((block) => [block.type, block.width, block.naturalWidth]),
      [
        ['math', undefined, '9.242ex'],
        ['math', undefined, '10.6ex'],
        ['code', undefined, '8ch'],
        ['code', 'page', '1ch'],
        ['table', undefined, undefined],
      ],
    );
  });

  test('counts the code columns of wide characters with the Unicode East Asian Width table', async () => {
    const blocks = (await parsed('```\n😀😀\n```\n\n```\n𠀀a\n```\n')).intro;
    assert.deepEqual(blocks.map((block) => block.naturalWidth), ['4ch', '3ch']);
  });
});
