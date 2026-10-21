import { toString } from 'mdast-util-to-string';
import { idOfFragment, referenceId, sidenoteId } from '../fragments.js';
import { renderChildrenHtml, renderHast, renderInlineHtml } from '../render/html.js';
import { INVALID_PERCENT_ENCODING, addressHref, parseAddress } from '../urls.js';
import { generatedIds } from './parse.js';
import { walk, walkWithSidenotes } from './tree.js';

const PREVIEW_BLOCKS = 3;
const EMBEDDABLE = new Set(['heading', 'paragraph']);
const EMBED_EXAMPLE = 'such as /2026-10/slug/#anchor';

export function indexTargets(article) {
  const { tree } = article;
  let section = null;
  let subsection = null;
  let sections = 0;
  let subsections = 0;
  for (const top of tree.children) {
    if (top.type === 'heading' && top.depth === 2) {
      section = { number: String(++sections), heading: top };
      subsection = null;
      subsections = 0;
    } else if (top.type === 'heading' && top.depth === 3 && section !== null) {
      subsection = { number: `${section.number}.${++subsections}`, heading: top };
    }
    article.places.set(top, subsection ?? section);
    walk(
      top,
      (node, parent) => {
        const add = (id, kind, target = node) => {
          if (!article.targets.has(id)) article.targets.set(id, { kind, node: target, parent, top });
        };
        if (node.type === 'heading') add(node.id, 'heading');
        if (node.type === 'paragraph' && node.anchor !== undefined) add(node.anchor, 'paragraph');
        if (node.type === 'math') for (const id of node.ids ?? []) add(id, 'equation');
        const sidenote = node.type === 'footnoteReference' ? article.sidenotes.get(node.identifier) : undefined;
        if (sidenote?.definition !== undefined) add(sidenoteId(sidenote.number), 'sidenote', sidenote.definition);
        if (node.type === 'bakeBlock' && node.name === 'references') {
          for (const entry of article.references) add(referenceId(entry.key), 'reference', entry);
        }
      },
      tree,
    );
  }
  for (const { number, definition } of article.sidenotes.values()) {
    if (definition !== undefined && !article.targets.has(sidenoteId(number))) article.targets.set(sidenoteId(number), { kind: 'sidenote', node: definition, parent: null, top: null });
  }
}

export function linkArticle(article, site, errors) {
  article.errors = errors;
  article.linked.clear();
  article.borrowed.clear();
  const ids = pageIds(article);
  walkWithSidenotes(article, article.tree, (node) => {
    if (node.type === 'link') {
      delete node.target;
      checkLink(article, node, site, ids);
    }
    if (node.type === 'bakeBlock' && node.name === 'embed') {
      readEmbed(article, node, site);
      return false;
    }
  });
}

function pageIds(article) {
  const ids = new Set([...article.targets.keys(), ...generatedIds(article).keys()]);
  walkWithSidenotes(article, article.tree, (node) => {
    if (node.type === 'html') for (const id of node.rawHtml.ids) ids.add(id);
  });
  return ids;
}

function checkLink(article, node, site, ids) {
  if (node.url.startsWith('#')) {
    if (node.url === '#') return;
    const id = idOfFragment(node.url);
    if (id === null) article.report(node.position.start, `link target ${node.url} ${INVALID_PERCENT_ENCODING}`);
    else if (!ids.has(id)) article.report(node.position.start, `link target #${id} does not exist`);
    return;
  }
  const address = parseAddress(node.url);
  if (address === null) return;
  if (address.problem !== undefined) {
    article.report(node.position.start, `link target ${address.written} ${address.problem}`);
    return;
  }
  const found = site.find(address, article);
  if (found.problem !== undefined) article.report(node.position.start, `link target ${address.written} ${found.problem}`);
  else node.target = { address, page: found.page };
}

function readEmbed(article, node, site) {
  const start = node.position.start;
  const lines = embedLines(article, node);
  if (node.children.length === 0) article.report(start, `:::embed lists no address; write one site address per line, ${EMBED_EXAMPLE}`);
  const parts = [];
  const seen = new Set();
  for (const { text, position } of lines) {
    const address = parseAddress(text);
    if (address === null) {
      article.report(position, `:::embed line "${text}" is not a site address ${EMBED_EXAMPLE}`);
      continue;
    }
    if (address.problem !== undefined) {
      article.report(position, `:::embed address ${address.written} ${address.problem}`);
      continue;
    }
    if (address.path === article.url) {
      article.report(position, ':::embed cannot embed the article itself');
      continue;
    }
    if (seen.has(address.text)) {
      article.report(position, `:::embed lists ${address.text} twice`);
      continue;
    }
    seen.add(address.text);
    if (address.anchor === undefined) {
      article.report(position, `:::embed address ${address.written} has no anchor; it must point to a heading or a paragraph ${EMBED_EXAMPLE}`);
      continue;
    }
    const found = site.find(address, article);
    if (found.problem !== undefined) {
      article.report(position, `:::embed target ${address.written} ${found.problem}`);
      continue;
    }
    if (!EMBEDDABLE.has(found.page.article.targets.get(address.anchor).kind)) {
      article.report(position, `:::embed target ${address.written} is not a heading or a paragraph`);
      continue;
    }
    parts.forEach((earlier) => {
      if (earlier.page !== found.page) return;
      const source = found.page.article;
      if (contains(source, earlier.address.anchor, address.anchor)) article.report(position, `:::embed address ${earlier.address.text} contains ${address.text}`);
      else if (contains(source, address.anchor, earlier.address.anchor)) article.report(position, `:::embed address ${address.text} contains ${earlier.address.text}`);
    });
    parts.push({ address, page: found.page });
  }
  node.parts = parts;
}

