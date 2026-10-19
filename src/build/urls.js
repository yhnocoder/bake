import { errorAt } from '../report.js';

const ARTICLE_ADDRESS = /^(\/\d{4}-\d{2}\/[^/?#]+)(\/|\/index\.html)?(\?[^#]*)?(?:#(.*))?$/;
export const INVALID_PERCENT_ENCODING = 'has an invalid percent-encoding; write a literal % as %25';

export function articleUrl(date, slug) {
  return `/${date.slice(0, 7)}/${slug}/`;
}

export function pageRoot(url) {
  return '../'.repeat(url.split('/').length - 2);
}

export function parseAddress(url) {
  const match = ARTICLE_ADDRESS.exec(url);
  if (!match) return null;
  const [, base, ending = '', query = '', hash = ''] = match;
  const anchor = hash === '' ? undefined : percentDecode(hash);
  if (anchor === null) return { written: url, problem: INVALID_PERCENT_ENCODING };
  const path = `${base}/`;
  const fragment = anchor === undefined ? '' : `#${anchor}`;
  return { path, anchor, query, canonical: ending === '/', text: `${path}${fragment}`, written: `${base}${ending}${query}${fragment}` };
}

export function percentDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

export function addressHref(root, path, anchor, query = '') {
  return `${root}${path.slice(1)}${query}${anchor === undefined ? '' : `#${encodeURIComponent(anchor)}`}`;
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
