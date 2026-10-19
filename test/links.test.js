import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { bake, writeFiles } from './blog.js';
import { folder, outline, parseSite } from './article.js';

const fixturesDir = join(import.meta.dirname, 'fixtures/syntax-errors');
const exampleBlog = join(import.meta.dirname, '../examples/blog');
const ID_ATTRIBUTE = new RegExp(' id="([^"]*)"', 'g');
const linkFixtures = ['missing-link-target.md', 'embed-self.md', 'embed-duplicate.md', 'embed-overlap.md'];

const target = [
  'Intro paragraph. ^opening',
  '',
  '## Chain rule {#chain-rule}',
  '',
  'Let $y = f(u)$ and $u = g(x)$, then[^note]',
  '',
  '$$',
  '\\frac{\\partial y}{\\partial x} = \\frac{\\partial y}{\\partial u} \\frac{\\partial u}{\\partial x} \\label{eq:chain}',
  '$$',
  '',
  'Equation \\eqref{eq:chain} uses the local gradient [@griewank], see [the order](#order). ^local-grad',
  '',
  'A fourth block.',
  '',
  '### Inside {#inside}',
  '',
  'Text inside.',
  '',
  '## Order {#order}',
  '',
  'Visit nodes in reverse order. ![Graph](relu.svg)',
  '',
  ':::act-fn-plot{fn=gelu}',
  'The caption of the plot.',
  ':::',
  '',
  ':::embed',
  '/2026-10/other/#far',
  ':::',
  '',
  '[^note]: A sidenote that embeds do not show.',
  '',
  ':::references',
  '- [@griewank] Griewank. *Evaluating Derivatives*. 2008.',
  ':::',
].join('\n');

const other = '## Far {#far}\n\nFar away.\n';
const components = new Map([
  ['act-fn-plot', { name: 'act-fn-plot', valid: true, params: { fn: { label: 'Function', type: 'enum', options: ['relu', 'gelu'], default: 'relu' } }, layout: { height: 360 } }],
  ['data-view', { name: 'data-view', valid: true, params: { source: { label: 'Source', type: 'file', default: '' } }, layout: { height: 200 } }],
]);

async function site(body, pages = []) {
  return parseSite([{ url: '/2026-10/host/', title: 'Host', body }, { url: '/2026-10/target/', title: 'Target', body: target, folder: folder(fixturesDir) }, { url: '/2026-10/other/', title: 'Other', body: other }, ...pages], { components });
}

async function host(body, pages) {
  const { articles, errors } = await site(body, pages);
  assert.deepEqual(errors, []);
  return articles['/2026-10/host/'];
}

function ids(html) {
  return [...html.matchAll(ID_ATTRIBUTE)].map(([, id]) => id);
}

