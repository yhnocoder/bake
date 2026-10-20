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

  test('numbers a labeled display formula like an equation environment, where \\tag replaces the number and \\notag removes it', async () => {
    const source = '\\eqref{eq:a} \\eqref{eq:b}\n\n$$\nx \\label{eq:a}\n$$\n\n$$\ny \\label{eq:b} \\tag{B}\n$$\n\n$$\nz \\label{eq:c} \\notag\n$$\n';
    const { article, errors } = await parse(source);
    assert.deepEqual(errors, ['index.md:17:1 \\label{eq:c} is not on a numbered equation; it is inside a starred environment or on a \\notag line']);
    assert.equal(outline(article.intro[0].html), '<p><a class="eqref" href="#eq%3Aa">(1)</a> <a class="eqref" href="#eq%3Ab">(B)</a></p>');
    assert.doesNotMatch(article.intro[3].html, /mlabeledtr/);
  });

  test('reports \\eqref to an unknown label in text and in a formula', async () => {
    assert.deepEqual((await parse('$$\nx \\label{eq:ffn}\n$$\n\nSee \\eqref{eq:fnn} and $\\eqref{eq:fn}$.\n')).errors, [
      'index.md:11:5 \\eqref{eq:fnn} refers to an unknown \\label',
      'index.md:11:24 \\eqref{eq:fn} refers to an unknown \\label',
    ]);
  });

  test('ignores \\label inside a TeX comment and leaves the formula unnumbered', async () => {
    const article = await parsed('$$\na = b % see \\label{x} later\n$$\n\n$$\nc \\label{y} % numbered\n$$\n');
    assert.doesNotMatch(article.intro[0].html, /mlabeledtr| id="/);
    assert.match(article.intro[1].html, /data-mml-node="mlabeledtr"/);
    assert.match(article.intro[1].html, / id="y"/);
  });

  test('does not report \\eqref and \\ref inside a TeX comment', async () => {
    assert.deepEqual((await parse('$$\na = b % \\eqref{nowhere} and \\ref{elsewhere}\n$$\n')).errors, []);
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

  test('writes the glyph paths once per article and none for an article without math', async () => {
    const article = await parsed('$x$ and $x^2$\n\n$$\nx + 1\n$$\n');
    const html = article.intro.map((block) => block.html).join('');
    assert.doesNotMatch(html, /<defs>|<path/);
    const used = new Set([...html.matchAll(/<use [^>]*href="#([^"]+)"/g)].map(([, id]) => id));
    const defined = new Set([...article.glyphs.matchAll(/<path id="([^"]+)"/g)].map(([, id]) => id));
    assert.match(article.glyphs, /^<svg style="display: none;" xmlns="http:\/\/www.w3.org\/2000\/svg" id="MJX-SVG-global-cache"><defs>/);
    assert.ok(used.size > 0);
    assert.deepEqual([...used].filter((id) => !defined.has(id)), []);
    assert.equal(defined.size, used.size);
    assert.equal((await parsed('No math.\n')).glyphs, undefined);
  });

  test('gives numbered formulas without a label the id eq- and their number', async () => {
    const article = await parsed('$$\n\\begin{align}\na \\\\\nb \\label{eq:b}\n\\end{align}\n$$\n');
    assert.deepEqual([...article.intro[0].html.matchAll(/ id="([^"]*)"/g)].map(([, id]) => id), ['eq-1', 'eq:b']);
  });

  test('reports anchors and labels that take the id of an unlabeled formula', async () => {
    const source = '$$\n\\begin{align}\na \\\\\nb\n\\end{align}\n$$\n\nText. ^eq-1\n\n$$\nc \\label{eq-2}\n$$\n';
    assert.deepEqual((await parse(source)).errors, [
      'index.md:14:7 anchor "eq-1" is also the id of the equation (1)',
      'index.md:16:1 two equations have the id "eq-2"; the first is at 7:1',
    ]);
  });

  test('reports \\label in inline math, an empty \\label and a \\label on an unnumbered line', async () => {
    const source = 'See $a \\label{inline}$ and \\eqref{inline}.\n\n$$\nb \\label{}\n$$\n\n$$\n\\begin{align*}\nc \\label{starred}\n\\end{align*}\n$$\n';
    assert.deepEqual((await parse(source)).errors, [
      'index.md:7:5 \\label{inline} only works in a display formula between $$ lines',
      'index.md:9:1 \\label{} needs a name, for example \\label{eq:ffn}',
      'index.md:13:1 \\label{starred} is not on a numbered equation; it is inside a starred environment or on a \\notag line',
    ]);
  });

  test('keeps | inside $…$ in a table cell and still splits cells at | in code', async () => {
    const [table] = (await parsed('| a | b |\n|---|---|\n| $|x|_1$ | `c` |\n| $$|y|$$ | \\$ |\n')).intro;
    assert.equal(
      outline(table.html),
      '<div class="table-scroll"><table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>$|x|_1$</td>\n<td><code>c</code></td>\n</tr>\n<tr>\n<td>$|y|$</td>\n<td>$</td>\n</tr>\n</tbody>\n</table></div>',
    );
  });

  test('publishes a private-use character of the article unchanged next to | inside $…$ on a table line', async () => {
    assert.equal(
      await html('Icon  here.\n\n| a | b |\n|---|---|\n|  | $|x|$ |\n'),
      '<p>Icon  here.</p>\n<div class="table-scroll"><table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td></td>\n<td>$|x|$</td>\n</tr>\n</tbody>\n</table></div>',
    );
  });

  test('keeps | inside $…$ in the attributes of a block', async () => {
    const article = await parsed(':::fold{title="$|x|$ fold"}\nbody\n:::\n\n:::act-fn-plot{fn="$|x|$"}\n:::\n', { components: new Map([['act-fn-plot', { valid: false }]]) });
    assert.match(article.intro[0].html, /<summary>\$\|x\|\$ fold<\/summary>/);
    assert.deepEqual(article.intro[1].attributes, { fn: '$|x|$' });
  });

  test('reports | inside $…$ on a table line of an article that uses every private-use character', async () => {
    const every = Array.from({ length: 0xf8ff - 0xe000 + 1 }, (_, index) => String.fromCharCode(0xe000 + index)).join('');
    assert.deepEqual((await parse(`${every}\n\n| a |\n|---|\n| $|x|$ |\n`)).errors, [
      'index.md:11:1 | inside $…$ cannot be read on this line, because the article uses every private-use character from U+E000 to U+F8FF and Bake needs one that it does not use',
    ]);
  });
});