function embedLines(article, node) {
  const sourceLines = article.source.split('\n');
  const lines = [];
  for (const child of node.children) {
    if (child.type !== 'paragraph') {
      article.report(child.position.start, `:::embed holds only site addresses, one per line, ${EMBED_EXAMPLE}`);
      continue;
    }
    toString(child)
      .split('\n')
      .forEach((value, index) => {
        const text = value.trim();
        if (text === '') return;
        const line = child.position.start.line + index;
        lines.push({ text, position: { line, column: Math.max(0, sourceLines[line - 1].indexOf(text)) + 1 } });
      });
  }
  return lines;
}

function contains(article, anchor, other) {
  const inner = article.targets.get(other).node;
  let found = false;
  for (const node of embedNodes(article, anchor)) {
    walk(node, (candidate) => {
      if (candidate === inner) found = true;
    });
  }
  return found;
}

export function embedNodes(article, anchor) {
  const { node, parent } = article.targets.get(anchor);
  if (node.type === 'paragraph') return [node];
  return [node, ...followingNodes(parent.children, node, (next) => next.type === 'heading' && next.depth <= node.depth)];
}

function previewHtml(article, anchor, context) {
  const atHeading = (next) => next.type === 'heading';
  if (anchor === undefined) return renderChildrenHtml(followingNodes(article.tree.children, null, atHeading).slice(0, PREVIEW_BLOCKS), context);
  const { kind, node, parent } = article.targets.get(anchor);
  if (kind === 'heading') return renderChildrenHtml(followingNodes(parent.children, node, atHeading).slice(0, PREVIEW_BLOCKS), context);
  if (kind === 'sidenote') return renderChildrenHtml(node.children, context);
  if (kind === 'reference') return renderInlineHtml(node.children, context);
  return renderChildrenHtml([node], context);
}

function followingNodes(siblings, start, ends) {
  const nodes = [];
  for (const next of siblings.slice(siblings.indexOf(start) + 1)) {
    if (ends(next)) break;
    if (next.type === 'bakeBlock' && next.name === 'recap') continue;
    nodes.push(next);
  }
  return nodes;
}

function targetHeading(article, anchor, context) {
  if (anchor === undefined) return {};
  const { kind, node, top } = article.targets.get(anchor);
  const place = article.places.get(top);
  const heading = kind === 'heading' ? node : place?.heading;
  return { number: place?.number, title: heading === undefined ? undefined : renderInlineHtml(heading.children, context), text: heading === undefined ? undefined : toString(heading) };
}

function excerptContext(article, mode, host, page) {
  const { root } = host.context;
  const linked = mode === 'embed' ? host.context.linked : () => {};
  return {
    ...article.context,
    root,
    excerpt: {
      mode,
      base: addressHref(root, article.url),
      target: (anchor) => {
        if (!article.targets.has(anchor)) return undefined;
        const target = { address: { path: article.url, anchor, query: '', text: `${article.url}#${anchor}` }, page };
        linked(target);
        return target;
      },
    },
    linked,
    embedLinks: (node) => embedLinks(article, node, root, mode === 'embed' ? host.context.linked : null),
  };
}

export function embedParts(article, node) {
  return (node.parts ?? []).map(({ address, page }) => {
    const source = page.article;
    const context = excerptContext(source, 'embed', article, page);
    article.borrowed.add(source);
    return {
      children: renderHast(embedNodes(source, address.anchor), context).children,
      href: addressHref(article.context.root, address.path, address.anchor),
      article: page.title,
      number: targetHeading(source, address.anchor, context).number,
    };
  });
}

function embedLinks(article, node, root, linked) {
  return (node.parts ?? []).map((target) => {
    linked?.(target);
    const { address, page } = target;
    return { href: addressHref(root, address.path, address.anchor), target: address.text, text: targetHeading(page.article, address.anchor, article.context).text ?? page.title };
  });
}

export function preview(article, target, host) {
  const { address, page } = target;
  const context = excerptContext(article, 'preview', host, page);
  host.borrowed.add(article);
  const shared = { target: address.text, href: addressHref(host.context.root, address.path, address.anchor), article: page.title, html: previewHtml(article, address.anchor, context) };
  const found = address.anchor === undefined ? undefined : article.targets.get(address.anchor);
  if (found?.kind === 'reference') return { ...shared, kind: 'reference', number: found.node.number === undefined ? undefined : String(found.node.number) };
  const { number, title } = targetHeading(article, address.anchor, context);
  return { ...shared, kind: 'section', number, title };
}