describe('internal links', () => {
  test('renders a link to an article, a heading and a paragraph relative to the page and marks it for a preview', async () => {
    const article = await host('[Target](/2026-10/target/), [rule](/2026-10/target/#chain-rule), [this paragraph](/2026-10/target/#local-grad) and [home](https://example.com/2026-10/gone/).\n');
    assert.equal(
      article.intro[0].html,
      '<p><a class="internal-link" href="../../2026-10/target/" data-target="/2026-10/target/">Target</a>, <a class="internal-link" href="../../2026-10/target/#chain-rule" data-target="/2026-10/target/#chain-rule">rule</a>, <a class="internal-link" href="../../2026-10/target/#local-grad" data-target="/2026-10/target/#local-grad">this paragraph</a> and <a href="https://example.com/2026-10/gone/">home</a>.</p>',
    );
  });

  test('percent-encodes an anchor written in Chinese in the link and keeps it readable in the preview target', async () => {
    const { articles, errors } = await parseSite([
      { url: '/2026-10/host/', body: '[链式法则](/2026-10/zh/#链式法则)\n' },
      { url: '/2026-10/zh/', body: '## 链式法则\n\nText.\n' },
    ]);
    assert.deepEqual(errors, []);
    assert.equal(articles['/2026-10/host/'].intro[0].html, '<p><a class="internal-link" href="../../2026-10/zh/#%E9%93%BE%E5%BC%8F%E6%B3%95%E5%88%99" data-target="/2026-10/zh/#链式法则">链式法则</a></p>');
  });

  test('reports a missing article, heading or paragraph and a missing anchor on the same page at the link', async () => {
    const { errors } = await site('See [a](/2026-10/nothing/), [b](/2026-10/target/#chain), [c](/2026-10/target/#local) and [d](#nowhere).\n\n## Here {#here}\n\n[e](#here) [f](#eq:none) [g](https://example.com/#x)\n');
    assert.deepEqual(errors, [
      'host.md:7:5 link target /2026-10/nothing/ does not exist',
      'host.md:7:29 link target /2026-10/target/#chain does not exist',
      'host.md:7:58 link target /2026-10/target/#local does not exist',
      'host.md:7:90 link target #nowhere does not exist',
      'host.md:11:12 link target #eq:none does not exist',
    ]);
  });

  test('reports a link or an embed address whose anchor has an invalid percent-encoding at the link', async () => {
    const { errors } = await site('[x](/2026-10/nothere/#%ZZ) and [y](#%ZZ)\n\n:::embed\n/2026-10/target/#%E9\n:::\n');
    assert.deepEqual(errors, [
      'host.md:7:1 link target /2026-10/nothere/#%ZZ has an invalid percent-encoding; write a literal % as %25',
      'host.md:7:32 link target #%ZZ has an invalid percent-encoding; write a literal % as %25',
      'host.md:10:1 :::embed address /2026-10/target/#%E9 has an invalid percent-encoding; write a literal % as %25',
    ]);
  });

  test('accepts same-page links to headings, paragraph anchors, sidenotes, references and equations', async () => {
    await host('## A {#a}\n\nText[^n] [@k]. ^para\n\n$$\nx \\label{eq:x}\n$$\n\n[1](#a) [2](#para) [3](#sidenote-1) [4](#reference-k) [5](#eq:x) [6](#)\n\n[^n]: Note.\n\n:::references\n- [@k] K.\n:::\n');
  });

  test('accepts same-page links to ids in raw HTML written without quotes, with spaces around = or in capitals', async () => {
    await host('<div id=box>a</div>\n\n<p ID="upper">b</p>\n\n<p id = "spaced">c</p>\n\nText with [x](#box) [y](#upper) [z](#spaced).\n');
  });

  test('checks addresses without the trailing slash, with index.html or with a query and gives the article address', async () => {
    const { articles, errors } = await site('[a](/2026-10/target) [b](/2026-10/target/index.html#chain-rule) [c](/2026-10/target#missing) [d](/2026-10/target/?view=1#chain-rule)\n');
    assert.deepEqual(errors, [
      'host.md:7:1 link target /2026-10/target does not exist; the address of the article is /2026-10/target/',
      'host.md:7:22 link target /2026-10/target/index.html#chain-rule does not exist; the address of the article is /2026-10/target/#chain-rule',
      'host.md:7:65 link target /2026-10/target#missing does not exist; the address of the article is /2026-10/target/',
    ]);
    assert.match(articles['/2026-10/host/'].intro[0].html, /<a class="internal-link" href="\.\.\/\.\.\/2026-10\/target\/\?view=1#chain-rule" data-target="\/2026-10\/target\/#chain-rule">d<\/a>/);
  });

  test('accepts sidenotes, references and equations of another article as link targets and previews them', async () => {
    const article = await host('[note](/2026-10/target/#sidenote-1) [entry](/2026-10/target/#reference-griewank) [formula](/2026-10/target/#eq:chain)\n');
    assert.deepEqual(
      article.previews.map(({ target, kind, number, title }) => ({ target, kind, number, title })),
      [
        { target: '/2026-10/target/#sidenote-1', kind: 'section', number: '1', title: 'Chain rule' },
        { target: '/2026-10/target/#reference-griewank', kind: 'reference', number: '1', title: undefined },
        { target: '/2026-10/target/#eq:chain', kind: 'section', number: '1', title: 'Chain rule' },
      ],
    );
    assert.deepEqual(
      article.previews.map((preview) => outline(preview.html)),
      [
        '<p>A sidenote that embeds do not show.</p>',
        'Griewank. <em>Evaluating Derivatives</em>. 2008.',
        '$$\\frac{\\partial y}{\\partial x} = \\frac{\\partial y}{\\partial u} \\frac{\\partial u}{\\partial x} \\label{eq:chain}$$',
      ],
    );
    assert.deepEqual(ids(article.previews.map((preview) => preview.html).join('')), []);
  });

  test('never gives the address of a draft as the current address of an article', async () => {
    const { errors } = await site('[old](/2026-09/plan/)\n', [{ url: '/2026-10/plan/', draft: true, body: 'Draft.\n' }]);
    assert.deepEqual(errors, ['host.md:7:1 link target /2026-09/plan/ does not exist']);
  });

  test('gives the current address of an article whose date changed', async () => {
    const { errors } = await site('[old](/2026-09/target/#chain-rule)\n');
    assert.deepEqual(errors, ['host.md:7:1 link target /2026-09/target/#chain-rule does not exist; the article with slug "target" is at /2026-10/target/']);
  });

  test('reports a link from a published article to a draft and accepts one between drafts', async () => {
    const draft = { url: '/2026-10/draft/', draft: true, body: 'Draft.\n' };
    assert.deepEqual((await site('[draft](/2026-10/draft/)\n', [draft])).errors, ['host.md:7:1 link target /2026-10/draft/ is a draft, which is not published']);
    const { errors } = await parseSite([draft, { url: '/2026-10/second/', draft: true, body: '[draft](/2026-10/draft/)\n' }]);
    assert.deepEqual(errors, []);
  });
});

