import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { parse } from '../article.js';
import { article, bake, createBlog, validConfig } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const source = readFileSync(join(exampleBlog, 'content/posts/syntax/index.md'), 'utf8');
const lines = source.split('\n');
const linkedLines = readFileSync(join(exampleBlog, 'content/posts/syntax-linked/index.md'), 'utf8').split('\n');

function sourceLines(first, last) {
  const start = lines.findIndex((line) => line.startsWith(first));
  const end = lines.findIndex((line, index) => index >= start && line === last);
  assert.ok(start !== -1 && end !== -1, `the syntax article has no lines from "${first}" to "${last}"`);
  return lines.slice(start, end + 1).join('\n');
}

function sourceLine(start) {
  return lines.find((line) => line.startsWith(start));
}

function select(page, start, end) {
  return page.evaluate(
    ([start, end]) => {
      const point = ({ selector, contains, text, after = false, last = false }) => {
        const element = [...document.querySelectorAll(selector)].find((candidate) => candidate.textContent.includes(contains ?? text ?? ''));
        if (element === undefined) throw new Error(`no ${selector} contains ${contains ?? text}`);
        if (text === undefined) return [element, after ? element.childNodes.length : 0];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let found = null;
        while (walker.nextNode()) {
          const index = walker.currentNode.data.indexOf(text);
          if (index === -1) continue;
          found = [walker.currentNode, index + (after ? text.length : 0)];
          if (!last) break;
        }
        if (found === null) throw new Error(`"${text}" is not inside one text node of ${selector}`);
        return found;
      };
      const range = document.createRange();
      range.setStart(...point(start));
      range.setEnd(...point(end));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [start, end],
  );
}

async function copied(page) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('Control+C');
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const read = async (type) => (item.types.includes(type) ? (await item.getType(type)).text() : null);
    return { text: await read('text/plain'), html: await read('text/html') };
  });
}

