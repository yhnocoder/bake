import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createSite, updateSite } from '../src/build/site.js';
import { sourceVersion } from '../src/dev/params.js';
import { createPreview } from '../src/dev/preview.js';
import { allowedHost, hostName, startDevServer } from '../src/dev/server.js';
import { isWatched } from '../src/dev/watch.js';
import { formatError } from '../src/report.js';
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

function indexHtml(preview, url) {
  return preview.find(`${url.slice(1)}index.html`).output.render();
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

  test('prints a loopback address other than 127.0.0.1 as it is, because localhost does not reach it', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server, lines } = await start(t, dir, { host: '127.0.0.5' });
    assert.ok(lines.includes(`Serving the blog at http://127.0.0.5:${server.port}/`), lines.join('\n'));
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
    const source = pathToFileURL(join(dir, 'content/posts/rope/index.md')).pathname;
    const outline = JSON.stringify([
      { line: 9, title: '01 Rotation' },
      { line: 13, title: '01 Rotation › Angles' },
    ]).replaceAll('"', '&quot;');
    const version = sourceVersion(readFileSync(join(dir, 'content/posts/rope/index.md'), 'utf8'));
    const token = /data-token="([A-Za-z0-9_-]{43})"/.exec(html)?.[1];
    assert.ok(token, html.slice(-400));
    assert.ok(
      html.includes(
        `<head><script type="module" src="/__bake/client.js" data-bake-dev data-source="${source}" data-file="content/posts/rope/index.md" data-outline="${outline}" data-version="${version}" data-components="{}" data-token="${token}"></script>`,
      ),
      html.slice(0, 600),
    );
    assert.match(html, /<div class="bk-block" data-type="paragraph" data-line="7" data-end-line="7">/);
    assert.match(await (await get('/2026-10/gelu/')).text(), /<span class="bk-draft">Draft<\/span>/);
    assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\n');
    assert.equal((await get('/__bake/client.js')).status, 200);
    const redirect = await get('/2026-10/rope');
    assert.deepEqual([redirect.status, redirect.headers.get('location')], [301, '/2026-10/rope/']);
    const missing = await get('/2026-09/nothing/');
    assert.equal(missing.status, 404);
    const listing = await missing.text();
    assert.match(listing, /<h1>No page at \/2026-09\/nothing\/<\/h1>/);
    assert.match(
      listing,
      /<li><a href="\/2026-10\/gelu\/">GELU &lt;draft&gt;<\/a><span class="date">2026-10-20<\/span><span class="draft">Draft<\/span><span class="file">content\/posts\/gelu\/index.md<\/span><\/li><li><a href="\/2026-10\/rope\/">Rope<\/a>/,
    );
    assert.match(listing, /<head><script type="module" src="\/__bake\/client.js" data-bake-dev data-missing><\/script>/);
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
    assert.match(events, /event: problems\ndata: \[\{"file":"content\/posts\/rope\/index.md","location":"7:5","message":"footnote \\"missing\\" has no definition","position":"content\/posts\/rope\/index.md:7:5","text":"content\/posts\/rope\/index.md:7:5 footnote \\"missing\\" has no definition"\}\]\n\n/);
    writeFileSync(join(dir, 'content/posts/rope/index.md'), article({ body: 'Text.\n' }));
    await eventually(() => lines.includes('No problems'), `bake dev printed ${JSON.stringify(lines)}`);
    await eventually(() => lines.includes('Updated /, /2026-10/rope/'), `bake dev printed ${JSON.stringify(lines)}`);
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

  test('stops with a message when the blog folder can no longer be watched', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const { server } = await start(t, dir);
    rmSync(dir, { recursive: true });
    assert.equal(await server.stopped, `bake dev: cannot watch ${dir}: the folder no longer exists`);
    await assert.rejects(fetch(server.url));
  });

  test('watches the blog except dist/, node_modules/ and dot files', () => {
    assert.deepEqual(
      ['content/posts/rope/index.md', 'themes/essay/page.jsx', 'bake.config.js', 'dist/index.html', '.git/HEAD', 'content/posts/rope/.index.md.swp', 'components/node_modules/x/index.js', '.dist-staging/a'].map(isWatched),
      [true, true, true, false, false, false, false, false],
    );
  });
});

