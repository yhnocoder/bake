import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { article, bake, createBlog } from './blog.js';
import { withoutCopySource } from './article.js';

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

## Set {cols=3 rows=12}

Text.

## Too wide {cols=6}

Text.
`;

function cards(html) {
  return html
    .split('<section class="bt-card"')
    .slice(1)
    .map((card) => ({
      span: /^ data-span="([^"]+)"/.exec(card)[1],
      columns: Number(/--bt-span:(\d+)/.exec(card)[1]),
      rows: /data-rows="(\d+)"/.exec(card)?.[1],
      title: /<span class="bk-heading-text">([^<]*)<\/span>/.exec(card)[1],
      notes: [...card.matchAll(/<aside class="bk-sidenote"[^>]*data-sidenote="(\d+)"/g)].map(([, number]) => Number(number)),
      notesLast: /<div class="bt-notes">(?:(?!<\/aside><\/div>).)*<\/aside><\/div><\/section>/s.test(card),
    }));
}

test('the bento theme renders each ## section as a card whose span follows its cols and rows or its width', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(", themes: { bento: { columns: 5 } }"),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'));
  assert.deepEqual(
    cards(html).map(({ title, span, columns, rows, notes }) => ({ title, span, columns, rows, notes })),
    [
      { title: 'Plain', span: 'auto', columns: 2, rows: undefined, notes: [2, 3] },
      { title: 'Body', span: 'body', columns: 2, rows: undefined, notes: [] },
      { title: 'Wide', span: 'wide', columns: 3, rows: undefined, notes: [] },
      { title: 'Page', span: 'page', columns: 5, rows: undefined, notes: [] },
      { title: 'Wide block', span: 'wide', columns: 3, rows: undefined, notes: [] },
      { title: 'Page block', span: 'page', columns: 5, rows: undefined, notes: [] },
      { title: 'Set', span: 'cols', columns: 3, rows: '12', notes: [] },
      { title: 'Too wide', span: 'cols', columns: 5, rows: undefined, notes: [] },
    ],
  );
  assert.ok(cards(html)[0].notesLast);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/2026-10\/cards\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/example.com\/og\/2026-10\/cards-\w+\.png">/);
});

test('the bento theme writes the homepage, the 404 page and the theme stylesheet when it is the site theme, loads the AI chat, is listed in the chat catalog and reads the column count and the row height from bake.config.js', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(", themes: { bento: { columns: 4, rowHeight: 30 } }"),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body: '## One\n\nText.\n' }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<h3 class="bk-card-title">Cards<\/h3>/);
  assert.match(readFileSync(join(dir, 'dist/404.html'), 'utf8'), /<li data-url="2026-10\/cards\/" hidden>/);
  assert.match(readFileSync(join(dir, 'dist/feed.xml'), 'utf8'), /<link>https:\/\/example.com\/2026-10\/cards\/<\/link>/);
  assert.match(readFileSync(join(dir, 'dist/_bake/theme.css'), 'utf8'), /--bg:/);
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<script type="module" src="assets\/chat-[\w-]+\.js">/);
  const page = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'));
  assert.match(page, /<script type="module" src="\.\.\/\.\.\/assets\/chat-[\w-]+\.js">/);
  assert.equal(readFileSync(join(dir, 'dist/2026-10/cards/index.md'), 'utf8'), readFileSync(join(dir, 'content/posts/cards/index.md'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(dir, 'dist/_bake/articles.json'), 'utf8'));
  assert.deepEqual(
    catalog.articles.map(({ url, source, sections }) => ({ url, source, sections })),
    [{ url: '2026-10/cards/', source: '2026-10/cards/index.md', sections: [{ id: 'one', number: '01', title: 'One', subsections: [] }] }],
  );
  assert.match(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'), /<div class="bt-grid" data-columns="4" style="--bt-columns:4;--bt-row-height:30px">/);
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
  const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'));
  assert.match(html, />One<\/span><\/h2><div class="[^"]*recap[^"]*"><p>The section in short.<\/p><\/div>(?:(?!<h3).)*<p>Text.<\/p>/s);
  assert.match(html, />Part<\/span><\/h3><div class="[^"]*recap[^"]*"><p>The part in short.<\/p><\/div>(?:(?!<\/section>).)*<p>More text.<\/p>/s);
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
  const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'));
  const cards = html.split('<section class="bt-card"').slice(1);
  assert.equal(cards.length, 2);
  assert.deepEqual([...cards[0].matchAll(/<aside class="bk-sidenote"[^>]*data-label="(\w+)"/g)].map((match) => match[1]), ['section', 'part']);
  assert.doesNotMatch(cards[1], /<aside class="bk-sidenote"/);
});

test('the bento theme draws a sticker and a note as their own cards after the card of their section, and the note keeps its own sidenotes', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({
      title: 'Cards',
      slug: 'cards',
      body: ':::sticker{icon=flask}\n:::\n\n## One\n\nText.[^one]\n\n:::note{cols=3 color=blue}\nA note with $x$.[^note]\n:::\n\n:::sticker{icon=chart cols=2 rows=4}\n**Short text**\n:::\n\nMore text.\n\n[^one]: The section note.\n\n[^note]: The note of the note.\n',
    }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const html = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8'));
  const grid = /<div class="bt-grid"[^>]*>(.*)<\/div><\/article>/s.exec(html)[1];
  const cards = [...grid.matchAll(/<(section|div) class="bt-card[^"]*"([^>]*)>/g)].map(([, tag, attributes]) => [tag, /data-theme-block="(\w+)"/.exec(attributes)?.[1], /style="([^"]*)"/.exec(attributes)[1], /data-color="(\w+)"/.exec(attributes)?.[1], /data-icon="(\w+)"/.exec(attributes)?.[1]]);
  assert.deepEqual(cards, [
    ['div', 'sticker', '--bt-span:1', undefined, 'flask'],
    ['section', undefined, '--bt-span:2', undefined, undefined],
    ['div', 'note', '--bt-span:3', 'blue', undefined],
    ['div', 'sticker', '--bt-span:2;--bt-rows:4', undefined, 'chart'],
  ]);
  const [, sticker, section, note, captioned] = grid.split(/<(?:section|div) class="bt-card/);
  assert.match(sticker, /<svg class="bt-sticker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="[^"]+"\/><\/svg><div class="bt-block-body"><\/div>/);
  assert.match(captioned, /<svg class="bt-sticker-icon"[^>]*>.*<\/svg><div class="bt-block-body"><p><strong>Short text<\/strong><\/p>\n?<\/div>/s);
  assert.match(section, /<p>Text\.<sup[^>]*>.*<\/sup><\/p>.*<p>More text\.<\/p>.*data-label="one"/s);
  assert.doesNotMatch(section, /data-label="note"/);
  assert.match(note, /role="note".*<p>A note with <mjx-container.*data-label="note"/s);
  assert.doesNotMatch(html, /class="bt-intro"/);
});

test('every built-in sticker of the bento theme has a drawing', (t) => {
  const icons = ['book', 'bookmark', 'chart', 'check', 'code', 'flask', 'formula', 'heart', 'idea', 'pin', 'question', 'rocket', 'star', 'warning'];
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body: `## One\n\nText.\n\n${icons.map((icon) => `:::sticker{icon=${icon}}\n:::\n`).join('\n')}` }),
  });
  assert.equal(bake(dir, 'build').stderr, '');
  const html = readFileSync(join(dir, 'dist/2026-10/cards/index.html'), 'utf8');
  const drawn = [...html.matchAll(/data-icon="(\w+)"[^>]*><svg class="bt-sticker-icon"[^>]*>(.*?)<\/svg>/g)].filter(([, , inside]) => /<(path|circle) /.test(inside)).map(([, icon]) => icon);
  assert.deepEqual(drawn, icons);
});

test('the bento theme reports a note colour that is not one of its colours, a sticker without an icon and a block that it does not declare', (t) => {
  const dir = createBlog(t, {
    'bake.config.js': config(''),
    'content/posts/cards/index.md': article({ title: 'Cards', slug: 'cards', body: '## One\n\n:::note{color=red}\nText.\n:::\n\n:::sticker\n🧪\n:::\n\n:::badge\nText.\n:::\n' }),
  });
  const lines = bake(dir, 'build').stderr.trimEnd().split('\n');
  const at = (text) => lines.find((line) => line.includes(text));
  assert.match(at('color'), /^content\/posts\/cards\/index\.md:\d+:9 color must be one of yellow, green, blue or pink, got "red"$/);
  assert.match(at('icon'), /^content\/posts\/cards\/index\.md:\d+:1 :::sticker is missing "icon"; icon is book, bookmark, chart, check, code, flask, formula, heart, idea, pin, question, rocket, star or warning$/);
  assert.match(at('badge'), /^content\/posts\/cards\/index\.md:\d+:1 unknown block ":::badge"; the blocks of the bento theme are sticker and note$/);
  assert.equal(lines.at(-1), '3 errors, dist/ was not written');
});
