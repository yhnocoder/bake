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
    'bake.config.js': config(", themes: { bento: { columns: 5 } }"),
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
  assert.match(html, /<div class="bt-intro"><div class="bk-block" data-type="paragraph" data-line="7" data-end-line="7">.*?<\/div><div class="bt-notes"><aside class="bk-sidenote" id="sidenote-1" data-sidenote="1" data-label="intro" data-line="9" data-end-line="9">/s);
  assert.doesNotMatch(html, /bk-toc/);
  for (const region of ['article', 'words', 'glyphs', 'previews', 'source']) assert.equal(html.split(`data-region="${region}"`).length, 2, region);
  assert.match(html, /<h2 id="plain" data-line="11" data-end-line="11"><span class="bk-chapter-number" data-ui(?:="")?>01<\/span><a class="bk-heading-link" [^>]*data-ui/);
  assert.match(html, /<script type="application\/json" class="bk-source" data-region="source">"---\\ntitle: Cards/);
  assert.match(html, /^<!doctype html>\n?<html lang="en" data-theme="system" data-font="sans"><head>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/2026-10\/cards\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/example.com\/og\/2026-10\/cards-\w+\.png">/);
  assert.match(html, /<button type="button" class="bk-copy-source">/);
});

test('the bento theme writes the homepage, the 404 page and the theme stylesheet when it is the site theme, loads the AI chat, is listed in the chat catalog and reads the column count from bake.config.js', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body: '## One\n\nText.\n' }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<h3 class="bk-card-title">Cards<\/h3>/);
  assert.match(readFileSync(join(dir, 'dist/404.html'), 'utf8'), /<li data-url="2026-10\/cards\/" hidden>/);
  assert.match(readFileSync(join(dir, 'dist/feed.xml'), 'utf8'), /<link>https:\/\/example.com\/2026-10\/cards\/<\/link>/);
  assert.match(readFileSync(join(dir, 'dist/_bake/theme.css'), 'utf8'), /--bg:/);
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<script type="module" src="assets\/chat-[\w-]+\.js">/);
  const page = readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8');
  assert.match(page, /<script type="module" src="\.\.\/\.\.\/assets\/chat-[\w-]+\.js">/);
  assert.equal(readFileSync(join(dir, 'dist/2026-10/cards/index.md'), 'utf8'), readFileSync(join(dir, 'content/posts/cards/index.md'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(dir, 'dist/_bake/articles.json'), 'utf8'));
  assert.deepEqual(
    catalog.articles.map(({ url, source, sections }) => ({ url, source, sections })),
    [{ url: '2026-10/cards/', source: '2026-10/cards/index.md', sections: [{ id: 'one', number: '01', title: 'One', subsections: [] }] }],
  );
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
  assert.match(html, /<span class="bk-heading-text">One<\/span><\/h2><div class="recap bt-recap"><p>The section in short.<\/p><\/div><div class="bk-block" data-type="paragraph" data-line="13" data-end-line="13">/);
  assert.match(html, /<span class="bk-heading-text">Part<\/span><\/h3><div class="recap bt-recap"><p>The part in short.<\/p><\/div><div class="bk-block" data-type="paragraph" data-line="21" data-end-line="21">/);
});

test('the bento theme lists a sidenote that only a recap refers to at the bottom of the card of that recap', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({
      title: 'Cards',
      slug: 'cards',
      body: '## One\n\n:::recap\nThe section in short.[^section]\n:::\n\nText.\n\n### Part\n\n:::recap\nThe part in short.[^part]\n:::\n\nMore text.\n\n## Two\n\nOther text.\n\n[^section]: The section note.\n\n[^part]: The part note.\n',
    }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const html = readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8');
  const cards = html.split('<section class="bt-card"').slice(1);
  assert.equal(cards.length, 2);
  assert.deepEqual([...cards[0].matchAll(/<aside class="bk-sidenote"[^>]*data-label="(\w+)"/g)].map((match) => match[1]), ['section', 'part']);
  assert.doesNotMatch(cards[1], /<aside class="bk-sidenote"/);
});
