import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const { blockNameAt, completionsAt } = createRequire(import.meta.url)('../editors/vscode/completions.js');

const blocks = [
  { name: 'aside', kind: 'built-in', attributes: { title: { type: 'text', label: 'text in quotes, for example title="Notes"' } } },
  { name: 'note', kind: 'theme', attributes: { color: { type: 'enum', options: ['yellow', 'green'] } } },
  {
    name: 'act-fn-plot',
    kind: 'component',
    attributes: {
      fn: { label: 'Function', type: 'enum', options: ['gelu', 'silu'], default: 'gelu' },
      range: { label: 'Range', type: 'number', min: 1, max: 10, default: 4 },
      grid: { label: 'Grid', type: 'boolean', default: true },
    },
  },
  { name: 'recap', kind: 'built-in', attributes: {} },
];

const image = {
  width: { type: 'text', label: 'image width in pixels such as 560px or as a percentage of the text column such as 70%' },
  float: { type: 'enum', options: ['left', 'right'] },
};
const headings = { toc: { type: 'text' }, cols: { type: 'number', min: 1, max: 6, depth: 2 } };
const frontMatter = {
  title: { type: 'text', label: 'article title' },
  date: { type: 'date' },
  tags: { type: 'list' },
  draft: { type: 'boolean' },
  toc: { label: 'Table of contents style', type: 'enum', options: ['notes', 'dots', 'ticks'], default: 'notes' },
};

function complete(lines, cursorLine, character = lines[cursorLine].length) {
  return completionsAt(lines.join('\n'), cursorLine, character, { blocks, image, headings, frontMatter });
}

