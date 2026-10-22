import { posix } from 'node:path';
import { findArticles } from '../build/articles.js';
import { POSTS_DIR } from '../config/bake-config.js';
import { createSite, updateSite } from '../build/site.js';
import { BUILT_IN_BLOCKS, IMAGE_ATTRIBUTES } from '../markdown/parse.js';
import { sourceVersion } from './params.js';

export function createPreview(root, localUrl) {
  const site = createSite(root, { drafts: true, base: '/', localUrl, prefetch: false });
  let pages = new Map();
  let home = null;
  let siteFiles = new Map();
  let publicFiles = new Map();
  const assetFiles = new Map();
  let articles = [];
  let read = new Map();
  let problems = [];
  let changedPaths = [];

  async function update(paths = null) {
    if (paths !== null) changedPaths.push(...paths);
    const result = await updateSite(site, paths);
    problems = result.errors;
    // why: a build with errors keeps the previous output, except the first one, so that every page can show the problems
    if (result.home === undefined || (problems.length > 0 && home !== null)) return { problems, applied: false };
    const next = new Map(result.pages.map((page) => [page.article.file, servedPage(page, site.settings.components)]));
    const nextHome = servedHome(result.home);
    const changes = compare(pages, next, changedPaths.some((path) => !isArticleSource(path)));
    if (home?.html !== nextHome.html) changes.reload = changes.reload === 'all' ? 'all' : ['/', ...changes.reload];
    pages = next;
    home = nextHome;
    read = new Map(result.articles.map((article) => [article.file, article]));
    articles = result.articles.map((article) => ({ file: article.file, title: article.fields?.title, date: article.fields?.date, draft: article.draft }));
    siteFiles = new Map(result.siteFiles.map((output) => [output.path, output]));
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
    const output = siteFiles.get(path) ?? publicFiles.get(path) ?? assetFiles.get(path);
    return output === undefined ? null : { output, page: null };
  }

  function listing() {
    return articles.map((article) => ({ ...article, url: pages.get(article.file)?.url ?? null }));
  }

  function component(name) {
    const found = site.settings?.components?.get(name);
    return found?.valid ? found : null;
  }

  function setUnsaved(file, text) {
    if (!findArticles(site.root).some((article) => article.file === file)) return null;
    const changed = (site.unsaved.get(file) ?? null) !== text;
    if (text === null) site.unsaved.delete(file);
    else site.unsaved.set(file, text);
    return changed;
  }

  function dropUnsaved(paths) {
    for (const path of paths) site.unsaved.delete(path);
  }

  function syntax(file) {
    const { settings } = site;
    const article = read.get(file);
    if (settings?.markdown === undefined || article === undefined) return null;
    const theme = settings.markdown.get(article.fields?.theme ?? settings.rules.theme);
    const dir = posix.dirname(file);
    const components = [...settings.components.values()].filter((found) => found.valid && (found.article === null || found.article === dir));
    const blocks = [
      ...Object.entries(BUILT_IN_BLOCKS).map(([name, attributes]) => ({ name, kind: 'built-in', attributes: builtInAttributes(attributes) })),
      ...Object.entries(theme?.blocks ?? {}).map(([name, attributes]) => ({ name, kind: 'theme', attributes })),
      ...components.map((found) => ({ name: found.name, kind: 'component', attributes: found.params })),
    ];
    return { blocks, image: builtInAttributes(IMAGE_ATTRIBUTES), headings: theme?.headings ?? {} };
  }

  return { update, find, listing, problems: () => problems, page: (file) => pages.get(file) ?? null, component, setUnsaved, dropUnsaved, syntax };
}

function builtInAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes).map(([name, { text, choices, size }]) => [name, attributeDeclaration(text, choices, size)]));
}

function attributeDeclaration(text, choices, size) {
  if (choices !== undefined) return { type: 'enum', options: choices };
  if (size !== undefined) return { type: 'text', label: `${size} in pixels such as 560px or as a percentage of the text column such as 70%` };
  return { type: 'text', label: text };
}

function isArticleSource(path) {
  return path.startsWith(`${POSTS_DIR}/`) && posix.basename(path) === 'index.md';
}

function servedPage({ article, entry, outputs }, components) {
  const index = outputs.find((output) => output.path === `${entry.path}index.html`);
  return {
    file: article.file,
    url: entry.url,
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
    if (a === undefined || b === undefined || a.fields !== b.fields) reload.push(url);
    else if (a.html !== b.html || a.version !== b.version) refresh.push(url);
  }
  return { reload: reloadAll ? 'all' : reload.sort(), refresh: refresh.sort() };
}
