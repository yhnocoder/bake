import { escapeHtml } from './html.js';

export function renderDocument({ page, config, body, mathDefs, assets }) {
  const title = page.url === '/' ? config.title : `${page.title} · ${config.title}`;
  const styles = assets.styles.map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">\n`).join('');
  const scripts = assets.scripts.map((url) => `<script type="module" src="${escapeHtml(url)}"></script>\n`).join('');
  const bodyTag = page.width === 'wide' ? '<body class="wide">' : '<body>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${styles}${scripts}</head>
${bodyTag}
${mathDefs}${body}
</body>
</html>
`;
}
