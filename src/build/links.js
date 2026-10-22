import { errorAt } from '../report.js';
import { meantName } from '../suggest.js';

export function indexPages(pages) {
  const byUrl = new Map();
  for (const page of pages) {
    if (page.url !== null && !byUrl.has(page.url)) byUrl.set(page.url, page);
  }
  const bySource = new Map(pages.map((page) => [page.article, page]));
  return {
    find(address, source) {
      const page = byUrl.get(address.path);
      if (page === undefined) return { problem: `does not exist${movedHint(address, byUrl)}` };
      if (page.draft && bySource.get(source)?.draft !== true) return { problem: 'is a draft, which is not published' };
      const anchored = address.anchor === undefined || (page.article !== null && page.article.hasTarget(address.anchor));
      if (!address.canonical) return { problem: `does not exist; the address of the article is ${anchored ? address.text : address.path}` };
      if (!anchored) return { problem: `does not exist${anchorHint(address, page)}` };
      return { page };
    },
  };
}

function anchorHint(address, page) {
  const meant = page.article === null ? undefined : meantName(address.anchor, page.article.targets.keys());
  return meant === undefined ? '' : `; did you mean ${address.path}#${meant}?`;
}

function movedHint(address, byUrl) {
  const slug = address.path.split('/')[2];
  const moved = [...byUrl.values()].filter((page) => !page.draft && page.url.split('/')[2] === slug).map((page) => page.url);
  if (moved.length === 0) return '';
  if (moved.length === 1) return `; the article with slug "${slug}" is at ${moved[0]}`;
  return `; the articles with slug "${slug}" are at ${moved.slice(0, -1).join(', ')} and ${moved.at(-1)}`;
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
