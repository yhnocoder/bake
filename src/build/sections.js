import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';

const headingLevel = (node) => (node.type === 'element' && /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0);

const isBlock = (node) => node.tagName === 'p' || (node.tagName === 'figure' && node.properties.className?.includes('image'));

function componentNames(nodes) {
  const names = new Set();
  visit({ type: 'root', children: nodes }, 'element', (node) => {
    if (node.properties.className?.includes('component')) names.add(node.tagName);
  });
  return [...names];
}

function section(kind, nodes) {
  return { kind, html: toHtml({ type: 'root', children: nodes }, { closeEmptyElements: true }), components: componentNames(nodes) };
}

export function pageSections({ title, html }) {
  const tree = fromHtml(html, { fragment: true });
  const top = tree.children;
  const lede = top.find((node) => node.tagName === 'div' && node.properties.className?.includes('lede'));
  const sections = {};
  top.forEach((node, index) => {
    const level = headingLevel(node);
    if (level === 0 || node.properties.id === undefined) return;
    const end = top.findIndex((next, nextIndex) => nextIndex > index && headingLevel(next) > 0 && headingLevel(next) <= level);
    sections[node.properties.id] = section('heading', top.slice(index, end === -1 ? undefined : end));
  });
  visit(tree, 'element', (node) => {
    if (isBlock(node) && node.properties.id !== undefined) sections[node.properties.id] = section('block', [node]);
  });
  return { title, lede: lede ? toHtml(lede, { closeEmptyElements: true }) : '', sections };
}
