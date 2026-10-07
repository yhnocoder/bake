import { articleTag, escapeHtml, tocList } from './html.js';

export const fields = {
  eyebrow: { label: '眉题', type: 'string' },
  toc: { label: '目录', type: 'boolean', default: true },
  numbered: { label: '标题编号', type: 'boolean', default: false },
};

export default function essay({ page, html, toc }) {
  const eyebrow = page.eyebrow === undefined ? '' : `<p class="eyebrow">${escapeHtml(page.eyebrow)}</p>`;
  const nav = page.toc && toc.length > 0 ? `<nav class="toc"><details><summary>目录</summary>${tocList(toc)}</details></nav>\n` : '';
  return `<main class="layout-essay">
<header class="mast">${eyebrow}<h1>${escapeHtml(page.title)}</h1></header>
${nav}${articleTag(page)}${html}</article>
</main>`;
}
