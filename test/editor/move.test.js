import assert from 'node:assert/strict';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parse } from '../../src/format/index.js';
import { card, clickMenu, drag, dragTo, frames, grab, hover, menuItems, openMenu, paragraph, pointIn, visibleHandles } from './block-actions.js';
import { exportMarkdown, openEditor, placeCursor, saveAfter, session, startSite } from './setup.js';

const path = 'content/blocks.md';
const viewport = { width: 1440, height: 2200 };
let site;
let page;
let errors;
let original;
let videoName;







function blockBox(pos) {
  return session(
    page,
    (current, pos) => {
      let dom = current.view.nodeDOM(pos);
      while (getComputedStyle(dom).display === 'contents') dom = dom.firstElementChild;
      return dom.getBoundingClientRect().toJSON();
    },
    pos,
  );
}


function selectionState() {
  return session(page, (current) => {
    const { $from } = current.view.state.selection;
    return { text: $from.parent.textContent, offset: $from.parentOffset };
  });
}

async function settled() {
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  const deadline = Date.now() + 10000;
  while ((await exportMarkdown(page)) !== site.read(path)) {
    if (Date.now() > deadline) throw new Error('The editor did not save its document');
    await page.waitForTimeout(200);
  }
}

function recordDiff(name, changes) {
  site.record(`${name}.diff`, [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
}

function assertValid(file) {
  assert.deepEqual(parse(file).messages, []);
}

async function undo(name, file) {
  const changes = await saveAfter(site, page, path, () => page.keyboard.press('ControlOrMeta+z'));
  await settled();
  recordDiff(`${name}-undo`, changes);
  assert.equal(site.read(path), file);
}

async function check(name, action, expected) {
  const before = site.read(path);
  const changes = await saveAfter(site, page, path, action);
  await settled();
  await site.screenshot(page, name);
  recordDiff(name, changes);
  const file = site.read(path);
  if (typeof expected === 'function') assert.equal(file, expected(before));
  else assert.deepEqual(changes, expected);
  assertValid(file);
  await undo(name, before);
}

async function unchanged(name, action) {
  const before = site.read(path);
  const markdown = await exportMarkdown(page);
  await action();
  await page.waitForTimeout(1000);
  await site.screenshot(page, name);
  assert.equal(await exportMarkdown(page), markdown);
  assert.equal(site.read(path), before);
}







function dragStep(name, source, type, target) {
  return drag(page, source, type, target, join(site.output, `${name}-dragging.png`));
}

async function closePage() {
  await settled();
  const video = page.video();
  await page.close();
  if (video) renameSync(await video.path(), join(site.output, `${videoName}.webm`));
  assert.deepEqual(errors, []);
}

before(async () => {
  site = await startSite('move');
  original = site.read(path);
});

after(async () => {
  await site.close();
});

describe('拖动手柄', () => {
  before(async () => {
    ({ page, errors } = await openEditor(site, '/blocks/', { viewport }));
  });

  after(closePage);

  test('指针移到每种块上，手柄出现在该块左侧', async () => {
    const cases = [
      [paragraph(page, '第一段正文'), 'paragraph', '第一段正文。'],
      [page.locator('.milkdown .editor h2', { hasText: '带副标题的标题' }), 'heading', '带副标题的标题'],
      [paragraph(page, '无序列表第二项'), 'list_item', '无序列表第二项'],
      [page.locator('.milkdown .editor td', { hasText: 'ReLU' }), 'table', null],
      [page.locator('.milkdown .editor demo-plot'), 'component', null],
      [page.locator('.milkdown .editor .math.display'), 'math_block', null],
      [paragraph(page, '带块 id 的段落'), 'paragraph', '带块 id 的段落。'],
      [paragraph(page, '引用块里的文字'), 'blockquote', null],
      [paragraph(page, '只有一段的提示框'), 'directive_callout', null],
      [paragraph(page, '第三张卡片'), 'directive_card', null],
    ];
    for (const [locator, type, text] of cases) {
      await hover(page, locator, 0.1, 0.5);
      const [handle] = await visibleHandles(page);
      assert.equal(handle?.type, type, `指针在 ${type} 上`);
      if (text !== null) assert.equal(handle.text, text);
      const box = await blockBox(handle.pos);
      assert.ok(Math.abs(handle.right - (box.left - 6)) <= 1, `${type} 的手柄右边缘距块左边缘 6px`);
      assert.equal(handle.width, 18);
      assert.equal(handle.height, 24);
      assert.ok(handle.top >= box.top - 12 && handle.top <= box.bottom, `${type} 的手柄在块的纵向范围内`);
    }
    await page.screenshot({ path: join(site.output, 'handle-table.png') });
  });

  test('提示框里的段落上同时出现段落和提示框的手柄，外层手柄向左让开', async () => {
    await hover(page, paragraph(page, '提示框的第一段'));
    const handles = await visibleHandles(page);
    assert.deepEqual(
      handles.map((handle) => handle.type),
      ['paragraph', 'directive_callout'],
    );
    const [inner, outer] = handles;
    if (outer.top < inner.bottom && inner.top < outer.bottom) assert.ok(outer.right <= inner.left + 0.5);
    await page.screenshot({ path: join(site.output, 'handle-callout.png') });
  });

  test('卡片网格中指针在第三张卡片上时手柄指向第三张', async () => {
    await hover(page, card(page, '丙'), 0.5, 0.7);
    const handles = await visibleHandles(page);
    assert.deepEqual(
      handles.map((handle) => [handle.type, handle.text]),
      [
        ['directive_card', '第三张卡片。'],
        ['directive_bento', '第一张卡片。第二张卡片。第三张卡片。'],
      ],
    );
    await page.screenshot({ path: join(site.output, 'handle-card.png') });
  });

  test('导语、副标题、注释、表格单元格、只有一个段落的提示框中的段落没有自己的手柄', async () => {
    await hover(page, paragraph(page, '这一页用来测试'));
    assert.deepEqual(await visibleHandles(page), []);
    await hover(page, page.locator('.milkdown .editor .subtitle'));
    assert.deepEqual(await visibleHandles(page), []);
    await hover(page, page.locator('.milkdown .editor .sidenote', { hasText: '第一条旁注的内容' }), 0.5, 0.5);
    assert.deepEqual(await visibleHandles(page), []);
    await hover(page, page.locator('.milkdown .editor td', { hasText: '平滑' }));
    assert.deepEqual(
      (await visibleHandles(page)).map((handle) => handle.type),
      ['table'],
    );
    await hover(page, paragraph(page, '只有一段的提示框'));
    assert.deepEqual(
      (await visibleHandles(page)).map((handle) => handle.type),
      ['directive_callout'],
    );
  });

  test('指针沿水平方向移向手柄时手柄不跳动', async () => {
    for (const text of ['第二段正文', '提示框的第一段', '加宽块的第二段']) {
      const start = await hover(page, paragraph(page, text), 0.3, 0.5);
      const handles = await visibleHandles(page);
      const target = Math.min(...handles.map((handle) => handle.left)) + 4;
      for (let step = 1; step <= 20; step++) {
        await page.mouse.move(start.x - ((start.x - target) * step) / 20, start.y);
        await frames(page);
        assert.deepEqual(await visibleHandles(page), handles, `${text}：第 ${step} 步`);
      }
    }
  });
});

describe('拖动', () => {
  before(async () => {
    videoName = 'drag';
    ({ page, errors } = await openEditor(site, '/blocks/', { viewport, recordVideo: { dir: site.output, size: { width: 720, height: 1100 } } }));
  });

  after(closePage);

  test('段落移到另一个段落之后，diff 只是两段交换', async () => {
    await check(
      'drag-paragraph',
      async () => {
        const line = await dragStep('drag-paragraph', { locator: paragraph(page, '第一段正文') }, 'paragraph', { locator: paragraph(page, '第二段正文'), fy: 0.8 });
        assert.equal(line.direction, 'horizontal');
        const first = await paragraph(page, '第二段正文').boundingBox();
        const third = await paragraph(page, '第三段正文').boundingBox();
        assert.ok(line.top > first.y + first.height && line.bottom < third.y, '放置线在第二段与第三段之间');
      },
      { removed: ['第一段正文。', '', '第二段正文。'], added: ['第二段正文。', '', '第一段正文。'] },
    );
  });

  test('带副标题的标题与副标题一起移动', async () => {
    const heading = '## 带副标题的标题\n\n::subtitle[副标题跟随标题]\n\n';
    await check(
      'drag-heading',
      () => dragStep('drag-heading', { locator: page.locator('.milkdown .editor h2', { hasText: '带副标题的标题' }) }, 'heading', { locator: paragraph(page, '第一段正文'), fy: 0.2 }),
      (before) => before.replace(heading, '').replace('第一段正文。', `${heading}第一段正文。`),
    );
  });

  test('段落拖进提示框', async () => {
    await check(
      'drag-into-callout',
      () => dragStep('drag-into-callout', { locator: paragraph(page, '第三段正文') }, 'paragraph', { locator: paragraph(page, '提示框的第一段'), fy: 0.8 }),
      (before) => before.replace('第三段正文。\n\n', '').replace('提示框的第一段。\n', '提示框的第一段。\n\n第三段正文。\n'),
    );
  });

  test('段落拖出提示框', async () => {
    await check(
      'drag-out-of-callout',
      () => dragStep('drag-out-of-callout', { locator: paragraph(page, '提示框的第二段') }, 'paragraph', { locator: paragraph(page, '最后一段正文'), fy: 0.8 }),
      (before) => before.replace('\n\n提示框的第二段。', '').replace('最后一段正文。\n', '最后一段正文。\n\n提示框的第二段。\n'),
    );
  });

  test('第一张卡片拖到最后，放置线是竖线', async () => {
    const first = ':::card{title=甲}\n第一张卡片。\n:::\n\n';
    await check(
      'drag-card',
      async () => {
        const line = await dragStep('drag-card', { locator: card(page, '甲'), fx: 0.5, fy: 0.7 }, 'directive_card', { locator: card(page, '丙'), fx: 0.8, fy: 0.5 });
        assert.equal(line.direction, 'vertical');
        const third = await card(page, '丙').boundingBox();
        assert.ok(line.left >= third.x + third.width - 1, '竖线在第三张卡片右侧');
        assert.ok(Math.abs(line.height - third.height) <= 1, '竖线高度等于卡片高度');
      },
      (before) => before.replace(first, '').replace('第三张卡片。\n:::\n', `第三张卡片。\n:::\n\n${first.trimEnd()}\n`),
    );
  });

  test('段落拖到两张卡片之间时放置线在卡片网格之外，放下后段落在卡片网格之外', async () => {
    await check(
      'drag-between-cards',
      async () => {
        const line = await dragStep('drag-between-cards', { locator: paragraph(page, '第一段正文') }, 'paragraph', async () => {
          const left = await card(page, '甲').boundingBox();
          const right = await card(page, '乙').boundingBox();
          return { x: (left.x + left.width + right.x) / 2, y: left.y + left.height * 0.6 };
        });
        const grid = await page.locator('.milkdown .editor .bento').boundingBox();
        assert.equal(line.direction, 'horizontal');
        assert.ok(line.top >= grid.y + grid.height, '放置线在卡片网格之下');
      },
      (before) => before.replace('第一段正文。\n\n', '').replace('- 无序列表第一项', '第一段正文。\n\n- 无序列表第一项'),
    );
  });

  test('卡片拖到正文段落旁时没有放置线，放下后文件不变', async () => {
    await unchanged('drag-card-to-body', async () => {
      const line = await dragStep('drag-card-to-body', { locator: card(page, '乙'), fx: 0.5, fy: 0.7 }, 'directive_card', { locator: paragraph(page, '第二段正文'), fy: 0.8 });
      assert.equal(line, null);
    });
  });

  test('在列表内交换列表项', async () => {
    await check('drag-list-item', () => dragStep('drag-list-item', { locator: paragraph(page, '无序列表第一项') }, 'list_item', { locator: paragraph(page, '无序列表第二项'), fy: 0.8 }), {
      removed: ['- 无序列表第一项', '- 无序列表第二项'],
      added: ['- 无序列表第二项', '- 无序列表第一项'],
    });
  });

  test('拖动整个加宽块', async () => {
    const wide = ':::wide\n加宽块的第一段。\n\n加宽块的第二段。\n:::\n\n';
    await check(
      'drag-wide',
      () => dragStep('drag-wide', { locator: paragraph(page, '加宽块的第一段') }, 'directive_wide', { locator: paragraph(page, '第一段正文'), fy: 0.2 }),
      (before) => before.replace(wide, '').replace('第一段正文。', `${wide}第一段正文。`),
    );
  });

  test('旁注：第一条旁注所在的段落拖到第二条之后，注释名不变，注释紧跟各自的段落', async () => {
    const first = '第一条旁注所在的段落[^first]。\n\n[^first]: 第一条旁注的内容。\n\n';
    await check(
      'drag-sidenote',
      () => dragStep('drag-sidenote', { locator: paragraph(page, '第一条旁注所在的段落') }, 'paragraph', { locator: paragraph(page, '第二条旁注所在的段落'), fy: 0.8 }),
      (before) => before.replace(first, '').replace('[^second]: 第二条旁注的内容。\n', `[^second]: 第二条旁注的内容。\n\n${first.trimEnd()}\n`),
    );
  });
});

describe('拖到窗口底部', () => {
  before(async () => {
    videoName = 'drag-scroll';
    ({ page, errors } = await openEditor(site, '/blocks/', { viewport: { width: 1440, height: 600 }, recordVideo: { dir: site.output, size: { width: 720, height: 300 } } }));
  });

  after(closePage);

  test('拖到窗口底部时页面滚动', async () => {
    const before = site.read(path);
    const bottom = () => page.evaluate(() => scrollY >= document.documentElement.scrollHeight - innerHeight - 1);
    await grab(page, paragraph(page, '第一段正文'), 'paragraph');
    await page.mouse.down();
    await page.mouse.move(700, 560, { steps: 8 });
    for (let step = 0; step < 200 && !(await bottom()); step++) {
      await page.mouse.move(700 + (step % 2), 596);
      await page.waitForTimeout(50);
    }
    assert.ok(await bottom(), '页面滚动到底部');
    await page.screenshot({ path: join(site.output, 'drag-scroll-dragging.png') });
    await dragTo(page, await pointIn(paragraph(page, '最后一段正文'), 0.1, 0.8));
    const changes = await saveAfter(site, page, path, () => page.mouse.up());
    await settled();
    recordDiff('drag-scroll', changes);
    assert.equal(site.read(path), before.replace('第一段正文。\n\n', '').replace('最后一段正文。\n', '最后一段正文。\n\n第一段正文。\n'));
    assertValid(site.read(path));
    await undo('drag-scroll', before);
  });
});

describe('块菜单', () => {
  before(async () => {
    ({ page, errors } = await openEditor(site, '/blocks/', { viewport }));
  });

  after(closePage);

  test('删除带旁注的段落，注释一起删除', async () => {
    await check(
      'menu-delete',
      async () => {
        await openMenu(page, paragraph(page, '第一条旁注所在的段落'), 'paragraph');
        assert.deepEqual(
          (await menuItems(page)).map((item) => item.label),
          ['删除', '复制一份', '上移', '下移'],
        );
        await page.screenshot({ path: join(site.output, 'menu-open.png') });
        await clickMenu(page, '删除');
      },
      (before) => before.replace('第一条旁注所在的段落[^first]。\n\n[^first]: 第一条旁注的内容。\n\n', ''),
    );
  });

  test('复制带显式 id 的标题，副本没有 {#id}', async () => {
    await check(
      'menu-copy-heading',
      async () => {
        await openMenu(page, page.locator('.milkdown .editor h2', { hasText: '带显式 id 的标题' }), 'heading');
        await clickMenu(page, '复制一份');
      },
      (before) => before.replace('## 带显式 id 的标题 {#fixed-id}\n', '## 带显式 id 的标题 {#fixed-id}\n\n## 带显式 id 的标题\n'),
    );
  });

  test('复制带旁注的段落，副本使用 [^n1] 并有对应注释', async () => {
    await check(
      'menu-copy-sidenote',
      async () => {
        await openMenu(page, paragraph(page, '第二条旁注所在的段落'), 'paragraph');
        await clickMenu(page, '复制一份');
      },
      (before) => before.replace('[^second]: 第二条旁注的内容。\n', '[^second]: 第二条旁注的内容。\n\n第二条旁注所在的段落[^n1]。\n\n[^n1]: 第二条旁注的内容。\n'),
    );
  });

  test('复制带块 id 的段落，副本没有块 id', async () => {
    await check(
      'menu-copy-block-id',
      async () => {
        await openMenu(page, paragraph(page, '带块 id 的段落'), 'paragraph');
        await clickMenu(page, '复制一份');
      },
      (before) => before.replace('带块 id 的段落。 ^moved-block\n', '带块 id 的段落。 ^moved-block\n\n带块 id 的段落。\n'),
    );
  });

  test('复制带 \\label 的公式，副本没有 \\label', async () => {
    await check(
      'menu-copy-formula',
      async () => {
        await openMenu(page, page.locator('.milkdown .editor .math.display'), 'math_block');
        await clickMenu(page, '复制一份');
      },
      (before) => before.replace('y = \\max(0, x)\n$$\n', () => 'y = \\max(0, x)\n$$\n\n$$\ny = \\max(0, x)\n$$\n'),
    );
  });

  test('上移和下移', async () => {
    await check(
      'menu-up',
      async () => {
        await openMenu(page, paragraph(page, '第二段正文'), 'paragraph');
        await clickMenu(page, '上移');
      },
      { removed: ['第一段正文。', '', '第二段正文。'], added: ['第二段正文。', '', '第一段正文。'] },
    );
    await check(
      'menu-down',
      async () => {
        await openMenu(page, paragraph(page, '第二段正文'), 'paragraph');
        await clickMenu(page, '下移');
      },
      { removed: ['第二段正文。', '', '第三段正文。'], added: ['第三段正文。', '', '第二段正文。'] },
    );
  });

  test('卡片网格的第一张卡片「上移」置灰，Esc 关闭菜单', async () => {
    await openMenu(page, card(page, '甲'), 'directive_card');
    assert.deepEqual(await menuItems(page), [
      { label: '删除', disabled: false },
      { label: '复制一份', disabled: false },
      { label: '上移', disabled: true },
      { label: '下移', disabled: false },
    ]);
    await page.screenshot({ path: join(site.output, 'menu-card.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.bake-block-menu'), null);
  });
});

describe('键盘', () => {
  before(async () => {
    ({ page, errors } = await openEditor(site, '/blocks/', { viewport }));
  });

  after(closePage);

  test('Mod-Shift-↓ 连按两次，段落下移两个位置，光标仍在原来的字符处；需要两次 Mod-Z 撤销', async () => {
    const before = site.read(path);
    await placeCursor(page, '第一段');
    const changes = await saveAfter(site, page, path, async () => {
      await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
      await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
    });
    await settled();
    await site.screenshot(page, 'keyboard-down');
    recordDiff('keyboard-down', changes);
    assert.equal(site.read(path), before.replace('第一段正文。\n\n第二段正文。\n\n第三段正文。', '第二段正文。\n\n第三段正文。\n\n第一段正文。'));
    assert.deepEqual(await selectionState(), { text: '第一段正文。', offset: 3 });
    await undo('keyboard-down-first', before.replace('第一段正文。\n\n第二段正文。', '第二段正文。\n\n第一段正文。'));
    await undo('keyboard-down-second', before);
  });

  test('提示框第一个段落 Mod-Shift-↑ 移到提示框之前', async () => {
    await check(
      'keyboard-out-of-callout',
      async () => {
        await placeCursor(page, '提示框的第一段');
        await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
      },
      (before) => before.replace(':::callout{kind=note}\n提示框的第一段。\n\n', '提示框的第一段。\n\n:::callout{kind=note}\n'),
    );
  });

  test('文档第一个块 Mod-Shift-↑ 不变', async () => {
    await unchanged('keyboard-first-block', async () => {
      await placeCursor(page, '这一页用来测试');
      await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
      await placeCursor(page, '第一段正文');
      await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
    });
  });

  test('列表项在列表内移动', async () => {
    await check(
      'keyboard-list-item',
      async () => {
        await placeCursor(page, '有序列表第一项');
        await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
      },
      { removed: ['1. 有序列表第一项', '2. 有序列表第二项'], added: ['1. 有序列表第二项', '2. 有序列表第一项'] },
    );
  });

  test('全部操作撤销后文件与原文逐字节相同', () => {
    assert.equal(site.read(path), original);
  });
});
