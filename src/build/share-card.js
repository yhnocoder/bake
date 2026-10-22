import { escapeMarkup } from '../shared/escape.js';

const STYLE = `
html,
body {
  margin: 0;
  width: 1200px;
  height: 630px;
  overflow: hidden;
}

body {
  background: var(--bg);
  color: var(--ink);
}

.card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 56px;
  width: 1200px;
  height: 630px;
  padding: 64px 72px 64px 104px;
  font-family: var(--font-heading);
}

.strip {
  position: absolute;
  inset: 0 auto 0 0;
  width: 24px;
  background: var(--c, var(--accent));
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.site {
  margin: 0;
  color: var(--ink-3);
  font-size: 26px;
  line-height: 1.4;
}

.category {
  color: var(--c, var(--accent));
}

.category::before {
  content: '·';
  margin: 0 12px;
  color: var(--ink-3);
}

.title,
.summary {
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.title {
  font-size: 60px;
  font-weight: 700;
  line-height: 1.25;
  -webkit-line-clamp: 4;
}

.summary {
  color: var(--ink-2);
  font-size: 30px;
  line-height: 1.5;
  -webkit-line-clamp: 3;
}

.frame {
  position: relative;
  flex: none;
  width: 448px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface-2);
}

.preview {
  position: absolute;
  inset: 0;
}
`;

export function cardHtml(card, stylesheet) {
  const color = card.color === undefined ? '' : ` style="--c: ${escapeMarkup(card.color)}"`;
  const category = card.category === undefined ? '' : `<span class="category">${escapeMarkup(card.category)}</span>`;
  const summary = card.summary === undefined ? '' : `<p class="summary">${escapeMarkup(card.summary)}</p>`;
  const frame = card.preview === undefined ? '' : '<div class="frame"><div class="preview"></div></div>';
  return `<!doctype html>
<html lang="${escapeMarkup(card.language)}" data-theme="light">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${escapeMarkup(stylesheet)}">
<style>${STYLE}</style>
</head>
<body>
<div class="card"${color}>
<div class="strip"></div>
<div class="text">
<p class="site"><span>${escapeMarkup(card.site)}</span>${category}</p>
<h1 class="title">${escapeMarkup(card.title)}</h1>
${summary}
</div>
${frame}
</div>
</body>
</html>
`;
}
