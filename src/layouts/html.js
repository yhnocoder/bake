const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => entities[character]);
}

export function tocList(toc) {
  const items = toc.map(({ id, html, depth }) => `<li class="toc-h${depth}"><a href="#${escapeHtml(id)}">${html}</a></li>`);
  return `<ol>${items.join('')}</ol>`;
}

export function articleTag(page) {
  return page.numbered ? '<article class="numbered">' : '<article>';
}
