import { errorAt } from '../report.js';
import { meantName } from '../suggest.js';

// An article is linked again when it or a page at an address it looked up changed, and its structure is computed again when its links or the links of an article whose parts it shows changed.
export async function linkArticles(site, articles, errors) {
  checkDuplicateUrls(articles, errors);
  const index = indexPages(articles.map((article) => article.page));
  const links = new Map();
  for (const article of articles.filter((candidate) => candidate.document !== null)) {
    const linked = await site.memo.get(`links ${article.file}`, { article, index }, (files) => {
      const { document } = files.same((context) => context.article);
      const linkErrors = [];
      for (const path of document.link(index, linkErrors)) {
        if (files.same((context) => context.index.page(path)) === undefined) files.value((context) => context.index.moved(path));
      }
      return { errors: linkErrors };
    });
    links.set(article.document, linked);
  }
  for (const article of articles) {
    if (article.document === null) {
      article.content = null;
      continue;
    }
    const structure = await site.memo.get(`structure ${article.file}`, { article, links }, (files) => {
      const { document } = files.same((context) => context.article);
      files.same((context) => context.links.get(document));
      const structureErrors = [];
      const content = document.structure(structureErrors);
      for (const source of document.borrowed) files.same((context) => context.links.get(source));
      return { content, errors: structureErrors };
    });
    article.content = structure.content;
    errors.push(...links.get(article.document).errors, ...structure.errors);
  }
}

export function indexPages(pages) {
  const byUrl = new Map();
  for (const page of pages) {
    if (page.url !== null && !byUrl.has(page.url)) byUrl.set(page.url, page);
  }
  const bySource = new Map(pages.map((page) => [page.article, page]));
  const moved = (path) => {
    const slug = path.split('/')[2];
    return [...byUrl.values()].filter((page) => !page.draft && page.url.split('/')[2] === slug).map((page) => page.url);
  };
  return {
    page: (path) => byUrl.get(path),
    moved,
    find(address, source) {
      const page = byUrl.get(address.path);
      if (page === undefined) return { problem: `does not exist${movedHint(address, moved(address.path))}` };
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

function movedHint(address, moved) {
  const slug = address.path.split('/')[2];
  if (moved.length === 0) return '';
  if (moved.length === 1) return `; the article with slug "${slug}" is at ${moved[0]}`;
  return `; the articles with slug "${slug}" are at ${moved.slice(0, -1).join(', ')} and ${moved.at(-1)}`;
}

function checkDuplicateUrls(articles, errors) {
  const owners = new Map();
  for (const article of articles) {
    if (article.url === null) continue;
    const owner = owners.get(article.url);
    if (owner) errors.push(errorAt(article.file, article.positions.slug, `URL ${article.url} is already used by ${owner}`));
    else owners.set(article.url, article.file);
  }
}
