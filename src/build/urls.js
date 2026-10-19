import { errorAt } from '../report.js';

export function articleUrl(date, slug) {
  return `/${date.slice(0, 7)}/${slug}/`;
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
