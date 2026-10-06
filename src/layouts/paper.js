import { articleTag, escapeHtml, tocList } from './html.js';

export const fields = {
  authors: { label: '作者', type: 'list' },
  abstract: { label: '摘要', type: 'string' },
  toc: { label: '目录', type: 'boolean', default: false },
  numbered: { label: '标题编号', type: 'boolean', default: true },
};

export default function paper({ page, html, toc }) {
  const names = (page.authors ?? []).map((author) => `<span>${escapeHtml(author)}</span>`).join('');
  const authors = names === '' ? '' : `<p class="authors">${names}</p>`;
  const abstract = page.abstract === undefined ? '' : `<p class="abstract">${escapeHtml(page.abstract)}</p>`;
  const nav = page.toc && toc.length > 0 ? `<nav class="toc">${tocList(toc)}</nav>\n` : '';
  return `<main class="layout-paper">
<header class="mast"><h1>${escapeHtml(page.title)}</h1>${authors}${abstract}</header>
${nav}${articleTag(page)}${html}</article>
</main>`;
}
