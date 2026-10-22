import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parse } from '../article.js';
import { article, validConfig } from '../blog.js';
import { test } from './browser.js';
import { isSelectionChunk, openWithSelectionModule, selectionModuleReady } from './selection-module.js';

const copySource = article({
  title: 'Copying',
  slug: 'copy',
  body: `This article lists what copying gives. Change it first.

## Copy as Markdown

Select and copy on the page.

A whole block is copied as its source. A partly selected block is copied as the source of its part, with ==a highlight== and **bold** as written, the formula $\\sigma(x)$ as TeX, and the definition of a footnote at the end[^copy-notes].

- Section numbers, the \`#\` beside a heading and sidenote numbers are left out.
- A selection that starts outside the article copies only the part in the article.
- Headings, a row of a table, formulas and embedded content are copied whole.

$$
\\mathrm{SiLU}(x) = x\\,\\sigma(x)
$$

\`\`\`python
def silu(x):
    return x / (1 + math.exp(-x))
\`\`\`

:::demo-plot{size=2}
Any part of a component copies its whole block.
:::

[^copy-notes]: Each definition is appended once, as written in \`index.md\`.

## Fields

| Field | Meaning |
|---|---|
| \`slug\` | The last part of the address. |
| \`date\` | The date of writing. |
| \`updated\` | The date of the last change. |
| \`summary\` | A summary of one sentence. |
| \`draft\` | With true the article is not published. |
| \`page\` | A plain HTML page. |

The script that preview names is a module.

## Sidenotes

:::example
At inference the elementwise operation fuses into the epilogue[^gemm], without extra bandwidth.

[^gemm]: The epilogue is the stage of a matrix kernel that handles each result.
:::

## Tables

::::example
:::list-table
* - Function
  - Formula
  - Notes
  - Curve
* - ReLU
  - $\\max(0, x)$
  - - One comparison
    - Zero gradient on the negative half
  - ![](relu.svg){width=64px}
:::
::::

## Links and images

:::example
The backward pass follows the [chain rule](/2026-10/linked/#chain-rule), see [the linked article](/2026-10/linked/).
:::

:::example
![Shapes](shapes.svg "The shapes of the layer.")
:::

## Headings

:::example
### Third level {#third-level toc="Short"}
:::

## Folds

::::example
:::fold{title="Derivation: the derivative"}
Apply the product rule to $x\\Phi(x)$.
:::
::::

## Components

::::example
:::demo-plot{size=3 width=body}
:::
::::

## Embeds

:::embed
/2026-10/linked/#jacobian-products
:::
`,
});
const linkedLines = article({
  title: 'Linked',
  slug: 'linked',
  body: `## Chain rule

The chain rule multiplies the local derivatives.

## Jacobian products {#jacobian-products}

Compute the products of vectors and Jacobians.

### Gate derivative

:::demo-plot{size=1}
The shape of SiLU.
:::

## Order

Visit the nodes in reverse order.
`,
}).split('\n');
const lines = copySource.split('\n');
const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="${color}"/></svg>\n`;
const demoPlot = "export const params = { size: { label: 'Size', type: 'number', default: 1 } };\nexport const layout = { height: 120 };\n\nexport default class DemoPlot extends HTMLElement {\n  connectedCallback() {\n    this.textContent = 'plot';\n  }\n}\n";

function sourceLines(first, last) {
  const start = lines.findIndex((line) => line.startsWith(first));
  const end = lines.findIndex((line, index) => index >= start && line === last);
  assert.ok(start !== -1 && end !== -1, `the article has no lines from "${first}" to "${last}"`);
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

function toastShown(page) {
  return page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-toast')).opacity !== '0');
}

function toastHidden(page) {
  return page.waitForFunction(() => getComputedStyle(document.querySelector('.bk-toast')).opacity === '0');
}

async function copied(page) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('ControlOrMeta+C');
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const read = async (type) => (item.types.includes(type) ? (await item.getType(type)).text() : null);
    return { text: await read('text/plain'), html: await read('text/html') };
  });
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('copying from an article gives the Markdown source of the selection', () => {
  test.use({
    blog: {
      example: false,
      files: {
        'bake.config.js': "export default { title: '测试博客', url: 'https://example.com', language: 'zh-CN' };\n",
        'content/posts/copy/index.md': copySource,
        'content/posts/copy/relu.svg': svg('#985b57'),
        'content/posts/copy/shapes.svg': svg('#2a78d6'),
        'content/posts/linked/index.md': linkedLines.join('\n'),
        'components/demo-plot.js': demoPlot,
      },
    },
  });
  test.beforeEach(async ({ page }) => {
    await openWithSelectionModule(page, '/2026-10/copy/');
    await page.waitForFunction(() => document.querySelector('.bk-notes-layer') !== null);
  });
  const copyChapter = '#copy-as-markdown ~ .bk-block';

  test('part of a paragraph keeps highlights, math and the footnote, and the definition is appended', async ({ page }) => {
    await select(page, { selector: copyChapter, text: 'A partly selected block' }, { selector: copyChapter, contains: 'at the end', text: '.', after: true, last: true });
    const paragraph = sourceLine('A whole block');
    const expected = `${paragraph.slice(paragraph.indexOf('A partly selected block'))}\n\n${sourceLine('[^copy-notes]:')}`;
    assert.equal((await copied(page)).text, expected);
  });

  test('a sidenote number inside an example becomes the reference with its label and its definition', async ({ page }) => {
    await select(page, { selector: '#sidenotes ~ .bk-block .example-result', text: 'At inference' }, { selector: '#sidenotes ~ .bk-block .example-result', text: 'without extra bandwidth', after: true });
    assert.equal((await copied(page)).text, `At inference the elementwise operation fuses into the epilogue[^gemm], without extra bandwidth\n\n${sourceLine('[^gemm]:')}`);
  });

  test('whole blocks are copied as their source lines, and a component counts as whole when part of it is selected', async ({ page }) => {
    await select(page, { selector: copyChapter, text: 'Section numbers' }, { selector: `${copyChapter} figcaption`, text: 'Any part', after: true });
    assert.equal((await copied(page)).text, sourceLines('- Section numbers', ':::'));
  });

  test('a selection inside the caption of a component gives its block and keeps the figure in the HTML', async ({ page }) => {
    await select(page, { selector: `${copyChapter} figcaption`, text: 'part of' }, { selector: `${copyChapter} figcaption`, text: 'whole', after: true });
    const caption = await copied(page);
    assert.equal(caption.text, sourceLines(':::demo-plot{size=2}', ':::'));
    assert.match(caption.html, /^<figure><figcaption>part of a component copies its whole<\/figcaption><\/figure>$/);
  });

  test('a selection inside a list item gives its inline Markdown, and one across items gives list items', async ({ page }) => {
    await select(page, { selector: `${copyChapter} li`, text: 'the ' }, { selector: `${copyChapter} li code`, text: '#', after: true });
    assert.equal((await copied(page)).text, 'the `#`');
    await select(page, { selector: `${copyChapter} li`, text: 'sidenote numbers' }, { selector: `${copyChapter} li`, text: 'A selection that starts', after: true });
    assert.equal((await copied(page)).text, '- sidenote numbers are left out.\n- A selection that starts');
  });

  test('a selection across the rows of a pipe table gives whole rows under the header and delimiter rows', async ({ page }) => {
    const table = '#fields ~ .bk-block table';
    const header = [sourceLine('| Field |'), sourceLine('|---|')];
    await select(page, { selector: `${table} td`, text: 'last part' }, { selector: `${table} td`, text: 'A summary', after: true });
    assert.equal((await copied(page)).text, [...header, sourceLine('| `slug` |'), sourceLine('| `date` |'), sourceLine('| `updated` |'), sourceLine('| `summary` |')].join('\n'));
    await select(page, { selector: `${table} td`, text: 'not published' }, { selector: '#fields ~ .bk-block p', contains: 'preview names' });
    assert.equal((await copied(page)).text, [...header, sourceLine('| `draft` |'), sourceLine('| `page` |')].join('\n'));
  });

  test('a partly selected example converts its result, with the math and images of list-table cells', async ({ page }) => {
    const table = '#tables ~ .bk-block .example-result .list-table';
    await select(page, { selector: table, text: 'Function' }, { selector: table, text: 'Zero gradient on the negative half', after: true });
    assert.equal((await copied(page)).text, [':::list-table', '* - Function', '  - Formula', '  - Notes', '  - Curve', '* - ReLU', '  - $\\max(0, x)$', '  - - One comparison', '    - Zero gradient on the negative half', '  - ![](relu.svg){width=64px}', ':::'].join('\n'));
  });

  test('a selection that starts outside the article copies the article part', async ({ page }) => {
    await select(page, { selector: '.bk-title', text: 'Copying' }, { selector: '.bk-article > .bk-block', text: 'Change it first.', after: true });
    assert.equal((await copied(page)).text, sourceLine('This article lists'));
  });

  test('section numbers and heading links are left out of the Markdown and the HTML, and math is TeX in the HTML', async ({ page }) => {
    await select(page, { selector: '#copy-as-markdown .bk-heading-text', text: 'Markdown' }, { selector: copyChapter, text: 'copied as the source of its part,', after: true });
    const partial = await copied(page);
    assert.equal(partial.text, `${sourceLine('## Copy as Markdown')}\n\n${sourceLine('Select and copy')}\n\nA whole block is copied as its source. A partly selected block is copied as the source of its part,`);
    await select(page, { selector: '#copy-as-markdown', text: '01' }, { selector: copyChapter, contains: 'at the end', text: '.', after: true, last: true });
    const whole = await copied(page);
    assert.ok(whole.text.startsWith(`${sourceLine('## Copy as Markdown')}\n\n${sourceLine('Select and copy')}\n\n${sourceLine('A whole block')}`), whole.text);
    assert.ok(whole.text.endsWith(`\n\n${sourceLine('[^copy-notes]:')}`), whole.text);
    assert.doesNotMatch(whole.html, />01<|>#<|<mjx-container|<svg|<div|<section|<span|<aside|\sclass=|\sdata-|\sstyle=/);
    assert.match(whole.html, /<mark>a highlight<\/mark>/);
    assert.match(whole.html, /the formula \$\\sigma\(x\)\$ as TeX/);
    assert.match(whole.html, /<h2>Copy as Markdown<\/h2>/);
    assert.match(whole.html, /at the end<sup><a href="[^"]*#footnote-1">1<\/a><\/sup>\./);
    assert.match(whole.html, /<hr><ol><li value="1" id="footnote-1"><p>Each definition is appended once, as written in <code>index\.md<\/code>\.<\/p><\/li><\/ol>$/);
  });

  test('the HTML has absolute addresses for links and images', async ({ page, baseURL: base }) => {
    const links = '#links-and-images ~ .bk-block .example-result';
    await select(page, { selector: links, text: 'The backward' }, { selector: links, text: 'the linked article', after: true });
    const copiedLinks = await copied(page);
    assert.match(copiedLinks.html, new RegExp(`<a href="${base}/2026-10/linked/#chain-rule">chain rule</a>`));
    assert.match(copiedLinks.text, /\[chain rule\]\(\/2026-10\/linked\/#chain-rule\)/);
    await select(page, { selector: `${links} figure` }, { selector: `${links} figure`, after: true });
    assert.match((await copied(page)).html, new RegExp(`<img src="${base}/2026-10/copy/shapes.svg"`));
  });

  test('a selection from the source of an example into its result gives the source of the result once, with the attributes of a heading and a component', async ({ page }) => {
    await select(page, { selector: '#headings ~ .bk-block .example-source', text: 'Third level' }, { selector: '#headings ~ .bk-block .example-result h3', text: 'Third level', after: true });
    assert.equal((await copied(page)).text, '### Third level {#third-level toc="Short"}');
    await select(page, { selector: '#components ~ .bk-block .example-source', text: 'width=body}' }, { selector: '#components ~ .bk-block .example-result figure[data-attributes*="body"]', after: true });
    assert.equal((await copied(page)).text, ':::demo-plot{size=3 width=body}\n:::');
  });

  test('a selection of only the title of a fold gives the title', async ({ page }) => {
    await page.evaluate(() => {
      const fold = document.querySelector('.example-result details.fold');
      const range = document.createRange();
      range.setStart(fold, 0);
      range.setEnd(fold, 1);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.equal((await copied(page)).text, 'Derivation: the derivative');
  });

  test('a whole sidenote in the margin is copied as its text without its number', async ({ page }) => {
    await select(page, { selector: '.bk-notes-layer .bk-sidenote-body', text: 'Each definition' }, { selector: '.bk-notes-layer .bk-sidenote-body', contains: 'Each definition', text: '.', after: true, last: true });
    assert.equal((await copied(page)).text, sourceLine('[^copy-notes]:').replace('[^copy-notes]: ', ''));
  });

  test('headings and a component in embedded content are copied as the lines of the embedded article', async ({ page }) => {
    await select(page, { selector: '.embed-part h2', contains: 'Jacobian products' }, { selector: '.embed-part figcaption', contains: 'SiLU', after: true });
    const start = linkedLines.findIndex((line) => line.startsWith('## Jacobian products'));
    const end = linkedLines.findIndex((line, index) => index > start && line === ':::');
    assert.equal((await copied(page)).text, linkedLines.slice(start, end + 1).join('\n'));
  });

  test('copying shows one toast with the Markdown message', async ({ page }) => {
    await toastHidden(page);
    await select(page, { selector: copyChapter, text: 'partly' }, { selector: copyChapter, text: 'partly', after: true });
    await copied(page);
    await toastShown(page);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.bk-toast')].filter((toast) => getComputedStyle(toast).opacity !== '0').map((toast) => toast.textContent)), ['已复制为 Markdown']);
  });

  test('the copy button copies the whole index.md and shows the toast', async ({ page }) => {
    await page.evaluate(() => getSelection().removeAllRanges());
    await toastHidden(page);
    const button = page.locator('.bk-header .bk-copy-source');
    assert.equal(await button.textContent(), '复制为 Markdown');
    await button.click();
    await toastShown(page);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copySource);
    assert.equal(await page.locator('.bk-toast').textContent(), '已复制为 Markdown');
  });

  test('starting the copy module on a page without the source script is an error', async ({ newPage }) => {
    const stripped = await newPage();
    const errors = [];
    stripped.on('pageerror', (error) => errors.push(error.message));
    await stripped.route('**/2026-10/copy/', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const withoutSource = html.replace(/<script type="application\/json" class="bk-source"[^>]*>[\s\S]*?<\/script>/, '');
      assert.notEqual(withoutSource, html);
      await route.fulfill({ response, body: withoutSource });
    });
    await stripped.goto('/2026-10/copy/', { waitUntil: 'load' });
    assert.deepEqual(errors, ['bake/copy needs the source of the article in script.bk-source']);
  });
});

const escapedParagraphs = [
  ['Start: a \\*literal\\* star, snake_case\\_name, a \\_literal\\_ underscore, \\`ticks\\` and C:\\\\path.', 'a *literal*', 'path'],
  ['Money: \\$5 or \\$6, a \\==mark\\== and \\~~strike\\~~ here.', '$5', 'here'],
  ['Brackets: \\[text\\](url), \\[^note\\], \\[@key\\], \\<b\\> and \\&amp; here.', '[text]', 'here'],
  ['\\# Not a heading but text', '# Not', 'heading'],
  ['1\\. Not a list item', '1. Not', 'list'],
  ['\\- Not a list either', '- Not', 'list'],
  ['\\> Not a quote at all', '> Not', 'quote'],
  ['Stars: x\\*\\*a\\*\\*, 中\\*\\*文\\*\\* and a \\*\\`b\\`\\* here.', 'x**a**', 'here'],
  ['**2\\*\\*3 = 8** is strong text', '2**3', 'strong'],
  ['Python: 2\\*\\*10 is 1024 here.', '2**10', 'here'],
  ['中文：中\\*\\*文\\*\\*字。', '中文：中', '字'],
  ['中文，标点：“引号”（括号）！还有 snake_case 和 a * b。', '标点', 'b'],
  ['Noncharacter: a\uFDD0b and \uFDD0\uFDD0 here.', 'a\uFDD0b', 'here'],
  ['\uFDD0# Not a heading after a noncharacter', '\uFDD0#', 'heading'],
  ['\\# Heading-like text with \uFDD0 inside', '# Heading-like', 'inside'],
  ['12\\. List-like text with \uFDD0 inside', '12. List-like', 'inside'],
];

const LAZY_SOURCE = article({ title: 'Lazy', slug: 'lazy', body: 'Some **bold** text and ==marked== words.\n' });

const dot = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#985b57' } }).png().toBuffer();


test.describe('copying from articles written for the cases of the conversion', () => {
  test.use({
    blog: {
      example: false,
      files: {
        'bake.config.js': validConfig,
        'content/posts/keys/index.md': article({ title: 'Keys', slug: 'keys', body: '## Keys {#a%zz}\n\nGates help [@a%zz] and [@b%20c] here, see [the keys](/2026-10/keys/#a%25zz) too.\n\n:::references\n- [@a%zz] First.\n- [@b%20c] Second.\n:::\n' }),
        'content/posts/dots/index.md': article({ title: 'Dots', slug: 'dots', body: '## Dots\n\n:::aside\nDots ![dot](dot.png){width=40px height=10px} and ![dot](dot.png){height=12px} inline.\n\n![Figure](dot.png){width=200px float=left}\n\nAfter the figure.\n:::\n' }),
        'content/posts/dots/dot.png': dot,
        'content/posts/host/index.md': article({ title: 'Host', slug: 'host', body: ':::embed\n/2026-10/keys/#a%25zz\n/2026-10/dots/#dots\n:::\n' }),
        'content/posts/ends/index.md': article({ title: 'Ends', slug: 'ends', body: '## Ends\n\nThe note ends with \\^b\n\n<p>Press <button>OK</button> now.</p>\n' }),
        'content/posts/raw/index.md': article({
          title: 'Raw',
          slug: 'raw',
          body: '## Keys\n\n<p>Raw text cites <a class="citation" href="#keys">[1]</a> before the end.</p>\n\n<ol class="references"><li>First plain entry.</li><li>Second plain entry.</li></ol>\n\n<p>Raw shows <img src="q.png" alt="q" data-attributes="oops"> and <img src="r.png" alt="r" data-attributes="{&quot;x} y&quot;:&quot;1&quot;,&quot;width&quot;:{&quot;a&quot;:1},&quot;height&quot;:&quot;12px&quot;}"> here.</p>\n',
        }),
        'content/posts/escapes/index.md': article({ title: 'Escapes', slug: 'escapes', body: `${escapedParagraphs.map(([text]) => text).join('\n\n')}\n` }),
        'content/posts/lazy/index.md': LAZY_SOURCE,
      },
    },
  });

  test('a converted citation, reference entry and internal link keep a key or an anchor with a percent sign as written', async ({ page }) => {
    await openWithSelectionModule(page, '/2026-10/keys/');
    const paragraph = '.bk-article p';
    await select(page, { selector: paragraph, contains: 'Gates', text: 'help' }, { selector: paragraph, contains: 'Gates', text: ' too', after: true });
    assert.equal((await copied(page)).text, 'help [@a%zz] and [@b%20c] here, see [the keys](/2026-10/keys/#a%25zz) too');
    await openWithSelectionModule(page, '/2026-10/host/');
    await select(page, { selector: '.embed li', contains: 'First', text: 'irst' }, { selector: '.embed li', contains: 'Second', text: 'Sec', after: true });
    assert.equal((await copied(page)).text, ':::references\n- [@a%zz] irst.\n- [@b%20c] Sec\n:::');
  });

  test('a converted image keeps the address and the attributes written in the source, and an embedded image links to its published file', async ({ page, baseURL }) => {
    const images = (address) => `ots ![dot](${address}){width=40px height=10px} and ![dot](${address}){height=12px} inline.\n\n![Figure](${address}){width=200px float=left}\n\nAft`;
    await openWithSelectionModule(page, '/2026-10/dots/');
    await select(page, { selector: '.aside p', contains: 'Dots', text: 'ots' }, { selector: '.aside p', contains: 'After', text: 'Aft', after: true });
    assert.equal((await copied(page)).text, `:::aside\n${images('dot.png')}\n:::`);
    await openWithSelectionModule(page, '/2026-10/host/');
    await select(page, { selector: '.embed .aside p', contains: 'Dots', text: 'ots' }, { selector: '.embed .aside p', contains: 'After', text: 'Aft', after: true });
    assert.equal((await copied(page)).text, `:::aside\n${images(`${baseURL}/2026-10/dots/dot.webp`)}\n:::`);
  });

  test('a paragraph keeps the escape of an ending that reads as a paragraph anchor, raw HTML is copied as its source, and the text of a button in raw HTML is left out of the HTML', async ({ page }) => {
    await openWithSelectionModule(page, '/2026-10/ends/');
    const paragraph = '.bk-article p';
    await select(page, { selector: paragraph, contains: 'note', text: 'note' }, { selector: paragraph, contains: 'Press', text: 'now', after: true });
    const { text, html } = await copied(page);
    assert.equal(text, 'note ends with \\^b\n\n<p>Press <button>OK</button> now.</p>');
    assert.doesNotMatch(html, /OK/);
  });

  test('a selection inside raw HTML copies the raw HTML block as written, because each boundary moves to the nearer edge of the block', async ({ page }) => {
    await openWithSelectionModule(page, '/2026-10/raw/');
    await select(page, { selector: '.bk-article p', contains: 'Raw', text: 'cites' }, { selector: '.bk-article p', contains: 'Raw', text: ' before', after: true });
    assert.equal((await copied(page)).text, '<p>Raw text cites <a class="citation" href="#keys">[1]</a> before the end.</p>');
    await select(page, { selector: '.bk-article li', contains: 'First', text: 'irst' }, { selector: '.bk-article li', contains: 'Second', text: 'Sec', after: true });
    assert.equal((await copied(page)).text, '<ol class="references"><li>First plain entry.</li><li>Second plain entry.</li></ol>');
    await select(page, { selector: '.bk-article p', contains: 'shows', text: 'shows' }, { selector: '.bk-article p', contains: 'shows', text: ' here', after: true });
    assert.match((await copied(page)).text, /^<p>Raw shows <img src="q.png" [^\n]* here\.<\/p>$/);
  });

  test('a part of a paragraph keeps the escapes written in the source and every other character, including U+FDD0, so the copy renders the same text', async ({ page }) => {
    await openWithSelectionModule(page, '/2026-10/escapes/');
    for (const [, from, to] of escapedParagraphs) {
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
  });

  const lazy = '/2026-10/lazy/';
  const paragraph = '.bk-article p';
  const selectWords = (target) => select(target, { selector: paragraph, text: 'bold' }, { selector: paragraph, text: 'marked', after: true });
  const dragAcross = async (target) => {
    const box = await target.locator(paragraph).boundingBox();
    await target.mouse.move(box.x + 2, box.y + box.height / 2);
    await target.mouse.down();
    await target.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await target.mouse.up();
  };

  test('a copy before the module that writes a selection as Markdown arrives is the browser copy, and a copy after it arrives is Markdown with the toast', async ({ newPage }) => {
    const early = await newPage();
    const errors = [];
    early.on('pageerror', (error) => errors.push(error.message));
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await early.route(
      (url) => isSelectionChunk(url.href),
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await early.goto(lazy);
    await selectWords(early);
    const before = await copied(early);
    assert.equal(before.text, 'bold text and marked');
    assert.match(before.html, /<strong[^>]*>bold<\/strong>/);
    assert.equal(await early.evaluate(() => getComputedStyle(document.querySelector('.bk-toast')).opacity), '0');
    const loaded = early.waitForResponse((response) => isSelectionChunk(response.url()));
    release();
    await selectionModuleReady(early, (await loaded).url());
    assert.equal((await copied(early)).text, '**bold** text and ==marked==');
    await toastShown(early);
    assert.deepEqual(errors, []);
  });

  test('when the module cannot be loaded, every copy is the browser copy without a toast, the masthead button still copies the source and the page reports no error', async ({ newPage }) => {
    const failing = await newPage();
    const errors = [];
    failing.on('pageerror', (error) => errors.push(error.message));
    const requested = [];
    await failing.route(
      (url) => isSelectionChunk(url.href),
      (route) => {
        requested.push(route.request().url());
        return route.abort();
      },
    );
    await failing.goto(lazy);
    await selectWords(failing);
    assert.equal((await copied(failing)).text, 'bold text and marked');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await dragAcross(failing);
      await selectWords(failing);
      assert.equal((await copied(failing)).text, 'bold text and marked');
    }
    assert.equal(await failing.evaluate(() => getComputedStyle(document.querySelector('.bk-toast')).opacity), '0');
    assert.equal(requested.length, 1);
    await failing.evaluate(() => getSelection().removeAllRanges());
    await failing.locator('.bk-copy-source').click();
    assert.equal(await failing.evaluate(() => navigator.clipboard.readText()), LAZY_SOURCE);
    assert.deepEqual(errors, []);
  });

  test('a page where nobody selects requests no module, and a selection, a context menu or a shortcut key loads it', async ({ newPage }) => {
    const triggers = {
      selection: dragAcross,
      'context menu': (target) => target.locator(paragraph).click({ button: 'right' }),
      'shortcut key': (target) => target.keyboard.press('Control'),
    };
    for (const [name, trigger] of Object.entries(triggers)) {
      const reader = await newPage();
      const requested = [];
      reader.on('request', (request) => isSelectionChunk(request.url()) && requested.push(request.url()));
      await reader.goto(lazy);
      await reader.waitForLoadState('networkidle');
      assert.deepEqual(requested, [], `the module loads before the ${name}`);
      const loading = reader.waitForRequest((request) => isSelectionChunk(request.url()), { timeout: 10000 });
      await trigger(reader);
      await selectionModuleReady(reader, (await loading).url());
      await selectWords(reader);
      assert.equal((await copied(reader)).text, '**bold** text and ==marked==', name);
    }
  });
});
