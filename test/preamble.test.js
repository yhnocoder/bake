import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePreamble } from '../src/config/preamble.js';
import { formatError } from '../src/report.js';

function read(source) {
  const errors = [];
  const definitions = parsePreamble(source, errors);
  return { definitions, errors: errors.map(formatError) };
}

test('reads macro definitions with their positions and skips comments and package lines', () => {
  const source = [
    '\\ProvidesPackage{preamble}[2026/10/19]',
    '\\RequirePackage{amsmath, amssymb}',
    '% vectors',
    '\\newcommand{\\R}{\\mathbb{R}} % reals',
    '\\renewcommand*\\norm[1]{\\lVert #1 \\rVert}',
    '  \\DeclareMathOperator*{\\argmax}{arg\\,max}',
    '\\def\\pair#1#2{(#1, #2)}',
    '\\let\\eps=\\varepsilon',
    '\\newenvironment{pmat}{\\begin{pmatrix}}{\\end{pmatrix}}',
    '',
  ].join('\n');
  assert.deepEqual(read(source), {
    definitions: [
      { tex: '\\newcommand{\\R}{\\mathbb{R}}', position: { line: 4, column: 1 } },
      { tex: '\\renewcommand*\\norm[1]{\\lVert #1 \\rVert}', position: { line: 5, column: 1 } },
      { tex: '\\DeclareMathOperator*{\\argmax}{arg\\,max}', position: { line: 6, column: 3 } },
      { tex: '\\def\\pair#1#2{(#1, #2)}', position: { line: 7, column: 1 } },
      { tex: '\\let\\eps=\\varepsilon', position: { line: 8, column: 1 } },
      { tex: '\\newenvironment{pmat}{\\begin{pmatrix}}{\\end{pmatrix}}', position: { line: 9, column: 1 } },
    ],
    errors: [],
  });
});

test('reports commands that do not define macros, unknown packages, broken definitions and stray text', () => {
  const { errors } = read('\\usepackage{tikz}\n\\RequirePackage{tikz}\n\\newcommand{\\R}{\\mathbb{R}\nplain text\n\\providecommand{\\x}{y}\n');
  assert.deepEqual(errors, [
    'preamble.sty:1:1 \\usepackage cannot be used in preamble.sty, which accepts \\newcommand, \\renewcommand, \\DeclareMathOperator, \\def, \\let, \\newenvironment, \\renewenvironment, \\ProvidesPackage and \\RequirePackage',
    'preamble.sty:2:1 package "tikz" is not loaded by Bake; \\RequirePackage accepts only the packages Bake always loads: amsmath, amssymb, amsfonts, mathtools, braket, cancel, cases, color, xcolor, gensymb and upgreek',
    'preamble.sty:3:1 cannot read \\newcommand; check its braces and arguments',
    'preamble.sty:4:1 unexpected text "plain text"; preamble.sty may only contain macro definitions',
    'preamble.sty:5:1 \\providecommand cannot be used in preamble.sty, which accepts \\newcommand, \\renewcommand, \\DeclareMathOperator, \\def, \\let, \\newenvironment, \\renewenvironment, \\ProvidesPackage and \\RequirePackage',
  ]);
});
