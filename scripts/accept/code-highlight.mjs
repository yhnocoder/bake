import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { formatMessage } from '../../src/format/index.js';
import { loadSite, renderPage } from '../../src/site/index.js';

const [scenario, output] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../..');
const blog = mkdtempSync(join(tmpdir(), 'bake-code-'));
cpSync(join(root, 'examples/minimal'), blog, { recursive: true });

const article = `---
title: 代码高亮
slug: code
layout: essay
---

Python：

\`\`\`python
def mean(values: list[float]) -> float:
    # 空列表返回 0
    return sum(values) / len(values) if values else 0.0
\`\`\`

JavaScript：

\`\`\`js
export function clamp(x, low = 0, high = 1) {
  return Math.min(high, Math.max(low, x)); // a < b && c
}
\`\`\`

Bash：

\`\`\`bash
for file in content/*.md; do
  echo "$file" | grep -q draft && continue
done
\`\`\`

JSON：

\`\`\`json
{ "title": "代码高亮", "draft": false, "tags": ["示例", 3] }
\`\`\`

没有语言名：

\`\`\`
plain <text> & more
\`\`\`
`;

async function renderArticle(path, source) {
  writeFileSync(join(blog, path), source);
  const site = await loadSite(blog);
  const styles = ['base', 'blocks', 'layouts'].map((name) => pathToFileURL(join(root, `src/styles/${name}.css`)).href);
  const assets = { styles: [...styles, pathToFileURL(join(blog, 'themes/default.css')).href], scripts: [] };
  return renderPage(site, path, { assets });
}

async function screenshot(withoutCodeVariables) {
  const theme = join(blog, 'themes/default.css');
  if (withoutCodeVariables) writeFileSync(theme, readFileSync(theme, 'utf8').replace(/^\s*--code-[\w-]+:.*\n/gm, ''));
  const { html, messages } = await renderArticle('content/code.md', article);
  if (messages.length > 0) throw new Error(messages.map(formatMessage).join('\n'));
  mkdirSync(output, { recursive: true });
  const page = join(output, 'code.html');
  writeFileSync(page, html);
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' });
  await tab.screenshot({ path: join(output, 'code.png'), fullPage: true });
  const colors = await tab.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const keyword = [...document.querySelectorAll('code.language-python span[style]')].find((span) => span.textContent === 'def');
    return {
      themeKeyword: style.getPropertyValue('--code-token-keyword').trim(),
      themeAccent: style.getPropertyValue('--color-accent').trim(),
      keywordColor: getComputedStyle(keyword).color,
      highlightedBlocks: [...document.querySelectorAll('pre code')].filter((code) => code.querySelector('span.line')).length,
      plainBlock: document.querySelector('pre code:not([class])').textContent,
    };
  });
  await browser.close();
  console.log(JSON.stringify(colors, null, 2));
  const hex = withoutCodeVariables ? colors.themeAccent : colors.themeKeyword;
  const expected = `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
  console.log(`keyword "def" color ${colors.keywordColor}, expected ${expected} from ${withoutCodeVariables ? '--color-accent' : '--code-token-keyword'}`);
  if (colors.keywordColor !== expected || colors.highlightedBlocks !== 4) process.exitCode = 1;
}

async function unknownLanguage() {
  const source = '---\ntitle: 拼写错误\nslug: typo\nlayout: essay\n---\n\n段落\n\n```pyhton\nprint(1)\n```\n';
  const { messages } = await renderArticle('content/typo.md', source);
  for (const message of messages) console.log(formatMessage(message));
  process.exitCode = messages.length > 0 ? 1 : 0;
}

try {
  if (scenario === 'full') await screenshot(false);
  else if (scenario === 'fallback') await screenshot(true);
  else if (scenario === 'unknown') await unknownLanguage();
  else throw new Error(`Unknown scenario ${scenario}`);
} finally {
  rmSync(blog, { recursive: true, force: true });
}
