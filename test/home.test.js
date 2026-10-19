import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { compileTheme } from '../src/build/theme.js';
import { article, bake, createBlog, validConfig } from './blog.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

const categoriesConfig = `export default {
  title: 'Test Blog',
  description: 'Notes on models.',
  url: 'https://example.com',
  language: 'en',
  home: { columns: 4 },
  categories: [
    { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' },
    { id: 'empty', name: 'Empty', color: '#000000' },
    { id: 'ml', name: 'ML', color: '#2a78d6' },
  ],
};
`;

const probeTheme = {
  'themes/probe/client.jsx': "import './probe.css';\n",
  'themes/probe/probe.css': 'body {\n  margin: 0;\n}\n',
  'themes/probe/page.jsx': 'export default function Page(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props.site)} /></body></html>;\n}\n',
  'themes/probe/home.jsx': 'export default function Home(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props)} /></body></html>;\n}\n',
};

function buildHome(t, files) {
  const dir = createBlog(t, files);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  return { dir, html: readFileSync(join(dir, 'dist/index.html'), 'utf8') };
}

function probed(dir, path) {
  return JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(join(dir, 'dist', path), 'utf8'))[1]);
}

function grouping(html, name) {
  const start = html.indexOf(`<div class="bk-grouping" data-grouping="${name}">`);
  if (start === -1) return null;
  const end = html.indexOf('<div class="bk-grouping"', start + 1);
  const part = html.slice(start, end === -1 ? html.indexOf('</main>') : end);
  return part
    .split('<section ')
    .slice(1)
    .map((section) => ({
      id: /id="([^"]+)"/.exec(section)[1],
      title: /<h2 class="bk-group-title">([^<]*)<\/h2>/.exec(section)[1],
      count: /<span class="bk-group-count">([^<]*)<\/span>/.exec(section)[1],
      cards: [...section.matchAll(/<h3 class="bk-card-title">([^<]*)<\/h3>/g)].map(([, title]) => title),
    }));
}

