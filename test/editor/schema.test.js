import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { exportMarkdown, openEditor, placeCursor, saveAfter, session, startSite } from './setup.js';

const path = 'content/features.md';
let site;

before(async () => {
  site = await startSite('schema');
});

after(async () => {
  await site.close();
});

function page(slug, body) {
  return `---\ntitle: ${slug}\nslug: ${slug}\n---\n\n${body}`;
}

for (const [name, body] of [
  ['卡片在卡片网格之外', ':::card{title=单独}\n\n卡片内容\n\n:::\n'],
  ['卡片在提示框之内', '::::callout{kind=note}\n\n:::card{title=嵌套}\n\n卡片内容\n\n:::\n\n::::\n'],
  ['副标题不在标题之后', '段落\n\n::subtitle[副标题]\n'],
]) {
  test(`结构错误：${name}时编辑器不打开`, async () => {
    const slug = `broken-${name.length}`;
    site.write(`content/${slug}.md`, page(slug, body));
    const { page: browserPage } = await openEditor(site, `/${slug}/`);
    assert.equal(await browserPage.textContent('.bake-save-state'), '文章有结构错误，修正后才能编辑');
    assert.equal(await browserPage.locator('article .milkdown').count(), 0);
    assert.equal(await browserPage.getAttribute('.bake-edit-toggle', 'aria-pressed'), 'false');
    await site.screenshot(browserPage, `structure-error-${slug}`);
    await browserPage.close();
  });
}

test('在两个段落之间插入空段落后保存，文件中没有 <br />', async () => {
  const original = site.read(path);
  const { page: browserPage, errors } = await openEditor(site, '/features/');
  const changes = await saveAfter(site, browserPage, path, async () => {
    await placeCursor(browserPage, '正文段落。');
    await browserPage.keyboard.press('Enter');
  });
  assert.doesNotMatch(site.read(path), /<br \/>/);
  assert.deepEqual(changes, { removed: [], added: ['', ''] });
  assert.equal(await exportMarkdown(browserPage), site.read(path));
  assert.deepEqual(errors, []);
  await browserPage.close();
  site.write(path, original);
});

test('旁注名大小写不同时往返不变，空注释导出为 [^n1]:', async () => {
  const markdown = page('notes', '引用大写[^D]，再引用空注释[^n1]。\n\n[^d]: 小写的注释。\n\n[^n1]:\n');
  site.write('content/notes.md', markdown);
  const { page: browserPage, errors } = await openEditor(site, '/notes/');
  assert.equal(await exportMarkdown(browserPage), markdown);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('组件属性改变时保留同一个元素并调用 attributeChangedCallback', async () => {
  const { page: browserPage, errors } = await openEditor(site, '/features/');
  const result = await session(browserPage, (current) => {
    const { state } = current.view;
    let position = null;
    state.doc.descendants((node, pos) => {
      if (position === null && node.type.name === 'component') position = pos;
    });
    const element = current.view.nodeDOM(position).querySelector('demo-plot');
    const plot = element.querySelector('svg');
    const attributes = { ...state.doc.nodeAt(position).attrs.attributes, x0: '-0.8' };
    current.view.dispatch(state.tr.setNodeAttribute(position, 'attributes', attributes));
    const after = current.view.nodeDOM(position).querySelector('demo-plot');
    return { same: after === element, x0: after.getAttribute('x0'), redrawn: after.querySelector('svg') !== plot };
  });
  assert.deepEqual(result, { same: true, x0: '-0.8', redrawn: true });
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('修改边注外层元素的 style 后元素不被重新创建', async () => {
  const { page: browserPage, errors, saves } = await openEditor(site, '/features/');
  const same = await browserPage.evaluate(async () => {
    const aside = document.querySelector('article aside.sidenote.unnumbered');
    aside.style.top = '40px';
    aside.classList.add('active');
    await new Promise((resolve) => setTimeout(resolve, 100));
    return document.querySelector('article aside.sidenote.unnumbered') === aside;
  });
  assert.equal(same, true);
  await browserPage.waitForTimeout(1000);
  assert.deepEqual(saves, []);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('修改 frontmatter 后保存并派发 bake:editor-saved，可以撤销', async () => {
  const { page: browserPage, errors } = await openEditor(site, '/features/');
  await browserPage.evaluate(() => {
    window.savedEvents = [];
    window.addEventListener('bake:editor-saved', (event) => window.savedEvents.push(event.detail));
  });
  const original = site.read(path);
  const response = browserPage.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await session(browserPage, (current) => {
    const { state } = current.view;
    current.view.dispatch(state.tr.setDocAttribute('frontmatter', state.doc.attrs.frontmatter.replace('category: demo', 'category: notes')));
  });
  const { hash } = await (await response).json();
  assert.equal(site.read(path), original.replace('category: demo', 'category: notes'));
  const [detail] = await browserPage.evaluate(() => window.savedEvents);
  assert.equal(detail.url, '/features/');
  assert.equal(detail.hash, hash);
  assert.equal(detail.frontmatter, original.split('---\n')[1].trimEnd().replace('category: demo', 'category: notes'));
  await saveAfter(site, browserPage, path, async () => {
    await placeCursor(browserPage, '正文段落。');
    await browserPage.keyboard.press('ControlOrMeta+z');
  });
  assert.equal(site.read(path), original);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('加宽块里的表格与下一段的间距在阅读模式和编辑模式中相同', async () => {
  const gapAfterWide = (browserPage) =>
    browserPage.evaluate(() => {
      const wide = document.querySelector('article .wide');
      return Math.round(wide.nextElementSibling.getBoundingClientRect().top - wide.querySelector('table').getBoundingClientRect().bottom);
    });
  const reading = await site.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await reading.goto(`${site.origin}/features/`);
  const read = await gapAfterWide(reading);
  await reading.close();
  const { page: browserPage, errors } = await openEditor(site, '/features/');
  assert.equal(await gapAfterWide(browserPage), read);
  assert.ok(read > 0);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('slug 改变后浏览器地址和之后的保存使用新地址', async () => {
  const { page: browserPage, errors, saves } = await openEditor(site, '/features/');
  const response = browserPage.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await session(browserPage, (current) => {
    const { state } = current.view;
    current.view.dispatch(state.tr.setDocAttribute('frontmatter', state.doc.attrs.frontmatter.replace('slug: features', 'slug: all-features')));
  });
  assert.equal((await (await response).json()).url, '/all-features/');
  assert.equal(await browserPage.evaluate(() => location.pathname), '/all-features/');
  await saveAfter(site, browserPage, path, async () => {
    await placeCursor(browserPage, '正文段落。');
    await browserPage.keyboard.type('新地址');
  });
  assert.equal(saves.at(-1).page, '/all-features/');
  assert.match(site.read(path), /正文段落。新地址/);
  assert.deepEqual(errors, []);
  await browserPage.close();
});
