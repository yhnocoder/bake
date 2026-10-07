const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => entities[character]);
}

export const fields = {
  series: { label: '系列', type: 'string' },
};

export default function note({ page, html }) {
  const series = page.series === undefined ? '' : `<p class="note-series">${escapeHtml(page.series)}</p>`;
  return `<main class="layout-note">
<header class="mast">${series}<h1>${escapeHtml(page.title)}</h1></header>
<article>${html}</article>
</main>`;
}
