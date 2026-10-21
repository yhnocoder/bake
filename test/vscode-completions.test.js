import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const { completionsAt } = createRequire(import.meta.url)('../editors/vscode/completions.js');

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
];

function complete(lines, cursorLine, character = lines[cursorLine].length) {
  return completionsAt(lines.join('\n'), cursorLine, character, blocks);
}

describe('VS Code completions', () => {
  test('list the blocks after ::: and add the closing line before an empty line', () => {
    const found = complete(['Text.', '', ':::', ''], 2);
    assert.deepEqual(
      found.map(({ label, detail, snippet, from }) => ({ label, detail, snippet, from })),
      [
        { label: 'aside', detail: 'block of Bake', snippet: 'aside\n$0\n:::', from: 3 },
        { label: 'note', detail: 'block of the theme', snippet: 'note\n$0\n:::', from: 3 },
        { label: 'act-fn-plot', detail: 'component', snippet: 'act-fn-plot\n$0\n:::', from: 3 },
      ],
    );
    assert.deepEqual(
      complete(['> ::::act', '> Text.'], 0).map(({ snippet, from }) => ({ snippet, from })),
      blocks.map((block) => ({ snippet: block.name, from: 6 })),
    );
  });

  test('offer nothing for the ::: line that closes an open block or for ::: inside a code block', () => {
    assert.deepEqual(complete([':::aside', 'Text.', ':::'], 2), []);
    assert.equal(complete(['```markdown', ':::aside', '```', '', ':::'], 4).length, 3);
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
