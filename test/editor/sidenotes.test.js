import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { format, parse } from '../../src/format/index.js';
import { exportMarkdown, openEditor, placeCursor, saveAfter, startSite } from './setup.js';

const path = 'content/features.md';
const cli = join(import.meta.dirname, '..', '..', 'src', 'cli.js');
let site;
let page;
let errors;
let readMode;

function sidenoteLayout() {
  const editor = document.querySelector('.milkdown .editor') ?? document.querySelector('article');
  return [...document.querySelectorAll('article .sidenote')].map((note) => {
    let anchor = note.previousElementSibling;
    if (note.classList.contains('unnumbered')) {
      while (anchor?.classList.contains('sidenote')) anchor = anchor.previousElementSibling;
    } else anchor = document.getElementById(`sn-ref-${note.id.slice('sn-'.length)}`);
    const box = note.getBoundingClientRect();
    return {
      id: note.id,
      number: note.querySelector('.sidenote-number')?.textContent ?? '',
      text: note.querySelector('.sidenote-body').textContent,
      unnumbered: note.classList.contains('unnumbered'),
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      bodyRight: editor.getBoundingClientRect().right,
      anchorTop: anchor?.getBoundingClientRect().top ?? null,
    };
  });
}

function references() {
  return [...document.querySelectorAll('article .sidenote-ref')].map((reference) => ({ id: reference.id, text: reference.textContent, href: reference.querySelector('a').getAttribute('href') }));
}

async function layout() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(sidenoteLayout);
}

function assertAligned(notes) {
  let bottom = -Infinity;
  for (const note of notes) {
    assert.ok(note.left > note.bodyRight, `${note.text} 在右侧栏`);
    const expected = Math.max(note.anchorTop, bottom + 12);
    assert.ok(Math.abs(note.top - expected) <= 1, `${note.text} 的顶部 ${note.top} 应为 ${expected}`);
    bottom = note.bottom;
  }
}

async function cursorAt(text, edge) {
  await page.evaluate(
    ({ text, edge }) => {
      const editor = document.querySelector('.milkdown .editor');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(text);
        if (index === -1) continue;
        const block = walker.currentNode.parentElement.closest('p');
        editor.focus();
        const range = document.createRange();
        if (edge === 'start') range.setStart(walker.currentNode, index);
        else range.setStart(block, block.childNodes.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return;
      }
      throw new Error(`Text not found: ${text}`);
    },
    { text, edge },
  );
  await page.waitForTimeout(50);
}

