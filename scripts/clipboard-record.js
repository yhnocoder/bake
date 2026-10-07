#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url, startSelector, endSelector, name] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node scripts/clipboard-record.js <url> <start-selector> <end-selector> <name>');
  process.exit(2);
}

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector(startSelector, { state: 'attached', timeout: 60000 });
  await page.waitForSelector(endSelector, { state: 'attached', timeout: 60000 });
  await page.evaluate(({ startSelector, endSelector }) => {
    const textNodes = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, (node) => (node.data.trim() === '' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT));
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      return nodes;
    };
    const first = textNodes(document.querySelector(startSelector))[0];
    const last = textNodes(document.querySelector(endSelector)).at(-1);
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.data.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, { startSelector, endSelector });
  await page.keyboard.press('Control+c');
  await page.evaluate(() => {
    const target = document.createElement('div');
    target.id = 'bake-clipboard-target';
    target.contentEditable = 'true';
    target.style.cssText = 'position: fixed; top: 0; left: 0; width: 10px; height: 10px;';
    window.bakeClipboard = new Promise((resolve) => {
      target.addEventListener('paste', async (event) => {
        event.preventDefault();
        const data = event.clipboardData;
        const types = {};
        for (const type of data.types) if (type !== 'Files') types[type] = data.getData(type);
        const files = [];
        for (const file of data.files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          files.push({ name: file.name, type: file.type, base64: btoa(binary) });
        }
        resolve({ types, files });
      });
    });
    document.body.append(target);
    target.focus();
  });
  await page.keyboard.press('Control+v');
  const { types, files } = await page.evaluate(() => window.bakeClipboard);
  const source = `Chromium ${browser.version()}, Linux, Playwright 中打开 ${url}，选中 ${startSelector} 到 ${endSelector} 后 Ctrl+C`;
  const directory = join(import.meta.dirname, '..', 'test', 'fixtures', 'clipboard');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${name}.json`);
  writeFileSync(file, `${JSON.stringify({ source, types, files }, null, 2)}\n`);
  console.log(`Saved ${file}: ${Object.keys(types).join(', ')}`);
} finally {
  await browser.close();
}