describe('VS Code completions', () => {
  test('list the blocks after :::, put the cursor in the braces of a block with attributes and add the closing line before an empty line', () => {
    const found = complete(['Text.', '', ':::', ''], 2);
    assert.deepEqual(
      found.map(({ label, detail, snippet, from, suggest }) => ({ label, detail, snippet, from, suggest })),
      [
        { label: 'aside', detail: 'block of Bake', snippet: 'aside{$1}\n$0\n:::', from: 3, suggest: true },
        { label: 'note', detail: 'block of the theme', snippet: 'note{$1}\n$0\n:::', from: 3, suggest: true },
        { label: 'act-fn-plot', detail: 'component', snippet: 'act-fn-plot{$1}\n$0\n:::', from: 3, suggest: true },
        { label: 'recap', detail: 'block of Bake', snippet: 'recap\n$0\n:::', from: 3, suggest: false },
      ],
    );
    assert.deepEqual(
      complete(['> ::::act', '> Text.'], 0).map(({ snippet, from }) => ({ snippet, from })),
      blocks.map((block) => ({ snippet: block.name === 'recap' ? 'recap' : `${block.name}{$1}`, from: 6 })),
    );
    assert.equal(complete(['> :::', ''], 0)[0].snippet, 'aside{$1}\n> $0\n> :::');
  });

  test('offer nothing for the ::: line that closes an open block or for ::: inside a code block', () => {
    assert.deepEqual(complete([':::aside', 'Text.', ':::'], 2), []);
    assert.equal(complete(['```markdown', ':::aside', '```', '', ':::'], 4).length, blocks.length);
    assert.deepEqual(complete(['```markdown', ':::'], 1), []);
    assert.deepEqual(complete(['Text ::: more'], 0, 8), []);
  });

  test('list the attributes of the block that are not written yet, with a snippet for their type', () => {
    const found = complete([':::act-fn-plot{fn=silu '], 0);
    assert.deepEqual(
      found.map(({ label, snippet }) => ({ label, snippet })),
      [
        { label: 'range', snippet: 'range=${1:4}' },
        { label: 'grid', snippet: 'grid=${1|true,false|}' },
      ],
    );
    assert.equal(found[0].documentation, 'number, from 1 to 10, default 4');
    assert.deepEqual(
      complete([':::aside{ti'], 0).map(({ label, snippet, from }) => ({ label, snippet, from })),
      [{ label: 'title', snippet: 'title="$1"', from: 9 }],
    );
    assert.deepEqual(complete([':::unknown-plot{'], 0), []);
  });

  test('list the attributes of an image and those of a heading at its depth', () => {
    assert.deepEqual(complete(['![ReLU](relu.png "The ReLU function"){'], 0).map(({ label, snippet }) => ({ label, snippet })), [
      { label: 'width', snippet: 'width="$1"' },
      { label: 'float', snippet: 'float=${1|left,right|}' },
    ]);
    assert.deepEqual(complete(['![ReLU](relu.png){float=r'], 0).map(({ label }) => label), ['left', 'right']);
    assert.deepEqual(complete(['## Activation functions {#act-fns '], 0).map(({ label }) => label), ['toc', 'cols']);
    assert.deepEqual(complete(['### GELU {'], 0).map(({ label }) => label), ['toc']);
  });

  test('list the options of an enum or boolean attribute after =', () => {
    assert.deepEqual(
      complete([':::act-fn-plot{fn=s'], 0).map(({ label, from }) => ({ label, from })),
      [
        { label: 'gelu', from: 18 },
        { label: 'silu', from: 18 },
      ],
    );
    assert.deepEqual(complete([':::note{color="'], 0).map(({ label, from }) => ({ label, from })), [
      { label: 'yellow', from: 14 },
      { label: 'green', from: 14 },
    ]);
    assert.deepEqual(complete([':::act-fn-plot{range='], 0), []);
  });

  test('list the blocks and Markdown snippets after / at the start of a line and the inline snippets after / in the text', () => {
    const atStart = complete(['Text.', '', '/ma'], 2);
    assert.deepEqual(atStart.map(({ label }) => label), ['aside', 'note', 'act-fn-plot', 'recap', 'heading', 'subheading', 'math', 'code', 'table', 'image', 'width', 'citation', 'footnote', 'eqref', 'inline-math', 'highlight', 'link']);
    assert.ok(atStart.every(({ from, filter, label }) => from === 0 && filter === `/${label}`));
    const byLabel = new Map(atStart.map((item) => [item.label, item]));
    assert.equal(byLabel.get('act-fn-plot').snippet, ':::act-fn-plot{$1}\n$0\n:::');
    assert.equal(byLabel.get('math').snippet, '$$\n$0\n$$');
    assert.equal(byLabel.get('citation').suggest, true);
    assert.equal(complete(['> /'], 0).find(({ label }) => label === 'math').snippet, '$$\n> $0\n> $$');
    const inline = complete(['梯度的公式/ci'], 0);
    assert.deepEqual(inline.map(({ label }) => label), ['citation', 'footnote', 'eqref', 'inline-math', 'highlight', 'link']);
    assert.ok(inline.every(({ from }) => from === 5));
    assert.equal(inline.find(({ label }) => label === 'eqref').snippet, '\\\\eqref{$1}');
    assert.deepEqual(complete(['See https://example.com/a'], 0), []);
    assert.deepEqual(complete(['A ratio a/b'], 0), []);
    assert.deepEqual(complete(['```sh', 'cd /'], 1), []);
  });

  test('list the front matter fields that are not written yet and the values of an enum or boolean field', () => {
    const article = ['---', 'title: GELU', 't', '---', '', 'Text.'];
    assert.deepEqual(
      complete(article, 2).map(({ label, snippet, from }) => ({ label, snippet, from })),
      [
        { label: 'date', snippet: 'date: ${1:$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE}', from: 0 },
        { label: 'tags', snippet: 'tags: [$1]', from: 0 },
        { label: 'draft', snippet: 'draft: ${1|true,false|}', from: 0 },
        { label: 'toc', snippet: 'toc: ${1|notes,dots,ticks|}', from: 0 },
      ],
    );
    assert.deepEqual(complete(['---', 'toc: d'], 1).map(({ label, from }) => ({ label, from })), [
      { label: 'notes', from: 5 },
      { label: 'dots', from: 5 },
      { label: 'ticks', from: 5 },
    ]);
    assert.deepEqual(complete(['---', 'title: The /', '---'], 1), []);
    assert.equal(complete(['---', 'title: GELU', '---', '/'], 3).length > 0, true);
  });

  test('find the name of the block on a ::: line under the cursor, outside code blocks', () => {
    assert.deepEqual(blockNameAt(['Text.', '> :::act-fn-plot{fns=gelu}', ':::'].join('\n'), 1, 8), { name: 'act-fn-plot', from: 5, to: 16 });
    assert.equal(blockNameAt(':::act-fn-plot{fns=gelu}', 0, 20), null);
    assert.equal(blockNameAt('See act-fn-plot.', 0, 6), null);
    assert.equal(blockNameAt(['```markdown', ':::act-fn-plot'].join('\n'), 1, 6), null);
  });

  test('list the references, footnotes and equation labels of the article', () => {
    const article = [
      'As shown [@sha',
      'See the note[^',
      'By \\eqref{',
      '',
      '$$',
      'y = x \\label{eq:ffn}',
      '$$',
      '',
      '[^gemm]: The epilogue of a kernel.',
      '',
      ':::references',
      '- [@shazeer2020] Shazeer. *GLU Variants Improve Transformer*. 2020.',
      '- [@vaswani2017] Vaswani et al. 2017.',
      ':::',
    ];
    assert.deepEqual(
      complete(article, 0).map(({ label, detail, from }) => ({ label, detail, from })),
      [
        { label: 'shazeer2020', detail: 'Shazeer. *GLU Variants Improve Transformer*. 2020.', from: 11 },
        { label: 'vaswani2017', detail: 'Vaswani et al. 2017.', from: 11 },
      ],
    );
    assert.deepEqual(
      complete(article, 1).map(({ label, detail }) => ({ label, detail })),
      [{ label: 'gemm', detail: 'The epilogue of a kernel.' }],
    );
    assert.deepEqual(
      complete(article, 2).map(({ label }) => label),
      ['eq:ffn'],
    );
  });
});
