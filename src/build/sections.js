import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { SKIP, visit } from 'unist-util-visit';
import { glyphsOf } from '../client/math-defs.js';
import { referencedGlyphs } from '../client/preview-data.js';

const headingLevel = (node) => (node.type === 'element' && /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0);

const isBlock = (node) => node.tagName === 'p' || (node.tagName === 'figure' && node.properties.className?.includes('image'));

const hasClass = (node, name) => node.type === 'element' && node.properties.className?.includes(name);

const isSidenote = (node) => (node.tagName === 'sup' && hasClass(node, 'sidenote-ref')) || (node.tagName === 'aside' && hasClass(node, 'sidenote'));

const hasScheme = (value) => /^[a-z][a-z0-9+.-]*:/i.test(value);

function componentNames(nodes) {
  const names = new Set();
  visit({ type: 'root', children: nodes }, 'element', (node) => {
    if (hasClass(node, 'component')) names.add(node.tagName);
  });
  return [...names];
}

function absolute(value, url) {
  if (value.startsWith('#')) return url + value;
  if (value.startsWith('/') || hasScheme(value)) return value;
  const resolved = new URL(value, `http://localhost${url}`);
  return resolved.pathname + resolved.search + resolved.hash;
}

function cleanTree(tree, url) {
  visit(tree, 'element', (node, index, parent) => {
    if (isSidenote(node)) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.tagName === 'span' && hasClass(node, 'sidenote-span')) {
      parent.children.splice(index, 1, ...node.children);
      return [SKIP, index];
    }
    delete node.properties.id;
    const { href, src } = node.properties;
    if (node.tagName === 'a' && typeof href === 'string') node.properties.href = absolute(href, url);
    if (typeof src === 'string') node.properties.src = absolute(src, url);
    return undefined;
  });
  return tree;
}

function section(nodes, url) {
  const copy = cleanTree(structuredClone({ type: 'root', children: nodes }), url);
  return { html: toHtml(copy, { closeEmptyElements: true }), components: componentNames(copy.children) };
}

export function pageSections({ title, html, mathDefs, url, scripts }) {
  const tree = fromHtml(html, { fragment: true });
  const top = tree.children;
  const ledeNode = top.find((node) => node.tagName === 'div' && hasClass(node, 'lede'));
  const lede = ledeNode ? section([ledeNode], url) : null;
  const sections = {};
  top.forEach((node, index) => {
    const level = headingLevel(node);
    if (level === 0 || node.properties.id === undefined) return;
    const end = top.findIndex((next, nextIndex) => nextIndex > index && headingLevel(next) > 0 && headingLevel(next) <= level);
    sections[node.properties.id] = { kind: 'heading', ...section(top.slice(index, end === -1 ? undefined : end), url) };
  });
  visit(tree, 'element', (node) => {
    if (isBlock(node) && node.properties.id !== undefined) sections[node.properties.id] = { kind: 'block', ...section([node], url) };
  });
  const items = [...(lede ? [lede] : []), ...Object.values(sections)];
  const allGlyphs = glyphsOf(mathDefs);
  const glyphs = Object.assign({}, ...items.map((item) => referencedGlyphs(item.html, allGlyphs)));
  const used = new Set(items.flatMap((item) => item.components));
  const pageScripts = Object.fromEntries(Object.entries(scripts).filter(([name]) => used.has(name)));
  return { title, lede, sections, glyphs, scripts: pageScripts };
}

function textOf(node) {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  if ((node.tagName === 'a' && hasClass(node, 'anchor')) || isSidenote(node)) return '';
  if (hasClass(node, 'math')) return node.properties.dataTex ?? '';
  return node.children.map(textOf).join('');
}

export function sectionList(html) {
  const tree = fromHtml(html, { fragment: true });
  const list = [];
  visit(tree, 'element', (node, index, parent) => {
    const id = node.properties.id;
    if (id === undefined) return;
    if (parent === tree && headingLevel(node) > 0) list.push({ id, kind: 'heading', text: textOf(node).trim() });
    else if (isBlock(node)) list.push({ id, kind: 'block', text: textOf(node).trim() });
  });
  return list;
}
