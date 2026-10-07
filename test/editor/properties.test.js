import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { format } from '../../src/format/index.js';
import { changedLines, exportMarkdown, openEditor, placeCursor, saveAfter, session, startSite } from './setup.js';

const path = 'content/features.md';
let site;
let page;
let errors;
let saves;

before(async () => {
  site = await startSite('properties');
  ({ page, errors, saves } = await openEditor(site, '/features/'));
  page.setDefaultTimeout(10000);
});

after(async () => {
  const text = site.read(path);
  await site.close();
  assert.deepEqual(errors, []);
  assert.equal(format(text), text);
});

const panel = '.bake-properties';

function panelTitle() {
  return page.textContent(`${panel} h2`);
}

function control(key, selector = 'input, select, textarea') {
  return page.locator(`${panel} .bake-field[data-key="${key}"]`).locator(selector).last();
}

function fieldError(key) {
  return page.textContent(`${panel} .bake-field[data-key="${key}"] .bake-field-error`);
}

async function check(name, action, expected) {
  const changes = await saveAfter(site, page, path, action);
  await site.screenshot(page, name);
  site.record(`${name}.diff`, [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
  assert.deepEqual(changes, expected);
  assert.equal(await exportMarkdown(page), site.read(path));
}

async function waitTitle(title) {
  await page.waitForFunction((title) => document.querySelector('.bake-properties:not([hidden]) h2')?.textContent === title, title);
}

async function clickPlot(plot) {
  const box = await plot.boundingBox();
  await plot.click({ position: { x: box.width / 2, y: 40 } });
  await waitTitle('demo-plot');
}

async function focusEditor() {
  await session(page, (current) => current.view.focus());
}

async function nodePosition(type, predicate = '() => true') {
  return session(page, (current, { type, predicate }) => {
    const test = new Function(`return (${predicate})`)();
    let found = null;
    current.view.state.doc.descendants((node, pos) => {
      if (found === null && node.type.name === type && test(node)) found = pos;
    });
    return found;
  }, { type, predicate });
}

describe('块属性', () => {
  test('点击提示框的边框打开面板，在空标签中输入名称，修改 kind', async () => {
    const callout = page.locator('.milkdown aside.callout.note').first();
    await callout.click({ position: { x: 4, y: 4 } });
    await page.waitForSelector(`${panel}:not([hidden])`);
    assert.equal(await panelTitle(), '提示框');
    assert.equal(await page.evaluate(() => document.body.classList.contains('properties-open')), true);
    await site.screenshot(page, 'callout-panel');
    await check('callout-label', async () => {
      await callout.locator('.callout-label').click();
      await page.keyboard.type('向量说明');
    }, { removed: [':::callout{kind=note}'], added: [':::callout[向量说明]{kind=note}'] });
    assert.equal(await panelTitle(), '提示框');
    await check('callout-kind-warning', () => control('kind').selectOption('warning'), { removed: [':::callout[向量说明]{kind=note}'], added: [':::callout[向量说明]{kind=warning}'] });
    assert.equal(await callout.count(), 0);
    await check('callout-kind-note', () => control('kind').selectOption('note'), { removed: [':::callout[向量说明]{kind=warning}'], added: [':::callout[向量说明]'] });
    assert.equal(await page.textContent('.milkdown aside.callout.note .callout-label'), '向量说明');
  });

  test('拖动组件的滑块时组件实时重画，松开后保存一次；修改 boolean 和 enum；Mod-Z 撤销一次修改', async () => {
    const plot = page.locator('.milkdown demo-plot').first();
    await clickPlot(plot);
    await plot.evaluate((element) => {
      window.plotElement = element;
    });
    await control('x0', 'input[type="range"]').scrollIntoViewIfNeeded();
    const slider = await control('x0', 'input[type="range"]').boundingBox();
    const y = slider.y + slider.height / 2;
    const at = (value) => slider.x + 8 + ((value + 2) / 4) * (slider.width - 16);
    const savesBefore = saves.length;
    const before = site.read(path);
    const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
    await page.mouse.move(at(1.2), y);
    await page.mouse.down();
    await page.mouse.move(at(0), y, { steps: 5 });
    const during = await plot.evaluate((element) => ({ x0: element.getAttribute('x0'), same: element === window.plotElement }));
    assert.equal(during.same, true);
    assert.notEqual(during.x0, '1.2');
    await page.waitForTimeout(1000);
    assert.equal(saves.length, savesBefore);
    assert.equal(site.read(path), before);
    await page.mouse.move(at(-1), y, { steps: 5 });
    await page.mouse.up();
    await response;
    await site.screenshot(page, 'component-slider');
    const changes = changedLines(before, site.read(path));
    site.record('component-slider.diff', [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
    const x0 = await plot.getAttribute('x0');
    assert.deepEqual(changes, { removed: [':::demo-plot{x0=1.2}'], added: [`:::demo-plot{x0=${x0}}`] });
    assert.equal(Number(x0) < -0.5, true);
    await page.waitForTimeout(1000);
    assert.equal(saves.length, savesBefore + 1);
    assert.equal(await plot.evaluate((element) => element === window.plotElement), true);
    await check('component-boolean', () => control('showPath').click(), { removed: [`:::demo-plot{x0=${x0}}`], added: [`:::demo-plot{x0=${x0} showPath=false}`] });
    await check('component-enum', () => control('curve').selectOption('quartic'), { removed: [`:::demo-plot{x0=${x0} showPath=false}`], added: [`:::demo-plot{x0=${x0} showPath=false curve=quartic}`] });
    assert.equal(await plot.getAttribute('curve'), 'quartic');
    await check('component-undo', async () => {
      await focusEditor();
      await page.keyboard.press('ControlOrMeta+z');
    }, { removed: [`:::demo-plot{x0=${x0} showPath=false curve=quartic}`], added: [`:::demo-plot{x0=${x0} showPath=false}`] });
    assert.equal(await plot.evaluate((element) => element === window.plotElement), true);
  });

  test('数字输入框按 Enter 写回，写成 String(Number(值))', async () => {
    const plot = page.locator('.milkdown demo-plot').first();
    await clickPlot(plot);
    const line = site.read(path).split('\n').find((text) => text.startsWith(':::demo-plot{'));
    await check('component-number', async () => {
      await control('x0', 'input[type="number"]').fill('1.50');
      await page.keyboard.press('Enter');
    }, { removed: [line], added: [line.replace(/x0=[^ }]+/, 'x0=1.5')] });
  });

  test('卡片的 span 输入 5x1 时显示错误说明，文件不变', async () => {
    const card = page.locator('.milkdown .card').first();
    await card.click({ position: { x: 4, y: 4 } });
    await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '卡片');
    const before = site.read(path);
    const savesBefore = saves.length;
    await control('span').fill('5x1');
    await page.keyboard.press('Enter');
    assert.equal(await fieldError('span'), ':::card span must be COLUMNSxROWS with 1 to 4 columns, got 5x1');
    await site.screenshot(page, 'card-span-error');
    await page.waitForTimeout(1000);
    assert.equal(saves.length, savesBefore);
    assert.equal(site.read(path), before);
    await check('card-span', async () => {
      await control('span').fill('3x1');
      await page.keyboard.press('Enter');
    }, { removed: [':::card{span=2x1 title=ReLU}'], added: [':::card{span=3x1 title=ReLU}'] });
  });

  test('标题的 id 和 toc', async () => {
    await page.click('.milkdown .bake-heading-id:text-is("#chain-rule")');
    await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '标题');
    await check('heading-id', async () => {
      await control('id').fill('chain');
      await page.keyboard.press('Enter');
    }, { removed: ['## 反向传播中的链式法则 {#chain-rule toc=链式法则}'], added: ['## 反向传播中的链式法则 {#chain toc=链式法则}'] });
    await check('heading-toc', async () => {
      await control('toc').fill('');
      await page.keyboard.press('Enter');
    }, { removed: ['## 反向传播中的链式法则 {#chain toc=链式法则}'], added: ['## 反向传播中的链式法则 {#chain}'] });
    await check('heading-id-empty', async () => {
      await control('id').fill('');
      await page.keyboard.press('Enter');
    }, { removed: ['## 反向传播中的链式法则 {#chain}'], added: ['## 反向传播中的链式法则'] });
    assert.equal(await control('id').getAttribute('placeholder'), '反向传播中的链式法则');
  });

  test('图片的 width 和 float', async () => {
    await page.click('.milkdown figure.image img[alt="一个神经元的输入、权重与输出"]');
    await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '图片');
    await check('image-width', async () => {
      await control('width').fill('50%');
      await page.keyboard.press('Enter');
    }, { removed: ['![一个神经元的输入、权重与输出](./assets/neuron.svg){width=60%}'], added: ['![一个神经元的输入、权重与输出](./assets/neuron.svg){width=50%}'] });
    await check('image-float', () => control('float').selectOption('left'), { removed: ['![一个神经元的输入、权重与输出](./assets/neuron.svg){width=50%}'], added: ['![一个神经元的输入、权重与输出](./assets/neuron.svg){width=50% float=left}'] });
    assert.equal(await panelTitle(), '图片');
  });

  test('面板打开时把光标移到普通段落，面板显示页面属性；关闭面板后旁注显示', async () => {
    const sidenote = page.locator('.milkdown .footnote-definition').first();
    assert.equal(await sidenote.isVisible(), false);
    await placeCursor(page, '正文段落。');
    await page.waitForFunction(() => document.querySelector('.bake-properties h2')?.textContent === '页面属性');
    await site.screenshot(page, 'page-properties');
    await page.click(`${panel} .bake-properties-close`);
    assert.equal(await page.isHidden(panel), true);
    assert.equal(await page.evaluate(() => document.body.classList.contains('properties-open')), false);
    assert.equal(await sidenote.isVisible(), true);
    await site.screenshot(page, 'panel-closed');
  });

  test('状态栏的「属性」按钮打开光标所在位置的块属性，Esc 关闭', async () => {
    await placeCursor(page, '先看图再看公式。');
    await page.click('.bake-properties-toggle');
    await page.waitForSelector(`${panel}:not([hidden])`);
    assert.equal(await panelTitle(), '提示框');
    assert.equal(await control('kind').inputValue(), 'tip');
    await control('kind').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden(panel), true);
  });
});

