import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { allowedHost, hostName, startDevServer } from '../src/dev/server.js';
import { isWatched } from '../src/dev/watch.js';
import { article, createBlog, readTree, validConfig, writeFiles } from './blog.js';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function eventually(check, message) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(message);
    await wait(20);
  }
}

async function start(t, dir, options = {}) {
  const lines = [];
  const server = await startDevServer(dir, { port: 0, print: (text) => lines.push(...text.split('\n')), ...options });
  t.after(() => server.close());
  return { server, lines, get: (path) => fetch(new URL(path, server.url), { redirect: 'manual' }) };
}

describe('bake dev', () => {
  test('uses the next port when the requested port is in use', async (t) => {
    const blocker = createServer();
    await new Promise((done) => blocker.listen(0, done));
    t.after(() => new Promise((done) => blocker.close(done)));
    const taken = blocker.address().port;
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server, lines } = await start(t, dir, { port: taken });
    assert.ok(server.port > taken, `bake dev listens on ${server.port}, the taken port is ${taken}`);
    assert.equal(lines[0], `Port ${taken} is in use, using port ${server.port}`);
    assert.deepEqual(lines.slice(1), [`Serving the blog at http://localhost:${server.port}/`]);
  });

  test('prints an address other than a loopback or wildcard address as it is, because localhost does not reach it', async (t) => {
    const host = Object.values(networkInterfaces()).flat().find((address) => address.family === 'IPv4' && !address.internal).address;
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server, lines } = await start(t, dir, { host });
    assert.ok(lines.includes(`Serving the blog at http://${host}:${server.port}/`), lines.join('\n'));
  });

  test('listens on the loopback address by default and prints only the local address', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server, lines } = await start(t, dir);
    assert.equal(server.address, '127.0.0.1');
    assert.ok(lines.includes(`Serving the blog at http://localhost:${server.port}/`), lines.join('\n'));
    assert.ok(!lines.some((line) => line.startsWith('On the local network')), lines.join('\n'));
  });

  test('listens on every interface with --host 0.0.0.0 and prints the addresses on the local network', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server, lines } = await start(t, dir, { host: '0.0.0.0' });
    assert.equal(server.address, '0.0.0.0');
    const index = lines.indexOf(`Serving the blog at http://localhost:${server.port}/`);
    assert.ok(index >= 0, lines.join('\n'));
    const network = lines.slice(index + 1).filter((line) => line.startsWith('On the local network'));
    assert.ok(network.every((line) => new RegExp(`^On the local network: http://\\d+\\.\\d+\\.\\d+\\.\\d+:${server.port}/$`).test(line)), lines.join('\n'));
  });

  test('refuses requests whose Host header names another host', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    const { server } = await start(t, dir);
    const send = (path, host, method = 'GET') =>
      new Promise((done, fail) => {
        const request = httpRequest({ host: '127.0.0.1', port: server.port, path, method, headers: { host, 'content-type': 'application/json' }, setHost: false }, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => done([response.statusCode, body]));
        });
        request.on('error', fail);
        request.end(method === 'POST' ? '{}' : undefined);
      });
    const refused = [403, 'bake dev refuses requests for the host evil.example; open the page at localhost or at an IP address'];
    assert.deepEqual(await send('/2026-10/rope/', `evil.example:${server.port}`), refused);
    assert.deepEqual(await send('/__bake/params', `evil.example:${server.port}`, 'POST'), refused);
    assert.deepEqual(await send('/__bake/events', 'evil.example'), refused);
    const withoutHost = await new Promise((done, fail) => {
      const socket = connect(server.port, '127.0.0.1', () => socket.end('GET /2026-10/rope/ HTTP/1.0\r\n\r\n'));
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk;
      });
      socket.on('end', () => done(text));
      socket.on('error', fail);
    });
    assert.match(withoutHost, /^HTTP\/1\.1 403 /);
    assert.ok(withoutHost.endsWith('\r\n\r\nbake dev refuses requests without a Host header'), withoutHost);
    assert.deepEqual(await send('/2026-10/rope/', 'localhost.evil.example'), [403, 'bake dev refuses requests for the host localhost.evil.example; open the page at localhost or at an IP address']);
    for (const host of [`localhost:${server.port}`, 'blog.localhost', `127.0.0.1:${server.port}`, `[::1]:${server.port}`, '192.168.1.20']) {
      assert.equal((await send('/2026-10/rope/', host))[0], 200, host);
    }
  });

  test('accepts the host name given with --host in the Host header, in any letter case', () => {
    assert.equal(allowedHost(hostName('Studio.Lan:4321'), 'studio.lan'), true);
    assert.equal(allowedHost(hostName('studio.lan'), 'Studio.Lan'), true);
    assert.equal(allowedHost(hostName('other.lan:4321'), 'studio.lan'), false);
    assert.equal(allowedHost(hostName('studio.lan.evil.example'), 'studio.lan'), false);
  });

  test('sends HTML pages with headers that allow framing only by bake dev itself and by VS Code', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    const { get } = await start(t, dir);
    for (const path of ['/', '/2026-10/rope/', '/missing/']) {
      const response = await get(path);
      assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'self' vscode-webview: vscode-file:", path);
    }
  });

  test('serves drafts with the page script and lists every article at a missing address', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Text.\n\n## Rotation {#rotation}\n\nMore.\n\n### Angles\n\nAngles.\n' }),
      'content/posts/gelu/index.md': article({ title: 'GELU <draft>', slug: 'gelu', date: '2026-10-20', extra: 'draft: true\n' }),
      'public/robots.txt': 'User-agent: *\n',
    });
    const { get } = await start(t, dir);
    const page = await get('/2026-10/rope/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script type="module" src="\/__bake\/client.js" data-bake-dev /);
    assert.match(await (await get('/2026-10/gelu/')).text(), />Draft<\/span>/);
    assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\n');
    assert.equal((await get('/__bake/client.js')).status, 200);
    const redirect = await get('/2026-10/rope');
    assert.deepEqual([redirect.status, redirect.headers.get('location')], [301, '/2026-10/rope/']);
    const missing = await get('/2026-09/nothing/');
    assert.equal(missing.status, 404);
    const listing = await missing.text();
    assert.match(listing, /<h1>No page at \/2026-09\/nothing\/<\/h1>/);
    assert.match(listing, /<li><a href="\/2026-10\/gelu\/">GELU &lt;draft&gt;<\/a><span[^>]*>2026-10-20<\/span><span[^>]*>Draft<\/span><span[^>]*>content\/posts\/gelu\/index.md<\/span><\/li><li><a href="\/2026-10\/rope\/">Rope<\/a>/);
    assert.match(listing, /<script type="module" src="\/__bake\/client.js"/);
  });

  test('serves the homepage at / with drafts and the page script', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', date: '2026-10-20', extra: 'draft: true\n' }),
    });
    const { get } = await start(t, dir);
    const home = await get('/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /<title>Test Blog<\/title>/);
    assert.match(html, /href="2026-10\/rope\/"/);
    assert.match(html, /href="2026-10\/gelu\/"[\s\S]*<span class="bk-card-draft">Draft<\/span>/);
    assert.match(html, /<head><script type="module" src="\/__bake\/client.js" data-bake-dev><\/script>/);
  });

  test('serves the feed, the sitemap, the theme stylesheet and the 404 page with assets from the root and without drafts', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig.replace("url: 'https://example.com'", "url: 'https://x.github.io/bake'"),
      'content/posts/rope/index.md': article(),
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', date: '2026-10-20', extra: 'draft: true\n' }),
    });
    const { get } = await start(t, dir);
    const feed = await get('/feed.xml');
    assert.equal(feed.headers.get('content-type'), 'application/xml');
    const feedText = await feed.text();
    assert.match(feedText, /<link>https:\/\/x.github.io\/bake\/2026-10\/rope\/<\/link>/);
    assert.doesNotMatch(feedText, /GELU/);
    const sitemap = await (await get('/sitemap.xml')).text();
    assert.match(sitemap, /<loc>https:\/\/x.github.io\/bake\/2026-10\/rope\/<\/loc>/);
    assert.doesNotMatch(sitemap, /gelu/);
    const styles = await get('/_bake/theme.css');
    assert.equal(styles.status, 200);
    assert.match(await styles.text(), /--font-sans:/);
    const notFound = await get('/404.html');
    assert.equal(notFound.status, 200);
    const html = await notFound.text();
    const stylesheet = /<link rel="stylesheet" href="(\/assets\/essay-[\w-]+\.css)">/.exec(html);
    assert.ok(stylesheet, html.slice(0, 1000));
    assert.equal((await get(stylesheet[1])).status, 200);
    assert.match(html, /<li data-url="2026-10\/rope\/" hidden><a href="\/2026-10\/rope\/">Rope<\/a>/);
    assert.doesNotMatch(html, /GELU/);
    assert.match(html, /<head><script type="module" src="\/__bake\/client.js" data-bake-dev><\/script>/);
  });

  test('prints problems as file:line:col lines, sends them to the page and prints when they are fixed', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Text[^missing].\n' }),
    });
    const { server, lines } = await start(t, dir);
    assert.deepEqual(lines.slice(0, 2), ['content/posts/rope/index.md:7:5 footnote "missing" has no definition', '1 error']);
    const response = await fetch(new URL('/__bake/events', server.url));
    const reader = response.body.getReader();
    let events = '';
    while (!events.includes('event: problems')) events += new TextDecoder().decode((await reader.read()).value);
    reader.cancel();
    assert.match(events, /event: problems\ndata: .*content\/posts\/rope\/index.md:7:5 footnote \\"missing\\" has no definition/);
    writeFileSync(join(dir, 'content/posts/rope/index.md'), article({ body: 'Text.\n' }));
    await eventually(() => lines.includes('No problems'), `bake dev printed ${JSON.stringify(lines)}`);
    await eventually(() => lines.some((line) => line.startsWith('Updated ')), `bake dev printed ${JSON.stringify(lines)}`);
  });

  test('writes nothing into the blog folder', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: '![Dot](dot.png)\n' }),
      'content/posts/rope/dot.png': pngBytes,
    });
    const before = Object.keys(readTree(dir));
    const { get } = await start(t, dir);
    assert.equal((await get('/2026-10/rope/dot.webp')).headers.get('content-type'), 'image/webp');
    writeFileSync(join(dir, 'content/posts/rope/index.md'), article({ body: '![Dot](dot.png)\n\nMore.\n' }));
    await eventually(async () => (await (await get('/2026-10/rope/')).text()).includes('More.'), 'the page was not updated');
    assert.deepEqual(Object.keys(readTree(dir)), before);
  });

  test('watches the blog except dist/, node_modules/ and dot files', () => {
    assert.deepEqual(
      ['content/posts/rope/index.md', 'themes/essay/page.jsx', 'bake.config.js', 'dist/index.html', '.git/HEAD', 'content/posts/rope/.index.md.swp', 'components/node_modules/x/index.js', '.dist-staging/a'].map(isWatched),
      [true, true, true, false, false, false, false, false],
    );
  });
});

