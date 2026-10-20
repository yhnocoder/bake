import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chatTools, matchingScopes, readArticle, READ_ARTICLE, scopeOptions, systemPrompt } from '../src/chat/context.js';
import { chatLabels } from '../src/chat/labels.js';
import { PetError, sheetFile } from '../src/chat/reader-pet.js';
import { answer, MAX_TOOL_ROUNDS } from '../src/chat/conversation.js';
import { ApiError, complete, readEvents } from '../src/chat/deepseek.js';
import { HISTORY_LIMIT, deleteConversation, historyGroups, historyKey, readHistory, roundMessages, saveConversation, storedRound } from '../src/chat/history.js';
import { checkNote, citedEntries, exportMarkdown, noteFileName, noteHtml, notePrompt, noteTitle } from '../src/chat/note.js';
import { linkTarget, replyHtml } from '../src/chat/reply.js';
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
    const figure = join(bakeRoot, 'src/chat/pet.js');
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

  test('reads \\( \\) and \\[ \\] delimiters as formulas outside code, also across lines and next to escaped backslashes', () => {
    const math = (tex, display = false) => `<${display ? 'div' : 'span'} class="bk-chat-math" data-tex="${tex}"${display ? ' data-display="true"' : ''}>${tex}</${display ? 'div' : 'span'}>`;
    assert.equal(replyHtml('Inline \\(x^2\\) and `\\(code\\)`.', { root }), `<p>Inline ${math('x^2')} and <code>\\(code\\)</code>.</p>`);
    assert.equal(replyHtml('\\[ \\sum_i x_i \\]', { root }), math('\\sum_i x_i', true));
    assert.equal(replyHtml('\\[\na \\\\\nb\n\\]', { root }), math('a \\\\\nb', true));
    assert.equal(replyHtml('So \\[x\\] here.', { root }), `<p>So ${math('x', true).replace(/div/g, 'span')} here.</p>`);
    assert.equal(replyHtml('```\n\\[x\\]\n```', { root }), '<pre><code>\\[x\\]\n</code></pre>');
    assert.equal(replyHtml('An open \\(x stays text.', { root }), '<p>An open (x stays text.</p>');
    assert.equal(replyHtml('An empty \\(\\) and \\[ ] stay text.', { root }), '<p>An empty () and [ ] stay text.</p>');
    assert.equal(replyHtml('Blank \\( \\) and \\[\n\\] stay text.', { root }), '<p>Blank ( ) and [\n] stay text.</p>');
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
        return { content: '# Rope', label: 'Rope', url: '2026-10/rope/' };
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
    assert.deepEqual(turn, { reasoning: 'Need it.', content: 'Reading.\n\nRope rotates [pairs](/2026-10/rope/#pairs).', reads: [{ name: READ_ARTICLE, label: 'Rope', url: '2026-10/rope/', failed: false, done: true }] });
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
    const quoted = systemPrompt({ page, catalog, scopes, sources: [{ url: '2026-10/rope/', title: 'Rope "and" <RoPE> & co', content: '' }] });
    assert.match(quoted, /<article address="\/2026-10\/rope\/" title="Rope &quot;and&quot; &lt;RoPE&gt; &amp; co">/);
  });

  test('reads an article by its address in any common form and reports unknown addresses', async () => {
    for (const address of ['/2026-10/rope/', '2026-10/rope', 'https://example.com/blog/2026-10/rope/index.html']) {
      const { fetch, requests } = fakeFetch(new Response('# Rope source'));
      assert.deepEqual(await readArticle(root, catalog, address, { fetch }), { content: '# Rope source', label: 'Rope', url: '2026-10/rope/' });
      assert.equal(requests[0].url, 'https://example.com/blog/2026-10/rope/index.md');
    }
    const { fetch } = fakeFetch(new Response('missing', { status: 404 }));
    assert.deepEqual(await readArticle(root, catalog, '/2026-10/rope/', { fetch }), { content: 'The article could not be read: the server answered 404', label: 'Rope', url: '2026-10/rope/', failed: true });
    assert.deepEqual(await readArticle(root, catalog, '/nowhere/', { fetch }), { content: 'There is no article at "/nowhere/". Use an address from the list.', label: '/nowhere/', failed: true });
  });
});

