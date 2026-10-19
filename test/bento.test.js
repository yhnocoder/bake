import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog } from './blog.js';

const config = (extra) => `export default { title: 'Test Blog', url: 'https://example.com', language: 'en', theme: 'bento'${extra} };\n`;

const body = `An intro with a note.[^intro]

[^intro]: The intro note.

## Plain

Text with a note.[^plain]

[^plain]: The plain note, which refers to another.[^nested]

[^nested]: The nested note.

## Body {width=body}

Text.

## Wide {width=wide}

Text.

## Page {width=page}

$$
x^2
$$

## Wide block

:::{width=wide}
\`\`\`text
wide
\`\`\`
:::

## Page block

:::{width=page}
\`\`\`text
page
\`\`\`
:::
`;

function cards(html) {
  return html
    .split('<section class="bt-card"')
    .slice(1)
    .map((card) => ({
      span: /^ data-span="([^"]+)"/.exec(card)[1],
      title: /<span class="bk-heading-text">([^<]*)<\/span>/.exec(card)[1],
      notes: [...card.matchAll(/<aside class="bk-sidenote"[^>]*data-sidenote="(\d+)"/g)].map(([, number]) => Number(number)),
      notesLast: /<div class="bt-notes">(?:(?!<\/aside><\/div>).)*<\/aside><\/div><\/section>/s.test(card),
    }));
}

test('the bento theme renders each ## section as a card whose span follows its width', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(", bento: { columns: 5 }"),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const html = readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8');
  assert.deepEqual(
    cards(html).map(({ title, span, notes }) => ({ title, span, notes })),
    [
      { title: 'Plain', span: 'auto', notes: [2, 3] },
      { title: 'Body', span: '1', notes: [] },
      { title: 'Wide', span: '2', notes: [] },
      { title: 'Page', span: 'page', notes: [] },
      { title: 'Wide block', span: '2', notes: [] },
      { title: 'Page block', span: 'page', notes: [] },
    ],
  );
  assert.ok(cards(html)[0].notesLast);
  assert.match(html, /<div class="bt-grid" data-columns="5" style="--bt-columns:5;--bt-columns-narrow:2">/);
  assert.match(html, /<div class="bt-intro"><div class="bk-block" data-type="paragraph" data-line="7">.*?<\/div><div class="bt-notes"><aside class="bk-sidenote" id="sidenote-1" data-sidenote="1" data-line="9">/s);
  assert.doesNotMatch(html, /bk-toc/);
  for (const region of ['article', 'words', 'glyphs', 'previews']) assert.equal(html.split(`data-region="${region}"`).length, 2, region);
  assert.match(html, /<h2 id="plain" data-line="11">/);
});

test('the bento theme writes the homepage when it is the site theme and reads the column count from bake.config.js', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body: '## One\n\nText.\n' }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<h3 class="bk-card-title">Cards<\/h3>/);
  assert.match(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'), /<div class="bt-grid" data-columns="4" style="--bt-columns:4;--bt-columns-narrow:2">/);
});

test('the bento theme shows the recap of a section under the card title and the recap of a subsection under its heading', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({
      title: 'Cards',
      slug: 'cards',
      body: '## One\n\n:::recap\nThe section in short.\n:::\n\nText.\n\n### Part\n\n:::recap\nThe part in short.\n:::\n\nMore text.\n',
    }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const html = readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8');
  assert.match(html, /<span class="bk-heading-text">One<\/span><\/h2><div class="recap bt-recap"><p>The section in short.<\/p><\/div><div class="bk-block" data-type="paragraph" data-line="13">/);
  assert.match(html, /<span class="bk-heading-text">Part<\/span><\/h3><div class="recap bt-recap"><p>The part in short.<\/p><\/div><div class="bk-block" data-type="paragraph" data-line="21">/);
});