describe('页面属性与标题区', () => {
  async function openPage() {
    await placeCursor(page, '正文段落。');
    if (await page.isHidden(panel)) await page.click('.bake-properties-toggle');
    await waitTitle('页面属性');
  }

  async function chromeUpdated(action) {
    const updated = page.evaluate(() => new Promise((resolve) => window.addEventListener('bake:page-updated', resolve, { once: true })));
    await action();
    await updated;
  }

  test('在标题区输入新标题后按 Enter，文件中只有 title 一行变化', async () => {
    const heading = page.locator('header.mast > h1');
    assert.equal(await heading.getAttribute('contenteditable'), 'plaintext-only');
    await check('title-area', async () => {
      await heading.click();
      await page.keyboard.press('End');
      await page.keyboard.type('（新）');
      await page.keyboard.press('Enter');
    }, { removed: ['title: bake 的全部写法'], added: ['title: bake 的全部写法（新）'] });
    assert.equal(await heading.textContent(), 'bake 的全部写法（新）');
    assert.equal(await heading.evaluate((element) => element.innerHTML.includes('<br') || element.textContent.includes('\n')), false);
    await check('title-area-undo', () => page.keyboard.press('ControlOrMeta+z'), { removed: ['title: bake 的全部写法（新）'], added: ['title: bake 的全部写法'] });
    assert.equal(await heading.textContent(), 'bake 的全部写法');
  });

  test('清空标题后失去焦点，标题恢复，文件不变', async () => {
    const heading = page.locator('header.mast > h1');
    const before = site.read(path);
    const savesBefore = saves.length;
    await heading.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await focusEditor();
    assert.equal(await heading.textContent(), 'bake 的全部写法');
    await page.waitForTimeout(1000);
    assert.equal(saves.length, savesBefore);
    assert.equal(site.read(path), before);
  });

  test('在页面属性中修改 title 后标题区更新', async () => {
    await openPage();
    await site.screenshot(page, 'page-panel');
    assert.equal(await page.textContent(`${panel} h3`), '版式字段');
    await chromeUpdated(() =>
      check('page-title', async () => {
        await control('title').fill('全部写法');
        await page.keyboard.press('Enter');
      }, { removed: ['title: bake 的全部写法'], added: ['title: 全部写法'] }),
    );
    assert.equal(await page.textContent('header.mast > h1'), '全部写法');
    assert.equal(await page.title(), '全部写法 · bake minimal');
    assert.equal(await page.getAttribute('header.mast > h1', 'contenteditable'), 'plaintext-only');
    assert.equal(await page.isVisible(panel), true);
    assert.equal(await page.evaluate(() => document.body.classList.contains('bake-editing') && document.body.classList.contains('properties-open')), true);
  });

  test('关闭 toc 后目录消失', async () => {
    assert.equal(await page.locator('nav.toc').count(), 1);
    await chromeUpdated(() => check('page-toc', () => control('toc').click(), { removed: ['toc: true'], added: ['toc: false'] }));
    assert.equal(await page.locator('nav.toc').count(), 0);
  });

  test('layout 从 essay 改为 paper，删除 eyebrow，Mod-Z 恢复', async () => {
    const before = site.read(path);
    await chromeUpdated(() =>
      check('page-layout', () => control('layout').selectOption('paper'), {
        removed: ['layout: essay', 'width: normal', 'eyebrow: bake 示例 · 2026-10', 'toc: false'],
        added: ['layout: paper', 'width: normal'],
      }),
    );
    assert.equal(await page.locator('main.layout-paper').count(), 1);
    assert.equal(await page.locator('.milkdown').count(), 1);
    await site.screenshot(page, 'page-layout-paper');
    await chromeUpdated(() =>
      check('page-layout-undo', async () => {
        await focusEditor();
        await page.keyboard.press('ControlOrMeta+z');
      }, { removed: ['layout: paper', 'width: normal'], added: ['layout: essay', 'width: normal', 'eyebrow: bake 示例 · 2026-10', 'toc: false'] }),
    );
    assert.equal(site.read(path), before);
    assert.equal(await page.locator('main.layout-essay').count(), 1);
  });

  test('修改 slug 后浏览器地址改变，之后的输入照常保存', async () => {
    await openPage();
    await check('page-slug', async () => {
      await control('slug').fill('all-features');
      await page.keyboard.press('Enter');
    }, { removed: ['slug: features'], added: ['slug: all-features'] });
    await page.waitForFunction(() => location.pathname === '/all-features/');
    site.record('page-slug.url', `${new URL(page.url()).pathname}\n`);
    await check('after-slug', async () => {
      await placeCursor(page, '正文段落。');
      await page.keyboard.type('地址改变后。');
    }, { removed: ['正文段落。'], added: ['正文段落。地址改变后。'] });
  });

  test('slug 与另一篇文章重复时状态栏显示保存失败', async () => {
    await openPage();
    const before = site.read(path);
    const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
    await control('slug').fill('paper');
    await page.keyboard.press('Enter');
    assert.equal((await response).status(), 400);
    await page.waitForFunction(() => document.querySelector('.bake-save-state').dataset.kind === 'failed');
    const rejected = 'Failed to load resource: the server responded with a status of 400 (Bad Request)';
    assert.deepEqual(errors.splice(errors.indexOf(rejected), 1), [rejected]);
    assert.match(await page.textContent('.bake-save-state'), /^保存失败：Slug paper is already used by content\/paper\.md$/);
    await site.screenshot(page, 'page-slug-duplicate');
    assert.equal(site.read(path), before);
    await check('page-slug-restore', async () => {
      await control('slug').fill('features');
      await page.keyboard.press('Enter');
    }, { removed: ['slug: all-features'], added: ['slug: features'] });
    await page.waitForFunction(() => location.pathname === '/features/');
  });
});

describe('页面属性的错误', () => {
  test('frontmatter 有 YAML 语法错误时只显示错误说明', async () => {
    const original = await session(page, (current) => current.view.state.doc.attrs.frontmatter);
    const setFrontmatter = (value) => session(page, (current, value) => current.view.dispatch(current.view.state.tr.setDocAttribute('frontmatter', value)), value);
    await placeCursor(page, '正文段落');
    if (await page.isHidden(panel)) await page.click('.bake-properties-toggle');
    await setFrontmatter(original.replace(/^title: .*$/m, 'title: [a'));
    await page.waitForFunction(() => document.querySelectorAll('.bake-properties .bake-field').length === 0);
    assert.match(await page.textContent(`${panel} .bake-field-error`), /^Invalid YAML in frontmatter: /);
    await site.screenshot(page, 'page-yaml-error');
    await saveAfter(site, page, path, () => setFrontmatter(original));
    assert.equal(await page.locator(`${panel} .bake-field`).count() > 0, true);
  });
});