describe('AI chat notes', () => {
  const catalog = {
    title: 'Test Blog',
    articles: [
      { url: '2026-10/rope/', title: 'Rope', date: '2026-10-19', tags: [], sections: [{ id: 'angles', number: '01', title: 'Angles', subsections: [{ id: 'pairs', title: 'Pairs' }] }, { id: '定义', number: '02', title: '定义', subsections: [] }] },
      { url: '2026-09/demo/', title: 'Demo', date: '2026-09-05', tags: [], sections: [] },
      { url: '2026-08/gelu/', title: 'GELU', date: '2026-08-05', tags: [], sections: [] },
    ],
  };
  const labels = chatLabels('zh');
  const round = (content, extra = {}) => ({ ask: { content: 'Q', scopes: [], bubble: { text: 'Q', quote: null, scopes: [] } }, content, reasoning: '', reads: [], ...extra });

  test('keeps the links to articles and sections of the blog, turns the others into text and counts the cited articles', () => {
    const markdown = [
      '# Rope',
      '',
      '- One [Rope §01](/2026-10/rope/#angles), [pairs](#pairs) and [定义](https://example.com/blog/2026-10/rope/#%E5%AE%9A%E4%B9%89).',
      '- Two [Demo](2026-09/demo/) and [missing](/2026-10/missing/) and [no section](/2026-10/rope/#nowhere).',
      '- Three [web](https://example.org/x) and [script](javascript:alert(1)) and [other site](//example.org/) and [outside](https://example.com/other/).',
    ].join('\n');
    const checked = checkNote(`${markdown}\n\n`, { root, catalog, base: '/2026-10/rope/' });
    assert.equal(
      checked.markdown,
      [
        '# Rope',
        '',
        '- One [Rope §01](/2026-10/rope/#angles), [pairs](/2026-10/rope/#pairs) and [定义](/2026-10/rope/#%E5%AE%9A%E4%B9%89).',
        '- Two [Demo](/2026-09/demo/) and missing and no section.',
        '- Three [web](https://example.org/x) and script and other site and [outside](https://example.com/other/).',
      ].join('\n'),
    );
    assert.equal(checked.articles, 2);
    assert.equal(checkNote('- [here](#pairs)', { root, catalog }).markdown, '- here');
  });

  test('exports Markdown with absolute links and the line that names the conversation under the title', () => {
    const note = '# Rope\n\n- One [Rope §01](/2026-10/rope/#angles) and [web](https://example.org/x).';
    assert.equal(
      exportMarkdown(note, { root, intro: labels.noteFrom('2026-10-20', { title: 'Rope', href: 'https://example.com/blog/2026-10/rope/' }) }),
      '# Rope\n\n整理自 2026-10-20 在[《Rope》](https://example.com/blog/2026-10/rope/)的对话。\n\n- One [Rope §01](https://example.com/blog/2026-10/rope/#angles) and [web](https://example.org/x).\n',
    );
    assert.equal(exportMarkdown('- point', { root, intro: labels.noteFrom('2026-10-20', null) }), '整理自 2026-10-20 关于整个博客的对话。\n\n- point\n');
    assert.equal(noteTitle(note), 'Rope');
    assert.equal(noteTitle('- point'), null);
    assert.equal(noteFileName('a/b: "c"?'), 'a b c.md');
    assert.equal(noteFileName(' / '), 'note.md');
  });

  test('renders the title, the sections, the intro lines and the source line of a quote', () => {
    const html = noteHtml('# Rope\n\n## Angles\n\n- One.\n\n> Quoted.\n>\n> 出自[Rope §01](/2026-10/rope/#angles)', { root, citedFrom: '出自', intro: [labels.noteFrom('2026-10-20', { title: 'Rope', href: '/2026-10/rope/' }), labels.noteRequest('短一点')] });
    assert.match(html, /^<h4>Rope<\/h4>\n<p class="bk-chat-note-intro">整理自 2026-10-20 在<a href="https:\/\/example\.com\/blog\/2026-10\/rope\/">《Rope》<\/a>的对话。<\/p>\n<p class="bk-chat-note-intro">按要求重新整理：短一点<\/p>\n<h5>Angles<\/h5>/);
    assert.match(html, /<blockquote>\n<p>Quoted\.<\/p>\n<cite>出自<a href="https:\/\/example\.com\/blog\/2026-10\/rope\/#angles">Rope §01<\/a><\/cite>\n<\/blockquote>/);
  });

  test('collects the articles that the conversation read, linked or chose, without the article of the page', () => {
    const rounds = [
      round('See [Rope](/2026-10/rope/) and [Demo](/2026-09/demo/#x).', { reads: [{ label: 'GELU', url: '2026-08/gelu/', failed: false }, { label: 'Lost', url: '2026-07/lost/', failed: true }] }),
      round('Again [Demo](/2026-09/demo/).', { ask: { content: 'Q', scopes: [{ kind: 'article', urls: ['2026-10/rope/'] }], bubble: {} } }),
    ];
    assert.deepEqual(
      citedEntries(root, catalog, rounds, '2026-10/rope/').map((entry) => entry.url),
      ['2026-08/gelu/', '2026-09/demo/'],
    );
    assert.deepEqual(
      citedEntries(root, catalog, rounds, null).map((entry) => entry.url),
      ['2026-08/gelu/', '2026-10/rope/', '2026-09/demo/'],
    );
  });

  test('asks for a note from the conversation and the articles, and for a rewrite of the previous note with the request of the reader', () => {
    const own = { entry: catalog.articles[0], source: '# Rope source' };
    const sources = [{ entry: catalog.articles[2], source: '# GELU source' }];
    const [system, user] = notePrompt({ catalog, own, sources, rounds: [round('A.')], labels, instructions: 'Be brief.' });
    assert.match(system.content, /^You write a study note from a conversation between a reader and the reading assistant of the blog "Test Blog"\./);
    assert.ok(system.content.includes('{"address":"/2026-10/rope/","title":"Rope"'));
    assert.ok(system.content.includes('<article address="/2026-10/rope/" title="Rope">\n# Rope source\n</article>\n<article address="/2026-08/gelu/" title="GELU">\n# GELU source\n</article>'));
    assert.ok(system.content.includes('a line that starts with "出自"'));
    assert.ok(system.content.includes('"## 还没弄清的"'));
    assert.ok(system.content.endsWith('<reader-instructions>\nBe brief.\n</reader-instructions>'));
    assert.equal(user.content, '<conversation>\n<reader>\nQ\n</reader>\n<assistant>\nA.\n</assistant>\n</conversation>');
    const [, rewrite] = notePrompt({ catalog, own: null, sources: [], rounds: [round('A.')], labels, previous: '# Old', request: '写短一点' });
    assert.ok(rewrite.content.endsWith('</conversation>\n<note>\n# Old\n</note>\nRewrite this note as the reader asks: 写短一点\nKeep what the request does not ask to change.'));
  });

  test('adds the instructions of the reader to the chat prompt and links into the article of a conversation continued on another page', () => {
    const page = { address: '/', title: 'Test Blog', article: { source: '# Rope source', outline: [{ id: 'angles', depth: 2, title: 'Angles' }], address: '/2026-10/rope/' } };
    const prompt = systemPrompt({ page: { ...page, title: 'Rope' }, catalog, instructions: 'Be brief.' });
    assert.match(prompt, /The reader is on the page \/ and continues a conversation about the article "Rope" at \/2026-10\/rope\/\./);
    assert.ok(prompt.includes('link it with its address and id, such as [the heading](/2026-10/rope/#id)'));
    assert.ok(prompt.endsWith('<reader-instructions>\nBe brief.\n</reader-instructions>'));
    assert.ok(!systemPrompt({ page: { address: '/', title: 'Test Blog', article: null }, catalog }).includes('reader-instructions'));
  });
});

