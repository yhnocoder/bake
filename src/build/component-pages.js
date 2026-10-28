import { escapeMarkup } from '../shared/escape.js';
import { encodePath, pageRoot } from '../shared/urls.js';
import { THEME_STYLES_PATH } from './theme.js';

const STYLES = `body {
  background: var(--surface);
}
.component {
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 18px 18px 12px;
}
.component[data-frame='none'] {
  padding: 0;
}
.component-box {
  position: relative;
  height: var(--component-height, var(--component-placeholder-narrow, var(--component-placeholder-height)));
  aspect-ratio: var(--component-ratio, auto);
  font-size: var(--body-size);
  line-height: 1.85;
}
@media (min-width: 600px) {
  .component-box {
    height: var(--component-height, var(--component-placeholder-wide, var(--component-placeholder-height)));
  }
}
.component[data-state='ready'] > .component-box {
  height: var(--component-height, auto);
}
.component-box > * {
  display: block;
  height: 100%;
}`;

const SCHEME_SCRIPT = `const scheme = new URLSearchParams(location.search).get('scheme');
if (scheme === 'light' || scheme === 'dark') document.documentElement.dataset.scheme = scheme;`;

// why: a page that shows this page in a frame cannot read the height of its content, so the page sends it whenever it changes
const HEIGHT_SCRIPT = `if (parent !== window) {
  const root = document.documentElement;
  new ResizeObserver(() => parent.postMessage({ type: 'bake:height', height: Math.ceil(root.getBoundingClientRect().height) }, '*')).observe(root);
}`;

function shareMeta(title, link, image) {
  const meta = (attribute, name, content) => `<meta ${attribute}="${name}" content="${escapeMarkup(content)}">`;
  const tags = [meta('property', 'og:title', title), meta('property', 'og:url', link), meta('name', 'twitter:card', image === undefined ? 'summary' : 'summary_large_image')];
  if (image === undefined) return tags;
  return [...tags, meta('property', 'og:image', image.link), meta('property', 'og:image:type', image.type), meta('property', 'og:image:width', String(image.width)), meta('property', 'og:image:height', String(image.height)), meta('name', 'twitter:image', image.link)];
}

// Each component of an article gets a page of its own at components/<name>/ in the article folder, which shows only the component, so that other sites can show it in a frame.
export function componentPageOutputs(article, entry, { config, runtime, componentImages }) {
  return article.content.componentPages.map((component, index) => {
    const path = `${entry.path}components/${component.name}/`;
    const html = componentPageHtml(component, entry, { config, runtime, path, shareImage: componentImages[index] });
    return { path: `${path}index.html`, render: () => html, owner: article.file };
  });
}

export function componentPageHtml(component, entry, { config, runtime, path, shareImage }) {
  const root = pageRoot(`/${path}`);
  const title = `${component.component} · ${entry.title}`;
  return [
    '<!doctype html>',
    `<html lang="${escapeMarkup(config.language)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeMarkup(title)}</title>`,
    `<link rel="canonical" href="${escapeMarkup(entry.link)}">`,
    ...shareMeta(title, entry.link, shareImage),
    `<link rel="stylesheet" href="${root}${encodePath(THEME_STYLES_PATH)}">`,
    `<style>\n${STYLES}\n</style>`,
    `<script>\n${SCHEME_SCRIPT}\n</script>`,
    ...(runtime === undefined ? [] : [`<script type="module" src="${root}${encodePath(runtime)}"></script>`]),
    '</head>',
    '<body>',
    component.html,
    `<script>\n${HEIGHT_SCRIPT}\n</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
