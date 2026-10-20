import { fragmentOf, percentDecode } from './fragments.js';

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

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function addressHref(root, path, anchor, query = '') {
  return `${root}${path.slice(1)}${query}${anchor === undefined ? '' : fragmentOf(anchor)}`;
}

export function siteLink(url) {
  return `${new URL(url).origin}${sitePath(url)}`;
}

export function sitePath(url) {
  const { pathname } = new URL(url);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function absoluteLink(config, path) {
  return `${siteLink(config.url)}${encodePath(path)}`;
}
