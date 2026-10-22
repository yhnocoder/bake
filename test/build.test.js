import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fromHtml } from 'hast-util-from-html';
import sharp from 'sharp';
import { article, build, builtExample, createBlog, readTree, validConfig } from './blog.js';
import { withoutCopySource } from './article.js';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const plainPage = `import { For } from 'solid-js';

export default function Page(props) {
  return (
    <html lang={props.site.language}>
      <head>
        <For each={props.assets.styles}>{(href) => <link rel="stylesheet" href={href} />}</For>
        <For each={props.assets.scripts}>{(src) => <script type="module" src={src} />}</For>
      </head>
      <body>
        <main innerHTML={props.article.content.intro.map((block) => block.html).join('')} />
      </body>
    </html>
  );
}
`;

const siteFiles = ['404.html', '_bake/articles.json', '_bake/pet/LICENSE.txt', '_bake/pet/frame.webp', '_bake/pet/pet.json', '_bake/pet/spritesheet.webp', '_bake/preamble.json', '_bake/theme.css', 'feed.xml', 'sitemap.xml'];

function articleFiles(tree) {
  return Object.keys(tree).filter((path) => !path.startsWith('assets/') && !path.startsWith('og/') && !siteFiles.includes(path));
}

function stagingFolders(dir) {
  return readdirSync(dir).filter((name) => name.startsWith('.dist-'));
}

