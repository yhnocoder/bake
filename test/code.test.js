import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { highlighter } from '../src/render/code.js';
import { render } from '../src/render/index.js';

const header = '---\ntitle: 测试\nslug: test\n---\n\n';
const headerLines = 5;

function renderBody(body) {
  return render(`${header}${body}`, { path: 'post.md' });
}

async function htmlOf(body) {
  const { html, messages } = await renderBody(body);
  assert.deepEqual(messages, []);
  return html;
}

function styles(html) {
  return [...html.matchAll(/<span style="([^"]*)">/g)].map((match) => match[1]);
}

describe('代码高亮', () => {
  test('Python 代码块输出 pre 和 code，span 的颜色使用代码变量并回退到主题变量', async () => {
    const html = await htmlOf('```python\ndef f(x):\n    return "a"\n```');
    assert.match(html, /^<pre><code class="language-python"><span class="line">/);
    assert.ok(styles(html).includes('color:var(--code-token-keyword, var(--color-accent))'));
    assert.ok(styles(html).includes('color:var(--code-token-string-expression, var(--color-mark-text))'));
    assert.equal(html.match(/<span class="line">/g).length, 2);
  });

  test('JavaScript 代码块的每个 span 都使用代码变量', async () => {
    const html = await htmlOf('```js\n// note\nconst a = "b";\n```');
    assert.match(html, /^<pre><code class="language-js">/);
    assert.ok(styles(html).includes('color:var(--code-token-comment, var(--color-muted))'));
    for (const style of styles(html)) assert.match(style, /^color:var\(--code-[\w-]+, var\(--color-[\w-]+\)\)(?:;font-style:\w+)?$/);
  });

  test('同一篇文章中同一语言的两个代码块只加载一次语言', async () => {
    const shiki = await highlighter();
    const loadLanguage = mock.method(shiki, 'loadLanguage');
    await htmlOf('```rust\nfn a() {}\n```\n\n```rust\nfn b() {}\n```');
    await htmlOf('```rust\nfn c() {}\n```');
    assert.deepEqual(
      loadLanguage.mock.calls.map((call) => call.arguments),
      [['rust']],
    );
    loadLanguage.mock.restore();
  });

  test('语言加载失败时报错并按纯文本输出，之后的渲染重新加载这种语言', async () => {
    const shiki = await highlighter();
    const failing = mock.method(shiki, 'loadLanguage', async () => {
      throw new Error('broken grammar');
    }, { times: 1 });
    const { html, messages } = await renderBody('```go\nx := 1 < 2\n```');
    assert.deepEqual(
      messages.map(({ line, column, text }) => ({ line: line - headerLines, column, text })),
      [{ line: 1, column: 1, text: 'Cannot load code language go: broken grammar' }],
    );
    assert.equal(html, '<pre><code class="language-go">x := 1 &#x3C; 2\n</code></pre>');
    assert.match(await htmlOf('```go\nx := 1\n```'), /^<pre><code class="language-go"><span class="line">/);
    failing.mock.restore();
  });

  test('没有语言名和语言名为 text、txt、plain 的代码块不高亮', async () => {
    assert.equal(await htmlOf('```\na < b\n```'), '<pre><code>a &#x3C; b\n</code></pre>');
    for (const lang of ['text', 'txt', 'plain']) {
      assert.equal(await htmlOf(`\`\`\`${lang}\na\n\`\`\``), `<pre><code class="language-${lang}">a\n</code></pre>`);
    }
  });

  test('未知语言名报错，代码块按纯文本输出', async () => {
    const { html, messages } = await renderBody('段落\n\n```pyhton\nprint(1 < 2)\n```');
    assert.deepEqual(
      messages.map(({ path, line, column, text }) => ({ path, line: line - headerLines, column, text })),
      [{ path: 'post.md', line: 3, column: 1, text: 'Unknown code language pyhton' }],
    );
    assert.match(html, /<pre><code class="language-pyhton">print\(1 &#x3C; 2\)\n<\/code><\/pre>/);
  });

  test('代码中的 < 和 & 被转义', async () => {
    const html = await htmlOf('```js\nif (a < b && c) {}\n```');
    assert.doesNotMatch(html.replace(/<\/?span[^>]*>|<\/?(?:pre|code)[^>]*>/g, ''), /[<]|&(?!#x)/);
    assert.match(html, /&#x3C;/);
    assert.match(html, /&#x26;&#x26;/);
  });
});
