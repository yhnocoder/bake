export function renderPlaceholderPage({ language, title, summary }) {
  const lines = [
    '<!doctype html>',
    `<html lang="${escapeHtml(language)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...(summary === undefined ? [] : [`<p>${escapeHtml(summary)}</p>`]),
    '</body>',
    '</html>',
  ];
  return `${lines.join('\n')}\n`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
