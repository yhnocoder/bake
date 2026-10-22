import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, build, createBlog, validConfig } from './blog.js';

const subPathConfig = `export default {
  title: 'Notes & <Models>',
  description: 'Short "notes".',
  url: 'https://x.github.io/bake',
  language: 'en',
  categories: [
    { id: 'ml', name: 'ML & Math', color: '#2a78d6' },
    { id: 'notes', name: 'Notes', color: '#985b57' },
  ],
};
`;

const pageHtml = '<!doctype html>\n<link rel="stylesheet" href="../../_bake/theme.css">\n<p>demo</p>\n';

const blogFiles = {
  'bake.config.js': subPathConfig,
  'content/posts/rope/index.md': article({ title: "Rope & <'angles'>", slug: 'rope', date: '2026-10-14', extra: 'updated: 2026-10-21\ncategory: ml\nsummary: Rotary <positions> & more.\n', body: 'Body text.\n' }),
  'content/posts/alpha/index.md': article({ title: 'Alpha', slug: 'alpha', date: '2026-10-14', extra: 'category: notes\n' }),
  'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-09-05\ncategory: notes\nsummary: A page.\npage: demo.html\n---\n',
  'content/posts/demo/demo.html': pageHtml,
  'content/posts/draft/index.md': article({ title: 'Draft', slug: 'draft', date: '2026-10-20', extra: 'category: notes\ndraft: true\n' }),
};

const probeNotFound = {
  'themes/probe/client.jsx': "import './probe.css';\n\nexport default () => () => {};\n",
  'themes/probe/probe.css': 'body {\n  margin: 0;\n}\n',
  'themes/probe/theme.css': 'body {\n  color: black;\n}\n',
  'themes/probe/page.jsx': 'export default function Page(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props.article.link)} /></body></html>;\n}\n',
  'themes/probe/home.jsx': 'export default function Home() {\n  return <html><body /></html>;\n}\n',
  'themes/probe/not-found.jsx': 'export default function NotFound(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props)} /></body></html>;\n}\n',
};

function essaySiteTheme(themeCss) {
  return {
    'bake.config.js': subPathConfig.replace("language: 'en',", "language: 'en',\n  theme: 'mine',"),
    'themes/mine/page.jsx': "export { Page as default } from 'bake/themes/essay';\n",
    'themes/mine/home.jsx': "export { Home as default } from 'bake/theme';\n",
    'themes/mine/not-found.jsx': "export { NotFound as default } from 'bake/theme';\n",
    'themes/mine/client.jsx': "export { default } from 'bake/themes/essay/client';\n",
    'themes/mine/theme.css': themeCss,
  };
}

async function built(t, files) {
  const dir = createBlog(t, files);
  assert.deepEqual(await build(dir), []);
  return { dir, read: (path) => readFileSync(join(dir, 'dist', path), 'utf8') };
}

function probed(html) {
  return JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
}

