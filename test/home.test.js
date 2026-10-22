import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { article, build, createBlog, validConfig } from './blog.js';

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
  'themes/probe/client.jsx': "import './probe.css';\n\nexport default () => () => {};\n",
  'themes/probe/probe.css': 'body {\n  margin: 0;\n}\n',
  'themes/probe/page.jsx': 'export default function Page(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify({ site: props.site, options: props.options })} /></body></html>;\n}\n',
  'themes/probe/home.jsx': 'export default function Home(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props)} /></body></html>;\n}\n',
  'themes/probe/not-found.jsx': 'export default function NotFound(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props)} /></body></html>;\n}\n',
  'themes/probe/theme.css': 'body {\n  color: black;\n}\n',
};

async function buildHome(t, files) {
  const dir = createBlog(t, files);
  assert.deepEqual(await build(dir), []);
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
  test('passes the site, the options of the theme, the homepage settings and the published articles newest first to home.jsx', async (t) => {
    const config = categoriesConfig.replace("language: 'en',", "language: 'en',\n  theme: 'probe',\n  themes: { probe: { density: 'tight' }, bento: { columns: 5 } },");
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const dir = createBlog(t, {
      'bake.config.js': config,
      ...probeTheme,
      'themes/probe/options.js': "export const options = { density: { label: 'Density', type: 'enum', options: ['loose', 'tight'], default: 'loose' } };\n",
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
    assert.deepEqual(await build(dir), []);
    const props = probed(dir, 'index.html');
    const { styles, scripts } = props.assets;
    assert.equal(styles.length, 1);
    assert.match(styles[0], /^assets\/probe-[\w-]+\.css$/);
    assert.equal(scripts.length, 2);
    assert.match(scripts[0], /^assets\/probe-[\w-]+\.js$/);
    assert.match(scripts[1], /^assets\/chat-[\w-]+\.js$/);
    assert.deepEqual(props, {
      site: { title: 'Test Blog', url: 'https://example.com', language: 'en', description: 'Notes on models.', link: 'https://example.com/' },
      options: { density: 'tight' },
      home: {
        groupBy: 'category',
        columns: 4,
        categories: [
          { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' },
          { id: 'empty', name: 'Empty', color: '#000000', desc: '' },
          { id: 'ml', name: 'ML', color: '#2a78d6', desc: '' },
          { id: 'default', name: 'Default', color: '#7d7f84', desc: '' },
        ],
      },
      articles: [
        { title: 'Alpha', date: '2026-10-02', tags: [], category: { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' }, draft: false, url: '2026-10/alpha/', image: '2026-10/alpha/plot.svg', sections: [] },
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
          sections: [],
        },
        { title: 'Demo', summary: 'A page.', date: '2026-09-05', tags: ['html'], category: { id: 'ml', name: 'ML', color: '#2a78d6', desc: '' }, draft: false, url: '2026-09/demo/', preview: '2026-09/demo/anim/preview.js', sections: [] },
        { title: 'Old', date: '2026-08-30', tags: [], category: { id: 'math', name: 'Math', color: '#985b57', desc: 'Derivations.' }, draft: false, url: '2026-08/old/', sections: [] },
      ],
      assets: { root: './', styles, scripts },
    });
    assert.deepEqual(probed(dir, '2026-10/rope/index.html'), { site: { title: 'Test Blog', url: 'https://example.com', language: 'en', description: 'Notes on models.', link: 'https://example.com/' }, options: { density: 'tight' } });
    assert.equal(readFileSync(join(dir, 'dist/2026-09/demo/anim/preview.js'), 'utf8'), 'export default () => ({ start() {}, stop() {} });\n');
  });

  test('groups cards by category in config order and by month, newest first, with counts', async (t) => {
    const { html } = await buildHome(t, {
      'bake.config.js': categoriesConfig,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', date: '2026-10-02', extra: 'category: ml\n' }),
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', date: '2026-10-14', extra: 'category: ml\n' }),
      'content/posts/chain/index.md': article({ title: 'Chain rule', slug: 'chain', date: '2026-09-01', extra: 'category: math\n' }),
    });
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
    const chips = [...html.matchAll(/<a class="bk-chip" href="#([^"]+)"[^>]*><span class="bk-chip-dot"><\/span>([^<]+)<span class="bk-chip-count">(\d+)<\/span><\/a>/g)].map((match) => match.slice(1));
    assert.deepEqual(chips, [
      ['category-math', 'Math', '1'],
      ['category-ml', 'ML', '2'],
    ]);
  });

  test('without categories the homepage has only the month grouping and a tag filter', async (t) => {
    const { html } = await buildHome(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', extra: 'tags: [llm, position]\n' }),
    });
    assert.equal(grouping(html, 'category'), null);
    assert.deepEqual(grouping(html, 'month'), [{ id: 'month-2026-10', title: '2026-10', count: '1 post', cards: ['Rope'] }]);
    assert.doesNotMatch(html, /<meta name="description"/);
    assert.deepEqual([...html.matchAll(/<button type="button" class="bk-chip"[^>]*>([^<]*)/g)].map((match) => match[1]), ['All', 'llm', 'position']);
  });

  test('a card shows its first image, the numbered titles of its sections when there is none, a colour block with the title when there are no sections either, the date and the tags', async (t) => {
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const { html } = await buildHome(t, {
      'bake.config.js': validConfig,
      'content/posts/photo/index.md': article({ title: 'Photo', slug: 'photo', date: '2026-10-03', extra: 'summary: One sentence.\ntags: [a, b]\n', body: '![](<my photo.png>)\n' }),
      'content/posts/photo/my photo.png': photo,
      'content/posts/plain/index.md': article({ title: 'Plain <b>', slug: 'plain', date: '2026-10-02' }),
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-10-01\npage: demo.html\npreview: preview.js\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/demo/preview.js': 'export default () => ({ start() {}, stop() {} });\n',
      'content/posts/outline/index.md': article({ title: 'Outline', slug: 'outline', date: '2026-10-01', body: 'Intro.\n\n## First part\n\nText.\n\n### Detail\n\nText.\n\n## Second part\n\nText.\n' }),
    });
    const cards = html.split('<a class="bk-card"').slice(1, 5);
    assert.match(cards[0], /<div class="bk-card-fallback"><img src="2026-10\/photo\/my%20photo.webp" alt loading="lazy" decoding="async"><\/div>/);
    assert.match(cards[0], /<p class="bk-card-summary">One sentence.<\/p><p class="bk-card-meta"><time datetime="2026-10-03">2026-10-03<\/time><span class="bk-card-tag">a<\/span><span class="bk-card-tag">b<\/span><\/p>/);
    assert.match(cards[1], /<span class="bk-card-cover" aria-hidden="true">Plain &lt;b><\/span>/);
    assert.doesNotMatch(cards[1], /bk-card-summary|data-preview/);
    assert.match(cards[2], /^ href="2026-10\/demo\/"[^>]* data-preview="2026-10\/demo\/preview.js">/);
    assert.match(cards[2], /<span class="bk-card-cover" aria-hidden="true">Demo<\/span>/);
    assert.match(cards[3], /<ol class="bk-card-cover bk-card-outline" aria-hidden="true"><li><span class="bk-card-outline-number">01<\/span>First part<\/li><li><span class="bk-card-outline-number">02<\/span>Second part<\/li><\/ol>/);
    assert.doesNotMatch(html, /bk-card-draft/);
  });

  test('a card gives the preview and the image of an article URL-encoded addresses when their file names hold #, ? or %', async (t) => {
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const { dir, html } = await buildHome(t, {
      'bake.config.js': validConfig,
      'content/posts/photo/index.md': article({ title: 'Photo', slug: 'photo', date: '2026-10-03', body: '![](<photo%231%3F100%25.png>)\n' }),
      'content/posts/photo/photo#1?100%.png': photo,
      'content/posts/demo/index.md': article({ title: 'Demo', slug: 'demo', date: '2026-10-02', extra: 'preview: preview#1?100%.js\n' }),
      'content/posts/demo/preview#1?100%.js': 'export default () => ({ start() {}, stop() {} });\n',
    });
    const cards = html.split('<a class="bk-card"').slice(1, 3);
    assert.match(cards[0], /<img src="2026-10\/photo\/photo%231%3F100%25.webp" alt loading="lazy" decoding="async">/);
    assert.match(cards[1], /data-preview="2026-10\/demo\/preview%231%3F100%25.js"/);
    const page = readFileSync(join(dir, 'dist/2026-10/photo/index.html'), 'utf8');
    assert.match(page, /<img src="photo%231%3F100%25.webp"/);
    assert.ok(existsSync(join(dir, 'dist/2026-10/photo/photo#1?100%.webp')));
  });

  test('a card never shows a component frame: it uses an image of the caption or the colour block, and the homepage loads no component code', async (t) => {
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const component = "export const params = { data: { label: 'Data', type: 'file', default: '' } };\nexport const layout = { height: 200 };\n\nexport default class DataView extends HTMLElement {}\n";
    const { dir, html } = await buildHome(t, {
      'bake.config.js': validConfig,
      'components/data-view.js': component,
      'content/posts/caption/index.md': article({ title: 'Caption', slug: 'caption', date: '2026-10-03', body: ':::data-view\nThe caption with ![a photo](photo.png).\n:::\n' }),
      'content/posts/caption/photo.png': photo,
      'content/posts/data/index.md': article({ title: 'Data', slug: 'data', date: '2026-10-02', body: ':::data-view{data=grid.png}\nThe caption.\n:::\n' }),
      'content/posts/data/grid.png': photo,
    });
    const cards = html.split('<a class="bk-card"').slice(1, 3);
    assert.match(cards[0], /<div class="bk-card-fallback"><img src="2026-10\/caption\/photo.webp" alt loading="lazy" decoding="async"><\/div>/);
    assert.match(cards[1], /<span class="bk-card-cover" aria-hidden="true">Data<\/span>/);
    assert.doesNotMatch(html, /component/);
    assert.match(html, /<script type="module" src="assets\/chat-[\w-]+\.js"><\/script>/);
    assert.match(readFileSync(join(dir, 'dist/2026-10/caption/index.html'), 'utf8'), /<figure class="component" data-component="data-view"/);
  });

  test('the essay theme says in Chinese that a Chinese blog has no posts yet', async (t) => {
    const { html } = await buildHome(t, { 'bake.config.js': validConfig.replace("language: 'en'", "language: 'zh-CN'") });
    assert.match(html, /<p class="bk-home-empty">还没有文章<\/p>/);
  });

  test('writes the homepage when the blog has no articles', async (t) => {
    const { dir, html } = await buildHome(t, { 'bake.config.js': validConfig });
    assert.match(html, /<h1 class="bk-home-title">Test Blog<\/h1>/);
    assert.equal(grouping(html, 'month'), null);
    assert.match(html, /<p class="bk-home-empty">No posts yet<\/p>/);
    assert.doesNotMatch(html, /bk-home-bar|data-control="columns"/);
  });

  test('reports a public/index.html that the homepage also writes', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'public/index.html': '<p>mine</p>\n' });
    assert.deepEqual(await build(dir), ['public/index.html:1:1 dist/index.html is also written by the homepage']);
  });

  test('renders the homepage and the 404 page of a site theme without home.jsx or not-found.jsx with those of bake/theme, reports a site theme without theme.css, and needs none of them in a theme that only articles use', async (t) => {
    const { 'themes/probe/home.jsx': home, 'themes/probe/not-found.jsx': notFound, 'themes/probe/theme.css': styles, ...articleTheme } = probeTheme;
    assert.ok(home && notFound);
    const siteTheme = validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'");
    const pagesOfBake = createBlog(t, { 'bake.config.js': siteTheme, ...articleTheme, 'themes/probe/theme.css': styles });
    assert.deepEqual(await build(pagesOfBake), []);
    assert.match(readFileSync(join(pagesOfBake, 'dist/index.html'), 'utf8'), /<h1 class="bk-home-title">/);
    assert.match(readFileSync(join(pagesOfBake, 'dist/404.html'), 'utf8'), /<meta name="robots" content="noindex">/);
    assert.deepEqual(await build(createBlog(t, { 'bake.config.js': siteTheme, ...articleTheme })), ['themes/probe:1:1 theme "probe" has no theme.css']);
    const articleOnly = createBlog(t, { 'bake.config.js': validConfig, ...articleTheme, 'content/posts/rope/index.md': article({ extra: 'theme: probe\n' }) });
    assert.deepEqual(await build(articleOnly), []);
    assert.match(readFileSync(join(articleOnly, 'dist/index.html'), 'utf8'), /<h1 class="bk-home-title">/);
  });

  test('reports a homepage that the site theme cannot render at the theme folder', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'"),
      ...probeTheme,
      'themes/probe/home.jsx': "export default function Home() {\n  throw new Error('no cards');\n}\n",
    });
    assert.deepEqual(await build(dir), ['themes/probe:1:1 the probe theme cannot render the homepage: no cards']);
  });
});
