import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { bundledLanguagesInfo } from 'shiki';
import { bakeRoot } from '../../src/dev/plugin.js';
import { codePage, expectedLanguageFiles, isWasm, languageFile, plainPage, styledSpans } from './code-page.js';
import { exportMarkdown, openEditor, saveAfter, session, startSite } from './setup.js';

const path = 'content/code.md';
const highlighterModule = `/@fs${join(bakeRoot, 'src/render/highlighter.js')}`;
const languageIds = new Set(bundledLanguagesInfo.map(({ id }) => id));
let site;

before(async () => {
  site = await startSite('code-highlight');
  site.write(path, codePage);
  site.write('content/plain-code.md', plainPage);
});

after(async () => {
  await site.close();
});

function watchRequests(page) {
  const urls = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

async function startEditing(page) {
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
}

function waitForHighlight(page) {
  return page.waitForFunction(() => {
    const blocks = [...document.querySelectorAll('.milkdown pre')];
    return blocks.length > 0 && blocks.every((pre) => !['python', 'javascript', 'bash', 'json', 'markdown'].includes(pre.querySelector('.bake-code-language').value) || pre.querySelector('code span[style]'));
  });
}

async function placeCursor(page, text) {
  await session(
    page,
    (current, text) => {
      const { view } = current;
      let found = null;
      view.state.doc.descendants((node, pos) => {
        if (found !== null || !node.isTextblock) return found === null;
        const index = node.textContent.indexOf(text);
        if (index !== -1) found = pos + 1 + index + text.length;
        return false;
      });
      if (found === null) throw new Error(`Text not found: ${text}`);
      view.focus();
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, found)));
    },
    text,
  );
}

async function closeEditor(page) {
  await session(page, (current) => current.close());
  await page.close();
}

function codeBlock(page, index) {
  return page.locator('.milkdown pre').nth(index);
}

async function newPage() {
  const page = await site.browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  return { page, errors };
}

