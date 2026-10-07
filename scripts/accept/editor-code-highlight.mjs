import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { bundledLanguagesInfo } from 'shiki';
import { codePage, expectedLanguageFiles, languageFile, styledSpans } from '../../test/editor/code-page.js';

const [scenario, origin, blog, output] = process.argv.slice(2);
const languageIds = new Set(bundledLanguagesInfo.map(({ id }) => id));
const problems = [];

function pythonLines(count) {
  return Array.from({ length: count }, (_, index) => (index % 4 === 0 ? `def step_${index}(x, y=${index}):` : index % 4 === 3 ? `    return x * y  # line ${index}` : `    x = x + "${index}" if y > ${index} else x`)).join('\n');
}

function prepare() {
  writeFileSync(join(blog, 'content/code.md'), codePage);
  writeFileSync(join(blog, 'content/long.md'), `---\ntitle: 长代码块\nslug: long\n---\n\n普通段落。\n\n\`\`\`python\n${pythonLines(40)}\n\`\`\`\n\n\`\`\`python\n${pythonLines(200)}\n\`\`\`\n`);
}

async function open(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}${url}`);
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

async function startEditing(page) {
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state')?.textContent === '已保存');
}

function waitForHighlight(page) {
  return page.waitForFunction(() =>
    [...document.querySelectorAll('.milkdown pre')].every((pre) => !['python', 'javascript', 'bash', 'json', 'markdown'].includes(pre.querySelector('.bake-code-language').value) || pre.querySelector('code span[style]')),
  );
}

function printSpans(label, blocks) {
  console.log(`${label}:`);
  blocks.forEach((spans, index) => {
    console.log(`  code block ${index + 1}: ${spans.length} spans`);
    for (const [text, style] of spans) console.log(`    ${JSON.stringify(text)} ${style}`);
  });
}

async function colors() {
  const { browser, page } = await open('/code/');
  await page.screenshot({ path: join(output, 'read.png'), fullPage: true });
  const read = await page.evaluate(styledSpans, 'article pre code');
  await startEditing(page);
  await waitForHighlight(page);
  await page.screenshot({ path: join(output, 'edit.png'), fullPage: true, caret: 'initial' });
  const edit = await page.evaluate(styledSpans, 'article pre code');
  await browser.close();
  printSpans('read mode', read);
  printSpans('edit mode', edit);
  const equal = JSON.stringify(read) === JSON.stringify(edit);
  console.log(`span lists equal: ${equal}`);
  if (!equal) problems.push('span lists differ between read and edit mode');
}

function size(url) {
  const path = new URL(url).pathname;
  if (!path.startsWith('/@fs/')) return '';
  try {
    return `${statSync(decodeURIComponent(path.slice(4))).size} bytes on disk`;
  } catch {
    return '';
  }
}

async function requests() {
  for (const url of ['/code/', '/paper/']) {
    const { browser, page } = await open(url);
    const urls = [];
    page.on('request', (request) => urls.push(request.url()));
    await startEditing(page);
    if (url === '/code/') await waitForHighlight(page);
    await page.waitForTimeout(1000);
    await browser.close();
    const related = urls.filter((request) => request.includes('shiki') || request.includes('highlighter') || /\/deps\/wasm-/.test(request) || languageFile(request, languageIds));
    console.log(`requests made after clicking 编辑 on ${url} that belong to code highlighting (${related.length}):`);
    for (const request of related) console.log(`  ${new URL(request).pathname} ${size(request)}`);
    const languages = [...new Set(urls.map((request) => languageFile(request, languageIds)).filter(Boolean))].sort();
    console.log(`  language files: ${JSON.stringify(languages)}`);
    if (url === '/code/' && JSON.stringify(languages) !== JSON.stringify(expectedLanguageFiles)) problems.push(`unexpected language files ${JSON.stringify(languages)}`);
    if (url === '/paper/' && related.length > 0) problems.push('paper.md loaded code highlighting');
  }
}

function summary(name, times) {
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`${name}: ${times.length} transactions, median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} ms, max ${sorted.at(-1).toFixed(2)} ms`);
}

async function timing() {
  const { browser, page } = await open('/long/');
  await startEditing(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.milkdown pre')].every((pre) => pre.querySelector('code span[style]')));
  const entry = `/@fs${join(import.meta.dirname, '../../src/editor/index.js')}`;
  await page.evaluate(async (entry) => {
    const { view } = (await import(entry)).currentSession();
    const dispatch = view.dispatch.bind(view);
    window.dispatchTimes = [];
    view.dispatch = (tr) => {
      const start = performance.now();
      dispatch(tr);
      window.dispatchTimes.push(performance.now() - start);
    };
    window.placeAtEnd = (text) => {
      let found = null;
      view.state.doc.descendants((node, pos) => {
        if (found !== null || !node.isTextblock) return found === null;
        const index = node.textContent.indexOf(text);
        if (index !== -1) found = pos + 1 + index + text.length;
        return false;
      });
      view.focus();
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, found)));
    };
  }, entry);
  for (const [name, anchor] of [
    ['paragraph', '普通段落。'],
    ['40-line python block', 'return x * y  # line 39'],
    ['200-line python block', 'return x * y  # line 199'],
  ]) {
    await page.evaluate((anchor) => window.placeAtEnd(anchor), anchor);
    await page.evaluate(() => {
      window.dispatchTimes = [];
    });
    for (let index = 0; index < 50; index++) await page.keyboard.type('a');
    summary(name, await page.evaluate(() => window.dispatchTimes));
  }
  await browser.close();
  console.log('times are measured around view.dispatch in headless Chromium and include every plugin and the DOM update');
}

async function unknownLanguage() {
  const { browser, page } = await open('/code/');
  await startEditing(page);
  await waitForHighlight(page);
  const language = page.locator('.milkdown pre').first().locator('.bake-code-language');
  await language.fill('pyhton');
  await language.press('Enter');
  await page.locator('.milkdown pre').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'unknown.png'), caret: 'initial' });
  await language.hover();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(output, 'unknown-hover.png'), caret: 'initial' });
  const className = await language.getAttribute('class');
  const title = await language.getAttribute('title');
  const decoration = await language.evaluate((element) => getComputedStyle(element).textDecorationLine + ' ' + getComputedStyle(element).textDecorationStyle);
  console.log(`class: ${className}`);
  console.log(`title: ${title}`);
  console.log(`computed text-decoration: ${decoration}`);
  console.log('headless Chromium does not draw native title tooltips in screenshots; the title attribute above is the text the tooltip shows');
  await language.fill('python');
  await language.press('Enter');
  await page.waitForTimeout(1500);
  await browser.close();
  if (className !== 'bake-code-language unknown-language' || title !== '未知的语言名，构建时会报错' || decoration !== 'underline wavy') problems.push('unknown language hint missing');
}

async function fallback() {
  const theme = join(blog, 'themes/default.css');
  const original = readFileSync(theme, 'utf8');
  writeFileSync(theme, original.replace(/^\s*--code-[\w-]+:.*\n/gm, ''));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const { browser, page } = await open('/code/');
    const keyword = () => getComputedStyle([...document.querySelectorAll('article pre code span[style]')].find((span) => span.textContent === 'def')).color;
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-accent)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await page.screenshot({ path: join(output, 'read.png'), fullPage: true });
    const read = await page.evaluate(keyword);
    await startEditing(page);
    await waitForHighlight(page);
    await page.screenshot({ path: join(output, 'edit.png'), fullPage: true, caret: 'initial' });
    const edit = await page.evaluate(keyword);
    await browser.close();
    console.log(`--color-accent: ${accent}`);
    console.log(`color of def in read mode: ${read}`);
    console.log(`color of def in edit mode: ${edit}`);
    if (read !== accent || edit !== accent) problems.push('keyword color does not fall back to --color-accent');
  } finally {
    writeFileSync(theme, original);
  }
}

const scenarios = { prepare, colors, requests, timing, unknownLanguage, fallback };
await scenarios[scenario]();
if (scenario !== 'prepare') console.log(`console errors and warnings: ${problems.filter((problem) => problem.startsWith('console') || problem.startsWith('pageerror')).length}`);
for (const problem of problems) console.log(`problem: ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
