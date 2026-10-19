import { errorAt } from '../report.js';

const ARTICLE_ADDRESS = /^(\/\d{4}-\d{2}\/[^/?#]+\/)(?:#(.*))?$/;

export function articleUrl(date, slug) {
  return `/${date.slice(0, 7)}/${slug}/`;
}

export function pageRoot(url) {
  return '../'.repeat(url.split('/').length - 2);
}

export function parseAddress(url) {
  const match = ARTICLE_ADDRESS.exec(url);
  if (!match) return null;
  const [, path, hash = ''] = match;
  let anchor;
  try {
    anchor = hash === '' ? undefined : decodeURIComponent(hash);
  } catch {
    return null;
  }
  return { path, anchor, text: anchor === undefined ? path : `${path}#${anchor}` };
}

export function addressHref(root, path, anchor) {
  return `${root}${path.slice(1)}${anchor === undefined ? '' : `#${encodeURIComponent(anchor)}`}`;
}

export function checkDuplicateUrls(articles, errors) {
  const owners = new Map();
  for (const article of articles) {
    if (article.url === null) continue;
    const owner = owners.get(article.url);
    if (owner) errors.push(errorAt(article.file, article.positions.slug, `URL ${article.url} is already used by ${owner}`));
    else owners.set(article.url, article.file);
  }
}
