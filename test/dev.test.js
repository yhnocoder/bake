import assert from 'node:assert/strict';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  test('sends HTML pages with headers that refuse framing by other sites', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article() });
    const { get } = await start(t, dir);
    for (const path of ['/', '/2026-10/rope/', '/missing/']) {
      const response = await get(path);
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', path);
      assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'self'", path);
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
    assert.match(await styles.text(), /font-family:LXGW WenKai/);
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

  test('serves a saved article, a nested article and a changed theme file and leaves the other pages as they were', async (t) => {
    const mine = 'theme: mine\n';
    const { dir, text } = await serve(t, {
      'content/posts/rope/index.md': article({ extra: mine }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', extra: 'theme: bento\n', body: '## One\n\nGELU text.\n' }),
      'content/posts/rope/inner/index.md': article({ slug: 'inner', extra: mine, body: 'Inner.\n' }),
      'themes/mine/page.jsx': [
        "import { ArticleDocument, labelsFor } from 'bake/theme';",
        "import { Article } from 'bake/themes/essay';",
        "import { Header } from './header.jsx';",
        '',
        'export default function Page(props) {',
        '  const labels = labelsFor(props.site.language);',
        '  return (',
        '    <ArticleDocument site={props.site} article={props.article} assets={props.assets} labels={labels}>',
        '      <Header />',
        '      <Article content={props.article.content} labels={labels} />',
        '    </ArticleDocument>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'themes/mine/header.jsx': 'export function Header() {\n  return <header class="first-header" />;\n}\n',
      'themes/mine/client.jsx': "export { default } from 'bake/themes/essay/client';\n",
    });
    await save(dir, { 'content/posts/rope/index.md': article({ extra: mine, body: 'Changed.\n' }) }, async () => (await text('/2026-10/rope/')).includes('Changed.'), 'the saved article was not served');
    await save(dir, { 'content/posts/rope/inner/index.md': article({ slug: 'inner', extra: mine, body: 'Inner changed.\n' }) }, async () => (await text('/2026-10/inner/')).includes('Inner changed.'), 'the nested article was not served');
    await save(dir, { 'themes/mine/header.jsx': 'export function Header() {\n  return <header class="custom-header" />;\n}\n' }, async () => (await text('/2026-10/rope/')).includes('custom-header'), 'the changed theme file was not used');
    const gelu = await text('/2026-10/gelu/');
    assert.match(gelu, /GELU text\./);
    assert.doesNotMatch(gelu, /custom-header/);
  });

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

  test('reports the options of a theme folder that is removed or added as a whole', async (t) => {
    const options = "export const options = { extra: { label: 'Extra', type: 'number', default: 1 } };\n";
    const dir = createBlog(t, {
      'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', themes: { mine: { extra: 2 } } };\n",
      'content/posts/rope/index.md': article(),
      'themes/mine/options.js': options,
    });
    const { lines } = await start(t, dir);
    await save(dir, { 'themes/mine/options.js': options }, async () => lines.includes('Updated every page') || lines.some((line) => line.startsWith('Updated ')), 'bake dev did not watch the theme folder');
    rmSync(join(dir, 'themes/mine'), { recursive: true });
    await eventually(() => lines.includes('bake.config.js:1:92 themes.mine names no theme; the themes are essay, bento'), `bake dev printed ${JSON.stringify(lines)}`);
    await save(dir, { 'themes/mine/options.js': options }, () => lines.at(-1) === 'No problems' || lines.slice(-2).includes('No problems'), `bake dev printed ${JSON.stringify(lines)}`);
  });

  test('reports the missing files of a theme that becomes the site theme', async (t) => {
    const { dir, lines } = await serve(t, {
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': 'export default function Page(props) {\n  return <html><body>{props.article.title}</body></html>;\n}\n',
      'themes/plain/client.jsx': 'export default () => () => {};\n',
    });
    await save(dir, { 'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', theme: 'plain' };\n" }, () => lines.includes('3 errors'), `bake dev printed ${JSON.stringify(lines)}`);
    assert.deepEqual(lines.slice(-4), ['themes/plain:1:1 theme "plain" has no home.jsx', 'themes/plain:1:1 theme "plain" has no not-found.jsx', 'themes/plain:1:1 theme "plain" has no theme.css', '3 errors']);
  });

  test('updates the homepage when the front matter of an article changes and when an article is added or removed', async (t) => {
    const { dir, text } = await serve(t, { 'content/posts/rope/index.md': article() });
    assert.match(await text('/'), /Rope/);
    await save(dir, { 'content/posts/rope/index.md': article({ title: 'Rope again' }) }, async () => (await text('/')).includes('Rope again'), 'the homepage did not show the new title');
    await save(dir, { 'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu' }) }, async () => (await text('/')).includes('GELU'), 'the homepage did not show the added article');
    rmSync(join(dir, 'content/posts/gelu'), { recursive: true });
    await eventually(async () => !(await text('/')).includes('GELU'), 'the homepage still shows the removed article');
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

  test('checks the links of every article again after a change in one article and updates the sections embedded elsewhere', async (t) => {
    const gelu = (heading, text) => article({ title: 'GELU', slug: 'gelu', body: `## ${heading}\n\n${text}\n` });
    const { dir, lines, text } = await serve(t, {
      'content/posts/rope/index.md': article({ body: 'See [the rule](/2026-10/gelu/#chain-rule).\n\n:::embed\n/2026-10/gelu/#chain-rule\n:::\n' }),
      'content/posts/gelu/index.md': gelu('Chain rule', 'First text.'),
    });
    await save(dir, { 'content/posts/gelu/index.md': gelu('Product rule', 'First text.') }, () => lines.includes('2 errors'), `bake dev printed ${JSON.stringify(lines)}`);
    assert.deepEqual(lines.slice(-3), ['content/posts/rope/index.md:7:5 link target /2026-10/gelu/#chain-rule does not exist', 'content/posts/rope/index.md:10:1 :::embed target /2026-10/gelu/#chain-rule does not exist', '2 errors']);
    await save(dir, { 'content/posts/gelu/index.md': gelu('Chain rule', 'Second text.') }, async () => (await text('/2026-10/rope/')).includes('Second text.'), 'the embedded section was not updated');
    assert.ok(lines.includes('No problems'), lines.join('\n'));
  });

  test('bundles a changed component again and reports a broken one', async (t) => {
    const chart = (text) => `export const layout = { height: 100 };\n\nexport default class DemoChart extends HTMLElement {\n  connectedCallback() {\n    this.textContent = '${text}';\n  }\n}\n`;
    const { dir, lines, get } = await serve(t, { 'components/demo-chart.js': chart('first text'), 'content/posts/rope/index.md': article({ body: ':::demo-chart\n:::\n' }) });
    const chunk = async () => {
      const runtime = /<script type="module" src="\.\.\/\.\.\/(assets\/components-[\w-]+\.js)"><\/script>/.exec(await (await get('/2026-10/rope/')).text())[1];
      const name = /demo-chart-[\w-]+\.js/.exec(await (await get(`/${runtime}`)).text())[0];
      return (await get(`/assets/${name}`)).text();
    };
    assert.match(await chunk(), /first text/);
    await save(dir, { 'components/demo-chart.js': chart('second text') }, async () => /second text/.test(await chunk()), 'the changed component was not bundled again');
    await save(dir, { 'components/demo-chart.js': "export const layout = { height: 100, frame: 'no' };\n\nexport default class DemoChart extends HTMLElement {}\n" }, () => lines.includes('1 error'), `bake dev printed ${JSON.stringify(lines)}`);
    assert.equal(lines.at(-2), 'components/demo-chart.js:1:38 demo-chart: layout.frame must be true or false, got "no"');
  });

  test('keeps every page while bake.config.js has problems and uses the fixed configuration', async (t) => {
    const { dir, lines, text } = await serve(t, { 'content/posts/rope/index.md': article() });
    await save(dir, { 'content/posts/rope/index.md': article({ title: 'Rope again' }) }, async () => /Rope again · Test Blog/.test(await text('/2026-10/rope/')), 'the new title was not served');
    await save(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com' };\n" }, () => lines.includes('bake.config.js:1:16 config is missing "language"'), `bake dev printed ${JSON.stringify(lines)}`);
    assert.match(await text('/2026-10/rope/'), /Rope again · Test Blog/);
    await save(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com', language: 'en' };\n" }, async () => /Rope again · Renamed/.test(await text('/2026-10/rope/')), 'the fixed configuration was not used');
  });
});