describe('site files', () => {
  test('feed.xml lists the published articles and plain HTML pages newest first with absolute links and summaries', async (t) => {
    const { read } = await built(t, blogFiles);
    assert.equal(
      read('feed.xml').replace(/<content:encoded>[\s\S]*?<\/content:encoded>\n/g, ''),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
        '<channel>',
        '<title>Notes &amp; &lt;Models&gt;</title>',
        '<link>https://x.github.io/bake/</link>',
        '<description>Short &quot;notes&quot;.</description>',
        '<language>en</language>',
        '<atom:link href="https://x.github.io/bake/feed.xml" rel="self" type="application/rss+xml"/>',
        '<item>',
        '<title>Alpha</title>',
        '<link>https://x.github.io/bake/2026-10/alpha/</link>',
        '<guid isPermaLink="true">https://x.github.io/bake/2026-10/alpha/</guid>',
        '<pubDate>Wed, 14 Oct 2026 00:00:00 GMT</pubDate>',
        '<category>Notes</category>',
        '</item>',
        '<item>',
        '<title>Rope &amp; &lt;&#x27;angles&#x27;&gt;</title>',
        '<link>https://x.github.io/bake/2026-10/rope/</link>',
        '<guid isPermaLink="true">https://x.github.io/bake/2026-10/rope/</guid>',
        '<pubDate>Wed, 14 Oct 2026 00:00:00 GMT</pubDate>',
        '<category>ML &amp; Math</category>',
        '<description>Rotary &lt;positions&gt; &amp; more.</description>',
        '</item>',
        '<item>',
        '<title>Demo</title>',
        '<link>https://x.github.io/bake/2026-09/demo/</link>',
        '<guid isPermaLink="true">https://x.github.io/bake/2026-09/demo/</guid>',
        '<pubDate>Sat, 05 Sep 2026 00:00:00 GMT</pubDate>',
        '<category>Notes</category>',
        '<description>A page.</description>',
        '</item>',
        '</channel>',
        '</rss>',
        '',
      ].join('\n'),
    );
  });

  test('feed.xml carries the whole text of each Markdown article with its sidenotes and absolute addresses', async (t) => {
    const body = 'See [alpha](/2026-10/alpha/), [the notes](#notes) and [a file](data.txt)[^1].\n\n[^1]: A sidenote.\n\n## Notes\n\nLast words.\n';
    const { read } = await built(t, { ...blogFiles, 'content/posts/rope/index.md': article({ slug: 'rope', date: '2026-10-14', extra: 'category: ml\n', body }), 'content/posts/rope/data.txt': 'x\n' });
    const items = [...read('feed.xml').matchAll(/<item>[\s\S]*?<\/item>/g)].map(([item]) => item);
    const content = /<content:encoded>([\s\S]*?)<\/content:encoded>/.exec(items.find((item) => item.includes('/2026-10/rope/')))[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    assert.match(content, /<p>See <a class="internal-link" href="https:\/\/x\.github\.io\/bake\/2026-10\/alpha\/">alpha<\/a>, <a href="https:\/\/x\.github\.io\/bake\/2026-10\/rope\/#notes">the notes<\/a> and <a href="https:\/\/x\.github\.io\/bake\/2026-10\/rope\/data\.txt">a file<\/a>/);
    assert.match(content, /<h2>Notes<\/h2>\n<p>Last words\.<\/p>\n<ol><li id="sidenote-1"><p>A sidenote\.<\/p><\/li><\/ol>$/);
    assert.doesNotMatch(items.find((item) => item.includes('/2026-09/demo/')), /content:encoded/);
  });

  test('robots.txt allows every page and names the sitemap, unless public/ holds a robots.txt', async (t) => {
    const { read } = await built(t, blogFiles);
    assert.equal(read('robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://x.github.io/bake/sitemap.xml\n');
    const own = await built(t, { ...blogFiles, 'public/robots.txt': 'User-agent: *\nDisallow: /drafts/\n' });
    assert.equal(own.read('robots.txt'), 'User-agent: *\nDisallow: /drafts/\n');
  });

  test('feed.xml uses the site title as the channel description when the site has none', async (t) => {
    const { read } = await built(t, { 'bake.config.js': validConfig.replace("url: 'https://example.com'", "url: 'https://example.com/'") });
    const feed = read('feed.xml');
    assert.match(feed, /<link>https:\/\/example.com\/<\/link>\n<description>Test Blog<\/description>/);
    assert.match(feed, /<atom:link href="https:\/\/example.com\/feed.xml"/);
    assert.doesNotMatch(feed, /<item>/);
  });

  test('sitemap.xml lists the homepage and every published article and plain HTML page without drafts', async (t) => {
    const { read } = await built(t, blogFiles);
    assert.equal(
      read('sitemap.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '<url><loc>https://x.github.io/bake/</loc></url>',
        '<url><loc>https://x.github.io/bake/2026-10/alpha/</loc><lastmod>2026-10-14</lastmod></url>',
        '<url><loc>https://x.github.io/bake/2026-10/rope/</loc><lastmod>2026-10-21</lastmod></url>',
        '<url><loc>https://x.github.io/bake/2026-09/demo/</loc><lastmod>2026-09-05</lastmod></url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
  });

  test('the 404 page gets the published articles and asset paths from the base path of the site', async (t) => {
    const { read } = await built(t, { ...blogFiles, 'bake.config.js': subPathConfig.replace("language: 'en',", "language: 'en',\n  theme: 'probe',"), ...probeNotFound });
    const props = probed(read('404.html'));
    const { styles, scripts } = props.assets;
    assert.equal(styles.length, 1);
    assert.match(styles[0], /^\/bake\/assets\/probe-[\w-]+\.css$/);
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /^\/bake\/assets\/probe-[\w-]+\.js$/);
    assert.deepEqual(props, {
      site: { title: 'Notes & <Models>', url: 'https://x.github.io/bake', language: 'en', description: 'Short "notes".', link: 'https://x.github.io/bake/' },
      options: {},
      articles: [
        { title: 'Alpha', url: '2026-10/alpha/' },
        { title: "Rope & <'angles'>", url: '2026-10/rope/' },
        { title: 'Demo', url: '2026-09/demo/' },
      ],
      assets: { root: '/bake/', styles, scripts },
    });
    assert.equal(probed(read('2026-10/rope/index.html')), 'https://x.github.io/bake/2026-10/rope/');
  });

  test('the essay theme writes a 404 page with absolute asset paths, a hidden list of candidates and a link home', async (t) => {
    const { read } = await built(t, blogFiles);
    const html = read('404.html');
    assert.match(html, /^<!doctype html>\n<html lang="en"/);
    assert.match(html, /<meta name="robots" content="noindex"><title>This page does not exist · Notes &amp; &lt;Models><\/title>/);
    assert.match(html, /<link rel="stylesheet" href="\/bake\/assets\/essay-[\w-]+\.css">/);
    assert.match(html, /<script type="module" src="\/bake\/assets\/essay-[\w-]+\.js"><\/script>/);
    assert.match(html, /<main class="bk-not-found"[^>]*><a class="bk-site" href="\/bake\/">Notes &amp; &lt;Models><\/a><h1 class="bk-not-found-title">This page does not exist<\/h1><p class="bk-not-found-path" hidden>/);
    assert.match(html, /<section class="bk-not-found-matches" hidden><h2>You may be looking for:<\/h2><ul><li data-url="2026-10\/alpha\/" hidden><a href="\/bake\/2026-10\/alpha\/">Alpha<\/a>/);
    assert.match(html, /<a class="bk-not-found-home" href="\/bake\/">Back to the homepage →<\/a><\/main>/);
    assert.doesNotMatch(html, /draft/);
  });

  test('reports a 404 page that the site theme cannot render at the theme folder', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'"),
      ...probeNotFound,
      'themes/probe/not-found.jsx': "export default function NotFound() {\n  throw new Error('no page');\n}\n",
    });
    assert.deepEqual(await build(dir), ['themes/probe:1:1 the probe theme cannot render the 404 page: no page']);
  });

  test('the essay theme gives article pages and the homepage Open Graph tags, a canonical address and the feed', async (t) => {
    const { read } = await built(t, blogFiles);
    const page = read('2026-10/rope/index.html');
    assert.ok(
      page.includes(
        [
          '<link rel="canonical" href="https://x.github.io/bake/2026-10/rope/">',
          '<link rel="alternate" type="application/rss+xml" href="../../feed.xml" title="Notes &amp; <Models>">',
          '<meta property="og:type" content="article">',
          `<meta property="og:title" content="Rope &amp; <'angles'>">`,
          '<meta property="og:description" content="Rotary <positions> &amp; more.">',
          '<meta property="og:url" content="https://x.github.io/bake/2026-10/rope/">',
          '<meta property="og:site_name" content="Notes &amp; <Models>">',
          '<meta property="og:locale" content="en">',
          '<meta name="twitter:card" content="summary_large_image">',
        ].join(''),
      ),
      page.slice(0, 2000),
    );
    assert.doesNotMatch(read('2026-10/alpha/index.html'), /og:description/);
    const home = read('index.html');
    assert.match(home, /<link rel="canonical" href="https:\/\/x.github.io\/bake\/"><link rel="alternate" type="application\/rss\+xml" href=".\/feed.xml" title="Notes &amp; <Models>"><meta property="og:type" content="website"><meta property="og:title" content="Notes &amp; <Models>"><meta property="og:description" content="Short &quot;notes&quot;.">/);
  });

  test('_bake/theme.css holds the colours of the site theme, and plain HTML pages are published unchanged', async (t) => {
    const themeCss = "@import 'bake/theme/styles/tokens.css';\n@import 'bake/theme/styles/base.css';\n\n:root {\n  --bg: #123456;\n}\n";
    const { read } = await built(t, { ...blogFiles, ...essaySiteTheme(themeCss) });
    const styles = read('_bake/theme.css');
    assert.match(styles, /--bg:#123456/);
    assert.match(styles, /body\{[^}]*background:var\(--bg\)/);
    assert.equal(read('2026-09/demo/index.html'), pageHtml);
  });

  test('_bake/theme.css resolves every form of @import of a file in the theme folder and of a stylesheet of bake/theme', async (t) => {
    const themeCss = [
      '@import url(./styles/a.css);',
      "@import url( './styles/b.css' );",
      '@import url("./styles/c.css");',
      "@import './styles/d.css';",
      "@import 'bake/theme/styles/tokens.css';",
      '@import "bake/theme/styles/home.css";',
      '',
    ].join('\n');
    const own = Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [`themes/mine/styles/${name}.css`, `.own-${name} {\n  color: red;\n}\n`]));
    const { read } = await built(t, { ...blogFiles, ...essaySiteTheme(themeCss), ...own });
    const styles = read('_bake/theme.css');
    assert.doesNotMatch(styles, /@import/i);
    assert.match(styles, /\.own-a,\.own-b,\.own-c,\.own-d\{color:red\}/);
    assert.match(styles, /--bg:[^;]*#f5f6f4/);
    assert.match(styles, /\.bk-card-frame\{/);
  });

  test('reports public files at the addresses of the feed, the sitemap, the 404 page and in _bake/', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'public/feed.xml': '<rss/>\n',
      'public/sitemap.xml': '<urlset/>\n',
      'public/404.html': '<p>missing</p>\n',
      'public/_bake/theme.css': 'body {}\n',
      'public/_bake/extra.css': 'body {}\n',
    });
    assert.deepEqual(await build(dir), [
        'public/404.html:1:1 dist/404.html is also written by the 404 page',
        'public/_bake/extra.css:1:1 dist/_bake/ is reserved for the files Bake writes',
        'public/_bake/theme.css:1:1 dist/_bake/theme.css is also written by the essay theme',
        'public/feed.xml:1:1 dist/feed.xml is also written by the RSS feed',
        'public/sitemap.xml:1:1 dist/sitemap.xml is also written by the sitemap',
      ]);
  });
});