describe('preview content', () => {
  test('lists every linked target once with the first blocks after a heading, a paragraph, or the start of an article', async () => {
    const article = await host('[a](/2026-10/target/#chain-rule) [b](/2026-10/target/#chain-rule) [c](/2026-10/target/#local-grad) [d](/2026-10/target/) [e](/2026-10/target/#inside)\n');
    assert.deepEqual(
      article.previews.map(({ target, href, article: title, number, title: heading }) => ({ target, href, title, number, heading })),
      [
        { target: '/2026-10/target/#chain-rule', href: '../../2026-10/target/#chain-rule', title: 'Target', number: '1', heading: 'Chain rule' },
        { target: '/2026-10/target/#local-grad', href: '../../2026-10/target/#local-grad', title: 'Target', number: '1', heading: 'Chain rule' },
        { target: '/2026-10/target/', href: '../../2026-10/target/', title: 'Target', number: undefined, heading: undefined },
        { target: '/2026-10/target/#inside', href: '../../2026-10/target/#inside', title: 'Target', number: '1.1', heading: 'Inside' },
      ],
    );
    const [section, paragraph, start, inside] = article.previews.map((preview) => outline(preview.html));
    assert.equal(
      section,
      '<p>Let $y = f(u)$ and $u = g(x)$, then</p>\n$$\\frac{\\partial y}{\\partial x} = \\frac{\\partial y}{\\partial u} \\frac{\\partial u}{\\partial x} \\label{eq:chain}$$\n<p>Equation <a class="eqref" href="../../2026-10/target/#eq%3Achain">(1)</a> uses the local gradient <a class="citation" href="../../2026-10/target/#reference-griewank" data-target="/2026-10/target/#reference-griewank">[1]</a>, see <a class="internal-link" href="../../2026-10/target/#order" data-target="/2026-10/target/#order">the order</a>.</p>',
    );
    assert.equal(paragraph, section.slice(section.lastIndexOf('<p>')));
    assert.equal(start, '<p>Intro paragraph.</p>');
    assert.equal(inside, '<p>Text inside.</p>');
  });

  test('shows the caption of a component instead of the component', async () => {
    const article = await host('[order](/2026-10/target/#order)\n');
    assert.equal(
      article.previews[0].html,
      '<p>Visit nodes in reverse order. <img src="../../2026-10/target/relu.svg" alt="Graph" width="320" height="200" loading="lazy" decoding="async"></p>\n<div class="component-caption">\n<p>The caption of the plot.</p>\n</div>\n<p class="embed-link"><a class="internal-link" href="../../2026-10/other/#far" data-target="/2026-10/other/#far">Far</a></p>',
    );
    assert.deepEqual(
      article.previews.map((preview) => preview.target),
      ['/2026-10/target/#order'],
    );
  });

  test('repeats no id of the page and refers to glyphs that the page holds', async () => {
    const article = await host('Host math $a$ [@k].[^n] [rule](/2026-10/target/#chain-rule)\n\n[^n]: Note.\n\n:::references\n- [@k] K.\n:::\n');
    const html = article.previews.map((preview) => preview.html).join('');
    assert.deepEqual(ids(html), []);
    assert.doesNotMatch(html, /sidenote/);
    const used = new Set([...html.matchAll(/xlink:href="#([^"]+)"/g)].map(([, id]) => id));
    const held = new Set(ids(article.glyphs));
    assert.deepEqual([...used].filter((id) => !held.has(id)), []);
    assert.equal(ids(article.glyphs).length, held.size);
  });
});

describe(':::embed', () => {
  test('embeds a section up to the next heading of the same level and a paragraph, each followed by its source line', async () => {
    const article = await host('Before.\n\n:::embed\n/2026-10/target/#chain-rule\n/2026-10/target/#opening\n:::\n\nAfter.\n');
    assert.deepEqual(
      article.intro.map((block) => block.type),
      ['paragraph', 'embed', 'paragraph'],
    );
    assert.equal(
      outline(article.intro[1].html),
      [
        '<div class="embed"><div class="embed-part"><h2 data-attributes="{&#x22;id&#x22;:&#x22;chain-rule&#x22;}">Chain rule</h2>',
        '<p>Let $y = f(u)$ and $u = g(x)$, then</p>',
        '$$\\frac{\\partial y}{\\partial x} = \\frac{\\partial y}{\\partial u} \\frac{\\partial u}{\\partial x} \\label{eq:chain}$$',
        '<p>Equation <a class="eqref" href="../../2026-10/target/#eq%3Achain">(1)</a> uses the local gradient <a class="citation" href="../../2026-10/target/#reference-griewank" data-target="/2026-10/target/#reference-griewank">[1]</a>, see <a class="internal-link" href="../../2026-10/target/#order" data-target="/2026-10/target/#order">the order</a>.</p>',
        '<p>A fourth block.</p>',
        '<h3 data-attributes="{&#x22;id&#x22;:&#x22;inside&#x22;}">Inside</h3>',
        '<p>Text inside.</p><p class="embed-source"><a href="../../2026-10/target/#chain-rule"><cite>Target</cite><span class="embed-number">1</span></a></p></div><div class="embed-part"><p>Intro paragraph.</p><p class="embed-source"><a href="../../2026-10/target/#opening"><cite>Target</cite></a></p></div></div>',
      ].join('\n'),
    );
  });

  test('keeps equation numbers, removes ids and sidenotes, and adds the glyphs of embedded formulas to a page without math', async () => {
    const article = await host(':::embed\n/2026-10/target/#chain-rule\n:::\n');
    const { html } = article.intro[0];
    assert.match(html, /<mjx-container[^>]*display="true"/);
    assert.match(html, /data-c="31"/);
    assert.deepEqual(ids(html), []);
    assert.doesNotMatch(html, /sidenote/);
    assert.deepEqual(article.sidenotes, []);
    const used = new Set([...html.matchAll(/xlink:href="#([^"]+)"/g)].map(([, id]) => id));
    assert.ok(used.size > 5);
    assert.deepEqual(new Set(ids(article.glyphs).filter((id) => id !== 'MJX-SVG-global-cache')), used);
  });

  test('keeps embedded headings out of the sections, the table of contents and the word count', async () => {
    const article = await host('## Mine\n\nOne two.\n\n:::embed\n/2026-10/target/#chain-rule\n:::\n');
    assert.deepEqual(article.toc.map((entry) => [entry.id, entry.children.length]), [['mine', 0]]);
    assert.deepEqual(article.sections[0].subsections, []);
    assert.equal(article.words, 3);
  });

  test('shows an :::embed inside embedded content as a link and runs components', async () => {
    const article = await host(':::embed\n/2026-10/target/#order\n:::\n');
    const { html } = article.intro[0];
    assert.match(html, /<figure class="component" data-component="act-fn-plot" data-params="{&#x22;fn&#x22;:&#x22;gelu&#x22;}" data-attributes="{&#x22;fn&#x22;:&#x22;gelu&#x22;}"><div class="component-box"/);
    assert.match(html, /<p class="embed-link"><a class="internal-link" href="..\/..\/2026-10\/other\/#far" data-target="\/2026-10\/other\/#far">Far<\/a><\/p>/);
    assert.deepEqual(
      article.previews.map((preview) => preview.target),
      ['/2026-10/other/#far'],
    );
  });

  test('counts the components of embedded content as components of the page and points their file parameters into the source article', async () => {
    const source = { url: '/2026-10/data/', title: 'Data', body: '## Data {#data}\n\n:::data-view{source=relu.svg}\n:::\n', folder: folder(fixturesDir) };
    const { articles, errors } = await site('Text.\n\n:::embed\n/2026-10/data/#data\n:::\n', [source]);
    assert.deepEqual(errors, []);
    const host = articles['/2026-10/host/'];
    assert.deepEqual(host.components, ['data-view']);
    assert.match(host.intro[1].html, /data-component="data-view" data-params="{&#x22;source&#x22;:&#x22;..\/..\/2026-10\/data\/relu.svg&#x22;}"/);
    assert.match(articles['/2026-10/data/'].sections[0].blocks[0].html, /data-params="{&#x22;source&#x22;:&#x22;relu.svg&#x22;}"/);
    assert.deepEqual(articles['/2026-10/data/'].components, ['data-view']);
  });

  test('repeats no id of the page when the embedded content holds references and raw HTML, and points its citations to the source entries', async () => {
    const source = { url: '/2026-10/cited/', title: 'Cited', body: '## Part {#part}\n\nA claim [@k].\n\n<span id="marker">raw</span>\n\n:::references\n- [@k] The source entry.\n:::\n' };
    const article = await host('<span id="marker">mine</span> and [@k].\n\n:::embed\n/2026-10/cited/#part\n:::\n\n:::references\n- [@k] The host entry.\n:::\n', [source]);
    const html = [...article.intro, ...article.previews].map((entry) => entry.html).join('');
    const all = ids(html);
    assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), []);
    assert.deepEqual(all.sort(), ['marker', 'reference-k']);
    assert.match(article.intro[1].html, /<a class="citation" href="\.\.\/\.\.\/2026-10\/cited\/#reference-k" data-target="\/2026-10\/cited\/#reference-k">\[1\]<\/a>/);
    assert.deepEqual(
      article.previews.map(({ target, kind, number, html: text }) => ({ target, kind, number, text })),
      [{ target: '/2026-10/cited/#reference-k', kind: 'reference', number: '1', text: 'The source entry.' }],
    );
  });

  test('removes the id attributes of embedded raw HTML and keeps text that only looks like one', async () => {
    const source = { url: '/2026-10/raw/', title: 'Raw', body: '## Part {#part}\n\n<p ID=box class="note">Set id=5 here</p>\n' };
    const article = await host(':::embed\n/2026-10/raw/#part\n:::\n', [source]);
    assert.match(article.intro[0].html, /<p class="note">Set id=5 here<\/p>/);
  });

  test('reports an embed of an equation, a sidenote or a reference', async () => {
    const { errors } = await site(':::embed\n/2026-10/target/#eq:chain\n/2026-10/target/#sidenote-1\n/2026-10/target/#reference-griewank\n:::\n');
    assert.deepEqual(errors, [
      'host.md:8:1 :::embed target /2026-10/target/#eq:chain is not a heading or a paragraph',
      'host.md:9:1 :::embed target /2026-10/target/#sidenote-1 is not a heading or a paragraph',
      'host.md:10:1 :::embed target /2026-10/target/#reference-griewank is not a heading or a paragraph',
    ]);
  });

  test('reports the article itself, a missing target, an address twice, overlapping addresses and lines that are no address', async () => {
    const { errors } = await site(
      [
        ':::embed',
        '/2026-10/host/#mine',
        '/2026-10/target/#missing',
        '/2026-10/target/#inside',
        '/2026-10/target/#chain-rule',
        '/2026-10/target/#inside',
        '/2026-10/target/',
        'https://example.com/',
        '/2026-09/other/#far',
        ':::',
        '',
        ':::embed',
        ':::',
        '',
        ':::embed',
        '- /2026-10/target/#order',
        ':::',
        '',
        '## Mine {#mine}',
        '',
      ].join('\n'),
    );
    assert.deepEqual(errors, [
      'host.md:8:1 :::embed cannot embed the article itself',
      'host.md:9:1 :::embed target /2026-10/target/#missing does not exist',
      'host.md:11:1 :::embed address /2026-10/target/#chain-rule contains /2026-10/target/#inside',
      'host.md:12:1 :::embed lists /2026-10/target/#inside twice',
      'host.md:13:1 :::embed address /2026-10/target/ has no anchor; it must point to a heading or a paragraph such as /2026-10/slug/#anchor',
      'host.md:14:1 :::embed line "https://example.com/" is not a site address such as /2026-10/slug/#anchor',
      'host.md:15:1 :::embed target /2026-09/other/#far does not exist; the article with slug "other" is at /2026-10/other/',
      'host.md:18:1 :::embed lists no address; write one site address per line, such as /2026-10/slug/#anchor',
      'host.md:22:1 :::embed holds only site addresses, one per line, such as /2026-10/slug/#anchor',
    ]);
  });
});

describe('link fixtures', () => {
  test('syntax error fixtures for links and embeds report the lines in expected.json', (t) => {
    const expected = JSON.parse(readFileSync(join(fixturesDir, 'expected.json'), 'utf8'));
    const dir = mkdtempSync(join(tmpdir(), 'bake-links-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
    writeFiles(dir, Object.fromEntries(linkFixtures.map((name) => [`content/posts/fixtures/${name.replace('.md', '')}/index.md`, readFileSync(join(fixturesDir, name), 'utf8')])));
    const lines = bake(dir, 'build')
      .stderr.trim()
      .split('\n')
      .slice(0, -1)
      .map((line) => line.replace(/^content\/posts\/fixtures\/([\w-]+)\/index\.md/, '$1.md'));
    assert.deepEqual(lines.sort(), linkFixtures.map((name) => expected[name]).sort());
  });
});
