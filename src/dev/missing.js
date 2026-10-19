const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; font: 15px/1.6 system-ui, sans-serif; background: Canvas; color: CanvasText; }
main { max-width: 720px; margin: 0 auto; padding: 48px 16px; }
h1 { margin: 0 0 8px; font-size: 22px; }
p { margin: 0 0 24px; opacity: 0.75; }
ol { margin: 0; padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; padding: 10px 0; border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
.date, .file { font: 13px/1.6 ui-monospace, monospace; opacity: 0.7; }
.draft { padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, #d97706 18%, transparent); font-size: 13px; }
`;

export function missingPage(pathname, articles) {
  const items = articles
    .toSorted((a, b) => compareText(b.date ?? '', a.date ?? '') || compareText(a.file, b.file))
    .map((article) => {
      const title = escapeHtml(article.title ?? article.file);
      const name = article.url === null ? `<span>${title}</span>` : `<a href="${escapeHtml(article.url)}">${title}</a>`;
      const date = article.date === undefined ? '' : `<span class="date">${escapeHtml(article.date)}</span>`;
      const draft = article.draft ? '<span class="draft">Draft</span>' : '';
      return `<li>${name}${date}${draft}<span class="file">${escapeHtml(article.file)}</span></li>`;
    });
  const intro = items.length === 0 ? 'No article has a page yet.' : 'These are all articles of the blog, drafts included.';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Page not found</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>No page at ${escapeHtml(pathname)}</h1>`,
    `<p>${intro}</p>`,
    items.length === 0 ? '' : `<ol>${items.join('')}</ol>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function escapeHtml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
