export const codePage = `---
title: 代码块
slug: code
---

Python：

\`\`\`python
def gradient(loss, params):
    # 反向传播
    return [p.grad for p in params]
\`\`\`

JavaScript：

\`\`\`javascript
const total = items.reduce((sum, item) => sum + item.price, 0);
console.log(\`total: \${total}\`);
\`\`\`

Bash：

\`\`\`bash
npm install && bake build
\`\`\`

JSON：

\`\`\`json
{ "name": "bake", "private": true }
\`\`\`

Markdown：

\`\`\`markdown
# 标题

*斜体* 与 **粗体**
\`\`\`

没有语言名：

\`\`\`
plain code
\`\`\`

text：

\`\`\`text
text code
\`\`\`

拼错的语言名：

\`\`\`pyhton
print("typo")
\`\`\`

:::callout{kind=note}
提示框中的代码：

\`\`\`python
print("in callout")
\`\`\`
:::
`;

export const plainPage = `---
title: 纯文本代码块
slug: plain-code
---

\`\`\`text
text code
\`\`\`

\`\`\`pyhton
print("typo")
\`\`\`
`;

export const expectedLanguageFiles = ['javascript', 'json', 'markdown', 'python', 'shellscript'];

export function styledSpans(selector) {
  const probe = document.createElement('span');
  return [...document.querySelectorAll(selector)].map((code) =>
    [...code.querySelectorAll('span[style]')].map((span) => {
      probe.setAttribute('style', span.getAttribute('style'));
      return [span.textContent, probe.style.cssText];
    }),
  );
}

export function languageFile(url, languageIds) {
  const match = new URL(url).pathname.match(/\/deps\/([\w.-]+?)-[\w-]{8}\.js$/);
  return match && match[1] !== 'wasm' && languageIds.has(match[1]) ? match[1] : null;
}

export function isWasm(url) {
  return /\/deps\/wasm-[\w-]{8}\.js$/.test(new URL(url).pathname);
}
