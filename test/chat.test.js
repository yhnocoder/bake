import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { blogPrompt, blogTools, readArticle, READ_ARTICLE, articlePrompt } from '../src/chat/context.js';
import { answer, MAX_TOOL_ROUNDS } from '../src/chat/conversation.js';
import { ApiError, complete, readEvents } from '../src/chat/deepseek.js';
import { linkTarget, normalizeMath, replyHtml } from '../src/chat/reply.js';
import { openKey, sealKey } from '../src/chat/vault.js';
import { article, bake, createBlog, readTree, validConfig } from './blog.js';

const root = 'https://example.com/blog/';
const bakeRoot = join(import.meta.dirname, '..');
const cacheName = createHash('sha256').update(bakeRoot).digest('hex').slice(0, 16);
const BUILD_TOOLS = ['vite', 'rolldown', 'lightningcss', 'vite-plugin-solid', '@babel/core', 'babel-preset-solid', 'babel-plugin-jsx-dom-expressions', 'solid-js'];

function stream(...events) {
  const text = events.map((event) => (typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`)).join('');
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
}

function delta(value, finish = null) {
  return { choices: [{ index: 0, delta: value, finish_reason: finish }] };
}

function fakeFetch(...responses) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return typeof next === 'function' ? next(url) : next;
  };
  return { fetch, requests };
}

describe('AI chat build output', () => {
  test('writes the catalog of published articles and the Markdown source of every article', (t) => {
    const dir = createBlog(t, {
      'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en', description: 'Notes.', categories: [{ id: 'ml', name: 'ML', color: '#2a78d6' }] };\n",
      'content/posts/rope/index.md': article({
        title: 'Rope',
        extra: 'summary: Rotary positions.\ntags: [position]\ncategory: ml\n',
        body: '## Angles\n\nText.\n\n### Pairs\n\nMore.\n\n## Proof {#proof}\n\nEnd.\n',
      }),
      'content/posts/old/index.md': article({ title: 'Old', slug: 'old', date: '2026-08-30', extra: 'category: ml\n' }),
      'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-09-05\ncategory: ml\npage: demo.html\n---\n',
      'content/posts/demo/demo.html': '<p>demo</p>\n',
      'content/posts/draft/index.md': article({ title: 'Draft', slug: 'draft', extra: 'category: ml\ndraft: true\n' }),
    });
    const result = bake(dir, 'build');
    assert.equal(result.stderr, '');
    const tree = readTree(join(dir, 'dist'));
    assert.deepEqual(JSON.parse(tree['_bake/articles.json'].toString()), {
      title: 'Test Blog',
      description: 'Notes.',
      language: 'en',
      articles: [
        {
          url: '2026-10/rope/',
          title: 'Rope',
          date: '2026-10-19',
          summary: 'Rotary positions.',
          tags: ['position'],
          category: 'ML',
          source: '2026-10/rope/index.md',
          sections: [
            { id: 'angles', number: '01', title: 'Angles', subsections: [{ id: 'pairs', title: 'Pairs' }] },
            { id: 'proof', number: '02', title: 'Proof', subsections: [] },
          ],
        },
        { url: '2026-09/demo/', title: 'Demo', date: '2026-09-05', tags: [], category: 'ML', sections: [] },
        { url: '2026-08/old/', title: 'Old', date: '2026-08-30', tags: [], category: 'ML', source: '2026-08/old/index.md', sections: [] },
      ],
    });
    assert.equal(tree['2026-10/rope/index.md'].toString(), readFileSync(join(dir, 'content/posts/rope/index.md'), 'utf8'));
    assert.ok(!Object.hasOwn(tree, '2026-09/demo/index.md'));
    assert.ok(!Object.keys(tree).some((path) => path.includes('draft')));
    const chat = Object.keys(tree).find((path) => /^assets\/chat-[\w-]+\.js$/.test(path));
    assert.match(tree['2026-10/rope/index.html'].toString(), new RegExp(`<script type="module" src="../../${chat}"></script>`));
    assert.match(tree['index.html'].toString(), new RegExp(`<script type="module" src="${chat}"></script>`));
    assert.doesNotMatch(tree['404.html'].toString(), /chat-/);
    assert.equal(tree['2026-09/demo/index.html'].toString(), '<p>demo</p>\n');
  });

  test('writes the preamble for the chat and copies the chat bundle that the cache lists', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'preamble.sty': '\\newcommand{\\R}{\\mathbb{R}}\n', 'content/posts/rope/index.md': article({ body: 'In $\\R$.\n' }) });
    assert.equal(bake(dir, 'build').stderr, '');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'dist/_bake/preamble.json'), 'utf8')), ['\\newcommand{\\R}{\\mathbb{R}}']);
    const cache = join(tmpdir(), 'bake-chat');
    const index = JSON.parse(readFileSync(join(cache, `${cacheName}.json`), 'utf8'));
    assert.ok(index.inputs.some(([file]) => file.endsWith('/src/chat/entry.js')));
    assert.ok(index.inputs.some(([file]) => file.endsWith('/src/components/math.js')));
    assert.equal(readFileSync(join(dir, 'dist', index.entry), 'utf8'), readFileSync(join(cache, index.dir, index.entry), 'utf8'));
  });

  test('writes an empty catalog for a blog without articles', (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    assert.equal(bake(dir, 'build').status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'dist/_bake/articles.json'), 'utf8')), { title: 'Test Blog', language: 'en', articles: [] });
  });
});

function chatCache(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-chat-cache-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildChat(temporary) {
  const script = `const { chatBundle } = await import(${JSON.stringify(pathToFileURL(join(bakeRoot, 'src/chat/bundle.js')).href)});\nawait chatBundle();\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { env: { ...process.env, TMPDIR: temporary }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => (status === 0 ? resolve() : reject(new Error(stderr))));
  });
}