async function selectParagraph(text) {
  await page.evaluate((text) => {
    const editor = document.querySelector('.milkdown .editor');
    const paragraph = [...editor.querySelectorAll('p')].find((element) => element.textContent.includes(text));
    editor.focus();
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(paragraph, paragraph.childNodes.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, text);
  await page.waitForTimeout(50);
}

async function clipboard(kind) {
  await page.evaluate((kind) => {
    if (kind !== 'paste') window.bakeTestClipboard = new DataTransfer();
    document.querySelector('.milkdown .editor').dispatchEvent(new ClipboardEvent(kind, { clipboardData: window.bakeTestClipboard, bubbles: true, cancelable: true }));
  }, kind);
  await page.waitForTimeout(50);
}

async function settled() {
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
  const deadline = Date.now() + 10000;
  while ((await exportMarkdown(page)) !== site.read(path)) {
    if (Date.now() > deadline) throw new Error('The editor did not save its document');
    await page.waitForTimeout(200);
  }
}

function assertFormatted(name, file) {
  assert.equal(format(file), file);
  assert.deepEqual(parse(file).messages.filter((message) => /footnote|sidenote/i.test(message.text)), []);
  const output = execFileSync(process.execPath, [cli, 'format', path], { cwd: site.root, encoding: 'utf8' });
  site.record(`${name}.format.txt`, `$ bake format ${path}\n${output}`);
  assert.equal(output, 'No files to rewrite\n');
}

async function check(name, action, expected) {
  const before = site.read(path);
  const changes = await saveAfter(site, page, path, action);
  await settled();
  await site.screenshot(page, name);
  const file = site.read(path);
  site.record(`${name}.diff`, [...changes.removed.map((line) => `- ${line}`), ...changes.added.map((line) => `+ ${line}`)].join('\n') + '\n');
  if (typeof expected === 'function') assert.equal(file, expected(before));
  else assert.deepEqual(changes, expected);
  assertFormatted(name, file);
}

async function unchanged(name, action) {
  const before = await exportMarkdown(page);
  await action();
  await page.waitForTimeout(1000);
  await site.screenshot(page, name);
  assert.equal(await exportMarkdown(page), before);
  assert.equal(site.read(path), before);
}

before(async () => {
  site = await startSite('sidenotes');
  const reader = await site.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await reader.goto(`${site.origin}/features/`);
  await reader.evaluate(() => document.fonts.ready);
  readMode = { notes: await reader.evaluate(sidenoteLayout), references: await reader.evaluate(references) };
  await reader.close();
  ({ page, errors } = await openEditor(site, '/features/'));
});

after(async () => {
  assert.deepEqual(errors, []);
  await site.close();
});

describe('旁注', () => {
  test('显示：每条旁注在右侧栏，编号与页面相同，与编号所在的行对齐', async () => {
    const notes = await layout();
    await site.screenshot(page, 'display');
    assert.deepEqual(notes.map(({ id, number, unnumbered }) => ({ id, number, unnumbered })), readMode.notes.map(({ id, number, unnumbered }) => ({ id, number, unnumbered })));
    assert.deepEqual(await page.evaluate(references), readMode.references);
    assert.equal(notes.filter((note) => note.unnumbered).length, 1);
    assertAligned(notes);
  });

  test('插入：Mod-Alt-F 在光标处插入编号，注释写在所在块之后，光标在注释里', async () => {
    await check('insert-shortcut', async () => {
      await placeCursor(page, '正文段落。');
      await page.keyboard.press('ControlOrMeta+Alt+f');
      await page.keyboard.type('新注释');
    }, { removed: ['正文段落。'], added: ['正文段落。[^n1]', '', '[^n1]: 新注释'] });
  });

  test('插入：输入 [^ 插入编号，文件已有 n1 时新名字为 n2', async () => {
    await check('insert-input-rule', async () => {
      await placeCursor(page, 'softmax 把任意实数向量变成概率分布。');
      await page.keyboard.type('[^');
      await page.keyboard.type('输入规则');
    }, { removed: ['softmax 把任意实数向量变成概率分布。'], added: ['softmax 把任意实数向量变成概率分布。[^n2]', '', '[^n2]: 输入规则'] });
  });

  test('位置：在提示框里的段落中插入旁注，注释写在提示框之后', async () => {
    await check('container', async () => {
      await placeCursor(page, '先看图再看公式。');
      await page.keyboard.press('ControlOrMeta+Alt+f');
      await page.keyboard.type('提示框里的旁注');
    }, (before) => before.replace('先看图再看公式。\n:::\n', '先看图再看公式。[^n3]\n:::\n\n[^n3]: 提示框里的旁注\n'));
    assertAligned(await layout());
  });

  test('编号与空注释：在已有旁注之前插入一条，后面的编号加 1；在空注释开头按 Backspace 删除编号和注释', async () => {
    const numbers = async () => Object.fromEntries((await layout()).filter((note) => !note.unnumbered).map((note) => [note.text, note.number]));
    const original = await numbers();
    const file = site.read(path);
    await check('number-insert', async () => {
      await placeCursor(page, '沿计算图逆向逐层计算梯度。');
      await page.keyboard.press('ControlOrMeta+Alt+f');
    }, { removed: ['反向传播从损失函数开始，沿计算图逆向逐层计算梯度。'], added: ['反向传播从损失函数开始，沿计算图逆向逐层计算梯度。[^n4]', '', '[^n4]:'] });
    const inserted = await numbers();
    const following = Object.entries(original).find(([text]) => text.startsWith('局部导数'))[1];
    assert.equal(inserted[''], following);
    for (const [text, number] of Object.entries(original)) {
      const shifted = Number(number) >= Number(following) ? Number(number) + 1 : Number(number);
      assert.equal(inserted[text], String(shifted), text);
    }
    assertAligned(await layout());
    await check('empty-backspace', () => page.keyboard.press('Backspace'), () => file);
    assert.deepEqual(await numbers(), original);
  });

  test('删除：Backspace 删除编号时注释一起删除，Mod-Z 一次后与原文件相同', async () => {
    const file = site.read(path);
    await check('delete', async () => {
      await cursorAt('正文段落。', 'end');
      await page.keyboard.press('Backspace');
    }, { removed: ['正文段落。[^n1]', '', '[^n1]: 新注释'], added: ['正文段落。'] });
    await check('delete-undo', () => page.keyboard.press('ControlOrMeta+z'), () => file);
  });

  test('输入：在注释里输入文字和第二个段落，注释变为两段并按四个空格缩进', async () => {
    await check('type', async () => {
      await placeCursor(page, '新注释');
      await page.keyboard.type('补充');
      await page.keyboard.press('Enter');
      await page.keyboard.type('第二段');
    }, { removed: ['[^n1]: 新注释'], added: ['[^n1]: 新注释补充', '', '    第二段'] });
  });

  test('按键：在引用所在段落末尾按 Enter 后输入，新段落写在注释之后', async () => {
    await check('key-enter', async () => {
      await cursorAt('正文段落。', 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('新段落');
    }, (before) => before.replace('    第二段\n', '    第二段\n\n新段落\n'));
  });

  test('按键：在注释之后的段落开头按 Backspace，与注释前面的段落合并，注释不变', async () => {
    await check('key-backspace-join', async () => {
      await cursorAt('新段落', 'start');
      await page.keyboard.press('Backspace');
    }, (before) => before.replace('正文段落。[^n1]\n', '正文段落。[^n1]新段落\n').replace('    第二段\n\n新段落\n', '    第二段\n'));
  });

  test('按键：在段落末尾按 Delete，注释后面的段落接上来，注释不变', async () => {
    await check('key-delete-join', async () => {
      await cursorAt('决定了梯度能否顺利传回前面的层。', 'end');
      await page.keyboard.press('Delete');
    }, (before) => before.replace('决定了梯度能否顺利传回前面的层。\n', '决定了梯度能否顺利传回前面的层。最后得到的是损失对每个参数的梯度。优化器用这些梯度更新参数，进入下一轮前向传播。\n').replace('[^act]: ReLU 在正半轴的导数是 1。\n\n最后得到的是损失对每个参数的梯度。优化器用这些梯度更新参数，进入下一轮前向传播。\n', '[^act]: ReLU 在正半轴的导数是 1。\n'));
  });

  test('按键：注释后面不以文本块开始时 Delete 不做任何事', async () => {
    await unchanged('key-delete-before-container', async () => {
      await cursorAt('正文段落。', 'end');
      await page.keyboard.press('Delete');
    });
  });

  test('按键：在非空注释开头按 Backspace、在注释末尾按 Delete，文档不变', async () => {
    await unchanged('key-definition-start', async () => {
      await cursorAt('新注释补充', 'start');
      await page.keyboard.press('Backspace');
    });
    await unchanged('key-definition-end', async () => {
      await cursorAt('第二段', 'end');
      await page.keyboard.press('Delete');
    });
  });

  test('光标在注释里时插入命令不可用', async () => {
    await unchanged('insert-in-definition', async () => {
      await cursorAt('新注释补充', 'end');
      await page.keyboard.press('ControlOrMeta+Alt+f');
    });
  });

  test('复制：剪切带编号的段落粘贴到另一处，注释跟随移动', async () => {
    await check('copy-source', async () => {
      await cursorAt('进入下一轮前向传播。', 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('复制用的段落');
      await page.keyboard.press('ControlOrMeta+Alt+f');
      await page.keyboard.type('复制用的注释');
    }, (before) => before.replace('[^act]: ReLU 在正半轴的导数是 1。\n', '[^act]: ReLU 在正半轴的导数是 1。\n\n复制用的段落[^n4]\n\n[^n4]: 复制用的注释\n'));
    await check('cut-paste', async () => {
      await selectParagraph('复制用的段落');
      await clipboard('cut');
      await page.keyboard.press('Backspace');
      await cursorAt('沿计算图逆向逐层计算梯度。', 'end');
      await page.keyboard.press('Enter');
      await clipboard('paste');
    }, (before) => before.replace('\n复制用的段落[^n4]\n\n[^n4]: 复制用的注释\n', '').replace('沿计算图逆向逐层计算梯度。\n', '沿计算图逆向逐层计算梯度。\n\n复制用的段落[^n4]\n\n[^n4]: 复制用的注释\n'));
  });

  test('复制：复制粘贴后第二份引用改为新名字，注释内容相同；粘贴到原段落之前时原段落的名字不变', async () => {
    await check('copy-paste', async () => {
      await selectParagraph('复制用的段落');
      await clipboard('copy');
      await cursorAt('进入下一轮前向传播。', 'end');
      await page.keyboard.press('Enter');
      await clipboard('paste');
    }, (before) => before.replace('[^act]: ReLU 在正半轴的导数是 1。\n', '[^act]: ReLU 在正半轴的导数是 1。\n\n复制用的段落[^n5]\n\n[^n5]: 复制用的注释\n'));
    await check('copy-paste-before', async () => {
      await cursorAt('沿计算图逆向逐层计算梯度。', 'end');
      await page.keyboard.press('Enter');
      await clipboard('paste');
    }, (before) => before.replace('沿计算图逆向逐层计算梯度。\n', '沿计算图逆向逐层计算梯度。\n\n复制用的段落[^n6]\n\n[^n6]: 复制用的注释\n'));
  });

  test('对齐写入：对齐后注释仍是同一个元素，style 中的位置保留', async () => {
    await page.evaluate(() => document.getElementById('sn-1').setAttribute('data-test-marker', 'same'));
    await check('align-write', async () => {
      await placeCursor(page, '提示框里的旁注');
      await page.keyboard.type('，再补充一行文字让注释变高，再补充一行文字让注释变高');
    }, (before) => before.replace('[^n3]: 提示框里的旁注\n', '[^n3]: 提示框里的旁注，再补充一行文字让注释变高，再补充一行文字让注释变高\n'));
    const note = await page.evaluate(() => {
      const element = document.getElementById('sn-1');
      return { marker: element.getAttribute('data-test-marker'), top: element.style.top };
    });
    assert.equal(note.marker, 'same');
    assert.match(note.top, /^-?\d+(\.\d+)?px$/);
    assertAligned(await layout());
  });

  test('悬停：鼠标移到带 :span 的注释上高亮被注释的文字，移到编号上对应注释有 active class', async () => {
    const note = page.locator('.milkdown aside.sidenote', { hasText: 'ReLU 在正半轴的导数是 1。' });
    await note.hover();
    await page.waitForTimeout(100);
    await site.screenshot(page, 'hover-note');
    assert.equal(await page.evaluate(() => [...CSS.highlights.get('sidenote')].map((range) => range.toString()).join('')), '激活函数的导数');
    const id = await note.getAttribute('id');
    await page.hover(`#sn-ref-${id.slice('sn-'.length)}`);
    await page.waitForTimeout(100);
    await site.screenshot(page, 'hover-reference');
    assert.equal(await note.evaluate((element) => element.classList.contains('active')), true);
    await page.mouse.move(0, 0);
  });
});

describe('文件中没有被引用的注释', () => {
  test('载入后显示在文末且没有编号，修改正文后保存，这条注释原样保留', async () => {
    const orphanPath = 'content/orphan.md';
    site.write(orphanPath, '---\ntitle: 没有被引用的注释\nslug: orphan\n---\n\n第一段[^a]。\n\n[^a]: 有引用的注释。\n\n[^x]: 没有被引用的注释。\n\n第二段。\n');
    let response;
    for (let attempt = 0; attempt < 50 && response?.status() !== 200; attempt++) {
      response = await page.request.get(`${site.origin}/orphan/`);
      if (response.status() !== 200) await page.waitForTimeout(100);
    }
    const orphan = await openEditor(site, '/orphan/');
    const notes = await orphan.page.evaluate(sidenoteLayout);
    assert.deepEqual(notes.map(({ text, number, unnumbered }) => ({ text, number, unnumbered })), [
      { text: '有引用的注释。', number: '1', unnumbered: false },
      { text: '没有被引用的注释。', number: '', unnumbered: true },
    ]);
    assert.equal(await orphan.page.evaluate(() => document.querySelector('.milkdown .editor').lastElementChild.textContent), '没有被引用的注释。');
    const changes = await saveAfter(site, orphan.page, orphanPath, async () => {
      await orphan.page.evaluate(() => {
        const paragraph = [...document.querySelectorAll('.milkdown p')].find((element) => element.textContent === '第二段。');
        document.querySelector('.milkdown .editor').focus();
        getSelection().collapse(paragraph.firstChild, paragraph.firstChild.length);
      });
      await orphan.page.waitForTimeout(50);
      await orphan.page.keyboard.type('补充');
    });
    await site.screenshot(orphan.page, 'orphan');
    assert.deepEqual(changes, { removed: ['[^x]: 没有被引用的注释。', '', '第二段。'], added: ['第二段。补充', '', '[^x]: 没有被引用的注释。'] });
    assert.equal(format(site.read(orphanPath)), site.read(orphanPath));
    assert.deepEqual(orphan.errors, []);
    await orphan.page.close();
  });
});