describe('updates while bake dev runs', () => {
  async function serve(t, files) {
    const dir = createBlog(t, { 'bake.config.js': validConfig, ...files });
    const started = await start(t, dir);
    const text = async (path) => (await started.get(path)).text();
    return { dir, ...started, text };
  }

  async function save(dir, files, check, message) {
    writeFiles(dir, files);
    await eventually(check, message);
  }

  test('compiles a theme again when a file that it imports from another folder under themes/ changes, also when the blog folder is reached through a symbolic link', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': "import { word } from '../common/word.js';\nexport default function Page(props) {\n  return <html><head>{props.assets.styles.map((href) => <link rel=\"stylesheet\" href={href} />)}</head><body><p class=\"word\">{word}</p></body></html>;\n}\n",
      'themes/plain/client.jsx': "import '../common/look.css';\n\nexport default () => () => {};\n",
      'themes/common/word.js': "export const word = 'first';\n",
      'themes/common/look.css': '.word { color: red; }\n',
    });
    const link = join(createBlog(t, {}), 'blog');
    symlinkSync(dir, link);
    const { get } = await start(t, link);
    const page = async () => (await get('/2026-10/rope/')).text();
    const stylesheet = async () => {
      const [, href] = /<link rel="stylesheet" href="([^"]+)">/.exec(await page());
      return (await get(new URL(href, 'http://localhost/2026-10/rope/').pathname)).text();
    };
    assert.match(await page(), /first/);
    await save(dir, { 'themes/common/word.js': "export const word = 'second';\n" }, async () => /second/.test(await page()), 'the imported module was not compiled again');
    await save(dir, { 'themes/common/look.css': '.word { color: blue; }\n' }, async () => /color:\s*#?(blue|00f)/.test(await stylesheet()), 'the imported stylesheet was not compiled again');
  });

  test('keeps every page at its last version without problems while an article has problems, except at the start', async (t) => {
    const { dir, lines, text, get } = await serve(t, {
      'content/posts/rope/index.md': article({ body: 'Rope[^missing].\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'GELU.\n' }),
    });
    assert.equal(lines[0], 'content/posts/rope/index.md:7:5 footnote "missing" has no definition');
    assert.match(await text('/2026-10/rope/'), /Rope/);
    await save(dir, { 'content/posts/rope/index.md': article({ body: 'Rope.\n' }) }, () => lines.at(-1)?.startsWith('Updated '), `bake dev printed ${JSON.stringify(lines)}`);
    await save(
      dir,
      { 'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope[^missing].\n' }), 'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'GELU changed.\n' }) },
      () => lines.at(-2) === 'content/posts/rope/index.md:7:5 footnote "missing" has no definition',
      `bake dev printed ${JSON.stringify(lines)}`,
    );
    assert.match(await text('/2026-10/rope/'), /Rope\./);
    assert.match(await text('/2026-10/gelu/'), /GELU\./);
    assert.equal((await get('/2026-10/rotary/')).status, 404);
    await save(dir, { 'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope.\n' }) }, async () => (await get('/2026-10/rotary/')).status === 200, 'the fixed article was not served');
    assert.match(await text('/2026-10/gelu/'), /GELU changed\./);
    assert.equal((await get('/2026-10/rope/')).status, 404);
  });

  test('shows the unsaved text that an editor sends, and the file again when the text is withdrawn or the file is saved', async (t) => {
    const file = 'content/posts/rope/index.md';
    const { dir, lines, text, server } = await serve(t, { [file]: article({ body: 'Saved text.\n' }) });
    const token = /data-token="([^"]+)"/.exec(await text('/2026-10/rope/'))[1];
    const send = (body, headers = { 'x-bake-token': token }) => fetch(new URL('/__bake/source', server.url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send({ file, text: article({ body: 'Unsaved text.\n' }) })).status, 200);
    await eventually(async () => (await text('/2026-10/rope/')).includes('Unsaved text.'), 'the unsaved text was not served');
    assert.equal(readFileSync(join(dir, file), 'utf8'), article({ body: 'Saved text.\n' }));
    await send({ file, text: article({ body: '\nUnsaved text[^missing].\n' }) });
    await eventually(() => lines.includes(`${file}:8:13 footnote "missing" has no definition`), `bake dev printed ${JSON.stringify(lines)}`);
    await send({ file, text: null });
    await eventually(async () => lines.at(-1) !== '1 error' && (await text('/2026-10/rope/')).includes('Saved text.'), 'the saved file was not served again');
    await send({ file, text: article({ body: 'Unsaved again.\n' }) });
    await eventually(async () => (await text('/2026-10/rope/')).includes('Unsaved again.'), 'the second unsaved text was not served');
    await save(dir, { [file]: article({ body: 'Saved on disk.\n' }) }, async () => (await text('/2026-10/rope/')).includes('Saved on disk.'), 'the saved file did not replace the unsaved text');
    assert.equal((await send({ file, text: 'x' }, {})).status, 403);
    assert.equal((await send({ file: 'content/posts/other/index.md', text: 'x' })).status, 404);
  });

  test('lists the articles with their addresses, and the blocks that an article can use and the attributes of its images and headings, and the fields of its front matter with the options of its theme', async (t) => {
    const { get } = await serve(t, {
      'content/posts/rope/index.md': article({ extra: 'theme: bento\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu' }),
      'content/posts/gelu/components/gelu-plot.js': 'export default class GeluPlot extends HTMLElement {}\n',
      'components/demo-chart.js': "export const params = { fn: { label: 'Function', type: 'enum', options: ['gelu', 'silu'], default: 'gelu' } };\n\nexport default class DemoChart extends HTMLElement {}\n",
    });
    const { articles } = await (await get('/__bake/articles')).json();
    assert.deepEqual(articles.map(({ file, url }) => ({ file, url })), [
      { file: 'content/posts/gelu/index.md', url: '/2026-10/gelu/' },
      { file: 'content/posts/rope/index.md', url: '/2026-10/rope/' },
    ]);
    const { blocks, image, headings } = await (await get('/__bake/syntax?file=content/posts/rope/index.md')).json();
    assert.deepEqual(image.float, { type: 'enum', options: ['left', 'right'] });
    assert.deepEqual(Object.keys(image), ['width', 'height', 'float']);
    assert.ok(Object.hasOwn(headings, 'cols'), JSON.stringify(headings));
    const byName = new Map(blocks.map((block) => [block.name, block]));
    assert.deepEqual(byName.get('fold'), { name: 'fold', kind: 'built-in', attributes: { title: { type: 'text', label: 'text in quotes, for example title="Notes"' } } });
    assert.deepEqual(byName.get('note').attributes.color, { type: 'enum', options: ['yellow', 'green', 'blue', 'pink'] });
    assert.equal(byName.get('note').kind, 'theme');
    assert.deepEqual(byName.get('demo-chart'), { name: 'demo-chart', kind: 'component', attributes: { fn: { label: 'Function', type: 'enum', options: ['gelu', 'silu'], default: 'gelu' } } });
    assert.equal(byName.has('gelu-plot'), false);
    const gelu = await (await get('/__bake/syntax?file=content/posts/gelu/index.md')).json();
    assert.deepEqual(gelu.headings, { toc: { type: 'text' } });
    assert.deepEqual(Object.keys(gelu.frontMatter), ['title', 'slug', 'date', 'updated', 'summary', 'tags', 'preview', 'theme', 'draft', 'cover', 'page', 'toc']);
    assert.deepEqual(gelu.frontMatter.toc, { label: 'Table of contents style', type: 'enum', options: ['notes', 'dots', 'ticks'], default: 'notes' });
    assert.ok(gelu.frontMatter.theme.options.includes('bento'), JSON.stringify(gelu.frontMatter.theme));
    assert.equal(gelu.blocks.some((block) => block.name === 'gelu-plot'), true);
    assert.equal(gelu.blocks.some((block) => block.name === 'note'), false);
    assert.equal((await get('/__bake/syntax?file=content/posts/none/index.md')).status, 404);
  });

  test('keeps every page while bake.config.js has problems and uses the fixed configuration', async (t) => {
    const { dir, lines, text } = await serve(t, { 'content/posts/rope/index.md': article() });
    await save(dir, { 'content/posts/rope/index.md': article({ title: 'Rope again' }) }, async () => /Rope again · Test Blog/.test(await text('/2026-10/rope/')), 'the new title was not served');
    await save(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com' };\n" }, () => lines.includes('bake.config.js:1:16 config is missing "language"'), `bake dev printed ${JSON.stringify(lines)}`);
    assert.match(await text('/2026-10/rope/'), /Rope again · Test Blog/);
    await save(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com', language: 'en' };\n" }, async () => /Rope again · Renamed/.test(await text('/2026-10/rope/')), 'the fixed configuration was not used');
  });
});