describe('homepage', () => {
  test('passes the site, the homepage settings and the published articles newest first to home.jsx', async (t) => {
    const config = categoriesConfig.replace("language: 'en',", "language: 'en',\n  theme: 'probe',");
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const dir = createBlog(t, {
      'bake.config.js': config,
      ...probeTheme,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', date: '2026-10-02', extra: 'category: ml\nsummary: Rotary positions.\ntags: [position, llm]\npreview: preview.js\n', body: 'Text.\n\n![Angles](angles.png)\n\n![Plot](plot.svg)\n' }),
      'content/posts/rope/preview.js': 'export default () => ({ start() {}, stop() {} });\n',
      'content/posts/rope/angles.png': photo,
      'content/posts/rope/plot.svg': svg,
      'content/posts/alpha/index.md': article({ title: 'Alpha', slug: 'alpha', date: '2026-10-02', extra: 'category: math\n', body: '![Plot](plot.svg)\n' }),
      'content/posts/alpha/plot.svg': svg,
      'content/posts/old/index.md': article({ title: 'Old', slug: 'old', date: '2026-08-30', extra: 'category: math\n' }),
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-09-05\ncategory: ml\nsummary: A page.\ntags: [html]\npage: demo.html\npreview: anim/preview.js\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/demo/anim/preview.js': 'export default () => ({ start() {}, stop() {} });\n',
      'content/posts/draft/index.md': article({ title: 'Draft', slug: 'draft', date: '2026-10-05', extra: 'category: ml\ndraft: true\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const props = probed(dir, 'index.html');
    const { styles, scripts } = props.assets;
    assert.equal(styles.length, 1);
    assert.match(styles[0], /^assets\/probe-[\w-]+\.css$/);
    assert.ok(scripts.every((path) => /^assets\/probe-[\w-]+\.js$/.test(path)));
    assert.deepEqual(props, {
      site: { title: 'Test Blog', url: 'https://example.com', language: 'en', description: 'Notes on models.' },
      home: {
        groupBy: 'category',
        columns: 4,
        categories: [
          { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' },
          { id: 'empty', name: 'Empty', color: '#000000', desc: '' },
          { id: 'ml', name: 'ML', color: '#2a78d6', desc: '' },
        ],
      },
      articles: [
        { title: 'Alpha', date: '2026-10-02', tags: [], category: { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' }, draft: false, url: '2026-10/alpha/', image: '2026-10/alpha/plot.svg' },
        {
          title: 'Rope',
          summary: 'Rotary positions.',
          date: '2026-10-02',
          tags: ['position', 'llm'],
          category: { id: 'ml', name: 'ML', color: '#2a78d6', desc: '' },
          draft: false,
          url: '2026-10/rope/',
          preview: '2026-10/rope/preview.js',
          image: '2026-10/rope/angles.webp',
        },
        { title: 'Demo', summary: 'A page.', date: '2026-09-05', tags: ['html'], category: { id: 'ml', name: 'ML', color: '#2a78d6', desc: '' }, draft: false, url: '2026-09/demo/', preview: '2026-09/demo/anim/preview.js' },
        { title: 'Old', date: '2026-08-30', tags: [], category: { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' }, draft: false, url: '2026-08/old/' },
      ],
      assets: { root: './', styles, scripts },
    });
    assert.deepEqual(probed(dir, '2026-10/rope/index.html'), { title: 'Test Blog', url: 'https://example.com', language: 'en', description: 'Notes on models.' });
    assert.equal(readFileSync(join(dir, 'dist/2026-09/demo/anim/preview.js'), 'utf8'), 'export default () => ({ start() {}, stop() {} });\n');
  });

  test('groups cards by category in config order and by month, newest first, with counts', (t) => {
    const { html } = buildHome(t, {
      'bake.config.js': categoriesConfig,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', date: '2026-10-02', extra: 'category: ml\n' }),
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', date: '2026-10-14', extra: 'category: ml\n' }),
      'content/posts/chain/index.md': article({ title: 'Chain rule', slug: 'chain', date: '2026-09-01', extra: 'category: math\n' }),
    });
    assert.match(html, /^<!doctype html>\n<html lang="en" data-group="category" data-columns="4">/);
    assert.match(html, /<title>Test Blog<\/title><meta name="description" content="Notes on models.">/);
    assert.match(html, /<h1 class="bk-home-title">Test Blog<\/h1><p class="bk-home-description">Notes on models.<\/p>/);
    assert.deepEqual(grouping(html, 'category'), [
      { id: 'category-math', title: 'Math', count: '1 post', cards: ['Chain rule'] },
      { id: 'category-ml', title: 'ML', count: '2 posts', cards: ['GELU', 'Rope'] },
    ]);
    assert.deepEqual(grouping(html, 'month'), [
      { id: 'month-2026-10', title: '2026-10', count: '2 posts', cards: ['GELU', 'Rope'] },
      { id: 'month-2026-09', title: '2026-09', count: '1 post', cards: ['Chain rule'] },
    ]);
    assert.match(html, /<p class="bk-group-desc">Derivations.<\/p>/);
    const chips = [...html.matchAll(/<a class="bk-chip" href="#([^"]+)"[^>]*style="--c:(#\w+)"><span class="bk-chip-dot"><\/span>([^<]+)<span class="bk-chip-count">(\d+)<\/span><\/a>/g)].map((match) => match.slice(1));
    assert.deepEqual(chips, [
      ['category-math', '#985b57', 'Math', '1'],
      ['category-ml', '#2a78d6', 'ML', '2'],
    ]);
    assert.match(html, /<div class="bk-switch" data-control="group"/);
    assert.match(html, /<a class="bk-card" href="2026-10\/gelu\/" style="--c:#2a78d6"/);
  });

  test('without categories the homepage has only the month grouping, no grouping switch and accent borders', (t) => {
    const { html } = buildHome(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', extra: 'tags: [llm, position]\n' }),
    });
    assert.match(html, /<html lang="en" data-group="month" data-columns="3">/);
    assert.equal(grouping(html, 'category'), null);
    assert.deepEqual(grouping(html, 'month'), [{ id: 'month-2026-10', title: '2026-10', count: '1 post', cards: ['Rope'] }]);
    assert.doesNotMatch(html, /data-control="group"/);
    assert.doesNotMatch(html, /<meta name="description"/);
    assert.match(html, /<a class="bk-card" href="2026-10\/rope\/" style="--c:var\(--accent\)"/);
    assert.deepEqual([...html.matchAll(/<button type="button" class="bk-chip" data-tag(?:="([^"]*)")?/g)].map((match) => match[1] ?? ''), ['', 'llm', 'position']);
    assert.match(html, /"group":\["month"\]/);
  });

  test('a card shows its first image, a colour block with the title when there is none, the date and the tags', async (t) => {
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const { html } = buildHome(t, {
      'bake.config.js': validConfig,
      'content/posts/photo/index.md': article({ title: 'Photo', slug: 'photo', date: '2026-10-03', extra: 'summary: One sentence.\ntags: [a, b]\n', body: '![](<my photo.png>)\n' }),
      'content/posts/photo/my photo.png': photo,
      'content/posts/plain/index.md': article({ title: 'Plain <b>', slug: 'plain', date: '2026-10-02' }),
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-10-01\npage: demo.html\npreview: preview.js\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/demo/preview.js': 'export default () => ({ start() {}, stop() {} });\n',
    });
    const cards = html.split('<a class="bk-card"').slice(1, 4);
    assert.match(cards[0], /<div class="bk-card-fallback"><img src="2026-10\/photo\/my%20photo.webp" alt loading="lazy" decoding="async"><\/div>/);
    assert.match(cards[0], /<p class="bk-card-summary">One sentence.<\/p><p class="bk-card-meta"><time datetime="2026-10-03">2026-10-03<\/time><span class="bk-card-tag">a<\/span><span class="bk-card-tag">b<\/span><\/p>/);
    assert.match(cards[1], /<span class="bk-card-cover" aria-hidden="true">Plain &lt;b><\/span>/);
    assert.doesNotMatch(cards[1], /bk-card-summary|data-preview/);
    assert.match(cards[2], /^ href="2026-10\/demo\/" style="--c:var\(--accent\)" data-tags="\[\]" data-preview="2026-10\/demo\/preview.js">/);
    assert.match(cards[2], /<span class="bk-card-cover" aria-hidden="true">Demo<\/span>/);
    assert.doesNotMatch(html, /bk-card-draft/);
  });

  test('the essay theme shows a draft badge at the top of the card of a draft', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const errors = [];
    const theme = await compileTheme(dir, 'essay', { home: true }, errors);
    assert.deepEqual(errors, []);
    const entry = { title: 'Rope', date: '2026-10-19', tags: [], draft: true, url: '2026-10/rope/' };
    const html = theme.renderHome({
      site: { title: 'Test Blog', url: 'https://example.com', language: 'zh-CN' },
      home: { groupBy: 'month', columns: 3, categories: [] },
      articles: [entry, { ...entry, title: 'GELU', draft: false, url: '2026-10/gelu/' }],
      assets: { root: './', styles: [], scripts: [] },
    });
    const cards = html.split('<a class="bk-card"').slice(1);
    assert.match(cards[0], /<div class="bk-card-frame"><div class="bk-card-fallback">.*?<\/div><span class="bk-card-draft">草稿<\/span><\/div>/);
    assert.doesNotMatch(cards[1], /bk-card-draft/);
    assert.match(html, /<span class="bk-group-count">2 篇<\/span>/);
  });

  test('writes the homepage when the blog has no articles', (t) => {
    const { dir, html } = buildHome(t, { 'bake.config.js': validConfig });
    assert.match(html, /<h1 class="bk-home-title">Test Blog<\/h1>/);
    assert.deepEqual(grouping(html, 'month'), []);
    assert.equal(bake(dir, 'build').stdout, '0 pages\ndist/ written\n');
  });

  test('reports a public/index.html that the homepage also writes', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'public/index.html': '<p>mine</p>\n' });
    assert.equal(bake(dir, 'build').stderr, 'public/index.html:1:1 dist/index.html is also written by the homepage\n1 error, dist/ was not written\n');
  });

  test('reports a site theme without home.jsx, and needs no home.jsx in a theme that only articles use', (t) => {
    const { 'themes/probe/home.jsx': home, ...withoutHome } = probeTheme;
    assert.ok(home);
    const missing = createBlog(t, { 'bake.config.js': validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'"), ...withoutHome });
    assert.equal(bake(missing, 'build').stderr, 'themes/probe:1:1 theme "probe" has no home.jsx\n1 error, dist/ was not written\n');
    const articleOnly = createBlog(t, { 'bake.config.js': validConfig, ...withoutHome, 'content/posts/rope/index.md': article({ extra: 'theme: probe\n' }) });
    const result = bake(articleOnly, 'build');
    assert.equal(result.stderr, '');
    assert.match(readFileSync(join(articleOnly, 'dist/index.html'), 'utf8'), /<h1 class="bk-home-title">/);
  });

  test('reports a homepage that the site theme cannot render at the theme folder', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'"),
      ...probeTheme,
      'themes/probe/home.jsx': "export default function Home() {\n  throw new Error('no cards');\n}\n",
    });
    assert.equal(bake(dir, 'build').stderr, 'themes/probe:1:1 the probe theme cannot render the homepage: no cards\n1 error, dist/ was not written\n');
  });
});