describe('AI chat history', () => {
  class Storage {
    constructor(limit = Infinity) {
      this.items = new Map();
      this.limit = limit;
    }
    getItem(key) {
      return this.items.get(key) ?? null;
    }
    setItem(key, value) {
      if (value.length > this.limit) throw new Error('QuotaExceededError');
      this.items.set(key, value);
    }
  }
  const conversation = (id, address = '/2026-10/rope/') => ({ id, article: address === null ? null : { address, title: address }, date: '2026-10-20', rounds: [{ ask: { content: id, scopes: [], bubble: { text: id, quote: null, scopes: [] } }, content: 'A', reasoning: '', reads: [] }], note: null });

  test('keeps the newest conversations of each site, at most 50, and drops the oldest when the storage is full', () => {
    const storage = new Storage();
    assert.equal(historyKey(root), 'bk-chat-history:/blog/');
    for (let index = 0; index < HISTORY_LIMIT + 2; index += 1) saveConversation(root, conversation(`c${index}`), { storage });
    let list = readHistory(root, { storage });
    assert.equal(list.length, 50);
    assert.deepEqual([list[0].id, list.at(-1).id], ['c51', 'c2']);
    saveConversation(root, { ...conversation('c10'), date: '2026-10-21' }, { storage });
    list = readHistory(root, { storage });
    assert.deepEqual([list[0].id, list[0].date, list.length], ['c10', '2026-10-21', 50]);
    assert.deepEqual(readHistory('https://example.com/other/', { storage }), []);
    deleteConversation(root, 'c10', { storage });
    assert.equal(readHistory(root, { storage }).length, 49);
    const small = new Storage(JSON.stringify([conversation('a'), conversation('b')]).length + 1);
    for (const id of ['a', 'b', 'c']) assert.equal(saveConversation(root, conversation(id), { storage: small }), true);
    assert.deepEqual(
      readHistory(root, { storage: small }).map((item) => item.id),
      ['c', 'b'],
    );
    small.items.set(historyKey(root), '{broken');
    assert.deepEqual(readHistory(root, { storage: small }), []);
  });

  test('lists the conversations of one article on its page and groups every conversation by article on the homepage', () => {
    const list = [conversation('a'), conversation('b', null), conversation('c', '/2026-09/demo/'), conversation('d')];
    assert.deepEqual(
      historyGroups(list, { address: '/2026-10/rope/', home: false }).map((group) => group.items.map((item) => item.id)),
      [['a', 'd']],
    );
    assert.deepEqual(historyGroups(list, { address: '/2026-08/none/', home: false }), []);
    assert.deepEqual(
      historyGroups(list, { address: '/', home: true }).map((group) => [group.article?.address ?? null, group.items.map((item) => item.id)]),
      [
        ['/2026-10/rope/', ['a', 'd']],
        [null, ['b']],
        ['/2026-09/demo/', ['c']],
      ],
    );
  });

  test('stores a finished reply as a round without the tool results and turns it back into a question and a reply', () => {
    const ask = { content: 'Q', scopes: [], bubble: { text: 'Q', quote: null, scopes: [] } };
    const message = { role: 'assistant', content: 'A', reasoning: 'R', reads: [{ name: 'read_article', label: 'Rope', url: '2026-10/rope/', failed: false, done: true }], ask, sent: [{ role: 'assistant', tool_calls: [] }, { role: 'tool', content: 'long source' }, { role: 'assistant', content: 'A' }] };
    const stored = storedRound(message);
    assert.deepEqual(stored, { ask, content: 'A', reasoning: 'R', reads: [{ label: 'Rope', url: '2026-10/rope/', failed: false, done: true }] });
    assert.deepEqual(roundMessages(stored), [
      { role: 'user', text: 'Q', quote: null, scopes: [] },
      { role: 'assistant', content: 'A', reasoning: 'R', reads: stored.reads, error: null, done: true, ask, sent: [{ role: 'assistant', content: 'A' }] },
    ]);
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
