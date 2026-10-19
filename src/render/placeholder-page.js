const CODE_COLORS = `:root {
  color-scheme: light dark;
  --code-foreground: light-dark(#24292f, #e6edf3);
  --code-background: light-dark(#f6f8fa, #161b22);
  --code-token-keyword: light-dark(#985b57, #d39a93);
  --code-token-function: light-dark(#2a6fb0, #79b8ff);
  --code-token-constant: light-dark(#0550ae, #79c0ff);
  --code-token-string: light-dark(#0a3069, #a5d6ff);
  --code-token-string-expression: light-dark(#116329, #7ee787);
  --code-token-comment: light-dark(#6e7781, #8b949e);
  --code-token-parameter: light-dark(#953800, #ffa657);
  --code-token-punctuation: light-dark(#24292f, #e6edf3);
  --code-token-link: light-dark(#0550ae, #79c0ff);
}`;

const IMAGE_STYLES = `img {
  max-width: 100%;
  height: auto;
}
.figure {
  width: fit-content;
  max-width: 100%;
  margin: 1.5em auto;
}
.figure > img {
  display: block;
  width: 100%;
}
.figure > figcaption {
  contain: inline-size;
}
.figure[data-float="left"] {
  float: left;
  max-width: 50%;
  margin: 0.25em 1.5em 1em 0;
}
.figure[data-float="right"] {
  float: right;
  max-width: 50%;
  margin: 0.25em 0 1em 1.5em;
}
@media (max-width: 600px) {
  .figure[data-float] {
    float: none;
    max-width: 100%;
    margin: 1.5em auto;
  }
}`;

export function renderPlaceholderPage({ language, title, summary, content, mathStyles }) {
  const styles = [CODE_COLORS, IMAGE_STYLES, ...(content.glyphs === undefined ? [] : [mathStyles])];
  const lines = [
    '<!doctype html>',
    `<html lang="${escapeHtml(language)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${styles.join('\n')}\n</style>`,
    '</head>',
    '<body>',
    ...(content.glyphs === undefined ? [] : [content.glyphs]),
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