test('编辑器中代码块的颜色与页面相同，只加载用到的语言，页面不刷新，文档不变', async () => {
  const { page, errors } = await newPage();
  let navigations = 0;
  page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations++);
  let releaseShiki;
  const shikiHeld = new Promise((resolve) => {
    releaseShiki = resolve;
  });
  await page.route(/\/deps\/shiki\.js/, async (route) => {
    await shikiHeld;
    await route.continue();
  });
  await page.goto(`${site.origin}/code/`);
  const read = await page.evaluate(styledSpans, 'article pre code');
  await site.screenshot(page, 'read');
  const urls = watchRequests(page);
  await startEditing(page);
  await page.evaluate(async (entry) => {
    window.loadedDoc = (await import(entry)).currentSession().view.state.doc;
  }, `/@fs${join(bakeRoot, 'src/editor/index.js')}`);
  releaseShiki();
  await waitForHighlight(page);
  await site.screenshot(page, 'edit');
  const edit = await page.evaluate(styledSpans, 'article pre code');
  assert.equal(read.length, 9);
  assert.ok(read.flat().length > 30);
  assert.deepEqual(edit, read);
  assert.ok(read[4].some(([text, style]) => text.includes('斜体') && style.includes('font-style: italic')));

  assert.deepEqual([...new Set(urls.map((url) => languageFile(url, languageIds)).filter(Boolean))].sort(), expectedLanguageFiles);
  assert.equal(navigations, 1);
  assert.equal(await session(page, (current) => current.view.state.doc === window.loadedDoc), true);
  assert.equal(await exportMarkdown(page), site.read(path));
  await page.waitForTimeout(1000);
  assert.equal(urls.filter((url) => url.endsWith('/__bake/save')).length, 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('没有代码块的文章不加载 Shiki；只有纯文本和未知语言名的文章不加载 WebAssembly 和语言文件', async () => {
  const { page, errors } = await newPage();
  const urls = watchRequests(page);
  await page.goto(`${site.origin}/paper/`);
  await startEditing(page);
  await page.waitForTimeout(1000);
  assert.deepEqual(urls.filter((url) => url.includes('shiki')), []);
  await site.screenshot(page, 'no-code');

  urls.length = 0;
  await page.goto(`${site.origin}/plain-code/`);
  await startEditing(page);
  await page.waitForSelector('.milkdown .bake-code-language.unknown-language');
  await page.waitForTimeout(500);
  assert.equal(urls.some((url) => new URL(url).pathname.endsWith('/deps/shiki.js')), true);
  assert.deepEqual(urls.filter((url) => isWasm(url) || languageFile(url, languageIds)), []);
  assert.equal(await page.locator('.milkdown pre code span[style]').count(), 0);
  await site.screenshot(page, 'plain-only');
  assert.deepEqual(errors, []);
  await page.close();
});

test('输入时只重新分词变化的代码块，保存后文件只改变这一行', async () => {
  site.write(path, codePage);
  const { page, errors } = await openEditor(site, '/code/');
  await waitForHighlight(page);
  await page.evaluate(async (entry) => {
    const shiki = await (await import(entry)).highlighter();
    const codeToHast = shiki.codeToHast.bind(shiki);
    window.tokenizeCount = 0;
    shiki.codeToHast = (...args) => {
      window.tokenizeCount++;
      return codeToHast(...args);
    };
    for (const span of document.querySelectorAll('.milkdown pre code span')) span.marked = true;
  }, highlighterModule);

  const changes = await saveAfter(site, page, path, async () => {
    await placeCursor(page, 'sum + item.price');
    await page.keyboard.type('1');
  });
  assert.deepEqual(changes, { removed: ['const total = items.reduce((sum, item) => sum + item.price, 0);'], added: ['const total = items.reduce((sum, item) => sum + item.price1, 0);'] });
  assert.equal(await page.evaluate(() => window.tokenizeCount), 1);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.milkdown pre')].filter((_, index) => index !== 1).every((pre) => [...pre.querySelectorAll('code span')].every((span) => span.marked))), true);
  await site.screenshot(page, 'typing-code');

  await saveAfter(site, page, path, async () => {
    await placeCursor(page, 'Python：');
    await page.keyboard.type('段落');
  });
  assert.equal(await page.evaluate(() => window.tokenizeCount), 1);
  assert.equal(await exportMarkdown(page), site.read(path));
  assert.deepEqual(errors, []);
  await closeEditor(page);
});

test('修改语言名后重新高亮，未知语言名显示提示，撤销后恢复', async () => {
  site.write(path, codePage);
  const { page, errors } = await openEditor(site, '/code/');
  const urls = watchRequests(page);
  await waitForHighlight(page);
  const initial = await page.evaluate(styledSpans, '.milkdown pre code');
  const python = codeBlock(page, 0);
  const language = python.locator('.bake-code-language');
  const setLanguage = async (name) => {
    await language.fill(name);
    await language.press('Enter');
  };
  const styledCount = () => python.locator('code span[style]').count();

  await setLanguage('text');
  assert.equal(await styledCount(), 0);
  await site.screenshot(page, 'language-text');

  await setLanguage('pyhton');
  assert.equal(await language.getAttribute('class'), 'bake-code-language unknown-language');
  assert.equal(await language.getAttribute('title'), '未知的语言名，构建时会报错');
  assert.equal(await styledCount(), 0);
  await site.screenshot(page, 'language-unknown');

  await setLanguage('rust');
  await page.waitForFunction(() => document.querySelector('.milkdown pre').querySelector('code span[style]'));
  assert.equal(await language.getAttribute('class'), 'bake-code-language');
  assert.equal(await language.getAttribute('title'), null);
  assert.ok(urls.some((url) => languageFile(url, languageIds) === 'rust'));
  await site.screenshot(page, 'language-rust');

  await placeCursor(page, 'return [p.grad');
  for (let attempt = 0; attempt < 3 && (await language.inputValue()) !== 'python'; attempt++) {
    await page.keyboard.press('ControlOrMeta+z');
  }
  assert.equal(await language.inputValue(), 'python');
  const undone = await page.evaluate(styledSpans, '.milkdown pre code');
  assert.ok(initial[0].length > 0);
  assert.deepEqual(undone[0], initial[0]);
  await site.screenshot(page, 'language-undo');
  assert.deepEqual(errors, []);
  await closeEditor(page);
});

test('语言文件加载失败时状态栏显示消息，代码块仍可编辑和保存', async () => {
  site.write(path, codePage);
  const { page, errors } = await newPage();
  await page.route(/\/deps\/python-[\w-]{8}\.js/, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${site.origin}/code/`);
  await startEditing(page);
  await page.waitForSelector('.bake-status-message:not([hidden])');
  assert.equal(await page.textContent('.bake-status-message span'), '代码高亮加载失败');
  await page.waitForFunction(() => document.querySelectorAll('.milkdown pre')[1].querySelector('code span[style]'));
  assert.equal(await codeBlock(page, 0).locator('code span[style]').count(), 0);
  const changes = await saveAfter(site, page, path, async () => {
    await placeCursor(page, '# 反向传播');
    await page.keyboard.type('！');
  });
  assert.deepEqual(changes, { removed: ['    # 反向传播'], added: ['    # 反向传播！'] });
  await site.screenshot(page, 'load-failure');
  assert.deepEqual(errors.filter((error) => !error.includes('404')), []);
  await closeEditor(page);
});

test('代码块改为段落后，段落中没有代码的颜色', async () => {
  site.write(path, codePage);
  const { page, errors } = await openEditor(site, '/code/');
  await waitForHighlight(page);
  await session(page, (current) => {
    const { view } = current;
    let target = null;
    view.state.doc.descendants((node, pos) => {
      if (target === null && node.type.name === 'code_block') target = pos;
      return target === null;
    });
    view.dispatch(view.state.tr.setBlockType(target + 1, target + 1, view.state.schema.nodes.paragraph));
  });
  assert.equal(await page.locator('.milkdown p span[style]').count(), 0);
  assert.equal(await page.locator('.milkdown pre').count(), 8);
  await site.screenshot(page, 'code-to-paragraph');
  assert.deepEqual(errors, []);
  await closeEditor(page);
});

test('在代码块中输入时，相邻代码块的未知语言名提示保留', async () => {
  site.write('content/adjacent.md', '---\ntitle: 相邻代码块\nslug: adjacent\n---\n\n```pyhton\nx\n```\n\n```python\ny = 1\n```\n');
  const { page, errors } = await openEditor(site, '/adjacent/');
  await page.waitForFunction(() => document.querySelectorAll('.milkdown pre')[1].querySelector('code span[style]'));
  const language = codeBlock(page, 0).locator('.bake-code-language');
  assert.equal(await language.getAttribute('class'), 'bake-code-language unknown-language');
  await placeCursor(page, 'y = 1');
  await page.keyboard.type('2');
  assert.equal(await codeBlock(page, 1).locator('code').textContent(), 'y = 12');
  assert.equal(await language.getAttribute('class'), 'bake-code-language unknown-language');
  await site.screenshot(page, 'adjacent');
  assert.deepEqual(errors, []);
  await closeEditor(page);
});
