import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { rewriteLine, rewriteSource, sourceVersion } from '../src/dev/params.js';
import { startDevServer } from '../src/dev/server.js';
import { article, createBlog, validConfig } from './blog.js';

const plot = {
  fn: { label: 'Function', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
  range: { label: 'Range', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  beta: { label: 'Beta', type: 'number', min: 0, max: 4, step: 0.1, default: 1 },
  derivative: { label: 'Derivative', type: 'boolean', default: false },
  grid: { label: 'Grid', type: 'boolean', default: true },
  caption: { label: 'Caption', type: 'text', default: 'none' },
  points: { label: 'Points', type: 'file', default: '' },
};
const files = ['index.md', 'points.json'];

function rewrite(text, values) {
  return rewriteLine(text, 'act-fn-plot', plot, values, files);
}

describe('rewriting a component line', () => {
  test('replaces a changed attribute in place and keeps every other byte of the line', () => {
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu   range=6.0 beta=2 width=body}  ', { fn: 'relu', range: 6, beta: 2 }), { line: ':::act-fn-plot{fn=relu   range=6.0 beta=2 width=body}  ' });
    assert.deepEqual(rewrite(':::act-fn-plot{ fn=silu range=6.0 }', { fn: 'silu', range: 6, beta: 1, derivative: false, grid: true, caption: 'none', points: '' }), { line: ':::act-fn-plot{ fn=silu range=6.0 }' });
  });

  test('appends a new attribute at the end and keeps width and height as written', () => {
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu width=body height=420}', { beta: 0.3 }), { line: ':::act-fn-plot{fn=silu width=body height=420 beta=0.3}' });
    assert.deepEqual(rewrite('::::act-fn-plot', { range: 6 }), { line: '::::act-fn-plot{range=6}' });
    assert.deepEqual(rewrite(':::act-fn-plot{}', { range: 6 }), { line: ':::act-fn-plot{range=6}' });
  });

  test('removes a changed parameter whose new value is the default and drops empty braces', () => {
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu range=6 width=body}', { range: 4 }), { line: ':::act-fn-plot{fn=silu width=body}' });
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu range=6}', { fn: 'gelu' }), { line: ':::act-fn-plot{range=6}' });
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu}', { fn: 'gelu' }), { line: ':::act-fn-plot' });
    assert.deepEqual(rewrite(':::act-fn-plot{ fn=silu }', { fn: 'gelu' }), { line: ':::act-fn-plot' });
  });

  test('writes true as a bare name and false only when the default is true', () => {
    assert.deepEqual(rewrite(':::act-fn-plot', { derivative: true }), { line: ':::act-fn-plot{derivative}' });
    assert.deepEqual(rewrite(':::act-fn-plot{derivative fn=silu}', { derivative: false }), { line: ':::act-fn-plot{fn=silu}' });
    assert.deepEqual(rewrite(':::act-fn-plot{derivative=true}', { derivative: true }), { line: ':::act-fn-plot{derivative=true}' });
    assert.deepEqual(rewrite(':::act-fn-plot', { grid: false }), { line: ':::act-fn-plot{grid=false}' });
    assert.deepEqual(rewrite(':::act-fn-plot{grid=false}', { grid: true }), { line: ':::act-fn-plot' });
  });

  test('writes numbers in their shortest form', () => {
    assert.deepEqual(rewrite(':::act-fn-plot', { beta: 0.3, range: 10 }), { line: ':::act-fn-plot{beta=0.3 range=10}' });
    assert.deepEqual(rewrite(':::act-fn-plot{range=abc}', { range: 5 }), { line: ':::act-fn-plot{range=5}' });
  });

  test('quotes text only when it needs quotes', () => {
    assert.deepEqual(rewrite(':::act-fn-plot', { caption: 'GELU' }), { line: ':::act-fn-plot{caption=GELU}' });
    assert.deepEqual(rewrite(':::act-fn-plot', { caption: 'Two words' }), { line: ':::act-fn-plot{caption="Two words"}' });
    assert.deepEqual(rewrite(':::act-fn-plot', { caption: "it's a=b {x}" }), { line: ':::act-fn-plot{caption="it\'s a=b {x}"}' });
    assert.deepEqual(rewrite(':::act-fn-plot', { caption: 'say "hi"' }), { line: ":::act-fn-plot{caption='say \"hi\"'}" });
    assert.deepEqual(rewrite(':::act-fn-plot{caption="x y"}', { caption: '' }), { line: ':::act-fn-plot{caption=""}' });
    assert.deepEqual(rewrite(':::act-fn-plot', { points: 'points.json' }), { line: ':::act-fn-plot{points=points.json}' });
  });

  test('finds the directive after blockquote markers and indentation', () => {
    assert.deepEqual(rewrite('> > :::act-fn-plot{fn=silu}', { fn: 'relu' }), { line: '> > :::act-fn-plot{fn=relu}' });
    assert.deepEqual(rewrite('  :::act-fn-plot', { range: 2 }), { line: '  :::act-fn-plot{range=2}' });
  });

  test('refuses values that the declaration does not accept', () => {
    assert.deepEqual(rewrite(':::act-fn-plot', { bta: 2 }), { error: 'unknown parameter "bta" for act-fn-plot' });
    assert.deepEqual(rewrite(':::act-fn-plot', { range: 20 }), { error: 'parameter "range" of act-fn-plot must be between 1 and 10, got 20' });
    assert.deepEqual(rewrite(':::act-fn-plot', { range: '5' }), { error: 'parameter "range" of act-fn-plot must be a number, got "5"' });
    assert.deepEqual(rewrite(':::act-fn-plot', { fn: 'tanh' }), { error: 'parameter "fn" of act-fn-plot must be one of relu, gelu or silu, got "tanh"' });
    assert.deepEqual(rewrite(':::act-fn-plot', { derivative: 'yes' }), { error: 'parameter "derivative" of act-fn-plot must be true or false, got "yes"' });
    assert.deepEqual(rewrite(':::act-fn-plot', { points: '../points.json' }), { error: 'parameter "points" of act-fn-plot must be a file in the article folder, got "../points.json"' });
    assert.deepEqual(rewrite(':::act-fn-plot', { caption: `"it's"` }), { error: 'parameter "caption" of act-fn-plot cannot be written as an attribute, because its text contains both " and \'' });
  });

  test('refuses a line that does not start the block or whose attributes cannot be read', () => {
    assert.deepEqual(rewrite('Text before :::act-fn-plot', { range: 2 }), { error: 'the line does not start a :::act-fn-plot block: Text before :::act-fn-plot' });
    assert.deepEqual(rewrite(':::glu-heatmap{range=2}', { range: 3 }), { error: 'the line does not start a :::act-fn-plot block: :::glu-heatmap{range=2}' });
    assert.deepEqual(rewrite('::act-fn-plot', { range: 3 }), { error: 'the line does not start a :::act-fn-plot block: ::act-fn-plot' });
    assert.deepEqual(rewrite(':::act-fn-plot text', { range: 3 }), { error: 'cannot read the attributes of :::act-fn-plot: :::act-fn-plot text' });
    assert.deepEqual(rewrite(':::act-fn-plot{fn="silu}', { range: 3 }), { error: 'cannot read the attributes {fn="silu}; write them as {#id key=value key="text with spaces"}' });
    assert.deepEqual(rewrite(':::act-fn-plot{fn=silu fn=relu}', { range: 3 }), { error: 'attribute "fn" is written twice' });
  });

  test('changes only the given line of the source and keeps its line ending', () => {
    const source = 'Text.\r\n\r\n:::act-fn-plot{fn=silu}\r\nCaption.\r\n:::\r\n';
    assert.deepEqual(rewriteSource(source, 3, 'act-fn-plot', plot, { fn: 'relu' }, files), {
      line: ':::act-fn-plot{fn=relu}',
      source: 'Text.\r\n\r\n:::act-fn-plot{fn=relu}\r\nCaption.\r\n:::\r\n',
    });
    assert.deepEqual(rewriteSource(source, 9, 'act-fn-plot', plot, { fn: 'relu' }, files), { error: 'the file has no line 9' });
  });
});

