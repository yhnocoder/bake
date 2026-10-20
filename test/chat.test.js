import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { chatTools, matchingScopes, readArticle, READ_ARTICLE, scopeOptions, systemPrompt } from '../src/chat/context.js';
import { chatLabels } from '../src/chat/labels.js';
import { PetError, sheetFile } from '../src/chat/reader-pet.js';
import { answer, MAX_TOOL_ROUNDS } from '../src/chat/conversation.js';
import { ApiError, complete, readEvents } from '../src/chat/deepseek.js';
import { linkTarget, normalizeMath, replyHtml } from '../src/chat/reply.js';
import { openKey, sealKey } from '../src/chat/vault.js';
import { article, bake, createBlog, readTree, validConfig } from './blog.js';

const root = 'https://example.com/blog/';

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
    const name = createHash('sha256').update(join(import.meta.dirname, '..')).digest('hex').slice(0, 16);
    const index = JSON.parse(readFileSync(join(cache, `${name}.json`), 'utf8'));
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
    const result = await complete({ key: 'test-key', messages: [{ role: 'user', content: 'Hi' }], tools: chatTools, thinking: true, fetch, onDelta: (message) => partials.push(message.reasoning_content) });
    assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(requests[0].init.headers.authorization, 'Bearer test-key');
    assert.deepEqual(requests[0].body, { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Hi' }], stream: true, thinking: { type: 'enabled' }, tools: chatTools, tool_choice: 'auto' });
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
      tools: chatTools,
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
    const { turn } = await answer({ key: 'k', system: 'S', history: [], tools: chatTools, thinking: false, fetch, runTool: async (name, args) => (seen.push(args), { content: 'x', label: 'X' }) });
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

  const page = { address: '/2026-10/rope/', title: 'Rope', article: { source: '# Source', outline: [{ id: 'angles', depth: 2, title: 'Angles' }, { id: 'pairs', depth: 3, title: 'Pairs' }] } };

  test('lists every article with its address and sections in the prompt for the whole blog', () => {
    const prompt = systemPrompt({ page: { address: '/', title: 'Test Blog', article: null }, catalog });
    assert.match(prompt, /^You are the reading assistant of the blog "Test Blog" \(Notes\.\)\. The reader is on the page \/\./);
    assert.ok(prompt.includes('{"address":"/2026-10/rope/","title":"Rope","date":"2026-10-19","summary":"Rotary.","sections":["#angles 01 Angles | #pairs Pairs"]}'));
    assert.ok(prompt.includes('{"address":"/2026-09/demo/","title":"Demo","date":"2026-09-05","tags":["html"]}'));
    assert.ok(!prompt.includes('<article'));
  });

  test('puts the source and the headings of the article and then the other articles in the prompt on an article page', () => {
    const prompt = systemPrompt({ page, catalog });
    assert.match(prompt, /^You are the reading assistant of the blog "Test Blog" \(Notes\.\)\. The reader is reading the article "Rope" at \/2026-10\/rope\/\./);
    assert.match(prompt, /\n- #angles Angles\n {2}- #pairs Pairs\n<article>\n# Source\n<\/article>\n/);
    assert.ok(prompt.indexOf('</article>') < prompt.indexOf('{"address":"/2026-09/demo/"'));
  });

  test('offers articles, months, categories and tags as scopes and filters them by the typed text', () => {
    const options = scopeOptions({ ...catalog, articles: [...catalog.articles, { url: '2026-10/gelu/', title: 'GELU', date: '2026-10-02', category: 'ML', tags: ['html', 'act'], sections: [] }] }, chatLabels('zh-CN'));
    assert.deepEqual(
      options.map(({ kind, id, label, meta, urls }) => [kind, id, label, meta, urls.join(' ')]),
      [
        ['article', 'article:2026-10/rope/', 'Rope', '2026-10', '2026-10/rope/'],
        ['article', 'article:2026-09/demo/', 'Demo', '2026-09', '2026-09/demo/'],
        ['article', 'article:2026-10/gelu/', 'GELU', '2026-10', '2026-10/gelu/'],
        ['month', 'month:2026-10', '2026-10', '2 篇', '2026-10/rope/ 2026-10/gelu/'],
        ['month', 'month:2026-09', '2026-09', '1 篇', '2026-09/demo/'],
        ['topic', 'category:ML', 'ML', '分类 · 1 篇', '2026-10/gelu/'],
        ['topic', 'tag:html', '#html', '标签 · 2 篇', '2026-09/demo/ 2026-10/gelu/'],
        ['topic', 'tag:act', '#act', '标签 · 1 篇', '2026-10/gelu/'],
      ],
    );
    assert.deepEqual(
      matchingScopes(options, 'HTML', [options.find((option) => option.id === 'tag:html')]).map((option) => option.id),
      [],
    );
    assert.deepEqual(
      matchingScopes(options, '2026-09', []).map((option) => option.id),
      ['article:2026-09/demo/', 'month:2026-09'],
    );
  });

  test('limits the prompt to the chosen scopes, with the sources of chosen articles and the list of articles in chosen months and topics', () => {
    const options = scopeOptions(catalog, chatLabels('en'));
    const scopes = ['article:2026-10/rope/', 'month:2026-09'].map((id) => options.find((option) => option.id === id));
    const prompt = systemPrompt({ page, catalog, scopes, sources: [{ url: '2026-10/rope/', title: 'Rope', content: '# Rope source' }] });
    assert.match(prompt, /The reader limited the question to Rope, 2026-09\./);
    assert.match(prompt, /<article address="\/2026-10\/rope\/" title="Rope">\n# Rope source\n<\/article>/);
    assert.ok(prompt.includes('{"address":"/2026-09/demo/"'));
    assert.ok(!prompt.includes('{"address":"/2026-10/rope/"'));
    assert.ok(!prompt.includes('# Source'));
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

describe('reader pet sheets', () => {
  const image = (width, height, format, options = {}) =>
    sharp({ create: { width, height, channels: options.alpha === false ? 3 : 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
      [format](options.settings ?? {})
      .toBuffer();

  test('reads the size of a PNG, a lossy, a lossless and an extended WebP sheet from its header and types the blob', async () => {
    for (const [bytes, type, rows] of [
      [await image(1536, 1872, 'png'), 'image/png', 9],
      [await image(1536, 2288, 'webp', { alpha: false }), 'image/webp', 11],
      [await image(1536, 1872, 'webp', { settings: { lossless: true } }), 'image/webp', 9],
      [await image(1536, 2288, 'webp'), 'image/webp', 11],
    ]) {
      const sheet = sheetFile(new Uint8Array(bytes));
      assert.deepEqual([sheet.blob.type, sheet.blob.size, sheet.rows], [type, bytes.length, rows]);
    }
  });

  test('rejects a sheet that is not a PNG or WebP image and reports the size of a sheet of another size', async () => {
    for (const bytes of [await image(1536, 1872, 'jpeg', { alpha: false }), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(0)]) {
      assert.throws(() => sheetFile(new Uint8Array(bytes)), (error) => error instanceof PetError && error.code === 'image');
    }
    for (const [format, settings] of [['png', {}], ['webp', {}], ['webp', { lossless: true }]]) {
      const bytes = await image(192, 208, format, { settings });
      assert.throws(() => sheetFile(new Uint8Array(bytes)), (error) => error instanceof PetError && error.code === 'size' && error.detail === '192x208');
    }
  });
});
