import { installPreview } from './preview.js';
import { previewOf } from './preview-data.js';

const pages = new Map();

function sectionsOf(page) {
  if (!pages.has(page)) {
    const request = fetch(`${page}sections.json`).then((response) => {
      if (!response.ok) throw new Error(`${page}sections.json returned ${response.status}`);
      return response.json();
    });
    request.catch(() => pages.delete(page));
    pages.set(page, request);
  }
  return pages.get(page);
}

installPreview({ load: async ({ page, id }) => previewOf(await sectionsOf(page), id) });
