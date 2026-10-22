import { CHAT_PREAMBLE_PATH } from './bundle.js';

const CATALOG_PATH = '_bake/articles.json';
const OWNER = 'the AI chat';

export function chatFiles({ config, settings, listed }) {
  return [
    { path: CATALOG_PATH, render: () => catalogJson(config, listed), owner: OWNER },
    { path: CHAT_PREAMBLE_PATH, render: () => `${JSON.stringify(settings.preamble.map((definition) => definition.tex))}\n`, owner: OWNER },
    ...settings.pet.files.map((file) => ({ path: file.path, render: () => file.source, owner: OWNER })),
  ];
}

function catalogJson(config, pages) {
  const articles = pages.map(({ article, entry }) => ({
    url: entry.path,
    title: entry.title,
    date: entry.date,
    summary: entry.summary,
    tags: entry.tags,
    category: entry.category?.name,
    source: article.fields.page === undefined ? `${entry.path}index.md` : undefined,
    sections: (article.content?.toc ?? []).map((section) => ({
      id: section.id,
      number: section.number,
      title: section.title,
      subsections: section.children.map((child) => ({ id: child.id, title: child.title })),
    })),
  }));
  return `${JSON.stringify({ title: config.title, description: config.description, language: config.language, articles })}\n`;
}
