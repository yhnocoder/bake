import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openEditor } from '../editor/setup.js';

export const fixtures = join(import.meta.dirname, '..', 'fixtures', 'clipboard');
export const emptyArticle = { path: 'content/empty.md', url: '/empty/', frontmatter: '---\ntitle: 空白\nslug: empty\n---\n' };

export function samples() {
  return readdirSync(fixtures)
    .filter((name) => name.endsWith('.expected.md'))
    .map((name) => name.slice(0, -'.expected.md'.length))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8')), expected: readFileSync(join(fixtures, `${name}.expected.md`), 'utf8') }));
}

export function articleBody(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
}

export async function openEmptyArticle(site, body = '') {
  site.write(emptyArticle.path, `${emptyArticle.frontmatter}${body}`);
  const opened = await openEditor(site, emptyArticle.url);
  await opened.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin });
  return opened;
}

export function dispatchClipboard(page, { types = {}, files = [] }, { dropOn } = {}) {
  return page.evaluate(
    ({ types, files, dropOn }) => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(types)) data.setData(type, value);
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
        data.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const editor = document.querySelector('.milkdown .editor');
      if (dropOn === undefined) {
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return;
      }
      const target = [...editor.querySelectorAll('p')].find((paragraph) => paragraph.textContent.includes(dropOn));
      const box = target.getBoundingClientRect();
      editor.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 1, clientY: box.top + box.height / 2 }));
    },
    { types, files, dropOn },
  );
}

export async function focusEditor(page) {
  await page.evaluate(() => document.querySelector('.milkdown .editor').focus());
  await page.waitForTimeout(50);
}

export async function selectBetween(page, startText, endText, { afterStart = false } = {}) {
  await page.evaluate(
    ({ startText, endText, afterStart }) => {
      const editor = document.querySelector('.milkdown .editor');
      const find = (text) => {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const index = walker.currentNode.data.indexOf(text);
          if (index !== -1) return [walker.currentNode, index];
        }
        throw new Error(`Text not found: ${text}`);
      };
      const [startNode, startIndex] = find(startText);
      const [endNode, endIndex] = find(endText);
      editor.focus();
      const range = document.createRange();
      range.setStart(startNode, afterStart ? startIndex + startText.length : startIndex);
      range.setEnd(endNode, endIndex + endText.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    { startText, endText, afterStart },
  );
  await page.waitForTimeout(50);
}

export async function waitForSave(page, action) {
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await action();
  await response;
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent === '已保存');
}

export async function statusMessage(page) {
  return page.evaluate(() => {
    const message = document.querySelector('.bake-status-message');
    return message.hidden ? '' : message.querySelector('span').textContent;
  });
}

export async function clipboardContent(page) {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const read = async (type) => (item.types.includes(type) ? (await item.getType(type)).text() : '');
    return { text: await read('text/plain'), html: await read('text/html') };
  });
}
