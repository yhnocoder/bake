import { posix } from 'node:path';
import { POSTS_DIR } from '../build/articles.js';
import { createSite, updateSite } from '../build/site.js';
import { sourceVersion } from './params.js';

export function createPreview(root) {
  const site = createSite(root, { drafts: true });
  let pages = new Map();
  let home = null;
  let publicFiles = new Map();
  const assetFiles = new Map();
  let articles = [];
  let problems = [];
  let changedPaths = [];

  async function update(paths = null) {
    if (paths !== null) changedPaths.push(...paths);
    const result = await updateSite(site, paths);
    problems = result.errors;
    const articleFiles = new Set(result.articles.map((article) => article.file));
    if (result.errors.some((error) => !articleFiles.has(error.file))) return { problems, applied: false };
    const failed = new Set(result.errors.map((error) => error.file));
    const published = new Map(result.pages.map((page) => [page.article.file, page]));
    const next = new Map();
    for (const article of result.articles) {
      if (failed.has(article.file)) {
        if (pages.has(article.file)) next.set(article.file, pages.get(article.file));
      } else if (published.has(article.file)) {
        next.set(article.file, servedPage(published.get(article.file), site.settings.components));
      }
    }
    const nextHome = servedHome(result.home);
    const changes = compare(pages, next, changedPaths.some((path) => !isArticleSource(path)));
    if (home?.html !== nextHome.html) changes.reload = changes.reload === 'all' ? 'all' : ['/', ...changes.reload];
    pages = next;
    home = nextHome;
    articles = result.articles.map((article) => ({ file: article.file, title: article.fields?.title, date: article.fields?.date, draft: article.fields?.draft === true }));
    publicFiles = new Map(result.publicFiles.map((output) => [output.path, output]));
    for (const output of result.assetFiles) assetFiles.set(output.path, output);
    changedPaths = [];
    return { problems, applied: true, ...changes };
  }

  function find(path) {
    if (path === home?.output.path) return { output: home.output, page: null };
    for (const page of pages.values()) {
      const output = page.outputs.get(path);
      if (output !== undefined) return { output, page };
    }
    const output = publicFiles.get(path) ?? assetFiles.get(path);
    return output === undefined ? null : { output, page: null };
  }

  function listing() {
    return articles.map((article) => ({ ...article, url: pages.get(article.file)?.url ?? null }));
  }

  function component(name) {
    const found = site.settings?.components?.get(name);
    return found?.valid ? found : null;
  }

  return { update, find, listing, problems: () => problems, page: (file) => pages.get(file) ?? null, component };
}

function isArticleSource(path) {
  return path.startsWith(`${POSTS_DIR}/`) && posix.basename(path) === 'index.md';
}

function servedPage({ article, outputs }, components) {
  const index = outputs.find((output) => output.path === `${article.url.slice(1)}index.html`);
  return {
    file: article.file,
    url: article.url,
    fields: JSON.stringify(article.fields),
    html: index?.render?.() ?? null,
    outline: outlineOf(article.content),
    version: sourceVersion(article.source),
    files: article.files,
    components: componentParams(article.content, components),
    outputs: new Map(outputs.map((output) => [output.path, output])),
  };
}

function servedHome(output) {
  return { output, html: output.render() };
}

function componentParams(content, components) {
  const used = (content?.components ?? []).map((name) => components.get(name)).filter((component) => component?.valid);
  return Object.fromEntries(used.map((component) => [component.name, component.params]));
}

function outlineOf(content) {
  if (content === null) return [];
  return content.sections.flatMap((section) => {
    const title = `${section.number} ${section.text}`;
    return [{ line: section.line, title }, ...section.subsections.map((subsection) => ({ line: subsection.line, title: `${title} › ${subsection.text}` }))];
  });
}

function compare(before, after, reloadAll) {
  const byUrl = (pages) => new Map([...pages.values()].map((page) => [page.url, page]));
  const [old, next] = [byUrl(before), byUrl(after)];
  const reload = [];
  const refresh = [];
  for (const url of new Set([...old.keys(), ...next.keys()])) {
    const [a, b] = [old.get(url), next.get(url)];
    if (a === b) continue;
    if (a === undefined || b === undefined || a.fields !== b.fields) reload.push(url);
    else if (a.html !== b.html || a.version !== b.version) refresh.push(url);
  }
  return { reload: reloadAll ? 'all' : reload.sort(), refresh: refresh.sort() };
}