test('copying from an article gives the Markdown source of the selection', async (t) => {
  const dir = createBlog(t, {});
  cpSync(exampleBlog, dir, { recursive: true, filter: (path) => path !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(`${base}/2026-10/syntax/`);
  await page.waitForFunction(() => document.querySelector('.bk-notes-layer') !== null);
  const copyChapter = '#copy ~ .bk-block';

  await t.test('part of a paragraph keeps highlights, math and the footnote, and the definition is appended', async () => {
    await select(page, { selector: copyChapter, text: '只选中一部分的块' }, { selector: copyChapter, contains: '附在末尾', text: '。', after: true, last: true });
    const paragraph = sourceLine('完整选中的块');
    const expected = `${paragraph.slice(paragraph.indexOf('只选中一部分的块'))}\n\n${sourceLine('[^copy-notes]:')}`;
    assert.equal((await copied(page)).text, expected);
  });

  await t.test('a sidenote number inside an example becomes the reference with its label and its definition', async () => {
    await select(page, { selector: '#sidenotes ~ .bk-block .example-result', text: '推理时' }, { selector: '#sidenotes ~ .bk-block .example-result', text: '不额外占带宽', after: true });
    assert.equal((await copied(page)).text, `推理时这个逐元素操作要能融合进 GEMM 的 epilogue[^gemm]，不额外占带宽\n\n${sourceLine('[^gemm]:')}`);
    assert.equal(await page.evaluate(() => document.querySelector('.bk-article > section .bk-sidenote[data-sidenote="1"]').dataset.label), 'gemm');
  });

  await t.test('whole blocks are copied as their source lines, and a component counts as whole when part of it is selected', async () => {
    await select(page, { selector: copyChapter, text: '章节编号' }, { selector: `${copyChapter} figcaption`, text: '选中', after: true });
    assert.equal((await copied(page)).text, sourceLines('- 章节编号', ':::'));
  });

  await t.test('a selection inside a list item gives its inline Markdown, and one across items gives list items', async () => {
    await select(page, { selector: `${copyChapter} li`, text: '标题旁的' }, { selector: `${copyChapter} li code`, text: '#', after: true });
    assert.equal((await copied(page)).text, '标题旁的 `#`');
    await select(page, { selector: `${copyChapter} li`, text: '页边的旁注编号' }, { selector: `${copyChapter} li`, text: '选区从文章外面开始时', after: true });
    assert.equal((await copied(page)).text, '- 页边的旁注编号可以选中，复制的内容里没有它们。\n- 选区从文章外面开始时');
  });

  await t.test('a partly selected example converts its result, with the math and images of list-table cells', async () => {
    await select(page, { selector: '#tables ~ .bk-block .example-result .list-table', text: '激活函数' }, { selector: '#tables ~ .bk-block .example-result .list-table', text: '负半轴梯度为 0', after: true });
    assert.equal((await copied(page)).text, [':::list-table', '* - 激活函数', '  - 公式', '  - 特点', '  - 曲线', '* - ReLU', '  - $\\max(0, x)$', '  - - 计算只需要一次比较', '    - 负半轴梯度为 0', '  - ![](relu.svg){width=64px}', ':::'].join('\n'));
  });

  await t.test('a selection that starts outside the article copies the article part', async () => {
    await select(page, { selector: '.bk-title', text: 'Bake' }, { selector: '.bk-article > .bk-block', text: '先改这篇文章。', after: true });
    assert.equal((await copied(page)).text, sourceLine('这篇文章列出 Bake 的全部写法'));
  });

  await t.test('section numbers and heading links are left out of the Markdown and the HTML, and math is TeX in the HTML', async () => {
    await select(page, { selector: '#copy .bk-heading-text', text: 'Markdown' }, { selector: copyChapter, text: '只选中一部分的块从页面内容转换：', after: true });
    const partial = await copied(page);
    assert.equal(partial.text, `${sourceLine('## 复制为 Markdown')}\n\n${sourceLine('在页面上选中内容复制')}\n\n完整选中的块按 \`index.md\` 里的原文复制。只选中一部分的块从页面内容转换：`);
    await select(page, { selector: '#copy', text: '15' }, { selector: copyChapter, contains: '附在末尾', text: '。', after: true, last: true });
    const whole = await copied(page);
    assert.ok(whole.text.startsWith(`${sourceLine('## 复制为 Markdown')}\n\n${sourceLine('在页面上选中内容复制')}\n\n${sourceLine('完整选中的块')}`), whole.text);
    assert.ok(whole.text.endsWith(`\n\n${sourceLine('[^copy-notes]:')}`), whole.text);
    assert.doesNotMatch(whole.html, />15<|>#<|<mjx-container|<svg|<div|<section|<span|<aside|\sclass=|\sdata-|\sstyle=/);
    assert.match(whole.html, /<mark>重点标记<\/mark>/);
    assert.match(whole.html, /公式 \$\\sigma\(x\)\$ 写成/);
    assert.match(whole.html, /<h2>复制为 Markdown<\/h2>/);
    assert.match(whole.html, /附在末尾<sup><a href="[^"]*#footnote-3">3<\/a><\/sup>。/);
    assert.match(whole.html, /<hr><ol><li value="3" id="footnote-3"><p>每个脚注的定义只附一次，按 <code>index.md<\/code> 里的原文复制。<\/p><\/li><\/ol>$/);
  });

  await t.test('the HTML has absolute addresses for links and images', async () => {
    await select(page, { selector: '#links ~ .bk-block .example-result', text: 'SwiGLU' }, { selector: '#links ~ .bk-block .example-result', text: '被引用的文章', after: true });
    const links = await copied(page);
    assert.match(links.html, new RegExp(`<a href="${base}/2026-10/syntax-linked/#chain-rule">链式法则</a>`));
    assert.match(links.text, /\[链式法则\]\(\/2026-10\/syntax-linked\/#chain-rule\)/);
    await select(page, { selector: '#images ~ .bk-block .example-result figure' }, { selector: '#images ~ .bk-block .example-result figure', after: true });
    assert.match((await copied(page)).html, new RegExp(`<img src="${base}/2026-10/syntax/ffn-shapes.svg"`));
  });

  await t.test('a converted heading and component keep the attributes written in the source', async () => {
    await select(page, { selector: '#headings ~ .bk-block .example-source', text: '三级标题' }, { selector: '#headings ~ .bk-block .example-result h3', text: '三级标题', after: true });
    assert.equal((await copied(page)).text, '三级标题 {#third-level toc="短标题"}\n\n### 三级标题 {#third-level toc="短标题"}');
    await select(page, { selector: '#components ~ .bk-block .example-source', text: 'width=body}' }, { selector: '#components ~ .bk-block .example-result figure[data-attributes*="body"]', after: true });
    assert.equal((await copied(page)).text, 'width=body}\n:::\n\n:::act-fn-plot{fn=silu range=6 beta=2 width=body}\n:::');
  });

  await t.test('a selection of only the title of a fold gives the title', async () => {
    await page.evaluate(() => {
      const fold = [...document.querySelectorAll('.example-result details.fold')].find((details) => details.textContent.includes('GELU 的导数'));
      const range = document.createRange();
      range.setStart(fold, 0);
      range.setEnd(fold, 1);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.equal((await copied(page)).text, '推导：GELU 的导数');
  });

  await t.test('a whole sidenote in the margin is copied as its text without its number', async () => {
    await select(page, { selector: '.bk-notes-layer .bk-sidenote-body', text: '每个脚注' }, { selector: '.bk-notes-layer .bk-sidenote-body', text: '原文复制。', after: true });
    assert.equal((await copied(page)).text, sourceLine('[^copy-notes]:').replace('[^copy-notes]: ', ''));
  });

  await t.test('headings and a component in embedded content are copied as the lines of the embedded article', async () => {
    const embed = '.embed-part';
    await select(page, { selector: `${embed} h2`, contains: '向量与雅可比矩阵的乘积' }, { selector: `${embed} figcaption`, contains: 'SiLU', after: true });
    const start = linkedLines.findIndex((line) => line.startsWith('## 向量与雅可比矩阵的乘积'));
    const end = linkedLines.findIndex((line, index) => index > start && line === ':::');
    assert.equal((await copied(page)).text, linkedLines.slice(start, end + 1).join('\n'));
  });

  await t.test('copying shows one toast with the Markdown message', async () => {
    await page.waitForFunction(() => !document.querySelector('.bk-toast').classList.contains('is-on'));
    await select(page, { selector: copyChapter, text: '只选中' }, { selector: copyChapter, text: '只选中', after: true });
    await copied(page);
    await page.waitForFunction(() => document.querySelector('.bk-toast').classList.contains('is-on'));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.bk-toast')].map((toast) => toast.textContent)), ['已复制为 Markdown']);
  });

  await t.test('the copy button copies the whole index.md, uses the pointer cursor and shows the toast', async () => {
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForFunction(() => !document.querySelector('.bk-toast').classList.contains('is-on'));
    const button = page.locator('.bk-header .bk-copy-source');
    assert.equal(await button.textContent(), '复制为 Markdown');
    assert.equal(await button.evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    await button.click();
    await page.waitForFunction(() => document.querySelector('.bk-toast').classList.contains('is-on'));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    assert.equal(await page.locator('.bk-toast').textContent(), '已复制为 Markdown');
  });

  await t.test('the toast takes the colours of the light and the dark scheme and does not cover the settings button', async () => {
    const luminance = (color) => {
      const values = color.match(/[\d.]+/g).map(Number);
      const [r, g, b] = color.startsWith('color(') ? values.slice(0, 3).map((value) => value * 255) : values;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    for (const width of [1440, 375]) {
      for (const colorScheme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction(() => !document.querySelector('.bk-toast').classList.contains('is-on'));
        await page.locator('.bk-header .bk-copy-source').evaluate((button) => button.click());
        await page.waitForFunction(() => document.querySelector('.bk-toast').classList.contains('is-on') && getComputedStyle(document.querySelector('.bk-toast')).opacity === '1');
        const { toast, background, own, settings } = await page.evaluate(() => ({
          toast: getComputedStyle(document.querySelector('.bk-toast')).backgroundColor,
          background: getComputedStyle(document.body).backgroundColor,
          own: document.querySelector('.bk-toast').getBoundingClientRect().toJSON(),
          settings: document.querySelector('.bk-settings-toggle').getBoundingClientRect().toJSON(),
        }));
        const at = `${colorScheme} at ${width}px`;
        assert.ok(Math.abs(luminance(toast) - luminance(background)) < 0.2, `${at}: the toast ${toast} on the page ${background}`);
        assert.ok(own.right <= settings.left || own.left >= settings.right || own.bottom <= settings.top || own.top >= settings.bottom, `${at}: the toast ${JSON.stringify(own)} covers the settings button ${JSON.stringify(settings)}`);
        assert.ok(own.left >= 0 && own.right <= width, `${at}: the toast ${JSON.stringify(own)} leaves the screen`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await t.test('starting the copy module on a page without the source script is an error', async () => {
    const stripped = await context.newPage();
    const errors = [];
    stripped.on('pageerror', (error) => errors.push(error.message));
    await stripped.route(`${base}/2026-10/syntax/`, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const withoutSource = html.replace(/<script type="application\/json" class="bk-source"[^>]*>[\s\S]*?<\/script>/, '');
      assert.notEqual(withoutSource, html);
      await route.fulfill({ response, body: withoutSource });
    });
    await stripped.goto(`${base}/2026-10/syntax/`, { waitUntil: 'load' });
    assert.deepEqual(errors, ['bake/copy needs the source of the article in script.bk-source']);
    await stripped.close();
  });

  await context.close();
});

test('a converted citation, reference entry and internal link keep a key or an anchor with a percent sign as written', async (t) => {
  const body = '## Keys {#a%zz}\n\nGates help [@a%zz] and [@b%20c] here, see [the keys](/2026-10/rope/#a%25zz) too.\n\n:::references\n- [@a%zz] First.\n- [@b%20c] Second.\n:::\n';
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/rope/index.md': article({ body }),
    'content/posts/host/index.md': article({ title: 'Host', slug: 'host', body: ':::embed\n/2026-10/rope/#a%25zz\n:::\n' }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(`${base}/2026-10/rope/`);
  const paragraph = '.bk-article p';
  await select(page, { selector: paragraph, contains: 'Gates', text: 'help' }, { selector: paragraph, contains: 'Gates', text: ' too', after: true });
  assert.equal((await copied(page)).text, 'help [@a%zz] and [@b%20c] here, see [the keys](/2026-10/rope/#a%25zz) too');
  await page.goto(`${base}/2026-10/host/`);
  await select(page, { selector: '.embed li', contains: 'First', text: 'irst' }, { selector: '.embed li', contains: 'Second', text: 'Sec', after: true });
  assert.equal((await copied(page)).text, ':::references\n- [@a%zz] irst.\n- [@b%20c] Sec\n:::');
  await context.close();
});

test('a citation and a reference list without data-key, which only raw HTML can write, are copied as a link and a list', async (t) => {
  const body = '## Keys\n\n<p>Raw text cites <a class="citation" href="#keys">[1]</a> before the end.</p>\n\n<ol class="references"><li>First plain entry.</li><li>Second plain entry.</li></ol>\n';
  const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article({ body }) });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(`${base}/2026-10/rope/`);
  await select(page, { selector: '.bk-article p', contains: 'Raw', text: 'cites' }, { selector: '.bk-article p', contains: 'Raw', text: ' before', after: true });
  assert.equal((await copied(page)).text, 'cites [\\[1\\]](#keys) before');
  await select(page, { selector: '.bk-article li', contains: 'First', text: 'irst' }, { selector: '.bk-article li', contains: 'Second', text: 'Sec', after: true });
  assert.equal((await copied(page)).text, '1. irst plain entry.\n2. Sec');
  await context.close();
});

test('a partly selected paragraph escapes the text that Markdown would read as syntax and keeps every other character, including U+FDD0, so the copy renders the same text', async (t) => {
  const paragraphs = [
    ['Start: a \\*literal\\* star, snake_case\\_name, a \\_literal\\_ underscore, \\`ticks\\` and C:\\\\path.', 'a *literal*', 'path'],
    ['Money: \\$5 or \\$6, a \\==mark\\== and \\~~strike\\~~ here.', '$5', 'here'],
    ['Brackets: \\[text\\](url), \\[^note\\], \\[@key\\], \\<b\\> and \\&amp; here.', '[text]', 'here'],
    ['\\# Not a heading but text', '# Not', 'heading'],
    ['1\\. Not a list item', '1. Not', 'list'],
    ['\\- Not a list either', '- Not', 'list'],
    ['\\> Not a quote at all', '> Not', 'quote'],
    ['中文，标点：“引号”（括号）！还有 snake_case 和 a * b。', '标点', 'b'],
    ['Noncharacter: a\uFDD0b and \uFDD0\uFDD0 here.', 'a\uFDD0b', 'here'],
    ['\uFDD0# Not a heading after a noncharacter', '\uFDD0#', 'heading'],
    ['\\# Heading-like text with \uFDD0 inside', '# Heading-like', 'inside'],
    ['12\\. List-like text with \uFDD0 inside', '12. List-like', 'inside'],
  ];
  const dir = createBlog(t, {
    'bake.config.js': validConfig,
    'content/posts/escapes/index.md': article({ title: 'Escapes', slug: 'escapes', body: `${paragraphs.map(([text]) => text).join('\n\n')}\n` }),
  });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(`${base}/2026-10/escapes/`);
  for (const [, from, to] of paragraphs) {
    const point = { selector: '.bk-article p', contains: from };
    await select(page, { ...point, text: from }, { ...point, text: to, after: true });
    const selected = await page.evaluate(() => getSelection().toString());
    const { text } = await copied(page);
    const { article: copy, errors } = await parse(`${text}\n`);
    assert.deepEqual(errors, [], text);
    const rendered = await page.evaluate((html) => new DOMParser().parseFromString(html, 'text/html').body.textContent.trim(), copy.intro.map((block) => block.html).join('\n'));
    assert.equal(rendered, selected, `${text} renders as ${rendered}`);
  }
  await select(page, { selector: '.bk-article p', text: '标点' }, { selector: '.bk-article p', text: 'b。', after: true });
  assert.equal((await copied(page)).text, '标点：“引号”（括号）！还有 snake_case 和 a * b。');
  await context.close();
});