describe('bake build', () => {
  test('writes published articles, their files and public/ into a fresh dist/', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/2026-10/rope/index.md': article({ title: 'RoPE <&> "quotes"', extra: "summary: Rotary & 'position' <embeddings>\n" }),
      'content/posts/2026-10/rope/figure.png': pngBytes,
      'content/posts/2026-10/rope/data/angles.json': '[1, 2]\n',
      'content/posts/drafts/gelu/index.md': article({ slug: 'gelu', extra: 'draft: true\n' }),
      'content/posts/series/index.md': article({ title: 'Series', slug: 'series', date: '2026-09-01' }),
      'content/posts/series/part-1/index.md': article({ title: 'Part 1', slug: 'part-1', date: '2026-09-02' }),
      'content/posts/series/part-1/plot.svg': '<svg/>\n',
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<!doctype html><p>demo</p>\n',
      'content/posts/demo/demo.js': 'export {};\n',
      'public/CNAME': 'example.com\n',
      'public/icons/favicon.svg': '<svg/>\n',
      'dist/stale.html': 'stale\n',
      'dist/2026-10/rope/old.png': pngBytes,
    });
    assert.deepEqual(await build(dir), []);
    const tree = readTree(join(dir, 'dist'));
    assert.ok(siteFiles.every((path) => Object.hasOwn(tree, path)));
    assert.deepEqual(
      Object.keys(tree)
        .filter((path) => path.startsWith('og/'))
        .map((path) => path.replace(/-[0-9a-f]{12}\.png$/, '')),
      ['og/2026-09/part-1', 'og/2026-09/series', 'og/2026-10/rope'],
    );
    assert.deepEqual(articleFiles(tree), [
      'CNAME',
      'index.html',
      '2026-08/demo/demo.js',
      '2026-08/demo/index.html',
      '2026-09/part-1/index.html',
      '2026-09/part-1/index.md',
      '2026-09/part-1/plot.svg',
      '2026-09/series/index.html',
      '2026-09/series/index.md',
      '2026-10/rope/data/angles.json',
      '2026-10/rope/figure.png',
      '2026-10/rope/index.html',
      '2026-10/rope/index.md',
      'icons/favicon.svg',
    ].sort());
    const page = withoutCopySource(tree['2026-10/rope/index.html'].toString());
    assert.match(page, /^<!doctype html>\n<html lang="en"/);
    assert.match(page, /<title>RoPE &lt;&amp;> "quotes" · Test Blog<\/title>/);
    assert.match(page, /<meta name="description" content="Rotary &amp; 'position' <embeddings>">/);
    assert.match(page, /<h1[^>]*>RoPE &lt;&amp;> "quotes"<\/h1>/);
    assert.match(page, /<p[^>]*>Rotary &amp; 'position' &lt;embeddings><\/p>/);
    assert.match(page, /<p>Text\.<\/p>/);
    assert.match(tree['2026-09/series/index.html'].toString(), /<h1[^>]*>Series<\/h1>/);
    const assets = Object.keys(tree).filter((path) => path.startsWith('assets/'));
    assert.equal(assets.filter((path) => /^assets\/essay-[\w-]+\.js$/.test(path)).length, 1);
    assert.equal(assets.filter((path) => /^assets\/essay-[\w-]+\.css$/.test(path)).length, 1);
    assert.equal(assets.filter((path) => /^assets\/chat-[\w-]+\.js$/.test(path)).length, 1);
    for (const path of assets.filter((asset) => /^assets\/(essay|chat)-[\w-]+\.(js|css)$/.test(asset))) assert.ok(page.includes(`../../${path}`), `the page links ${path}`);
    assert.equal(tree['2026-10/rope/index.md'].toString(), readFileSync(join(dir, 'content/posts/2026-10/rope/index.md'), 'utf8'));
    assert.deepEqual(tree['2026-10/rope/figure.png'], pngBytes);
    assert.equal(tree['2026-08/demo/index.html'].toString(), '<!doctype html><p>demo</p>\n');
    assert.equal(tree.CNAME.toString(), 'example.com\n');
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('keeps a page file already named index.html', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: index.html\n---\n',
      'content/posts/demo/index.html': '<p>demo</p>\n',
    });
    assert.deepEqual(await build(dir), []);
    assert.deepEqual(articleFiles(readTree(join(dir, 'dist'))), ['2026-08/demo/index.html', 'index.html']);
  });

  test('reports a URL that another article already uses at the later slug', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/2026-10/rope/index.md': article({ date: '2026-10-01' }),
      'content/posts/llm/rope/index.md': article({ date: '2026-10-19' }),
    });
    assert.deepEqual(await build(dir), ['content/posts/llm/rope/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/2026-10/rope/index.md']);
  });

  test('checks drafts for duplicate URLs', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/a/index.md': article({ extra: 'draft: true\n' }),
      'content/posts/b/index.md': article(),
    });
    assert.deepEqual(await build(dir), ['content/posts/b/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/a/index.md']);
  });

  test('publishes the other articles while a draft has errors', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/a/index.md': article({ slug: 'a', extra: 'draft: true\n', body: 'Unfinished $\\frc{1}{2}$ and [a link](/2026-10/nowhere/).\n' }),
      'content/posts/b/index.md': article({ slug: 'b' }),
    });
    assert.deepEqual(await build(dir), []);
    assert.ok(existsSync(join(dir, 'dist/2026-10/b/index.html')));
    assert.ok(!existsSync(join(dir, 'dist/2026-10/a')));
  });

  test('reports every error sorted by file and position and leaves dist/ unchanged', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/b/index.md': '---\ntitle: B\nslug: B\ndate: 2026-10-19\ntoc: sidebar\nlayout: wide\n---\n',
      'content/posts/a/index.md': '---\ntitle: A\ndate: 2026-10-32\n---\n',
      'content/posts/c/index.md': '# No front matter\n',
      'content/posts/d/index.md': article({ slug: 'd' }),
      'public/2026-10/d/index.html': 'shadow\n',
      'dist/index.html': 'previous build\n',
    });
    const before = readTree(join(dir, 'dist'));
    assert.deepEqual(await build(dir), [
        'content/posts/a/index.md:1:1 front matter is missing "slug"',
        'content/posts/a/index.md:3:7 date must be a date in the form YYYY-MM-DD, got "2026-10-32"',
        'content/posts/b/index.md:3:7 slug "B" may only contain lowercase letters, digits and "-"',
        'content/posts/b/index.md:5:6 toc must be one of notes, dots or ticks, got "sidebar"',
        'content/posts/b/index.md:6:1 unknown front matter field "layout"',
        'content/posts/c/index.md:1:1 index.md must start with front matter between two --- lines',
        'content/posts/c/index.md:1:1 heading level 1 is not allowed; the article title comes from front matter, sections start at ##',
        'public/2026-10/d/index.html:1:1 dist/2026-10/d/index.html is also written by content/posts/d/index.md',
    ]);
    assert.deepEqual(readTree(join(dir, 'dist')), before);
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('does not create dist/ when there are errors', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/a/index.md': '---\ntitle: A\n---\n' });
    assert.notDeepEqual(await build(dir), []);
    assert.equal(existsSync(join(dir, 'dist')), false);
  });

  test('reports a broken options.js of a theme together with the other problems of bake.config.js', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': "export default {\n  title: 'Test Blog', url: 'https://example.com', language: 'en',\n  toc: 'x',\n  themes: { mine: { density: 2 } },\n};\n",
      'themes/mine/options.js': 'export const options = { a: 1 };\n',
      'content/posts/rope/index.md': article(),
    });
    assert.deepEqual(await build(dir), [
        `bake.config.js:3:3 unknown config field "toc"; toc is an option of the essay theme, written as themes.essay.toc, such as themes: { essay: { toc: 'notes' } }`,
        `themes/mine/options.js:1:1 mine: option "a" must be declared as an object such as { label: 'Range', type: 'number', default: 4 }, got 1`,
    ]);
  });

  test('reports a public file that needs a folder where an article writes a file', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'public/2026-10/rope/index.html/extra.txt': 'x\n',
    });
    assert.deepEqual(await build(dir), ['public/2026-10/rope/index.html/extra.txt:1:1 dist/2026-10/rope/index.html/extra.txt conflicts with dist/2026-10/rope/index.html written by content/posts/rope/index.md']);
  });

  test('reports an index.html next to a Markdown article', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/rope/index.html': '<p>x</p>\n',
    });
    assert.deepEqual(await build(dir), ['content/posts/rope/index.md:1:1 index.html in the article folder conflicts with the page generated from index.md']);
  });

  test('reports an index.html next to a page article whose page has another name', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-08-05\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/demo/index.html': '<p>other</p>\n',
    });
    assert.deepEqual(await build(dir), ['content/posts/demo/index.md:5:7 page "demo.html" is published as index.html, which conflicts with index.html in the article folder']);
  });

  test('reports a missing bake.config.js', async (t) => {
    const dir = createBlog(t, { 'content/posts/rope/index.md': article() });
    assert.deepEqual(await build(dir), ['bake.config.js:1:1 bake.config.js not found, run bake from the blog root or create a blog with bake init']);
  });

  test('checks articles against the categories in bake.config.js', async (t) => {
    const config = "export default {\n  title: 'T',\n  url: 'https://example.com',\n  language: 'en',\n  categories: [{ id: 'ml', name: 'ML', color: '#336699' }],\n};\n";
    const dir = createBlog(t, {
      'bake.config.js': config,
      'content/posts/a/index.md': article({ slug: 'a', extra: 'category: ml\n' }),
      'content/posts/b/index.md': article({ slug: 'b', extra: 'category: math\n' }),
      'content/posts/c/index.md': article({ slug: 'c' }),
    });
    assert.deepEqual(await build(dir), [
        'content/posts/b/index.md:5:11 category "math" is not one of the categories in bake.config.js',
    ]);
  });

  test('puts an article without a category into the category "default", which bake.config.js may define', async (t) => {
    const categories = "{ id: 'ml', name: 'Machine learning', color: '#336699' }";
    const config = (list) => `export default {\n  title: 'T',\n  url: 'https://example.com',\n  language: 'en',\n  categories: [${list}],\n};\n`;
    const dir = createBlog(t, { 'bake.config.js': config(categories), 'content/posts/c/index.md': article({ slug: 'c' }), 'content/posts/d/index.md': article({ slug: 'd', extra: 'category: default\n' }) });
    assert.deepEqual(await build(dir), []);
    assert.equal(readFileSync(join(dir, 'dist/feed.xml'), 'utf8').match(/<category>Default<\/category>/g).length, 2);
    writeFileSync(join(dir, 'bake.config.js'), config(`${categories}, { id: 'default', name: 'Notes', color: '#993366' }`));
    assert.deepEqual(await build(dir), []);
    assert.equal(readFileSync(join(dir, 'dist/feed.xml'), 'utf8').match(/<category>Notes<\/category>/g).length, 2);
  });

  test('builds the example blog', async (t) => {
    const dir = await builtExample();
    const page = withoutCopySource(readFileSync(join(dir, 'dist/2026-10/syntax/index.html'), 'utf8'));
    assert.match(page, /<h1[^>]*>Bake 写法一览<\/h1>/);
    assert.match(page, /<mjx-container class="MathJax" jax="SVG"[^>]*data-tex="x \\in \\R\^d">/);
    assert.match(page, /<pre class="shiki bake"[^>]*data-language="python">/);
    assert.ok(page.includes(`href="../../2026-10/syntax-linked/#${encodeURIComponent('链式法则')}"`));
    assert.ok(existsSync(join(dir, 'dist/2026-10/syntax/relu.svg')));
    assert.match(page, /<h2[^>]*>链式法则<\/h2>/);
    for (const url of ['2026-10/syntax-linked', '2026-10/jacobian', '2026-10/activations', '2026-09/llm-act-fns', '2026-09/matrix-calculus', '2026-09/html-page']) assert.ok(existsSync(join(dir, 'dist', url, 'index.html')), url);
  });
  test('publishes raster images as WebP and copies the original only when a link points to it', async (t) => {
    const photo = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#985b57' } }).png().toBuffer();
    const small = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).jpeg().toBuffer();
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: '![Angles](angles.png)\n\n![Small](small.jpg)\n\n[Full size](small.jpg)\n' }),
      'content/posts/rope/angles.png': photo,
      'content/posts/rope/small.jpg': small,
    });
    assert.deepEqual(await build(dir), []);
    const tree = readTree(join(dir, 'dist'));
    assert.deepEqual(articleFiles(tree), ['2026-10/rope/angles.webp', '2026-10/rope/index.html', '2026-10/rope/index.md', '2026-10/rope/small.jpg', '2026-10/rope/small.webp', 'index.html']);
    assert.deepEqual(tree['2026-10/rope/small.jpg'], small);
    assert.deepEqual(await sharp(tree['2026-10/rope/angles.webp']).metadata().then(({ format, width, height }) => [format, width, height]), ['webp', 2680, 893]);
    assert.match(withoutCopySource(tree['2026-10/rope/index.html'].toString()), /<img src="angles.webp" alt="Angles" width="2680" height="893" loading="lazy" decoding="async">/);
    assert.doesNotMatch(tree['2026-10/rope/index.html'].toString(), /mjx/i);
  });

  test('reports preamble.sty errors and does not check the articles', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'preamble.sty': '\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\bad}[x]{y}\n\\usepackage{tikz}\n',
      'content/posts/rope/index.md': article({ body: '$\\undefined$\n' }),
    });
    assert.deepEqual(await build(dir), [
        'preamble.sty:2:1 MathJax cannot read this definition: Illegal number of parameters specified in \\newcommand',
        'preamble.sty:3:1 \\usepackage cannot be used in preamble.sty, which accepts \\newcommand, \\renewcommand, \\DeclareMathOperator, \\def, \\let, \\newenvironment, \\renewenvironment, \\ProvidesPackage and \\RequirePackage',
    ]);
  });

  test('removes staging folders left by an interrupted build', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      '.dist-staging/2026-10/rope/index.html': 'half written\n',
      '.dist-previous/old.html': 'old\n',
    });
    assert.deepEqual(await build(dir), []);
    assert.deepEqual(stagingFolders(dir), []);
  });

  test('skips dotfiles in article folders, keeps dotfiles in public/ except .DS_Store, and does not follow symlinked folders', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/rope/.DS_Store': 'finder\n',
      'content/posts/rope/.cache/data.json': '{}\n',
      'content/posts/rope/figure.svg': '<svg/>\n',
      'public/.DS_Store': 'finder\n',
      'public/.nojekyll': '',
      'public/.well-known/security.txt': 'Contact: mailto:a@example.com\n',
      'outside.txt': 'outside\n',
    });
    symlinkSync('..', join(dir, 'content/posts/rope/loop'));
    symlinkSync('../outside.txt', join(dir, 'public/linked.txt'));
    assert.deepEqual(await build(dir), []);
    assert.deepEqual(articleFiles(readTree(join(dir, 'dist'))), [
      '.nojekyll',
      '.well-known/security.txt',
      '2026-10/rope/figure.svg',
      '2026-10/rope/index.html',
      '2026-10/rope/index.md',
      'index.html',
      'linked.txt',
    ].sort());
    assert.equal(readFileSync(join(dir, 'dist/linked.txt'), 'utf8'), 'outside\n');
  });

  test('gives every address of a file whose name holds #, ?, % or a space a target that exists in dist/', async (t) => {
    const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();
    const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#985b57"/></svg>\n';
    const files = [
      '## Files',
      '',
      '![Photo](a%231.png) and ![Vector](d%20e.svg)',
      '',
      '[Data](b%3F1.json) and [the preview](c%251.js).',
      '',
      ':::x-plot{points="a#1.png"}',
      ':::',
      '',
      ':::x-plot{points="b?1.json"}',
      ':::',
      '',
      '## Raw HTML',
      '',
      '<p><img src="d%20e.svg" srcset="d%20e.svg 1x, a%231.webp 2x" alt=""> <a href="b%3F1.json">data</a></p>',
      '',
    ].join('\n');
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/x-plot.js': "export const params = { points: { label: 'Points', type: 'file', default: '' } };\nexport const layout = { height: 100 };\nexport default class extends HTMLElement {}\n",
      'content/posts/files/index.md': article({ title: 'Files', slug: 'files', extra: 'preview: c%1.js\n', body: files }),
      'content/posts/files/a#1.png': photo,
      'content/posts/files/b?1.json': '[1, 2]\n',
      'content/posts/files/c%1.js': 'export default function draw(element) {\n  element.textContent = "preview";\n  return { start() {}, stop() {} };\n}\n',
      'content/posts/files/d e.svg': vector,
      'content/posts/host/index.md': article({ title: 'Host', slug: 'host', date: '2026-10-18', extra: 'cover: d e.svg\n', body: '![Cover](d%20e.svg)\n\n:::embed\n/2026-10/files/#files\n:::\n' }),
      'content/posts/host/d e.svg': vector,
      'content/posts/plain/index.md': article({ title: 'Plain', slug: 'plain', date: '2026-10-17', extra: 'theme: "plain#1 %"\n' }),
      'themes/plain#1 %/page.jsx': plainPage,
      'themes/plain#1 %/client.jsx': "import './plain.css';\n\nexport default () => () => {};\n",
      'themes/plain#1 %/plain.css': 'main { color: #985b57; }\n',
    });
    assert.deepEqual(await build(dir), []);
    const site = 'https://example.com/';
    const tree = readTree(join(dir, 'dist'));
    const missing = [];
    const addresses = [];
    for (const path of Object.keys(tree).filter((file) => file.endsWith('.html'))) {
      const check = (kind, address) => {
        const url = new URL(address, new URL(path, site));
        if (url.origin !== new URL(site).origin) return;
        const file = decodeURIComponent(url.pathname.slice(1));
        const target = file === '' || file.endsWith('/') ? `${file}index.html` : file;
        addresses.push(`${path} ${kind} ${address}`);
        if (!Object.hasOwn(tree, target)) missing.push(`${path} ${kind} ${address}`);
      };
      const visit = (node) => {
        const properties = node.properties ?? {};
        if (typeof properties.src === 'string') check('src', properties.src);
        if (typeof properties.href === 'string') check('href', properties.href);
        if (typeof properties.srcSet === 'string') for (const candidate of properties.srcSet.split(',')) check('srcset', candidate.trim().split(/\s+/)[0]);
        if (typeof properties.dataPreview === 'string') check('data-preview', properties.dataPreview);
        if (node.tagName === 'meta' && (properties.property === 'og:image' || properties.name === 'twitter:image')) check('og:image', properties.content);
        if (properties.dataComponent === 'x-plot' && JSON.parse(properties.dataParams).points !== '') check('data-params', JSON.parse(properties.dataParams).points);
        for (const child of [...(node.children ?? []), ...(node.content?.children ?? [])]) visit(child);
      };
      visit(fromHtml(tree[path].toString()));
    }
    assert.deepEqual(missing, []);
    for (const expected of [
      '2026-10/files/index.html src a%231.webp',
      '2026-10/files/index.html src d%20e.svg',
      '2026-10/files/index.html srcset a%231.webp',
      '2026-10/files/index.html href b%3F1.json',
      '2026-10/files/index.html href c%251.js',
      '2026-10/files/index.html data-params a%231.png',
      '2026-10/files/index.html data-params b%3F1.json',
      '2026-10/files/index.html og:image https://example.com/og/2026-10/files-',
      '2026-10/host/index.html og:image https://example.com/og/2026-10/host-',
      '2026-10/host/index.html src d%20e.svg',
      '2026-10/host/index.html src ../../2026-10/files/a%231.webp',
      '2026-10/host/index.html href ../../2026-10/files/b%3F1.json',
      '2026-10/host/index.html data-params ../../2026-10/files/a%231.png',
      '2026-10/plain/index.html href ../../assets/plain_1%20_-',
      '2026-10/plain/index.html src ../../assets/plain_1%20_-',
      'index.html data-preview 2026-10/files/c%251.js',
      'index.html src 2026-10/host/d%20e.svg',
    ]) {
      assert.ok(addresses.some((address) => address.startsWith(expected)), `${expected} is not among the addresses ${addresses.join(', ')}`);
    }
  });
});
