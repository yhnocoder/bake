import { pageSections, sectionList } from '../build/sections.js';
import { previewOf } from '../client/preview-data.js';
import { pagePath } from '../render/index.js';
import { splitHref } from '../site/links.js';
import { RequestError } from './request-error.js';

export function linkApi({ site, renderedPage, componentEntry }) {
  const sectionsCache = new Map();
  const listCache = new Map();

  function cached(cache, rendered, compute) {
    const entry = cache.get(rendered.path);
    if (entry?.html === rendered.html) return entry.value;
    const value = compute();
    cache.set(rendered.path, { html: rendered.html, value });
    return value;
  }

  function scriptsOf(rendered) {
    const { components } = site();
    return Object.fromEntries(rendered.components.filter((name) => components[name]).map((name) => [name, componentEntry(name)]));
  }

  async function sections() {
    const entries = site()
      .pages.filter((page) => page.url !== null && page.frontmatter.draft !== true)
      .sort((a, b) => a.path.localeCompare(b.path));
    const pages = [];
    for (const entry of entries) {
      const rendered = await renderedPage(entry.url);
      pages.push({ url: entry.url, title: rendered.page.title, sections: cached(listCache, rendered, () => sectionList(rendered.html)) });
    }
    return { pages };
  }

  async function preview(url) {
    const href = url.searchParams.get('href');
    if (href === null) throw new RequestError(400, 'Missing query parameter href');
    const { path, fragment } = splitHref(href);
    const page = pagePath(path);
    const rendered = await renderedPage(page);
    if (!rendered) throw new RequestError(404, `No page at ${page}`);
    const data = cached(sectionsCache, rendered, () =>
      pageSections({ title: rendered.page.title, html: rendered.html, mathDefs: rendered.mathDefs, url: page, scripts: scriptsOf(rendered) }),
    );
    const result = previewOf(data, fragment === '' ? null : fragment);
    if (!result) throw new RequestError(404, `No heading or paragraph #${fragment} on ${page}`);
    return result;
  }

  return {
    'GET /__bake/sections': () => sections(),
    'GET /__bake/preview': (request, url) => preview(url),
  };
}
