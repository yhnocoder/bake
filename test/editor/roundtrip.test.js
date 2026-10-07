import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { exportMarkdown, openEditor, placeCursor, saveAfter, startSite } from './setup.js';

const pages = readdirSync(join(import.meta.dirname, '..', '..', 'examples', 'minimal', 'content'), { recursive: true }).filter((name) => name.endsWith('.md')).sort();
let site;

before(async () => {
  site = await startSite('roundtrip');
});

after(async () => {
  await site.close();
});

for (const name of pages) {
  test(`${name} 打开编辑器后不修改，导出的 Markdown 与文件逐字节相同，不触发保存`, async () => {
    const path = `content/${name}`;
    const slug = /^slug: (.+)$/m.exec(site.read(path))[1];
    const { page, errors, saves } = await openEditor(site, slug === '/' ? '/' : `/${slug}/`);
    assert.equal(await page.textContent('.bake-save-state'), '已保存');
    await site.screenshot(page, name.replace('.md', '').replaceAll('/', '-'));
    assert.equal(await exportMarkdown(page), site.read(path));
    await page.waitForTimeout(1200);
    assert.deepEqual(saves, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

const referencePage = `---
title: 引用式链接
slug: references-page
---

参考 [MDN 文档][mdn]、[简写] 和 [折叠][]，图片 ![函数图像][relu]。

[mdn]: https://developer.mozilla.org "MDN Web Docs"

[简写]: https://example.com/short

[折叠]: https://example.com/collapsed

[relu]: ./assets/relu.png
`;

test('引用式链接、引用式图片和链接定义原样保存，修改链接文字只改变对应的行', async () => {
  site.write('content/references.md', referencePage);
  const { page, errors } = await openEditor(site, '/references-page/');
  assert.equal(await page.textContent('.bake-save-state'), '已保存');
  assert.equal(await exportMarkdown(page), referencePage);
  assert.match(await page.getAttribute('.milkdown img[alt="函数图像"]', 'src'), /relu\.png$/);
  await page.evaluate(() => document.querySelector('.milkdown img[alt="函数图像"]').decode());
  await site.screenshot(page, 'references');
  const changes = await saveAfter(site, page, 'content/references.md', async () => {
    await placeCursor(page, 'MDN');
    await page.keyboard.type('网站');
  });
  assert.deepEqual(changes, {
    removed: ['参考 [MDN 文档][mdn]、[简写] 和 [折叠][]，图片 ![函数图像][relu]。'],
    added: ['参考 [MDN网站 文档][mdn]、[简写] 和 [折叠][]，图片 ![函数图像][relu]。'],
  });
  assert.deepEqual(errors, []);
  await page.close();
});
