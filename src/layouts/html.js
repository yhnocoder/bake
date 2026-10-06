const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => entities[character]);
}

export function tocList(toc) {
  const items = toc.map(({ id, text, depth }) => `<li class="toc-h${depth}"><a href="#${escapeHtml(id)}">${escapeHtml(text)}</a></li>`);
  return `<ol>${items.join('')}</ol>`;
}

export function articleTag(page) {
  return page.numbered ? '<article class="numbered">' : '<article>';
}
