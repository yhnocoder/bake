export function renderPlaceholderPage({ language, title, summary, content }) {
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
    ...content.intro.map((block) => block.html),
    ...content.sections.flatMap((section) => [
      `<section id="${escapeHtml(section.id)}">`,
      `<h2>${section.number} ${section.title}</h2>`,
      ...section.blocks.map((block) => block.html),
      '</section>',
    ]),
    ...(content.sidenotes.length === 0 ? [] : ['<ol class="sidenotes">', ...content.sidenotes.map((note) => `<li id="${note.id}">${note.html}</li>`), '</ol>']),
    '</body>',
    '</html>',
  ];
  return `${lines.join('\n')}\n`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