describe('preview updates', () => {
  test('rereads only the changed article, and a theme file change compiles only that theme again and parses no article again', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
      'content/posts/gelu/index.md': article({ slug: 'gelu', extra: 'theme: bento\n' }),
    });
    const site = createSite(dir);
    const first = await updateSite(site);
    const theme = site.themes.get('essay');
    writeFileSync(join(dir, 'content/posts/rope/index.md'), article({ body: 'Changed.\n' }));
    const second = await updateSite(site, ['content/posts/rope/index.md']);
    const byFile = (result) => new Map(result.articles.map((entry) => [entry.file, entry]));
    assert.equal(byFile(second).get('content/posts/gelu/index.md'), byFile(first).get('content/posts/gelu/index.md'));
    assert.notEqual(byFile(second).get('content/posts/rope/index.md'), byFile(first).get('content/posts/rope/index.md'));
    assert.equal(site.themes.get('essay'), theme);
    writeFiles(dir, { 'themes/essay/header.jsx': 'export function Header() {\n  return <header class="custom-header" />;\n}\n' });
    const bento = site.themes.get('bento');
    const third = await updateSite(site, ['themes/essay/header.jsx']);
    assert.notEqual(site.themes.get('essay'), theme);
    assert.equal(site.themes.get('bento'), bento);
    assert.equal(byFile(third).get('content/posts/gelu/index.md'), byFile(second).get('content/posts/gelu/index.md'));
    assert.match(third.pages.find((page) => page.entry.url === '/2026-10/rope/').outputs[0].render(), /<header class="custom-header">/);
    writeFiles(dir, { 'themes/plain/page.jsx': 'export default function Page() {\n  return <html />;\n}\n', 'themes/plain/client.jsx': '' });
    const fourth = await updateSite(site, ['themes/plain/page.jsx', 'themes/plain/client.jsx']);
    assert.notEqual(byFile(fourth).get('content/posts/gelu/index.md'), byFile(third).get('content/posts/gelu/index.md'));
    assert.deepEqual(fourth.errors, []);
  });

  test('compiles a theme again when a file that it imports from another folder under themes/ changes', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': "import { word } from '../common/word.js';\nexport default function Page() {\n  return <html><body><p class=\"word\">{word}</p></body></html>;\n}\n",
      'themes/plain/client.jsx': "import '../common/look.css';\n",
      'themes/common/word.js': "export const word = 'first';\n",
      'themes/common/look.css': '.word { color: red; }\n',
    });
    const site = createSite(dir);
    const render = (result) => result.pages.find((page) => page.entry.url === '/2026-10/rope/').outputs[0].render();
    const stylesheet = (result) => result.assetFiles.filter((file) => file.path.endsWith('.css')).map((file) => String(file.render())).join('\n');
    const first = await updateSite(site);
    assert.deepEqual(first.errors, []);
    assert.match(render(first), /first/);
    writeFiles(dir, { 'themes/common/word.js': "export const word = 'second';\n" });
    assert.match(render(await updateSite(site, ['themes/common/word.js'])), /second/);
    writeFiles(dir, { 'themes/common/look.css': '.word { color: blue; }\n' });
    assert.match(stylesheet(await updateSite(site, ['themes/common/look.css'])), /color:\s*#?(blue|00f)/);
  });

  test('reads the theme options again when the folder of a theme is removed or added as a whole', async (t) => {
    const options = "export const options = { extra: { label: 'Extra', type: 'number', default: 1 } };\n";
    const dir = createBlog(t, {
      'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', themes: { bento: { extra: 2 } } };\n",
      'content/posts/rope/index.md': article(),
      'themes/bento/options.js': options,
    });
    const site = createSite(dir);
    assert.deepEqual((await updateSite(site)).errors, []);
    rmSync(join(dir, 'themes/bento'), { recursive: true });
    const removed = await updateSite(site, ['themes/bento']);
    assert.deepEqual(removed.errors.map(formatError), ['bake.config.js:1:101 unknown config field "themes.bento.extra"']);
    writeFiles(dir, { 'themes/bento/options.js': options });
    assert.deepEqual((await updateSite(site, ['themes/bento'])).errors, []);
  });

  test('compiles the site theme again with the site files when an article theme becomes the site theme', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ extra: 'theme: plain\n' }),
      'themes/plain/page.jsx': 'export default function Page(props) {\n  return <html><body>{props.article.title}</body></html>;\n}\n',
      'themes/plain/client.jsx': '',
    });
    const site = createSite(dir);
    assert.deepEqual((await updateSite(site)).errors, []);
    writeFiles(dir, { 'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', theme: 'plain' };\n" });
    const result = await updateSite(site, ['bake.config.js']);
    assert.deepEqual(result.errors.map(formatError), [
      'themes/plain:1:1 theme "plain" has no home.jsx',
      'themes/plain:1:1 theme "plain" has no not-found.jsx',
      'themes/plain:1:1 theme "plain" has no theme.css',
    ]);
  });

  test('the homepage reloads when the front matter of an article changes or an article is added', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
    });
    const preview = createPreview(dir);
    await preview.update();
    assert.match(indexHtml(preview, '/'), /Rope/);
    writeFiles(dir, { 'content/posts/rope/index.md': article({ body: 'Changed.\n' }) });
    assert.deepEqual(await preview.update(['content/posts/rope/index.md']), { problems: [], applied: true, reload: [], refresh: ['/2026-10/rope/'] });
    writeFiles(dir, { 'content/posts/rope/index.md': article({ title: 'Rope again', body: 'Changed.\n' }) });
    assert.deepEqual(await preview.update(['content/posts/rope/index.md']), { problems: [], applied: true, reload: ['/', '/2026-10/rope/'], refresh: [] });
    assert.match(indexHtml(preview, '/'), /Rope again/);
    writeFiles(dir, { 'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu' }) });
    assert.deepEqual(await preview.update(['content/posts/gelu/index.md']), { problems: [], applied: true, reload: ['/', '/2026-10/gelu/'], refresh: [] });
    assert.match(indexHtml(preview, '/'), /GELU/);
    rmSync(join(dir, 'content/posts/gelu'), { recursive: true });
    assert.deepEqual(await preview.update(['content/posts/gelu/index.md']), { problems: [], applied: true, reload: ['/', '/2026-10/gelu/'], refresh: [] });
    assert.doesNotMatch(indexHtml(preview, '/'), /GELU/);
  });

  test('an article with errors keeps its last good page while other articles update', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Rope.\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'GELU.\n' }),
    });
    const preview = createPreview(dir);
    await preview.update();
    writeFiles(dir, {
      'content/posts/rope/index.md': article({ body: 'Rope[^missing].\n' }),
      'content/posts/gelu/index.md': article({ slug: 'gelu', body: 'GELU changed.\n' }),
    });
    const result = await preview.update(['content/posts/gelu/index.md', 'content/posts/rope/index.md']);
    assert.deepEqual([result.applied, result.reload, result.refresh], [true, [], ['/2026-10/gelu/']]);
    assert.deepEqual(result.problems.map((problem) => problem.file), ['content/posts/rope/index.md']);
    assert.match(indexHtml(preview, '/2026-10/rope/'), /Rope\./);
    assert.match(indexHtml(preview, '/2026-10/gelu/'), /GELU changed\./);
  });

  test('a slug or date change together with a body error keeps the homepage and the site files pointing at the served page', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Rope.\n' }),
    });
    const preview = createPreview(dir);
    await preview.update();
    const served = (path) => preview.find(path).output.render();
    const before = Object.fromEntries(['index.html', 'feed.xml', 'sitemap.xml', '404.html', '_bake/articles.json'].map((path) => [path, served(path)]));
    for (const changed of [{ slug: 'rotary' }, { date: '2026-09-01' }]) {
      writeFiles(dir, { 'content/posts/rope/index.md': article({ ...changed, body: 'Rope[^missing].\n' }) });
      const result = await preview.update(['content/posts/rope/index.md']);
      assert.deepEqual([result.applied, result.reload, result.refresh], [true, [], []]);
      assert.deepEqual(result.problems.map((problem) => problem.file), ['content/posts/rope/index.md']);
      assert.match(indexHtml(preview, '/2026-10/rope/'), /Rope\./);
      for (const [path, text] of Object.entries(before)) assert.equal(served(path), text, path);
    }
    writeFiles(dir, { 'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', body: 'GELU[^missing].\n' }) });
    await preview.update(['content/posts/gelu/index.md']);
    assert.equal(preview.find('2026-10/gelu/index.html'), null);
    for (const [path, text] of Object.entries(before)) assert.equal(served(path), text, path);
    writeFiles(dir, {
      'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope.\n' }),
      'content/posts/gelu/index.md': article({ title: 'GELU', slug: 'gelu', body: 'GELU.\n' }),
    });
    const fixed = await preview.update(['content/posts/gelu/index.md', 'content/posts/rope/index.md']);
    assert.deepEqual([fixed.problems, fixed.reload], [[], ['/', '/2026-10/gelu/', '/2026-10/rope/', '/2026-10/rotary/']]);
    assert.match(served('index.html'), /href="2026-10\/rotary\/"/);
    assert.match(served('index.html'), /href="2026-10\/gelu\/"/);
    assert.doesNotMatch(served('index.html'), /href="2026-10\/rope\/"/);
  });

  test('a slug change made while a component error discards the update keeps the site files pointing at the served page after the component is fixed', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Rope.\n' }),
    });
    const preview = createPreview(dir);
    await preview.update();
    const served = (path) => preview.find(path).output.render();
    const before = Object.fromEntries(['index.html', 'feed.xml', 'sitemap.xml', '404.html', '_bake/articles.json'].map((path) => [path, served(path)]));
    writeFiles(dir, {
      'components/demo-chart.js': 'export default class DemoChart extends HTMLElement {}\n',
      'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope.\n' }),
    });
    const discarded = await preview.update(['components/demo-chart.js', 'content/posts/rope/index.md']);
    assert.deepEqual([discarded.applied, discarded.problems.map((problem) => problem.file)], [false, ['components/demo-chart.js']]);
    rmSync(join(dir, 'components'), { recursive: true });
    writeFiles(dir, { 'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope[^missing].\n' }) });
    const result = await preview.update(['components/demo-chart.js', 'content/posts/rope/index.md']);
    assert.deepEqual([result.applied, result.problems.map((problem) => problem.file)], [true, ['content/posts/rope/index.md']]);
    assert.match(indexHtml(preview, '/2026-10/rope/'), /Rope\./);
    for (const [path, text] of Object.entries(before)) assert.equal(served(path), text, path);
  });

  test('an article whose slug changes together with an error keeps its old address in the listings and in the link check of the articles that link to it', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'Rope.\n' }),
      'content/posts/chain/index.md': article({ title: 'Chain', slug: 'chain', date: '2026-10-01', body: 'See [the rope article](/2026-10/rope/).\n' }),
    });
    const preview = createPreview(dir);
    assert.deepEqual((await preview.update()).problems, []);
    const served = (path) => preview.find(path)?.output.render() ?? null;
    const chain = served('2026-10/chain/index.html');
    for (const body of ['Rope[^missing].\n', 'Rope and [a missing article](/2026-10/missing/).\n']) {
      writeFiles(dir, { 'content/posts/rope/index.md': article({ slug: 'rotary', body }) });
      const result = await preview.update(['content/posts/rope/index.md']);
      assert.deepEqual(result.problems.map((problem) => problem.file), ['content/posts/rope/index.md']);
      assert.deepEqual([result.applied, result.reload, result.refresh], [true, [], []]);
      assert.match(served('2026-10/rope/index.html'), /Rope\./);
      assert.equal(served('2026-10/rotary/index.html'), null);
      assert.equal(served('2026-10/chain/index.html'), chain);
      for (const path of ['index.html', 'feed.xml', 'sitemap.xml', '404.html', '_bake/articles.json']) {
        assert.ok(served(path).includes('2026-10/rope/'), path);
        assert.doesNotMatch(served(path), /rotary/, path);
      }
    }
    writeFiles(dir, { 'content/posts/rope/index.md': article({ slug: 'rotary', body: 'Rope.\n' }) });
    const fixed = await preview.update(['content/posts/rope/index.md']);
    assert.deepEqual(fixed.problems.map(formatError), ['content/posts/chain/index.md:7:5 link target /2026-10/rope/ does not exist']);
    assert.match(served('2026-10/rotary/index.html'), /Rope\./);
    assert.equal(served('2026-10/rope/index.html'), null);
    assert.equal(served('2026-10/chain/index.html'), chain);
  });

  test('an article that only fails because an article it links to fell back to its last good version falls back too, so an article that links to it reports no new error', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/alpha/index.md': article({ title: 'Alpha', slug: 'alpha', body: 'Alpha.\n' }),
      'content/posts/beta/index.md': article({ title: 'Beta', slug: 'beta', body: 'Beta.\n' }),
      'content/posts/gamma/index.md': article({ title: 'Gamma', slug: 'gamma', body: 'See [the beta article](/2026-10/beta/).\n' }),
    });
    const preview = createPreview(dir);
    assert.deepEqual((await preview.update()).problems, []);
    const served = (path) => preview.find(path)?.output.render() ?? null;
    const gamma = served('2026-10/gamma/index.html');
    writeFiles(dir, {
      'content/posts/alpha/index.md': article({ title: 'Alpha', slug: 'alpha-two', body: 'Alpha and [a missing article](/2026-10/missing/).\n' }),
      'content/posts/beta/index.md': article({ title: 'Beta', slug: 'beta-two', body: 'Beta follows [the alpha article](/2026-10/alpha-two/).\n' }),
    });
    const result = await preview.update(['content/posts/alpha/index.md', 'content/posts/beta/index.md']);
    assert.deepEqual(result.problems.map(formatError), [
      'content/posts/alpha/index.md:7:11 link target /2026-10/missing/ does not exist',
      'content/posts/beta/index.md:7:14 link target /2026-10/alpha-two/ does not exist',
    ]);
    assert.match(served('2026-10/alpha/index.html'), /Alpha\./);
    assert.match(served('2026-10/beta/index.html'), /Beta\./);
    assert.equal(served('2026-10/alpha-two/index.html'), null);
    assert.equal(served('2026-10/beta-two/index.html'), null);
    assert.equal(served('2026-10/gamma/index.html'), gamma);
    for (const path of ['index.html', 'feed.xml', 'sitemap.xml', '404.html', '_bake/articles.json']) assert.doesNotMatch(served(path), /alpha-two|beta-two/, path);
  });

  test('a change in one article checks the links of every article again and updates the sections embedded elsewhere', async (t) => {
    const gelu = (heading, text) => article({ title: 'GELU', slug: 'gelu', body: `## ${heading}\n\n${text}\n` });
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article({ body: 'See [the rule](/2026-10/gelu/#chain-rule).\n\n:::embed\n/2026-10/gelu/#chain-rule\n:::\n' }),
      'content/posts/gelu/index.md': gelu('Chain rule', 'First text.'),
    });
    const preview = createPreview(dir);
    assert.deepEqual((await preview.update()).problems, []);
    writeFiles(dir, { 'content/posts/gelu/index.md': gelu('Product rule', 'First text.') });
    const renamed = await preview.update(['content/posts/gelu/index.md']);
    assert.deepEqual(renamed.problems.map(formatError), [
      'content/posts/rope/index.md:7:5 link target /2026-10/gelu/#chain-rule does not exist',
      'content/posts/rope/index.md:10:1 :::embed target /2026-10/gelu/#chain-rule does not exist',
    ]);
    writeFiles(dir, { 'content/posts/gelu/index.md': gelu('Chain rule', 'First text.') });
    assert.deepEqual((await preview.update(['content/posts/gelu/index.md'])).problems, []);
    writeFiles(dir, { 'content/posts/gelu/index.md': gelu('Chain rule', 'Second text.') });
    const changed = await preview.update(['content/posts/gelu/index.md']);
    assert.deepEqual([changed.problems, changed.reload, changed.refresh], [[], [], ['/2026-10/gelu/', '/2026-10/rope/']]);
    assert.match(indexHtml(preview, '/2026-10/rope/'), /<div class="embed">[\s\S]*Second text\./);
  });

  test('a change in components/ reads the components again and bundles them again', async (t) => {
    const chart = (text) => `export const layout = { height: 100 };\n\nexport default class DemoChart extends HTMLElement {\n  connectedCallback() {\n    this.textContent = '${text}';\n  }\n}\n`;
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/demo-chart.js': chart('first text'),
      'content/posts/rope/index.md': article({ body: ':::demo-chart\n:::\n' }),
    });
    const preview = createPreview(dir);
    const chunk = () => {
      const runtime = /<script type="module" src="\.\.\/\.\.\/(assets\/components-[\w-]+\.js)"><\/script>/.exec(indexHtml(preview, '/2026-10/rope/'))[1];
      const name = /demo-chart-[\w-]+\.js/.exec(preview.find(runtime).output.render())[0];
      return preview.find(`assets/${name}`).output.render();
    };
    assert.deepEqual((await preview.update()).problems, []);
    assert.match(chunk(), /first text/);
    const runtime = /<script type="module" src="\.\.\/\.\.\/(assets\/components-[\w-]+\.js)"><\/script>/.exec(indexHtml(preview, '/2026-10/rope/'))[1];
    assert.match(preview.find(runtime).output.render(), /JSON\.parse\("\{\}"\)/, 'bake dev serves without cache headers, so its runtime downloads no component files in advance');
    writeFiles(dir, { 'components/demo-chart.js': chart('second text') });
    const changed = await preview.update(['components/demo-chart.js']);
    assert.deepEqual([changed.problems, changed.reload], [[], 'all']);
    assert.match(chunk(), /second text/);
    writeFiles(dir, { 'components/demo-chart.js': 'export default class DemoChart extends HTMLElement {}\n' });
    const broken = await preview.update(['components/demo-chart.js']);
    assert.deepEqual([broken.applied, broken.problems.map(formatError)], [false, ['components/demo-chart.js:1:1 demo-chart: layout must be an object with at least height, for example export const layout = { height: 360 }, got undefined']]);
  });

  test('front matter changes reload the page, other files reload every page and config errors keep every page', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/rope/index.md': article(),
    });
    const preview = createPreview(dir);
    await preview.update();
    writeFiles(dir, { 'content/posts/rope/index.md': article({ title: 'Rope again' }) });
    assert.deepEqual(await preview.update(['content/posts/rope/index.md']), { problems: [], applied: true, reload: ['/', '/2026-10/rope/'], refresh: [] });
    writeFiles(dir, { 'components/demo-chart.js': 'export const layout = { height: 100 };\n\nexport default function DemoChart() {\n  return null;\n}\n' });
    assert.equal((await preview.update(['components/demo-chart.js'])).reload, 'all');
    writeFiles(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com' };\n" });
    const broken = await preview.update(['bake.config.js']);
    assert.deepEqual([broken.applied, broken.problems.map((problem) => problem.message)], [false, ['config is missing "language"']]);
    assert.match(indexHtml(preview, '/2026-10/rope/'), /Rope again · Test Blog/);
    writeFiles(dir, { 'bake.config.js': "export default { title: 'Renamed', url: 'https://example.com', language: 'en' };\n" });
    assert.equal((await preview.update(['bake.config.js'])).reload, 'all');
    assert.match(indexHtml(preview, '/2026-10/rope/'), /Rope again · Renamed/);
  });
});
