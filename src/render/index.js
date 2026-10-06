import GithubSlugger from 'github-slugger';
import { toHtml } from 'hast-util-to-html';
import { toHast } from 'mdast-util-to-hast';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import builtinBlocks from '../blocks/index.js';
import { parse } from '../format/index.js';
import { createRegistry } from '../format/registry.js';
import { renderEquations } from './equations.js';
import { createHandlers } from './handlers.js';
import { placeSidenotes } from './sidenotes.js';

const tocDepths = [2, 3];

function explicitId(node) {
  if (node.type === 'heading') return node.data?.attributes?.id;
  if (node.type === 'paragraph') return node.data?.blockId;
  if (node.type === 'math') return node.data?.equationId;
  return undefined;
}

function assignIds(tree, report) {
  const explicit = new Set();
  visit(tree, (node) => {
    const id = explicitId(node);
    if (id === undefined) return;
    if (explicit.has(id)) report(node, `Duplicate id ${id}`);
    explicit.add(id);
  });
  const slugger = new GithubSlugger();
  const ids = [];
  const toc = [];
  visit(tree, (node) => {
    let id = explicitId(node);
    if (node.type === 'heading') {
      if (id === undefined) {
        do id = slugger.slug(toString(node));
        while (explicit.has(id));
        if (id === '') report(node, 'Cannot generate an id from this heading, add {#id}');
      }
      node.data = { ...node.data, id };
      if (tocDepths.includes(node.depth)) toc.push({ id, text: node.data.attributes?.toc ?? toString(node), depth: node.depth });
    }
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  });
  return { ids, toc };
}

function normalizeHref(href) {
  const hash = href.indexOf('#');
  const path = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? '' : href.slice(hash);
  if (path === '' || path.endsWith('/')) return href;
  return `${path}/${fragment}`;
}

function collectLinks(tree) {
  const links = [];
  visit(tree, ['link', 'definition'], (node) => {
    if (!node.url.startsWith('/') && !node.url.startsWith('#')) return;
    node.url = normalizeHref(node.url);
    links.push({ href: node.url, line: node.position.start.line, column: node.position.start.column });
  });
  return links;
}

function collectImages(tree) {
  const images = [];
  visit(tree, 'image', (node) => {
    images.push({ src: node.url, line: node.position.start.line, column: node.position.start.column });
  });
  return images;
}

function collectComponents(tree) {
  const names = new Set();
  visit(tree, ['leafDirective', 'containerDirective'], (node) => {
    if (node.name.includes('-')) names.add(node.name);
  });
  return [...names];
}

export async function render(source, { path, config = {}, blocks = [], components, layouts, themes } = {}) {
  const parsed = parse(source, { path, blocks, components, layouts, themes });
  const { tree } = parsed;
  const messages = [...parsed.messages];
  const report = (node, text) => {
    messages.push({ path, line: node.position.start.line, column: node.position.start.column, text });
  };
  placeSidenotes(tree, report);
  const mathDefs = await renderEquations(tree, { macros: config.math?.macros ?? {}, report });
  const { ids, toc } = assignIds(tree, report);
  const links = collectLinks(tree);
  const handlers = createHandlers({ source, registry: createRegistry(builtinBlocks, blocks), components });
  const html = toHtml(toHast(tree, { handlers, allowDangerousHtml: true }), { allowDangerousHtml: true });
  messages.sort((a, b) => a.line - b.line || a.column - b.column);
  return {
    page: parsed.frontmatter,
    html,
    toc,
    mathDefs,
    ids,
    links,
    images: collectImages(tree),
    components: collectComponents(tree),
    messages,
  };
}
