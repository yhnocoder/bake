import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createSite, updateSite } from '../src/build/site.js';
import { siteLink, sitePath } from '../src/build/site-files.js';
import { article, bake, createBlog, validConfig } from './blog.js';

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
  'content/posts/rope/index.md': article({ title: "Rope & <'angles'>", slug: 'rope', date: '2026-10-14', extra: 'category: ml\nsummary: Rotary <positions> & more.\n', body: 'Secret body text.\n' }),
  'content/posts/alpha/index.md': article({ title: 'Alpha', slug: 'alpha', date: '2026-10-14', extra: 'category: notes\n' }),
  'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-09-05\ncategory: notes\nsummary: A page.\npage: demo.html\n---\n',
  'content/posts/demo/demo.html': pageHtml,
  'content/posts/draft/index.md': article({ title: 'Draft', slug: 'draft', date: '2026-10-20', extra: 'category: notes\ndraft: true\n' }),
};

const probeNotFound = {
  'themes/probe/client.jsx': "import './probe.css';\n",
  'themes/probe/probe.css': 'body {\n  margin: 0;\n}\n',
  'themes/probe/theme.css': 'body {\n  color: black;\n}\n',
  'themes/probe/page.jsx': 'export default function Page(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props.article.link)} /></body></html>;\n}\n',
  'themes/probe/home.jsx': 'export default function Home() {\n  return <html><body /></html>;\n}\n',
  'themes/probe/not-found.jsx': 'export default function NotFound(props) {\n  return <html><body><script type="application/json" innerHTML={JSON.stringify(props)} /></body></html>;\n}\n',
};

function built(t, files) {
  const dir = createBlog(t, files);
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  return { dir, read: (path) => readFileSync(join(dir, 'dist', path), 'utf8') };
}

function probed(html) {
  return JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
}

