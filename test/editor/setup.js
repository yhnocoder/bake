import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDevServer } from '../../src/dev/index.js';
import { bakeRoot } from '../../src/dev/plugin.js';

const example = join(import.meta.dirname, '..', '..', 'examples', 'minimal');
const entry = `/@fs${join(bakeRoot, 'src/editor/index.js')}`;

export async function startSite(name) {
  const root = mkdtempSync(join(tmpdir(), 'bake-editor-'));
  cpSync(example, root, { recursive: true });
  const server = await createDevServer({ root, port: 0 });
  const browser = await chromium.launch();
  const output = join(process.env.BAKE_TEST_OUTPUT ?? join(tmpdir(), 'bake-editor-screenshots'), name);
  mkdirSync(output, { recursive: true });
  const origin = `http://localhost:${server.httpServer.address().port}`;
  return {
    root,
    origin,
    read: (path) => readFileSync(join(root, path), 'utf8'),
    write: (path, text) => writeFileSync(join(root, path), text),
    async addPage(path, text, url) {
      writeFileSync(join(root, path), text);
      while ((await fetch(origin + url)).status === 404) await setTimeout(50);
    },
    record: (file, text) => writeFileSync(join(output, file), text),
    screenshot: (page, file) => page.screenshot({ path: join(output, `${file}.png`), fullPage: true, caret: 'initial' }),
    async close() {
      await browser.close();
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
    browser,
  };
}

export async function gotoPage(page, url) {
  while ((await page.goto(url)).status() === 404) await page.waitForTimeout(50);
}

export async function openEditor(site, url) {
  const page = await site.browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const saves = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/__bake/save')) saves.push(JSON.parse(request.postData()));
  });
  await gotoPage(page, site.origin + url);
  await page.click('.bake-edit-toggle');
  await page.waitForFunction(() => document.querySelector('.bake-save-state').textContent !== '');
  return { page, errors, saves };
}

export function session(page, action, argument) {
  return page.evaluate(
    async ({ entry, action, argument }) => {
      const current = (await import(entry)).currentSession();
      return new Function('session', 'argument', `return (${action})(session, argument);`)(current, argument);
    },
    { entry, action: action.toString(), argument },
  );
}

export function exportMarkdown(page) {
  return session(page, (current) => current.markdown());
}

export async function placeCursor(page, text, { select = false } = {}) {
  await page.evaluate(
    async ({ text, select }) => {
      const editor = document.querySelector('.milkdown .editor');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const index = walker.currentNode.data.indexOf(text);
        if (index === -1) continue;
        editor.focus();
        const range = document.createRange();
        range.setStart(walker.currentNode, select ? index : index + text.length);
        range.setEnd(walker.currentNode, index + text.length);
        const changed = new Promise((resolve) => document.addEventListener('selectionchange', resolve, { once: true }));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        await changed;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return;
      }
      throw new Error(`Text not found: ${text}`);
    },
    { text, select },
  );
}

export async function saveAfter(site, page, path, action) {
  const before = site.read(path);
  const response = page.waitForResponse((response) => response.url().endsWith('/__bake/save'));
  await action();
  await response;
  return changedLines(before, site.read(path));
}

export function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}
