import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { html, outline, parse, parsed } from './article.js';

const preamble = [{ tex: '\\newcommand{\\R}{\\mathbb{R}}', position: { line: 4, column: 1 } }];

describe('math', () => {
  test('typesets inline and display math into SVG and keeps the TeX source', async () => {
    const [paragraph, display] = (await parsed('Let $x_1$ be.\n\n$$\n\\sum_i a_i\n$$\n')).intro;
    assert.match(paragraph.html, /^<p>Let <mjx-container class="MathJax" jax="SVG" [^>]*data-tex="x_1"><svg [^>]*>.*<\/svg><\/mjx-container> be\.<\/p>$/s);
    assert.equal(display.type, 'math');
    assert.match(display.html, /^<mjx-container class="MathJax" jax="SVG" [^>]*display="true"[^>]*data-tex="\\sum_i a_i"><svg /);
    assert.doesNotMatch(paragraph.html + display.html, /data-latex|<code|merror/);
  });

  test('numbers labeled display formulas and links \\eqref in text and in formulas, also before the label', async () => {
    const article = await parsed('See \\eqref{eq:b} and $\\eqref{eq:a}$.\n\n$$\nx \\label{eq:a}\n$$\n\n$$\ny\n$$\n\n$$\nz \\label{eq:b}\n$$\n');
    assert.equal(outline(article.intro[0].html), '<p>See <a class="eqref" href="#eq%3Ab">(2)</a> and $\\eqref{eq:a}$.</p>');
    assert.match(article.intro[0].html, /<a href="#eq%3Aa">/);
    assert.match(article.intro[1].html, /id="eq:a"/);
    assert.doesNotMatch(article.intro[2].html, /id="eq:/);
    assert.match(article.intro[3].html, /id="eq:b"/);
  });

  test('numbers formulas that use a numbered environment of their own', async () => {
    const article = await parsed('$$\n\\begin{align}\na \\label{eq:a} \\\\\nb \\label{eq:b}\n\\end{align}\n$$\n\n\\eqref{eq:b}\n');
    assert.equal(article.intro[1].html, '<p><a class="eqref" href="#eq%3Ab">(2)</a></p>');
  });

  test('reports \\eqref to an unknown label in text and in a formula', async () => {
    assert.deepEqual((await parse('$$\nx \\label{eq:ffn}\n$$\n\nSee \\eqref{eq:fnn} and $\\eqref{eq:fn}$.\n')).errors, [
      'index.md:11:5 \\eqref{eq:fnn} refers to an unknown \\label',
      'index.md:11:24 \\eqref{eq:fn} refers to an unknown \\label',
    ]);
  });

  test('reports formulas that MathJax cannot typeset at their position', async () => {
    assert.deepEqual((await parse('A $\\foo$ and\n\n$$\n\\frac{1}{\n$$\n')).errors, [
      'index.md:7:3 MathJax cannot typeset this formula: Undefined control sequence \\foo',
      'index.md:9:1 MathJax cannot typeset this formula: Missing close brace',
    ]);
  });

  test('uses the macros from preamble.sty and keeps macros defined in one article out of the next', async () => {
    assert.equal(await html('$x \\in \\R$\n', { preamble }), '<p>$x \\in \\R$</p>');
    assert.deepEqual((await parse('$\\R$\n')).errors, ['index.md:7:1 MathJax cannot typeset this formula: Undefined control sequence \\R']);
    await parsed('$\\newcommand{\\Q}{\\mathbb{Q}}\\Q$\n');
    assert.deepEqual((await parse('$\\Q$\n')).errors, ['index.md:7:1 MathJax cannot typeset this formula: Undefined control sequence \\Q']);
  });

  test('reports an anchor that is also the id of a labeled formula', async () => {
    assert.deepEqual((await parse('## A {#eq:a}\n\n$$\nx \\label{eq:a}\n$$\n')).errors, ['index.md:7:6 anchor "eq:a" is also the id of the equation \\label{eq:a}']);
  });

  test('keeps | inside $…$ in a table cell and still splits cells at | in code', async () => {
    const [table] = (await parsed('| a | b |\n|---|---|\n| $|x|_1$ | `c` |\n| $$|y|$$ | \\$ |\n')).intro;
    assert.equal(
      outline(table.html),
      '<div class="table-scroll"><table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>$|x|_1$</td>\n<td><code>c</code></td>\n</tr>\n<tr>\n<td>$|y|$</td>\n<td>$</td>\n</tr>\n</tbody>\n</table></div>',
    );
  });
});