describe('site files', () => {
  test('the address of the site ends with a slash with and without a sub-path', () => {
    assert.equal(siteLink('https://example.com'), 'https://example.com/');
    assert.equal(siteLink('https://example.com/'), 'https://example.com/');
    assert.equal(siteLink('https://x.github.io/bake'), 'https://x.github.io/bake/');
    assert.equal(siteLink('https://x.github.io/bake/'), 'https://x.github.io/bake/');
    assert.equal(sitePath('https://example.com'), '/');
    assert.equal(sitePath('https://x.github.io/bake'), '/bake/');
  });

  test('feed.xml lists the published articles and plain HTML pages newest first with absolute links and summaries only', (t) => {
    const { read } = built(t, blogFiles);
    assert.equal(
      read('feed.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
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

  test('feed.xml uses the site title as the channel description when the site has none', (t) => {
    const { read } = built(t, { 'bake.config.js': validConfig.replace("url: 'https://example.com'", "url: 'https://example.com/'") });
    const feed = read('feed.xml');
    assert.match(feed, /<link>https:\/\/example.com\/<\/link>\n<description>Test Blog<\/description>/);
    assert.match(feed, /<atom:link href="https:\/\/example.com\/feed.xml"/);
    assert.doesNotMatch(feed, /<item>/);
  });

  test('sitemap.xml lists the homepage and every published article and plain HTML page without drafts', (t) => {
    const { read } = built(t, blogFiles);
    assert.equal(
      read('sitemap.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '<url><loc>https://x.github.io/bake/</loc></url>',
        '<url><loc>https://x.github.io/bake/2026-10/alpha/</loc></url>',
        '<url><loc>https://x.github.io/bake/2026-10/rope/</loc></url>',
        '<url><loc>https://x.github.io/bake/2026-09/demo/</loc></url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
  });

  test('drafts stay out of the feed, the sitemap and the 404 page when drafts get pages', async (t) => {
    const dir = createBlog(t, blogFiles);
    const result = await updateSite(createSite(dir, { drafts: true, base: '/' }));
    assert.deepEqual(result.errors, []);
    assert.ok(result.pages.some((page) => page.article.fields.title === 'Draft'));
    for (const output of result.siteFiles) assert.doesNotMatch(String(output.render()), /Draft|2026-10\/draft/, output.path);
  });

  test('the 404 page gets the published articles and asset paths from the base path of the site', (t) => {
    const { read } = built(t, { ...blogFiles, 'bake.config.js': subPathConfig.replace("language: 'en',", "language: 'en',\n  theme: 'probe',"), ...probeNotFound });
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
      assets: { root: '/bake/', styles, fonts: [], scripts },
    });
    assert.equal(probed(read('2026-10/rope/index.html')), 'https://x.github.io/bake/2026-10/rope/');
  });

  test('the essay theme writes a 404 page with absolute asset paths, a hidden list of candidates and a link home', (t) => {
    const { read } = built(t, blogFiles);
    const html = read('404.html');
    assert.match(html, /^<!doctype html>\n<html lang="en" data-theme="system" data-font="sans">/);
    assert.match(html, /<meta name="robots" content="noindex"><title>This page does not exist · Notes &amp; &lt;Models><\/title>/);
    assert.match(html, /<link rel="stylesheet" href="\/bake\/assets\/essay-[\w-]+\.css">/);
    assert.match(html, /<link rel="preload" as="style" href="\/bake\/assets\/fonts-[\w-]+\.css" onload="this.rel='stylesheet'"><noscript><link rel="stylesheet" href="\/bake\/assets\/fonts-[\w-]+\.css"><\/noscript>/);
    assert.match(html, /<script type="module" src="\/bake\/assets\/essay-[\w-]+\.js"><\/script>/);
    assert.match(html, /<main class="bk-not-found" data-root="\/bake\/"><a class="bk-site" href="\/bake\/">Notes &amp; &lt;Models><\/a><h1 class="bk-not-found-title">This page does not exist<\/h1><p class="bk-not-found-path" hidden>/);
    assert.match(html, /<section class="bk-not-found-matches" hidden><h2>You may be looking for:<\/h2><ul><li data-url="2026-10\/alpha\/" hidden><a href="\/bake\/2026-10\/alpha\/">Alpha<\/a>/);
    assert.match(html, /<a class="bk-not-found-home" href="\/bake\/">Back to the homepage →<\/a><\/main>/);
    assert.doesNotMatch(html, /draft/);
  });

  test('reports a 404 page that the site theme cannot render at the theme folder', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig.replace("language: 'en'", "language: 'en', theme: 'probe'"),
      ...probeNotFound,
      'themes/probe/not-found.jsx': "export default function NotFound() {\n  throw new Error('no page');\n}\n",
    });
    assert.equal(bake(dir, 'build').stderr, 'themes/probe:1:1 the probe theme cannot render the 404 page: no page\n1 error, dist/ was not written\n');
  });

  test('the essay theme gives article pages and the homepage Open Graph tags, a canonical address and the feed', (t) => {
    const { read } = built(t, blogFiles);
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

  test('_bake/theme.css holds the fonts and colours of the site theme, and plain HTML pages are published unchanged', (t) => {
    const { dir, read } = built(t, { ...blogFiles, 'themes/essay/styles/tokens.css': ':root {\n  --bg: #123456;\n}\n' });
    const styles = read('_bake/theme.css');
    assert.match(styles, /--bg:#123456/);
    assert.match(styles, /font-family:LXGW WenKai/);
    assert.match(styles, /body\{[^}]*background:var\(--bg\)/);
    const fonts = [...styles.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url);
    assert.ok(fonts.length > 0);
    for (const url of fonts) {
      assert.match(url, /^\.\.\/assets\/[\w.-]+\.woff2$/);
      assert.ok(existsSync(join(dir, 'dist/_bake', url)), url);
    }
    assert.equal(read('2026-09/demo/index.html'), pageHtml);
  });

  test('_bake/theme.css resolves every form of a relative @import in a theme folder against the built-in theme', (t) => {
    const themeCss = [
      '@import url(./styles/fonts.css);',
      "@import url( './styles/tokens.css' );",
      '@import url("./styles/home.css");',
      "@import './styles/not-found.css';",
      '',
    ].join('\n');
    const { read } = built(t, { ...blogFiles, 'themes/essay/theme.css': themeCss });
    const styles = read('_bake/theme.css');
    assert.doesNotMatch(styles, /@import/i);
    assert.match(styles, /font-family:LXGW WenKai/);
    assert.match(styles, /--bg:[^;]*#f5f6f4/);
    assert.match(styles, /\.bk-card-frame\{/);
    assert.match(styles, /\.bk-not-found/);
  });

  test('reports public files at the addresses of the feed, the sitemap, the 404 page and in _bake/', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'public/feed.xml': '<rss/>\n',
      'public/sitemap.xml': '<urlset/>\n',
      'public/404.html': '<p>missing</p>\n',
      'public/_bake/theme.css': 'body {}\n',
      'public/_bake/extra.css': 'body {}\n',
    });
    assert.equal(
      bake(dir, 'build').stderr,
      [
        'public/404.html:1:1 dist/404.html is also written by the 404 page',
        'public/_bake/extra.css:1:1 dist/_bake/ is reserved for the files Bake writes',
        'public/_bake/theme.css:1:1 dist/_bake/theme.css is also written by the essay theme',
        'public/feed.xml:1:1 dist/feed.xml is also written by the RSS feed',
        'public/sitemap.xml:1:1 dist/sitemap.xml is also written by the sitemap',
        '5 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
  });
});