const labelView = `export const params = {
  text: { label: 'Text', type: 'text', default: 'none' },
  size: { label: 'Size', type: 'number', min: 1, max: 9, default: 3 },
};
export const layout = { height: 80 };

export default class LabelView extends HTMLElement {
  connectedCallback() {
    this.textContent = this.params.text;
  }
}
`;
const FILE = 'content/posts/live/index.md';

describe('the parameter endpoint of bake dev', () => {
  async function start(t) {
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'components/label-view.js': labelView,
      [FILE]: article({ title: 'Live', slug: 'live', body: 'Before.\n\n:::label-view{text=first size=2}\nCaption.\n:::\n' }),
    });
    const server = await startDevServer(dir, { port: 0, print: () => {} });
    t.after(() => server.close());
    const page = await (await fetch(new URL('2026-10/live/', server.url))).text();
    const version = /data-version="([0-9a-f]+)"/.exec(page)[1];
    const token = /<script src="\/__bake\/client.js" data-bake-dev [^>]*data-token="([^"]+)"/.exec(page)[1];
    const post = async (body, headers = {}) => {
      const response = await fetch(new URL('/__bake/params', server.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-bake-token': token, ...headers }, body: JSON.stringify(body) });
      return [response.status, await response.json()];
    };
    const request = (fields, headers) => post({ file: FILE, version, line: 9, name: 'label-view', params: { text: 'first', size: 2 }, write: false, ...fields }, headers);
    return { dir, server, page, version, token, post, request, read: () => readFileSync(join(dir, FILE), 'utf8') };
  }

  test('gives the page the version of its source and the declarations of its components', async (t) => {
    const { page, version, read } = await start(t);
    assert.equal(version, sourceVersion(read()));
    const components = JSON.stringify({ 'label-view': { text: { label: 'Text', type: 'text', default: 'none' }, size: { label: 'Size', type: 'number', min: 1, max: 9, default: 3 } } });
    assert.ok(page.includes(` data-components="${components.replaceAll('"', '&quot;')}"`), page.slice(-600));
    assert.match(page, /<figure class="component" data-component="label-view" data-params="[^"]*" data-attributes="[^"]*" data-line="9">/);
  });

  test('returns the rewritten line for Copy without writing the file', async (t) => {
    const { request, read, version } = await start(t);
    const before = read();
    assert.deepEqual(await request({ params: { text: 'two words', size: 2 } }), [200, { line: ':::label-view{text="two words" size=2}', version }]);
    assert.equal(read(), before);
  });

  test('writes the rewritten line into the file and returns the new version', async (t) => {
    const { request, read } = await start(t);
    const [status, data] = await request({ params: { text: 'first', size: 5 }, write: true });
    assert.equal(status, 200);
    assert.equal(read(), article({ title: 'Live', slug: 'live', body: 'Before.\n\n:::label-view{text=first size=5}\nCaption.\n:::\n' }));
    assert.deepEqual(data, { line: ':::label-view{text=first size=5}', version: sourceVersion(read()) });
  });

  test('refuses with 409 when the file changed after the page was built', async (t) => {
    const { dir, request, read } = await start(t);
    writeFileSync(join(dir, FILE), read().replace('Before.', 'Before, edited.'));
    const changed = read();
    assert.deepEqual(await request({ params: { text: 'first', size: 5 }, write: true }), [409, { error: `${FILE} changed after this page was built; save it in your editor and try again` }]);
    assert.equal(read(), changed);
  });

  test('refuses files that are not articles of the preview, unknown components, invalid values and other methods', async (t) => {
    const { server, token, request } = await start(t);
    assert.deepEqual(await request({ file: 'bake.config.js' }), [404, { error: '"bake.config.js" is not an article that bake dev serves' }]);
    assert.deepEqual(await request({ file: '../../etc/passwd' }), [404, { error: '"../../etc/passwd" is not an article that bake dev serves' }]);
    assert.deepEqual(await request({ name: 'other-view' }), [400, { error: 'unknown component "other-view"' }]);
    assert.deepEqual(await request({ params: { size: 12 } }), [400, { error: `${FILE}:9 parameter "size" of label-view must be between 1 and 9, got 12` }]);
    assert.deepEqual(await request({ line: 7 }), [400, { error: `${FILE}:7 the line does not start a :::label-view block: Before.` }]);
    const response = await fetch(new URL('/__bake/params', server.url));
    assert.deepEqual([response.status, await response.json()], [405, { error: 'send the parameters with POST' }]);
    const broken = await fetch(new URL('/__bake/params', server.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-bake-token': token }, body: '{' });
    assert.equal(broken.status, 400);
  });

  test('refuses requests without the token of the run, with or without an Origin header, and writes nothing', async (t) => {
    const { server, token, read, post, version } = await start(t);
    const before = read();
    const body = { file: FILE, version, line: 9, name: 'label-view', params: { text: 'first', size: 5 }, write: true };
    const refused = [403, { error: 'the request does not carry the token of this bake dev run; reload the page' }];
    const response = await fetch(new URL('/__bake/params', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual([response.status, await response.json()], refused);
    assert.deepEqual(await post(body, { 'x-bake-token': '' }), refused);
    assert.deepEqual(await post(body, { 'x-bake-token': '', origin: new URL(server.url).origin }), refused);
    assert.deepEqual(await post(body, { 'x-bake-token': 'wrong' }), refused);
    assert.deepEqual(await post(body, { 'x-bake-token': `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}` }), refused);
    assert.equal(read(), before);
    assert.equal((await post(body))[0], 200);
    assert.notEqual(read(), before);
  });

  test('gives every run its own token', async (t) => {
    const first = await start(t);
    const second = await start(t);
    assert.notEqual(first.token, second.token);
    const body = { file: FILE, version: first.version, line: 9, name: 'label-view', params: { text: 'first', size: 5 }, write: true };
    assert.equal((await first.post(body, { 'x-bake-token': second.token }))[0], 403);
    assert.equal(first.read(), article({ title: 'Live', slug: 'live', body: 'Before.\n\n:::label-view{text=first size=2}\nCaption.\n:::\n' }));
  });

  test('refuses requests from another origin and requests that are not JSON', async (t) => {
    const { server, request, read } = await start(t);
    const before = read();
    const write = { params: { text: 'first', size: 5 }, write: true };
    const forbidden = [403, { error: 'parameters can only be sent from a page that bake dev serves' }];
    assert.deepEqual(await request(write, { origin: 'http://attacker.example' }), forbidden);
    assert.deepEqual(await request(write, { origin: `http://localhost:${server.port + 1}` }), forbidden);
    assert.deepEqual(await request(write, { origin: 'null' }), forbidden);
    assert.deepEqual(await request(write, { 'content-type': 'text/plain' }), [415, { error: 'send the parameters as application/json' }]);
    assert.equal(read(), before);
    assert.deepEqual((await request({}, { origin: new URL(server.url).origin }))[0], 200);
  });

  test('compares the origin with the Host header without regard to letter case', async (t) => {
    const { server, token, version } = await start(t);
    const body = JSON.stringify({ file: FILE, version, line: 9, name: 'label-view', params: { text: 'first', size: 2 }, write: false });
    const status = await new Promise((done, fail) => {
      const headers = { host: `LocalHost:${server.port}`, origin: `http://localhost:${server.port}`, 'content-type': 'application/json', 'x-bake-token': token };
      const sent = httpRequest({ host: '127.0.0.1', port: server.port, path: '/__bake/params', method: 'POST', headers, setHost: false }, (response) => {
        response.resume();
        response.on('end', () => done(response.statusCode));
      });
      sent.on('error', fail);
      sent.end(body);
    });
    assert.equal(status, 200);
  });
});