function cacheEntries(temporary) {
  return readdirSync(join(temporary, 'bake-chat')).sort();
}

function cacheIndex(temporary) {
  const path = join(temporary, 'bake-chat', cacheEntries(temporary).find((entry) => entry.endsWith('.json')));
  return { path, index: JSON.parse(readFileSync(path, 'utf8')) };
}

function installedVersion(name) {
  return JSON.parse(readFileSync(join(bakeRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
}

describe('AI chat bundle cache', () => {
  test('two builds that miss the cache at the same time leave one index and one output folder, remove an output folder that a lost build left, and record the versions of the build tools', async (t) => {
    const temporary = chatCache(t);
    const lost = join(temporary, 'bake-chat', `${cacheName}-lost`);
    mkdirSync(lost, { recursive: true });
    writeFileSync(join(lost, 'chat.js'), '');
    await Promise.all([buildChat(temporary), buildChat(temporary)]);
    const { path, index } = cacheIndex(temporary);
    assert.deepEqual(cacheEntries(temporary), [index.dir, basename(path)].sort());
    assert.deepEqual(index.toolchain, Object.fromEntries(BUILD_TOOLS.map((name) => [name, installedVersion(name)])));
  });

  test('builds the chat again when a build tool has another version or src/chat/ holds a file that the index does not list', async (t) => {
    const temporary = chatCache(t);
    await buildChat(temporary);
    const { path, index } = cacheIndex(temporary);
    writeFileSync(path, JSON.stringify({ ...index, toolchain: { ...index.toolchain, vite: '0.0.0' } }));
    await buildChat(temporary);
    assert.equal(cacheIndex(temporary).index.toolchain.vite, installedVersion('vite'));
    const figure = join(bakeRoot, 'src/chat/figure.js');
    writeFileSync(path, JSON.stringify({ ...index, inputs: index.inputs.filter(([file]) => file !== figure) }));
    await buildChat(temporary);
    assert.ok(cacheIndex(temporary).index.inputs.some(([file]) => file === figure));
    assert.equal(cacheEntries(temporary).length, 2);
  });
});

describe('AI chat replies', () => {
  test('renders Markdown with formulas as placeholders that keep their TeX', () => {
    const html = replyHtml('The **norm** is $\\|x\\|$.\n\n$$\na^2 + b^2\n$$\n', { root });
    assert.equal(
      html,
      '<p>The <strong>norm</strong> is <span class="bk-chat-math" data-tex="\\|x\\|">\\|x\\|</span>.</p>\n<div class="bk-chat-math" data-tex="a^2 + b^2" data-display="true">a^2 + b^2</div>',
    );
  });

  test('converts \\( \\) and \\[ \\] delimiters outside code', () => {
    assert.equal(normalizeMath('Inline \\(x^2\\) and `\\(code\\)`.'), 'Inline $x^2$ and `\\(code\\)`.');
    assert.equal(normalizeMath('\\[ \\sum_i x_i \\]'), '\n$$\n\\sum_i x_i\n$$\n');
    assert.equal(normalizeMath('```\n\\[x\\]\n```'), '```\n\\[x\\]\n```');
  });

  test('resolves links against the site root, opens external links in a new tab and drops unsafe ones', () => {
    assert.deepEqual(linkTarget('#angles', root), { href: '#angles', external: false });
    assert.deepEqual(linkTarget('/2026-10/rope/#angles', root), { href: 'https://example.com/blog/2026-10/rope/#angles', external: false });
    assert.deepEqual(linkTarget('2026-10/rope/', root), { href: 'https://example.com/blog/2026-10/rope/', external: false });
    assert.deepEqual(linkTarget('https://arxiv.org/abs/2104.09864', root), { href: 'https://arxiv.org/abs/2104.09864', external: true });
    assert.equal(linkTarget('javascript:alert(1)', root), null);
    assert.equal(linkTarget('//evil.example/', root), null);
    const html = replyHtml('[Rope](/2026-10/rope/) [paper](https://arxiv.org) [bad](javascript:alert(1)) ![pic](x.png) <b onclick="x()">raw</b>', { root });
    assert.equal(
      html,
      '<p><a href="https://example.com/blog/2026-10/rope/">Rope</a> <a href="https://arxiv.org" target="_blank" rel="noopener noreferrer">paper</a> <span>bad</span> pic raw</p>',
    );
  });
});

describe('DeepSeek streaming', () => {
  test('reads server-sent events split across chunks and stops at [DONE]', async () => {
    const encoder = new TextEncoder();
    const parts = ['data: {"a":', '1}\n\nda', 'ta: {"a":2}\n\n: keep-alive\n\ndata: [DONE]\n\ndata: {"a":3}\n\n'];
    const body = new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readEvents(body)) events.push(event);
    assert.deepEqual(events, [{ a: 1 }, { a: 2 }]);
  });

  test('sends the model, the thinking switch and the tools, and collects content, reasoning and tool calls', async () => {
    const { fetch, requests } = fakeFetch(
      stream(
        delta({ reasoning_content: 'Think ' }),
        delta({ reasoning_content: 'more.' }),
        delta({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_', arguments: '{"addr' } }] }),
        delta({ tool_calls: [{ index: 0, function: { name: 'article', arguments: 'ess":"/a/"}' } }] }),
        delta({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ),
    );
    const partials = [];
    const result = await complete({ key: 'test-key', messages: [{ role: 'user', content: 'Hi' }], tools: blogTools, thinking: true, fetch, onDelta: (message) => partials.push(message.reasoning_content) });
    assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(requests[0].init.headers.authorization, 'Bearer test-key');
    assert.deepEqual(requests[0].body, { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Hi' }], stream: true, thinking: { type: 'enabled' }, tools: blogTools, tool_choice: 'auto' });
    assert.deepEqual(partials.slice(0, 2), ['Think ', 'Think more.']);
    assert.deepEqual(result, {
      finish: 'tool_calls',
      message: {
        role: 'assistant',
        content: '',
        reasoning_content: 'Think more.',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_article', arguments: '{"address":"/a/"}' } }],
      },
    });
  });

  test('leaves out tools when there are none and reports the error message of a failed request', async () => {
    const { fetch, requests } = fakeFetch(new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 }));
    await assert.rejects(complete({ key: 'k', messages: [], tools: [], thinking: false, fetch }), (error) => error instanceof ApiError && error.status === 402 && error.message === 'Insufficient Balance');
    assert.deepEqual(requests[0].body, { model: 'deepseek-flash', messages: [], stream: true, thinking: { type: 'disabled' } });
  });
});

describe('AI chat conversation', () => {
  test('runs the tool calls, passes the results and the reasoning back, and joins the text of every round', async () => {
    const { fetch, requests } = fakeFetch(
      stream(delta({ reasoning_content: 'Need it.', content: 'Reading.' }), delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: READ_ARTICLE, arguments: '{"address":"/2026-10/rope/"}' } }] }, 'tool_calls')),
      stream(delta({ content: 'Rope rotates [pairs](/2026-10/rope/#pairs).' }, 'stop')),
    );
    const calls = [];
    const updates = [];
    const { added, turn } = await answer({
      key: 'k',
      system: 'System.',
      history: [{ role: 'user', content: 'What is rope?' }],
      tools: blogTools,
      thinking: true,
      fetch,
      runTool: async (name, args) => {
        calls.push([name, args]);
        return { content: '# Rope', label: 'Rope' };
      },
      onUpdate: (state) => updates.push(state),
    });
    assert.deepEqual(calls, [[READ_ARTICLE, { address: '/2026-10/rope/' }]]);
    assert.deepEqual(requests[1].body.messages, [
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'What is rope?' },
      { role: 'assistant', content: 'Reading.', reasoning_content: 'Need it.', tool_calls: [{ id: 'c1', type: 'function', function: { name: READ_ARTICLE, arguments: '{"address":"/2026-10/rope/"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '# Rope' },
    ]);
    assert.equal(added.length, 3);
    assert.deepEqual(turn, { reasoning: 'Need it.', content: 'Reading.\n\nRope rotates [pairs](/2026-10/rope/#pairs).', reads: [{ name: READ_ARTICLE, label: 'Rope', failed: false, done: true }] });
    assert.ok(updates.some((state) => state.reads.length === 1 && !state.reads[0].done));
    assert.notEqual(updates.at(-1).reads[0], turn.reads[0]);
  });

  test('stops offering tools after the last allowed round', async () => {
    const toolRound = () => stream(delta({ tool_calls: [{ index: 0, id: 'c', function: { name: READ_ARTICLE, arguments: 'not json' } }] }, 'tool_calls'));
    const { fetch, requests } = fakeFetch(...Array.from({ length: MAX_TOOL_ROUNDS }, toolRound), stream(delta({ content: 'Done.' }, 'stop')));
    const seen = [];
    const { turn } = await answer({ key: 'k', system: 'S', history: [], tools: blogTools, thinking: false, fetch, runTool: async (name, args) => (seen.push(args), { content: 'x', label: 'X' }) });
    assert.deepEqual(
      requests.map((request) => request.body.tool_choice),
      [...Array(MAX_TOOL_ROUNDS).fill('auto'), 'none'],
    );
    assert.deepEqual(seen[0], {});
    assert.equal(turn.content, 'Done.');
  });
});

describe('AI chat context', () => {
  const catalog = {
    title: 'Test Blog',
    description: 'Notes.',
    language: 'en',
    articles: [
      { url: '2026-10/rope/', title: 'Rope', date: '2026-10-19', summary: 'Rotary.', tags: [], source: '2026-10/rope/index.md', sections: [{ id: 'angles', number: '01', title: 'Angles', subsections: [{ id: 'pairs', title: 'Pairs' }] }] },
      { url: '2026-09/demo/', title: 'Demo', date: '2026-09-05', tags: ['html'], sections: [] },
    ],
  };

  test('lists every article with its address and sections in the prompt for the whole blog', () => {
    const prompt = blogPrompt({ address: '/', title: 'Test Blog', article: null }, catalog);
    assert.match(prompt, /^You are the reading assistant of the blog "Test Blog" \(Notes\.\)\. The reader is on the page \/\./);
    assert.ok(prompt.includes('{"address":"/2026-10/rope/","title":"Rope","date":"2026-10-19","summary":"Rotary.","sections":["#angles 01 Angles | #pairs Pairs"]}'));
    assert.ok(prompt.includes('{"address":"/2026-09/demo/","title":"Demo","date":"2026-09-05","tags":["html"]}'));
  });

  test('puts the source and the headings of the article in the prompt for one article', () => {
    const prompt = articlePrompt({
      site: 'Test Blog',
      title: 'Rope',
      address: '/2026-10/rope/',
      article: { source: '# Source', outline: [{ id: 'angles', depth: 2, title: 'Angles' }, { id: 'pairs', depth: 3, title: 'Pairs' }] },
    });
    assert.match(prompt, /^You are the reading assistant of the blog "Test Blog"\. The reader is reading the article "Rope" at \/2026-10\/rope\/\./);
    assert.match(prompt, /\n- #angles Angles\n {2}- #pairs Pairs\n<article>\n# Source\n<\/article>$/);
  });

  test('reads an article by its address in any common form and reports unknown addresses', async () => {
    for (const address of ['/2026-10/rope/', '2026-10/rope', 'https://example.com/blog/2026-10/rope/index.html']) {
      const { fetch, requests } = fakeFetch(new Response('# Rope source'));
      assert.deepEqual(await readArticle(root, catalog, address, { fetch }), { content: '# Rope source', label: 'Rope' });
      assert.equal(requests[0].url, 'https://example.com/blog/2026-10/rope/index.md');
    }
    const { fetch } = fakeFetch(new Response('missing', { status: 404 }));
    assert.deepEqual(await readArticle(root, catalog, '/2026-10/rope/', { fetch }), { content: 'The article could not be read: the server answered 404', label: 'Rope', failed: true });
    assert.deepEqual(await readArticle(root, catalog, '/nowhere/', { fetch }), { content: 'There is no article at "/nowhere/". Use an address from the list.', label: '/nowhere/', failed: true });
  });
});

describe('AI chat key storage', () => {
  test('encrypts the key with the passkey secret and decrypts it only with the same secret', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealKey(secret, 'sk-test-0123456789');
    assert.deepEqual(Object.keys(sealed).sort(), ['data', 'iv']);
    assert.ok(!JSON.stringify(sealed).includes('sk-test'));
    assert.match(sealed.iv, /^[\w-]{16}$/);
    assert.equal(await openKey(secret, sealed), 'sk-test-0123456789');
    assert.notEqual((await sealKey(secret, 'sk-test-0123456789')).data, sealed.data);
    await assert.rejects(openKey(crypto.getRandomValues(new Uint8Array(32)), sealed));
  });
});
