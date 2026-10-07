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
    await site.addPage(`content/${slug}.md`, page(slug, body), `/${slug}/`);
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

test('在引用块最后一段末尾和文章第一段开头按 Enter 都新建普通段落', async () => {
  const file = 'content/quote.md';
  await site.addPage(file, page('quote', '首段。\n\n> 引用的第一段。\n>\n> 引用的最后一段。\n'), '/quote/');
  const { page: browserPage, errors } = await openEditor(site, '/quote/');
  await saveAfter(site, browserPage, file, async () => {
    await placeCursor(browserPage, '引用的最后一段。');
    await browserPage.keyboard.press('Enter');
    await browserPage.keyboard.type('新段落');
  });
  assert.equal(site.read(file), page('quote', '首段。\n\n> 引用的第一段。\n>\n> 引用的最后一段。\n>\n> 新段落\n'));
  await session(browserPage, (current) => {
    const { state } = current.view;
    current.view.dispatch(state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(1))));
    current.view.focus();
  });
  await browserPage.keyboard.press('Enter');
  const types = await session(browserPage, (current) => {
    const names = [];
    current.view.state.doc.descendants((node) => {
      if (node.isBlock) names.push(node.type.name);
    });
    return names;
  });
  assert.deepEqual(types, ['paragraph', 'paragraph', 'blockquote', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('文末插入只含图片的段落后，光标落在后面的空段落，空段落不写入文件', async () => {
  const file = 'content/image-end.md';
  const markdown = page('image-end', '段落。\n\n![图](./assets/relu.png)\n');
  await site.addPage(file, markdown, '/image-end/');
  const { page: browserPage, errors } = await openEditor(site, '/image-end/');
  assert.equal(await exportMarkdown(browserPage), markdown);
  await saveAfter(site, browserPage, file, async () => {
    await session(browserPage, (current) => {
      const { state } = current.view;
      const image = state.schema.nodes.image.create({ src: './assets/relu.png', alt: '第二张' });
      const size = state.doc.content.size;
      const tr = state.tr.replaceWith(size - state.doc.lastChild.nodeSize, size, state.schema.nodes.paragraph.create(null, image));
      current.view.dispatch(tr.setSelection(state.selection.constructor.create(tr.doc, tr.doc.content.size - 1)));
      current.view.focus();
    });
    await browserPage.keyboard.type('后文');
  });
  assert.equal(site.read(file), page('image-end', '段落。\n\n![图](./assets/relu.png)\n\n![第二张](./assets/relu.png)\n\n后文\n'));
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('剪切带 ^id 的整段后，留下的空段落不保留这个 id', async () => {
  const file = 'content/cut.md';
  await site.addPage(file, page('cut', '第一段。\n\n被剪切的段落。 ^cut-me\n\n## 被清空的标题 {#cut-heading}\n\n最后一段。\n'), '/cut/');
  const { page: browserPage, errors } = await openEditor(site, '/cut/');
  await saveAfter(site, browserPage, file, async () => {
    await placeCursor(browserPage, '被剪切的段落。', { select: true });
    await browserPage.keyboard.press('ControlOrMeta+x');
    await placeCursor(browserPage, '被清空的标题', { select: true });
    await browserPage.keyboard.press('Backspace');
  });
  const saved = site.read(file);
  assert.doesNotMatch(saved, /cut-me|cut-heading/);
  const ids = await session(browserPage, (current) => {
    const found = [];
    current.view.state.doc.descendants((node) => {
      if (node.attrs.blockId || node.attrs.attributes?.id) found.push(node.attrs.blockId ?? node.attrs.attributes.id);
    });
    return found;
  });
  assert.deepEqual(ids, []);
  await browserPage.keyboard.press('ControlOrMeta+z');
  assert.match(await exportMarkdown(browserPage), /被清空的标题 \{#cut-heading\}/);
  assert.deepEqual(errors, []);
  await browserPage.close();
});

test('旁注名大小写不同时往返不变，空注释导出为 [^n1]:', async () => {
  const markdown = page('notes', '引用大写[^D]，再引用空注释[^n1]。\n\n[^d]: 小写的注释。\n\n[^n1]:\n');
  await site.addPage('content/notes.md', markdown, '/notes/');
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
  const file = 'content/rename.md';
  await site.addPage(file, page('rename', '改名前的段落。\n'), '/rename/');
  const { page: browserPage, errors, saves } = await openEditor(site, '/rename/');
  const response = browserPage.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await session(browserPage, (current) => {
    const { state } = current.view;
    current.view.dispatch(state.tr.setDocAttribute('frontmatter', state.doc.attrs.frontmatter.replace('slug: rename', 'slug: renamed')));
  });
  assert.equal((await (await response).json()).url, '/renamed/');
  assert.equal(await browserPage.evaluate(() => location.pathname), '/renamed/');
  await saveAfter(site, browserPage, file, async () => {
    await placeCursor(browserPage, '改名前的段落。');
    await browserPage.keyboard.type('新地址');
  });
  assert.equal(saves.at(-1).page, '/renamed/');
  assert.match(site.read(file), /改名前的段落。新地址/);
  assert.deepEqual(errors, []);
  await browserPage.close();
});
