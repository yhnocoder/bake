import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startSite } from '../editor/setup.js';
import { articleBody, dispatchClipboard, emptyArticle, focusEditor, openEmptyArticle, samples, waitForSave } from './setup.js';

let site;

before(async () => {
  site = await startSite('copy-paste-samples');
});

after(async () => {
  await site.close();
});

for (const sample of samples()) {
  test(`样本 ${sample.name}`, async () => {
    const { page, errors } = await openEmptyArticle(site);
    await focusEditor(page);
    await waitForSave(page, () => dispatchClipboard(page, sample));
    await site.screenshot(page, `sample-${sample.name}`);
    const body = articleBody(site.read(emptyArticle.path));
    site.record(`sample-${sample.name}.md`, body);
    assert.equal(body, sample.expected);
    assert.deepEqual(errors, []);
    await page.close();
  });
}
