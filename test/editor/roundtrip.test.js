import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { exportMarkdown, openEditor, startSite } from './setup.js';

const pages = readdirSync(join(import.meta.dirname, '..', '..', 'examples', 'minimal', 'content')).filter((name) => name.endsWith('.md'));
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
    await site.screenshot(page, name.replace('.md', ''));
    assert.equal(await exportMarkdown(page), site.read(path));
    await page.waitForTimeout(1200);
    assert.deepEqual(saves, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
}
