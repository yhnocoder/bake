import { compareText } from '../report.js';
import { absoluteLink } from './site-files.js';
import { encodePath } from './urls.js';

export function articleEntry(article, config) {
  const { fields, content, url } = article;
  const path = url.slice(1);
  return {
    title: fields.title,
    summary: fields.summary,
    date: fields.date,
    tags: fields.tags ?? [],
    category: config.categories.find((category) => category.id === fields.category),
    draft: article.draft,
    url,
    path,
    link: absoluteLink(config, path),
    preview: fields.preview === undefined ? undefined : `${path}${encodePath(fields.preview)}`,
    image: content?.image === undefined ? undefined : `${path}${encodePath(content.image)}`,
  };
}

export function newestFirst(a, b) {
  return compareText(b.date, a.date) || compareText(a.title, b.title);
}
